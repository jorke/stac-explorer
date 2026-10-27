import { safeUrl } from './stac'
import type { Entry } from './stac'

export interface RasterAsset {
  id: string
  title: string
  url: string
  isCog: boolean
}

export interface RasterPreview {
  pixels: Uint8ClampedArray
  width: number
  height: number
  coordinates: [[number, number], [number, number], [number, number], [number, number]]
  stretched: boolean
}

/** Prefer display-ready imagery over individual measurement bands. */
export function rasterAssets(entry?: Entry): RasterAsset[] {
  return Object.entries(entry?.document?.assets ?? {})
    .flatMap(([id, asset]) => {
      const url = safeUrl(asset.href, entry!.baseUrl)
      if (
        !url ||
        !(
          /image\/(?:tiff|geotiff)/i.test(asset.type ?? '') ||
          /\.tiff?$/i.test(new URL(url).pathname)
        )
      )
        return []
      const score = /^(visual|true[_-]?color|rgb|tci)$/i.test(id)
        ? 0
        : asset.roles?.includes('visual')
          ? 1
          : /preview/i.test(id)
            ? 2
            : 3
      return [
        {
          id,
          title: asset.title || id,
          url,
          isCog: /cloud-optimized/i.test(asset.type ?? ''),
          score,
        },
      ]
    })
    .sort((a, b) => a.score - b.score)
    .map(({ score: _, ...asset }) => asset)
}
