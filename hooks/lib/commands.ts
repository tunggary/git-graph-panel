// The write actions of the graph (Git Graph's context menu), as data: which actions a row offers, and for one action
// the git argv to run, how risky it is and whether the protected-branch policy forbids it. Pure: no `$` in here.
// Commands are argv arrays, never a shell string, so a branch name or message cannot be read as anything else.

import type { GitGraphCommit, GitGraphSnapshot } from '../../types'

export type Operation = 'merge' | 'rebase' | 'cherry-pick' | 'revert'

export type Target =
  | { kind: 'commit'; hash: string; subject: string; parents: readonly string[] }
  | { kind: 'branch'; name: string }
  | { kind: 'remote'; name: string }
  | { kind: 'tag'; name: string }
  | { kind: 'uncommitted' }

/** What the menu and the plans depend on besides the target. */
export type Facts = {
  /** The hash HEAD points at. */
  head: string | null
  /** The checked-out branch; null on a detached HEAD. */
  current: string | null
  localBranches: readonly string[]
  protectedBranches: readonly string[]
  /** A merge, rebase, cherry-pick or revert that stopped and waits for the person. */
  operation: Operation | null
  /** Push: the branch's upstream (`origin/main`), null for none. Read when the action is chosen. */
  upstream?: string | null
  /** Delete: the branch is merged into HEAD, so `-d` works. Read when the action is chosen. */
  isMerged?: boolean
}

/** A field the action asks for before it can run. */
export type Prompt = { label: string; placeholder: string; kind: 'branch' | 'tag' | 'text'; initial?: string; isOptional?: boolean }

export type MenuItem = {
  /** Unique within the row: the target and the action. */
  key: string
  target: Target
  id: string
  label: string
  prompt?: Prompt
  /** Destructive: marked in the list (the confirmation carries the warning). */
  isRisky?: boolean
}
export type MenuSection = { title: string; items: MenuItem[] }

export type Plan =
  | {
      kind: 'run'
      label: string
      /** Run in order; the first failure stops the rest. */
      commands: string[][]
      /** Set for an action that cannot be undone: what is lost. */
      danger?: string
      network: boolean
      /** The command can stop on a conflict that the person resolves in the working tree. */
      mayConflict: boolean
    }
  | { kind: 'copy'; label: string; text: string }
  | { kind: 'blocked'; reason: string }

export const PROTECTED_REASON = 'protected branch: use a pull request'
export const DEFAULT_PROTECTED = 'main,develop'
/** Where tags and the new upstream of a branch go. */
export const REMOTE = 'origin'

/** `main, develop` -> ['main', 'develop']. */
export function parseProtected(value: unknown): string[] {
  return String(value ?? DEFAULT_PROTECTED)
    .split(',')
    .map(name => name.trim())
    .filter(name => name !== '')
}

/** `origin/feature/x` -> `{ remote: 'origin', branch: 'feature/x' }`. */
export function splitRemote(name: string): { remote: string; branch: string } {
  const at = name.indexOf('/')
  return at < 0 ? { remote: REMOTE, branch: name } : { remote: name.slice(0, at), branch: name.slice(at + 1) }
}

