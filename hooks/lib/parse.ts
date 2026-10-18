// Parsers for the plain-text output of `git log` and `git status`.
// Pure functions: no engine access, so they are unit-tested directly.

import type { GitGraphCommit, GitGraphRef, GitGraphStatusEntry } from '../../types'

export type Ref = GitGraphRef
export type Commit = GitGraphCommit
export type StatusEntry = GitGraphStatusEntry

/** Field and record separators used in LOG_FORMAT; neither can occur in a subject or a ref name. */
const FIELD = '\u001f'
const RECORD = '\u0000'

/**
 * `git log -z --decorate=full --format=LOG_FORMAT`: fields split by U+001F,
 * records by NUL, so `|`, quotes or any text in a subject cannot break parsing.
 */
export const LOG_FORMAT = ['%H', '%P', '%an', '%at', '%D', '%s'].join('%x1f')

export function parseRefs(decoration: string): Ref[] {
  const refs: Ref[] = []
  for (const raw of decoration.split(', ')) {
    const item = raw.trim()
    if (item === '') continue
    if (item === 'HEAD') {
      refs.push({ kind: 'head', name: 'HEAD', isCurrent: true })
    } else if (item.startsWith('HEAD -> refs/heads/')) {
      refs.push({ kind: 'branch', name: item.slice('HEAD -> refs/heads/'.length), isCurrent: true })
    } else if (item.startsWith('tag: refs/tags/')) {
      refs.push({ kind: 'tag', name: item.slice('tag: refs/tags/'.length), isCurrent: false })
    } else if (item.startsWith('refs/heads/')) {
      refs.push({ kind: 'branch', name: item.slice('refs/heads/'.length), isCurrent: false })
    } else if (item.startsWith('refs/remotes/')) {
      const name = item.slice('refs/remotes/'.length)
      if (!name.endsWith('/HEAD')) refs.push({ kind: 'remote', name, isCurrent: false })
    }
  }
  return refs
}

export function parseLog(output: string): Commit[] {
  const commits: Commit[] = []
  for (const record of output.split(RECORD)) {
    if (record.trim() === '') continue
    const [hash = '', parents = '', author = '', at = '', decoration = '', subject = ''] = record.split(FIELD)
    commits.push({
      hash: hash.trim(),
      parents: parents.split(' ').filter(p => p !== ''),
      author,
      timestamp: Number(at),
      refs: parseRefs(decoration),
      subject,
    })
  }
  return commits
}

/** Parses `git status --porcelain=v1 -z`: `XY path` entries, a rename followed by its origin path. */
export function parseStatus(output: string): StatusEntry[] {
  const entries: StatusEntry[] = []
  const parts = output.split('\u0000')
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? ''
    if (part.length < 4) continue
    const xy = part.slice(0, 2)
    const path = part.slice(3)
    const [x, y] = [xy[0] ?? ' ', xy[1] ?? ' ']
    if (x === 'R' || x === 'C') i++ // skip the origin path of a rename or copy
    const code = xy === '??' ? '??' : x !== ' ' ? x : y
    entries.push({ code, path })
  }
  return entries
}

/** `MM-DD HH:mm` in the offset given (minutes east of UTC); defaults to the local time zone. */
export function formatDate(timestamp: number, offsetMinutes?: number): string {
  const offset = offsetMinutes ?? -new Date(timestamp * 1000).getTimezoneOffset()
  const d = new Date((timestamp + offset * 60) * 1000)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`
}
