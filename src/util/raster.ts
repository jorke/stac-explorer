import { fromUrl } from 'geotiff'
import type { GeoTIFF, GeoTIFFImage } from 'geotiff'
import proj4 from 'proj4'
import { toProj4 } from 'geotiff-geokeys-to-proj4'
import type { RasterPreview } from './imagery'

const PREVIEW_SIZE = 1024
const MAX_SOURCE_PIXELS = 4096 * 4096
type Point = [number, number]
type Affine = [number, number, number, number, number, number]

export function applyAffine(transform: Affine, x: number, y: number): Point {
  return [
    transform[0] + x * transform[1] + y * transform[2],
    transform[3] + x * transform[4] + y * transform[5],
  ]
}

export function invertAffine(transform: Affine, x: number, y: number): Point {
  const determinant = transform[1] * transform[5] - transform[2] * transform[4]
  if (!Number.isFinite(determinant) || determinant === 0)
    throw new Error('This raster has an invalid georeferencing transform.')
  return [
    ((x - transform[0]) * transform[5] - (y - transform[3]) * transform[2]) / determinant,
    ((y - transform[3]) * transform[1] - (x - transform[0]) * transform[4]) / determinant,
  ]
}

export function affineOf(image: GeoTIFFImage): Affine {
  const directory = image.getFileDirectory()
  const matrix = directory.getValue('ModelTransformation')
  let transform: Affine
  if (matrix) transform = [matrix[3], matrix[0], matrix[1], matrix[7], matrix[4], matrix[5]]
  else {
    const scale = directory.getValue('ModelPixelScale')
    const tie = directory.getValue('ModelTiepoint')
    if (!scale || !tie)
      throw new Error('This GeoTIFF does not contain a supported georeferencing transform.')
    transform = [tie[3] - tie[0] * scale[0], scale[0], 0, tie[4] + tie[1] * scale[1], 0, -scale[1]]
  }
  if (image.getGeoKeys()?.GTRasterTypeGeoKey === 2) {
    // PixelIsPoint tiepoints refer to pixel centers, while our image coordinates use edges.
    transform[0] -= (transform[1] + transform[2]) / 2
    transform[3] -= (transform[4] + transform[5]) / 2
  }
  return transform
}

export function projectionOf(image: GeoTIFFImage) {
  const keys = image.getGeoKeys()
  if (!keys) throw new Error('This GeoTIFF has no coordinate reference system.')
  const code = keys.ProjectedCSTypeGeoKey ?? keys.GeographicTypeGeoKey
  const named = code && proj4.defs(`EPSG:${code}`)
  if (named) return { projection: proj4(named, 'EPSG:3857'), xFactor: 1, yFactor: 1 }
  const normalized = { ...keys }
  // A projected CRS's geographic base is not the CRS of its pixel coordinates.
  if (keys.ProjectedCSTypeGeoKey && keys.GTModelTypeGeoKey === 1)
    delete normalized.GeographicTypeGeoKey
  const definition = toProj4(normalized)
  const errors = Object.keys(definition.errors).filter((key) => !key.startsWith('vertical'))
  if (!definition.proj4 || errors.length)
    throw new Error(
      `This raster's coordinate reference system is not supported${code ? ` (EPSG:${code})` : ''}.`,
    )
  return {
    projection: proj4(definition.proj4, 'EPSG:3857'),
    xFactor: definition.conversionParameters.x,
    yFactor: definition.conversionParameters.y,
  }
}

