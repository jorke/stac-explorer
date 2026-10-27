import { useCallback, useEffect, useReducer, useRef } from 'react'
import { catalogReducer, initialCatalogState } from '../util/catalogState'
import type { NavigationMode } from '../util/catalogState'
import { httpUrl, loadPage } from '../util/stac'
import type { Entry, Request, StacDocument } from '../util/stac'
import { restoreView } from '../util/viewLink'
import type { SharedView } from '../util/viewLink'

interface InitialCatalog {
  url: string
  view?: SharedView
  error?: string
}

const REQUEST_TIMEOUT_MS = 30_000

export function useCatalogNavigation(initial: InitialCatalog, onRootUrl: (url: string) => void) {
  const [state, dispatch] = useReducer(catalogReducer, initial.error, initialCatalogState)
  const pending = useRef<AbortController | null>(null)

  const cancelPending = useCallback(() => {
    pending.current?.abort()
    pending.current = null
  }, [])

  const open = useCallback(
    async (request: Request, mode: NavigationMode, inline?: StacDocument, zoomToItem = false) => {
      cancelPending()
      const controller = new AbortController()
      pending.current = controller
      dispatch({ type: 'loading' })
      const timer = window.setTimeout(() => controller.abort('timeout'), REQUEST_TIMEOUT_MS)

      try {
        const normalized = { ...request, url: httpUrl(request.url) }
        const next = await loadPage(normalized, controller.signal, inline)
        if (pending.current !== controller) return
        dispatch({ type: 'loaded', page: next, request: normalized, mode, zoomToItem })

        if (mode === 'root') {
          onRootUrl(normalized.url)
          const address = new URL(window.location.href)
          address.searchParams.set('url', normalized.url)
          address.hash = ''
          window.history.replaceState(null, '', address)
        }
      } catch (cause) {
        if (pending.current !== controller) return
        if (controller.signal.reason === 'timeout') {
          dispatch({
            type: 'failed',
            error: 'This endpoint took more than 30 seconds to respond. Try again.',
          })
        } else if (!controller.signal.aborted) {
          dispatch({
            type: 'failed',
            error: cause instanceof Error ? cause.message : 'Could not load this STAC document.',
          })
        }
      } finally {
        window.clearTimeout(timer)
        if (pending.current === controller) dispatch({ type: 'finished' })
      }
    },
    [cancelPending, onRootUrl],
  )

  useEffect(() => {
    if (!initial.view) {
      if (initial.url) void open({ url: initial.url }, 'root')
      return cancelPending
    }

    const view = initial.view
    const controller = new AbortController()
    pending.current = controller
    dispatch({ type: 'loading' })
    const timer = window.setTimeout(() => controller.abort('timeout'), REQUEST_TIMEOUT_MS)

    void restoreView(view, controller.signal)
      .then((restored) => {
        if (pending.current !== controller) return
        dispatch({ type: 'restored', ...restored, filter: view.filter })
      })
      .catch((cause) => {
        if (pending.current !== controller) return
        if (controller.signal.reason === 'timeout') {
          dispatch({ type: 'failed', error: 'The shared view took too long to load. Try again.' })
        } else if (!controller.signal.aborted) {
          dispatch({
            type: 'failed',
            error: cause instanceof Error ? cause.message : 'Could not restore the shared view.',
          })
        }
      })
      .finally(() => {
        window.clearTimeout(timer)
        if (pending.current === controller) dispatch({ type: 'finished' })
      })

    return () => {
      window.clearTimeout(timer)
      cancelPending()
    }
  }, [initial, open, cancelPending])

  const choose = useCallback(
    (entry: Entry, zoomToItem = false) => {
      if (entry.kind === 'Item' && entry.document) {
        cancelPending()
        dispatch({ type: 'select', entry, zoomToItem })
      } else {
        void open(
          entry.request ?? { url: entry.baseUrl },
          'child',
          entry.document,
          zoomToItem && entry.kind === 'Item',
        )
      }
    },
    [cancelPending, open],
  )

  const chooseFromList = useCallback((entry: Entry) => choose(entry, true), [choose])
  const back = useCallback(() => {
    cancelPending()
    dispatch({ type: 'back' })
  }, [cancelPending])
  const closeSelection = useCallback(() => dispatch({ type: 'close-selection' }), [])
  const setFilter = useCallback((value: string) => dispatch({ type: 'filter', value }), [])
  const dismissError = useCallback(() => dispatch({ type: 'dismiss-error' }), [])
  const setNotice = useCallback((value: string) => dispatch({ type: 'notice', value }), [])
  const resolveLocations = useCallback(
    (entries: Entry[], revision: number, refreshSelection: boolean) => {
      dispatch({ type: 'locations', entries, revision, refreshSelection })
    },
    [],
  )

  return {
    ...state,
    open,
    choose,
    chooseFromList,
    back,
    closeSelection,
    setFilter,
    dismissError,
    setNotice,
    resolveLocations,
  }
}
