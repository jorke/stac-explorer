import { fromUrl } from 'geotiff'
import type { GeoTIFF, GeoTIFFImage } from 'geotiff'
import proj4 from 'proj4'
import { affineOf, applyAffine, invertAffine, projectionOf, readPixels } from './raster'

const HALF_WORLD = 20037508.342789244
export const TILE_SIZE = 256
type Bounds = [number, number, number, number]
type Point = [number, number]

export interface CogDataset {
  base: GeoTIFFImage
  images: GeoTIFFImage[]
  masks: GeoTIFFImage[]
  affine: ReturnType<typeof affineOf>
  crs: ReturnType<typeof projectionOf>
  mercatorBounds: Bounds
  bounds: Bounds
  range: [number, number]
}

export function tileBounds(z: number, x: number, y: number): Bounds {
  if (
    ![z, x, y].every(Number.isInteger) ||
    z < 0 ||
    z > 24 ||
    x < 0 ||
    y < 0 ||
    x >= 2 ** z ||
    y >= 2 ** z
  )
    throw new Error('Invalid COG tile coordinates.')
  const span = (HALF_WORLD * 2) / 2 ** z
  return [
    -HALF_WORLD + x * span,
    HALF_WORLD - (y + 1) * span,
    -HALF_WORLD + (x + 1) * span,
    HALF_WORLD - y * span,
  ]
}

export async function prepareCog(tiff: GeoTIFF): Promise<CogDataset> {
  const base = await tiff.getImage()
  const affine = affineOf(base)
  const crs = projectionOf(base)
  const images: GeoTIFFImage[] = [],
    masks: GeoTIFFImage[] = []
  for (let i = 0, count = Math.min(32, await tiff.getImageCount()); i < count; i++) {
    const image = await tiff.getImage(i)
    const subtype = image.getFileDirectory().getValue('NewSubfileType') ?? 0
    ;(subtype & 4 ? masks : images).push(image)
  }
  images.sort((a, b) => b.getWidth() - a.getWidth())
  const points: Point[] = []
  for (let i = 0; i <= 32; i++) {
    const x = (base.getWidth() * i) / 32,
      y = (base.getHeight() * i) / 32
    for (const pixel of [
      [x, 0],
      [x, base.getHeight()],
      [0, y],
      [base.getWidth(), y],
    ]) {
      const model = applyAffine(affine, pixel[0], pixel[1])
      points.push(crs.projection.forward([model[0] * crs.xFactor, model[1] * crs.yFactor]) as Point)
    }
  }
  if (!points.every((point) => point.every(Number.isFinite)))
    throw new Error('Unsupported raster extent.')
  const mercatorBounds: Bounds = [
    Math.max(-HALF_WORLD, Math.min(...points.map((point) => point[0]))),
    Math.max(-HALF_WORLD, Math.min(...points.map((point) => point[1]))),
    Math.min(HALF_WORLD, Math.max(...points.map((point) => point[0]))),
    Math.min(HALF_WORLD, Math.max(...points.map((point) => point[1]))),
  ]
  if (mercatorBounds[2] <= mercatorBounds[0] || mercatorBounds[3] <= mercatorBounds[1])
    throw new Error('Unsupported raster extent.')
  const southwest = proj4('EPSG:3857', 'EPSG:4326', mercatorBounds.slice(0, 2))
  const northeast = proj4('EPSG:3857', 'EPSG:4326', mercatorBounds.slice(2))
  let range: [number, number] = [0, 255]
  const photometric = base.getFileDirectory().getValue('PhotometricInterpretation')
  if (photometric === 0 || photometric === 1 || base.getBitsPerSample() > 8) {
    // One stable stretch per dataset prevents contrast seams between map tiles.
    const overview = images.at(-1)!
    const large = overview.getWidth() * overview.getHeight() > 4096 ** 2
    const width = Math.min(overview.getWidth(), 1024),
      height = Math.min(overview.getHeight(), 1024)
    const left = Math.floor((overview.getWidth() - width) / 2),
      top = Math.floor((overview.getHeight() - height) / 2)
    const mask = masks.find(
      (image) =>
        image.getWidth() === overview.getWidth() && image.getHeight() === overview.getHeight(),
    )
    range = (
      await readPixels(
        overview,
        base,
        {
          width: 256,
          height: 256,
          ...(large ? { window: [left, top, left + width, top + height] } : {}),
        },
        mask,
      )
    ).range
  }
  return {
    base,
    images,
    masks,
    affine,
    crs,
    mercatorBounds,
    bounds: [southwest[0], southwest[1], northeast[0], northeast[1]],
    range,
  }
}

