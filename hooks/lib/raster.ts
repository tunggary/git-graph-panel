// Rasterizer for the picture graph: one image per row, from the row geometry of `layoutGraph`.
// Pure and engine-free. Everything is drawn at 2x of a 10x20 px terminal cell (20x40 px), lane `i`
// centered at x = (2i + 1) * CELL_W, so rows are as wide as the text graph: two columns per lane.
// Lines are anti-aliased distance fields, evaluated inside each shape's bounding box only.

import { PALETTE } from './lanes'
import type { GraphRow, Stroke } from './lanes'
import { encodePng } from './png'

export const CELL_W = 20
export const CELL_H = 40
export const LINE_WIDTH = 3
export const NODE_RADIUS = 8
const RING_WIDTH = 3
const CURVE_STEPS = 20
/** Dotted lines: a 2px dash every 10px (10 divides CELL_H, so rows join up). */
const DOT_PERIOD = 10

type RGB = readonly [number, number, number]
type Segment = readonly [number, number, number, number]

const rgb = (hex: string): RGB => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]
const COLORS = PALETTE.map(rgb)
export const GRAY: RGB = [0x8b, 0x8b, 0x8b]

/** An `Image` source. */
export type RowImage = { png: string }

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n)

/** Source-over compositing of one color at `alpha` onto a non-premultiplied RGBA pixel. */
function over(px: Uint8Array, i: number, [r, g, b]: RGB, alpha: number): void {
  if (alpha <= 0) return
  const da = (px[i + 3] ?? 0) / 255
  const outA = alpha + da * (1 - alpha)
  const mix = (src: number, dst: number): number => (src * alpha + dst * da * (1 - alpha)) / outA
  px[i] = mix(r, px[i] ?? 0)
  px[i + 1] = mix(g, px[i + 1] ?? 0)
  px[i + 2] = mix(b, px[i + 2] ?? 0)
  px[i + 3] = Math.round(outA * 255)
}

/** Strokes a polyline `halfWidth` thick: coverage is the maximum over segments, composited once. */
function paintLine(px: Uint8Array, w: number, h: number, segments: readonly Segment[], color: RGB): void {
  if (segments.length === 0) return
  const half = LINE_WIDTH / 2
  const pad = half + 1
  const xs = segments.flatMap(([x0, , x1]) => [x0, x1])
  const ys = segments.flatMap(([, y0, , y1]) => [y0, y1])
  const bx0 = Math.max(0, Math.floor(Math.min(...xs) - pad))
  const bx1 = Math.min(w - 1, Math.ceil(Math.max(...xs) + pad))
  const by0 = Math.max(0, Math.floor(Math.min(...ys) - pad))
  const by1 = Math.min(h - 1, Math.ceil(Math.max(...ys) + pad))
  if (bx1 < bx0 || by1 < by0) return
  const bw = bx1 - bx0 + 1
  const cover = new Float32Array(bw * (by1 - by0 + 1))

  for (const [x0, y0, x1, y1] of segments) {
    const dx = x1 - x0
    const dy = y1 - y0
    const len2 = dx * dx + dy * dy
    const sx0 = Math.max(bx0, Math.floor(Math.min(x0, x1) - pad))
    const sx1 = Math.min(bx1, Math.ceil(Math.max(x0, x1) + pad))
    const sy0 = Math.max(by0, Math.floor(Math.min(y0, y1) - pad))
    const sy1 = Math.min(by1, Math.ceil(Math.max(y0, y1) + pad))
    for (let y = sy0; y <= sy1; y++) {
      for (let x = sx0; x <= sx1; x++) {
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x + 0.5 - x0) * dx + (y + 0.5 - y0) * dy) / len2))
        const d = Math.hypot(x + 0.5 - (x0 + t * dx), y + 0.5 - (y0 + t * dy))
        const c = clamp01(half + 0.5 - d)
        const k = (y - by0) * bw + (x - bx0)
        if (c > (cover[k] ?? 0)) cover[k] = c
      }
    }
  }
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) over(px, (y * w + x) * 4, color, cover[(y - by0) * bw + (x - bx0)] ?? 0)
  }
}

/** Runs `fn(x, y, distance to (cx, cy))` for the pixels within `radius + 1` of the center. */
function eachNear(w: number, h: number, cx: number, cy: number, radius: number, fn: (x: number, y: number, d: number) => void): void {
  const pad = radius + 1
  for (let y = Math.max(0, Math.floor(cy - pad)); y <= Math.min(h - 1, Math.ceil(cy + pad)); y++) {
    for (let x = Math.max(0, Math.floor(cx - pad)); x <= Math.min(w - 1, Math.ceil(cx + pad)); x++) {
      fn(x, y, Math.hypot(x + 0.5 - cx, y + 0.5 - cy))
    }
  }
}

function paintDisc(px: Uint8Array, w: number, h: number, cx: number, cy: number, radius: number, color: RGB): void {
  eachNear(w, h, cx, cy, radius, (x, y, d) => over(px, (y * w + x) * 4, color, clamp01(radius + 0.5 - d)))
}

/** An open node: whatever was drawn under it is cleared first, so the lane does not show through. */
function paintRing(px: Uint8Array, w: number, h: number, cx: number, cy: number, color: RGB): void {
  eachNear(w, h, cx, cy, NODE_RADIUS, (x, y, d) => {
    const i = (y * w + x) * 4
    px[i + 3] = Math.round((px[i + 3] ?? 0) * (1 - clamp01(NODE_RADIUS + 0.5 - d)))
  })
  eachNear(w, h, cx, cy, NODE_RADIUS, (x, y, d) => {
    over(px, (y * w + x) * 4, color, Math.min(clamp01(NODE_RADIUS + 0.5 - d), clamp01(d - (NODE_RADIUS - RING_WIDTH) + 0.5)))
  })
}

