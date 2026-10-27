import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'

export interface StacLink {
  rel: string
  href: string
  title?: string
  type?: string
  method?: string
  body?: Record<string, unknown>
  merge?: boolean
}

export interface StacDocument {
  type?: string
  id?: string
  title?: string
  description?: string
  stac_version?: string
  collection?: string
  links?: StacLink[]
  features?: StacDocument[]
  collections?: StacDocument[]
  geometry?: Geometry | null
  bbox?: number[]
  extent?: { spatial?: { bbox?: number[][] } }
  properties?: Record<string, unknown>
  assets?: Record<string, { href: string; title?: string; type?: string; roles?: string[] }>
  numberMatched?: number
  context?: { matched?: number }
}

export interface Request {
  url: string
  method?: 'GET' | 'POST'
  body?: Record<string, unknown>
}

export interface Entry {
  key: string
  title: string
  kind: 'Collection' | 'Catalog' | 'Item'
  description?: string
  document?: StacDocument
  request?: Request
  baseUrl: string
  sourceRequest?: Request
}

export interface Page {
  title: string
  description?: string
  document: StacDocument
  entries: Entry[]
  request: Request
  next?: Request
  browseRequest?: Request
  extraRequests?: Request[]
}

export function httpUrl(href: string, base?: string): string {
  const url = new URL(href.trim(), base)
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Use an http:// or https:// STAC URL.')
  if (url.username || url.password) throw new Error('URLs containing passwords are not supported.')
  return url.href
}

export function safeUrl(href: string | undefined, base: string): string | undefined {
  try {
    return href ? httpUrl(href, base) : undefined
  } catch {
    return undefined
  }
}

export function linkRequest(link: StacLink, current: Request): Request {
  const method = (link.method ?? 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'POST')
    throw new Error(`Unsupported STAC link method: ${method}`)
  return {
    url: httpUrl(link.href, current.url),
    method,
    ...(method === 'POST'
      ? { body: link.merge ? { ...current.body, ...link.body } : link.body }
      : {}),
  }
}

export function titleOf(doc: StacDocument): string {
  return (
    doc.title ||
    (typeof doc.properties?.title === 'string' ? doc.properties.title : '') ||
    doc.id ||
    (doc.collections ? 'Collections' : doc.type === 'FeatureCollection' ? 'Items' : 'Catalog')
  )
}

function documentEntry(doc: StacDocument, baseUrl: string, index: number): Entry {
  const self = doc.links?.find((link) => link.rel === 'self')
  const canonical = self ? safeUrl(self.href, baseUrl) : undefined
  return {
    key: `${doc.collection ?? ''}/${doc.id ?? canonical ?? index}`,
    title: titleOf(doc),
    kind: doc.type === 'Feature' ? 'Item' : doc.type === 'Collection' ? 'Collection' : 'Catalog',
    description: doc.description,
    document: doc,
    baseUrl: canonical ?? baseUrl,
  }
}

export function entriesOf(
  doc: StacDocument,
  baseUrl: string,
  sourceRequest: Request = { url: baseUrl },
): Entry[] {
  const fromDocument = (entry: StacDocument, index: number): Entry => ({
    ...documentEntry(entry, baseUrl, index),
    sourceRequest,
  })
  if (doc.type === 'Feature') return [fromDocument(doc, 0)]
  if (doc.features) return doc.features.map(fromDocument)
  if (doc.collections) return doc.collections.map(fromDocument)
  return (doc.links ?? [])
    .filter((link) => ['child', 'item'].includes(link.rel))
    .map((link, i) => ({
      key: `${link.href}-${i}`,
      title: link.title || decodeTitle(link.href),
      kind: link.rel === 'item' ? 'Item' : 'Catalog',
      request: linkRequest(link, { url: baseUrl }),
      baseUrl,
    }))
}

function decodeTitle(href: string) {
  try {
    return decodeURIComponent(href.split('?')[0].split('/').filter(Boolean).pop() || href)
  } catch {
    return href
  }
}