const SAFE_ARG = /^[\w@%+=:,./-]+$/
/** How a command reads in a question or a status line (display only: it is never run as text). */
export const displayCommand = (argv: readonly string[]): string =>
  ['git', ...argv].map(arg => (SAFE_ARG.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`)).join(' ')

/** The rows' refs as targets; a detached `HEAD` pill is the commit itself and adds none. */
export function rowTargets(commit: GitGraphCommit): Target[] {
  const refs = commit.refs.flatMap((ref): Target[] =>
    ref.kind === 'branch' || ref.kind === 'remote' || ref.kind === 'tag' ? [{ kind: ref.kind, name: ref.name }] : [],
  )
  return [{ kind: 'commit', hash: commit.hash, subject: commit.subject, parents: commit.parents }, ...refs]
}

type Ready = Extract<GitGraphSnapshot, { kind: 'ready' }>

export function factsOf(snap: Ready, operation: Operation | null, protectedBranches: readonly string[]): Facts {
  const current = snap.commits.flatMap(commit => commit.refs).find(ref => ref.kind === 'branch' && ref.isCurrent)
  return {
    head: snap.head,
    current: current?.name ?? null,
    localBranches: snap.branches.filter(branch => branch.kind === 'branch').map(branch => branch.name),
    protectedBranches,
    operation,
  }
}

const keyOf = (target: Target): string => (target.kind === 'commit' || target.kind === 'uncommitted' ? target.kind : `${target.kind}:${target.name}`)

const titleOf = (target: Target): string => {
  switch (target.kind) {
    case 'commit': return `Commit ${target.hash.slice(0, 7)}`
    case 'branch': return `Branch ${target.name}`
    case 'remote': return `Remote branch ${target.name}`
    case 'tag': return `Tag ${target.name}`
    case 'uncommitted': return 'Uncommitted Changes'
  }
}

const BRANCH_PROMPT: Prompt = { label: 'Name', placeholder: 'branch name', kind: 'branch' }

/** The actions a row offers, a section for the commit and one for each of its refs. `canInput`: the surface has a text field. */
export function rowMenu(snap: Ready, hash: string, operation: Operation | null, protectedBranches: readonly string[], canInput: boolean): MenuSection[] {
  const facts = factsOf(snap, operation, protectedBranches)
  const commit = snap.commits.find(one => one.hash === hash)
  const targets: Target[] = commit ? rowTargets(commit) : hash === 'uncommitted' ? [{ kind: 'uncommitted' }] : []
  return targets
    .map(target => ({
      title: titleOf(target),
      items: itemsOf(target, facts)
        .filter(item => canInput || item.prompt === undefined)
        .map((entry): MenuItem => ({ ...entry, key: `${keyOf(target)}#${entry.id}`, target })),
    }))
    .filter(section => section.items.length > 0)
}

type Entry = { id: string; label: string; prompt?: Prompt; isRisky?: boolean }

function itemsOf(target: Target, facts: Facts): Entry[] {
  const entries: Entry[] = []
  const add = (id: string, label: string, extra: Partial<Entry> = {}) => entries.push({ id, label, ...extra })
  const { current, head } = facts

  switch (target.kind) {
    case 'commit': {
      const isHead = target.hash === head
      add('tag', 'Add Tag…', { prompt: { label: 'Tag', placeholder: 'tag name', kind: 'tag' } })
      add('branch', 'Create Branch…', { prompt: BRANCH_PROMPT })
      add('branch-checkout', 'Create Branch and check out…', { prompt: BRANCH_PROMPT })
      if (!isHead) add('checkout', 'Checkout (detached HEAD)')
      if (!isHead) add('cherry-pick', 'Cherry Pick')
      add('revert', 'Revert')
      if (!isHead) {
        add('merge', 'Merge into current branch')
        add('rebase', 'Rebase current branch onto this')
        add('reset-soft', 'Reset current branch to this (soft)')
        add('reset-mixed', 'Reset current branch to this (mixed)')
        add('reset-hard', 'Reset current branch to this (hard)', { isRisky: true })
      }
      add('copy-hash', 'Copy hash')
      add('copy-subject', 'Copy subject')
      break
    }
    case 'branch': {
      const isCurrent = target.name === current
      if (!isCurrent) add('checkout', 'Checkout')
      add('rename', 'Rename…', { prompt: { ...BRANCH_PROMPT, initial: target.name } })
      if (!isCurrent) add('delete', 'Delete')
      if (!isCurrent) add('merge', 'Merge into current branch')
      if (!isCurrent) add('rebase', 'Rebase current branch onto this')
      add('push', 'Push')
      add('push-force', 'Force push (with lease)', { isRisky: true })
      if (isCurrent) add('pull', 'Pull')
      add('copy-name', 'Copy name')
      break
    }
    case 'remote': {
      const { branch } = splitRemote(target.name)
      if (branch !== current) add('checkout', 'Checkout')
      if (branch !== current) add('fetch', 'Fetch into local branch')
      add('merge', 'Merge into current branch')
      add('pull', 'Pull into current branch')
      add('delete-remote', 'Delete remote branch', { isRisky: true })
      add('copy-name', 'Copy name')
      break
    }
    case 'tag':
      add('push', 'Push tag')
      add('delete', 'Delete tag')
      add('delete-remote', `Delete tag (also on ${REMOTE})`, { isRisky: true })
      add('copy-name', 'Copy name')
      break
    case 'uncommitted': {
      const message: Prompt = { label: 'Message', placeholder: 'stash message (optional)', kind: 'text', isOptional: true }
      add('stash', 'Stash all changes…', { prompt: message })
      add('stash-untracked', 'Stash all changes, untracked included…', { prompt: message })
      add('discard', 'Discard all changes', { isRisky: true })
      add('discard-clean', 'Discard all changes and remove untracked files', { isRisky: true })
      add('clean', 'Clean untracked files', { isRisky: true })
      if (facts.operation !== null) add('abort', `Abort ${facts.operation}`)
      break
    }
  }
  return entries
}