function dimensions(width: number, height: number, size: number) {
  const scale = Math.min(1, size / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export async function readPixels(
  image: GeoTIFFImage,
  base: GeoTIFFImage,
  readSize: { width: number; height: number; window?: number[]; signal?: AbortSignal },
  mask?: GeoTIFFImage,
  range?: [number, number],
) {
  const photometric = image.getFileDirectory().getValue('PhotometricInterpretation')
  const gray = photometric === 0 || photometric === 1
  const pixels = gray
    ? await image.readRasters({ ...readSize, samples: [0], interleave: true })
    : await image.readRGB({ ...readSize, interleave: true, enableAlpha: true })
  const channels = pixels.length / (readSize.width * readSize.height)
  const noData = base.getGDALNoData()
  const bits = image.getBitsPerSample()
  const stretched = gray || bits > 8
  let [low, high] = range ?? [0, 255]
  if (stretched && !range) {
    const values: number[] = []
    for (let i = 0; i < pixels.length; i += Math.max(1, Math.floor(pixels.length / 12000))) {
      if (Number.isFinite(pixels[i]) && pixels[i] !== noData) values.push(pixels[i])
    }
    values.sort((a, b) => a - b)
    low = values[Math.floor(values.length * 0.02)] ?? 0
    high = values[Math.floor(values.length * 0.98)] ?? 255
    if (high <= low) high = low + 1
  }
  const maskPixels = mask
    ? await mask.readRasters({ ...readSize, samples: [0], interleave: true })
    : undefined
  const rgba = new Uint8ClampedArray(readSize.width * readSize.height * 4)
  for (let i = 0; i < readSize.width * readSize.height; i++) {
    const offset = i * channels
    const values = gray
      ? [pixels[offset], pixels[offset], pixels[offset]]
      : [pixels[offset], pixels[offset + 1], pixels[offset + 2]]
    const valid =
      values.every(Number.isFinite) &&
      (maskPixels
        ? maskPixels[i] !== 0
        : !(noData !== null && values.every((value) => Object.is(value, noData))))
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = ((values[c] - low) / (high - low)) * 255
    if (photometric === 0) for (let c = 0; c < 3; c++) rgba[i * 4 + c] = 255 - rgba[i * 4 + c]
    rgba[i * 4 + 3] = valid
      ? channels === 4
        ? Math.round((pixels[offset + 3] / (2 ** bits - 1)) * 255)
        : 255
      : 0
  }

  return { pixels: rgba, stretched, range: [low, high] as [number, number] }
}

export async function renderRaster(tiff: GeoTIFF, size = PREVIEW_SIZE): Promise<RasterPreview> {
  const base = await tiff.getImage()
  const affine = affineOf(base)
  const { projection, xFactor, yFactor } = projectionOf(base)
  const images: GeoTIFFImage[] = []
  const masks: GeoTIFFImage[] = []
  for (let i = 0, count = Math.min(32, await tiff.getImageCount()); i < count; i++) {
    const image = await tiff.getImage(i)
    const subtype = image.getFileDirectory().getValue('NewSubfileType') ?? 0
    ;(subtype & 4 ? masks : images).push(image)
  }
  // Choose the smallest overview with enough pixels for a useful preview.
  images.sort((a, b) => a.getWidth() - b.getWidth())
  const image =
    images.find((candidate) => Math.max(candidate.getWidth(), candidate.getHeight()) >= size) ??
    images.at(-1)!
  if (image.getWidth() * image.getHeight() > MAX_SOURCE_PIXELS) {
    throw new Error(
      'This raster is too large to preview without internal overviews. Choose a COG or a smaller preview asset.',
    )
  }
  const readSize = dimensions(image.getWidth(), image.getHeight(), size)
  const mask = masks.find(
    (candidate) =>
      candidate.getWidth() === image.getWidth() && candidate.getHeight() === image.getHeight(),
  )
  const { pixels: rgba, stretched } = await readPixels(image, base, readSize, mask)

  const projectPixel = (x: number, y: number): Point => {
    const model = applyAffine(affine, x, y)
    return projection.forward([model[0] * xFactor, model[1] * yFactor]) as Point
  }
  // Sample all four edges because UTM and other projected edges become curves in Mercator.
  const edge: Point[] = []
  for (let i = 0; i <= 32; i++) {
    const x = (base.getWidth() * i) / 32,
      y = (base.getHeight() * i) / 32
    edge.push(
      projectPixel(x, 0),
      projectPixel(x, base.getHeight()),
      projectPixel(0, y),
      projectPixel(base.getWidth(), y),
    )
  }
  if (!edge.every((point) => point.every(Number.isFinite)))
    throw new Error('This raster extends outside the supported map projection.')
  const west = Math.min(...edge.map((p) => p[0])),
    east = Math.max(...edge.map((p) => p[0]))
  const south = Math.max(-20037508.342789, Math.min(...edge.map((p) => p[1])))
  const north = Math.min(20037508.342789, Math.max(...edge.map((p) => p[1])))
  if (east <= west || north <= south) throw new Error('This raster has an empty map extent.')
  const outputSize = Math.min(size, Math.max(readSize.width, readSize.height))
  const aspect = (east - west) / (north - south)
  const output =
    aspect >= 1
      ? { width: outputSize, height: Math.max(1, Math.round(outputSize / aspect)) }
      : { width: Math.max(1, Math.round(outputSize * aspect)), height: outputSize }
  const projectedPixels = new Uint8ClampedArray(output.width * output.height * 4)
  for (let y = 0; y < output.height; y++) {
    for (let x = 0; x < output.width; x++) {
      const mercator: Point = [
        west + ((x + 0.5) / output.width) * (east - west),
        north - ((y + 0.5) / output.height) * (north - south),
      ]
      const model = projection.inverse(mercator)
      const pixel = invertAffine(affine, model[0] / xFactor, model[1] / yFactor)
      const sx = Math.floor((pixel[0] / base.getWidth()) * readSize.width)
      const sy = Math.floor((pixel[1] / base.getHeight()) * readSize.height)
      if (
        sx < 0 ||
        sy < 0 ||
        sx >= readSize.width ||
        sy >= readSize.height ||
        !Number.isFinite(sx + sy)
      )
        continue
      const from = (sy * readSize.width + sx) * 4
      projectedPixels.set(rgba.subarray(from, from + 4), (y * output.width + x) * 4)
    }
  }
  const coordinates = [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ].map((point) => proj4('EPSG:3857', 'EPSG:4326', point) as Point) as RasterPreview['coordinates']
  return { pixels: projectedPixels, ...output, coordinates, stretched }
}

export async function loadRaster(url: string): Promise<RasterPreview> {
  // Do not download a huge entire file if its server ignores range requests.
  const options: NonNullable<Parameters<typeof fromUrl>[1]> & { credentials: RequestCredentials } =
    { allowFullFile: false, credentials: 'omit' }
  const tiff = await fromUrl(url, options)
  return renderRaster(tiff)
}
