// Lane layout for the commit graph. Pure: commits in, one row of box-drawing cells per commit out.
//
// Rows arrive newest first (git log --date-order). A "lane" is a column that is waiting for
// one commit hash, the parent a commit above it pointed at. For each commit:
//   - it takes the leftmost lane waiting for it (or a free lane when it is a branch tip);
//   - other lanes waiting for it end here with a corner joining its lane (a branch point);
//   - its first parent keeps the same lane, each further (merge) parent joins the lane
//     already waiting for it or opens a new, leftmost free one.
// Every row keeps a bitmask of the directions (up/down/left/right) that touch each cell, and the
// final glyph is looked up from it, so overlapping lines (octopus merges, crossings) just work.
//
// Colors belong to a branch, not a column: each newly opened lane takes the next palette color
// that no open lane is using, so short branches that reuse one column don't all share a color.

/** Git Graph's default lane colors; each newly opened lane takes the next free one, cycling. */
export const PALETTE = ['#0085d9', '#d9008f', '#00d90a', '#d98500', '#a300d9', '#ff0000', '#00d9cc', '#e138e8']

/** Default lane cap when the caller gives none; the pane passes `maxLanesFor(width)` instead. */
export const MAX_LANES = 8

export type Cell = {
  ch: string
  /** Index into PALETTE; null for a cell that is not part of a lane (spaces, the `…` marker). */
  color: number | null
}

export type GraphInput = {
  hash: string
  parents: readonly string[]
  /** The synthetic "Uncommitted Changes" row: drawn as an open node, its lane dotted. */
  isUncommitted?: boolean
}

/** A line of the picture graph. x is a lane index, y a fraction of the row (0 top, 0.5 node, 1 bottom). */
export type Stroke = { x0: number; y0: number; x1: number; y1: number; color: number; isDotted: boolean }

export type GraphRow = {
  hash: string
  /** Lane of the commit's node. May be >= MAX_LANES, in which case the node is drawn in the last cell. */
  lane: number
  /** Index into PALETTE of the node and its branch's pills. */
  color: number
  /** `GraphLayout.width` cells; the last one is `…` (or a hidden-lane node) when lanes beyond MAX_LANES are in play. */
  cells: Cell[]
  /** The vertical lines only, for rows drawn under this one (files of the uncommitted row). */
  trail: Cell[]
  /** The same lines as `cells`, as geometry for the picture graph; lanes beyond `laneCount` are left out. */
  strokes: Stroke[]
  /** The verticals of `trail`, as geometry. */
  trailStrokes: Stroke[]
  isUncommitted: boolean
  /** Lanes beyond MAX_LANES are in play on this row (the `…` marker). */
  hasOverflow: boolean
}

export type GraphLayout = {
  rows: GraphRow[]
  /** Number of lanes drawn (at most MAX_LANES). */
  laneCount: number
  /** Cells per row: two per lane. */
  width: number
}

const U = 1
const D = 2
const L = 4
const R = 8

const GLYPHS: Record<number, string> = {
  [U]: '╵',
  [D]: '╷',
  [L]: '╴',
  [R]: '╶',
  [U | D]: '│',
  [L | R]: '─',
  [D | R]: '╭',
  [D | L]: '╮',
  [U | R]: '╰',
  [U | L]: '╯',
  [U | D | R]: '├',
  [U | D | L]: '┤',
  [L | R | D]: '┬',
  [L | R | U]: '┴',
  [U | D | L | R]: '┼',
}

type Lane = { hash: string; isDotted: boolean; color: number }

/** `laneColor`: color of the vertical line through the cell, which wins at a crossing. */
type RawCell = { dirs: number; color: number; laneColor: number | null; isDotted: boolean }

type RawRow = {
  hash: string
  lane: number
  color: number
  isUncommitted: boolean
  cells: Map<number, RawCell>
  trail: Map<number, RawCell>
  strokes: Stroke[]
  trailStrokes: Stroke[]
  /** Highest lane index anything in this row touches. */
  maxLane: number
}

