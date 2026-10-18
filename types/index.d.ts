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

/** A local or remote branch the Branches picker offers. */
export type GitGraphBranch = {
  /** Full ref name (`refs/heads/main`, `refs/remotes/origin/main`): what `git log` is given. */
  ref: string
  /** `main` or `origin/main`. */
  name: string
  kind: 'branch' | 'remote'
}

/** One changed file of a commit, or of the difference between two points. */
export type GitGraphFile = {
  /** One letter of git's name-status: A M D R C T U. */
  status: string
  path: string
  /** The path before a rename or copy. */
  oldPath?: string
  /** Lines added and removed; null for a binary file. */
  added: number | null
  deleted: number | null
}

export type GitGraphCommitInfo = {
  hash: string
  parents: string[]
  author: string
  authorEmail: string
  authorTimestamp: number
  committer: string
  committerEmail: string
  committerTimestamp: number
  /** The whole message: subject, blank line, body. */
  message: string
}

/** The open details of one commit (the one the user pressed `o` on). */
export type GitGraphDetails =
  | { kind: 'loading'; hash: string }
  | { kind: 'error'; hash: string; message: string }
  | {
      kind: 'ready'
      hash: string
      info: GitGraphCommitInfo
      /** What the files are measured against: the first parent, or the empty tree for a root commit. */
      base: string
      files: GitGraphFile[]
    }

/** The files that differ between two points, `from` the older one; `to` may be the working tree. */
export type GitGraphComparison =
  | { kind: 'loading'; from: string; to: string }
  | { kind: 'error'; from: string; to: string; message: string }
  | { kind: 'ready'; from: string; to: string; files: GitGraphFile[] }

/** The diff screen that replaces the graph in the pane; idle means the graph shows. */
export type GitGraphDiffView =
  | { kind: 'idle' }
  | {
      kind: 'open'
      /** The two points the files differ between (`to` may be 'uncommitted': the working tree). */
      from: string
      to: string
      /** The list the shown file is one of; n / p and the digits walk it. */
      files: GitGraphFile[]
      index: number
      /** `abc1234 (vs def5678)`, `abc1234 ↔ def5678` or `abc1234 ↔ working tree`. */
      range: string
      body:
        | { kind: 'loading' }
        | { kind: 'error'; message: string }
        /** A one-line explanation instead of a diff (binary file, rename without edits). */
        | { kind: 'notice'; text: string }
        | { kind: 'ready'; source: string; hiddenLines: number }
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
      /** Local and remote branches, for the Branches picker. */
      branches: GitGraphBranch[]
      /** The branch (full ref) the log is restricted to; null for all. */
      filter: string | null
    }

/** A write action waiting for the person's Run: what planFor made of it. */
export type GitGraphRunPlan = {
  kind: 'run'
  label: string
  /** git argv, run in order. */
  commands: string[][]
  /** Set for an action that cannot be undone: what is lost. */
  danger?: string
  network: boolean
  mayConflict: boolean
}

/** The action list unfolded under a row (`a`). */
export type GitGraphActionMenu = {
  /** The row it belongs to: a commit's hash, or 'uncommitted'. */
  hash: string
  /** A merge, rebase, cherry-pick or revert waiting for the person, read when the list opened. */
  operation: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null
  /** The surface has a text field: when false, the items that ask for a name are left out. */
  canInput: boolean
  /** The highlighted item, counted over the items of all sections (j / k move it, o runs it). */
  index: number
  /** The text field of an action that needs a name or a message; null while the list shows. */
  form: { key: string; value: string; error?: string } | null
  /** The command of the chosen item, shown in place of the list until Run or Cancel; null otherwise. */
  confirm: { key: string; plan: GitGraphRunPlan } | null
}

/** The branch list unfolded under the toolbar (`l`). */
export type GitGraphBranchMenu = {
  /** The highlighted entry; 0 is `Show All`. */
  index: number
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
      /** The user's choice of graph style; null until they press `g`, then the terminal decides. */
      graphStyle: 'image' | 'text' | null
      /** Hash of the commit row the cursor is on ('uncommitted' for that row); null until j/k or a click. */
      cursor: string | null
      /** The commit whose details are unfolded under its row. */
      details: GitGraphDetails | null
      /** Set while the details are in compare mode. */
      comparison: GitGraphComparison | null
      /** Full ref the log is restricted to; null shows everything. */
      branchFilter: string | null
      /** Find: whether the field is shown, and the text highlighted in the loaded commits. */
      search: { isOpen: boolean; query: string }
      isFetching: boolean
      diff: GitGraphDiffView
      /** The action list under the cursor's row; null when closed. */
      actionMenu: GitGraphActionMenu | null
      /** The branch list under the toolbar; null when closed. */
      branchMenu: GitGraphBranchMenu | null
    }
  }
}
