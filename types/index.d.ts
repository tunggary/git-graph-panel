// State contract of git-graph-panel: the values the pane draws from, held by the host in $.state.

export type GitGraphRef = {
  kind: 'head' | 'branch' | 'remote' | 'tag'
  name: string
  /** True for the checked-out local branch (and for a detached HEAD). */
  isCurrent: boolean
}

export type GitGraphCommit = {
  hash: string
  parents: string[]
  author: string
  /** Author date, seconds since the epoch. */
  timestamp: number
  refs: GitGraphRef[]
  subject: string
}

export type GitGraphStatusEntry = {
  /** One of M A D R C U ?? */
  code: string
  path: string
}

export type GitGraphSnapshot =
  | { kind: 'loading' }
  | { kind: 'not-repo' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready'
      commits: GitGraphCommit[]
      /** True when git has more commits than were loaded (shows "Load more"). */
      hasMore: boolean
      /** Hash HEAD points at; null in a repository without commits. */
      head: string | null
      changes: GitGraphStatusEntry[]
    }

declare module 'claude-code' {
  interface PluginState {
    'git-graph-panel': {
      snapshot: GitGraphSnapshot
      /** Include refs/remotes in the graph. */
      isRemotesShown: boolean
      /** Number of commits to load. */
      limit: number
      /** The uncommitted-files list is unfolded. */
      isChangesOpen: boolean
    }
  }
}
