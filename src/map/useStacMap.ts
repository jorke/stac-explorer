import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import * as maplibregl from 'maplibre-gl'
import workerSource from 'maplibre-gl/dist/maplibre-gl-worker.mjs?raw'
import type {
  ExpressionSpecification,
  GeoJSONSource,
  Map as MapInstance,
  StyleSpecification,
} from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { boundsOf, featuresOf } from '../util/stac'
import type { Entry } from '../util/stac'
import { readMapTheme } from '../util/theme'
import type { MapTheme } from '../util/theme'
import type { MapViewState } from '../util/viewLink'
import type { SpatialData } from './spatialData'

// The prebuilt worker is self-contained. Keep it out of Vite's module transforms.
// Its relative source map URL cannot resolve from a blob URL.
const workerScript = workerSource.replace(/^\/\/# sourceMappingURL=.*$/gm, '')
const workerUrl = URL.createObjectURL(new Blob([workerScript], { type: 'text/javascript' }))
maplibregl.setWorkerUrl(workerUrl)
if (import.meta.hot) import.meta.hot.dispose(() => URL.revokeObjectURL(workerUrl))

const apiKey = import.meta.env.VITE_ALS_API_KEY?.trim()
const region = import.meta.env.VITE_ALS_REGION?.trim() || 'ap-southeast-2'
const mapStyle = import.meta.env.VITE_ALS_MAP_STYLE?.trim() || 'Satellite'
const host = `maps.geo.${region}.amazonaws.com`
const pinLayers = ['footprints-point', 'item-centroids', 'item-centroid-targets']
const interactiveLayers = [
  'footprints-fill',
  'footprints-line',
  'footprints-point',
  'item-centroid-targets',
]
const grid: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    ...Array.from({ length: 13 }, (_, i) => ({
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [i * 30 - 180, -85],
          [i * 30 - 180, 85],
        ],
      },
    })),
    ...Array.from({ length: 5 }, (_, i) => ({
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [-180, i * 30 - 60],
          [180, i * 30 - 60],
        ],
      },
    })),
  ],
}

interface StacMapOptions {
  container: RefObject<HTMLDivElement | null>
  initialView: MapViewState
  data: SpatialData
  selectedKey?: string
  onSelect: (entry: Entry) => void
  zoomRequest?: { entry: Entry }
  showPins: boolean
  boundsOpacity: number
  onImageryError: (message: string) => void
}

