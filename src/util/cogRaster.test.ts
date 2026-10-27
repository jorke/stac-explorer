import { describe, expect, it } from 'vitest'
import { fromArrayBuffer, writeArrayBuffer } from 'geotiff'
import { prepareCog, renderCogTile, tileBounds, TILE_SIZE } from './cogRaster'

const HALF_WORLD = 20037508.342789244

async function rgbRaster(width: number, constant?: number) {
  const values = new Uint8Array(width * width * 3)
  for (let row = 0; row < width; row++)
    for (let column = 0; column < width; column++) {
      const offset = (row * width + column) * 3
      if (constant !== undefined) values.set([constant, constant, constant], offset)
      else if (row < width / 2) values.set(column < width / 2 ? [255, 0, 0] : [0, 255, 0], offset)
      else values.set(column < width / 2 ? [0, 0, 255] : [0, 0, 0], offset)
    }
  return fromArrayBuffer(
    writeArrayBuffer(values, {
      width,
      height: width,
      SamplesPerPixel: 3,
      PhotometricInterpretation: 2,
      BitsPerSample: [8, 8, 8],
      GTModelTypeGeoKey: 1,
      ProjectedCSTypeGeoKey: 3857,
      ModelPixelScale: [HALF_WORLD / width, HALF_WORLD / width, 0],
      ModelTiepoint: [0, 0, 0, 0, HALF_WORLD, 0],
      GDAL_NODATA: '0',
    }),
  )
}

const pixel = (pixels: Uint8ClampedArray, x: number, y: number) =>
  Array.from(pixels.slice((y * TILE_SIZE + x) * 4, (y * TILE_SIZE + x) * 4 + 4))

describe('COG tiles', () => {
  it('renders georeferenced RGB pixels and transparent no-data into XYZ tiles', async () => {
    const cog = await prepareCog(await rgbRaster(4))
    const { pixels } = await renderCogTile(cog, 1, 1, 0)
    expect(pixel(pixels, 64, 64)).toEqual([255, 0, 0, 255])
    expect(pixel(pixels, 192, 64)).toEqual([0, 255, 0, 255])
    expect(pixel(pixels, 64, 192)).toEqual([0, 0, 255, 255])
    expect(pixel(pixels, 192, 192)).toEqual([0, 0, 0, 0])
    expect((await renderCogTile(cog, 1, 0, 1)).pixels.every((value) => value === 0)).toBe(true)
  })

  it('switches from an overview to native pixels when zooming in', async () => {
    const tiff = await rgbRaster(512)
    const base = await tiff.getImage()
    const overview = await (await rgbRaster(256, 100)).getImage()
    tiff.getImageCount = async () => 2
    tiff.getImage = async (index = 0) => (index === 0 ? base : overview)
    const cog = await prepareCog(tiff)
    const wide = await renderCogTile(cog, 1, 1, 0)
    const zoomed = await renderCogTile(cog, 2, 2, 0)
    expect(wide.overviewWidth).toBe(256)
    expect(zoomed.overviewWidth).toBe(512)
    expect(pixel(wide.pixels, 64, 64)).toEqual([100, 100, 100, 255])
    expect(pixel(zoomed.pixels, 64, 64)).toEqual([255, 0, 0, 255])
  })

  it('reprojects UTM data into geographic map tiles', async () => {
    const tiff = await fromArrayBuffer(
      writeArrayBuffer(new Uint8Array([10, 20, 30, 40]), {
        width: 2,
        height: 2,
        SamplesPerPixel: 1,
        PhotometricInterpretation: 1,
        BitsPerSample: [8],
        GTModelTypeGeoKey: 1,
        ProjectedCSTypeGeoKey: 32631,
        ModelPixelScale: [500, 500, 0],
        ModelTiepoint: [0, 0, 0, 500000, 1000, 0],
      }),
    )
    const cog = await prepareCog(tiff)
    const z = 16,
      x = Math.floor(((3.004 + 180) / 360) * 2 ** z)
    const lat = (0.004 * Math.PI) / 180
    const y = Math.floor(((1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2) * 2 ** z)
    expect(cog.bounds[0]).toBeCloseTo(3, 4)
    expect((await renderCogTile(cog, z, x, y)).pixels.some((value) => value > 0)).toBe(true)
  })

  it('rejects invalid tile coordinates and cancels stale requests', async () => {
    expect(() => tileBounds(-1, 0, 0)).toThrow()
    expect(() => tileBounds(1, 2, 0)).toThrow()
    const controller = new AbortController()
    controller.abort()
    await expect(
      renderCogTile(await prepareCog(await rgbRaster(4)), 1, 1, 0, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
