import { describe, expect, it } from 'vitest'
import { buildViewLink, DEFAULT_MAP_VIEW, readViewLink } from './viewLink'
import { decodeBinaryView, encodeBinaryView } from './viewLinkBinary'
import {
  decodeViewBytes,
  encodeViewBytes,
  encodeViewPayload,
  MAX_VIEW_BYTES,
} from './viewLinkCodec'
import { compactView } from './viewLinkState'
import { entriesOf } from './stac'
import type { MapViewState, SharedView } from './viewLinkState'
import type { Page, Request, StacDocument } from './stac'

const catalog = 'https://data.geonadir.com/stac/collections/geonadir-fair-data/collection.json'
const id = '19528-8f7a8bd4-f5d9-46a6-a6fb-beddb86568df'
const request: Request = { url: catalog, method: 'GET' }
const selection = {
  id,
  request: { url: new URL(`items/${id}.json`, catalog).href, method: 'GET' as const },
  collection: 'geonadir-fair-data',
}
const map: MapViewState = {
  ...DEFAULT_MAP_VIEW,
  center: [145.96971407611989, -16.602578883928814],
  zoom: 22,
  assetId: 'ortho',
}
const view: SharedView = {
  version: 1,
  request,
  extraRequests: [],
  selection,
  map,
  filter: '',
}

function roundTrip(value: SharedView): SharedView {
  return decodeBinaryView(decodeViewBytes(encodeViewBytes(encodeBinaryView(value))))
}

function pageFor(value: SharedView): { page: Page; item: StacDocument } {
  const item: StacDocument = {
    type: 'Feature',
    stac_version: '1.1.0',
    id: value.selection?.id,
    collection: value.selection?.collection,
    links: value.selection ? [{ rel: 'self', href: value.selection.request.url }] : [],
  }
  const document: StacDocument = { type: 'FeatureCollection', features: [item] }
  return {
    page: {
      title: 'Test',
      document,
      entries: entriesOf(document, request.url),
      request: value.request,
    },
    item,
  }
}

