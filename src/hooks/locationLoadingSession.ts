import { loadItemLocations } from '../util/itemLocations'
import type { LocationProgress } from '../util/itemLocations'
import type { Entry } from '../util/stac'

interface Options {
  signal: AbortSignal
  forceRefresh: boolean
  onBatch: (entries: Entry[], progress: LocationProgress) => void
  load?: typeof loadItemLocations
}

/**
 * Keep one queue for a catalog visit or explicit refresh. Pagination extends
 * the queue without cancelling work or fetching the same item twice.
 */
export function createLocationLoadingSession({
  signal,
  forceRefresh,
  onBatch,
  load = loadItemLocations,
}: Options) {
  const attempted = new Set<string>()
  const queued = new Map<string, Entry>()
  let active = false
  let totals = { completed: 0, failed: 0, cached: 0 }
  let current = { ...totals }

  function publish(entries: Entry[], done: boolean) {
    if (signal.aborted) return
    onBatch(entries, { ...current, total: attempted.size, done })
  }

  async function drain() {
    if (active || signal.aborted) return
    active = true
    while (queued.size && !signal.aborted) {
      const entries = Array.from(queued.values())
      queued.clear()
      await load(
        entries,
        signal,
        (resolved, progress) => {
          current = {
            completed: totals.completed + progress.completed,
            failed: totals.failed + progress.failed,
            cached: totals.cached + progress.cached,
          }
          // More items may arrive before this batch's promise has settled.
          publish(resolved, false)
        },
        { forceRefresh },
      )
      totals = { ...current }
    }
    active = false
    publish([], true)
  }

  function update(entries: Entry[]) {
    if (signal.aborted) return
    let added = false
    for (const entry of entries) {
      if (entry.kind !== 'Item' || !entry.request || attempted.has(entry.key)) continue
      if (entry.document && !forceRefresh) continue
      attempted.add(entry.key)
      queued.set(entry.key, entry)
      added = true
    }
    if (!added) return
    publish([], false)
    void drain()
  }

  return { update }
}
