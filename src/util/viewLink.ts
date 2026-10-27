import { entriesOf, fetchDocument, linkRequest, loadPage, mergeEntries, safeUrl } from './stac'
import {
  decodeViewBytes,
  decodeViewPayload,
  encodeViewBytes,
  encodeViewPayload,
  MAX_VIEW_BYTES,
} from './viewLinkCodec'
import { decodeBinaryView, encodeBinaryView } from './viewLinkBinary'
import { compactView, expandView, validateView } from './viewLinkState'
import type { Entry, Page, Request } from './stac'
import type { MapViewState, SharedSelection, SharedView } from './viewLinkState'

export { DEFAULT_MAP_VIEW } from './viewLinkState'
export type { MapViewState, SharedView } from './viewLinkState'

export function readViewLink(address: string): { url: string; view?: SharedView; error?: string } {
  const location = new URL(address)
  const url = location.searchParams.get('url') ?? ''
  const fragment = new URLSearchParams(location.hash.slice(1))
  const compact = fragment.get('v')
  const legacy = fragment.get('view')
  if (compact === null && legacy === null) return { url }
  try {
    let view: SharedView
    if (compact !== null) {
      if (compact.startsWith('3.')) view = decodeBinaryView(decodeViewBytes(compact.slice(2)))
      else if (compact.startsWith('2.')) view = expandView(decodeViewPayload(compact.slice(2)))
      else throw new Error('This shared view uses an unsupported link version.')
    } else {
      if (legacy!.length > MAX_VIEW_BYTES) throw new Error('This shared view link is too large.')
      view = validateView(JSON.parse(legacy!))
    }
    return { url: view.request.url, view }
  } catch (cause) {
    return {
      url,
      error: cause instanceof Error ? cause.message : 'Could not read this shared view.',
    }
  }
}

function selectionOf(selected: Entry | undefined): SharedSelection | undefined {
  if (!selected) return undefined
  if (!selected.document?.id) throw new Error('This item has no stable ID to include in a link.')
  const self = selected.document.links?.find((link) => link.rel === 'self')
  // entriesOf already resolves self into baseUrl. Relative self links must use
  // the original response URL, or reuse that canonical URL when it is unavailable.
  const selfUrl =
    self &&
    (selected.sourceRequest
      ? safeUrl(self.href, selected.sourceRequest.url)
      : safeUrl(selected.baseUrl, selected.baseUrl))
  const request =
    self && selfUrl
      ? linkRequest({ ...self, href: selfUrl }, selected.sourceRequest ?? { url: selected.baseUrl })
      : (selected.request ?? selected.sourceRequest ?? { url: selected.baseUrl })
  return {
    id: selected.document.id,
    collection: selected.document.collection,
    request,
  }
}

export function buildViewLink(
  address: string,
  page: Page,
  selected: Entry | undefined,
  map: MapViewState,
  filter: string,
): string {
  const view = validateView({
    version: 1,
    request: page.browseRequest ?? page.request,
    extraRequests: page.extraRequests ?? [],
    selection: selectionOf(selected),
    map,
    filter,
  })
  const location = new URL(address)
  location.search = ''
  const jsonToken = encodeViewPayload(compactView(view))
  let compact = `2.${jsonToken}`
  try {
    const binaryToken = encodeViewBytes(encodeBinaryView(view))
    // JSON normalizes -0; retain the binary representation for exact map numbers.
    const hasSignedZero = Object.values(view.map)
      .flat()
      .some((value) => Object.is(value, -0))
    if (hasSignedZero || binaryToken.length < jsonToken.length) compact = `3.${binaryToken}`
  } catch {
    // JSON remains lossless for text with unpaired Unicode surrogate code units.
  }
  location.hash = `v=${compact}`
  return location.href
}

function matches(entry: Entry, selection: SharedSelection): boolean {
  return (
    entry.document?.id === selection.id &&
    (!selection.collection ||
      !entry.document.collection ||
      entry.document.collection === selection.collection)
  )
}

export async function restoreView(
  view: SharedView,
  signal: AbortSignal,
): Promise<{ page: Page; selected?: Entry; warning?: string }> {
  let page = await loadPage(view.request, signal)
  const extraRequests: Request[] = []
  let warning: string | undefined
  for (const request of view.extraRequests) {
    try {
      const extra = await loadPage(request, signal)
      extraRequests.push(request)
      page = { ...page, entries: mergeEntries(page.entries, extra.entries), next: extra.next }
    } catch {
      if (signal.aborted) throw signal.reason
      warning = 'Some saved result pages are no longer available.'
      break
    }
  }
  page = { ...page, extraRequests }
  let selected: Entry | undefined
  if (view.selection) {
    const selection = view.selection
    selected = page.entries.find((entry) => matches(entry, selection))
    if (!selected) {
      try {
        const loaded = await fetchDocument(selection.request, signal)
        const candidates = entriesOf(loaded.document, loaded.request.url, loaded.request)
        selected = candidates.find((entry) => matches(entry, selection))
        if (!selected) throw new Error('The saved item is missing.')
        // Reuse a static catalog link's key so it remains selected as metadata loads.
        const linked = page.entries.find((entry) => entry.request?.url === selection.request.url)
        if (linked) selected = { ...linked, ...selected, key: linked.key }
        page = { ...page, entries: mergeEntries(page.entries, [selected]) }
      } catch {
        if (signal.aborted) throw signal.reason
        warning =
          'The saved item could not be reopened. The catalog and map view have been restored.'
      }
    }
  }
  return { page, selected, warning }
}
