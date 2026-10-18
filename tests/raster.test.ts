import { describe, expect, test } from 'claude-code/testing'

import { layoutGraph, PALETTE } from '../hooks/lib/lanes'
import type { GraphInput } from '../hooks/lib/lanes'
import { parseLog } from '../hooks/lib/parse'
import { CELL_H, CELL_W, GRAY, IMAGE_BUDGET, imageBudget, rasterizeRow, rowImage } from '../hooks/lib/raster'
import { FIXTURE_HEAD, FIXTURE_LOG } from './fixtures/fixture-log'

const c = (hash: string, ...parents: string[]): GraphInput => ({ hash, parents })

const hex = (color: string): number[] => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16))

/** [r, g, b, a] of the pixel at (x, y) of a row `laneCount` lanes wide. */
const pixel = (rgba: Uint8Array, laneCount: number, x: number, y: number): number[] => {
  const i = (y * laneCount * 2 * CELL_W + x) * 4
  return [...rgba.subarray(i, i + 4)]
}
const alpha = (rgba: Uint8Array, laneCount: number, x: number, y: number): number => pixel(rgba, laneCount, x, y)[3]!
const rgbOf = (px: number[]): number[] => px.slice(0, 3)

describe('rasterizeRow', () => {
  // Lane 0 at x=20, lane 1 at x=60; the node of a row is at y=20.
  const graph = layoutGraph([c('M', 'A', 'F'), c('F', 'B'), c('A', 'B'), c('B')])
  const [merge, branch, tip, base] = graph.rows as [typeof graph.rows[0], typeof graph.rows[0], typeof graph.rows[0], typeof graph.rows[0]]
  const raster = (row: typeof merge, options = {}) => rasterizeRow(row, graph.laneCount, options)

  test('a row is two cells wide per lane and one cell tall', () => {
    expect(raster(merge)).toHaveLength(graph.laneCount * 2 * CELL_W * CELL_H * 4)
  })

  test('a node is a filled circle in its lane color, with soft edges', () => {
    const px = raster(merge)
    expect(pixel(px, 2, 20, 20)).toEqual([...hex(PALETTE[0]!), 255])
    expect(rgbOf(pixel(px, 2, 26, 20))).toEqual(hex(PALETTE[0]!)) // inside the radius of 8
    expect(alpha(px, 2, 26, 24)).toBeGreaterThan(0) // an edge pixel is partly covered ...
    expect(alpha(px, 2, 26, 24)).toBeLessThan(255)
    expect(alpha(px, 2, 29, 20)).toBe(0) // ... and nothing lies beyond
    expect(alpha(px, 2, 20, 2)).toBe(0) // the first row has no line above its node
  })

  test('a lane passing through is a straight line of 3px reaching both row edges', () => {
    const px = raster(branch) // lane 0 (A) passes; F's node is in lane 1
    for (const y of [0, 10, 20, 30, 39]) expect(pixel(px, 2, 20, y)).toEqual([...hex(PALETTE[0]!), 255])
    expect(pixel(px, 2, 19, 10)).toEqual([...hex(PALETTE[0]!), 255])
    expect(alpha(px, 2, 21, 10)).toBeGreaterThan(100) // half covered: the line is 3px, centered on x=20
    expect(alpha(px, 2, 21, 10)).toBeLessThan(150)
    expect(alpha(px, 2, 22, 10)).toBe(0)
    expect(alpha(px, 2, 17, 10)).toBe(0)
  })

  test('lines meet across the row border: the bottom of one row and the top of the next are both painted', () => {
    for (const x of [19, 20, 59, 60]) {
      expect(alpha(raster(merge), 2, x, CELL_H - 1)).toBe(255) // lane 0 and the branch curve end at the bottom
      expect(alpha(raster(branch), 2, x, 0)).toBe(255)
      expect(alpha(raster(branch), 2, x, CELL_H - 1)).toBe(255)
      expect(alpha(raster(tip), 2, x, 0)).toBe(255)
    }
    expect(rgbOf(pixel(raster(merge), 2, 60, CELL_H - 1))).toEqual(hex(PALETTE[1]!))
    expect(rgbOf(pixel(raster(branch), 2, 60, 0))).toEqual(hex(PALETTE[1]!))
  })

  test('a branch is a curve from the node to the other lane, leaving and arriving vertically', () => {
    const px = raster(merge) // node (20, 20) -> lane 1 at the bottom (60, 40)
    expect(alpha(px, 2, 40, 30)).toBeGreaterThan(200) // the middle of the S-curve
    expect(rgbOf(pixel(px, 2, 40, 30))).toEqual(hex(PALETTE[1]!))
    expect(alpha(px, 2, 60, 38)).toBe(255) // vertical at its end
    expect(alpha(px, 2, 40, 5)).toBe(0)
    expect(alpha(px, 2, 60, 10)).toBe(0) // not a straight line down lane 1 from above
    expect(alpha(px, 2, 70, 30)).toBe(0)
    expect(alpha(px, 2, 30, 38)).toBe(0) // a curve, not a horizontal at the bottom
  })

  test('a merge-in is the same curve seen from below: lane 1 reaches the node from the top', () => {
    const px = raster(base) // lanes 0 and 1 arrive; the node is in lane 0
    expect(alpha(px, 2, 60, 0)).toBe(255)
    expect(rgbOf(pixel(px, 2, 60, 0))).toEqual(hex(PALETTE[1]!))
    expect(alpha(px, 2, 40, 10)).toBeGreaterThan(200)
    expect(alpha(px, 2, 60, 35)).toBe(0)
    expect(alpha(px, 2, 20, 39)).toBe(0) // nothing continues below the last commit
  })

  test('the checked-out commit is a ring: the lane does not show through the hole', () => {
    const px = raster(base, { isHead: true })
    expect(alpha(px, 2, 20, 20)).toBe(0) // hole
    expect(alpha(px, 2, 20, 17)).toBe(0) // the incoming line is cleared inside the ring
    expect(rgbOf(pixel(px, 2, 26, 20))).toEqual(hex(PALETTE[0]!)) // ring, 3px wide: radius 5..8
    expect(alpha(px, 2, 26, 20)).toBe(255)
    expect(alpha(px, 2, 20, 13)).toBe(255) // top of the ring
    expect(alpha(px, 2, 20, 5)).toBe(255) // the line above the ring remains
    expect(alpha(px, 2, 31, 20)).toBe(0)
  })

  test('the uncommitted row is a gray ring over a gray dotted line down to HEAD', () => {
    const rows = layoutGraph([{ hash: 'u', parents: ['H'], isUncommitted: true }, c('H')]).rows
    const px = rasterizeRow(rows[0]!, 1)
    expect(alpha(px, 1, 20, 20)).toBe(0)
    expect(rgbOf(pixel(px, 1, 26, 20))).toEqual([...GRAY])
    expect(rgbOf(pixel(px, 1, 20, 32))).toEqual([...GRAY]) // a dash ...
    expect(alpha(px, 1, 20, 32)).toBe(255)
    expect(alpha(px, 1, 20, 37)).toBe(0) // ... and a gap
    const head = rasterizeRow(rows[1]!, 1)
    expect(alpha(head, 1, 20, 2)).toBe(255) // the dash pattern continues in the row below
    expect(alpha(head, 1, 20, 7)).toBe(0)
    expect(rgbOf(pixel(head, 1, 20, 2))).toEqual([...GRAY])
    expect(rgbOf(pixel(head, 1, 20, 20))).toEqual(hex(PALETTE[0]!)) // the HEAD node itself keeps its color
  })

  test('the trail has the lanes only, no node', () => {
    const px = raster(merge, { isTrail: true })
    expect(alpha(px, 2, 20, 20)).toBe(255)
    expect(alpha(px, 2, 60, 20)).toBe(255)
    expect(alpha(px, 2, 27, 20)).toBe(0) // where a node's disc would still be
    expect(alpha(px, 2, 40, 30)).toBe(0) // no curve
  })

  test('lanes beyond the limit are cut: dots at the right edge, and a hidden node takes their place', () => {
    const parents = Array.from({ length: 10 }, (_, i) => `p${i}`)
    const wide = layoutGraph([c('M', ...parents), ...parents.map(p => c(p, 'base')), c('base')])
    const w = wide.laneCount * 2 * CELL_W
    const dots = rasterizeRow(wide.rows[1]!, wide.laneCount)
    for (const dy of [-8, 0, 8]) expect(rgbOf(pixel(dots, 8, w - 6, 20 + dy))).toEqual([...GRAY])
    expect(alpha(dots, 8, w - 6, 14)).toBe(0)

    const hidden = rasterizeRow(wide.rows[9]!, wide.laneCount) // its node sits in lane 8
    expect(alpha(hidden, 8, w - 9, 20)).toBe(255)
    expect(rgbOf(pixel(hidden, 8, w - 9, 20))).toEqual(hex(PALETTE[0]!))
  })
})

