import { MAX_VIEW_BYTES } from './viewLinkCodec'
import { validateView } from './viewLinkState'
import type { Request } from './stac'
import type { MapViewState, SharedSelection, SharedView } from './viewLinkState'

// Version 3 tables are part of the URL format. Never reorder or change entries.
// Layout: field flags, root request, selection, pages, map settings, then filter.
const URL_PRESETS = [
  'https://data.geonadir.com/stac/collections/geonadir-fair-data/collection.json',
  'https://planetarycomputer.microsoft.com/api/stac/v1',
] as const
const ASSET_PRESETS = ['ortho', 'dsm', 'dem', 'dtm', 'visual', 'rgb', 'image'] as const
const DEFAULTS: MapViewState = {
  center: [135, -25],
  zoom: 2.2,
  bearing: 0,
  pitch: 0,
  imageryEnabled: true,
  imageryOpacity: 85,
  boundsOpacity: 100,
  showPins: true,
}

const FIELD = {
  selection: 1 << 0,
  pages: 1 << 1,
  center: 1 << 2,
  zoom: 1 << 3,
  bearing: 1 << 4,
  pitch: 1 << 5,
  imageryHidden: 1 << 6,
  imageryOpacity: 1 << 7,
  boundsOpacity: 1 << 8,
  pinsHidden: 1 << 9,
  asset: 1 << 10,
  filter: 1 << 11,
} as const
const ALL_FIELDS = Object.values(FIELD).reduce((mask, flag) => mask | flag, 0)
const NUMBER_FLOAT64 = 255
const MAX_SMALL_NUMBER = 200
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
const UUID_ONLY = new RegExp(`^${UUID}$`)
const PREFIXED_UUID = new RegExp(`^(0|[1-9][0-9]*)-(${UUID})$`)
const utf8 = new TextEncoder()
const utf8Reader = new TextDecoder('utf-8', { fatal: true })

function malformed(): never {
  throw new Error('This shared view contains invalid binary data.')
}

class Writer {
  private bytes = new Uint8Array(MAX_VIEW_BYTES)
  private offset = 0

  byte(value: number) {
    if (this.offset >= this.bytes.length) throw new Error('This shared view link is too large.')
    this.bytes[this.offset++] = value
  }

  bytesOf(value: Uint8Array) {
    if (value.length > this.bytes.length - this.offset)
      throw new Error('This shared view link is too large.')
    this.bytes.set(value, this.offset)
    this.offset += value.length
  }

  integer(value: number) {
    while (value >= 128) {
      this.byte((value % 128) | 128)
      value = Math.floor(value / 128)
    }
    this.byte(value)
  }

  text(value: string) {
    const bytes = utf8.encode(value)
    // Ill-formed Unicode code units can still use the lossless JSON link format.
    if (utf8Reader.decode(bytes) !== value) throw new Error('This text requires a JSON view link.')
    this.integer(bytes.length)
    this.bytesOf(bytes)
  }

  float64(value: number) {
    const bytes = new Uint8Array(8)
    new DataView(bytes.buffer).setFloat64(0, value)
    this.bytesOf(bytes)
  }

  number(value: number) {
    if (
      Number.isInteger(value) &&
      value >= 0 &&
      value <= MAX_SMALL_NUMBER &&
      !Object.is(value, -0)
    ) {
      this.byte(value)
    } else {
      this.byte(NUMBER_FLOAT64)
      this.float64(value)
    }
  }

  finish(): Uint8Array {
    return this.bytes.subarray(0, this.offset)
  }
}

class Reader {
  private offset = 0

  constructor(private bytes: Uint8Array) {
    if (bytes.length > MAX_VIEW_BYTES) throw new Error('This shared view link is too large.')
  }

  byte(): number {
    if (this.offset >= this.bytes.length) malformed()
    return this.bytes[this.offset++]
  }

  bytesOf(length: number): Uint8Array {
    if (length > this.bytes.length - this.offset) malformed()
    const bytes = this.bytes.subarray(this.offset, this.offset + length)
    this.offset += length
    return bytes
  }

  integer(maximum = Number.MAX_SAFE_INTEGER): number {
    let value = 0
    let multiplier = 1
    for (let length = 0; length < 8; length++) {
      const byte = this.byte()
      value += (byte & 127) * multiplier
      if (!Number.isSafeInteger(value) || value > maximum) malformed()
      if (byte < 128) {
        if (length > 0 && byte === 0) malformed()
        return value
      }
      multiplier *= 128
    }
    return malformed()
  }

