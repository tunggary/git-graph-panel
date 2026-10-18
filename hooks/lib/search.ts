// Find: which loaded commits match a query. Pure.

import type { GitGraphCommit } from '../../types'

const norm = (text: string): string => text.toLowerCase()

/** The texts a query is looked for in: message, author, hash and the names of the refs on the commit. */
const haystacks = (commit: GitGraphCommit): string[] => [
  commit.subject,
  commit.author,
  commit.hash,
  ...commit.refs.map(ref => ref.name),
]

/** Whether `text` holds `query` (case-insensitive); an empty query holds in nothing. */
export const containsQuery = (text: string, query: string): boolean => {
  const needle = norm(query.trim())
  return needle !== '' && norm(text).includes(needle)
}

export const isMatch = (commit: GitGraphCommit, query: string): boolean => {
  return haystacks(commit).some(text => containsQuery(text, query))
}

/** Hashes of the matching commits, in the order given (newest first). */
export const findMatches = (commits: readonly GitGraphCommit[], query: string): string[] =>
  commits.filter(commit => isMatch(commit, query)).map(commit => commit.hash)

/** `text` cut into runs, the occurrences of `query` (case-insensitive) marked. */
export function highlightParts(text: string, query: string): { text: string; isMatch: boolean }[] {
  const needle = norm(query.trim())
  if (needle === '') return [{ text, isMatch: false }]
  const lower = norm(text)
  // Lower-casing can change a string's length (İ); fall back to no highlight rather than cut the wrong place.
  if (lower.length !== text.length) return [{ text, isMatch: false }]
  const parts: { text: string; isMatch: boolean }[] = []
  let at = 0
  for (let hit = lower.indexOf(needle); hit >= 0; hit = lower.indexOf(needle, at)) {
    if (hit > at) parts.push({ text: text.slice(at, hit), isMatch: false })
    parts.push({ text: text.slice(hit, hit + needle.length), isMatch: true })
    at = hit + needle.length
  }
  if (at < text.length) parts.push({ text: text.slice(at), isMatch: false })
  return parts.length > 0 ? parts : [{ text, isMatch: false }]
}

/** The hash `step` (+1 next, -1 previous) matches away from `from`, wrapping; `from` need not be a match. */
export function stepMatch(order: readonly string[], matches: readonly string[], from: string | null, step: 1 | -1): string | null {
  if (matches.length === 0) return null
  const set = new Set(matches)
  const start = from === null ? (step === 1 ? -1 : order.length) : order.indexOf(from)
  for (let i = 1; i <= order.length; i++) {
    const hash = order[(((start + step * i) % order.length) + order.length) % order.length]
    if (hash !== undefined && set.has(hash)) return hash
  }
  return null
}
