import { deflate, Inflate } from 'pako'

// Limit the expanded JSON as well as the URL: a small compressed token can
// otherwise allocate a very large string before its state is validated.
export const MAX_VIEW_BYTES = 32_000
export const MAX_VIEW_TOKEN_LENGTH = 44_000

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromBase64Url(token: string): Uint8Array {
  if (!token || !/^[\w-]+$/.test(token) || token.length % 4 === 1) {
    throw new Error('This shared view link is malformed.')
  }
  const base64 = token.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  if (toBase64Url(bytes) !== token) throw new Error('This shared view link is malformed.')
  return bytes
}

export function encodeViewPayload(value: unknown): string {
  return encodeViewBytes(new TextEncoder().encode(JSON.stringify(value)))
}

export function encodeViewBytes(bytes: Uint8Array): string {
  if (bytes.length > MAX_VIEW_BYTES) {
    throw new Error(
      'Too many loaded pages for one link. Open the selected item directly, then copy its view.',
    )
  }
  return toBase64Url(deflate(bytes, { level: 9 }))
}

export function decodeViewPayload(token: string): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decodeViewBytes(token)))
}

export function decodeViewBytes(token: string): Uint8Array {
  if (token.length > MAX_VIEW_TOKEN_LENGTH) throw new Error('This shared view link is too large.')

  const compressed = fromBase64Url(token)
  // windowBits: 15 accepts only zlib, which includes a corruption checksum.
  // Streaming in fixed output chunks lets us stop before oversized allocation.
  // Pako exposes its zlib input cursor at runtime; its type package omits it.
  const decoder = new Inflate({ chunkSize: 4096, windowBits: 15 }) as Inflate & {
    strm: { avail_in: number }
  }
  const output = new Uint8Array(MAX_VIEW_BYTES)
  let length = 0
  decoder.onData = (chunk) => {
    if (!(chunk instanceof Uint8Array)) throw new Error('Invalid shared view data.')
    if (length + chunk.length > MAX_VIEW_BYTES)
      throw new Error('This shared view link is too large.')
    output.set(chunk, length)
    length += chunk.length
  }
  const complete = decoder.push(compressed, true)
  if (!complete || decoder.err || decoder.strm.avail_in !== 0) {
    throw new Error('This shared view link is incomplete or damaged.')
  }
  return output.subarray(0, length)
}
