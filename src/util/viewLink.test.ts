import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildViewLink, DEFAULT_MAP_VIEW, readViewLink, restoreView } from './viewLink'
import { decodeViewPayload, encodeViewPayload } from './viewLinkCodec'
import { compactView } from './viewLinkState'
import { entriesOf } from './stac'
import type { Page, StacDocument } from './stac'

afterEach(() => vi.unstubAllGlobals())

const item: StacDocument = {
  type: 'Feature',
  stac_version: '1.1.0',
  id: 'scene #2 & coast',
  collection: 'drone',
  geometry: { type: 'Point', coordinates: [145, -16] },
  assets: { dsm: { href: 'https://example.com/private-asset?token=do-not-copy' } },
  links: [{ rel: 'self', href: 'https://example.com/items/scene-2.json' }],
}
const page: Page = {
  title: 'Drone imagery',
  document: { type: 'FeatureCollection', features: [item] },
  entries: entriesOf(
    { type: 'FeatureCollection', features: [item] },
    'https://example.com/collections/drone/items',
  ),
  request: { url: 'https://example.com/collections/drone/items' },
  browseRequest: { url: 'https://example.com/collections/drone' },
}

describe('view links', () => {
  it('round-trips the camera, selection, asset, filter and all display settings', () => {
    const map = {
      ...DEFAULT_MAP_VIEW,
      center: [145.12345, -16.98765] as [number, number],
      zoom: 19.5,
      bearing: -32,
      pitch: 45,
      assetId: 'dsm',
      imageryEnabled: false,
      imageryOpacity: 0,
      boundsOpacity: 0,
      showPins: false,
    }
    const link = buildViewLink(
      'https://viewer.example.com/?old=unused',
      page,
      page.entries[0],
      map,
      'coast & mangroves',
    )
    const restored = readViewLink(link)
    expect(restored.error).toBeUndefined()
    expect(restored.url).toBe(page.browseRequest?.url)
    expect(restored.view?.map).toEqual(map)
    expect(restored.view?.selection?.id).toBe(item.id)
    expect(restored.view?.filter).toBe('coast & mangroves')
    expect(link).not.toContain('do-not-copy')
    expect(new URL(link).searchParams.has('old')).toBe(false)
    expect(new URL(link).search).toBe('')
    expect(new URL(link).hash).toMatch(/^#v=[23]\.[\w-]+$/)
  })

  it('makes a portable selected-item link less than half the previous length', () => {
    const map = {
      ...DEFAULT_MAP_VIEW,
      center: [145.123456789, -16.987654321] as [number, number],
      zoom: 19.123456789,
      assetId: 'dsm',
    }
    const link = buildViewLink('https://viewer.example.com/', page, page.entries[0], map, 'coast')
    const view = readViewLink(link).view!
    const legacy = new URL('https://viewer.example.com/')
    legacy.searchParams.set('url', view.request.url)
    legacy.hash = new URLSearchParams({ view: JSON.stringify(view) }).toString()
    expect(link.length).toBeLessThan(legacy.href.length / 2)
    // The token contains all state; a browser with empty local storage can restore it.
    expect(readViewLink(link).view?.map).toEqual(map)
  })

  it('omits default settings, empty pages, and the redundant source query parameter', () => {
    const link = buildViewLink(
      'https://viewer.example.com/?url=old#view=old',
      page,
      undefined,
      DEFAULT_MAP_VIEW,
      '',
    )
    const location = new URL(link)
    expect(location.search).toBe('')
    const view = readViewLink(link).view!
    expect(decodeViewPayload(encodeViewPayload(compactView(view)))).toEqual({
      r: page.browseRequest?.url,
    })
    expect(readViewLink(link).view?.map).toEqual(DEFAULT_MAP_VIEW)
  })

  it('keeps legacy STAC URL links working and rejects malformed or unsafe state', () => {
    expect(readViewLink('https://viewer.example.com/?url=https%3A%2F%2Fexample.com')).toEqual({
      url: 'https://example.com',
    })
    expect(readViewLink('https://viewer.example.com/#view=not-json').error).toBeTruthy()
    const valid = readViewLink(
      buildViewLink('https://viewer.example.com', page, undefined, DEFAULT_MAP_VIEW, ''),
    ).view!
    const legacy = `https://viewer.example.com/#${new URLSearchParams({ view: JSON.stringify(valid) })}`
    expect(readViewLink(legacy).view).toEqual(valid)
    const version2 = `https://viewer.example.com/#v=2.${encodeViewPayload(compactView(valid))}`
    expect(readViewLink(version2).view).toEqual(valid)
    for (const request of [
      { url: 'javascript:alert(1)' },
      { url: 'https://example.com', method: 'DELETE' },
    ]) {
      expect(
        readViewLink(
          `https://viewer.example.com/#${new URLSearchParams({ view: JSON.stringify({ ...valid, request }) })}`,
        ).error,
      ).toBeTruthy()
    }
    expect(
      readViewLink(
        `https://viewer.example.com/#${new URLSearchParams({ view: JSON.stringify({ ...valid, map: { ...valid.map, zoom: -1 } }) })}`,
      ).error,
    ).toBeTruthy()
  })

  it('rejects malformed compact requests, map values, selections, and page lists', () => {
    const valid = { r: 'https://example.com/catalog.json' }
    for (const payload of [
      null,
      [],
      { r: 'javascript:alert(1)' },
      { r: ['https://example.com/search', null] },
      { r: ['https://example.com/search', {}, 'extra'] },
      { ...valid, m: { c: [1, 2, 3] } },
      { ...valid, m: { z: 25 } },
      { ...valid, m: { o: -1 } },
      { ...valid, m: { i: 0 } },
      { ...valid, m: { a: 12 } },
      { ...valid, s: ['item'] },
      { ...valid, s: ['item', 'https://example.com/item', null] },
      { ...valid, p: new Array(101).fill('https://example.com/page') },
      { ...valid, f: 'x'.repeat(1001) },
    ]) {
      const link = `https://viewer.example.com/#v=2.${encodeViewPayload(payload)}`
      expect(readViewLink(link).error).toBeTruthy()
    }
    for (const fragment of ['v=3.abc', 'v=2.', 'v=2.%', 'v=2.a', 'view=']) {
      expect(
        readViewLink(`https://viewer.example.com/?url=https://example.com/fallback#${fragment}`),
      ).toMatchObject({
        url: 'https://example.com/fallback',
        error: expect.any(String),
      })
    }
  })

  it('preserves POST request bodies for selected items without self links', () => {
    const request = {
      url: 'https://example.com/search',
      method: 'POST' as const,
      body: { collections: ['drone'], token: 'page-2' },
    }
    const selected = entriesOf(
      { type: 'FeatureCollection', features: [{ ...item, links: [] }] },
      request.url,
      request,
    )[0]
    const view = readViewLink(
      buildViewLink('https://viewer.example.com', page, selected, DEFAULT_MAP_VIEW, ''),
    ).view!
    expect(view.selection?.request).toEqual(request)
  })

  it('preserves a selected item self link with a POST body', () => {
    const request = {
      url: 'https://example.com/catalog/search',
      method: 'POST' as const,
      body: { collections: ['drone'] },
    }
    const document = {
      ...item,
      links: [
        {
          rel: 'self',
          href: './items/lookup',
          method: 'POST',
          body: { ids: [item.id] },
          merge: true,
        },
      ],
    }
    const selected = entriesOf(
      { type: 'FeatureCollection', features: [document] },
      request.url,
      request,
    )[0]
    const view = readViewLink(
      buildViewLink('https://viewer.example.com', page, selected, DEFAULT_MAP_VIEW, ''),
    ).view!
    expect(view.selection?.request).toEqual({
      url: 'https://example.com/catalog/items/lookup',
      method: 'POST',
      body: { collections: ['drone'], ids: [item.id] },
    })
  })

  it('resolves relative self links once, using the source response or canonical fallback', () => {
    const document = { ...item, links: [{ rel: 'self', href: './items/one.json' }] }
    const selected = entriesOf(
      { type: 'FeatureCollection', features: [document] },
      'https://example.com/catalog/list.json',
    )[0]
    for (const entry of [selected, { ...selected, sourceRequest: undefined }]) {
      const view = readViewLink(
        buildViewLink('https://viewer.example.com', page, entry, DEFAULT_MAP_VIEW, ''),
      ).view!
      expect(view.selection?.request).toEqual({
        url: 'https://example.com/catalog/items/one.json',
        method: 'GET',
      })
    }
  })

  it('round-trips Unicode, POST searches, signed request URLs, and every loaded page', () => {
    const request = {
      url: 'https://example.com/search?signature=keep%2Bthis%2Fvalue&limit=10',
      method: 'POST' as const,
      body: {
        collections: ['drone'],
        filter: { op: 'and', args: [{ cloud: { lte: 20 } }, { enabled: false }] },
        token: null,
      },
    }
    const document = { ...item, id: '山 ⛰️ #2', collection: '无人机', links: [] }
    const selected = entriesOf(
      { type: 'FeatureCollection', features: [document] },
      request.url,
      request,
    )[0]
    const extraRequests = [
      { ...request, body: { ...request.body, token: 'page-two' } },
      { url: 'https://example.com/search?cursor=page%20three', method: 'GET' as const },
    ]
    const source = { ...page, browseRequest: request, extraRequests }
    const view = readViewLink(
      buildViewLink(
        'https://viewer.example.com',
        source,
        selected,
        { ...DEFAULT_MAP_VIEW, assetId: 'elevación' },
        '树林',
      ),
    ).view!
    expect(view.request).toEqual(request)
    expect(view.extraRequests).toEqual(extraRequests)
    expect(view.selection).toEqual({ id: document.id, collection: document.collection, request })
    expect(view.filter).toBe('树林')
    expect(view.map.assetId).toBe('elevación')
  })

  it('rejects a saved search body too large for a bounded link', () => {
    const source = {
      ...page,
      browseRequest: {
        url: page.request.url,
        method: 'POST' as const,
        body: { query: 'x'.repeat(32_000) },
      },
    }
    expect(() =>
      buildViewLink('https://viewer.example.com', source, undefined, DEFAULT_MAP_VIEW, ''),
    ).toThrow('Too many loaded pages')
  })

  it('restores an item outside the first results page without issuing a zoom request', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ type: 'FeatureCollection', features: [] }))
        .mockResolvedValueOnce(Response.json(item)),
    )
    const view = readViewLink(
      buildViewLink('https://viewer.example.com', page, page.entries[0], DEFAULT_MAP_VIEW, ''),
    ).view!
    const restored = await restoreView(view, new AbortController().signal)
    expect(restored.selected?.document?.id).toBe(item.id)
    expect(restored.page.entries).toHaveLength(1)
    expect(restored).not.toHaveProperty('zoomRequest')
    expect(restored.warning).toBeUndefined()
  })

  it('reuses static item-link keys and restores extra result pages', async () => {
    const staticPage: Page = {
      ...page,
      browseRequest: { url: 'https://example.com/catalog.json' },
      extraRequests: [{ url: 'https://example.com/page-2.json' }],
    }
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            type: 'Catalog',
            stac_version: '1.1.0',
            links: [{ rel: 'item', href: './items/scene-2.json' }],
          }),
        )
        .mockResolvedValueOnce(Response.json({ type: 'FeatureCollection', features: [] }))
        .mockResolvedValueOnce(Response.json(item)),
    )
    const view = readViewLink(
      buildViewLink(
        'https://viewer.example.com',
        staticPage,
        page.entries[0],
        DEFAULT_MAP_VIEW,
        '',
      ),
    ).view!
    const restored = await restoreView(view, new AbortController().signal)
    expect(restored.page.entries).toHaveLength(1)
    expect(restored.selected?.key).toBe('./items/scene-2.json-0')
    expect(restored.page.extraRequests).toEqual([
      { url: 'https://example.com/page-2.json', method: 'GET' },
    ])
  })

  it('keeps the catalog usable when a saved selection disappears', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ type: 'FeatureCollection', features: [] }))
        .mockResolvedValueOnce(new Response('', { status: 404 })),
    )
    const view = readViewLink(
      buildViewLink('https://viewer.example.com', page, page.entries[0], DEFAULT_MAP_VIEW, ''),
    ).view!
    const restored = await restoreView(view, new AbortController().signal)
    expect(restored.selected).toBeUndefined()
    expect(restored.warning).toContain('could not be reopened')
    expect(restored.page.document.type).toBe('FeatureCollection')
  })
})
