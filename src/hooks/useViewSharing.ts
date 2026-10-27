import { useCallback, useEffect, useState } from 'react'
import type { RefObject } from 'react'
import type { MapViewHandle } from '../MapView'
import type { Entry, Page } from '../util/stac'
import { buildViewLink, DEFAULT_MAP_VIEW } from '../util/viewLink'

interface Options {
  page?: Page
  selected?: Entry
  filter: string
  mapView: RefObject<MapViewHandle | null>
  onNotice: (message: string) => void
}

export function useViewSharing({ page, selected, filter, mapView, onNotice }: Options) {
  const [shareLink, setShareLink] = useState('')
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copying' | 'copied'>('idle')

  useEffect(() => {
    if (copyStatus !== 'copied') return
    const timer = window.setTimeout(() => setCopyStatus('idle'), 2500)
    return () => window.clearTimeout(timer)
  }, [copyStatus])

  const copyView = useCallback(async () => {
    if (!page) return
    onNotice('')
    setCopyStatus('copying')
    try {
      const link = buildViewLink(
        window.location.href,
        page,
        selected,
        mapView.current?.getView() ?? DEFAULT_MAP_VIEW,
        filter,
      )
      window.history.replaceState(null, '', link)
      try {
        await navigator.clipboard.writeText(link)
        setCopyStatus('copied')
      } catch {
        setShareLink(link)
        setCopyStatus('idle')
      }
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : 'Could not create a view link.')
      setCopyStatus('idle')
    }
  }, [page, selected, filter, mapView, onNotice])

  const closeShareDialog = useCallback(() => setShareLink(''), [])
  return { shareLink, copyStatus, copyView, closeShareDialog }
}
