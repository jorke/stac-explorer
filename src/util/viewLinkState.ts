import { httpUrl } from './stac'
import type { Request } from './stac'

export interface MapViewState {
  center: [number, number]
  zoom: number
  bearing: number
  pitch: number
  imageryEnabled: boolean
  imageryOpacity: number
  boundsOpacity: number
  showPins: boolean
  assetId?: string
}

// Keep version 2 defaults stable so omitted values in existing links never change.
const VERSION_2_MAP_DEFAULTS: MapViewState = {
  center: [135, -25],
  zoom: 2.2,
  bearing: 0,
  pitch: 0,
  imageryEnabled: true,
  imageryOpacity: 85,
  boundsOpacity: 100,
  showPins: true,
}

export const DEFAULT_MAP_VIEW: MapViewState = {
  ...VERSION_2_MAP_DEFAULTS,
  center: [...VERSION_2_MAP_DEFAULTS.center],
}

export interface SharedSelection {
  id: string
  collection?: string
  request: Request
}

export interface SharedView {
  version: 1
  request: Request
  extraRequests: Request[]
  selection?: SharedSelection
  map: MapViewState
  filter: string
}

function recordOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid shared view.')
  return value as Record<string, unknown>
}

function textOf(value: unknown, maxLength = 2048): string {
  if (typeof value !== 'string' || value.length > maxLength)
    throw new Error('Invalid shared view text.')
  return value
}

function numberOf(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error('Invalid map coordinates or display settings.')
  }
  return value
}

function booleanOf(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid shared view display setting.')
  return value
}

function requestOf(value: unknown): Request {
  const record = recordOf(value)
  const method = record.method ?? 'GET'
  if (method !== 'GET' && method !== 'POST')
    throw new Error('Unsupported shared view request method.')
  return {
    url: httpUrl(textOf(record.url, 8000)),
    method,
    ...(method === 'POST' ? { body: record.body === undefined ? {} : recordOf(record.body) } : {}),
  }
}

function mapOf(value: unknown): MapViewState {
  const map = recordOf(value)
  if (!Array.isArray(map.center) || map.center.length !== 2) throw new Error('Invalid map center.')
  return {
    center: [numberOf(map.center[0], -180, 180), numberOf(map.center[1], -90, 90)],
    zoom: numberOf(map.zoom, 0, 24),
    bearing: numberOf(map.bearing, -180, 180),
    pitch: numberOf(map.pitch, 0, 85),
    imageryEnabled: booleanOf(map.imageryEnabled),
    imageryOpacity: numberOf(map.imageryOpacity, 0, 100),
    boundsOpacity: numberOf(map.boundsOpacity, 0, 100),
    showPins: booleanOf(map.showPins),
    ...(map.assetId === undefined ? {} : { assetId: textOf(map.assetId) }),
  }
}

export function validateView(value: unknown): SharedView {
  const record = recordOf(value)
  if (record.version !== 1) throw new Error('This shared view uses an unsupported link version.')

  const extraRequests = record.extraRequests ?? []
  if (!Array.isArray(extraRequests) || extraRequests.length > 100) {
    throw new Error('This shared view contains too many result pages.')
  }

  let selection: SharedSelection | undefined
  if (record.selection !== undefined) {
    const item = recordOf(record.selection)
    selection = {
      id: textOf(item.id),
      request: requestOf(item.request),
      ...(item.collection === undefined ? {} : { collection: textOf(item.collection) }),
    }
  }
  return {
    version: 1,
    request: requestOf(record.request),
    extraRequests: extraRequests.map(requestOf),
    selection,
    filter: textOf(record.filter ?? '', 1000),
    map: mapOf(record.map),
  }
}

// These abbreviated keys belong only to the version 2 wire format. Application
// state keeps descriptive names, and absent map values restore version 2 defaults.
const MAP_FIELDS = {
  center: 'c',
  zoom: 'z',
  bearing: 'b',
  pitch: 'p',
  imageryEnabled: 'i',
  imageryOpacity: 'o',
  boundsOpacity: 'd',
  showPins: 's',
  assetId: 'a',
} as const

type CompactRequest = string | [url: string, body: Record<string, unknown>]

function compactRequest(request: Request): CompactRequest {
  return request.method === 'POST' ? [request.url, request.body ?? {}] : request.url
}

function expandRequest(value: unknown): Request {
  if (typeof value === 'string') return requestOf({ url: value })
  if (!Array.isArray(value) || value.length !== 2) throw new Error('Invalid shared view request.')
  return requestOf({ url: value[0], method: 'POST', body: value[1] })
}

export function compactView(view: SharedView): Record<string, unknown> {
  const map: Record<string, unknown> = {}
  for (const field of Object.keys(MAP_FIELDS) as (keyof MapViewState)[]) {
    if (JSON.stringify(view.map[field]) !== JSON.stringify(VERSION_2_MAP_DEFAULTS[field])) {
      map[MAP_FIELDS[field]] = view.map[field]
    }
  }
  const selection = view.selection
  return {
    r: compactRequest(view.request),
    ...(view.extraRequests.length ? { p: view.extraRequests.map(compactRequest) } : {}),
    ...(selection
      ? {
          s: [
            selection.id,
            compactRequest(selection.request),
            ...(selection.collection === undefined ? [] : [selection.collection]),
          ],
        }
      : {}),
    ...(Object.keys(map).length ? { m: map } : {}),
    ...(view.filter ? { f: view.filter } : {}),
  }
}

export function expandView(value: unknown): SharedView {
  const record = recordOf(value)
  const compactMap = record.m === undefined ? {} : recordOf(record.m)
  const map: Record<string, unknown> = { ...VERSION_2_MAP_DEFAULTS }
  for (const field of Object.keys(MAP_FIELDS) as (keyof MapViewState)[]) {
    if (Object.hasOwn(compactMap, MAP_FIELDS[field])) map[field] = compactMap[MAP_FIELDS[field]]
  }

  let selection: SharedSelection | undefined
  if (record.s !== undefined) {
    const item = record.s
    if (!Array.isArray(item) || item.length < 2 || item.length > 3)
      throw new Error('Invalid shared item selection.')
    selection = {
      id: textOf(item[0]),
      request: expandRequest(item[1]),
      ...(item.length === 3 ? { collection: textOf(item[2]) } : {}),
    }
  }
  const pages = record.p ?? []
  if (!Array.isArray(pages) || pages.length > 100)
    throw new Error('This shared view contains too many result pages.')
  return validateView({
    version: 1,
    request: expandRequest(record.r),
    extraRequests: pages.map(expandRequest),
    selection,
    map,
    filter: record.f ?? '',
  })
}
