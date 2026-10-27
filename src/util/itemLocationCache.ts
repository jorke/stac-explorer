import { httpUrl, validateDocument } from './stac'
import type { Request, StacDocument } from './stac'

export const ITEM_LOCATION_TTL_MS = 14 * 24 * 60 * 60 * 1000
const DATABASE_NAME = 'stac-explorer-item-locations'
const STORE = 'items'
const STORAGE_TIMEOUT_MS = 3000

export interface CachedItem {
  document: StacDocument
  request: Request
}

interface CacheRecord {
  key: string
  version: 1
  fetchedAt: number
  expiresAt: number
  value: CachedItem
}

export interface ItemLocationCache {
  get: (request: Request) => Promise<CachedItem | undefined>
  put: (request: Request, value: CachedItem) => Promise<void>
  close: () => Promise<void>
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    )
  }
  return value
}

export function itemLocationCacheKey(request: Request): string {
  const url = new URL(httpUrl(request.url))
  url.hash = ''
  const method = request.method ?? 'GET'
  return JSON.stringify([
    method,
    url.href,
    method === 'POST' ? canonical(request.body ?? {}) : null,
  ])
}

export function createItemLocationCache(
  options: { factory?: IDBFactory; databaseName?: string; now?: () => number } = {},
): ItemLocationCache {
  let connection: Promise<IDBDatabase | null> | undefined
  let writesDisabled = false
  const now = options.now ?? Date.now

  function prune(db: IDBDatabase) {
    try {
      const transaction = db.transaction(STORE, 'readwrite')
      const cutoff = now()
      const request = transaction.objectStore(STORE).index('expiresAt').openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor || Number(cursor.key) > cutoff) return
        cursor.delete()
        cursor.continue()
      }
      // Expiry is also checked on every read; pruning is only storage maintenance.
      transaction.onerror = () => {}
    } catch {
      /* Browser storage is best effort. */
    }
  }

  function open(): Promise<IDBDatabase | null> {
    if (connection) return connection
    connection = new Promise((resolve) => {
      let finished = false
      const finish = (db: IDBDatabase | null) => {
        if (finished) {
          db?.close()
          return
        }
        finished = true
        clearTimeout(timer)
        resolve(db)
      }
      const timer = setTimeout(() => finish(null), STORAGE_TIMEOUT_MS)
      try {
        const factory = options.factory ?? globalThis.indexedDB
        if (!factory) {
          finish(null)
          return
        }
        const request = factory.open(options.databaseName ?? DATABASE_NAME, 1)
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore(STORE, { keyPath: 'key' })
          store.createIndex('expiresAt', 'expiresAt')
        }
        request.onsuccess = () => {
          const db = request.result
          if (finished) {
            db.close()
            return
          }
          db.onversionchange = () => {
            db.close()
            connection = undefined
          }
          prune(db)
          finish(db)
        }
        request.onerror = () => finish(null)
        request.onblocked = () => finish(null)
      } catch {
        finish(null)
      }
    })
    return connection
  }

  async function operation<T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T | undefined> {
    const db = await open()
    if (!db) return
    return new Promise((resolve) => {
      let transaction: IDBTransaction | undefined
      let value: T | undefined
      let finished = false
      const finish = (result?: T) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        resolve(result)
      }
      const timer = setTimeout(() => {
        try {
          transaction?.abort()
        } catch {
          /* Already complete. */
        }
        finish()
      }, STORAGE_TIMEOUT_MS)
      try {
        transaction = db.transaction(STORE, mode)
        const request = action(transaction.objectStore(STORE))
        request.onsuccess = () => {
          value = request.result
        }
        transaction.oncomplete = () => finish(value)
        transaction.onabort = () => finish()
        transaction.onerror = () => finish()
      } catch {
        finish()
      }
    })
  }

  return {
    async get(request) {
      let key: string
      try {
        key = itemLocationCacheKey(request)
      } catch {
        return
      }
      const record = await operation<CacheRecord>('readonly', (store) => store.get(key))
      if (!record) return
      try {
        const timestamp = now()
        if (
          record.version !== 1 ||
          record.key !== key ||
          !Number.isFinite(record.fetchedAt) ||
          record.expiresAt !== record.fetchedAt + ITEM_LOCATION_TTL_MS ||
          timestamp < record.fetchedAt ||
          timestamp >= record.expiresAt
        )
          throw new Error('Expired cache record.')
        validateDocument(record.value.document)
        if (record.value.document.type !== 'Feature') throw new Error('Not an item.')
        httpUrl(record.value.request.url)
        return record.value
      } catch {
        await operation('readwrite', (store) => store.delete(key))
        return
      }
    },
    async put(request, value) {
      if (writesDisabled) return
      try {
        validateDocument(value.document)
        if (value.document.type !== 'Feature') return
        httpUrl(value.request.url)
        const key = itemLocationCacheKey(request)
        const fetchedAt = now()
        const record: CacheRecord = {
          key,
          version: 1,
          fetchedAt,
          expiresAt: fetchedAt + ITEM_LOCATION_TTL_MS,
          value,
        }
        // Wait for the transaction to commit, not just for the put request to succeed.
        const written = await operation('readwrite', (store) => store.put(record))
        if (written === undefined) writesDisabled = true
      } catch {
        /* A cache failure must never prevent catalog browsing. */
      }
    },
    async close() {
      const db = await connection
      db?.close()
      connection = undefined
      writesDisabled = false
    },
  }
}

export const itemLocationCache = createItemLocationCache()
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    void itemLocationCache.close()
  })
