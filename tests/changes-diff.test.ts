import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { EMPTY_TREE } from '../hooks/lib/git'
import { FIXTURE_HEAD } from './fixtures/fixture-log'
import { RUN, commits, fakeGit, fakePanes, fakeScreen, mountAt } from './helpers'
import type { GitAnswer } from './helpers'

const NUL = '\u0000'

const TRACKED_DIFF = ['diff --git a/develop.txt b/develop.txt', 'index 1111111..2222222 100644', '--- a/develop.txt', '+++ b/develop.txt', '@@ -1 +1 @@', '-a', '+b', ''].join('\n')
const UNTRACKED_DIFF = ['diff --git a/untracked-note.txt b/untracked-note.txt', 'new file mode 100644', '--- /dev/null', '+++ b/untracked-note.txt', '@@ -0,0 +1,2 @@', '+x', '+y', ''].join('\n')

// develop.txt and staged-new.txt are tracked; untracked-note.txt only shows up through ls-files.
function answers(argv: string[]): GitAnswer | undefined {
  if (argv[0] === 'ls-files') return { stdout: `untracked-note.txt${NUL}` }
  if (argv[0] !== 'diff') return undefined
  if (argv.includes('--no-index')) {
    if (argv.includes('--numstat')) return { exitCode: 1, stdout: `2\t0\t${NUL}/dev/null${NUL}untracked-note.txt${NUL}` }
    return { exitCode: 1, stdout: UNTRACKED_DIFF }
  }
  if (argv.includes('--numstat')) return { stdout: `1\t1\tdevelop.txt${NUL}3\t0\tstaged-new.txt${NUL}` }
  if (argv.includes('--name-status')) return { stdout: `M${NUL}develop.txt${NUL}A${NUL}staged-new.txt${NUL}` }
  return { stdout: TRACKED_DIFF }
}

async function setup($: Engine, on: Parameters<typeof fakeGit>[0]) {
  const calls = fakeGit(on, { answer: answers })
  fakePanes(on)
  const events = fakeScreen(on)
  await $.command.run(RUN)
  const ui = await mountAt($, 160)
  await ui.press({ key: 'changes' })
  return { calls, events, ui }
}

const counter = async (ui: Awaited<ReturnType<typeof mountAt>>) => (await ui.findAll({ type: 'Text', text: /^\(\d\/\d\)$/ })).at(-1)?.text

describe('uncommitted file diff', () => {
  test('a tracked file opens its diff, HEAD against the working tree, and n walks the uncommitted files', async ($, on) => {
    const { calls, ui } = await setup($, on)
    await ui.press({ key: 'change:develop.txt' })

    expect(await ui.find({ key: 'branch' })).toBeUndefined() // the diff screen replaced the graph
    expect(await counter(ui)).toBe('(1/3)')
    expect(await ui.find({ type: 'Text', text: `${FIXTURE_HEAD.slice(0, 7)} ↔ working tree` })).toBeDefined()
    expect(calls.filter(argv => argv.includes('-U3')).at(-1)).toEqual(['git', 'diff', '-M', '--no-color', '--no-ext-diff', '-U3', FIXTURE_HEAD, '--', 'develop.txt'])

    await ui.press({ key: 'diff-next' })
    await ui.press({ key: 'diff-next' }) // the untracked file
    expect(await counter(ui)).toBe('(3/3)')
  })

  test('an untracked file is diffed against /dev/null with --no-index', async ($, on) => {
    const { calls, ui } = await setup($, on)
    await ui.press({ key: 'change:untracked-note.txt' })

    expect(calls.filter(argv => argv.includes('--no-index') && argv.includes('-U3')).at(-1)).toEqual([
      'git', 'diff', '--no-index', '--no-color', '--no-ext-diff', '-U3', '--', '/dev/null', 'untracked-note.txt',
    ])
    expect((await ui.find({ type: 'Code' }))?.text.startsWith('@@ -0,0 +1,2 @@')).toBe(true)
    expect(await counter(ui)).toBe('(3/3)')
  })

  test('digits answer on the first uncommitted files only while no details or menu is open', async ($, on) => {
    const { ui } = await setup($, on)
    expect((await ui.find({ key: 'change:develop.txt' }))?.props.hotkey).toBe('1')
    expect((await ui.find({ key: 'change:untracked-note.txt' }))?.props.hotkey).toBe('3')

    await ui.press({ key: `select:${commits[1]!.hash}` })
    expect((await ui.find({ key: 'change:develop.txt' }))?.props.hotkey).toBeUndefined()
  })

  test('a repository without commits diffs against the empty tree', async ($, on) => {
    const calls = fakeGit(on, { answer: argv => (argv.includes('--verify') ? { exitCode: 128 } : argv.includes('log') ? { stdout: '' } : answers(argv)) })
    fakePanes(on)
    await $.command.run(RUN)
    const ui = await mountAt($, 160)
    await ui.press({ key: 'changes' })
    await ui.press({ key: 'change:develop.txt' })
    expect(calls.filter(argv => argv.includes('-U3')).at(-1)).toContain(EMPTY_TREE)
  })
})
