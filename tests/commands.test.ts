import { describe, expect, test } from 'claude-code/testing'

import type { GitGraphSnapshot } from '../types'
import { PROTECTED_REASON, checkRefArgv, displayCommand, isQuick, nameError, parseProtected, planFor, rowMenu, splitRemote } from '../hooks/lib/commands'
import type { Facts, Plan, Target } from '../hooks/lib/commands'
import { parseBranches } from '../hooks/lib/parse'
import { REFS, commits } from './helpers'

const ready = (head = commits[0]!.hash): Extract<GitGraphSnapshot, { kind: 'ready' }> => ({
  kind: 'ready',
  commits,
  hasMore: false,
  head,
  changes: [],
  branches: parseBranches(REFS),
  filter: null,
})

const facts = (extra: Partial<Facts> = {}): Facts => ({
  head: commits[0]!.hash,
  current: 'develop',
  localBranches: ['develop', 'main'],
  protectedBranches: ['main', 'develop'],
  operation: null,
  ...extra,
})

const top = commits[0]!
const merge = commits.find(commit => commit.refs.some(ref => ref.name === 'v1.0.1'))!
const commitTarget = (hash = top.hash, parents: readonly string[] = [], subject = 'a subject'): Target => ({ kind: 'commit', hash, subject, parents })
const argvOf = (plan: Plan) => (plan.kind === 'run' ? plan.commands : plan)
const labelsOf = (hash: string, operation: Parameters<typeof rowMenu>[2] = null) =>
  rowMenu(ready(), hash, operation, ['main', 'develop'], true).map(section => [section.title, section.items.map(item => item.id)] as const)

describe('the menu of a row', () => {
  test('a commit row: the Commit section, then one section per ref', () => {
    const sections = rowMenu(ready(), merge.hash, null, [], true)
    expect(sections.map(section => section.title)).toEqual([`Commit ${merge.hash.slice(0, 7)}`, 'Tag v1.0.1', 'Remote branch origin/main', 'Branch main'])
  })

  test('the commit section offers everything off HEAD', () => {
    expect(labelsOf(merge.hash)[0]?.[1]).toEqual([
      'tag', 'branch', 'branch-checkout', 'checkout', 'cherry-pick', 'revert', 'merge', 'rebase',
      'reset-soft', 'reset-mixed', 'reset-hard', 'copy-hash', 'copy-subject',
    ])
  })

  test('on HEAD itself, what would act on itself is hidden', () => {
    expect(labelsOf(top.hash)[0]?.[1]).toEqual(['tag', 'branch', 'branch-checkout', 'revert', 'copy-hash', 'copy-subject'])
  })

  test('the checked-out branch cannot be checked out, deleted or merged into itself; it can be pulled', () => {
    const current = labelsOf(top.hash).find(([title]) => title === 'Branch develop')?.[1]
    expect(current).toEqual(['rename', 'push', 'push-force', 'pull', 'copy-name'])
    const other = labelsOf(merge.hash).find(([title]) => title === 'Branch main')?.[1]
    expect(other).toEqual(['checkout', 'rename', 'delete', 'merge', 'rebase', 'push', 'push-force', 'copy-name'])
  })

  test('a remote branch offers checkout and fetch unless its local twin is checked out', () => {
    const remote = labelsOf(merge.hash).find(([title]) => title === 'Remote branch origin/main')?.[1]
    expect(remote).toEqual(['checkout', 'fetch', 'merge', 'pull', 'delete-remote', 'copy-name'])
    const develop = labelsOf(commits.find(commit => commit.refs.some(ref => ref.name === 'origin/develop'))!.hash).find(([title]) => title === 'Remote branch origin/develop')?.[1]
    expect(develop).toEqual(['merge', 'pull', 'delete-remote', 'copy-name'])
  })

  test('a tag', () => {
    expect(labelsOf(merge.hash).find(([title]) => title === 'Tag v1.0.1')?.[1]).toEqual(['push', 'delete', 'delete-remote', 'copy-name'])
  })

  test('the uncommitted row, with Abort only while an operation waits', () => {
    expect(labelsOf('uncommitted')).toEqual([['Uncommitted Changes', ['stash', 'stash-untracked', 'discard', 'discard-clean', 'clean']]])
    expect(labelsOf('uncommitted', 'rebase')[0]?.[1].at(-1)).toBe('abort')
    expect(rowMenu(ready(), 'uncommitted', 'rebase', [], true)[0]?.items.at(-1)?.label).toBe('Abort rebase')
  })

  test('without a text field the items that need one are left out', () => {
    const items = rowMenu(ready(), top.hash, null, [], false).flatMap(section => section.items)
    expect(items.some(item => item.prompt !== undefined)).toBe(false)
    expect(items.some(item => item.id === 'revert')).toBe(true)
  })

  test('keys are unique within a row', () => {
    const keys = rowMenu(ready(), merge.hash, null, [], true).flatMap(section => section.items.map(item => item.key))
    expect(new Set(keys).size).toBe(keys.length)
  })

  test('destructive items are marked', () => {
    const risky = rowMenu(ready(), merge.hash, null, [], true).flatMap(section => section.items).filter(item => item.isRisky).map(item => item.id)
    expect(risky).toEqual(['reset-hard', 'delete-remote', 'delete-remote', 'push-force'])
  })
})