/** Own the map and its STAC layers; selection alone never moves the camera. */
export function useStacMap(options: StacMapOptions) {
  const { container, initialView, data, selectedKey, zoomRequest, showPins, boundsOpacity } =
    options
  const mapRef = useRef<MapInstance | null>(null)
  const themeRef = useRef<MapTheme | null>(null)
  const latest = useRef(options)
  latest.current = options
  const appliedData = useRef<SpatialData | undefined>(undefined)
  const appliedZoom = useRef<typeof zoomRequest>(undefined)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [basemapFailed, setBasemapFailed] = useState(false)

  useEffect(() => {
    if (!container.current) return
    const theme = readMapTheme(container.current)
    themeRef.current = theme
    const blankStyle: StyleSpecification = {
      version: 8,
      sources: {},
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': theme.background } },
      ],
    }
    let map: MapInstance
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: apiKey
          ? `https://${host}/v2/styles/${encodeURIComponent(mapStyle)}/descriptor?key=${encodeURIComponent(apiKey)}`
          : blankStyle,
        center: initialView.center,
        zoom: initialView.zoom,
        bearing: initialView.bearing,
        pitch: initialView.pitch,
        // Match the ranges accepted by shared views and supported by COG tiles.
        maxZoom: 24,
        maxPitch: 85,
        attributionControl: {},
        transformRequest: (url) => {
          const parsed = new URL(url)
          if (apiKey && parsed.hostname === host) parsed.searchParams.set('key', apiKey)
          return { url: parsed.href }
        },
      })
    } catch {
      setError('The map needs a browser with WebGL enabled. You can still browse the catalog.')
      return
    }
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')

    let failed = false
    map.on('error', (event) => {
      if ('sourceId' in event && event.sourceId === 'imagery') {
        latest.current.onImageryError('This imagery overlay could not be displayed.')
        return
      }
      if (!apiKey || failed) return
      failed = true
      setReady(false)
      setBasemapFailed(true)
      setError(
        'Amazon Location could not load. Check the key, region, map permissions, and allowed referrers.',
      )
      map.setStyle(blankStyle)
    })

    map.on('style.load', () => {
      for (const layer of map.getStyle().layers) {
        if (layer.type === 'background')
          map.setPaintProperty(layer.id, 'background-color', theme.background)
      }
      if (!apiKey || failed) {
        map.addSource('grid', { type: 'geojson', data: grid })
        map.addLayer({
          id: 'grid',
          type: 'line',
          source: 'grid',
          paint: { 'line-color': theme.gridColor, 'line-width': theme.gridWidth },
        })
      }

      const current = latest.current
      map.addSource('stac', { type: 'geojson', data: current.data.footprints })
      map.addLayer({
        id: 'footprints-fill',
        type: 'fill',
        source: 'stac',
        filter: ['==', '$type', 'Polygon'],
        paint: {
          'fill-color': theme.footprintColor,
          'fill-opacity': [
            'case',
            ['==', ['get', 'key'], current.selectedKey ?? ''],
            theme.selectedFootprintOpacity,
            theme.footprintOpacity,
          ],
        },
      })
      map.addLayer({
        id: 'footprints-line',
        type: 'line',
        source: 'stac',
        filter: ['!=', '$type', 'Point'],
        paint: { 'line-color': theme.footprintColor, 'line-width': theme.footprintWidth },
      })
      const pinPaint = {
        'circle-radius': theme.pinRadius,
        'circle-color': theme.pinColor,
        'circle-stroke-color': theme.pinStrokeColor,
        'circle-stroke-width': theme.pinStrokeWidth,
      }
      map.addLayer({
        id: 'footprints-point',
        type: 'circle',
        source: 'stac',
        filter: ['==', '$type', 'Point'],
        paint: pinPaint,
      })
      map.addSource('centroids', { type: 'geojson', data: current.data.centroids })
      map.addLayer({ id: 'item-centroids', type: 'circle', source: 'centroids', paint: pinPaint })
      // A wider invisible hit target makes individual item points easy to click.
      map.addLayer({
        id: 'item-centroid-targets',
        type: 'circle',
        source: 'centroids',
        paint: { 'circle-radius': theme.pinHitRadius, 'circle-opacity': theme.pinHitOpacity },
      })
      for (const layer of pinLayers) {
        map.setLayoutProperty(layer, 'visibility', current.showPins ? 'visible' : 'none')
      }
      appliedData.current = current.data
      setReady(true)
    })

    for (const layer of interactiveLayers) {
      map.on('click', layer, (event) => {
        const key = event.features?.[0]?.properties?.key
        const entry = latest.current.data.entriesByKey.get(key)
        if (entry) latest.current.onSelect(entry)
      })
      map.on('mouseenter', layer, () => map.getCanvas().classList.add('is-feature-hovered'))
      map.on('mouseleave', layer, () => map.getCanvas().classList.remove('is-feature-hovered'))
    }
    const observer = new ResizeObserver(() => map.resize())
    observer.observe(container.current)
    return () => {
      observer.disconnect()
      map.remove()
      mapRef.current = null
      setReady(false)
    }
    // The initial view is consumed once. Live data and callbacks use latest.
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map?.getSource('stac')) return
    // Avoid worker serialization when a batch changes only unlocated entries.
    if (appliedData.current?.footprints !== data.footprints) {
      ;(map.getSource('stac') as GeoJSONSource).setData(data.footprints)
    }
    if (appliedData.current?.centroids !== data.centroids) {
      ;(map.getSource('centroids') as GeoJSONSource).setData(data.centroids)
    }
    appliedData.current = data
  }, [data, ready, basemapFailed])

  useEffect(() => {
    const map = mapRef.current
    const theme = themeRef.current
    if (!ready || !map || !theme || !zoomRequest || appliedZoom.current === zoomRequest) return
    // Only explicit item clicks in the left pane create these requests.
    appliedZoom.current = zoomRequest
    const bounds = boundsOf(featuresOf([zoomRequest.entry]).features)
    if (bounds) {
      map.resize()
      map.fitBounds(bounds, { padding: theme.itemFitPadding, maxZoom: 22, duration: 700 })
    }
  }, [zoomRequest, ready])

  useEffect(() => {
    const map = mapRef.current
    const theme = themeRef.current
    if (!ready || !theme || !map?.getLayer('footprints-fill')) return
    const selected: ExpressionSpecification = ['==', ['get', 'key'], selectedKey ?? '']
    map.setPaintProperty('footprints-line', 'line-width', [
      'case',
      selected,
      theme.selectedFootprintWidth,
      theme.footprintWidth,
    ])
    map.setPaintProperty('item-centroids', 'circle-radius', [
      'case',
      selected,
      theme.selectedPinRadius,
      theme.pinRadius,
    ])
    map.setPaintProperty('item-centroids', 'circle-color', [
      'case',
      selected,
      theme.selectedPinColor,
      theme.pinColor,
    ])
  }, [selectedKey, ready, basemapFailed])

  useEffect(() => {
    const map = mapRef.current
    const theme = themeRef.current
    if (!ready || !theme || !map?.getLayer('footprints-fill')) return
    const alpha = boundsOpacity / 100
    map.setPaintProperty('footprints-fill', 'fill-opacity', [
      'case',
      ['==', ['get', 'key'], selectedKey ?? ''],
      theme.selectedFootprintOpacity * alpha,
      theme.footprintOpacity * alpha,
    ])
    map.setPaintProperty('footprints-line', 'line-opacity', alpha)
    for (const layer of ['footprints-fill', 'footprints-line']) {
      map.setLayoutProperty(layer, 'visibility', boundsOpacity ? 'visible' : 'none')
    }
  }, [boundsOpacity, selectedKey, ready, basemapFailed])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    for (const layer of pinLayers) {
      if (map.getLayer(layer))
        map.setLayoutProperty(layer, 'visibility', showPins ? 'visible' : 'none')
    }
    if (!showPins) map.getCanvas().classList.remove('is-feature-hovered')
  }, [showPins, ready, basemapFailed])

  const fitAll = useCallback(() => {
    const bounds = boundsOf(data.footprints.features)
    if (bounds && themeRef.current)
      mapRef.current?.fitBounds(bounds, { padding: themeRef.current.fitPadding, maxZoom: 22 })
  }, [data.footprints])

  return { mapRef, themeRef, ready, error, basemapFailed, hasApiKey: !!apiKey, fitAll }
}
