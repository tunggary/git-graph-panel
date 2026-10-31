// Reads the repository through `$.process.run` and turns it into the snapshot the pane draws.

import type { EngineInterface } from 'claude-code'

import type { GitGraphCommitInfo, GitGraphFile, GitGraphSnapshot } from '../../types'
import { LOG_FORMAT, SHOW_FORMAT, mergeFiles, parseBranches, parseLog, parseNameStatus, parseNumstat, parseShow, parseStatus } from './parse'
import type { Commit } from './parse'

export type GitOptions = {
  limit: number
  isRemotesShown: boolean
  /** Full ref the log is restricted to; null for all branches, remotes, tags and HEAD. */
  branchFilter?: string | null
}

/** The row id of the working tree in the graph; as a `to` it means "the working tree". */
export const UNCOMMITTED = 'uncommitted'
/** git's empty tree: what a root commit's files are measured against. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

type Runner = Pick<EngineInterface, 'process'>

export async function isGitRepo($: Runner): Promise<boolean> {
  try {
    const { exitCode, stdout } = await $.process.run(['git', 'rev-parse', '--is-inside-work-tree'])
    return exitCode === 0 && stdout.trim() === 'true'
  } catch {
    return false
  }
}

export async function loadSnapshot($: Runner, { limit, isRemotesShown, branchFilter = null }: GitOptions): Promise<GitGraphSnapshot> {
  if (!(await isGitRepo($))) return { kind: 'not-repo' }
  try {
    const git = (args: string[]) => $.process.run(['git', ...args], { env: { GIT_OPTIONAL_LOCKS: '0' } })

    const headRun = await git(['rev-parse', '--verify', '-q', 'HEAD'])
    const head = headRun.exitCode === 0 ? headRun.stdout.trim() : null

    const refs = await git(['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes'])
    const branches = refs.exitCode === 0 ? parseBranches(refs.stdout) : []
    // A filter whose branch is gone (pruned by a fetch) falls back to showing everything.
    const filter = branchFilter !== null && branches.some(branch => branch.ref === branchFilter) ? branchFilter : null

    // A repository without commits has nothing to log (and `HEAD` would be an error).
    let commits: Commit[] = []
    if (head !== null) {
      // `--exclude` applies to the `--all` after it; the stash is not part of the graph.
      // Branches, remotes, tags and HEAD only, as Git Graph reads them: `--all` would also pull in stashes and
      // tools' private refs (cmux keeps `refs/cmux/last-turn/*`).
      const everything = isRemotesShown ? ['--branches', '--remotes', '--tags', 'HEAD'] : ['--branches', '--tags', 'HEAD']
      const revs = filter === null ? everything : [filter]
      const log = await git([
        '-c', 'log.showSignature=false',
        'log', '--date-order', '-z', '--decorate=full', `--format=${LOG_FORMAT}`,
        `-n${limit + 1}`, ...revs,
      ])
      if (log.exitCode !== 0) return { kind: 'error', message: log.stderr.trim() || `git log exited with ${log.exitCode}` }
      commits = parseLog(log.stdout)
    }
    if (!isRemotesShown) commits = commits.map(c => ({ ...c, refs: c.refs.filter(r => r.kind !== 'remote') }))

    const status = await git(['status', '--porcelain=v1', '-z', '--untracked-files=all'])
    let changes = status.exitCode === 0 ? parseStatus(status.stdout) : []
    // The uncommitted row hangs off HEAD; a branch that does not contain it leaves the row nowhere to attach.
    const shown = commits.slice(0, limit)
    if (filter !== null && !shown.some(commit => commit.hash === head)) changes = []

    return { kind: 'ready', commits: shown, hasMore: commits.length > limit, head, changes, branches, filter }
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) }
  }
}

async function gitOrThrow($: Runner, args: string[]) {
  const run = await $.process.run(['git', ...args], { env: { GIT_OPTIONAL_LOCKS: '0' } })
  if (run.exitCode !== 0) throw new Error(run.stderr.trim().split('\n')[0] || `git ${args[0]} exited with ${run.exitCode}`)
  return run
}

/** The two ends of a `git diff`: `to` is the working tree for UNCOMMITTED, which `git diff <from>` compares against. */
const range = (from: string, to: string): string[] => (to === UNCOMMITTED ? [from] : [from, to])

