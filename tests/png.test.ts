import { describe, expect, test } from 'claude-code/testing'

import { crc32, encodePng } from '../hooks/lib/png'

// Just enough inflate (fixed Huffman, one block) to prove the encoder's stream decodes.
function inflateFixed(src: number[]): number[] {
  let pos = 0
  const bit = (): number => ((src[pos >> 3] ?? 0) >> (pos++ & 7)) & 1
  const bits = (n: number): number => {
    let v = 0
    for (let i = 0; i < n; i++) v |= bit() << i
    return v
  }
  const LEN = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
  const LEN_X = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
  const DST = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
  const DST_X = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
  const out: number[] = []
  expect(bits(1)).toBe(1) // final
  expect(bits(2)).toBe(1) // fixed Huffman
  for (;;) {
    let code = 0
    let len = 0
    let sym = -1
    while (sym < 0) {
      code = (code << 1) | bit()
      len++
      if (len === 7 && code <= 0x17) sym = 256 + code
      else if (len === 8 && code >= 0x30 && code <= 0xbf) sym = code - 0x30
      else if (len === 8 && code >= 0xc0 && code <= 0xc7) sym = 280 + code - 0xc0
      else if (len === 9 && code >= 0x190) sym = 144 + code - 0x190
    }
    if (sym === 256) return out
    if (sym < 256) {
      out.push(sym)
      continue
    }
    const lc = sym - 257
    const length = (LEN[lc] ?? 0) + bits(LEN_X[lc] ?? 0)
    let dc = 0
    for (let i = 0; i < 5; i++) dc = (dc << 1) | bit()
    const distance = (DST[dc] ?? 0) + bits(DST_X[dc] ?? 0)
    for (let i = 0; i < length; i++) out.push(out[out.length - distance] ?? 0)
  }
}

const be32 = (b: Uint8Array, at: number): number => ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0

/** Chunks of a PNG, with their CRCs checked. */
function chunks(png: Uint8Array): Record<string, Uint8Array> {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const out: Record<string, Uint8Array> = {}
  for (let at = 8; at < png.length; ) {
    const length = be32(png, at)
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8))
    expect(be32(png, at + 8 + length)).toBe(crc32(png.subarray(at + 4, at + 8 + length)))
    out[type] = png.subarray(at + 8, at + 8 + length)
    at += 12 + length
  }
  return out
}

describe('encodePng', () => {
  test('crc32 matches the standard check value', () => {
    expect(crc32([...'123456789'].map(ch => ch.charCodeAt(0)))).toBe(0xcbf43926)
  })

  test('a picture round-trips through the encoder and a decoder', () => {
    const [w, h] = [40, 12]
    const rgba = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++) {
      rgba.set([0x00, 0x85, 0xd9, 255], (y * w + 20) * 4) // a vertical line
      rgba.set([0xd9, 0x00, 0x8f, (y * 21) % 256], (y * w + 7 + (y % 3)) * 4) // noise that breaks the runs
    }
    const parts = chunks(encodePng(rgba, w, h))
    expect(be32(parts.IHDR!, 0)).toBe(w)
    expect(be32(parts.IHDR!, 4)).toBe(h)
    expect([...parts.IHDR!.subarray(8)]).toEqual([8, 6, 0, 0, 0])
    const zlib = [...parts.IDAT!]
    expect(zlib.slice(0, 2)).toEqual([0x78, 0x01])
    const raw = inflateFixed(zlib.slice(2, -4))
    const stride = 1 + w * 4
    expect(raw).toHaveLength(stride * h)
    for (let y = 0; y < h; y++) {
      expect(raw[y * stride]).toBe(0)
      expect(raw.slice(y * stride + 1, (y + 1) * stride)).toEqual([...rgba.subarray(y * w * 4, (y + 1) * w * 4)])
    }
  })

  test('a mostly empty picture is tiny', () => {
    const png = encodePng(new Uint8Array(320 * 40 * 4), 320, 40)
    expect(png.length).toBeLessThan(500)
  })
})
