import { describe, expect, test } from 'claude-code/testing'

import { AUTHOR_WIDTH, DATE_WIDTH, GAP, HASH_WIDTH, MIN_MESSAGE_WIDTH, pickColumns } from '../hooks/lib/columns.ts'

const GRAPH = 17

describe('pickColumns', () => {
  test('a wide pane shows every column', () => {
    const layout = pickColumns(140, GRAPH)
    expect(layout).toMatchObject({ showDate: true, showAuthor: true, showHash: true })
    expect(layout.messageWidth).toBe(140 - GRAPH - GAP - 3 * GAP - DATE_WIDTH - AUTHOR_WIDTH - HASH_WIDTH)
  })

  test('hash goes first', () => {
    const full = GRAPH + GAP + 3 * GAP + DATE_WIDTH + AUTHOR_WIDTH + HASH_WIDTH + MIN_MESSAGE_WIDTH
    expect(pickColumns(full, GRAPH).showHash).toBe(true)
    expect(pickColumns(full - 1, GRAPH)).toMatchObject({ showHash: false, showAuthor: true, showDate: true })
  })

  test('then the author, then the date', () => {
    expect(pickColumns(55, GRAPH)).toMatchObject({ showHash: false, showAuthor: false, showDate: true })
    expect(pickColumns(50, GRAPH)).toMatchObject({ showHash: false, showAuthor: false, showDate: false })
  })

  test('the message column never goes below 1', () => {
    expect(pickColumns(10, GRAPH).messageWidth).toBe(1)
  })

  test('hidden columns give their width back to the message', () => {
    const wide = pickColumns(100, GRAPH)
    const narrow = pickColumns(55, GRAPH)
    expect(wide.messageWidth).toBeGreaterThanOrEqual(MIN_MESSAGE_WIDTH)
    expect(narrow.messageWidth).toBe(55 - GRAPH - GAP - GAP - DATE_WIDTH)
  })
})