describe('the commands', () => {
  const hash = merge.hash
  const parent = (id: string, input = '') => argvOf(planFor(commitTarget(hash, ['p1']), id, input, facts()))

  test('commit actions', () => {
    expect(parent('tag', ' v2 ')).toEqual([['tag', 'v2', hash]])
    expect(parent('branch', 'topic')).toEqual([['branch', 'topic', hash]])
    expect(parent('branch-checkout', 'topic')).toEqual([['checkout', '-b', 'topic', hash]])
    expect(parent('checkout')).toEqual([['checkout', '--detach', hash]])
    expect(parent('cherry-pick')).toEqual([['cherry-pick', hash]])
    expect(parent('revert')).toEqual([['revert', '--no-edit', hash]])
    expect(parent('merge')).toEqual([['merge', '--no-edit', hash]])
    expect(parent('rebase')).toEqual([['rebase', hash]])
    expect(parent('reset-soft')).toEqual([['reset', '--soft', hash]])
    expect(parent('reset-mixed')).toEqual([['reset', '--mixed', hash]])
    expect(parent('reset-hard')).toEqual([['reset', '--hard', hash]])
  })

  test('a merge commit is cherry-picked and reverted against its first parent', () => {
    const target = commitTarget(hash, ['p1', 'p2'])
    expect(argvOf(planFor(target, 'cherry-pick', '', facts()))).toEqual([['cherry-pick', '-m', '1', hash]])
    expect(argvOf(planFor(target, 'revert', '', facts()))).toEqual([['revert', '--no-edit', '-m', '1', hash]])
  })

  test('copy plans carry the value', () => {
    expect(planFor(commitTarget(hash, [], 'fix: a | b'), 'copy-subject', '', facts())).toEqual({ kind: 'copy', label: 'subject', text: 'fix: a | b' })
    expect(planFor({ kind: 'branch', name: 'x' }, 'copy-name', '', facts())).toEqual({ kind: 'copy', label: 'name', text: 'x' })
    expect(planFor(commitTarget(hash), 'copy-hash', '', facts())).toEqual({ kind: 'copy', label: 'hash', text: hash })
  })

  test('local branch actions', () => {
    const branch = (id: string, input = '', extra: Partial<Facts> = {}) => argvOf(planFor({ kind: 'branch', name: 'feature/x' }, id, input, facts(extra)))
    expect(branch('checkout')).toEqual([['checkout', 'feature/x', '--']])
    expect(branch('rename', 'feature/y')).toEqual([['branch', '-m', 'feature/x', 'feature/y']])
    expect(branch('merge')).toEqual([['merge', '--no-edit', 'feature/x']])
    expect(branch('rebase')).toEqual([['rebase', 'feature/x']])
    expect(branch('pull')).toEqual([['pull', '--no-rebase', '--no-edit']])
  })

  test('delete: -d when merged, -D with a warning when not', () => {
    const del = (isMerged: boolean | undefined) => planFor({ kind: 'branch', name: 'feature/x' }, 'delete', '', facts({ isMerged }))
    expect(del(true)).toMatchObject({ commands: [['branch', '-d', 'feature/x']] })
    expect((del(true) as { danger?: string }).danger).toBeUndefined()
    expect(del(false)).toMatchObject({ commands: [['branch', '-D', 'feature/x']], danger: expect.stringContaining('not merged') })
    expect(del(undefined)).toMatchObject({ commands: [['branch', '-D', 'feature/x']] })
  })

  test('push goes to the upstream, or creates one on origin', () => {
    const push = (id: string, upstream: string | null) => planFor({ kind: 'branch', name: 'feature/x' }, id, '', facts({ upstream }))
    expect(push('push', null)).toMatchObject({ commands: [['push', '-u', 'origin', 'feature/x']], network: true })
    expect(push('push', 'origin/feature/x')).toMatchObject({ commands: [['push', 'origin', 'feature/x:feature/x']] })
    expect(push('push', 'fork/other')).toMatchObject({ commands: [['push', 'fork', 'feature/x:other']] })
    expect(push('push-force', 'origin/feature/x')).toMatchObject({
      commands: [['push', '--force-with-lease', 'origin', 'feature/x:feature/x']],
      danger: expect.stringContaining('overwritten'),
    })
  })

  test('remote branch actions', () => {
    const remote = (id: string, extra: Partial<Facts> = {}) => planFor({ kind: 'remote', name: 'origin/feature/x' }, id, '', facts(extra))
    expect(argvOf(remote('checkout'))).toEqual([['checkout', '-b', 'feature/x', '--track', 'origin/feature/x']])
    expect(argvOf(remote('checkout', { localBranches: ['feature/x'] }))).toEqual([['checkout', 'feature/x', '--']])
    expect(argvOf(remote('fetch'))).toEqual([['fetch', 'origin', 'feature/x:feature/x']])
    expect(argvOf(remote('merge'))).toEqual([['merge', '--no-edit', 'origin/feature/x']])
    expect(argvOf(remote('pull'))).toEqual([['pull', '--no-rebase', '--no-edit', 'origin', 'feature/x']])
    expect(remote('delete-remote')).toMatchObject({ commands: [['push', 'origin', '--delete', 'feature/x']], network: true, danger: expect.any(String) })
  })

  test('tag actions; deleting on the remote goes first, so a failure changes nothing', () => {
    const tag = (id: string) => planFor({ kind: 'tag', name: 'v1' }, id, '', facts())
    expect(argvOf(tag('push'))).toEqual([['push', 'origin', 'refs/tags/v1']])
    expect(tag('delete')).toMatchObject({ commands: [['tag', '-d', 'v1']], network: false })
    expect((tag('delete') as { danger?: string }).danger).toBeUndefined()
    expect(tag('delete-remote')).toMatchObject({ commands: [['push', 'origin', '--delete', 'refs/tags/v1'], ['tag', '-d', 'v1']], danger: expect.any(String) })
  })

  test('uncommitted actions', () => {
    const wip = (id: string, input = '', extra: Partial<Facts> = {}) => planFor({ kind: 'uncommitted' }, id, input, facts(extra))
    expect(argvOf(wip('stash', ''))).toEqual([['stash', 'push']])
    expect(argvOf(wip('stash', 'wip: 중간 저장'))).toEqual([['stash', 'push', '-m', 'wip: 중간 저장']])
    expect(argvOf(wip('stash-untracked', 'x'))).toEqual([['stash', 'push', '--include-untracked', '-m', 'x']])
    expect(wip('discard')).toMatchObject({ commands: [['reset', '--hard']], danger: expect.any(String) })
    expect(wip('discard-clean')).toMatchObject({ commands: [['reset', '--hard'], ['clean', '-fd']], danger: expect.any(String) })
    expect(wip('clean')).toMatchObject({ commands: [['clean', '-fd']], danger: expect.any(String) })
    expect(argvOf(wip('abort', '', { operation: 'cherry-pick' }))).toEqual([['cherry-pick', '--abort']])
    expect(argvOf(wip('abort', '', { operation: 'merge' }))).toEqual([['merge', '--abort']])
    expect(wip('abort')).toEqual({ kind: 'blocked', reason: 'nothing to abort' })
  })

  test('only the destructive actions carry a danger', () => {
    const dangerous = (target: Target, id: string, extra: Partial<Facts> = {}) => {
      const plan = planFor(target, id, 'x', facts({ upstream: 'origin/f', ...extra }))
      return plan.kind === 'run' && plan.danger !== undefined
    }
    expect(dangerous(commitTarget(), 'reset-hard')).toBe(true)
    for (const id of ['reset-soft', 'reset-mixed', 'merge', 'rebase', 'cherry-pick', 'revert', 'checkout']) expect(dangerous(commitTarget('h', ['p']), id)).toBe(false)
    expect(dangerous({ kind: 'branch', name: 'f' }, 'push')).toBe(false)
    expect(dangerous({ kind: 'branch', name: 'f' }, 'push-force')).toBe(true)
    expect(dangerous({ kind: 'branch', name: 'f' }, 'delete', { isMerged: true })).toBe(false)
    expect(dangerous({ kind: 'remote', name: 'origin/f' }, 'delete-remote')).toBe(true)
    expect(dangerous({ kind: 'uncommitted' }, 'stash')).toBe(false)
  })

  test('only network commands get the long timeout', () => {
    const network = (target: Target, id: string) => {
      const plan = planFor(target, id, 'x', facts())
      return plan.kind === 'run' && plan.network
    }
    expect(network({ kind: 'branch', name: 'f' }, 'push')).toBe(true)
    expect(network({ kind: 'branch', name: 'develop' }, 'pull')).toBe(true)
    expect(network({ kind: 'tag', name: 't' }, 'push')).toBe(true)
    expect(network({ kind: 'remote', name: 'origin/f' }, 'fetch')).toBe(true)
    expect(network({ kind: 'branch', name: 'f' }, 'merge')).toBe(false)
    expect(network({ kind: 'uncommitted' }, 'stash')).toBe(false)
  })
})

