import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { GitAnswer } from './helpers'
import { PANE, PLUGIN, RUN, commits, fakeAsk, fakeGit, fakePanes, fakeScreen, logCalls, mountAt, paneProps } from './helpers'

const tagged = commits.find(commit => commit.refs.some(ref => ref.name === 'v1.0.1'))! // v1.0.1, origin/main, main
const hotfix = commits.find(commit => commit.refs.some(ref => ref.name === 'hotfix/1.0.1'))! // origin/hotfix/1.0.1, hotfix/1.0.1
const plain = commits[2]! // no refs, one parent
const head = commits[0]! // develop, checked out

/** Git answers for the actions: reads the pane makes around them, and what the write commands say. */
function git(options: { write?: (argv: string[]) => GitAnswer | undefined; upstream?: string; merged?: boolean; invalidName?: boolean } = {}) {
  return (argv: string[]): GitAnswer | undefined => {
    if (argv.includes('show')) return { exitCode: 128, stderr: 'not needed here' } // the details a row click opens
    if (argv[0] === 'rev-parse' && argv.includes('--absolute-git-dir')) return { stdout: '/repo/.git\n' }
    if (argv[0] === 'for-each-ref' && argv.some(arg => arg.startsWith('--format=%(upstream'))) return { stdout: options.upstream === undefined ? '' : `${options.upstream}\n` }
    if (argv[0] === 'merge-base') return { exitCode: options.merged ? 0 : 1 }
    if (argv[0] === 'check-ref-format') return options.invalidName ? { exitCode: 1, stderr: 'fatal: bad' } : {}
    const written = options.write?.(argv)
    if (written) return written
    const isWrite = ['revert', 'merge', 'push', 'branch', 'tag', 'reset', 'clean', 'stash', 'checkout', 'cherry-pick', 'rebase', 'pull', 'fetch'].includes(argv[0] ?? '')
    return isWrite && !argv.includes('--is-inside-work-tree') && !argv.includes('log') ? {} : undefined
  }
}

/** Mounts the pane with the cursor on `hash` and the action list open. */
async function openActions($: Engine, hash?: string) {
  const ui = await mountAt($, 140)
  if (hash !== undefined) await ui.press({ key: `select:${hash}` })
  else {
    await ui.press({ key: 'cursor-down' }) // the uncommitted row
  }
  await ui.press({ key: 'actions' })
  return ui
}

const toasts = (events: string[]) => events.filter(event => event.startsWith('toast:'))

const writes = (calls: string[][]) => calls.filter(argv => !['rev-parse', 'for-each-ref', 'log', 'status', 'check-ref-format', 'merge-base'].includes(argv[1] ?? '') && argv[1] !== '-c')

const setup = ($: Engine, on: On, answer: (argv: string[]) => GitAnswer | undefined = git(), reply: (asked: { question: string; options: string[] }) => string = () => 'Run') => {
  const calls = fakeGit(on, { answer })
  fakePanes(on)
  const events = fakeScreen(on)
  const asked = fakeAsk(on, reply)
  return { calls, events, asked }
}

describe('the action list', () => {
  test('a opens the list under the cursor row and closes it again', async ($, on) => {
    setup($, on)
    await $.command.run(RUN)
    const ui = await openActions($, tagged.hash)

    for (const key of ['commit#revert', 'tag:v1.0.1#push', 'remote:origin/main#pull', 'branch:main#push']) expect(await ui.find({ key: `action:${key}` })).toBeDefined()
    expect(await ui.find({ key: 'action:branch:develop#push' })).toBeUndefined() // another row
    await ui.press({ key: 'actions' })
    expect(await ui.find({ key: 'action:commit#revert' })).toBeUndefined()
    await ui.unmount()
  })

  test('the list takes the place of the open details, one list at a time', async ($, on) => {
    setup($, on, git({ write: () => undefined }))
    await $.command.run(RUN)
    const ui = await openActions($, tagged.hash)
    expect(await ui.find({ key: 'action:commit#revert' })).toBeDefined()
    // Choosing another row closes it (j / k now move the highlight inside the list).
    await ui.press({ key: `select:${plain.hash}` })
    expect(await ui.find({ key: 'action:commit#revert' })).toBeUndefined()
    await ui.unmount()
  })

  test('with no cursor yet it opens on the top row, the uncommitted changes', async ($, on) => {
    setup($, on)
    await $.command.run(RUN)
    const ui = await openActions($)
    expect(await ui.find({ key: 'action:uncommitted#stash' })).toBeDefined()
    expect(await ui.find({ key: 'action:uncommitted#abort' })).toBeUndefined()
    await ui.unmount()
  })
})

