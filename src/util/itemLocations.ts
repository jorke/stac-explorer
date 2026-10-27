import { entriesOf, fetchDocument } from './stac'
import type { Entry } from './stac'
import { itemLocationCache } from './itemLocationCache'
import type { ItemLocationCache } from './itemLocationCache'

export interface LocationProgress {
  completed: number
  total: number
  failed: number
  done: boolean
  cached: number
}

/** Resolve static catalog item links with bounded concurrency and batched UI updates. */
export async function loadItemLocations(
  entries: Entry[],
  signal: AbortSignal,
  onBatch: (entries: Entry[], progress: LocationProgress) => void,
  options: { forceRefresh?: boolean; cache?: ItemLocationCache } = {},
): Promise<void> {
  const queue = entries.filter(
    (entry) => entry.kind === 'Item' && (!entry.document || options.forceRefresh) && entry.request,
  )
  const cache = options.cache ?? itemLocationCache
  const progress = { completed: 0, total: queue.length, failed: 0, done: false, cached: 0 }
  let cursor = 0
  let batch: Entry[] = []
  let lastFlush = 0
  let consecutiveFailures = 0
  function flush() {
    if (signal.aborted) return
    onBatch(batch, { ...progress })
    batch = []
    lastFlush = Date.now()
  }
  async function worker() {
    while (cursor < queue.length && !signal.aborted && consecutiveFailures < 12) {
      const entry = queue[cursor++]
      try {
        let result = options.forceRefresh
          ? undefined
          : await cache.get(entry.request!).catch(() => undefined)
        if (signal.aborted) return
        if (result) {
          progress.cached++
        } else {
          try {
            result = await fetchDocument(
              entry.request!,
              AbortSignal.any([signal, AbortSignal.timeout(15000)]),
            )
          } catch (error) {
            if (signal.aborted) throw error
            result = await fetchDocument(
              entry.request!,
              AbortSignal.any([signal, AbortSignal.timeout(15000)]),
            )
          }
          if (signal.aborted) return
          if (result.document.type !== 'Feature')
            throw new Error('The item link did not return an item.')
          await cache.put(entry.request!, result).catch(() => {})
        }
        if (signal.aborted) return
        if (result.document.type !== 'Feature')
          throw new Error('The item link did not return an item.')
        const resolved = entriesOf(result.document, result.request.url, result.request)[0]
        batch.push({ ...entry, ...resolved, key: entry.key })
        consecutiveFailures = 0
      } catch {
        if (signal.aborted) return
        progress.failed++
        consecutiveFailures++
      }
      progress.completed++
      if (batch.length >= 100 || Date.now() - lastFlush > 500) flush()
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker))
  progress.done = true
  flush()
}
