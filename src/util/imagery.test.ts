import { describe, expect, it } from 'vitest'
import { fromArrayBuffer, writeArrayBuffer } from 'geotiff'
import { rasterAssets } from './imagery'
import { applyAffine, invertAffine, renderRaster } from './raster'
import type { Entry } from './stac'

describe('imagery assets', () => {
  it('prefers a true-color raster and resolves relative asset URLs', () => {
    const entry: Entry = {
      key: 'test',
      title: 'Test',
      kind: 'Item',
      baseUrl: 'https://example.com/items/item.json',
      document: {
        assets: {
          red: { href: 'red.tif', type: 'image/tiff' },
          thumbnail: { href: 'preview.jpg', roles: ['thumbnail'] },
          visual: {
            href: 'TCI.tif?token=abc',
            type: 'image/tiff; application=geotiff; profile=cloud-optimized',
          },
          private: { href: 's3://bucket/image.tif', type: 'image/tiff' },
        },
      },
    }
    const assets = rasterAssets(entry)
    expect(assets.map((asset) => asset.id)).toEqual(['visual', 'red'])
    expect(assets[0].url).toBe('https://example.com/items/TCI.tif?token=abc')
    expect(rasterAssets()).toEqual([])
  })
})

describe('raster georeferencing and rendering', () => {
  it('inverts rotated transforms, including nonzero tiepoint offsets', () => {
    const affine: [number, number, number, number, number, number] = [1000, 10, 2, 2000, 3, -10]
    expect(applyAffine(affine, 4, 5)).toEqual([1050, 1962])
    expect(invertAffine(affine, 1050, 1962)).toEqual([4, 5])
  })

  it('places actual RGB pixels at their geographic coordinates, preserving no-data transparency', async () => {
    const tiff = await fromArrayBuffer(
      writeArrayBuffer(new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0]), {
        width: 2,
        height: 2,
        SamplesPerPixel: 3,
        PhotometricInterpretation: 2,
        BitsPerSample: [8, 8, 8],
        GTModelTypeGeoKey: 1,
        ProjectedCSTypeGeoKey: 3857,
        ModelPixelScale: [1000, 1000, 0],
        ModelTiepoint: [0, 0, 0, 0, 2000, 0],
        GDAL_NODATA: '0',
      }),
    )
    const preview = await renderRaster(tiff, 2)
    expect(preview.width).toBe(2)
    expect(preview.height).toBe(2)
    expect(Array.from(preview.pixels)).toEqual([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0,
    ])
    expect(preview.coordinates[0][0]).toBeCloseTo(0)
    expect(preview.coordinates[0][1]).toBeCloseTo(0.0179663)
    expect(preview.coordinates[2][0]).toBeCloseTo(0.0179663)
    expect(preview.coordinates[2][1]).toBeCloseTo(0)
    expect(preview.stretched).toBe(false)
  })

  it('reprojects a UTM raster instead of treating its coordinates as degrees', async () => {
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
    const preview = await renderRaster(tiff, 2)
    expect(preview.coordinates[0][0]).toBeCloseTo(3, 4)
    expect(preview.coordinates[0][1]).toBeCloseTo(0.0090473, 5)
    expect(preview.coordinates[2][0]).toBeCloseTo(3.0089867, 5)
    expect(preview.pixels.some((value) => value > 0)).toBe(true)
    expect(preview.stretched).toBe(true)
  })

  it('resolves custom southern UTM parameters used by GeoNadir', async () => {
    const tiff = await fromArrayBuffer(
      writeArrayBuffer(new Uint8Array([10, 20, 30, 40]), {
        width: 2,
        height: 2,
        SamplesPerPixel: 1,
        PhotometricInterpretation: 1,
        BitsPerSample: [8],
        GTModelTypeGeoKey: 1,
        ProjectedCSTypeGeoKey: 32755,
        ModelPixelScale: [500, 500, 0],
        ModelTiepoint: [0, 0, 0, 500000, 10000000, 0],
      }),
    )
    // The TIFF writer does not emit legacy key names; use the actual GeoNadir metadata.
    const image = await tiff.getImage()
    image.getGeoKeys = () => ({
      GTModelTypeGeoKey: 1,
      ProjectedCSTypeGeoKey: 32767,
      GeographicTypeGeoKey: 32767,
      GeogGeodeticDatumGeoKey: 32767,
      GeogAngularUnitsGeoKey: 9102,
      GeogEllipsoidGeoKey: 32767,
      GeogSemiMajorAxisGeoKey: 6378137,
      GeogInvFlatteningGeoKey: 298.257223563,
      GeogPrimeMeridianLongGeoKey: 0,
      ProjectionGeoKey: 16155,
      ProjLinearUnitsGeoKey: 9001,
    })
    const preview = await renderRaster(tiff, 2)
    expect(preview.coordinates[0][0]).toBeCloseTo(147, 4)
    expect(preview.coordinates[0][1]).toBeCloseTo(0, 4)
    expect(preview.coordinates[2][1]).toBeCloseTo(-0.0090473, 5)
    expect(preview.pixels.some((value) => value > 0)).toBe(true)
  })

  it('rejects a raster that has no georeferencing', async () => {
    const tiff = await fromArrayBuffer(
      writeArrayBuffer(new Uint8Array([1, 2, 3, 4]), { width: 2, height: 2 }),
    )
    // The writer inserts default georeferencing; remove it to represent a plain TIFF.
    const image = await tiff.getImage()
    const directory = image.getFileDirectory()
    const getValue = directory.getValue.bind(directory)
    directory.getValue = ((tag: string | number) =>
      ['ModelPixelScale', 'ModelTiepoint', 'ModelTransformation'].includes(String(tag))
        ? undefined
        : getValue(tag as never)) as typeof directory.getValue
    await expect(renderRaster(tiff, 2)).rejects.toThrow('georeferencing')
  })
})