describe('the menu cursor', () => {
  // tagged row: Commit (13 items), Tag v1.0.1 (4), Remote branch origin/main (6), Branch main (8)
  const picked = async (ui: Awaited<ReturnType<typeof openActions>>) => {
    for (const key of ['commit#tag', 'commit#branch', 'commit#branch-checkout', 'commit#checkout', 'tag:v1.0.1#push', 'commit#revert']) {
      const found = await ui.find({ key: `action:${key}` })
      if (found && JSON.stringify(found).includes('"inverse":true')) return key
    }
    return undefined
  }

  test('j / k move the highlight, not the commit cursor, and stop at the ends', async ($, on) => {
    setup($, on)
    await $.command.run(RUN)
    const ui = await openActions($, plain.hash)
    expect(await picked(ui)).toBe('commit#tag') // the first item
    await ui.press({ key: 'cursor-up' })
    expect(await picked(ui)).toBe('commit#tag') // stops at the top
    await ui.press({ key: 'cursor-down' })
    expect(await picked(ui)).toBe('commit#branch')
    expect(await ui.find({ key: 'action:commit#revert' })).toBeDefined() // the list stayed open on the same row
    await ui.press({ key: 'cursor-up' })
    expect(await picked(ui)).toBe('commit#tag')
    for (let i = 0; i < 20; i++) await ui.press({ key: 'cursor-down' })
    expect(await picked(ui)).toBeUndefined() // on the last item, one of the Commit section's rows
    await ui.unmount()
  })

  test('section titles are skipped', async ($, on) => {
    const { asked } = setup($, on, git(), () => 'Cancel')
    await $.command.run(RUN)
    const ui = await openActions($, tagged.hash)
    for (let i = 0; i < 13; i++) await ui.press({ key: 'cursor-down' }) // past the 13 commit items
    await ui.press({ key: 'details' }) // o: runs the highlighted item
    expect(asked[0]?.question).toContain('git push origin refs/tags/v1.0.1') // the Tag section's first item
    await ui.unmount()
  })

  test('o runs the highlighted item through the usual question', async ($, on) => {
    const { asked, calls } = setup($, on)
    await $.command.run(RUN)
    const ui = await openActions($, plain.hash)
    for (let i = 0; i < 5; i++) await ui.press({ key: 'cursor-down' }) // tag, branch, branch-checkout, checkout, cherry-pick, [revert]
    await ui.press({ key: 'details' })
    expect(asked[0]?.question).toContain(`git revert --no-edit ${plain.hash}`)
    expect(writes(calls)).toEqual([['git', 'revert', '--no-edit', plain.hash]])
    await ui.unmount()
  })

  test('the first nine items answer to a digit', async ($, on) => {
    setup($, on)
    await $.command.run(RUN)
    const ui = await openActions($, plain.hash)
    const first = await ui.find({ key: 'action:commit#tag' })
    expect(JSON.stringify(first)).toContain('"hotkey":"1"')
    expect(JSON.stringify(await ui.find({ key: 'action:commit#reset-soft' }))).toContain('"hotkey":"9"')
    expect(JSON.stringify(await ui.find({ key: 'action:commit#reset-mixed' }))).not.toContain('"hotkey"')
    await ui.press({ key: 'action:commit#branch' }) // what the digit 2 presses
    expect(await ui.find({ key: 'action-input' })).toBeDefined()
    expect(JSON.stringify(await ui.find({ key: 'action-cancel' }))).toContain('"hotkey":"q"')
    await ui.unmount()
  })

  test('closing the list gives j / k back to the commits', async ($, on) => {
    setup($, on)
    await $.command.run(RUN)
    const ui = await openActions($, plain.hash)
    await ui.press({ key: 'actions' })
    await ui.press({ key: 'cursor-down' })
    await ui.press({ key: 'actions' }) // opens under the next commit
    expect(await ui.find({ key: 'action:commit#tag' })).toBeDefined()
    expect(await ui.find({ key: 'action:commit#revert' })).toBeDefined()
    await ui.unmount()
  })

  test('open details do not share their digits with the list', async ($, on) => {
    setup($, on)
    await $.command.run(RUN)
    const ui = await openActions($, plain.hash)
    expect(await ui.find({ key: 'diff:src/app.ts' })).toBeUndefined()
    await ui.unmount()
  })

  test('without a text field, o runs the item the highlight is on', async ($, on) => {
    const { asked } = setup($, on, git(), () => 'Cancel')
    await $.command.run(RUN)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'mobile', component: 'Pane', requestId: PANE, props: paneProps(140), viewport: { columns: 140, rows: 40 } })
    await ui.press({ key: `select:${plain.hash}` })
    await ui.press({ key: 'actions' })
    expect(await ui.find({ key: 'action:commit#tag' })).toBeUndefined() // needs a name: not on this surface
    expect(await ui.find({ key: 'find' })).toBeUndefined() // no field to type into either
    expect(JSON.stringify(await ui.find({ key: 'action:commit#checkout' }))).toContain('"inverse":true')
    await ui.press({ key: 'details' }) // o
    expect(asked[0]?.question).toContain(`git checkout --detach ${plain.hash}`)
    await ui.unmount()
  })
})

