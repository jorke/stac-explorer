import { describe, expect, it, vi } from 'vitest'
import type { loadItemLocations, LocationProgress } from '../util/itemLocations'
import type { Entry } from '../util/stac'
import { createLocationLoadingSession } from './locationLoadingSession'

function item(key: string, resolved = false): Entry {
  return {
    key,
    title: key,
    kind: 'Item',
    baseUrl: `https://example.com/${key}.json`,
    request: { url: `https://example.com/${key}.json` },
    ...(resolved ? { document: { type: 'Feature', id: key, stac_version: '1.0.0' } } : {}),
  }
}

function controlledLoader() {
  const batches: {
    entries: Entry[]
    signal: AbortSignal
    emit: (entries: Entry[], progress: LocationProgress) => void
    finish: () => void
    forceRefresh?: boolean
  }[] = []
  const load = vi.fn<typeof loadItemLocations>(
    (entries, signal, onBatch, options) =>
      new Promise<void>((resolve) => {
        batches.push({
          entries,
          signal,
          emit: onBatch,
          finish: resolve,
          forceRefresh: options?.forceRefresh,
        })
      }),
  )
  return { batches, load }
}

describe('location loading sessions', () => {
  it('continues a forced refresh across pagination without repeating refreshed items', async () => {
    const { batches, load } = controlledLoader()
    const progress: LocationProgress[] = []
    const resolved: Entry[] = []
    const controller = new AbortController()
    const session = createLocationLoadingSession({
      signal: controller.signal,
      forceRefresh: true,
      load,
      onBatch: (entries, value) => {
        resolved.push(...entries)
        progress.push(value)
      },
    })

    session.update([item('one', true), item('two', true)])
    batches[0].emit([item('one', true)], {
      completed: 1,
      failed: 0,
      cached: 0,
      total: 2,
      done: false,
    })
    session.update([item('one', true), item('two', true), item('three', true)])

    expect(load).toHaveBeenCalledTimes(1)
    expect(controller.signal.aborted).toBe(false)
    expect(progress.at(-1)).toMatchObject({ completed: 1, total: 3, done: false })

    batches[0].emit([item('two', true)], {
      completed: 2,
      failed: 0,
      cached: 0,
      total: 2,
      done: true,
    })
    batches[0].finish()
    await vi.waitFor(() => expect(batches).toHaveLength(2))
    expect(batches[1].entries.map((entry) => entry.key)).toEqual(['three'])
    expect(batches.every((batch) => batch.forceRefresh)).toBe(true)

    batches[1].emit([item('three', true)], {
      completed: 1,
      failed: 0,
      cached: 0,
      total: 1,
      done: true,
    })
    batches[1].finish()
    await vi.waitFor(() => expect(progress.at(-1)?.done).toBe(true))
    session.update([item('one', true), item('two', true), item('three', true)])

    expect(load).toHaveBeenCalledTimes(2)
    expect(resolved.map((entry) => entry.key)).toEqual(['one', 'two', 'three'])
    expect(progress.at(-1)).toEqual({ completed: 3, total: 3, failed: 0, cached: 0, done: true })
  })

  it('keeps cumulative progress when a later page arrives after the initial scan finishes', async () => {
    const { batches, load } = controlledLoader()
    const onBatch = vi.fn()
    const session = createLocationLoadingSession({
      signal: new AbortController().signal,
      forceRefresh: false,
      load,
      onBatch,
    })
    session.update([item('one')])
    batches[0].emit([item('one', true)], {
      completed: 1,
      total: 1,
      failed: 0,
      cached: 1,
      done: true,
    })
    batches[0].finish()
    await vi.waitFor(() => expect(onBatch.mock.lastCall?.[1].done).toBe(true))

    session.update([item('one', true), item('two')])
    expect(batches[1].entries.map((entry) => entry.key)).toEqual(['two'])
    batches[1].emit([item('two', true)], {
      completed: 1,
      total: 1,
      failed: 0,
      cached: 0,
      done: true,
    })
    batches[1].finish()
    await vi.waitFor(() => expect(onBatch.mock.lastCall?.[1].done).toBe(true))
    expect(onBatch.mock.lastCall?.[1]).toEqual({
      completed: 2,
      total: 2,
      failed: 0,
      cached: 1,
      done: true,
    })
  })

  it('drops queued work and late callbacks when navigating away', async () => {
    const { batches, load } = controlledLoader()
    const onBatch = vi.fn()
    const controller = new AbortController()
    const session = createLocationLoadingSession({
      signal: controller.signal,
      forceRefresh: true,
      load,
      onBatch,
    })
    session.update([item('one', true)])
    session.update([item('one', true), item('two', true)])
    controller.abort()
    onBatch.mockClear()
    batches[0].emit([item('one', true)], {
      completed: 1,
      total: 1,
      failed: 0,
      cached: 0,
      done: true,
    })
    batches[0].finish()
    await Promise.resolve()
    session.update([item('three', true)])

    expect(onBatch).not.toHaveBeenCalled()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('does not silently retry failed items when unrelated metadata changes', async () => {
    const { batches, load } = controlledLoader()
    const onBatch = vi.fn()
    const session = createLocationLoadingSession({
      signal: new AbortController().signal,
      forceRefresh: false,
      load,
      onBatch,
    })
    session.update([item('one'), item('two')])
    batches[0].emit([item('one', true)], {
      completed: 2,
      total: 2,
      failed: 1,
      cached: 0,
      done: true,
    })
    batches[0].finish()
    await vi.waitFor(() => expect(onBatch.mock.lastCall?.[1].done).toBe(true))
    session.update([item('one', true), item('two')])
    expect(load).toHaveBeenCalledTimes(1)
    expect(onBatch.mock.lastCall?.[1]).toEqual({
      completed: 2,
      total: 2,
      failed: 1,
      cached: 0,
      done: true,
    })
  })
})
