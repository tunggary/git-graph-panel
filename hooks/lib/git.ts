// Reads the repository through `$.process.run` and turns it into the snapshot the pane draws.

import type { EngineInterface } from 'claude-code'

import type { GitGraphSnapshot } from '../../types'
import { LOG_FORMAT, parseLog, parseStatus } from './parse'
import type { Commit } from './parse'

export type GitOptions = {
  limit: number
  isRemotesShown: boolean
}

type Runner = Pick<EngineInterface, 'process'>

export async function isGitRepo($: Runner): Promise<boolean> {
  try {
    const { exitCode, stdout } = await $.process.run(['git', 'rev-parse', '--is-inside-work-tree'])
    return exitCode === 0 && stdout.trim() === 'true'
  } catch {
    return false
  }
}

export async function loadSnapshot($: Runner, { limit, isRemotesShown }: GitOptions): Promise<GitGraphSnapshot> {
  if (!(await isGitRepo($))) return { kind: 'not-repo' }
  try {
    const git = (args: string[]) => $.process.run(['git', ...args], { env: { GIT_OPTIONAL_LOCKS: '0' } })

    const headRun = await git(['rev-parse', '--verify', '-q', 'HEAD'])
    const head = headRun.exitCode === 0 ? headRun.stdout.trim() : null

    // A repository without commits has nothing to log (and `HEAD` would be an error).
    let commits: Commit[] = []
    if (head !== null) {
      const revs = isRemotesShown ? ['--all'] : ['--branches', '--tags', 'HEAD']
      const log = await git([
        '-c', 'log.showSignature=false',
        'log', '--date-order', '-z', '--decorate=full', `--format=${LOG_FORMAT}`,
        `-n${limit + 1}`, ...revs,
      ])
      if (log.exitCode !== 0) return { kind: 'error', message: log.stderr.trim() || `git log exited with ${log.exitCode}` }
      commits = parseLog(log.stdout)
    }
    if (!isRemotesShown) commits = commits.map(c => ({ ...c, refs: c.refs.filter(r => r.kind !== 'remote') }))

    const status = await git(['status', '--porcelain=v1', '-z'])
    const changes = status.exitCode === 0 ? parseStatus(status.stdout) : []

    return { kind: 'ready', commits: commits.slice(0, limit), hasMore: commits.length > limit, head, changes }
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) }
  }
}