describe('running an action', () => {
  test('asks with the whole command, runs it on Run, then toasts, refreshes and closes the list', async ($, on) => {
    const { calls, events, asked } = setup($, on)
    await $.command.run(RUN)
    const ui = await openActions($, plain.hash)
    const logs = logCalls(calls).length

    await ui.press({ key: 'action:commit#revert' })
    expect(asked).toHaveLength(1)
    expect(asked[0]?.question).toContain(`git revert --no-edit ${plain.hash}`)
    expect(asked[0]?.question).not.toContain('⚠')
    expect(asked[0]?.options).toEqual(['Run', 'Cancel'])

    const run = writes(calls)
    expect(run).toEqual([['git', 'revert', '--no-edit', plain.hash]])
    const init = (calls as unknown as { inits: Array<{ env?: Record<string, string>; timeoutMs?: number }> }).inits[calls.indexOf(run[0]!)]
    expect(init?.env?.GIT_TERMINAL_PROMPT).toBe('0')
    expect(init?.timeoutMs).toBe(30_000)
    expect(events).toContain(`status:Running git revert --no-edit ${plain.hash}…`)
    expect(toasts(events).at(-1)).toBe(`toast:Reverted ${plain.hash.slice(0, 7)}`)
    expect(events.filter(event => event === 'status:undefined').length).toBeGreaterThan(0)
    expect(logCalls(calls).length).toBe(logs + 1) // refreshed
    expect(await ui.find({ key: 'action:commit#revert' })).toBeUndefined() // closed
    await ui.unmount()
  })

  test('Cancel runs nothing and leaves the list open', async ($, on) => {
    const { calls, events, asked } = setup($, on, git(), () => 'Cancel')
    await $.command.run(RUN)
    const ui = await openActions($, tagged.hash)

    await ui.press({ key: 'action:commit#merge' })
    expect(asked).toHaveLength(1)
    expect(writes(calls)).toEqual([])
    expect(events.filter(event => event.startsWith('toast:'))).toEqual([])
    expect(await ui.find({ key: 'action:commit#merge' })).toBeDefined()
    await ui.unmount()
  })

  test('a typed answer under Other is not a Run', async ($, on) => {
    const { calls } = setup($, on, git(), () => 'sure, go ahead')
    await $.command.run(RUN)
    const ui = await openActions($, tagged.hash)
    await ui.press({ key: 'action:commit#revert' })
    expect(writes(calls)).toEqual([])
    await ui.unmount()
  })

  test('a failure toasts the first line of stderr', async ($, on) => {
    const { events } = setup($, on, git({ write: argv => (argv[0] === 'revert' ? { exitCode: 1, stderr: '\nerror: could not revert\nhint: more' } : undefined) }))
    await $.command.run(RUN)
    const ui = await openActions($, tagged.hash)
    await ui.press({ key: 'action:commit#revert' })
    expect(toasts(events).at(-1)).toBe('toast:git failed: error: could not revert')
    await ui.unmount()
  })

  test('a merge that stops on a conflict says to resolve it', async ($, on) => {
    const { events } = setup($, on, git({ write: argv => (argv[0] === 'merge' ? { exitCode: 1, stdout: 'CONFLICT (content): Merge conflict in a.txt\nAutomatic merge failed' } : undefined) }))
    await $.command.run(RUN)
    const ui = await openActions($, tagged.hash)
    await ui.press({ key: 'action:commit#merge' })
    expect(toasts(events).at(-1)).toContain('conflict: resolve then continue')
    await ui.unmount()
  })

  test('a risky action opens with the warning and puts Cancel first', async ($, on) => {
    const { calls, asked } = setup($, on, git(), () => 'Cancel')
    await $.command.run(RUN)
    const ui = await openActions($, tagged.hash)
    await ui.press({ key: 'action:commit#reset-hard' })
    expect(asked[0]?.question.startsWith('⚠')).toBe(true)
    expect(asked[0]?.question).toContain('cannot be undone')
    expect(asked[0]?.question).toContain(`git reset --hard ${tagged.hash}`)
    expect(asked[0]?.options).toEqual(['Cancel', 'Run'])
    expect(writes(calls)).toEqual([])
    await ui.unmount()
  })

  test('deleting an unmerged branch asks for the force delete; a merged one does not', async ($, on) => {
    const unmerged = setup($, on, git({ merged: false }))
    await $.command.run(RUN)
    const ui = await openActions($, tagged.hash)
    await ui.press({ key: 'action:branch:main#delete' })
    expect(unmerged.asked[0]?.question).toContain('git branch -D main')
    expect(unmerged.asked[0]?.question.startsWith('⚠')).toBe(true)
    await ui.unmount()
  })

  test('a merged branch is deleted with -d and no warning', async ($, on) => {
    const { asked, calls } = setup($, on, git({ merged: true }))
    await $.command.run(RUN)
    const ui = await openActions($, tagged.hash)
    await ui.press({ key: 'action:branch:main#delete' })
    expect(asked[0]?.question).toContain('git branch -d main')
    expect(asked[0]?.question).not.toContain('⚠')
    expect(writes(calls)).toEqual([['git', 'branch', '-d', 'main']])
    await ui.unmount()
  })

  test('network commands get 120 s and a branch without upstream is pushed with -u', async ($, on) => {
    const { calls, asked } = setup($, on)
    await $.command.run(RUN)
    const ui = await openActions($, hotfix.hash)
    await ui.press({ key: 'action:branch:hotfix/1.0.1#push' })
    expect(asked[0]?.question).toContain('git push -u origin hotfix/1.0.1')
    const at = calls.findIndex(argv => argv[1] === 'push')
    expect((calls as unknown as { inits: Array<{ timeoutMs?: number }> }).inits[at]?.timeoutMs).toBe(120_000)
    await ui.unmount()
  })

  test('a thrown git call (a timeout) is a failure toast too', async ($, on) => {
    const { events } = setup($, on, argv => {
      if (argv[0] === 'push') throw new Error('timed out')
      return git()(argv)
    })
    await $.command.run(RUN)
    const ui = await openActions($, hotfix.hash)
    await ui.press({ key: 'action:branch:hotfix/1.0.1#push' })
    expect(toasts(events).at(-1)).toContain('git failed:')
    await ui.unmount()
  })
})