describe('version 3 binary view links', () => {
  it('continues to decode the frozen version 3 format', () => {
    const token = 'eNoBLADT_w0EAAECyJgBj3qL1PXZRqam-77duGVo3wEBQGI_B-XQbPzAMJpCnBe8BBYBt-QTlQ'
    expect(readViewLink(`https://viewer.example.com/#v=3.${token}`).view).toEqual(view)
  })

  it('keeps the GeoNadir token under 80 characters without dropping any state', () => {
    const { page } = pageFor(view)
    const link = buildViewLink('http://127.0.0.1:5177/', page, page.entries[0], map, '')
    const token = new URL(link).hash.slice('#v=3.'.length)
    const previous = encodeViewPayload(compactView(view))
    expect(link).toContain('#v=3.')
    expect(token.length).toBeLessThanOrEqual(80)
    expect(token.length).toBeLessThan(previous.length * 0.35)
    expect(link.length).toBeLessThanOrEqual(107)
    expect(readViewLink(link).view).toEqual(view)
  })

  it('preserves precise Float64 camera values, all settings, Unicode, and literal assets', () => {
    const precise: SharedView = {
      ...view,
      filter: '树林 & mangroves 🌏',
      map: {
        center: [145.96971407611989, -16.602578883928814],
        zoom: 22.000000000000004,
        bearing: -179.99999999999997,
        pitch: 44.99999999999999,
        imageryOpacity: 0.0000000000001,
        boundsOpacity: 99.99999999999999,
        imageryEnabled: false,
        showPins: false,
        assetId: '海拔:高程',
      },
    }
    expect(roundTrip(precise)).toEqual(precise)
    const negativeZero = {
      ...precise,
      map: { ...precise.map, center: [-0, -0] as [number, number], zoom: -0, bearing: -0 },
    }
    const restored = roundTrip(negativeZero)
    expect(Object.is(restored.map.center[0], -0)).toBe(true)
    expect(Object.is(restored.map.zoom, -0)).toBe(true)
    expect(Object.is(restored.map.bearing, -0)).toBe(true)
    const { page } = pageFor(negativeZero)
    const link = buildViewLink(
      'https://viewer.example.com',
      page,
      page.entries[0],
      negativeZero.map,
      '',
    )
    expect(link).toContain('#v=3.')
    expect(Object.is(readViewLink(link).view?.map.zoom, -0)).toBe(true)
  })

  it('preserves POST bodies, distinct selected requests, signatures, and loaded pages', () => {
    const root: Request = {
      url: 'https://example.com/search?signature=a%2Bb%2Fc',
      method: 'POST',
      body: {
        collections: ['drone'],
        filter: { op: 'and', args: [{ cloud: { lte: 20 } }, false] },
        token: null,
      },
    }
    const saved: SharedView = {
      ...view,
      request: root,
      selection: {
        ...selection,
        request: { ...root, body: { ...root.body, ids: [id], token: 'selected-page' } },
      },
      extraRequests: [
        { ...root, body: { ...root.body, token: 'page-two' } },
        {
          url: 'https://example.com/items?cursor=page%20three&signature=keep%2Bexact',
          method: 'GET',
        },
      ],
    }
    expect(roundTrip(saved)).toEqual(saved)
    const sameSource = { ...saved, selection: { ...selection, request: root } }
    expect(roundTrip(sameSource)).toEqual(sameSource)
  })

  it('uses frozen URL presets while preserving arbitrary catalogs and assets', () => {
    for (const url of [
      catalog,
      'https://planetarycomputer.microsoft.com/api/stac/v1',
      'https://example.com/collections/drone',
    ]) {
      for (const assetId of [
        'ortho',
        'dsm',
        'dem',
        'dtm',
        'visual',
        'rgb',
        'image',
        '',
        'other-asset',
      ]) {
        const saved = {
          ...view,
          request: { url, method: 'GET' as const },
          map: { ...map, assetId },
        }
        expect(roundTrip(saved)).toEqual(saved)
      }
    }
  })

  it('packs UUIDs only when their spelling and numeric prefix round-trip exactly', () => {
    for (const savedId of [
      id,
      id.toUpperCase(),
      '8f7a8bd4-f5d9-46a6-a6fb-beddb86568df',
      '8F7A8BD4-F5D9-46A6-A6FB-BEDDB86568DF',
      '019528-8f7a8bd4-f5d9-46a6-a6fb-beddb86568df',
      '0-8f7a8bd4-f5d9-46a6-a6fb-beddb86568df',
      '9007199254740991-8f7a8bd4-f5d9-46a6-a6fb-beddb86568df',
      '9007199254740992-8f7a8bd4-f5d9-46a6-a6fb-beddb86568df',
      'scene #2 & 山/🌏',
      'plain-item-id',
      '',
    ]) {
      const saved = { ...view, selection: { ...selection, id: savedId } }
      expect(roundTrip(saved)).toEqual(saved)
    }
  })

  it('derives item URLs and collection names only on exact string matches', () => {
    const cases = [
      { url: new URL(`items/${id}.json`, catalog).href, collection: 'geonadir-fair-data' },
      { url: new URL(`${id}.json`, catalog).href, collection: undefined },
      { url: new URL(`items/${id}`, catalog).href, collection: 'other' },
      {
        url: `${new URL(`items/${id}.json`, catalog).href}?signature=a%2Bb`,
        collection: 'GEONADIR-FAIR-DATA',
      },
      { url: 'https://example.com/other/item.json', collection: '' },
    ]
    for (const { url, collection } of cases) {
      const saved = {
        ...view,
        selection: {
          id,
          request: { url, method: 'GET' as const },
          ...(collection === undefined ? {} : { collection }),
        },
      }
      expect(roundTrip(saved)).toEqual(saved)
    }
  })

  it('omits defaults while preserving empty optional strings', () => {
    const saved: SharedView = {
      version: 1,
      request,
      extraRequests: [],
      map: DEFAULT_MAP_VIEW,
      filter: '',
    }
    expect(roundTrip(saved)).toEqual(saved)
    expect(encodeBinaryView(saved)).toHaveLength(4)
    const emptyAsset = { ...saved, map: { ...DEFAULT_MAP_VIEW, assetId: '' } }
    expect(roundTrip(emptyAsset)).toEqual(emptyAsset)
  })

  it('rejects truncated data, unknown flags, unused bytes, and invalid presets', () => {
    const valid = encodeBinaryView(view)
    const unknownFlags = valid.slice()
    unknownFlags[1] |= 128
    const unknownPreset = valid.slice()
    unknownPreset[3] = 3
    for (const bytes of [
      new Uint8Array(),
      valid.slice(0, 1),
      valid.slice(0, -1),
      Uint8Array.from([...valid, 0]),
      unknownFlags,
      unknownPreset,
      // Literal URL claims more bytes than are available.
      Uint8Array.from([0, 0, 0, 0, 127]),
      // Non-canonical and out-of-range varints.
      Uint8Array.from([0, 0, 0, 128, 0]),
      Uint8Array.from([0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 1]),
      // Invalid UTF-8 in a literal URL.
      Uint8Array.from([0, 0, 0, 0, 1, 255]),
    ]) {
      expect(() => decodeBinaryView(bytes)).toThrow()
      expect(
        readViewLink(`https://viewer.example.com/#v=3.${encodeViewBytes(bytes)}`).error,
      ).toBeTruthy()
    }
  })

  it('rejects unsafe URLs, invalid map values, and oversized binary data', () => {
    for (const invalid of [
      {
        ...view,
        request: { url: 'javascript:alert(1)', method: 'GET' as const },
        selection: undefined,
      },
      { ...view, map: { ...map, zoom: 25 } },
      { ...view, map: { ...map, center: [Number.NaN, 0] as [number, number] } },
      { ...view, extraRequests: new Array(101).fill(request) },
    ]) {
      expect(() => decodeBinaryView(encodeBinaryView(invalid))).toThrow()
    }
    expect(() => decodeBinaryView(new Uint8Array(MAX_VIEW_BYTES + 1))).toThrow('too large')
    expect(() => encodeBinaryView({ ...view, filter: 'x'.repeat(MAX_VIEW_BYTES) })).toThrow(
      'too large',
    )
  })

  it('rejects invalid UUID/request/collection discriminators and number tags', () => {
    // Minimal request: flags, GET, GeoNadir preset. Followed by selected item.
    for (const bytes of [
      [1, 0, 0, 1, 3], // Unknown ID representation.
      [1, 0, 0, 1, 0, 1, 97, 5], // Unknown selection request representation.
      [1, 0, 0, 1, 0, 1, 97, 0, 3], // Unknown collection representation.
      [0, 0, 2, 1], // Unknown HTTP method.
      [8, 0, 0, 1, 201], // Reserved number tag.
    ]) {
      expect(() => decodeBinaryView(Uint8Array.from(bytes))).toThrow()
    }
  })

  it('preserves old JSON links and falls back for unpaired Unicode code units', () => {
    const version2 = `https://viewer.example.com/#v=2.${encodeViewPayload(compactView(view))}`
    expect(readViewLink(version2).view).toEqual(view)
    const legacy = `https://viewer.example.com/#${new URLSearchParams({ view: JSON.stringify(view) })}`
    expect(readViewLink(legacy).view).toEqual(view)
    const { page } = pageFor(view)
    const link = buildViewLink('https://viewer.example.com', page, page.entries[0], map, '\ud800')
    expect(link).toContain('#v=2.')
    expect(readViewLink(link).view?.filter).toBe('\ud800')
  })
})
