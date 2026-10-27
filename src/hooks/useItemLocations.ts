import { useCallback, useEffect, useRef, useState } from 'react'
import type { LocationProgress } from '../util/itemLocations'
import type { Entry, Page } from '../util/stac'
import { createLocationLoadingSession } from './locationLoadingSession'

interface Options {
  page?: Page
  revision: number
  onResolved: (entries: Entry[], revision: number, refreshSelection: boolean) => void
}

export function useItemLocations({ page, revision, onResolved }: Options) {
  const [progress, setProgress] = useState<LocationProgress>()
  const [refreshVersion, setRefreshVersion] = useState(0)
  const refreshRevision = useRef<number | undefined>(undefined)
  const session = useRef<ReturnType<typeof createLocationLoadingSession> | undefined>(undefined)

  useEffect(() => {
    const forceRefresh = refreshRevision.current === revision
    refreshRevision.current = undefined
    setProgress(undefined)
    const controller = new AbortController()
    session.current = createLocationLoadingSession({
      signal: controller.signal,
      forceRefresh,
      onBatch: (entries, nextProgress) => {
        setProgress(nextProgress)
        onResolved(entries, revision, forceRefresh)
      },
    })
    return () => {
      controller.abort()
      session.current = undefined
    }
  }, [revision, refreshVersion, onResolved])

  useEffect(() => {
    session.current?.update(page?.entries ?? [])
  }, [page?.entries, revision, refreshVersion, onResolved])

  const refresh = useCallback(() => {
    refreshRevision.current = revision
    setRefreshVersion((value) => value + 1)
  }, [revision])

  return { progress, refresh }
}