/** A quick look at a name before git is asked; `git check-ref-format` (see `checkRefArgv`) has the last word. */
export function nameError(name: string): string | null {
  if (name === '') return 'Enter a name'
  if (name.startsWith('-')) return 'A name cannot start with "-"'
  if (/[\s\u0000-\u001f\u007f]/.test(name)) return 'A name cannot contain spaces'
  return null
}

/** The git call that judges a branch or tag name: exit 0 when it is valid. */
export const checkRefArgv = (kind: 'branch' | 'tag', name: string): string[] =>
  kind === 'branch' ? ['check-ref-format', '--branch', name] : ['check-ref-format', `refs/tags/${name}`]

const isProtected = (branch: string, facts: Facts): boolean => facts.protectedBranches.includes(branch)
const blocked = (branch: string): Plan => ({ kind: 'blocked', reason: `${PROTECTED_REASON} (${branch})` })

const run = (label: string, commands: string[][], extra: Partial<Extract<Plan, { kind: 'run' }>> = {}): Plan => ({
  kind: 'run',
  label,
  commands,
  network: false,
  mayConflict: false,
  ...extra,
})

/** Local and easy to undo: these run as soon as they are chosen. Everything else shows its command and waits for a Run. */
const QUICK: Record<Target['kind'], readonly string[]> = {
  commit: ['tag', 'branch', 'branch-checkout', 'checkout'],
  branch: ['checkout', 'rename'],
  remote: ['checkout'],
  tag: [],
  uncommitted: ['stash', 'stash-untracked'],
}
export const isQuick = (kind: Target['kind'], id: string): boolean => QUICK[kind].includes(id)

const LOST = 'Uncommitted changes are discarded for good; this cannot be undone.'

