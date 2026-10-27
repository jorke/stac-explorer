import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bboxGeometry,
  boundsOf,
  centroidOf,
  centroidsOf,
  entriesOf,
  featuresOf,
  httpUrl,
  linkRequest,
  loadPage,
  mergeEntries,
  safeUrl,
  validateDocument,
} from './stac'
import type { StacDocument } from './stac'

afterEach(() => vi.unstubAllGlobals())

const item: StacDocument = {
  type: 'Feature',
  stac_version: '1.0.0',
  id: 'scene',
  collection: 'sentinel',
  geometry: { type: 'Point', coordinates: [151, -33] },
  properties: { datetime: null },
  assets: { thumbnail: { href: './preview.png' } },
  links: [],
}

describe('STAC document navigation', () => {
  it('resolves static relative links against the response URL', () => {
    const entries = entriesOf(
      {
        type: 'Catalog',
        links: [
          { rel: 'child', href: '../collection.json' },
          { rel: 'item', href: './scene.json' },
        ],
      },
      'https://example.com/stac/nested/catalog.json',
    )
    expect(entries.map((e) => e.request?.url)).toEqual([
      'https://example.com/stac/collection.json',
      'https://example.com/stac/nested/scene.json',
    ])
  })

  it('uses an embedded item self URL for relative assets', () => {
    const [entry] = entriesOf(
      {
        type: 'FeatureCollection',
        features: [{ ...item, links: [{ rel: 'self', href: './items/scene.json' }] }],
      },
      'https://example.com/stac/search',
    )
    expect(safeUrl('./preview.png', entry.baseUrl)).toBe(
      'https://example.com/stac/items/preview.png',
    )
  })

  it('discovers collections at a STAC API landing page and resolves next links', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          type: 'Catalog',
          stac_version: '1.0.0',
          title: 'Earth data',
          links: [{ rel: 'data', href: '/collections' }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          collections: [{ type: 'Collection', stac_version: '1.0.0', id: 'optical', links: [] }],
          links: [{ rel: 'next', href: '?page=2' }],
        }),
      )
    vi.stubGlobal('fetch', fetch)
    const page = await loadPage({ url: 'https://example.com/' }, new AbortController().signal)
    expect(page.title).toBe('Earth data')
    expect(page.entries[0].title).toBe('optical')
    expect(page.next?.url).toBe('https://example.com/collections?page=2')
    expect(fetch.mock.calls[1][0]).toBe('https://example.com/collections')
  })

  it('opens items from inline collections without refetching the collection', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ type: 'FeatureCollection', features: [item] }))
    vi.stubGlobal('fetch', fetch)
    const page = await loadPage(
      { url: 'https://example.com/collections/optical' },
      new AbortController().signal,
      {
        type: 'Collection',
        stac_version: '1.0.0',
        title: 'Optical',
        links: [{ rel: 'items', href: './optical/items' }],
      },
    )
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe('https://example.com/collections/optical/items')
    expect(page.entries[0].kind).toBe('Item')
  })

  it('preserves POST search criteria when next links request merging', () => {
    const next = linkRequest(
      { rel: 'next', href: './search', method: 'POST', body: { token: 'next' }, merge: true },
      {
        url: 'https://example.com/search',
        method: 'POST',
        body: { collections: ['optical'], limit: 10 },
      },
    )
    expect(next.body).toEqual({ collections: ['optical'], limit: 10, token: 'next' })
    expect(next.method).toBe('POST')
  })

  it('replaces POST bodies when merge is absent and defaults links to GET', () => {
    expect(
      linkRequest(
        { rel: 'next', href: '?page=2', method: 'POST', body: { page: 2 } },
        { url: 'https://example.com/search', body: { token: 'old' } },
      ).body,
    ).toEqual({ page: 2 })
    expect(
      linkRequest(
        { rel: 'next', href: '?page=2' },
        { url: 'https://example.com/search', method: 'POST' },
      ).method,
    ).toBe('GET')
  })

  it('deduplicates pages while preserving identically named items in different collections', () => {
    const first = entriesOf(
      { type: 'FeatureCollection', features: [item] },
      'https://example.com/search',
    )
    const second = entriesOf(
      { type: 'FeatureCollection', features: [item, { ...item, collection: 'landsat' }] },
      'https://example.com/search',
    )
    expect(mergeEntries(first, second)).toHaveLength(2)
  })

  it('uses the final response URL after redirects', async () => {
    const response = Response.json({
      type: 'Catalog',
      stac_version: '1.0.0',
      links: [{ rel: 'child', href: './child.json' }],
    })
    Object.defineProperty(response, 'url', { value: 'https://example.com/catalog/catalog.json' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    const page = await loadPage(
      { url: 'https://example.com/redirect' },
      new AbortController().signal,
    )
    expect(page.entries[0].request?.url).toBe('https://example.com/catalog/child.json')
  })
})

