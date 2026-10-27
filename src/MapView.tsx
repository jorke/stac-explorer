import { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { Ref } from 'react'
import { createPortal } from 'react-dom'
import type { Entry } from './util/stac'
import { rasterAssets } from './util/imagery'
import { DEFAULT_MAP_VIEW } from './util/viewLink'
import type { MapViewState } from './util/viewLink'
import { MapOverlayControls } from './map/MapOverlayControls'
import { createSpatialDataBuilder } from './map/spatialData'
import { useImageryOverlay } from './map/useImageryOverlay'
import { useStacMap } from './map/useStacMap'

export interface MapViewHandle {
  getView: () => MapViewState
}

interface MapViewProps {
  entries: Entry[]
  selected?: Entry
  onSelect: (entry: Entry) => void
  zoomRequest?: { entry: Entry }
  controlsContainer: HTMLDivElement | null
  initialView?: MapViewState
  viewRef?: Ref<MapViewHandle>
}

function MapView({
  entries,
  selected,
  onSelect,
  zoomRequest,
  controlsContainer,
  initialView = DEFAULT_MAP_VIEW,
  viewRef,
}: MapViewProps) {
  const container = useRef<HTMLDivElement>(null)
  const buildSpatialData = useMemo(createSpatialDataBuilder, [])
  const data = useMemo(() => buildSpatialData(entries), [buildSpatialData, entries])
  const [showPins, setShowPins] = useState(initialView.showPins)
  const [boundsOpacity, setBoundsOpacity] = useState(initialView.boundsOpacity)
  const [overlayEnabled, setOverlayEnabled] = useState(initialView.imageryEnabled)
  const [opacity, setOpacity] = useState(initialView.imageryOpacity)
  const [overlayError, setOverlayError] = useState('')

  const assets = useMemo(() => rasterAssets(selected), [selected])
  const [choice, setChoice] = useState<{ key: string; id: string }>()
  const savedAsset = useRef(initialView.assetId)
  const chosenAssetId = choice?.key === selected?.key ? choice?.id : savedAsset.current
  const asset = assets.find((asset) => asset.id === chosenAssetId) ?? assets[0]

  useEffect(() => {
    if (selected && savedAsset.current) {
      setChoice({ key: selected.key, id: savedAsset.current })
      savedAsset.current = undefined
    }
  }, [selected])

  const { mapRef, themeRef, ready, error, basemapFailed, hasApiKey, fitAll } = useStacMap({
    container,
    initialView,
    data,
    selectedKey: selected?.key,
    onSelect,
    zoomRequest,
    showPins,
    boundsOpacity,
    onImageryError: setOverlayError,
  })
  const overlayStatus = useImageryOverlay({
    mapRef,
    themeRef,
    ready,
    basemapFailed,
    asset,
    enabled: overlayEnabled,
    opacity,
    onError: setOverlayError,
  })

  useImperativeHandle(
    viewRef,
    () => ({
      getView: () => {
        const map = mapRef.current
        const center = map?.getCenter()
        return {
          center: center
            ? [((((center.lng + 180) % 360) + 360) % 360) - 180, center.lat]
            : initialView.center,
          zoom: map?.getZoom() ?? initialView.zoom,
          bearing: map?.getBearing() ?? initialView.bearing,
          pitch: map?.getPitch() ?? initialView.pitch,
          imageryEnabled: overlayEnabled,
          imageryOpacity: opacity,
          boundsOpacity,
          showPins,
          ...(asset ? { assetId: asset.id } : {}),
        }
      },
    }),
    [asset?.id, overlayEnabled, opacity, boundsOpacity, showPins, initialView, mapRef],
  )

  const selectAsset = useCallback(
    (id: string) => {
      if (!selected) return
      setChoice({ key: selected.key, id })
      setOverlayEnabled(true)
    },
    [selected?.key],
  )
  const centroidCount = data.centroids.features.length

  return (
    <section
      className={`map-panel${entries.length ? ' has-data' : ''}`}
      aria-label="STAC footprint map"
    >
      <div ref={container} className="map-canvas" />
      <div className="map-heading">
        <span className="live-dot" /> SPATIAL VIEW
      </div>
      {selected &&
        controlsContainer &&
        createPortal(
          <MapOverlayControls
            assets={assets}
            assetId={asset?.id}
            enabled={overlayEnabled}
            opacity={opacity}
            boundsOpacity={boundsOpacity}
            showPins={showPins}
            status={overlayStatus}
            error={overlayError}
            onAssetChange={selectAsset}
            onEnabledChange={setOverlayEnabled}
            onOpacityChange={setOpacity}
            onBoundsOpacityChange={setBoundsOpacity}
            onPinsChange={setShowPins}
          />,
          controlsContainer,
        )}
      {(!hasApiKey || error) && (
        <div className="map-notice" role="status">
          <span className="notice-icon">⌖</span>
          <div>
            <strong>{error ? 'Basemap unavailable' : 'Your basemap goes here'}</strong>
            <p>
              {error || (
                <>
                  Add your Amazon Location key to <code>.env.local</code> and restart Vite. Catalog
                  footprints work in the meantime.
                </>
              )}
            </p>
          </div>
        </div>
      )}
      <div className="map-bottom">
        <span className="map-legend">
          <i /> {centroidCount || data.footprints.features.length}{' '}
          {centroidCount ? 'item locations' : 'footprints'}
        </span>
        <button
          className="button map-fit"
          onClick={fitAll}
          disabled={!ready || !data.footprints.features.length}
        >
          ⌗ Fit to data
        </button>
      </div>
      <div className="basemap-label">
        {hasApiKey && !basemapFailed ? 'Amazon Location Service' : 'Coordinate grid · no basemap'}
      </div>
    </section>
  )
}

export default memo(MapView)