describe('protected branches', () => {
  const blocked = (plan: Plan) => plan.kind === 'blocked' && plan.reason.startsWith(PROTECTED_REASON)

  test('push and force push to a protected branch are refused, to others allowed', () => {
    for (const id of ['push', 'push-force']) {
      expect(blocked(planFor({ kind: 'branch', name: 'main' }, id, '', facts({ upstream: 'origin/main' })))).toBe(true)
      expect(blocked(planFor({ kind: 'branch', name: 'main' }, id, '', facts({ upstream: null })))).toBe(true)
      expect(blocked(planFor({ kind: 'branch', name: 'feature/x' }, id, '', facts({ upstream: 'origin/feature/x' })))).toBe(false)
    }
  })

  test('a local branch pushed onto a protected upstream name is refused', () => {
    expect(blocked(planFor({ kind: 'branch', name: 'topic' }, 'push', '', facts({ upstream: 'origin/main' })))).toBe(true)
  })

  test('deleting a protected branch on the remote is refused; a tag or a local delete is not', () => {
    expect(blocked(planFor({ kind: 'remote', name: 'origin/main' }, 'delete-remote', '', facts()))).toBe(true)
    expect(blocked(planFor({ kind: 'remote', name: 'origin/feature/x' }, 'delete-remote', '', facts()))).toBe(false)
    expect(blocked(planFor({ kind: 'branch', name: 'main' }, 'delete', '', facts({ isMerged: true })))).toBe(false)
    expect(blocked(planFor({ kind: 'tag', name: 'main' }, 'delete-remote', '', facts()))).toBe(false)
  })

  test('the list is the setting: comma separated, trimmed; unset is main and develop', () => {
    expect(parseProtected(' main , release/1.0 ,,')).toEqual(['main', 'release/1.0'])
    expect(parseProtected(undefined)).toEqual(['main', 'develop'])
    expect(parseProtected('')).toEqual([])
    const custom = facts({ protectedBranches: ['release/1.0'], upstream: 'origin/main' })
    expect(blocked(planFor({ kind: 'branch', name: 'main' }, 'push', '', custom))).toBe(false)
    expect(blocked(planFor({ kind: 'branch', name: 'release/1.0' }, 'push', '', { ...custom, upstream: null }))).toBe(true)
  })
})

