import { deflate } from 'pako'
import { describe, expect, it } from 'vitest'
import {
  decodeViewPayload,
  encodeViewPayload,
  MAX_VIEW_BYTES,
  MAX_VIEW_TOKEN_LENGTH,
} from './viewLinkCodec'

function tokenFor(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

describe('shared view compression', () => {
  it('round-trips Unicode JSON using URL-safe characters', () => {
    const payload = { title: 'Drone imagery — 山 🌏', text: '=&?#' }
    const token = encodeViewPayload(payload)
    expect(token).toMatch(/^[\w-]+$/)
    expect(decodeViewPayload(token)).toEqual(payload)
  })

  it('rejects corrupt checksums, truncated streams, and trailing data', () => {
    const compressed = deflate(new TextEncoder().encode('{"r":"https://example.com"}'))
    const corrupted = compressed.slice()
    corrupted[corrupted.length - 1] ^= 1
    expect(() => decodeViewPayload(tokenFor(corrupted))).toThrow('damaged')
    expect(() => decodeViewPayload(tokenFor(compressed.slice(0, -2)))).toThrow('damaged')
    const trailing = new Uint8Array(compressed.length + 1)
    trailing.set(compressed)
    expect(() => decodeViewPayload(tokenFor(trailing))).toThrow('damaged')
  })

  it('stops highly compressed oversized content before parsing it', () => {
    const compressed = deflate(
      new TextEncoder().encode(JSON.stringify({ large: 'x'.repeat(1_000_000) })),
    )
    expect(compressed.length).toBeLessThan(2000)
    expect(() => decodeViewPayload(tokenFor(compressed))).toThrow('too large')
  })

  it('rejects oversized tokens, invalid base64, and invalid UTF-8', () => {
    expect(() => decodeViewPayload('a'.repeat(MAX_VIEW_TOKEN_LENGTH + 1))).toThrow('too large')
    expect(() => decodeViewPayload('a')).toThrow('malformed')
    expect(() => decodeViewPayload('%')).toThrow('malformed')
    expect(() => decodeViewPayload(tokenFor(deflate(new Uint8Array([0xff]))))).toThrow()
  })

  it('applies its expanded-size limit to UTF-8 bytes as well as ASCII', () => {
    expect(() => encodeViewPayload('山'.repeat(MAX_VIEW_BYTES / 2))).toThrow(
      'Too many loaded pages',
    )
    const payload = 'x'.repeat(MAX_VIEW_BYTES - 2)
    expect(decodeViewPayload(encodeViewPayload(payload))).toBe(payload)
  })
})