const laneX = (lane: number): number => (lane * 2 + 1) * CELL_W

/** The polyline of a stroke: straight, or a cubic Bezier with vertical tangents at both ends. */
function polyline(s: Stroke): [number, number][] {
  const [x0, y0, x1, y1] = [laneX(s.x0), s.y0 * CELL_H, laneX(s.x1), s.y1 * CELL_H]
  if (x0 === x1) return [[x0, y0], [x1, y1]]
  const my = (y0 + y1) / 2
  return Array.from({ length: CURVE_STEPS + 1 }, (_, i) => {
    const t = i / CURVE_STEPS
    const u = 1 - t
    return [
      u * u * u * x0 + 3 * u * u * t * x0 + 3 * u * t * t * x1 + t * t * t * x1,
      u * u * u * y0 + 3 * u * u * t * my + 3 * u * t * t * my + t * t * t * y1,
    ]
  })
}

function paintStroke(px: Uint8Array, w: number, h: number, s: Stroke): void {
  const points = polyline(s)
  const color = s.isDotted ? GRAY : (COLORS[s.color] ?? GRAY)
  let segments: Segment[] = []
  for (let i = 1; i < points.length; i++) {
    segments.push([points[i - 1]![0], points[i - 1]![1], points[i]![0], points[i]![1]])
  }
  if (s.isDotted && segments.length === 1) {
    // Dashes cut out of the straight line, aligned to the row so the pattern continues across rows.
    const [x, ya, , yb] = segments[0]!
    segments = []
    for (let p = Math.floor(Math.min(ya, yb) / DOT_PERIOD) * DOT_PERIOD; p < Math.max(ya, yb); p += DOT_PERIOD) {
      const [from, to] = [Math.max(p + 1.5, Math.min(ya, yb)), Math.min(p + 3.5, Math.max(ya, yb))]
      if (to >= from) segments.push([x, from, x, to])
    }
  }
  paintLine(px, w, h, segments, color)
}

export type RasterOptions = {
  /** The row's commit is the checked-out one: its node is a ring. */
  isHead?: boolean
  /** Draw only the lines that continue under the row (the files of the uncommitted row). */
  isTrail?: boolean
}

/** RGBA pixels (`laneCount * 2 * CELL_W` x `CELL_H`) of one row. */
export function rasterizeRow(row: GraphRow, laneCount: number, { isHead = false, isTrail = false }: RasterOptions = {}): Uint8Array {
  const [w, h] = [laneCount * 2 * CELL_W, CELL_H]
  const px = new Uint8Array(w * h * 4)
  for (const s of isTrail ? row.trailStrokes : row.strokes) paintStroke(px, w, h, s)
  if (isTrail) return px

  const color = row.isUncommitted ? GRAY : (COLORS[row.lane % COLORS.length] ?? GRAY)
  const hidden = row.lane >= laneCount
  const [cx, cy] = [hidden ? w - NODE_RADIUS - 1 : laneX(row.lane), CELL_H / 2]
  if (row.isUncommitted || isHead) paintRing(px, w, h, cx, cy, color)
  else paintDisc(px, w, h, cx, cy, NODE_RADIUS, color)
  // `…`: three dots at the right edge, where the lanes beyond the limit were cut off.
  if (row.hasOverflow && !hidden) {
    for (const dy of [-8, 0, 8]) paintDisc(px, w, h, w - 6, cy + dy, 2, GRAY)
  }
  return px
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += BASE64.charAt(n >> 18) + BASE64.charAt((n >> 12) & 63)
    out += i + 1 < bytes.length ? BASE64.charAt((n >> 6) & 63) : '='
    out += i + 2 < bytes.length ? BASE64.charAt(n & 63) : '='
  }
  return out
}

const MEMO_LIMIT = 512
const memo = new Map<string, RowImage>()

/** The row as an `Image` source (a PNG); rows with the same lines and node share one result. */
export function rowImage(row: GraphRow, laneCount: number, options: RasterOptions = {}): RowImage {
  const isTrail = options.isTrail === true
  const key = JSON.stringify([
    laneCount,
    isTrail,
    isTrail ? null : [options.isHead === true, row.lane, row.isUncommitted, row.hasOverflow, row.strokes],
    isTrail ? row.trailStrokes : null,
  ])
  const hit = memo.get(key)
  if (hit) return hit
  const image = { png: toBase64(encodePng(rasterizeRow(row, laneCount, options), laneCount * 2 * CELL_W, CELL_H)) }
  if (memo.size >= MEMO_LIMIT) memo.clear()
  memo.set(key, image)
  return image
}

/**
 * A tree may carry only 2097152 bytes of Image source (the engine refuses the whole pane past it, and
 * does not say whether it counts base64 characters or decoded bytes), so the pictures stop at 1.5 MiB of
 * base64 text, which is below the limit counted either way.
 */
export const IMAGE_BUDGET = 1.5 * 1024 * 1024

/** `take(cost)` says whether a picture of that many characters still fits; once one does not, none does. */
export function imageBudget(limit: number = IMAGE_BUDGET): { take: (cost: number) => boolean } {
  let left = limit
  return {
    take(cost) {
      if (cost > left) {
        left = 0
        return false
      }
      left -= cost
      return true
    },
  }
}