describe('rowImage', () => {
  const commits = parseLog(FIXTURE_LOG)
  const graph = layoutGraph([{ hash: 'u', parents: [FIXTURE_HEAD], isUncommitted: true }, ...commits])

  test('equal rows share one result; the checked-out commit is a different picture', () => {
    const linear = layoutGraph([c('c', 'b'), c('b', 'a'), c('a', 'z'), c('z')]).rows
    expect(rowImage(linear[1]!, 1)).toBe(rowImage(linear[2]!, 1))
    expect(rowImage(linear[1]!, 1, { isHead: true })).not.toBe(rowImage(linear[1]!, 1))
    expect(rowImage(linear[1]!, 1, { isTrail: true })).not.toBe(rowImage(linear[1]!, 1))
  })

  test('all rows of the fixture stay far below the 2 MiB of Image source a tree may carry', () => {
    const bytes = graph.rows.reduce((sum, row) => sum + rowImage(row, graph.laneCount, { isHead: row.hash === FIXTURE_HEAD }).png.length, 0)
    expect(graph.rows).toHaveLength(76)
    expect(bytes).toBeLessThan(400_000)
  })

  test('100 rows render without noticeable delay, and again from the cache', () => {
    const rows = Array.from({ length: 100 }, (_, i) => graph.rows[i % graph.rows.length]!)
    const run = (): number => {
      const t0 = performance.now()
      for (const row of rows) rowImage(row, graph.laneCount)
      return performance.now() - t0
    }
    expect(run()).toBeLessThan(1000)
    expect(run()).toBeLessThan(50)
  })
})

