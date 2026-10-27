import { loadRaster } from './raster'

self.onmessage = async (event: MessageEvent<{ url: string }>) => {
  try {
    const preview = await loadRaster(event.data.url)
    self.postMessage({ preview }, { transfer: [preview.pixels.buffer] })
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : ''
    self.postMessage({
      error: /overview|coordinate|georeferenc|projection|extent/i.test(detail)
        ? detail
        : 'Could not load this raster. Its URL must support browser access (CORS), byte-range requests, and a supported GeoTIFF encoding.',
    })
  }
}
