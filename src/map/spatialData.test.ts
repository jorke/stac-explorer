import { describe, expect, it } from 'vitest'
import { boundsOf } from '../util/stac'
import type { Entry } from '../util/stac'
import { createSpatialDataBuilder } from './spatialData'

const first: Entry = {
  key: 'one',
  kind: 'Item',
  title: 'One',
  baseUrl: 'https://example.com/one.json',
  document: { type: 'Feature', id: 'one', bbox: [140, -40, 150, -30] },
}
const pending: Entry = {
  key: 'two',
  kind: 'Item',
  title: 'Two',
  baseUrl: 'https://example.com/two.json',
  request: { url: 'https://example.com/two.json' },
}

describe('map spatial data', () => {
  it('adds clickable locations as metadata arrives without recalculating existing footprints', () => {
    const build = createSpatialDataBuilder()
    const before = build([first, pending])
    const resolved: Entry = {
      ...pending,
      document: {
        type: 'Feature',
        id: 'two',
        geometry: { type: 'Point', coordinates: [151, -33] },
      },
    }
    const after = build([first, resolved])

    expect(before.centroids.features).toHaveLength(1)
    expect(after.centroids.features).toHaveLength(2)
    expect(after.centroids.features[1]).toMatchObject({
      properties: { key: pending.key },
      geometry: { type: 'Point', coordinates: [151, -33] },
    })
    expect(after.footprints.features[0]).toBe(before.footprints.features[0])
    expect(after.centroids.features[0]).toBe(before.centroids.features[0])
    expect(after.entriesByKey.get('two')).toBe(resolved)
  })

  it('updates filtered bounds and clears map features when no entries match', () => {
    const build = createSpatialDataBuilder()
    const second: Entry = { ...pending, document: { bbox: [0, 0, 10, 10] } }
    expect(boundsOf(build([first, second]).footprints.features)).toEqual([
      [0, -40],
      [150, 10],
    ])
    const filtered = build([second])
    expect(boundsOf(filtered.footprints.features)).toEqual([
      [0, 0],
      [10, 10],
    ])
    expect(filtered.entriesByKey.has(first.key)).toBe(false)

    const empty = build([])
    expect(empty.footprints.features).toEqual([])
    expect(empty.centroids.features).toEqual([])
  })

  it('does not send unchanged geometry to map workers for unlocated metadata updates', () => {
    const build = createSpatialDataBuilder()
    const before = build([first, pending])
    const after = build([
      first,
      { ...pending, title: 'Updated title', document: { type: 'Feature', id: 'two' } },
    ])
    expect(after.footprints).toBe(before.footprints)
    expect(after.centroids).toBe(before.centroids)
    expect(after.entriesByKey.get('two')?.title).toBe('Updated title')
  })

  it('uses new geometry when a cached item is replaced after refresh', () => {
    const build = createSpatialDataBuilder()
    build([first])
    const refreshed: Entry = { ...first, document: { ...first.document, bbox: [10, 20, 30, 40] } }
    const after = build([refreshed])
    expect(boundsOf(after.footprints.features)).toEqual([
      [10, 20],
      [30, 40],
    ])
    expect(after.centroids.features[0].geometry).toEqual({ type: 'Point', coordinates: [20, 30] })
  })
})
