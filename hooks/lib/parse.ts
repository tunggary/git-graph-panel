// Parsers for the plain-text output of `git log` and `git status`.
// Pure functions: no engine access, so they are unit-tested directly.

import type { GitGraphBranch, GitGraphCommit, GitGraphCommitInfo, GitGraphFile, GitGraphRef, GitGraphStatusEntry } from '../../types'

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

/** `git show --no-patch --format=SHOW_FORMAT`: the message (`%B`) comes last, so it may hold anything. */
export const SHOW_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%cn', '%ce', '%ct', '%B'].join('%x1f')

export function parseShow(output: string): GitGraphCommitInfo | null {
  const [hash = '', parents = '', author = '', authorEmail = '', at = '', committer = '', committerEmail = '', ct = '', ...rest] =
    output.split(FIELD)
  if (hash.trim() === '') return null
  return {
    hash: hash.trim(),
    parents: parents.split(' ').filter(p => p !== ''),
    author,
    authorEmail,
    authorTimestamp: Number(at),
    committer,
    committerEmail,
    committerTimestamp: Number(ct),
    message: rest.join(FIELD).trim(),
  }
}

type Numstat = { path: string; oldPath?: string; added: number | null; deleted: number | null }
type NameStatus = { status: string; path: string; oldPath?: string }

/** `git diff --numstat -z`: `added TAB deleted TAB path NUL`, a rename `added TAB deleted TAB NUL old NUL new NUL`; `-` counts mean binary. */
export function parseNumstat(output: string): Numstat[] {
  const entries: Numstat[] = []
  const parts = output.split('\u0000')
  for (let i = 0; i < parts.length; i++) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(parts[i] ?? '')
    if (!match) continue
    const count = (text: string | undefined): number | null => (text === '-' || text === undefined ? null : Number(text))
    const [, added, deleted, path = ''] = match
    if (path === '') {
      entries.push({ path: parts[i + 2] ?? '', oldPath: parts[i + 1] ?? '', added: count(added), deleted: count(deleted) })
      i += 2
    } else {
      entries.push({ path, added: count(added), deleted: count(deleted) })
    }
  }
  return entries
}

/** `git diff --name-status -z`: `M NUL path NUL`, a rename or copy `R100 NUL old NUL new NUL`. */
export function parseNameStatus(output: string): NameStatus[] {
  const entries: NameStatus[] = []
  const parts = output.split('\u0000')
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i] ?? ''
    if (code === '') continue
    const status = code.slice(0, 1)
    if (status === 'R' || status === 'C') {
      entries.push({ status, oldPath: parts[i + 1] ?? '', path: parts[i + 2] ?? '' })
      i += 2
    } else {
      entries.push({ status, path: parts[i + 1] ?? '' })
      i += 1
    }
  }
  return entries
}

/** The files in `--name-status` order, each with its counts from `--numstat` (a file without any counts is binary). */
export function mergeFiles(nameStatus: readonly NameStatus[], numstat: readonly Numstat[]): GitGraphFile[] {
  const counts = new Map(numstat.map(entry => [entry.path, entry]))
  return nameStatus.map(entry => {
    const count = counts.get(entry.path)
    return {
      ...entry,
      added: count?.added ?? null,
      deleted: count?.deleted ?? null,
    }
  })
}

/** `git for-each-ref --format=%(refname) refs/heads refs/remotes`, without `origin/HEAD`. */
export function parseBranches(output: string): GitGraphBranch[] {
  const branches: GitGraphBranch[] = []
  for (const ref of output.split('\n')) {
    if (ref.startsWith('refs/heads/')) {
      branches.push({ ref, name: ref.slice('refs/heads/'.length), kind: 'branch' })
    } else if (ref.startsWith('refs/remotes/') && !ref.endsWith('/HEAD')) {
      branches.push({ ref, name: ref.slice('refs/remotes/'.length), kind: 'remote' })
    }
  }
  return branches
}

/** `YYYY-MM-DD HH:mm` in the offset given (minutes east of UTC); defaults to the local time zone. */
export function formatDateTime(timestamp: number, offsetMinutes?: number): string {
  const offset = offsetMinutes ?? -new Date(timestamp * 1000).getTimezoneOffset()
  const d = new Date((timestamp + offset * 60) * 1000)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`
}
