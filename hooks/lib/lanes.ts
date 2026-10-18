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

/** Git Graph's default lane colors; a lane's color is its index into this list, cycling. */
export const PALETTE = ['#0085d9', '#d9008f', '#00d90a', '#d98500', '#a300d9', '#ff0000', '#00d9cc', '#e138e8']

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

export type GraphRow = {
  hash: string
  /** Lane of the commit's node. May be >= MAX_LANES, in which case the node is drawn in the last cell. */
  lane: number
  /** `GraphLayout.width` cells; the last one is `…` (or a hidden-lane node) when lanes beyond MAX_LANES are in play. */
  cells: Cell[]
  /** The vertical lines only, for rows drawn under this one (files of the uncommitted row). */
  trail: Cell[]
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

type Lane = { hash: string; isDotted: boolean }

type RawCell = { dirs: number; color: number; isDotted: boolean }

type RawRow = {
  hash: string
  lane: number
  isUncommitted: boolean
  cells: Map<number, RawCell>
  trail: Map<number, RawCell>
  /** Highest lane index anything in this row touches. */
  maxLane: number
}

const colorOf = (lane: number): number => lane % PALETTE.length

function firstFree(slots: readonly unknown[], isTaken: (index: number) => boolean): number {
  let i = 0
  while (i < slots.length + 1 && isTaken(i)) i++
  return i
}

export function layoutGraph(commits: readonly GraphInput[], maxLanes: number = MAX_LANES): GraphLayout {
  let lanes: (Lane | null)[] = []
  const raw: RawRow[] = []

  for (const commit of commits) {
    const before = lanes
    const after: (Lane | null)[] = before.slice()
    const cells = new Map<number, RawCell>()
    const trail = new Map<number, RawCell>()
    let maxLane = 0

    const mark = (map: Map<number, RawCell>, pos: number, dirs: number, color: number, isDotted = false): void => {
      const cell = map.get(pos) ?? { dirs: 0, color, isDotted: false }
      cell.dirs |= dirs
      cell.color = color
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
    maxLane = Math.max(maxLane, lane)

    // Lanes passing through this row untouched.
    before.forEach((l, i) => {
      if (l && !incoming.includes(i)) set(i * 2, U | D, colorOf(i), l.isDotted)
    })
    // Lanes arriving at this commit; all but the leftmost end here.
    for (const i of incoming) {
      set(i * 2, U, colorOf(i), before[i]?.isDotted)
      if (i !== lane) {
        connect(lane, i, 0, colorOf(i))
        after[i] = null
      }
    }

    const [first, ...merged] = commit.parents
    if (first !== undefined) {
      after[lane] = { hash: first, isDotted: commit.isUncommitted === true }
      set(lane * 2, D, colorOf(lane), commit.isUncommitted)
    } else {
      after[lane] = null
    }
    for (const parent of merged) {
      const existing = after.findIndex((l, i) => i !== lane && l?.hash === parent)
      if (existing >= 0) {
        connect(lane, existing, 0, colorOf(existing))
      } else {
        const fresh = firstFree(after, i => after[i] != null || before[i] != null || i === lane)
        after[fresh] = { hash: parent, isDotted: false }
        connect(lane, fresh, D, colorOf(fresh))
      }
    }

    while (after.length > 0 && after[after.length - 1] == null) after.pop()
    lanes = after
    after.forEach((l, i) => {
      if (l) mark(trail, i * 2, U | D, colorOf(i), l.isDotted)
    })
    raw.push({ hash: commit.hash, lane, isUncommitted: commit.isUncommitted === true, cells, trail, maxLane })
  }

  const used = raw.reduce((m, r) => Math.max(m, r.maxLane + 1), 1)
  const laneCount = Math.min(maxLanes, used)
  const width = laneCount * 2

  const toCells = (map: Map<number, RawCell>): Cell[] => {
    const out: Cell[] = Array.from({ length: width }, () => ({ ch: ' ', color: null }))
    for (const [pos, cell] of map) {
      if (pos >= width) continue
      const glyph = GLYPHS[cell.dirs] ?? ' '
      out[pos] = { ch: cell.isDotted && glyph === '│' ? '┊' : glyph, color: cell.color }
    }
    return out
  }

  const rows = raw.map<GraphRow>(r => {
    const cells = toCells(r.cells)
    const node = { ch: r.isUncommitted ? '○' : '●', color: colorOf(r.lane) }
    if (r.lane < laneCount) cells[r.lane * 2] = node
    // Overflow marker; a node that sits in a hidden lane is drawn in its place so the row still has one.
    if (r.maxLane >= laneCount) cells[width - 1] = r.lane >= laneCount ? node : { ch: '…', color: null }
    return { hash: r.hash, lane: r.lane, cells, trail: toCells(r.trail) }
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