  text(): string {
    return utf8Reader.decode(this.bytesOf(this.integer(MAX_VIEW_BYTES)))
  }

  float64(): number {
    const bytes = this.bytesOf(8)
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(0)
  }

  number(): number {
    const kind = this.byte()
    if (kind === NUMBER_FLOAT64) return this.float64()
    if (kind > MAX_SMALL_NUMBER) malformed()
    return kind
  }

  finish() {
    if (this.offset !== this.bytes.length) malformed()
  }
}

function writePreset(writer: Writer, text: string, presets: readonly string[]) {
  const index = presets.indexOf(text)
  writer.integer(index + 1)
  if (index === -1) writer.text(text)
}

function readPreset(reader: Reader, presets: readonly string[]): string {
  const index = reader.integer(presets.length)
  return index === 0 ? reader.text() : presets[index - 1]
}

function writeRequest(writer: Writer, request: Request) {
  const post = request.method === 'POST'
  writer.byte(post ? 1 : 0)
  writePreset(writer, request.url, URL_PRESETS)
  if (post) writer.text(JSON.stringify(request.body ?? {}))
}

function readRequest(reader: Reader): Request {
  const method = reader.byte()
  if (method !== 0 && method !== 1) malformed()
  const url = readPreset(reader, URL_PRESETS)
  if (method === 0) return { url, method: 'GET' }
  const body: unknown = JSON.parse(reader.text())
  if (!body || typeof body !== 'object' || Array.isArray(body)) malformed()
  return { url, method: 'POST', body: body as Record<string, unknown> }
}

function writeUuid(writer: Writer, uuid: string) {
  const hex = uuid.replaceAll('-', '')
  for (let offset = 0; offset < hex.length; offset += 2) {
    writer.byte(Number.parseInt(hex.slice(offset, offset + 2), 16))
  }
}