describe('after the dialog', () => {
  for (const answer of ['Run', 'Cancel']) test(`the pane asks for the keys back after ${answer}`, async ($, on) => {
    fakeGit(on, { answer: git() })
    fakeScreen(on)
    fakeAsk(on, () => answer)
    const opens: Array<{ id: string; focus?: true }> = []
    on('ui.open', (_$, e) => {
      opens.push({ id: e.id, focus: e.focus })
      return { value: { isPlaced: true as const } }
    })
    on('ui.panes', () => ({ value: [] }))
    await $.command.run(RUN)
    const ui = await openActions($, plain.hash)
    const before = opens.length
    await ui.press({ key: 'action:commit#revert' })
    expect(opens.slice(before)).toContainEqual({ id: 'git-graph', focus: true })
    await ui.unmount()
  })
})

describe('text fields', () => {
  test('Create Branch… asks for a name, checks it with git, then confirms', async ($, on) => {
    const { calls, asked } = setup($, on)
    await $.command.run(RUN)
    const ui = await openActions($, tagged.hash)

    await ui.press({ key: 'action:commit#branch' })
    expect(asked).toHaveLength(0) // the field comes first
    expect(await ui.find({ key: 'action-input' })).toBeDefined()

    await ui.input({ key: 'action-input', text: 'has space', kind: 'change' })
    expect(await ui.find({ type: 'Text', text: /spaces/ })).toBeUndefined() // not judged until Enter
    await ui.input({ key: 'action-input', text: 'has space', kind: 'submit' })
    expect(await ui.find({ type: 'Text', text: /cannot contain spaces/ })).toBeDefined()
    expect(asked).toHaveLength(0)

    await ui.input({ key: 'action-input', text: 'topic/x', kind: 'submit' })
    expect(calls).toContainEqual(['git', 'check-ref-format', '--branch', 'topic/x'])
    expect(asked[0]?.question).toContain(`git branch topic/x ${tagged.hash}`)
    expect(writes(calls)).toEqual([['git', 'branch', 'topic/x', tagged.hash]])
    expect(await ui.find({ key: 'action-input' })).toBeUndefined()
    await ui.unmount()
  })

  test('a name git rejects stays in the field with the reason', async ($, on) => {
    const { asked, calls } = setup($, on, git({ invalidName: true }))
    await $.command.run(RUN)
    const ui = await openActions($, tagged.hash)
    await ui.press({ key: 'action:commit#tag' })
    await ui.input({ key: 'action-input', text: 'a..b', kind: 'submit' })
    expect(calls).toContainEqual(['git', 'check-ref-format', 'refs/tags/a..b'])
    expect(await ui.find({ type: 'Text', text: /not a valid tag name/ })).toBeDefined()
    expect(asked).toHaveLength(0)
    expect(await ui.find({ key: 'action-input' })).toBeDefined()
    await ui.unmount()
  })

  test('Cancel in the field goes back to the list', async ($, on) => {
    setup($, on)
    await $.command.run(RUN)
    const ui = await openActions($, tagged.hash)
    await ui.press({ key: 'action:commit#tag' })
    await ui.press({ key: 'action-cancel' })
    expect(await ui.find({ key: 'action-input' })).toBeUndefined()
    expect(await ui.find({ key: 'action:commit#tag' })).toBeDefined()
    await ui.unmount()
  })

  test('Enter on an empty name field goes back to the list without asking', async ($, on) => {
    const { asked, calls } = setup($, on)
    await $.command.run(RUN)
    const ui = await openActions($, tagged.hash)
    await ui.press({ key: 'action:commit#tag' })
    const before = calls.length
    await ui.input({ key: 'action-input', text: '  ', kind: 'submit' })
    expect(await ui.find({ key: 'action-input' })).toBeUndefined()
    expect(await ui.find({ key: 'action:commit#tag' })).toBeDefined()
    expect(asked).toHaveLength(0)
    expect(calls.length).toBe(before)
    await ui.unmount()
  })

  test('Rename starts from the current name', async ($, on) => {
    const { asked } = setup($, on)
    await $.command.run(RUN)
    const ui = await openActions($, tagged.hash)
    await ui.press({ key: 'action:branch:main#rename' })
    await ui.input({ key: 'action-input', text: 'trunk', kind: 'submit' })
    expect(asked[0]?.question).toContain('git branch -m main trunk')
    await ui.unmount()
  })

  test('Stash takes an optional message', async ($, on) => {
    const { asked, calls } = setup($, on)
    await $.command.run(RUN)
    const ui = await openActions($)
    await ui.press({ key: 'action:uncommitted#stash-untracked' })
    await ui.input({ key: 'action-input', text: 'wip: 중간 저장', kind: 'submit' })
    expect(asked[0]?.question).toContain(`git stash push --include-untracked -m 'wip: 중간 저장'`)
    expect(writes(calls)).toEqual([['git', 'stash', 'push', '--include-untracked', '-m', 'wip: 중간 저장']])
    await ui.unmount()
  })
})