describe('names and display', () => {
  test('a quick check before git is asked', () => {
    expect(nameError('')).toBe('Enter a name')
    expect(nameError('--force')).toMatch(/cannot start/)
    expect(nameError('a b')).toMatch(/spaces/)
    expect(nameError('feature/x')).toBeNull()
  })

  test('git has the last word', () => {
    expect(checkRefArgv('branch', 'x/y')).toEqual(['check-ref-format', '--branch', 'x/y'])
    expect(checkRefArgv('tag', 'v1')).toEqual(['check-ref-format', 'refs/tags/v1'])
  })

  test('commands read as shell but are never joined for running', () => {
    expect(displayCommand(['push', '-u', 'origin', 'feature/x'])).toBe('git push -u origin feature/x')
    expect(displayCommand(['stash', 'push', '-m', "it's wip"])).toBe(`git stash push -m 'it'\\''s wip'`)
  })

  test('a remote branch splits at the first slash', () => {
    expect(splitRemote('origin/feature/x')).toEqual({ remote: 'origin', branch: 'feature/x' })
  })
})

describe('quick actions', () => {
  const QUICK: Array<[Target, string]> = [
    [commitTarget(merge.hash), 'tag'],
    [commitTarget(merge.hash), 'branch'],
    [commitTarget(merge.hash), 'branch-checkout'],
    [commitTarget(merge.hash), 'checkout'],
    [{ kind: 'branch', name: 'feature/x' }, 'checkout'],
    [{ kind: 'branch', name: 'feature/x' }, 'rename'],
    [{ kind: 'remote', name: 'origin/feature/x' }, 'checkout'],
    [{ kind: 'uncommitted' }, 'stash'],
    [{ kind: 'uncommitted' }, 'stash-untracked'],
  ]

  test('exactly the local, easy-to-undo actions skip the confirmation', () => {
    for (const [target, id] of QUICK) expect(isQuick(target.kind, id)).toBe(true)
    for (const [kind, id] of [['commit', 'revert'], ['commit', 'reset-hard'], ['commit', 'merge'], ['branch', 'delete'], ['branch', 'push'], ['remote', 'fetch'], ['remote', 'pull'], ['tag', 'delete'], ['tag', 'push'], ['uncommitted', 'discard'], ['uncommitted', 'abort']] as const) {
      expect(isQuick(kind, id)).toBe(false)
    }
  })

  test('a quick action never carries a danger', () => {
    for (const [target, id] of QUICK) {
      const plan = planFor(target, id, 'name', facts())
      expect(plan.kind).toBe('run')
      expect((plan as { danger?: string }).danger).toBeUndefined()
    }
  })
})
