import { describe, expect, test } from 'claude-code/testing'

import { cellsToText, layoutGraph, MAX_LANES, PALETTE, toRuns } from '../hooks/lib/lanes'
import type { GraphInput } from '../hooks/lib/lanes'

// Commits are listed newest first, as `git log --date-order` prints them.
const c = (hash: string, ...parents: string[]): GraphInput => ({ hash, parents })
const text = (commits: GraphInput[]) => layoutGraph(commits).rows.map(row => cellsToText(row.cells).trimEnd())

describe('layoutGraph', () => {
  test('a linear history stays in lane 0', () => {
    const graph = layoutGraph([c('c', 'b'), c('b', 'a'), c('a')])
    expect(graph.laneCount).toBe(1)
    expect(graph.width).toBe(2)
    expect(graph.rows.map(row => cellsToText(row.cells))).toEqual(['● ', '● ', '● '])
    expect(graph.rows.map(row => row.lane)).toEqual([0, 0, 0])
  })

  test('an empty history draws nothing', () => {
    expect(layoutGraph([])).toEqual({ rows: [], laneCount: 1, width: 2 })
  })

  test('a branch and its merge: the merge parent opens lane 1, the branch point joins it back', () => {
    expect(text([c('M', 'A', 'F'), c('F', 'B'), c('A', 'B'), c('B')])).toEqual([
      '●─╮',
      '│ ●',
      '● │',
      '●─╯',
    ])
  })

  test('a merge parent opens the left-most free lane and lanes are reused', () => {
    expect(text([c('M2', 'M1', 'G'), c('G', 'B'), c('M1', 'A', 'F'), c('F', 'A'), c('A', 'B'), c('B')])).toEqual([
      '●─╮',
      '│ ●',
      '●─│─╮', // M1's merge parent F crosses G's lane; the lane wins over the line
      '│ │ ●',
      '●─│─╯',
      '●─╯',
    ])
  })

  test('two branches open at once are joined at their common base', () => {
    expect(text([c('M2', 'M1', 'F2'), c('M1', 'B', 'F1'), c('F2', 'B'), c('F1', 'B'), c('B')])).toEqual([
      '●─╮',
      '●─│─╮',
      '│ ● │',
      '│ │ ●',
      '●─┴─╯',
    ])
  })

  test('an octopus merge opens one lane per extra parent and joins them at the base', () => {
    expect(text([c('M', 'A', 'X', 'Y', 'Z'), c('X', 'A'), c('Y', 'A'), c('Z', 'A'), c('A')])).toEqual([
      '●─┬─┬─╮',
      '│ ● │ │',
      '│ │ ● │',
      '│ │ │ ●',
      '●─┴─┴─╯',
    ])
  })

  test('a merge parent that already has a lane attaches to it with a tee', () => {
    expect(text([c('X', 'P'), c('M', 'A', 'P'), c('A', 'P'), c('P')])).toEqual([
      '●',
      '├─●',
      '│ ●',
      '●─╯',
    ])
  })

  test('a branch tip takes the left-most free lane', () => {
    expect(text([c('T1', 'A'), c('T2', 'B'), c('A'), c('B')])).toEqual(['●', '│ ●', '● │', '  ●'])
  })

  test('colors follow the lane index and cycle through the palette', () => {
    const graph = layoutGraph([c('M', 'A', 'F'), c('F', 'B'), c('A', 'B'), c('B')])
    const first = graph.rows[0]!
    expect(first.cells[0]).toEqual({ ch: '●', color: 0 })
    expect(first.cells[1]).toEqual({ ch: '─', color: 1 })
    expect(first.cells[2]).toEqual({ ch: '╮', color: 1 })
    expect(PALETTE).toHaveLength(8)
    expect(toRuns(first.cells)).toEqual([
      { text: '●', color: 0 },
      { text: '─╮', color: 1 },
      { text: ' ', color: null },
    ])
  })

  test('branches that reuse one lane take different colors; a lane keeps its color down its line', () => {
    // Three short branches, one after another, each merged into the main line.
    const graph = layoutGraph([
      c('M3', 'M2', 'F3'),
      c('F3', 'M2'),
      c('M2', 'M1', 'F2'),
      c('F2', 'M1'),
      c('M1', 'M0', 'F1'),
      c('F1', 'M0'),
      c('M0'),
    ])
    const at = (hash: string) => graph.rows.find(row => row.hash === hash)!
    expect([at('F3').lane, at('F1').lane]).toEqual([1, 1])
    expect(new Set(['F3', 'F2', 'F1'].map(h => at(h).color)).size).toBe(3)
    expect(['M3', 'M2', 'M1', 'M0'].map(h => at(h).color)).toEqual([0, 0, 0, 0])
    expect(at('F1').cells[2]).toEqual({ ch: '●', color: at('F1').color })
    expect(at('M1').cells[2]?.color).toBe(at('F1').color) // the merge line takes the branch's color
  })

  test('a new lane skips the colors of the lanes still open', () => {
    const parents = Array.from({ length: 10 }, (_, i) => `p${i}`)
    const graph = layoutGraph([c('M', ...parents), ...parents.map(p => c(p, 'base')), c('base')], 12)
    const open = graph.rows.slice(1, 9).map(row => row.color)
    expect(new Set([0, ...open]).size).toBe(8) // all eight colors while they last
  })

  test('the palette cycles when more lanes are allowed than it has colors', () => {
    const parents = Array.from({ length: 10 }, (_, i) => `p${i}`)
    const graph = layoutGraph([c('M', ...parents), ...parents.map(p => c(p, 'base')), c('base')], 12)
    expect(graph.laneCount).toBe(10)
    expect(graph.rows[9]!.cells[16]).toEqual({ ch: '●', color: 0 }) // lane 8 wraps to the first color
  })

  test('lanes beyond the 8th are cut at the right and marked with …', () => {
    const parents = Array.from({ length: 10 }, (_, i) => `p${i}`)
    const graph = layoutGraph([c('M', ...parents), ...parents.map(p => c(p, 'base')), c('base')])

    expect(graph.laneCount).toBe(MAX_LANES)
    expect(graph.width).toBe(16)
    expect(graph.rows.every(row => row.cells.length === 16)).toBe(true)
    expect(graph.rows.map(row => cellsToText(row.cells))).toEqual([
      '●─┬─┬─┬─┬─┬─┬─┬…',
      '● │ │ │ │ │ │ │…',
      '│ ● │ │ │ │ │ │…',
      '│ │ ● │ │ │ │ │…',
      '│ │ │ ● │ │ │ │…',
      '│ │ │ │ ● │ │ │…',
      '│ │ │ │ │ ● │ │…',
      '│ │ │ │ │ │ ● │…',
      '│ │ │ │ │ │ │ ●…',
      // p8 and p9 sit in hidden lanes: their node takes the marker's cell
      '│ │ │ │ │ │ │ │●',
      '│ │ │ │ │ │ │ │●',
      '●─┴─┴─┴─┴─┴─┴─┴…',
    ])
    expect(graph.rows[9]!.lane).toBe(8)
  })

  test('rows that never touch a lane beyond the limit carry no marker', () => {
    const graph = layoutGraph([c('M', 'A', 'F'), c('F', 'B'), c('A', 'B'), c('B')])
    expect(graph.rows.some(row => cellsToText(row.cells).includes('…'))).toBe(false)
  })

  test('the uncommitted row is an open node over a dotted lane down to HEAD', () => {
    const graph = layoutGraph([
      { hash: 'uncommitted', parents: ['H'], isUncommitted: true },
      c('X', 'B'),
      c('H', 'B'),
      c('B'),
    ])
    expect(graph.rows.map(row => cellsToText(row.cells).trimEnd())).toEqual(['○', '┊ ●', '● │', '●─╯'])
    expect(cellsToText(graph.rows[0]!.trail).trimEnd()).toBe('┊')
  })

  test('the trail of a row is its lanes drawn as plain verticals', () => {
    const graph = layoutGraph([c('M', 'A', 'F'), c('F', 'B'), c('A', 'B'), c('B')])
    expect(graph.rows.map(row => cellsToText(row.trail).trimEnd())).toEqual(['│ │', '│ │', '│ │', ''])
  })
})
