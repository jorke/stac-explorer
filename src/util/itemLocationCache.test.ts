import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import {
  createItemLocationCache,
  ITEM_LOCATION_TTL_MS,
  itemLocationCacheKey,
} from './itemLocationCache'
import type { CachedItem, ItemLocationCache } from './itemLocationCache'
import { loadItemLocations } from './itemLocations'
import { entriesOf } from './stac'
import type { Entry, Request } from './stac'

const caches: ItemLocationCache[] = []
afterEach(async () => {
  await Promise.all(caches.splice(0).map((cache) => cache.close()))
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function cacheWith(factory = new IDBFactory(), now = () => Date.now()) {
  const cache = createItemLocationCache({ factory, now, databaseName: 'cache-test' })
  caches.push(cache)
  return cache
}

const request: Request = { url: 'https://example.com/items/scene.json' }
const item: CachedItem = {
  request: { url: 'https://example.com/redirected/scene.json' },
  document: {
    type: 'Feature',
    stac_version: '1.1.0',
    id: 'scene',
    collection: 'drone',
    geometry: { type: 'Point', coordinates: [145, -16] },
    properties: { title: 'Original title', datetime: '2026-10-26T00:00:00Z' },
    assets: { visual: { href: './image.tif' } },
  },
}
const entry: Entry = {
  key: 'static-link-0',
  title: 'scene.json',
  kind: 'Item',
  baseUrl: 'https://example.com/catalog.json',
  request,
}

describe('14-day item cache', () => {
  it('persists metadata across cache connections, preserving redirected asset bases', async () => {
    const factory = new IDBFactory()
    const first = cacheWith(factory)
    await first.put(request, item)
    await first.close()
    const restored = await cacheWith(factory).get(request)
    expect(restored).toEqual(item)
    expect(entriesOf(restored!.document, restored!.request.url)[0].baseUrl).toBe(item.request.url)
  })

  it('expires at exactly 14 days without extending the TTL on reads', async () => {
    let now = 1000
    const cache = cacheWith(new IDBFactory(), () => now)
    await cache.put(request, item)
    now += ITEM_LOCATION_TTL_MS - 1
    expect(await cache.get(request)).toEqual(item)
    now++
    expect(await cache.get(request)).toBeUndefined()
    now--
    expect(await cache.get(request)).toBeUndefined()
  })

  it('prunes expired records when a new connection opens', async () => {
    const factory = new IDBFactory()
    let now = 1000
    const first = cacheWith(factory, () => now)
    await first.put(request, item)
    await first.close()
    now += ITEM_LOCATION_TTL_MS
    const second = cacheWith(factory, () => now)
    expect(await second.get(request)).toBeUndefined()
    now--
    expect(await second.get(request)).toBeUndefined()
  })

  it('keys the complete request and canonicalizes POST body ordering', () => {
    expect(itemLocationCacheKey(request)).toBe(
      itemLocationCacheKey({ ...request, method: 'GET', url: request.url + '#fragment' }),
    )
    const post: Request = {
      ...request,
      method: 'POST',
      body: { filter: { b: 2, a: 1 }, ids: ['one', 'two'] },
    }
    expect(itemLocationCacheKey(post)).toBe(
      itemLocationCacheKey({ ...post, body: { ids: ['one', 'two'], filter: { a: 1, b: 2 } } }),
    )
    expect(itemLocationCacheKey(post)).not.toBe(itemLocationCacheKey(request))
    expect(itemLocationCacheKey(post)).not.toBe(
      itemLocationCacheKey({ ...post, body: { ids: ['two', 'one'] } }),
    )
  })

  it('rejects corrupted records and never caches non-item documents', async () => {
    const factory = new IDBFactory()
    const cache = cacheWith(factory)
    await cache.put(request, {
      ...item,
      document: { type: 'Catalog', stac_version: '1.1.0', links: [] },
    })
    expect(await cache.get(request)).toBeUndefined()
    await cache.put(request, item)
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = factory.open('cache-test', 1)
      opening.onsuccess = () => resolve(opening.result)
      opening.onerror = () => reject(opening.error)
    })
    const fetchedAt = Date.now()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('items', 'readwrite')
      transaction.objectStore('items').put({
        key: itemLocationCacheKey(request),
        version: 1,
        fetchedAt,
        expiresAt: fetchedAt + ITEM_LOCATION_TTL_MS,
        value: { ...item, document: { type: 'Feature', stac_version: '1.1.0', links: [null] } },
      })
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error)
    })
    expect(await cache.get(request)).toBeUndefined()
    db.close()
  })
})