describe('protected branches', () => {
  test('a push to main is not run: a toast says why and nothing is asked', async ($, on) => {
    const { calls, events, asked } = setup($, on, git({ upstream: 'origin/main' }))
    await $.command.run(RUN)
    const ui = await openActions($, tagged.hash)
    await ui.press({ key: 'action:branch:main#push' })
    expect(toasts(events).at(-1)).toContain('protected branch: use a pull request')
    expect(asked).toHaveLength(0)
    expect(writes(calls)).toEqual([])
    await ui.unmount()
  })

  test('force push and deleting the remote branch are refused as well', async ($, on) => {
    const { calls, events, asked } = setup($, on, git({ upstream: 'origin/main' }))
    await $.command.run(RUN)
    const ui = await openActions($, tagged.hash)
    await ui.press({ key: 'action:branch:main#push-force' })
    expect(toasts(events).at(-1)).toContain('protected branch: use a pull request')
    await ui.press({ key: 'actions' }) // the refusal closed the list
    await ui.press({ key: 'action:remote:origin/main#delete-remote' })
    expect(events.filter(event => event.includes('protected branch: use a pull request'))).toHaveLength(2)
    expect(asked).toHaveLength(0)
    expect(writes(calls)).toEqual([])
    await ui.unmount()
  })

  test('another branch is pushed to its upstream after the confirmation', async ($, on) => {
    const { calls, asked } = setup($, on, git({ upstream: 'origin/hotfix/1.0.1' }))
    await $.command.run(RUN)
    const ui = await openActions($, hotfix.hash)
    await ui.press({ key: 'action:branch:hotfix/1.0.1#push' })
    expect(asked[0]?.question).toContain('git push origin hotfix/1.0.1:hotfix/1.0.1')
    expect(writes(calls)).toEqual([['git', 'push', 'origin', 'hotfix/1.0.1:hotfix/1.0.1']])
    await ui.unmount()
  })

})

