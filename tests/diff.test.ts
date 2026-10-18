import { describe, expect, test } from 'claude-code/testing'

import { prepareDiff } from '../hooks/lib/diff'

const HEADER = ['diff --git a/f b/f', 'index 1..2 100644', '--- a/f', '+++ b/f']

describe('prepareDiff', () => {
  test('drops git\'s header lines and keeps the hunks', () => {
    const prepared = prepareDiff([...HEADER, '@@ -1,2 +1,2 @@', ' a', '-b', '+c', ''].join('\n'))
    expect(prepared).toEqual({ kind: 'diff', source: '@@ -1,2 +1,2 @@\n a\n-b\n+c', hiddenLines: 0 })
  })

  test('a binary file, a bare rename and nothing at all have no hunks', () => {
    expect(prepareDiff('diff --git a/x b/x\nBinary files a/x and b/x differ\n')).toEqual({ kind: 'binary' })
    expect(prepareDiff('diff --git a/x b/y\nsimilarity index 100%\nrename from x\nrename to y\n')).toEqual({ kind: 'empty' })
    expect(prepareDiff('')).toEqual({ kind: 'empty' })
  })

  test('whole hunks are kept while they fit; the first that does not is cut on a line and its header recounted', () => {
    const hunk = (start: number, n: number) => [`@@ -${start},${n} +${start},${n} @@ ctx`, ...Array.from({ length: n }, (_, i) => ` line ${start + i}`)]
    const raw = [...HEADER, ...hunk(1, 3), ...hunk(10, 10), ...hunk(30, 3), ''].join('\n')
    const prepared = prepareDiff(raw, { maxLines: 8 })
    expect(prepared.kind).toBe('diff')
    if (prepared.kind !== 'diff') return
    const lines = prepared.source.split('\n')
    expect(lines).toHaveLength(8)
    expect(lines[4]).toBe('@@ -10,3 +10,3 @@ ctx') // 3 of 10 context lines kept
    expect(prepared.hiddenLines).toBe(4 + 11 + 4 - 8)
  })

  test('a hunk of added lines is recounted on the new side only', () => {
    const raw = [...HEADER, '@@ -0,0 +1,100 @@', ...Array.from({ length: 100 }, (_, i) => `+line ${i}`), ''].join('\n')
    const prepared = prepareDiff(raw, { maxLines: 11 })
    if (prepared.kind !== 'diff') throw new Error('expected a diff')
    expect(prepared.source.startsWith('@@ -0,0 +1,10 @@\n+line 0')).toBe(true)
    expect(prepared.hiddenLines).toBe(101 - 11)
  })

  test('removed and context lines count on the old side, and "No newline" lines on neither', () => {
    const raw = [...HEADER, '@@ -1,6 +1,4 @@', ' a', '-b', '-c', '\\ No newline at end of file', '+d', ' e', ' f', ''].join('\n')
    const prepared = prepareDiff(raw, { maxLines: 6 })
    if (prepared.kind !== 'diff') throw new Error('expected a diff')
    expect(prepared.source.split('\n')[0]).toBe('@@ -1,3 +1,2 @@') // ' a', '-b', '-c', '\ No newline', '+d' kept: old a b c, new a d
  })

  test('the character cap holds too, and the result stays far below the 100000 the engine draws', () => {
    const raw = [...HEADER, '@@ -0,0 +1,5000 @@', ...Array.from({ length: 5000 }, (_, i) => `+${'x'.repeat(60)} ${i}`), ''].join('\n')
    const prepared = prepareDiff(raw, { maxLines: 100_000 })
    if (prepared.kind !== 'diff') throw new Error('expected a diff')
    expect(prepared.source.length).toBeLessThanOrEqual(90_000)
    expect(prepared.hiddenLines).toBeGreaterThan(0)
  })
})