function readUuid(reader: Reader): string {
  const hex = Array.from(reader.bytesOf(16), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function writeId(writer: Writer, id: string) {
  const match = PREFIXED_UUID.exec(id)
  if (match && Number.isSafeInteger(Number(match[1]))) {
    writer.byte(2)
    writer.integer(Number(match[1]))
    writeUuid(writer, match[2])
  } else if (UUID_ONLY.test(id)) {
    writer.byte(1)
    writeUuid(writer, id)
  } else {
    writer.byte(0)
    writer.text(id)
  }
}

function readId(reader: Reader): string {
  const kind = reader.byte()
  if (kind === 0) return reader.text()
  if (kind === 1) return readUuid(reader)
  if (kind === 2) return `${reader.integer()}-${readUuid(reader)}`
  return malformed()
}

function itemUrls(request: Request, id: string): string[] {
  const encoded = encodeURIComponent(id)
  // Their positions are selection-request tags 1–3. Tag 0 reuses the root
  // request; tag 4 carries a complete request when no template matches exactly.
  return [
    new URL(`items/${encoded}.json`, request.url).href,
    new URL(`${encoded}.json`, request.url).href,
    new URL(`items/${encoded}`, request.url).href,
  ]
}

function collectionOf(request: Request): string | undefined {
  const path = new URL(request.url).pathname.split('/')
  const collection = path[path.lastIndexOf('collections') + 1]
  if (!path.includes('collections') || !collection) return undefined
  try {
    return decodeURIComponent(collection)
  } catch {
    return undefined
  }
}

function sameRequest(left: Request, right: Request): boolean {
  return (
    left.url === right.url &&
    (left.method ?? 'GET') === (right.method ?? 'GET') &&
    (left.method !== 'POST' || JSON.stringify(left.body ?? {}) === JSON.stringify(right.body ?? {}))
  )
}

function writeSelection(writer: Writer, selection: SharedSelection, request: Request) {
  writeId(writer, selection.id)
  const derived =
    selection.request.method !== 'POST'
      ? itemUrls(request, selection.id).indexOf(selection.request.url)
      : -1
  if (sameRequest(selection.request, request)) writer.byte(0)
  else if (derived !== -1) writer.byte(derived + 1)
  else {
    writer.byte(4)
    writeRequest(writer, selection.request)
  }

  if (selection.collection === undefined) writer.byte(0)
  else if (selection.collection === collectionOf(request)) writer.byte(1)
  else {
    writer.byte(2)
    writer.text(selection.collection)
  }
}

function readSelection(reader: Reader, request: Request): SharedSelection {
  const id = readId(reader)
  const requestKind = reader.byte()
  let selectedRequest: Request
  if (requestKind === 0) selectedRequest = request
  else if (requestKind <= 3)
    selectedRequest = { url: itemUrls(request, id)[requestKind - 1], method: 'GET' }
  else if (requestKind === 4) selectedRequest = readRequest(reader)
  else return malformed()

  const collectionKind = reader.byte()
  let collection: string | undefined
  if (collectionKind === 1) {
    collection = collectionOf(request)
    if (collection === undefined) malformed()
  } else if (collectionKind === 2) collection = reader.text()
  else if (collectionKind !== 0) malformed()
  return { id, request: selectedRequest, ...(collection === undefined ? {} : { collection }) }
}

export function encodeBinaryView(view: SharedView): Uint8Array {
  const writer = new Writer()
  const map = view.map
  let flags = 0
  if (view.selection) flags |= FIELD.selection
  if (view.extraRequests.length) flags |= FIELD.pages
  if (map.center.some((value, index) => !Object.is(value, DEFAULTS.center[index])))
    flags |= FIELD.center
  if (!Object.is(map.zoom, DEFAULTS.zoom)) flags |= FIELD.zoom
  if (!Object.is(map.bearing, DEFAULTS.bearing)) flags |= FIELD.bearing
  if (!Object.is(map.pitch, DEFAULTS.pitch)) flags |= FIELD.pitch
  if (!map.imageryEnabled) flags |= FIELD.imageryHidden
  if (!Object.is(map.imageryOpacity, DEFAULTS.imageryOpacity)) flags |= FIELD.imageryOpacity
  if (!Object.is(map.boundsOpacity, DEFAULTS.boundsOpacity)) flags |= FIELD.boundsOpacity
  if (!map.showPins) flags |= FIELD.pinsHidden
  if (map.assetId !== undefined) flags |= FIELD.asset
  if (view.filter) flags |= FIELD.filter

  writer.byte(flags & 255)
  writer.byte(flags >> 8)
  writeRequest(writer, view.request)
  if (view.selection) writeSelection(writer, view.selection, view.request)
  if (flags & FIELD.pages) {
    writer.integer(view.extraRequests.length)
    for (const request of view.extraRequests) writeRequest(writer, request)
  }
  if (flags & FIELD.center) for (const value of map.center) writer.float64(value)
  if (flags & FIELD.zoom) writer.number(map.zoom)
  if (flags & FIELD.bearing) writer.number(map.bearing)
  if (flags & FIELD.pitch) writer.number(map.pitch)
  if (flags & FIELD.imageryOpacity) writer.number(map.imageryOpacity)
  if (flags & FIELD.boundsOpacity) writer.number(map.boundsOpacity)
  if (flags & FIELD.asset) writePreset(writer, map.assetId!, ASSET_PRESETS)
  if (flags & FIELD.filter) writer.text(view.filter)
  return writer.finish()
}

export function decodeBinaryView(bytes: Uint8Array): SharedView {
  const reader = new Reader(bytes)
  const flags = reader.byte() | (reader.byte() << 8)
  if (flags & ~ALL_FIELDS) malformed()
  const request = readRequest(reader)
  const selection = flags & FIELD.selection ? readSelection(reader, request) : undefined
  const extraRequests: Request[] = []
  if (flags & FIELD.pages) {
    const count = reader.integer(100)
    for (let index = 0; index < count; index++) extraRequests.push(readRequest(reader))
  }

  const map: MapViewState = { ...DEFAULTS, center: [...DEFAULTS.center] }
  if (flags & FIELD.center) map.center = [reader.float64(), reader.float64()]
  if (flags & FIELD.zoom) map.zoom = reader.number()
  if (flags & FIELD.bearing) map.bearing = reader.number()
  if (flags & FIELD.pitch) map.pitch = reader.number()
  map.imageryEnabled = !(flags & FIELD.imageryHidden)
  if (flags & FIELD.imageryOpacity) map.imageryOpacity = reader.number()
  if (flags & FIELD.boundsOpacity) map.boundsOpacity = reader.number()
  map.showPins = !(flags & FIELD.pinsHidden)
  if (flags & FIELD.asset) map.assetId = readPreset(reader, ASSET_PRESETS)
  const filter = flags & FIELD.filter ? reader.text() : ''
  reader.finish()
  return validateView({ version: 1, request, selection, extraRequests, map, filter })
}