/** What running `id` on `target` does. `input` is the text the action's prompt collected. */
export function planFor(target: Target, id: string, input: string, facts: Facts): Plan {
  const text = input.trim()
  switch (target.kind) {
    case 'commit': {
      const { hash } = target
      const short = hash.slice(0, 7)
      const merge = target.parents.length > 1 ? ['-m', '1'] : [] // a merge commit is replayed against its first parent
      switch (id) {
        case 'tag': return run(`Tag ${text} on ${short}`, [['tag', text, hash]])
        case 'branch': return run(`Create branch ${text} at ${short}`, [['branch', text, hash]])
        case 'branch-checkout': return run(`Create and check out ${text} at ${short}`, [['checkout', '-b', text, hash]])
        case 'checkout': return run(`Checked out ${short} (detached HEAD)`, [['checkout', '--detach', hash]])
        case 'cherry-pick': return run(`Cherry-picked ${short}`, [['cherry-pick', ...merge, hash]], { mayConflict: true })
        case 'revert': return run(`Reverted ${short}`, [['revert', '--no-edit', ...merge, hash]], { mayConflict: true })
        case 'merge': return run(`Merged ${short}`, [['merge', '--no-edit', hash]], { mayConflict: true })
        case 'rebase': return run(`Rebased onto ${short}`, [['rebase', hash]], { mayConflict: true })
        case 'reset-soft': return run(`Reset (soft) to ${short}`, [['reset', '--soft', hash]])
        case 'reset-mixed': return run(`Reset (mixed) to ${short}`, [['reset', '--mixed', hash]])
        case 'reset-hard': return run(`Reset (hard) to ${short}`, [['reset', '--hard', hash]], { danger: LOST })
        case 'copy-hash': return { kind: 'copy', label: 'hash', text: hash }
        case 'copy-subject': return { kind: 'copy', label: 'subject', text: target.subject }
      }
      break
    }
    case 'branch': {
      const { name } = target
      switch (id) {
        case 'checkout': return run(`Checked out ${name}`, [['checkout', name, '--']])
        case 'rename': return run(`Renamed ${name} to ${text}`, [['branch', '-m', name, text]])
        case 'delete':
          return facts.isMerged === true
            ? run(`Deleted ${name}`, [['branch', '-d', name]])
            : run(`Deleted ${name}`, [['branch', '-D', name]], { danger: `${name} is not merged into HEAD: its commits become unreachable, and this cannot be undone.` })
        case 'merge': return run(`Merged ${name}`, [['merge', '--no-edit', name]], { mayConflict: true })
        case 'rebase': return run(`Rebased onto ${name}`, [['rebase', name]], { mayConflict: true })
        case 'pull': return run(`Pulled ${name}`, [['pull', '--no-rebase', '--no-edit']], { network: true, mayConflict: true })
        case 'copy-name': return { kind: 'copy', label: 'name', text: name }
        case 'push':
        case 'push-force': {
          // To the branch's upstream, or, when it has none, to a new `origin/<name>` it then tracks.
          const up = facts.upstream ? splitRemote(facts.upstream) : null
          const destination = up?.branch ?? name
          if (isProtected(destination, facts) || isProtected(name, facts)) return blocked(isProtected(destination, facts) ? destination : name)
          const where = up ? [up.remote, `${name}:${up.branch}`] : ['-u', REMOTE, name]
          if (id === 'push') return run(`Pushed ${name}`, [['push', ...where]], { network: true })
          return run(`Force-pushed ${name}`, [['push', '--force-with-lease', ...where]], {
            network: true,
            danger: `The remote branch is overwritten with your ${name}; commits only it has are lost for everyone.`,
          })
        }
      }
      break
    }
    case 'remote': {
      const { remote, branch } = splitRemote(target.name)
      switch (id) {
        case 'checkout':
          return facts.localBranches.includes(branch)
            ? run(`Checked out ${branch}`, [['checkout', branch, '--']])
            : run(`Checked out ${branch} (tracking ${target.name})`, [['checkout', '-b', branch, '--track', target.name]])
        case 'fetch': return run(`Fetched ${target.name} into ${branch}`, [['fetch', remote, `${branch}:${branch}`]], { network: true })
        case 'merge': return run(`Merged ${target.name}`, [['merge', '--no-edit', target.name]], { mayConflict: true })
        case 'pull': return run(`Pulled ${target.name}`, [['pull', '--no-rebase', '--no-edit', remote, branch]], { network: true, mayConflict: true })
        case 'delete-remote':
          if (isProtected(branch, facts)) return blocked(branch)
          return run(`Deleted ${target.name}`, [['push', remote, '--delete', branch]], {
            network: true,
            danger: `${target.name} is removed from the remote for everyone; this cannot be undone from here.`,
          })
        case 'copy-name': return { kind: 'copy', label: 'name', text: target.name }
      }
      break
    }
    case 'tag': {
      const { name } = target
      const ref = `refs/tags/${name}`
      switch (id) {
        case 'push': return run(`Pushed tag ${name}`, [['push', REMOTE, ref]], { network: true })
        case 'delete': return run(`Deleted tag ${name}`, [['tag', '-d', name]])
        case 'delete-remote':
          // The remote first: if it fails, nothing has changed.
          return run(`Deleted tag ${name} locally and on ${REMOTE}`, [['push', REMOTE, '--delete', ref], ['tag', '-d', name]], {
            network: true,
            danger: `The tag is removed from ${REMOTE} for everyone; this cannot be undone from here.`,
          })
        case 'copy-name': return { kind: 'copy', label: 'name', text: name }
      }
      break
    }
    case 'uncommitted':
      switch (id) {
        case 'stash': return run('Stashed all changes', [['stash', 'push', ...(text === '' ? [] : ['-m', text])]])
        case 'stash-untracked': return run('Stashed all changes, untracked included', [['stash', 'push', '--include-untracked', ...(text === '' ? [] : ['-m', text])]])
        case 'discard': return run('Discarded all changes', [['reset', '--hard']], { danger: LOST })
        case 'discard-clean': return run('Discarded all changes and untracked files', [['reset', '--hard'], ['clean', '-fd']], { danger: LOST })
        case 'clean': return run('Removed untracked files', [['clean', '-fd']], { danger: 'Untracked files are deleted for good; this cannot be undone.' })
        case 'abort':
          return facts.operation === null
            ? { kind: 'blocked', reason: 'nothing to abort' }
            : run(`Aborted the ${facts.operation}`, [[facts.operation, '--abort']])
      }
      break
  }
  return { kind: 'blocked', reason: `unknown action: ${id}` }
}