/** The files that differ between `from` and `to`, with status and line counts. */
export async function loadChangedFiles($: Runner, from: string, to: string): Promise<GitGraphFile[]> {
  const base = ['diff', '-M', '-z', '--no-color', '--no-ext-diff']
  const [numstat, nameStatus] = await Promise.all([
    gitOrThrow($, [...base, '--numstat', ...range(from, to), '--']),
    gitOrThrow($, [...base, '--name-status', ...range(from, to), '--']),
  ])
  const tracked = mergeFiles(parseNameStatus(nameStatus.stdout), parseNumstat(numstat.stdout))
  return to === UNCOMMITTED ? [...tracked, ...(await loadUntrackedFiles($))] : tracked
}

/** `git diff --no-index` exits 1 when the files differ, which is the success case here. */
async function diffNoIndex($: Runner, args: string[], path: string) {
  const run = await $.process.run(['git', 'diff', '--no-index', '--no-color', '--no-ext-diff', ...args, '--', '/dev/null', path], { env: { GIT_OPTIONAL_LOCKS: '0' } })
  if (run.exitCode > 1) throw new Error(run.stderr.trim().split('\n')[0] || `git diff exited with ${run.exitCode}`)
  return run
}

/** The untracked files (directories expanded), as added files; the working tree's `git diff HEAD` leaves them out. */
async function loadUntrackedFiles($: Runner): Promise<GitGraphFile[]> {
  const listed = await gitOrThrow($, ['ls-files', '--others', '--exclude-standard', '-z'])
  const paths = listed.stdout.split('\u0000').filter(path => path !== '')
  return Promise.all(
    paths.map(async path => {
      const [count] = parseNumstat((await diffNoIndex($, ['--numstat', '-z'], path)).stdout)
      return { status: 'A', path, added: count?.added ?? null, deleted: count?.deleted ?? null, isUntracked: true as const }
    }),
  )
}

/** A commit's message and author, and its files against its first parent (as Git Graph shows a merge). */
export async function loadCommitDetails($: Runner, hash: string): Promise<{ info: GitGraphCommitInfo; base: string; files: GitGraphFile[] }> {
  const show = await gitOrThrow($, ['-c', 'log.showSignature=false', 'show', '--no-patch', '--no-color', `--format=${SHOW_FORMAT}`, hash])
  const info = parseShow(show.stdout)
  if (info === null) throw new Error(`no such commit: ${hash}`)
  const base = info.parents[0] ?? EMPTY_TREE
  return { info, base, files: await loadChangedFiles($, base, hash) }
}

/** The unified diff of one file between two points. */
export async function loadFileDiff($: Runner, from: string, to: string, file: GitGraphFile): Promise<string> {
  if (file.isUntracked) return (await diffNoIndex($, ['-U3'], file.path)).stdout
  const paths = file.oldPath === undefined ? [file.path] : [file.oldPath, file.path]
  const run = await gitOrThrow($, ['diff', '-M', '--no-color', '--no-ext-diff', '-U3', ...range(from, to), '--', ...paths])
  return run.stdout
}

/** `git fetch --all --prune`. Never prompts for credentials. */
export async function fetchAll($: Runner): Promise<{ ok: true } | { ok: false; message: string }> {
  const run = await $.process.run(['git', 'fetch', '--all', '--prune'], { env: { GIT_TERMINAL_PROMPT: '0' }, timeoutMs: 120_000 })
  if (run.exitCode === 0) return { ok: true }
  const first = run.stderr.split('\n').find(line => line.trim() !== '')
  return { ok: false, message: first?.trim() ?? `git fetch exited with ${run.exitCode}` }
}
