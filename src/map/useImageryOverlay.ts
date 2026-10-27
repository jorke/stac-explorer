import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Map as MapInstance } from 'maplibre-gl'
import type { RasterAsset, RasterPreview } from '../util/imagery'
import { createCogSource } from '../util/cogProtocol'
import type { MapTheme } from '../util/theme'

interface ImageryOverlayOptions {
  mapRef: RefObject<MapInstance | null>
  themeRef: RefObject<MapTheme | null>
  ready: boolean
  basemapFailed: boolean
  asset?: RasterAsset
  enabled: boolean
  opacity: number
  onError: (message: string) => void
}

/** Keep loading, cancellation, and layer cleanup together for both raster paths. */
export function useImageryOverlay({
  mapRef,
  themeRef,
  ready,
  basemapFailed,
  asset,
  enabled,
  opacity,
  onError,
}: ImageryOverlayOptions) {
  const [status, setStatus] = useState('')
  const opacityRef = useRef(opacity)
  opacityRef.current = opacity

  useEffect(() => {
    const map = mapRef.current
    const theme = themeRef.current
    onError('')
    setStatus('')
    if (!ready || !map || !theme || !asset || !enabled) return

    let active = true
    let worker: Worker | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const removeOverlay = () => {
      if (mapRef.current !== map) return
      if (map.getLayer('imagery')) map.removeLayer('imagery')
      if (map.getSource('imagery')) map.removeSource('imagery')
    }
    const fail = (message: string) => {
      if (!active) return
      setStatus('')
      onError(message)
      worker?.terminate()
      clearTimeout(timer)
      removeOverlay()
    }
    const addRasterLayer = () => {
      // Imagery covers footprint fills; outlines stay visible above it.
      map.addLayer(
        {
          id: 'imagery',
          type: 'raster',
          source: 'imagery',
          paint: {
            'raster-opacity': opacityRef.current / 100,
            'raster-fade-duration': theme.rasterFadeDuration,
          },
        },
        'footprints-line',
      )
    }

    if (asset.isCog) {
      const controller = new AbortController()
      let release: (() => void) | undefined
      setStatus('Opening COG…')
      void createCogSource(asset.url, controller.signal)
        .then((source) => {
          if (!active) {
            source.release()
            return
          }
          release = source.release
          map.addSource('imagery', {
            type: 'raster',
            tiles: source.tiles,
            bounds: source.bounds,
            tileSize: 256,
            maxzoom: 24,
          })
          addRasterLayer()
          setStatus('COG tiles · detail loads as you zoom')
        })
        .catch(() => {
          release?.()
          if (active && !controller.signal.aborted) {
            fail(
              'Could not open this COG. Check browser access, range-request support, and georeferencing.',
            )
          }
        })
      return () => {
        active = false
        controller.abort()
        release?.()
        removeOverlay()
      }
    }

    timer = setTimeout(
      () => fail('The raster preview took too long to load. Try another asset.'),
      45000,
    )
    setStatus('Loading imagery…')
    try {
      worker = new Worker(new URL('../util/raster.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<{ preview?: RasterPreview; error?: string }>) => {
        if (!active) return
        clearTimeout(timer)
        if (event.data.error) {
          fail(event.data.error)
          return
        }
        const preview = event.data.preview
        if (!preview) {
          fail('No imagery was returned for this raster.')
          return
        }
        try {
          const canvas = document.createElement('canvas')
          canvas.width = preview.width
          canvas.height = preview.height
          const context = canvas.getContext('2d')
          if (!context) throw new Error('Canvas is unavailable.')
          const image = context.createImageData(preview.width, preview.height)
          image.data.set(preview.pixels)
          context.putImageData(image, 0, 0)
          map.addSource('imagery', {
            type: 'canvas',
            canvas,
            coordinates: preview.coordinates,
            animate: false,
          })
          addRasterLayer()
          setStatus(
            `Preview · ${preview.width} × ${preview.height}${preview.stretched ? ' · auto contrast' : ''}`,
          )
          worker?.terminate()
        } catch {
          fail('The raster was read, but its overlay could not be displayed.')
        }
      }
      worker.onerror = () =>
        fail('The imagery reader could not start. Reload the page and try again.')
      worker.postMessage({ url: asset.url })
    } catch {
      fail('The imagery reader could not start in this browser.')
    }
    return () => {
      active = false
      clearTimeout(timer)
      worker?.terminate()
      removeOverlay()
    }
  }, [asset?.url, asset?.isCog, enabled, ready, basemapFailed, mapRef, themeRef, onError])

  useEffect(() => {
    const map = mapRef.current
    if (map?.getLayer('imagery')) map.setPaintProperty('imagery', 'raster-opacity', opacity / 100)
  }, [opacity, mapRef])

  return status
}
