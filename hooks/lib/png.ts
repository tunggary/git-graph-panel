// Minimal PNG encoder, so a row picture stays small: a tree may carry only 2 MiB of Image source, and
// raw RGBA of a 100-row graph is several times that. The deflate stream uses the fixed Huffman code and
// only two back-reference distances (one pixel, one scanline), which is what mostly transparent rows
// with long vertical lines are made of. `node:zlib` cannot be imported from a hooks module.

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const MIN_MATCH = 3
const MAX_MATCH = 258

class BitWriter {
  readonly bytes: number[] = []
  private buffer = 0
  private count = 0

  /** `n` bits of `value`, low bit first (extra bits, headers). */
  bits(value: number, n: number): void {
    for (let i = 0; i < n; i++) {
      this.buffer |= ((value >> i) & 1) << this.count
      if (++this.count === 8) this.flushByte()
    }
  }

  /** A Huffman code of `n` bits, high bit first. */
  code(value: number, n: number): void {
    for (let i = n - 1; i >= 0; i--) this.bits((value >> i) & 1, 1)
  }

  finish(): number[] {
    if (this.count > 0) this.flushByte()
    return this.bytes
  }

  private flushByte(): void {
    this.bytes.push(this.buffer)
    this.buffer = 0
    this.count = 0
  }
}

/** Fixed-Huffman literal/length symbol. */
function symbol(w: BitWriter, sym: number): void {
  if (sym < 144) w.code(0x30 + sym, 8)
  else if (sym < 256) w.code(0x190 + sym - 144, 9)
  else if (sym < 280) w.code(sym - 256, 7)
  else w.code(0xc0 + sym - 280, 8)
}

const indexBelow = (table: number[], value: number): number => {
  let i = table.length - 1
  while ((table[i] ?? 0) > value) i--
  return i
}

function deflate(data: Uint8Array, distances: readonly number[]): number[] {
  const w = new BitWriter()
  w.bits(1, 1) // final block
  w.bits(1, 2) // fixed Huffman
  let i = 0
  while (i < data.length) {
    let best = 0
    let bestDistance = 0
    for (const d of distances) {
      if (i < d) continue
      let l = 0
      while (l < MAX_MATCH && i + l < data.length && data[i + l] === data[i + l - d]) l++
      if (l > best) [best, bestDistance] = [l, d]
    }
    if (best >= MIN_MATCH) {
      const lc = indexBelow(LENGTH_BASE, best)
      symbol(w, 257 + lc)
      w.bits(best - (LENGTH_BASE[lc] ?? 0), LENGTH_EXTRA[lc] ?? 0)
      const dc = indexBelow(DIST_BASE, bestDistance)
      w.code(dc, 5)
      w.bits(bestDistance - (DIST_BASE[dc] ?? 0), DIST_EXTRA[dc] ?? 0)
      i += best
    } else {
      symbol(w, data[i] ?? 0)
      i++
    }
  }
  symbol(w, 256)
  return w.finish()
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

export function crc32(bytes: ArrayLike<number>): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = (CRC_TABLE[(c ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function adler32(bytes: ArrayLike<number>): number {
  let a = 1
  let b = 0
  for (let i = 0; i < bytes.length; i++) {
    a = (a + (bytes[i] ?? 0)) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

const be32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]

function chunk(type: string, data: readonly number[]): number[] {
  const body = [...type].map(ch => ch.charCodeAt(0)).concat(data)
  return [...be32(data.length), ...body, ...be32(crc32(body))]
}

/** `width * height` RGBA pixels (non-premultiplied, 8 bits) as a PNG file. */
export function encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const stride = 1 + width * 4
  const raw = new Uint8Array(stride * height) // filter byte 0 (none) per scanline
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1)
  const zlib = [0x78, 0x01, ...deflate(raw, [4, stride]), ...be32(adler32(raw))]
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', [...be32(width), ...be32(height), 8, 6, 0, 0, 0]),
    ...chunk('IDAT', zlib),
    ...chunk('IEND', []),
  ])
}
