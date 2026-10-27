import { memo } from 'react'
import type { RasterAsset } from '../util/imagery'

interface MapOverlayControlsProps {
  assets: RasterAsset[]
  assetId?: string
  enabled: boolean
  opacity: number
  boundsOpacity: number
  showPins: boolean
  status: string
  error: string
  onAssetChange: (id: string) => void
  onEnabledChange: (enabled: boolean) => void
  onOpacityChange: (opacity: number) => void
  onBoundsOpacityChange: (opacity: number) => void
  onPinsChange: (show: boolean) => void
}

export const MapOverlayControls = memo(function MapOverlayControls({
  assets,
  assetId,
  enabled,
  opacity,
  boundsOpacity,
  showPins,
  status,
  error,
  onAssetChange,
  onEnabledChange,
  onOpacityChange,
  onBoundsOpacityChange,
  onPinsChange,
}: MapOverlayControlsProps) {
  return (
    <div className="overlay-controls">
      <div className="overlay-title">
        <strong>Imagery overlay</strong>
        <label className="overlay-toggle">
          <input
            type="checkbox"
            checked={enabled}
            disabled={!assets.length}
            onChange={(event) => onEnabledChange(event.target.checked)}
            aria-label="Show imagery overlay"
          />{' '}
          Show
        </label>
      </div>
      {assets.length ? (
        <>
          <label className="overlay-asset">
            <span>Asset</span>
            <select
              aria-label="Imagery asset"
              value={assetId}
              onChange={(event) => onAssetChange(event.target.value)}
            >
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.title}
                </option>
              ))}
            </select>
          </label>
          <label className="opacity-control">
            <span>Imagery opacity</span>
            <input
              aria-label="Imagery opacity"
              type="range"
              min="0"
              max="100"
              value={opacity}
              disabled={!enabled}
              onChange={(event) => onOpacityChange(Number(event.target.value))}
            />
            <output>{opacity}%</output>
          </label>
          <p className={error ? 'overlay-error' : 'overlay-status'} role="status">
            {error || (enabled ? status : 'Overlay hidden')}
          </p>
        </>
      ) : (
        <p className="overlay-status">No browser-accessible GeoTIFF assets on this item.</p>
      )}
      <div className="map-pin-option">
        <label className="opacity-control bounds-opacity">
          <span>Bounds opacity</span>
          <input
            aria-label="Bounds opacity"
            type="range"
            min="0"
            max="100"
            value={boundsOpacity}
            onChange={(event) => onBoundsOpacityChange(Number(event.target.value))}
          />
          <output>{boundsOpacity}%</output>
        </label>
        <label className="overlay-toggle">
          <input
            type="checkbox"
            checked={showPins}
            onChange={(event) => onPinsChange(event.target.checked)}
          />{' '}
          Show item pins
        </label>
      </div>
    </div>
  )
})
