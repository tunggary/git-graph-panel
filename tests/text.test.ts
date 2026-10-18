import { describe, expect, test } from 'claude-code/testing'

import { cellWidth, truncate, truncateStart, wrap } from '../hooks/lib/text'

describe('cellWidth', () => {
  test('Hangul and CJK take two cells, ASCII one, combining marks none', () => {
    expect(cellWidth('abc')).toBe(3)
    expect(cellWidth('한글')).toBe(4)
    expect(cellWidth('a한b')).toBe(4)
    expect(cellWidth('é')).toBe(1)
    expect(cellWidth('')).toBe(0)
  })
})

describe('truncate', () => {
  test('text that fits is left alone', () => {
    expect(truncate('hello', 5)).toBe('hello')
    expect(truncate('한글', 4)).toBe('한글')
  })

  test('a cut ends in … and never exceeds the width, even between wide characters', () => {
    expect(truncate('hello world', 6)).toBe('hello…')
    expect(truncate('한글입니다', 6)).toBe('한글…') // 4 + 1 would be 5; a third wide char needs 6 + 1
    expect(cellWidth(truncate('한글입니다', 7))).toBeLessThanOrEqual(7)
    expect(truncate('abc', 0)).toBe('')
    expect(truncate('abc', 1)).toBe('…')
  })
})

describe('truncateStart', () => {
  test('keeps the end of a path', () => {
    expect(truncateStart('src/components/Button.tsx', 14)).toBe('…ts/Button.tsx')
    expect(truncateStart('short.ts', 20)).toBe('short.ts')
    expect(cellWidth(truncateStart('폴더/한글/파일이름.ts', 10))).toBeLessThanOrEqual(10)
  })
})

describe('wrap', () => {
  test('lines of at most the width, counted in cells', () => {
    expect(wrap('abcdefgh', 3)).toEqual(['abc', 'def', 'gh'])
    expect(wrap('한글입니다', 6)).toEqual(['한글입', '니다'])
    expect(wrap('', 5)).toEqual([''])
    expect(wrap('abc', 10)).toEqual(['abc'])
  })
})
