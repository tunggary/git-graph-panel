import { describe, expect, test } from 'claude-code/testing'

import { formatDate, LOG_FORMAT, parseLog, parseRefs, parseStatus } from '../hooks/lib/parse'

const record = (...fields: string[]) => fields.join('\u001f')

describe('parseRefs', () => {
  test('classifies branches, remotes, tags and HEAD', () => {
    const refs = parseRefs(
      'HEAD -> refs/heads/develop, tag: refs/tags/v1.0.0, refs/remotes/origin/develop, refs/remotes/origin/HEAD, refs/heads/main',
    )
    expect(refs).toEqual([
      { kind: 'branch', name: 'develop', isCurrent: true },
      { kind: 'tag', name: 'v1.0.0', isCurrent: false },
      { kind: 'remote', name: 'origin/develop', isCurrent: false },
      { kind: 'branch', name: 'main', isCurrent: false },
    ])
  })

  test('a detached HEAD is its own ref', () => {
    expect(parseRefs('HEAD, refs/heads/main')).toEqual([
      { kind: 'head', name: 'HEAD', isCurrent: true },
      { kind: 'branch', name: 'main', isCurrent: false },
    ])
  })

  test('a local branch named like a remote stays a local branch', () => {
    expect(parseRefs('refs/heads/origin/main')).toEqual([{ kind: 'branch', name: 'origin/main', isCurrent: false }])
  })

  test('no decoration, no refs', () => {
    expect(parseRefs('')).toEqual([])
  })
})

describe('parseLog', () => {
  test('format uses unit-separator fields', () => {
    expect(LOG_FORMAT).toBe('%H%x1f%P%x1f%an%x1f%at%x1f%D%x1f%s')
  })

  test('splits NUL-terminated records and keeps awkward subjects whole', () => {
    const out =
      record('a'.repeat(40), 'b'.repeat(40) + ' ' + 'c'.repeat(40), 'Dana Kim', '1704067200', 'HEAD -> refs/heads/main', 'fix: a | b | "c" \'d\' 한국어') +
      '\u0000' +
      record('b'.repeat(40), '', "Sam O'Neil", '1704060000', '', 'chore: root') +
      '\u0000'
    const commits = parseLog(out)

    expect(commits).toHaveLength(2)
    expect(commits[0]).toEqual({
      hash: 'a'.repeat(40),
      parents: ['b'.repeat(40), 'c'.repeat(40)],
      author: 'Dana Kim',
      timestamp: 1704067200,
      refs: [{ kind: 'branch', name: 'main', isCurrent: true }],
      subject: 'fix: a | b | "c" \'d\' 한국어',
    })
    expect(commits[1]?.parents).toEqual([])
    expect(commits[1]?.author).toBe("Sam O'Neil")
  })

  test('empty output is no commits', () => {
    expect(parseLog('')).toEqual([])
  })
})

describe('parseStatus', () => {
  test('maps the porcelain columns to one code', () => {
    const out = ' M a.txt\u0000A  b.txt\u0000?? c.txt\u0000 D d.txt\u0000MM e.txt\u0000'
    expect(parseStatus(out)).toEqual([
      { code: 'M', path: 'a.txt' },
      { code: 'A', path: 'b.txt' },
      { code: '??', path: 'c.txt' },
      { code: 'D', path: 'd.txt' },
      { code: 'M', path: 'e.txt' },
    ])
  })

  test('a rename consumes its origin path', () => {
    expect(parseStatus('R  new name.txt\u0000old name.txt\u0000?? x.txt\u0000')).toEqual([
      { code: 'R', path: 'new name.txt' },
      { code: '??', path: 'x.txt' },
    ])
  })

  test('clean tree', () => {
    expect(parseStatus('')).toEqual([])
  })
})

describe('formatDate', () => {
  test('formats as MM-DD HH:mm in the given offset', () => {
    expect(formatDate(1704067200, 0)).toBe('01-01 00:00')
    expect(formatDate(1704067200, 540)).toBe('01-01 09:00')
    expect(formatDate(1704067200, -300)).toBe('12-31 19:00')
  })

  test('defaults to the local time zone', () => {
    const local = -new Date(1704067200 * 1000).getTimezoneOffset()
    expect(formatDate(1704067200)).toBe(formatDate(1704067200, local))
  })
})
