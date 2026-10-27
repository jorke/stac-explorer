import { afterEach, expect, it, vi } from 'vitest'
import { loadItemLocations } from './itemLocations'
import type { Entry } from './stac'

afterEach(() => vi.unstubAllGlobals())

const links: Entry[] = Array.from({ length: 20 }, (_, i) => ({
  key: `link-${i}`,
  title: `item-${i}`,
  kind: 'Item',
  baseUrl: 'https://example.com/catalog.json',
  request: { url: `https://example.com/items/${i}.json` },
}))

it('loads static item metadata in bounded parallel batches and preserves clickable keys', async () => {
  let active = 0,
    peak = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active--
      return Response.json({
        type: 'Feature',
        stac_version: '1.1.0',
        id: url,
        geometry: { type: 'Point', coordinates: [145, -16] },
      })
    }),
  )
  const batches = vi.fn()
  await loadItemLocations(links, new AbortController().signal, batches)
  const resolved = batches.mock.calls.flatMap(([entries]) => entries)
  expect(resolved).toHaveLength(20)
  expect(peak).toBeLessThanOrEqual(6)
  expect(new Set(resolved.map((entry) => entry.key))).toEqual(
    new Set(links.map((entry) => entry.key)),
  )
  expect(resolved[0].document.geometry.type).toBe('Point')
  expect(batches.mock.lastCall?.[1]).toEqual({
    completed: 20,
    total: 20,
    failed: 0,
    done: true,
    cached: 0,
  })
})

it('stops repeated failures and does not publish updates after cancellation', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
  const batches = vi.fn()
  await loadItemLocations(links, new AbortController().signal, batches)
  expect(batches.mock.lastCall?.[1].done).toBe(true)
  expect(batches.mock.lastCall?.[1].failed).toBeLessThan(20)
  const aborted = new AbortController()
  aborted.abort()
  batches.mockClear()
  await loadItemLocations(links, aborted.signal, batches)
  expect(batches).not.toHaveBeenCalled()
})

it('retries a transient failure before marking an item unavailable', async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce(
      Response.json({
        type: 'Feature',
        stac_version: '1.1.0',
        id: 'recovered',
        geometry: { type: 'Point', coordinates: [145, -16] },
      }),
    )
  vi.stubGlobal('fetch', fetch)
  const batches = vi.fn()
  await loadItemLocations(links.slice(0, 1), new AbortController().signal, batches)
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(batches.mock.lastCall?.[1]).toEqual({
    completed: 1,
    total: 1,
    failed: 0,
    done: true,
    cached: 0,
  })
})
