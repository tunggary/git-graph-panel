import { describe, expect, test } from 'claude-code/testing'

import { formatDateTime, mergeFiles, parseBranches, parseNameStatus, parseNumstat, parseShow, SHOW_FORMAT } from '../hooks/lib/parse'

const NUL = '\u0000'
const FIELD = '\u001f'

describe('parseNumstat', () => {
  test('counts per path; a binary file has none', () => {
    expect(parseNumstat(`12\t3\tsrc/a.ts${NUL}-\t-\tlogo.png${NUL}`)).toEqual([
      { path: 'src/a.ts', added: 12, deleted: 3 },
      { path: 'logo.png', added: null, deleted: null },
    ])
  })

  test('a rename carries both paths, and the entries after it stay in step', () => {
    expect(parseNumstat(`0\t0\t${NUL}old name.txt${NUL}new name.txt${NUL}5\t1\tz.ts${NUL}`)).toEqual([
      { path: 'new name.txt', oldPath: 'old name.txt', added: 0, deleted: 0 },
      { path: 'z.ts', added: 5, deleted: 1 },
    ])
  })

  test('paths with spaces, tabs and Korean survive; empty output is no files', () => {
    expect(parseNumstat(`1\t2\t한글 폴더/파일\t이름.ts${NUL}`)).toEqual([{ path: '한글 폴더/파일\t이름.ts', added: 1, deleted: 2 }])
    expect(parseNumstat('')).toEqual([])
  })
})

describe('parseNameStatus', () => {
  test('one letter and a path; a rename or copy has two paths and its similarity is dropped', () => {
    expect(parseNameStatus(`M${NUL}a.ts${NUL}A${NUL}b.ts${NUL}D${NUL}c.ts${NUL}R087${NUL}old.ts${NUL}new.ts${NUL}C100${NUL}x${NUL}y${NUL}T${NUL}t${NUL}`)).toEqual([
      { status: 'M', path: 'a.ts' },
      { status: 'A', path: 'b.ts' },
      { status: 'D', path: 'c.ts' },
      { status: 'R', oldPath: 'old.ts', path: 'new.ts' },
      { status: 'C', oldPath: 'x', path: 'y' },
      { status: 'T', path: 't' },
    ])
    expect(parseNameStatus('')).toEqual([])
  })
})

describe('mergeFiles', () => {
  test('keeps the name-status order and joins the counts by path; a rename joins on its new path', () => {
    const files = mergeFiles(
      parseNameStatus(`R100${NUL}old.txt${NUL}new.txt${NUL}M${NUL}a.ts${NUL}A${NUL}logo.png${NUL}`),
      parseNumstat(`3\t1\ta.ts${NUL}-\t-\tlogo.png${NUL}0\t0\t${NUL}old.txt${NUL}new.txt${NUL}`),
    )
    expect(files).toEqual([
      { status: 'R', oldPath: 'old.txt', path: 'new.txt', added: 0, deleted: 0 },
      { status: 'M', path: 'a.ts', added: 3, deleted: 1 },
      { status: 'A', path: 'logo.png', added: null, deleted: null },
    ])
  })
})

describe('parseShow', () => {
  const record = (message: string) =>
    ['h'.repeat(40), `${'a'.repeat(40)} ${'b'.repeat(40)}`, 'Dana Kim', 'dana@example.com', '1704067200', 'Sam', 'sam@example.com', '1704070800', message].join(FIELD)

  test('reads the people, the times, the parents and the whole message', () => {
    const info = parseShow(record('feat: 제목\n\n본문 | 첫 줄\n\n- 목록\n\n'))
    expect(info).toEqual({
      hash: 'h'.repeat(40),
      parents: ['a'.repeat(40), 'b'.repeat(40)],
      author: 'Dana Kim',
      authorEmail: 'dana@example.com',
      authorTimestamp: 1704067200,
      committer: 'Sam',
      committerEmail: 'sam@example.com',
      committerTimestamp: 1704070800,
      message: 'feat: 제목\n\n본문 | 첫 줄\n\n- 목록',
    })
  })

  test('a root commit has no parents; no output is no commit; the format ends with the message', () => {
    expect(parseShow(record('x').replace(`${'a'.repeat(40)} ${'b'.repeat(40)}`, ''))?.parents).toEqual([])
    expect(parseShow('')).toBeNull()
    expect(SHOW_FORMAT.endsWith('%B')).toBe(true)
  })
})

describe('parseBranches', () => {
  test('local and remote branches, without the remote HEAD', () => {
    expect(parseBranches('refs/heads/develop\nrefs/heads/feature/a\nrefs/remotes/origin/HEAD\nrefs/remotes/origin/main\n')).toEqual([
      { ref: 'refs/heads/develop', name: 'develop', kind: 'branch' },
      { ref: 'refs/heads/feature/a', name: 'feature/a', kind: 'branch' },
      { ref: 'refs/remotes/origin/main', name: 'origin/main', kind: 'remote' },
    ])
    expect(parseBranches('')).toEqual([])
  })
})

describe('formatDateTime', () => {
  test('YYYY-MM-DD HH:mm in the offset given', () => {
    expect(formatDateTime(1704067200, 0)).toBe('2024-01-01 00:00')
    expect(formatDateTime(1704067200, 540)).toBe('2024-01-01 09:00')
    expect(formatDateTime(1704067200, -300)).toBe('2023-12-31 19:00')
  })
})