export function validateDocument(value: unknown): asserts value is StacDocument {
  if (!value || typeof value !== 'object')
    throw new Error('This URL did not return a STAC document.')
  const doc = value as StacDocument
  const valid =
    (['Catalog', 'Collection', 'Feature'].includes(doc.type ?? '') &&
      typeof doc.stac_version === 'string') ||
    (doc.type === 'FeatureCollection' && Array.isArray(doc.features)) ||
    Array.isArray(doc.collections)
  if (!valid) throw new Error('This JSON is not a STAC catalog, collection, item, or item listing.')
  if (
    doc.links !== undefined &&
    (!Array.isArray(doc.links) ||
      doc.links.some((l) => !l || typeof l.href !== 'string' || typeof l.rel !== 'string'))
  ) {
    throw new Error('The STAC document contains invalid links.')
  }
  for (const key of ['features', 'collections'] as const) {
    if (doc[key] !== undefined && !Array.isArray(doc[key]))
      throw new Error(`Invalid STAC ${key} list.`)
    for (const child of doc[key] ?? []) validateDocument(child)
  }
}

export async function fetchDocument(
  request: Request,
  signal: AbortSignal,
): Promise<{ document: StacDocument; request: Request }> {
  let response: Response
  try {
    response = await fetch(request.url, {
      method: request.method ?? 'GET',
      headers: {
        Accept: 'application/geo+json, application/json',
        ...(request.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: request.method === 'POST' ? JSON.stringify(request.body ?? {}) : undefined,
      signal,
      credentials: 'omit',
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new Error(
      'Could not reach this STAC URL. Check the URL and connection. The endpoint must allow browser access (CORS).',
    )
  }
  if (!response.ok)
    throw new Error(
      `The STAC endpoint returned HTTP ${response.status}${response.status === 401 || response.status === 403 ? '. This explorer supports publicly accessible endpoints.' : '.'}`,
    )
  let document: unknown
  try {
    document = await response.json()
  } catch {
    throw new Error(
      'The endpoint did not return valid JSON. Use the STAC JSON URL, rather than its website.',
    )
  }
  validateDocument(document)
  return { document, request: { ...request, url: response.url || request.url } }
}

export async function loadPage(
  request: Request,
  signal: AbortSignal,
  inline?: StacDocument,
): Promise<Page> {
  let loaded = inline ? { document: inline, request } : await fetchDocument(request, signal)
  const source = loaded.document
  let browseRequest = loaded.request
  const dataLink = source.links?.find(
    (link) =>
      link.rel === (source.type === 'Collection' ? 'items' : 'data') &&
      (!link.type || link.type.includes('json')),
  )
  // Follow API listings, while static catalogs remain browsable through child/item links.
  if (dataLink && ['Collection', 'Catalog'].includes(source.type ?? '')) {
    loaded = await fetchDocument(linkRequest(dataLink, loaded.request), signal)
    if (inline && !source.links?.some((link) => link.rel === 'self')) browseRequest = loaded.request
  }
  const next = loaded.document.links?.find((link) => link.rel === 'next')
  return {
    title: titleOf(source),
    description: source.description,
    document: loaded.document,
    entries: entriesOf(loaded.document, loaded.request.url, loaded.request),
    request: loaded.request,
    browseRequest,
    next: next ? linkRequest(next, loaded.request) : undefined,
  }
}

export function mergeEntries(old: Entry[], added: Entry[]): Entry[] {
  return Array.from(new Map([...old, ...added].map((entry) => [entry.key, entry])).values())
}

export function bboxGeometry(bbox: number[]): Geometry | null {
  if (![4, 6].includes(bbox.length) || !bbox.every(Number.isFinite)) return null
  const [west, south] = bbox
  let east = bbox[bbox.length / 2]
  const north = bbox[bbox.length / 2 + 1]
  if (east < west) east += 360
  return {
    type: 'Polygon',
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  }
}

export function geometryOf(doc?: StacDocument): Geometry | null {
  if (!doc) return null
  if (doc.geometry) return doc.geometry
  const bbox = doc.bbox ?? doc.extent?.spatial?.bbox?.[0]
  return bbox ? bboxGeometry(bbox) : null
}

export function featuresOf(entries: Entry[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: entries.flatMap((entry) => {
      const geometry = geometryOf(entry.document)
      return geometry
        ? [
            {
              type: 'Feature' as const,
              geometry,
              properties: { key: entry.key, title: entry.title },
            },
          ]
        : []
    }),
  }
}

/** Area-weighted centroid in lon/lat; unwrap longitudes across the antimeridian. */
export function centroidOf(doc?: StacDocument): [number, number] | undefined {
  const geometry = geometryOf(doc)
  if (!geometry) return
  if (geometry.type === 'Point') return [geometry.coordinates[0], geometry.coordinates[1]]
  const points: Position[] = []
  function collect(value: unknown) {
    if (!Array.isArray(value)) return
    if (typeof value[0] === 'number' && typeof value[1] === 'number') points.push(value as Position)
    else value.forEach(collect)
  }
  function visit(geom: Geometry) {
    if (geom.type === 'GeometryCollection') geom.geometries.forEach(visit)
    else collect(geom.coordinates)
  }
  visit(geometry)
  if (!points.length || !points.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))) return
  const reference = points[0][0]
  const unwrap = (x: number) => x + Math.round((reference - x) / 360) * 360
  let area = 0,
    longitude = 0,
    latitude = 0
  const polygons =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : []
  for (const polygon of polygons) {
    polygon.forEach((ring, index) => {
      let twiceArea = 0,
        x = 0,
        y = 0
      for (let i = 0; i < ring.length - 1; i++) {
        const a = [unwrap(ring[i][0]), ring[i][1]],
          b = [unwrap(ring[i + 1][0]), ring[i + 1][1]]
        const cross = a[0] * b[1] - b[0] * a[1]
        twiceArea += cross
        x += (a[0] + b[0]) * cross
        y += (a[1] + b[1]) * cross
      }
      if (Math.abs(twiceArea) < 1e-12) return
      const weight = Math.abs(twiceArea) * (index === 0 ? 1 : -1)
      longitude += (x / (3 * twiceArea)) * weight
      latitude += (y / (3 * twiceArea)) * weight
      area += weight
    })
  }
  if (area > 0) return [((((longitude / area + 180) % 360) + 360) % 360) - 180, latitude / area]
  return [
    points.reduce((sum, point) => sum + unwrap(point[0]), 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  ]
}

export function centroidsOf(entries: Entry[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: entries.flatMap((entry) => {
      const coordinates = entry.kind === 'Item' ? centroidOf(entry.document) : undefined
      return coordinates
        ? [
            {
              type: 'Feature' as const,
              geometry: { type: 'Point' as const, coordinates },
              properties: { key: entry.key, title: entry.title },
            },
          ]
        : []
    }),
  }
}

export function boundsOf(features: Feature[]): [[number, number], [number, number]] | undefined {
  const points: Position[] = []
  function visit(value: unknown) {
    if (!Array.isArray(value)) return
    if (typeof value[0] === 'number' && typeof value[1] === 'number') points.push(value as Position)
    else value.forEach(visit)
  }
  function geometry(geom: Geometry) {
    if (geom.type === 'GeometryCollection') geom.geometries.forEach(geometry)
    else visit(geom.coordinates)
  }
  features.forEach((feature) => {
    if (feature.geometry) geometry(feature.geometry)
  })
  const valid = points.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
  if (!valid.length) return undefined
  // Accumulate instead of spreading: detailed STAC footprints can have many vertices.
  let west = Infinity,
    east = -Infinity,
    south = Infinity,
    north = -Infinity
  for (const [lon, lat] of valid) {
    west = Math.min(west, lon)
    east = Math.max(east, lon)
    south = Math.min(south, lat)
    north = Math.max(north, lat)
  }
  return [
    [west, Math.max(-85, south)],
    [east, Math.min(85, north)],
  ]
}

export function dateOf(doc?: StacDocument): string {
  const value = doc?.properties?.datetime ?? doc?.properties?.start_datetime
  if (typeof value !== 'string') return ''
  const date = new Date(value)
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