describe('cached location loading', () => {
  it('avoids fetches on repeated loads and refetches when the TTL expires', async () => {
    let now = 1000
    const cache = cacheWith(new IDBFactory(), () => now)
    const fetch = vi.fn().mockImplementation(async () => Response.json(item.document))
    vi.stubGlobal('fetch', fetch)
    const batches = vi.fn()
    await loadItemLocations([entry], new AbortController().signal, batches, { cache })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(batches.mock.lastCall?.[1].cached).toBe(0)
    batches.mockClear()
    await loadItemLocations([entry], new AbortController().signal, batches, { cache })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(batches.mock.lastCall?.[1]).toEqual({
      total: 1,
      completed: 1,
      failed: 0,
      cached: 1,
      done: true,
    })
    expect(batches.mock.calls.flatMap(([entries]) => entries)[0].key).toBe(entry.key)
    now += ITEM_LOCATION_TTL_MS
    await loadItemLocations([entry], new AbortController().signal, batches, { cache })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(batches.mock.lastCall?.[1].cached).toBe(0)
  })

  it('refreshes already-loaded entries and replaces the cached metadata', async () => {
    const cache = cacheWith()
    await cache.put(request, item)
    const updated = {
      ...item.document,
      properties: { title: 'Updated title' },
      geometry: { type: 'Point', coordinates: [146, -17] },
    }
    const fetch = vi.fn().mockResolvedValue(Response.json(updated))
    vi.stubGlobal('fetch', fetch)
    const batches = vi.fn()
    await loadItemLocations(
      [{ ...entry, document: item.document }],
      new AbortController().signal,
      batches,
      { cache, forceRefresh: true },
    )
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(batches.mock.lastCall?.[1].cached).toBe(0)
    expect((await cache.get(request))?.document.properties?.title).toBe('Updated title')
  })

  it('falls back to the network when storage cannot open', async () => {
    const unavailable = {
      open: () => {
        throw new DOMException('Blocked', 'SecurityError')
      },
    } as unknown as IDBFactory
    const cache = cacheWith(unavailable)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(item.document)))
    const batches = vi.fn()
    await loadItemLocations([entry], new AbortController().signal, batches, { cache })
    expect(batches.mock.lastCall?.[1]).toEqual({
      total: 1,
      completed: 1,
      failed: 0,
      cached: 0,
      done: true,
    })
  })

  it('continues browsing when the cache runs out of space', async () => {
    const cache = cacheWith()
    // Open the database before injecting the write failure.
    await cache.get(request)
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError')
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(item.document)))
    const batches = vi.fn()
    await loadItemLocations([entry], new AbortController().signal, batches, { cache })
    expect(batches.mock.lastCall?.[1].failed).toBe(0)
    expect(await cache.get(request)).toBeUndefined()
  })

  it('does not cache failed requests or publish cached results after cancellation', async () => {
    const cache = cacheWith()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })))
    const batches = vi.fn()
    await loadItemLocations([entry], new AbortController().signal, batches, { cache })
    expect(batches.mock.lastCall?.[1].failed).toBe(1)
    expect(await cache.get(request)).toBeUndefined()
    const controller = new AbortController()
    const abortedCache: ItemLocationCache = {
      get: async () => {
        controller.abort()
        return item
      },
      put: vi.fn(),
      close: async () => {},
    }
    batches.mockClear()
    await loadItemLocations([entry], controller.signal, batches, { cache: abortedCache })
    expect(batches).not.toHaveBeenCalled()
    expect(abortedCache.put).not.toHaveBeenCalled()
  })
})
