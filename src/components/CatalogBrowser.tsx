import { memo, useEffect, useState } from 'react'
import type { LocationProgress } from '../util/itemLocations'
import type { Entry, Page, StacDocument } from '../util/stac'
import CatalogEntry from './CatalogEntry'
import Icon from './Icon'

const EXAMPLES = [
  {
    title: 'Earth Search',
    subtitle: 'Sentinel, Landsat & more',
    url: 'https://earth-search.aws.element84.com/v1',
  },
  {
    title: 'Digital Earth Australia',
    subtitle: 'A closer look at Australia',
    url: 'https://explorer.dea.ga.gov.au/stac',
  },
]
const VISIBLE_BATCH_SIZE = 200

interface Props {
  page?: Page
  revision: number
  entries: Entry[]
  selectedKey?: string
  previousTitle?: string
  filter: string
  loading: boolean
  error: string
  notice: string
  locations?: LocationProgress
  onOpenExample: (url: string) => void
  onSelect: (entry: Entry) => void
  onBack: () => void
  onFilter: (filter: string) => void
  onJson: (document: StacDocument) => void
  onLoadMore: () => void
  onRefreshLocations: () => void
  onDismissError: () => void
  onDismissNotice: () => void
}

function ErrorNotice({
  title,
  message,
  onDismiss,
}: {
  title: string
  message: string
  onDismiss: () => void
}) {
  if (!message) return null
  return (
    <div className="error" role="alert">
      <strong>{title}</strong>
      <p>{message}</p>
      <button className="text-button" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  )
}

function LocationStatus({ progress }: { progress: LocationProgress }) {
  const label = !progress.done
    ? 'Loading item locations'
    : progress.completed < progress.total
      ? 'Location loading stopped'
      : 'Item locations loaded'
  return (
    <p className="location-progress" role="status">
      {label} · {progress.completed - progress.failed} / {progress.total}
      {progress.cached > 0 ? ` · ${progress.cached} cached` : ''}
      {progress.failed > 0 ? ` · ${progress.failed} unavailable` : ''}
    </p>
  )
}

export default memo(function CatalogBrowser({
  page,
  revision,
  entries,
  selectedKey,
  previousTitle,
  filter,
  loading,
  error,
  notice,
  locations,
  onOpenExample,
  onSelect,
  onBack,
  onFilter,
  onJson,
  onLoadMore,
  onRefreshLocations,
  onDismissError,
  onDismissNotice,
}: Props) {
  const [visibleLimit, setVisibleLimit] = useState(VISIBLE_BATCH_SIZE)
  useEffect(() => {
    setVisibleLimit(VISIBLE_BATCH_SIZE)
  }, [revision])

  const matched = page?.document.numberMatched ?? page?.document.context?.matched
  const allItems = !!page?.entries.length && page.entries.every((entry) => entry.kind === 'Item')
  const canRefreshLocations = page?.entries.some((entry) => entry.kind === 'Item' && entry.request)

  return (
    <aside className="sidebar" aria-label="Catalog browser">
      {page && (
        <div className="sidebar-top">
          <span className="eyebrow">CATALOG BROWSER</span>
          <span className="status connected">
            <i />
            {loading ? 'Loading' : 'Connected'}
          </span>
        </div>
      )}
      <ErrorNotice title="Couldn’t open that URL" message={error} onDismiss={onDismissError} />
      <ErrorNotice title="View link" message={notice} onDismiss={onDismissNotice} />
      {loading && <div className="loading-bar" role="progressbar" aria-label="Loading STAC data" />}
      {!page ? (
        <div className="welcome">
          <div className="examples">
            {EXAMPLES.map((example) => (
              <button
                className="example"
                key={example.url}
                onClick={() => onOpenExample(example.url)}
                disabled={loading}
              >
                <span className="example-icon">
                  <Icon name="layers" />
                </span>
                <span>
                  <strong>{example.title}</strong>
                  <small>{example.subtitle}</small>
                </span>
                <Icon name="arrow" size={16} />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="catalog-heading">
            {previousTitle !== undefined && (
              <button className="text-button back" onClick={onBack}>
                <Icon name="back" size={14} /> {previousTitle}
              </button>
            )}
            <h1>{page.title}</h1>
            {page.description && <p className="description">{page.description}</p>}
            <div className="catalog-actions">
              <span className="tag">
                {page.document.stac_version
                  ? `STAC ${page.document.stac_version}`
                  : allItems
                    ? 'Item collection'
                    : 'Collection listing'}
              </span>
              <button className="text-button" onClick={() => onJson(page.document)}>
                {'{ }'} View JSON
              </button>
            </div>
          </div>
          <div className="list-toolbar">
            <div className="list-title">
              <span>{allItems ? 'Items' : 'Contents'}</span>
              <span className="count">
                {page.entries.length}
                {matched !== undefined && matched > page.entries.length
                  ? ` of ${matched.toLocaleString()}`
                  : ''}
              </span>
            </div>
            <label className="filter">
              <Icon name="search" size={16} />
              <input
                aria-label="Filter loaded results"
                placeholder={`Filter loaded ${allItems ? 'items' : 'contents'}…`}
                value={filter}
                onChange={(event) => onFilter(event.target.value)}
              />
            </label>
            {locations && <LocationStatus progress={locations} />}
            {canRefreshLocations && (
              <button
                className="text-button refresh-locations"
                onClick={onRefreshLocations}
                disabled={loading || (!!locations && !locations.done)}
                title="Fetch item locations again, bypassing the 14-day browser cache"
              >
                Refresh locations
              </button>
            )}
          </div>
          <div className="entry-list" aria-busy={loading}>
            {entries.slice(0, visibleLimit).map((entry) => (
              <CatalogEntry
                key={entry.key}
                entry={entry}
                selected={selectedKey === entry.key}
                onSelect={onSelect}
              />
            ))}
            {!entries.length && (
              <div className="list-empty">
                {filter
                  ? 'No loaded results match your filter.'
                  : 'There are no items or child collections here.'}
              </div>
            )}
            {entries.length > visibleLimit && (
              <button
                className="button load-more"
                onClick={() => setVisibleLimit((limit) => limit + VISIBLE_BATCH_SIZE)}
              >
                Show more items
              </button>
            )}
            {page.next && (
              <button className="button load-more" onClick={onLoadMore} disabled={loading}>
                {loading ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
          <div className="sidebar-footer">
            <Icon name="globe" size={13} />
            <span title={page.request.url}>{new URL(page.request.url).hostname}</span>
            <span>{Math.min(entries.length, visibleLimit)} listed</span>
          </div>
        </>
      )}
    </aside>
  )
})
