import { mergeEntries } from './stac'
import type { Entry, Page, Request } from './stac'

export type NavigationMode = 'root' | 'child' | 'more'

export interface CatalogState {
  page?: Page
  history: Page[]
  selected?: Entry
  zoomRequest?: { entry: Entry }
  filter: string
  loading: boolean
  error: string
  notice: string
  revision: number
}

export type CatalogAction =
  | { type: 'loading' }
  | { type: 'loaded'; page: Page; request: Request; mode: NavigationMode; zoomToItem: boolean }
  | { type: 'restored'; page: Page; selected?: Entry; filter: string; warning?: string }
  | { type: 'failed'; error: string }
  | { type: 'finished' }
  | { type: 'select'; entry: Entry; zoomToItem: boolean }
  | { type: 'close-selection' }
  | { type: 'back' }
  | { type: 'filter'; value: string }
  | { type: 'dismiss-error' }
  | { type: 'notice'; value: string }
  | { type: 'locations'; entries: Entry[]; revision: number; refreshSelection: boolean }

export function initialCatalogState(notice = ''): CatalogState {
  return { history: [], filter: '', loading: false, error: '', notice, revision: 0 }
}

/** Keep navigation and background location updates in one ordered state transition. */
export function catalogReducer(state: CatalogState, action: CatalogAction): CatalogState {
  switch (action.type) {
    case 'loading':
      return {
        ...state,
        loading: true,
        error: '',
        notice: state.page ? '' : state.notice,
        zoomRequest: undefined,
      }
    case 'loaded': {
      const next = action.page
      if (action.mode === 'more' && state.page) {
        return {
          ...state,
          page: {
            ...state.page,
            entries: mergeEntries(state.page.entries, next.entries),
            next: next.next,
            extraRequests: [...(state.page.extraRequests ?? []), action.request],
          },
        }
      }
      const selected = next.document.type === 'Feature' ? next.entries[0] : undefined
      return {
        ...state,
        page: next,
        history:
          action.mode === 'root' ? [] : [...state.history, ...(state.page ? [state.page] : [])],
        selected,
        zoomRequest: selected && action.zoomToItem ? { entry: selected } : undefined,
        filter: '',
        revision: state.revision + 1,
      }
    }
    case 'restored':
      return {
        ...state,
        page: action.page,
        selected: action.selected,
        filter: action.filter,
        notice: action.warning ?? '',
        revision: state.revision + 1,
      }
    case 'failed':
      return { ...state, error: action.error }
    case 'finished':
      return { ...state, loading: false }
    case 'select':
      return {
        ...state,
        selected: action.entry,
        loading: false,
        error: '',
        // A new request lets a repeated left-pane click recenter the same item.
        zoomRequest: action.zoomToItem ? { entry: action.entry } : undefined,
      }
    case 'close-selection':
      return { ...state, selected: undefined, zoomRequest: undefined }
    case 'back':
      return {
        ...state,
        page: state.history.at(-1),
        history: state.history.slice(0, -1),
        loading: false,
        error: '',
        selected: undefined,
        zoomRequest: undefined,
        filter: '',
        revision: state.revision + 1,
      }
    case 'filter':
      return { ...state, filter: action.value }
    case 'dismiss-error':
      return { ...state, error: '' }
    case 'notice':
      return { ...state, notice: action.value }
    case 'locations': {
      if (!state.page || action.revision !== state.revision || !action.entries.length) return state
      const resolved = new Map(action.entries.map((entry) => [entry.key, entry]))
      return {
        ...state,
        page: {
          ...state.page,
          entries: state.page.entries.map((entry) => resolved.get(entry.key) ?? entry),
        },
        selected:
          action.refreshSelection && state.selected
            ? (resolved.get(state.selected.key) ?? state.selected)
            : state.selected,
      }
    }
  }
}