describe('errors and untrusted data', () => {
  it('rejects unsupported URLs and ordinary JSON', () => {
    expect(() => httpUrl('file:///etc/passwd')).toThrow()
    expect(() => httpUrl('https://user:password@example.com')).toThrow()
    expect(safeUrl('javascript:alert(1)', 'https://example.com')).toBeUndefined()
    expect(() => validateDocument({ hello: 'world' })).toThrow()
    expect(() => validateDocument({ type: 'FeatureCollection', features: [null] })).toThrow()
  })

  it('reports HTTP failures separately from browser/CORS failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })))
    await expect(
      loadPage({ url: 'https://example.com' }, new AbortController().signal),
    ).rejects.toThrow('HTTP 404')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(
      loadPage({ url: 'https://example.com' }, new AbortController().signal),
    ).rejects.toThrow('CORS')
  })
})

describe('spatial footprints', () => {
  it('creates clickable item centroids from polygons and bounding boxes', () => {
    const entries = entriesOf(
      {
        type: 'FeatureCollection',
        features: [{ ...item, geometry: null, bbox: [140, -40, 150, -30] }],
      },
      'https://example.com',
    )
    expect(centroidsOf(entries).features[0]).toMatchObject({
      geometry: { type: 'Point', coordinates: [145, -35] },
      properties: { key: entries[0].key },
    })
    expect(centroidOf({ bbox: [170, -10, -170, 10] })).toEqual([-180, 0])
    expect(centroidOf({})).toBeUndefined()
  })

  it('weights polygon areas rather than just averaging vertices', () => {
    const centroid = centroidOf({
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
              [0, 0],
            ],
          ],
          [
            [
              [2, 0],
              [4, 0],
              [4, 2],
              [2, 2],
              [2, 0],
            ],
          ],
        ],
      },
    })
    expect(centroid?.[0]).toBeCloseTo(2.5)
    expect(centroid?.[1]).toBeCloseTo(0.9)
  })

  it('shows collection extents and 3D bboxes using longitude and latitude', () => {
    const entries = entriesOf(
      {
        collections: [
          {
            type: 'Collection',
            id: 'a',
            extent: { spatial: { bbox: [[140, -40, 0, 150, -30, 100]] } },
          },
        ],
      },
      'https://example.com',
    )
    expect(boundsOf(featuresOf(entries).features)).toEqual([
      [140, -40],
      [150, -30],
    ])
  })

  it('handles antimeridian bounding boxes and missing geometry', () => {
    expect(bboxGeometry([170, -10, -170, 10])).toMatchObject({
      coordinates: [
        [
          [170, -10],
          [190, -10],
          [190, 10],
          [170, 10],
          [170, -10],
        ],
      ],
    })
    expect(
      featuresOf(
        entriesOf(
          { type: 'FeatureCollection', features: [{ ...item, geometry: null }] },
          'https://example.com',
        ),
      ).features,
    ).toEqual([])
    expect(bboxGeometry([0, NaN, 10, 20])).toBeNull()
  })
})