export async function openCog(url: string): Promise<CogDataset> {
  const options: NonNullable<Parameters<typeof fromUrl>[1]> & { credentials: RequestCredentials } =
    { allowFullFile: false, credentials: 'omit' }
  return prepareCog(await fromUrl(url, options))
}

function sourcePixel(cog: CogDataset, x: number, y: number): Point {
  const model = cog.crs.projection.inverse([x, y])
  return invertAffine(cog.affine, model[0] / cog.crs.xFactor, model[1] / cog.crs.yFactor)
}

export async function renderCogTile(
  cog: CogDataset,
  z: number,
  x: number,
  y: number,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  const bounds = tileBounds(z, x, y)
  const pixels = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4)
  const overlap: Bounds = [
    Math.max(bounds[0], cog.mercatorBounds[0]),
    Math.max(bounds[1], cog.mercatorBounds[1]),
    Math.min(bounds[2], cog.mercatorBounds[2]),
    Math.min(bounds[3], cog.mercatorBounds[3]),
  ]
  if (overlap[0] >= overlap[2] || overlap[1] >= overlap[3]) return { pixels, overviewWidth: 0 }
  const grid: Point[] = []
  for (let row = 0; row <= 8; row++)
    for (let column = 0; column <= 8; column++) {
      const point = sourcePixel(
        cog,
        overlap[0] + (column / 8) * (overlap[2] - overlap[0]),
        overlap[1] + (row / 8) * (overlap[3] - overlap[1]),
      )
      if (point.every(Number.isFinite)) grid.push(point)
    }
  if (!grid.length) return { pixels, overviewWidth: 0 }
  const sourceBounds: Bounds = [
    Math.max(0, Math.min(...grid.map((point) => point[0]))),
    Math.max(0, Math.min(...grid.map((point) => point[1]))),
    Math.min(cog.base.getWidth(), Math.max(...grid.map((point) => point[0]))),
    Math.min(cog.base.getHeight(), Math.max(...grid.map((point) => point[1]))),
  ]
  if (sourceBounds[2] <= sourceBounds[0] || sourceBounds[3] <= sourceBounds[1])
    return { pixels, overviewWidth: 0 }
  const span = bounds[2] - bounds[0]
  const sourcePerPixel = Math.max(
    (sourceBounds[2] - sourceBounds[0]) / (((overlap[2] - overlap[0]) / span) * TILE_SIZE),
    (sourceBounds[3] - sourceBounds[1]) / (((overlap[3] - overlap[1]) / span) * TILE_SIZE),
  )
  // Read finer overviews as the user zooms in; use full-resolution pixels when needed.
  const image =
    cog.images
      .filter((candidate) => cog.base.getWidth() / candidate.getWidth() <= sourcePerPixel)
      .at(-1) ?? cog.base
  const sx = image.getWidth() / cog.base.getWidth(),
    sy = image.getHeight() / cog.base.getHeight()
  const window = [
    Math.max(0, Math.floor(sourceBounds[0] * sx) - 1),
    Math.max(0, Math.floor(sourceBounds[1] * sy) - 1),
    Math.min(image.getWidth(), Math.ceil(sourceBounds[2] * sx) + 1),
    Math.min(image.getHeight(), Math.ceil(sourceBounds[3] * sy) + 1),
  ]
  const windowWidth = window[2] - window[0],
    windowHeight = window[3] - window[1]
  if (windowWidth * windowHeight > 4096 ** 2)
    throw new Error('This raster needs overviews at this zoom level. Zoom in for detail.')
  const scale = Math.min(1, 1024 / Math.max(windowWidth, windowHeight))
  const width = Math.max(1, Math.round(windowWidth * scale)),
    height = Math.max(1, Math.round(windowHeight * scale))
  const mask = cog.masks.find(
    (candidate) =>
      candidate.getWidth() === image.getWidth() && candidate.getHeight() === image.getHeight(),
  )
  const rgba = (
    await readPixels(image, cog.base, { window, width, height, signal }, mask, cog.range)
  ).pixels
  signal?.throwIfAborted()
  for (let row = 0; row < TILE_SIZE; row++)
    for (let column = 0; column < TILE_SIZE; column++) {
      const p = sourcePixel(
        cog,
        bounds[0] + ((column + 0.5) / TILE_SIZE) * span,
        bounds[3] - ((row + 0.5) / TILE_SIZE) * span,
      )
      const px = Math.floor(((p[0] * sx - window[0]) / windowWidth) * width)
      const py = Math.floor(((p[1] * sy - window[1]) / windowHeight) * height)
      if (px < 0 || py < 0 || px >= width || py >= height || !Number.isFinite(px + py)) continue
      const offset = (py * width + px) * 4
      pixels.set(rgba.subarray(offset, offset + 4), (row * TILE_SIZE + column) * 4)
    }
  return { pixels, overviewWidth: image.getWidth() }
}
