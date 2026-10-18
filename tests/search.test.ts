import { describe, expect, test } from 'claude-code/testing'

import type { GitGraphCommit } from '../types'
import { containsQuery, findMatches, highlightParts, isMatch, stepMatch } from '../hooks/lib/search'

const commit = (hash: string, subject: string, author = 'Dana Kim', refs: GitGraphCommit['refs'] = []): GitGraphCommit => ({
  hash,
  parents: [],
  author,
  timestamp: 0,
  refs,
  subject,
})

const commits = [
  commit('aaaa1111', 'feat: 로그인 폼', 'Dana Kim', [{ kind: 'branch', name: 'feature/login', isCurrent: false }]),
  commit('bbbb2222', 'fix: Crash on start', '한지우'),
  commit('cccc3333', 'docs: readme', 'Sam', [{ kind: 'tag', name: 'v1.0.0', isCurrent: false }]),
  commit('dddd4444', 'chore: LOGIN cleanup'),
]

describe('findMatches', () => {
  test('message, author, hash and ref names, ignoring case', () => {
    expect(findMatches(commits, 'login')).toEqual(['aaaa1111', 'dddd4444']) // one by branch name, one by message
    expect(findMatches(commits, '로그인')).toEqual(['aaaa1111'])
    expect(findMatches(commits, '한지')).toEqual(['bbbb2222'])
    expect(findMatches(commits, 'BBBB')).toEqual(['bbbb2222'])
    expect(findMatches(commits, 'v1.0')).toEqual(['cccc3333'])
  })

  test('an empty or blank query matches nothing', () => {
    expect(findMatches(commits, '')).toEqual([])
    expect(findMatches(commits, '   ')).toEqual([])
    expect(isMatch(commits[0]!, '')).toBe(false)
    expect(containsQuery('abc', '')).toBe(false)
  })
})

describe('highlightParts', () => {
  test('cuts the text around every occurrence', () => {
    expect(highlightParts('Fix the fix', 'fix')).toEqual([
      { text: 'Fix', isMatch: true },
      { text: ' the ', isMatch: false },
      { text: 'fix', isMatch: true },
    ])
    expect(highlightParts('nothing here', 'zzz')).toEqual([{ text: 'nothing here', isMatch: false }])
    expect(highlightParts('plain', '')).toEqual([{ text: 'plain', isMatch: false }])
  })
})

describe('stepMatch', () => {
  const order = ['u', 'a', 'b', 'c', 'd']

  test('the next match after the cursor, wrapping at the end', () => {
    expect(stepMatch(order, ['b', 'd'], 'a', 1)).toBe('b')
    expect(stepMatch(order, ['b', 'd'], 'b', 1)).toBe('d')
    expect(stepMatch(order, ['b', 'd'], 'd', 1)).toBe('b')
  })

  test('the previous one, wrapping at the top; no cursor starts from the ends', () => {
    expect(stepMatch(order, ['b', 'd'], 'd', -1)).toBe('b')
    expect(stepMatch(order, ['b', 'd'], 'b', -1)).toBe('d')
    expect(stepMatch(order, ['b', 'd'], null, 1)).toBe('b')
    expect(stepMatch(order, ['b', 'd'], null, -1)).toBe('d')
  })

  test('a cursor on a row that is not a match still steps from where it is; no matches, no step', () => {
    expect(stepMatch(order, ['d'], 'a', 1)).toBe('d')
    expect(stepMatch(order, ['a'], 'd', -1)).toBe('a')
    expect(stepMatch(order, [], 'a', 1)).toBeNull()
  })
})
