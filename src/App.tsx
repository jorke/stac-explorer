import { useCallback, useMemo, useRef, useState } from 'react'
import MapView from './MapView'
import type { MapViewHandle } from './MapView'
import CatalogBrowser from './components/CatalogBrowser'
import { JsonDialog, ShareDialog } from './components/Dialogs'
import ExplorerHeader from './components/ExplorerHeader'
import ItemInspector from './components/ItemInspector'
import { useCatalogNavigation } from './hooks/useCatalogNavigation'
import { useItemLocations } from './hooks/useItemLocations'
import { useViewSharing } from './hooks/useViewSharing'
import type { StacDocument } from './util/stac'
import { readViewLink } from './util/viewLink'

export default function App() {
  const [initial] = useState(() => readViewLink(window.location.href))
  const [url, setUrl] = useState(initial.url)
  const [json, setJson] = useState<StacDocument>()
  const [overlayControlsContainer, setOverlayControlsContainer] = useState<HTMLDivElement | null>(
    null,
  )
  const mapView = useRef<MapViewHandle | null>(null)

  const catalog = useCatalogNavigation(initial, setUrl)
  const { page, selected, filter, open, setNotice } = catalog
  const locations = useItemLocations({
    page,
    revision: catalog.revision,
    onResolved: catalog.resolveLocations,
  })
  const sharing = useViewSharing({ page, selected, filter, mapView, onNotice: setNotice })

  const entries = useMemo(() => {
    const query = filter.toLowerCase()
    const loadedEntries = page?.entries ?? []
    if (!query) return loadedEntries
    return loadedEntries.filter((entry) =>
      `${entry.title} ${entry.document?.id ?? ''} ${entry.description ?? ''}`
        .toLowerCase()
        .includes(query),
    )
  }, [page?.entries, filter])

  const explore = useCallback(() => {
    if (url.trim()) void open({ url: url.trim() }, 'root')
  }, [url, open])
  const openExample = useCallback(
    (exampleUrl: string) => {
      setUrl(exampleUrl)
      void open({ url: exampleUrl }, 'root')
    },
    [open],
  )
  const loadMore = useCallback(() => {
    if (page?.next) void open(page.next, 'more')
  }, [page?.next, open])
  const dismissNotice = useCallback(() => setNotice(''), [setNotice])
  const closeJson = useCallback(() => setJson(undefined), [])

  return (
    <div className="app">
      <ExplorerHeader
        url={url}
        loading={catalog.loading}
        canShare={!!page}
        copyStatus={sharing.copyStatus}
        onUrlChange={setUrl}
        onExplore={explore}
        onCopyView={sharing.copyView}
      />
      <main className={`workspace${selected ? ' has-selection' : ''}`}>
        <CatalogBrowser
          page={page}
          revision={catalog.revision}
          entries={entries}
          selectedKey={selected?.key}
          previousTitle={catalog.history.at(-1)?.title}
          filter={filter}
          loading={catalog.loading}
          error={catalog.error}
          notice={catalog.notice}
          locations={locations.progress}
          onOpenExample={openExample}
          onSelect={catalog.chooseFromList}
          onBack={catalog.back}
          onFilter={catalog.setFilter}
          onJson={setJson}
          onLoadMore={loadMore}
          onRefreshLocations={locations.refresh}
          onDismissError={catalog.dismissError}
          onDismissNotice={dismissNotice}
        />
        <MapView
          entries={entries}
          selected={selected}
          onSelect={catalog.choose}
          zoomRequest={catalog.zoomRequest}
          controlsContainer={overlayControlsContainer}
          initialView={initial.view?.map}
          viewRef={mapView}
        />
        {selected?.document && (
          <ItemInspector
            entry={selected}
            onClose={catalog.closeSelection}
            onJson={setJson}
            overlayControlsRef={setOverlayControlsContainer}
          />
        )}
      </main>
      {json && <JsonDialog document={json} onClose={closeJson} />}
      {sharing.shareLink && (
        <ShareDialog link={sharing.shareLink} onClose={sharing.closeShareDialog} />
      )}
    </div>
  )
}
