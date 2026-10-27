import { describe, expect, it } from 'vitest'
import { catalogReducer, initialCatalogState } from './catalogState'
import type { CatalogState } from './catalogState'
import type { Entry, Page } from './stac'

const first: Entry = {
  key: 'first',
  title: 'First item',
  kind: 'Item',
  baseUrl: 'https://example.com/catalog.json',
  request: { url: 'https://example.com/first.json' },
}
const second: Entry = {
  ...first,
  key: 'second',
  title: 'Second item',
  request: { url: 'https://example.com/second.json' },
}
const resolved: Entry = {
  ...first,
  document: {
    type: 'Feature',
    id: 'first',
    stac_version: '1.0.0',
    geometry: { type: 'Point', coordinates: [150, -30] },
  },
}
const page: Page = {
  title: 'Catalog',
  document: { type: 'Catalog', stac_version: '1.0.0' },
  entries: [first],
  request: { url: 'https://example.com/catalog.json' },
}

function openedPage(): CatalogState {
  return catalogReducer(initialCatalogState(), {
    type: 'loaded',
    page,
    request: page.request,
    mode: 'root',
    zoomToItem: false,
  })
}

describe('catalog navigation', () => {
  it('does not select or zoom to the first item when opening a catalog', () => {
    const state = openedPage()
    expect(state.selected).toBeUndefined()
    expect(state.zoomRequest).toBeUndefined()
  })

  it('only requests item zoom when selection explicitly comes from the list', () => {
    const listed = catalogReducer(openedPage(), {
      type: 'select',
      entry: resolved,
      zoomToItem: true,
    })
    const repeated = catalogReducer(listed, { type: 'select', entry: resolved, zoomToItem: true })
    expect(listed.zoomRequest?.entry).toBe(resolved)
    expect(repeated.zoomRequest).not.toBe(listed.zoomRequest)

    const mapClicked = catalogReducer(repeated, {
      type: 'select',
      entry: resolved,
      zoomToItem: false,
    })
    expect(mapClicked.selected).toBe(resolved)
    expect(mapClicked.zoomRequest).toBeUndefined()
  })

  it('preserves locations resolved while a subsequent results page was loading', () => {
    let state = catalogReducer(openedPage(), { type: 'loading' })
    state = catalogReducer(state, {
      type: 'locations',
      entries: [resolved],
      revision: state.revision,
      refreshSelection: false,
    })
    const nextRequest = { url: 'https://example.com/catalog.json?page=2' }
    state = catalogReducer(state, {
      type: 'loaded',
      page: { ...page, entries: [second], request: nextRequest },
      request: nextRequest,
      mode: 'more',
      zoomToItem: false,
    })
    expect(state.page?.entries).toEqual([resolved, second])
    expect(state.page?.entries[0]).toBe(resolved)
    expect(state.page?.extraRequests).toEqual([nextRequest])
  })

  it('ignores location results from an earlier visit to the same catalog URL', () => {
    const previous = openedPage()
    const current = catalogReducer(previous, {
      type: 'loaded',
      page,
      request: page.request,
      mode: 'root',
      zoomToItem: false,
    })
    const updated = catalogReducer(current, {
      type: 'locations',
      entries: [resolved],
      revision: previous.revision,
      refreshSelection: false,
    })
    expect(updated).toBe(current)
    expect(updated.page?.entries[0].document).toBeUndefined()
  })

  it('refreshes selected metadata while preserving other entry references and camera state', () => {
    let state = catalogReducer(openedPage(), {
      type: 'loaded',
      page: { ...page, entries: [first, second] },
      request: page.request,
      mode: 'root',
      zoomToItem: false,
    })
    state = catalogReducer(state, { type: 'select', entry: first, zoomToItem: false })
    const updated = catalogReducer(state, {
      type: 'locations',
      entries: [resolved],
      revision: state.revision,
      refreshSelection: true,
    })
    expect(updated.selected).toBe(resolved)
    expect(updated.page?.entries[1]).toBe(second)
    expect(updated.zoomRequest).toBeUndefined()
  })

  it('restores saved selection and filters without asking the map to recenter', () => {
    const restored = catalogReducer(initialCatalogState(), {
      type: 'restored',
      page,
      selected: resolved,
      filter: 'first',
      warning: 'Some saved pages were unavailable.',
    })
    expect(restored.selected).toBe(resolved)
    expect(restored.filter).toBe('first')
    expect(restored.notice).toBe('Some saved pages were unavailable.')
    expect(restored.zoomRequest).toBeUndefined()
  })

  it('returns to the previous catalog without an item selection or zoom request', () => {
    const childPage: Page = { ...page, document: resolved.document!, entries: [resolved] }
    const child = catalogReducer(openedPage(), {
      type: 'loaded',
      page: childPage,
      request: first.request!,
      mode: 'child',
      zoomToItem: true,
    })
    expect(child.zoomRequest?.entry).toBe(resolved)
    const previous = catalogReducer(child, { type: 'back' })
    expect(previous.page).toBe(page)
    expect(previous.selected).toBeUndefined()
    expect(previous.zoomRequest).toBeUndefined()
  })
})