describe('protected branches from the setting', () => {
  test('hotfix is blocked when listed', { options: { protectedBranches: 'main, hotfix/1.0.1' } }, async ($, on) => {
    const { events, asked, calls } = setup($, on, git({ upstream: 'origin/hotfix/1.0.1' }))
    await $.command.run(RUN)
    const ui = await openActions($, hotfix.hash)
    await ui.press({ key: 'action:branch:hotfix/1.0.1#push' })
    expect(toasts(events).at(-1)).toContain('protected branch: use a pull request (hotfix/1.0.1)')
    expect(asked).toHaveLength(0)
    expect(writes(calls)).toEqual([])
    await ui.unmount()
  })

  test('main is pushable when the list is empty', { options: { protectedBranches: '' } }, async ($, on) => {
    const { asked, calls } = setup($, on, git({ upstream: 'origin/main' }))
    await $.command.run(RUN)
    const ui = await openActions($, tagged.hash)
    await ui.press({ key: 'action:branch:main#push' })
    expect(asked).toHaveLength(1)
    expect(writes(calls)).toEqual([['git', 'push', 'origin', 'main:main']])
    await ui.unmount()
  })
})

describe('copy', () => {
  test('goes to the clipboard without a question', async ($, on) => {
    const { events, asked } = setup($, on)
    const copied: string[] = []
    on('ui.copy', (_$, e) => {
      copied.push(e.text)
      return { value: { isCopied: true as const } }
    })
    await $.command.run(RUN)
    const ui = await openActions($, tagged.hash)
    await ui.press({ key: 'action:commit#copy-hash' })
    expect(copied).toEqual([tagged.hash])
    expect(asked).toHaveLength(0)
    expect(toasts(events).at(-1)).toBe('toast:Copied hash')
    await ui.unmount()
  })

  test('when the clipboard does not take it, the value is in the toast', async ($, on) => {
    const { events } = setup($, on)
    on('ui.copy', () => ({ value: { isCopied: false as const, reason: 'no-clipboard' as const } }))
    await $.command.run(RUN)
    const ui = await openActions($, tagged.hash)
    await ui.press({ key: 'action:branch:main#copy-name' })
    expect(toasts(events).at(-1)).toBe('toast:Could not copy; the name is main')
    await ui.unmount()
  })
})

describe('an operation that stopped', () => {
  test('Abort shows while a merge waits and runs `git merge --abort`', async ($, on) => {
    const { calls, asked } = setup($, on)
    on('fs.exists', (_$, e) => ({ value: e.path === '/repo/.git/MERGE_HEAD' }))
    await $.command.run(RUN)
    const ui = await openActions($)
    expect(await ui.find({ key: 'action:uncommitted#abort' })).toBeDefined()
    await ui.press({ key: 'action:uncommitted#abort' })
    expect(asked[0]?.question).toContain('git merge --abort')
    expect(writes(calls)).toEqual([['git', 'merge', '--abort']])
    await ui.unmount()
  })
})

describe('what is on offer follows the checkout', () => {
  test('the current branch can be pulled but not checked out', async ($, on) => {
    setup($, on)
    await $.command.run(RUN)
    const ui = await openActions($, head.hash)
    expect(await ui.find({ key: 'action:branch:develop#pull' })).toBeDefined()
    expect(await ui.find({ key: 'action:branch:develop#checkout' })).toBeUndefined()
    expect(await ui.find({ key: 'action:commit#reset-hard' })).toBeUndefined() // HEAD itself
    await ui.unmount()
  })
})