/** Hex color of a palette index, for a commit's line and the pills of the commits on it. */
export const laneColor = (color: number): string => PALETTE[color % PALETTE.length] ?? PALETTE[0]!

function firstFree(slots: readonly unknown[], isTaken: (index: number) => boolean): number {
  let i = 0
  while (i < slots.length + 1 && isTaken(i)) i++
  return i
}

export function layoutGraph(commits: readonly GraphInput[], maxLanes: number = MAX_LANES): GraphLayout {
  let lanes: (Lane | null)[] = []
  const raw: RawRow[] = []
  let nextColor = 0

  /** The next palette color, skipping those of the open lanes while a free one remains. */
  const takeColor = (...open: (Lane | null)[][]): number => {
    const used = new Set(open.flat().map(l => l?.color))
    let color = nextColor
    for (let k = 0; k < PALETTE.length; k++) {
      const candidate = (nextColor + k) % PALETTE.length
      if (!used.has(candidate)) {
        color = candidate
        break
      }
    }
    nextColor = (color + 1) % PALETTE.length
    return color
  }

  for (const commit of commits) {
    const before = lanes
    const after: (Lane | null)[] = before.slice()
    const cells = new Map<number, RawCell>()
    const trail = new Map<number, RawCell>()
    const strokes: Stroke[] = []
    const trailStrokes: Stroke[] = []
    let maxLane = 0

    const mark = (map: Map<number, RawCell>, pos: number, dirs: number, color: number, isDotted = false): void => {
      const cell = map.get(pos) ?? { dirs: 0, color, laneColor: null, isDotted: false }
      cell.dirs |= dirs
      cell.color = color
      if (dirs & (U | D)) cell.laneColor = color
      cell.isDotted = cell.isDotted || isDotted
      map.set(pos, cell)
      maxLane = Math.max(maxLane, pos >> 1)
    }
    const set = (pos: number, dirs: number, color: number, isDotted = false): void =>
      mark(cells, pos, dirs, color, isDotted)

    /** Horizontal line from the node's lane to `to`, ending in `endDirs` at the far cell. */
    const connect = (from: number, to: number, endDirs: number, color: number): void => {
      const [lo, hi] = from < to ? [from, to] : [to, from]
      for (let pos = lo * 2 + 1; pos < hi * 2; pos++) set(pos, L | R, color)
      set(from * 2, to > from ? R : L, color)
      set(to * 2, (to > from ? L : R) | endDirs, color)
    }

    const incoming: number[] = []
    before.forEach((lane, i) => {
      if (lane?.hash === commit.hash) incoming.push(i)
    })
    const lane = incoming[0] ?? firstFree(before, i => before[i] != null)
    const color = incoming[0] !== undefined ? before[lane]!.color : takeColor(before)
    maxLane = Math.max(maxLane, lane)

    // Lanes passing through this row untouched.
    before.forEach((l, i) => {
      if (!l || incoming.includes(i)) return
      set(i * 2, U | D, l.color, l.isDotted)
      strokes.push({ x0: i, y0: 0, x1: i, y1: 1, color: l.color, isDotted: l.isDotted })
    })
    // Lanes arriving at this commit; all but the leftmost end here.
    for (const i of incoming) {
      const from = before[i]!
      set(i * 2, U, from.color, from.isDotted)
      strokes.push({ x0: i, y0: 0, x1: lane, y1: 0.5, color: from.color, isDotted: from.isDotted })
      if (i !== lane) {
        connect(lane, i, 0, from.color)
        after[i] = null
      }
    }

    const [first, ...merged] = commit.parents
    if (first !== undefined) {
      after[lane] = { hash: first, isDotted: commit.isUncommitted === true, color }
      set(lane * 2, D, color, commit.isUncommitted)
      strokes.push({ x0: lane, y0: 0.5, x1: lane, y1: 1, color, isDotted: commit.isUncommitted === true })
    } else {
      after[lane] = null
    }
    for (const parent of merged) {
      const existing = after.findIndex((l, i) => i !== lane && l?.hash === parent)
      if (existing >= 0) {
        const target = after[existing]!.color
        connect(lane, existing, 0, target)
        strokes.push({ x0: lane, y0: 0.5, x1: existing, y1: 1, color: target, isDotted: false })
      } else {
        const fresh = firstFree(after, i => after[i] != null || before[i] != null || i === lane)
        const freshColor = takeColor(before, after)
        after[fresh] = { hash: parent, isDotted: false, color: freshColor }
        connect(lane, fresh, D, freshColor)
        strokes.push({ x0: lane, y0: 0.5, x1: fresh, y1: 1, color: freshColor, isDotted: false })
      }
    }

    while (after.length > 0 && after[after.length - 1] == null) after.pop()
    lanes = after
    after.forEach((l, i) => {
      if (!l) return
      mark(trail, i * 2, U | D, l.color, l.isDotted)
      trailStrokes.push({ x0: i, y0: 0, x1: i, y1: 1, color: l.color, isDotted: l.isDotted })
    })
    raw.push({
      hash: commit.hash,
      lane,
      color,
      isUncommitted: commit.isUncommitted === true,
      cells,
      trail,
      strokes,
      trailStrokes,
      maxLane,
    })
  }

  const used = raw.reduce((m, r) => Math.max(m, r.maxLane + 1), 1)
  const laneCount = Math.min(maxLanes, used)
  const width = laneCount * 2

  const toCells = (map: Map<number, RawCell>): Cell[] => {
    const out: Cell[] = Array.from({ length: width }, () => ({ ch: ' ', color: null }))
    for (const [pos, cell] of map) {
      if (pos >= width) continue
      // A line crossing a lane (all four directions) shows the lane, not a ┼.
      const isCrossing = cell.dirs === (U | D | L | R)
      const glyph = isCrossing ? '│' : (GLYPHS[cell.dirs] ?? ' ')
      out[pos] = { ch: cell.isDotted && glyph === '│' ? '┊' : glyph, color: isCrossing ? (cell.laneColor ?? cell.color) : cell.color }
    }
    return out
  }

  const rows = raw.map<GraphRow>(r => {
    const cells = toCells(r.cells)
    const node = { ch: r.isUncommitted ? '○' : '●', color: r.color }
    if (r.lane < laneCount) cells[r.lane * 2] = node
    // Overflow marker; a node that sits in a hidden lane is drawn in its place so the row still has one.
    if (r.maxLane >= laneCount) cells[width - 1] = r.lane >= laneCount ? node : { ch: '…', color: null }
    const isVisible = (s: Stroke): boolean => s.x0 < laneCount && s.x1 < laneCount
    return {
      hash: r.hash,
      lane: r.lane,
      color: r.color,
      cells,
      trail: toCells(r.trail),
      strokes: r.strokes.filter(isVisible),
      trailStrokes: r.trailStrokes.filter(isVisible),
      isUncommitted: r.isUncommitted,
      hasOverflow: r.maxLane >= laneCount,
    }
  })

  return { rows, laneCount, width }
}

/** Plain-text form of cells (no colors), trailing spaces kept so widths line up. */
export const cellsToText = (cells: readonly Cell[]): string => cells.map(c => c.ch).join('')

/** Adjacent cells of one color merged, for drawing one `Text` per run. */
export function toRuns(cells: readonly Cell[]): { text: string; color: number | null }[] {
  const runs: { text: string; color: number | null }[] = []
  for (const cell of cells) {
    const last = runs[runs.length - 1]
    if (last && last.color === cell.color) last.text += cell.ch
    else runs.push({ text: cell.ch, color: cell.color })
  }
  return runs
}