describe('imageBudget', () => {
  test('hands out pictures from the top until the budget is spent, then never again', () => {
    const budget = imageBudget(100)
    expect([60, 30, 20, 5].map(budget.take)).toEqual([true, true, false, false])
  })

  test('3000 rows of the widest fixture graph stay within the budget, as a top-down prefix', () => {
    const commits = parseLog(FIXTURE_LOG)
    const graph = layoutGraph([{ hash: 'u', parents: [FIXTURE_HEAD], isUncommitted: true }, ...commits])
    const budget = imageBudget()
    let spent = 0
    const taken: boolean[] = []
    for (let i = 0; i < 3000; i++) {
      const row = graph.rows[i % graph.rows.length]!
      const cost = rowImage(row, graph.laneCount, { isHead: i === 1 }).png.length
      const ok = budget.take(cost)
      if (ok) spent += cost
      taken.push(ok)
    }
    expect(spent).toBeLessThanOrEqual(IMAGE_BUDGET)
    expect(IMAGE_BUDGET).toBeLessThan(2097152)
    expect(taken[0]).toBe(true)
    expect(taken.at(-1)).toBe(false) // 3000 rows do not fit ...
    expect(taken.indexOf(false)).toBeGreaterThan(500) // ... but many do
    expect(taken.lastIndexOf(true)).toBe(taken.indexOf(false) - 1) // text only after the first miss
  })
})
