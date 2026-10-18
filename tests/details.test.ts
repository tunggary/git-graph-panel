import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { EMPTY_TREE } from '../hooks/lib/git'
import { findMatches } from '../hooks/lib/search'
import { formatDateTime } from '../hooks/lib/parse'
import { RUN, commits, fakeGit, fakePanes, fakeScreen, logCalls, mountAt } from './helpers'
import type { GitAnswer } from './helpers'
import { FIXTURE_LOG } from './fixtures/fixture-log'

const NUL = '\u0000'
const FIELD = '\u001f'
const TS = 1704067200

const [, , , target] = commits as [unknown, unknown, unknown, (typeof commits)[number]]
const top = commits[0]!
const second = commits[1]!
const third = commits[2]!

const showOf = (hash: string, parents: readonly string[], { committer = 'Han Jiwoo', message = 'feat: 제목\n\n본문 첫 줄\n본문 둘째 줄\n' } = {}) =>
  [hash, parents.join(' '), 'Han Jiwoo', 'jiwoo@example.com', TS, committer, 'jiwoo@example.com', TS, message].join(FIELD)

// src/app.ts edited, a binary, a pure rename, a 5000-line new file.
const NUMSTAT = `12\t3\tsrc/app.ts${NUL}-\t-\tlogo.bin${NUL}0\t0\t${NUL}old.txt${NUL}new.txt${NUL}5000\t0\tbig.txt${NUL}`
const NAME_STATUS = `M${NUL}src/app.ts${NUL}A${NUL}logo.bin${NUL}R100${NUL}old.txt${NUL}new.txt${NUL}A${NUL}big.txt${NUL}`
const APP_DIFF = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,3 +1,3 @@ function main',
  ' a',
  '-b',
  '+c',
  ' d',
  '',
].join('\n')
const BIG_DIFF = ['diff --git a/big.txt b/big.txt', 'new file mode 100644', '--- /dev/null', '+++ b/big.txt', '@@ -0,0 +1,5000 @@', ...Array.from({ length: 5000 }, (_, i) => `+generated line number ${i + 1}`), ''].join('\n')
const RENAME_DIFF = ['diff --git a/old.txt b/new.txt', 'similarity index 100%', 'rename from old.txt', 'rename to new.txt', ''].join('\n')

/** git answers for the details and diff views; `info` swaps what `git show` says. */
const feed = { nameStatus: NAME_STATUS }

function answers(options: { committer?: string; fail?: boolean } = {}) {
  return (argv: string[]): GitAnswer | undefined => {
    if (argv.includes('show')) {
      if (options.fail) return { exitCode: 128, stderr: 'fatal: bad object\nmore' }
      const hash = argv.at(-1) ?? ''
      const commit = commits.find(one => one.hash === hash)
      return { stdout: showOf(hash, commit?.parents ?? [], options.committer === undefined ? {} : { committer: options.committer }) }
    }
    if (argv[0] !== 'diff') return undefined
    if (argv.includes('--numstat')) return { stdout: NUMSTAT }
    if (argv.includes('--name-status')) return { stdout: feed.nameStatus }
    const path = argv.at(-1)
    if (path === 'src/app.ts') return { stdout: APP_DIFF }
    if (path === 'big.txt') return { stdout: BIG_DIFF }
    return { stdout: RENAME_DIFF }
  }
}

async function setup($: Engine, on: Parameters<typeof fakeGit>[0], options: Parameters<typeof answers>[0] = {}) {
  feed.nameStatus = NAME_STATUS
  const calls = fakeGit(on, { answer: answers(options) })
  const open = fakePanes(on)
  const events = fakeScreen(on)
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }) as never)
  await $.command.run(RUN)
  const ui = await mountAt($, 160)
  return { calls, open, events, ui }
}

// `$.tool.call` is typed over every connected MCP tool as well, and the compiler gives up on that union
// (TS2589) for a Bash call; this narrows it to the one shape the tests use.
const callBash = ($: Engine, command: string) =>
  ($.tool.call as unknown as (input: { tool: 'Bash'; command: string }) => Promise<unknown>)({ tool: 'Bash', command })

const diffCalls = (calls: string[][], flag: string) => calls.filter(argv => argv[1] === 'diff' && argv.includes(flag))
const rowText = async (ui: Awaited<ReturnType<typeof mountAt>>, subject: string) => (await ui.findAll({ type: 'Text', text: subject })).at(-1)
const texts = async (ui: Awaited<ReturnType<typeof mountAt>>, text: string | RegExp) => ui.find({ type: 'Text', text })

describe('commit details', () => {
  test('pressing a row unfolds the commit under it: ids, author, whole message and its files; again folds it', async ($, on) => {
    const { calls, ui } = await setup($, on)

    expect(await ui.find({ key: `details:${target.hash}` })).toBeUndefined()
    await ui.press({ key: `select:${target.hash}` })
    expect(await ui.find({ key: `details:${target.hash}` })).toBeDefined()

    const show = calls.find(argv => argv.includes('show')) ?? []
    expect(show.at(-1)).toBe(target.hash)
    expect(show).toContain('--no-patch')
    // against the first parent
    expect(diffCalls(calls, '--numstat')[0]).toEqual(expect.arrayContaining([target.parents[0], target.hash]))

    const parents = target.parents.map(parent => parent.slice(0, 7)).join(' ')
    expect(await texts(ui, `${target.hash} · parents ${parents}`)).toBeDefined()
    expect(await texts(ui, `Author  Han Jiwoo <jiwoo@example.com> · ${formatDateTime(TS)}`)).toBeDefined()
    expect(await texts(ui, /^Committer/)).toBeUndefined() // the author committed it too
    expect((await texts(ui, 'feat: 제목'))?.props.bold).toBe(true)
    expect(await texts(ui, '본문 첫 줄')).toBeDefined()
    expect(await texts(ui, '본문 둘째 줄')).toBeDefined()
    expect(await texts(ui, '4 files changed  +5012 -3')).toBeDefined()
    for (const path of ['src/app.ts', 'logo.bin', 'new.txt', 'big.txt']) expect(await ui.find({ key: `diff:${path}` })).toBeDefined()
    expect((await ui.find({ key: 'diff:new.txt' }))?.text).toBe('R old.txt → new.txt +0 -0')
    expect((await ui.find({ key: 'diff:logo.bin' }))?.text).toContain('bin')
    expect((await ui.find({ key: 'diff:src/app.ts' }))?.text).toBe('M src/app.ts +12 -3')

    await ui.press({ key: `select:${target.hash}` })
    expect(await ui.find({ key: `details:${target.hash}` })).toBeUndefined()
  })

  test('one commit open at a time: opening another folds the first', async ($, on) => {
    const { ui } = await setup($, on)
    await ui.press({ key: `select:${second.hash}` })
    await ui.press({ key: `select:${third.hash}` })
    expect(await ui.find({ key: `details:${second.hash}` })).toBeUndefined()
    expect(await ui.find({ key: `details:${third.hash}` })).toBeDefined()
  })

  test('a committer who is not the author is named too', async ($, on) => {
    const { ui } = await setup($, on, { committer: 'Sam O\'Neil' })
    await ui.press({ key: `select:${second.hash}` })
    expect(await texts(ui, `Committer  Sam O'Neil <jiwoo@example.com> · ${formatDateTime(TS)}`)).toBeDefined()
  })

  test('a merge is measured against its first parent, a root commit against the empty tree', async ($, on) => {
    const { calls, ui } = await setup($, on)
    const merge = commits.find(commit => commit.parents.length > 1)!
    const root = commits.at(-1)!
    expect(root.parents).toHaveLength(0)
    // the root commit is among the first 50 only if the history is short; load everything first
    await ui.press({ key: 'load-more' })
    await ui.press({ key: `select:${merge.hash}` })
    expect(diffCalls(calls, '--numstat').at(-1)).toEqual(expect.arrayContaining([merge.parents[0], merge.hash]))
    await ui.press({ key: `select:${root.hash}` })
    const rootCalls = diffCalls(calls, '--numstat').at(-1) ?? []
    expect(rootCalls).toEqual(expect.arrayContaining([EMPTY_TREE, root.hash]))
    expect(await texts(ui, `${root.hash} · parents none`)).toBeDefined()
  })

  test('a git failure is written where the details would be', async ($, on) => {
    const { ui } = await setup($, on, { fail: true })
    await ui.press({ key: `select:${second.hash}` })
    expect(await texts(ui, 'git failed: fatal: bad object')).toBeDefined()
  })

  test('the Uncommitted row unfolds its files for a press and for `o`', async ($, on) => {
    const { ui } = await setup($, on)
    await ui.press({ key: 'cursor-down' })
    expect(await ui.find({ key: 'file:develop.txt' })).toBeUndefined()
    await ui.press({ key: 'details' })
    expect(await ui.find({ key: 'file:develop.txt' })).toBeDefined()
    await ui.press({ key: 'details' })
    expect(await ui.find({ key: 'file:develop.txt' })).toBeUndefined()
    await ui.press({ key: 'changes' })
    expect(await ui.find({ key: 'file:develop.txt' })).toBeDefined()
  })
})

describe('cursor', () => {
  test('j and k walk the rows from the Uncommitted row down and stop at the ends', async ($, on) => {
    const { ui } = await setup($, on)
    const isCursor = async (subject: string) => (await rowText(ui, subject))?.props.inverse === true

    expect(await isCursor(top.subject)).toBe(false)
    await ui.press({ key: 'cursor-down' })
    expect((await ui.findAll({ type: 'Text', text: 'Uncommitted Changes (3)' })).at(-1)?.props.inverse).toBe(true)
    await ui.press({ key: 'cursor-down' })
    expect(await isCursor(top.subject)).toBe(true)
    await ui.press({ key: 'cursor-down' })
    expect(await isCursor(top.subject)).toBe(false)
    expect(await isCursor(second.subject)).toBe(true)
    await ui.press({ key: 'cursor-up' })
    await ui.press({ key: 'cursor-up' })
    await ui.press({ key: 'cursor-up' })
    expect((await ui.findAll({ type: 'Text', text: 'Uncommitted Changes (3)' })).at(-1)?.props.inverse).toBe(true) // the first row stays
    // the rows the scroll follows are drawn under these keys
    expect(await ui.find({ key: 'uncommitted' })).toBeDefined()
    expect(await ui.find({ key: `commit:${top.hash}` })).toBeDefined()
  })

  test('a click puts the cursor on the row and `o` folds what the cursor is on', async ($, on) => {
    const { ui } = await setup($, on)
    await ui.press({ key: `select:${second.hash}` })
    expect((await rowText(ui, second.subject))?.props.inverse).toBe(true)
    await ui.press({ key: 'cursor-down' })
    expect((await rowText(ui, third.subject))?.props.inverse).toBe(true)
    await ui.press({ key: 'details' }) // opens the third
    expect(await ui.find({ key: `details:${third.hash}` })).toBeDefined()
    expect(await ui.find({ key: `details:${second.hash}` })).toBeUndefined()
    await ui.press({ key: 'details' })
    expect(await ui.find({ key: `details:${third.hash}` })).toBeUndefined()
  })
})

describe('compare', () => {
  test('x compares the open commit with the one under the cursor, the older first', async ($, on) => {
    const { calls, ui } = await setup($, on)
    expect(await ui.find({ key: 'compare' })).toBeUndefined() // nothing open yet
    await ui.press({ key: `select:${target.hash}` })
    await ui.press({ key: 'cursor-up' })
    await ui.press({ key: 'cursor-up' }) // on commits[1]

    await ui.press({ key: 'compare' })
    const compared = diffCalls(calls, '--numstat').at(-1) ?? []
    expect(compared.slice(-3)).toEqual([target.hash, second.hash, '--']) // older (further down) first
    expect(await texts(ui, `Comparing ${target.hash.slice(0, 7)} ↔ ${second.hash.slice(0, 7)}`)).toBeDefined()
    expect(await texts(ui, '본문 첫 줄')).toBeUndefined() // the message is gone, the comparison's files are there

    // pressing a file shows the diff between the same two points
    await ui.press({ key: 'diff:src/app.ts' })
    expect(calls.filter(argv => argv.includes('-U3')).at(-1)?.slice(-5)).toEqual(['-U3', target.hash, second.hash, '--', 'src/app.ts'])
  })

  test('the other way round: the commit under the cursor is the older one when it is further down', async ($, on) => {
    const { calls, ui } = await setup($, on)
    await ui.press({ key: `select:${second.hash}` })
    await ui.press({ key: 'cursor-down' })
    await ui.press({ key: 'cursor-down' }) // on commits[3]
    await ui.press({ key: 'compare' })
    expect((diffCalls(calls, '--numstat').at(-1) ?? []).slice(-3)).toEqual([target.hash, second.hash, '--'])
  })

  test('against the Uncommitted row the working tree is the newer end', async ($, on) => {
    const { calls, ui } = await setup($, on)
    await ui.press({ key: `select:${second.hash}` })
    await ui.press({ key: 'cursor-up' })
    await ui.press({ key: 'cursor-up' }) // commits[0] is above; the next one up is the uncommitted row
    await ui.press({ key: 'compare' })
    expect((diffCalls(calls, '--numstat').at(-1) ?? []).slice(-2)).toEqual([second.hash, '--'])
    expect(await texts(ui, `Comparing ${second.hash.slice(0, 7)} ↔ Uncommitted Changes`)).toBeDefined()

    // a diff against the working tree names one revision only
    await ui.press({ key: 'diff:src/app.ts' })
    expect(calls.filter(argv => argv.includes('-U3')).at(-1)?.slice(-4)).toEqual(['-U3', second.hash, '--', 'src/app.ts'])
    await ui.press({ key: 'back' })

    // the working tree moves: a refresh reads the comparison again, without a flicker through "Loading…"
    const before = diffCalls(calls, '--numstat').length
    await ui.press({ key: 'refresh' })
    expect(diffCalls(calls, '--numstat').length).toBe(before + 1)
    expect(await texts(ui, `Comparing ${second.hash.slice(0, 7)} ↔ Uncommitted Changes`)).toBeDefined()
  })

  test('x on the open commit goes back to its details', async ($, on) => {
    const { ui } = await setup($, on)
    await ui.press({ key: `select:${second.hash}` })
    await ui.press({ key: 'cursor-down' })
    await ui.press({ key: 'compare' })
    expect(await texts(ui, /^Comparing/)).toBeDefined()
    await ui.press({ key: 'cursor-up' })
    await ui.press({ key: 'compare' })
    expect(await texts(ui, /^Comparing/)).toBeUndefined()
    expect(await texts(ui, '본문 첫 줄')).toBeDefined()
  })
})

describe('diff screen', () => {
  type Ui = Awaited<ReturnType<typeof mountAt>>
  const isGraph = async (ui: Ui) => (await ui.find({ key: 'branch' })) !== undefined
  const counter = async (ui: Ui) => (await ui.findAll({ type: 'Text', text: /^\(\d\/\d\)$/ })).at(-1)?.text
  const openFirst = async (ui: Ui) => {
    await ui.press({ key: `select:${target.hash}` })
    await ui.press({ key: 'diff:src/app.ts' })
  }

  test('a file replaces the whole pane with its unified diff and a bar with Back, the file and Prev / Next', async ($, on) => {
    const { calls, ui } = await setup($, on)
    await openFirst(ui)

    expect(await isGraph(ui)).toBe(false)
    expect(await ui.find({ key: 'cursor-down' })).toBeUndefined() // no graph toolbar
    expect(await ui.find({ key: 'back' })).toBeDefined()
    expect(await counter(ui)).toBe('(1/4)')
    expect(await texts(ui, `${target.hash.slice(0, 7)} (vs ${target.parents[0]!.slice(0, 7)})`)).toBeDefined()
    expect(calls.filter(argv => argv.includes('-U3')).at(-1)).toEqual(['git', 'diff', '-M', '--no-color', '--no-ext-diff', '-U3', target.parents[0], target.hash, '--', 'src/app.ts'])
    const code = await ui.find({ type: 'Code' })
    expect(code?.props.format).toBe('diff')
    expect(code?.text.startsWith('@@ -1,3 +1,3 @@')).toBe(true) // git's header lines are cut off
    expect(await ui.find({ key: 'file:0' })).toBeDefined()
    expect((await ui.find({ key: 'file:2' }))?.props.hotkey).toBe('3')
  })

  test('n and p walk the list and stop at its ends; the digits jump', async ($, on) => {
    const { calls, ui } = await setup($, on)
    await openFirst(ui)
    const before = calls.filter(argv => argv.includes('-U3')).length

    await ui.press({ key: 'diff-prev' })
    expect(await counter(ui)).toBe('(1/4)')
    expect(calls.filter(argv => argv.includes('-U3')).length).toBe(before) // nothing re-read

    await ui.press({ key: 'diff-next' }) // logo.bin: binary, no git call
    expect(await counter(ui)).toBe('(2/4)')
    expect(await texts(ui, 'Binary file: there is no text diff to show.')).toBeDefined()
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    expect(calls.filter(argv => argv.includes('-U3')).length).toBe(before)

    await ui.press({ key: 'diff-next' }) // the rename: both paths, no hunks
    expect(await counter(ui)).toBe('(3/4)')
    expect(calls.filter(argv => argv.includes('-U3')).at(-1)?.slice(-3)).toEqual(['--', 'old.txt', 'new.txt'])
    expect(await texts(ui, 'Renamed without changes to the content.')).toBeDefined()

    await ui.press({ key: 'diff-next' })
    await ui.press({ key: 'diff-next' }) // past the end
    expect(await counter(ui)).toBe('(4/4)')
    await ui.press({ key: 'file:0' })
    expect(await counter(ui)).toBe('(1/4)')
    expect((await ui.find({ type: 'Code' }))?.text.startsWith('@@')).toBe(true)
  })

  test('a huge diff keeps its start and says how many lines are left out', async ($, on) => {
    const { ui } = await setup($, on)
    await ui.press({ key: `select:${target.hash}` })
    await ui.press({ key: 'diff:big.txt' })
    const code = await ui.find({ type: 'Code' })
    expect(code?.text.length).toBeLessThan(100_000)
    const shown = code?.text.split('\n').length ?? 0
    expect(shown).toBeLessThanOrEqual(2500)
    expect(code?.text.startsWith(`@@ -0,0 +1,${shown - 1} @@`)).toBe(true) // the header counts the lines kept
    expect(await ui.find({ type: 'Text', text: `… ${5001 - shown} more lines not shown (the diff is too long to draw whole)` })).toBeDefined()
  })

  test('h goes back to the graph with the cursor, the open details and the search as they were', async ($, on) => {
    const { ui } = await setup($, on)
    await ui.press({ key: 'find' })
    await ui.input({ key: 'find-input', text: 'feat' })
    await ui.press({ key: `select:${target.hash}` })
    await ui.press({ key: 'diff:src/app.ts' })
    expect(await ui.find({ key: 'match-next' })).toBeUndefined() // n and p belong to the diff here
    expect(await ui.find({ key: 'find' })).toBeUndefined()

    await ui.press({ key: 'back' })
    expect(await isGraph(ui)).toBe(true)
    expect(await ui.find({ key: `details:${target.hash}` })).toBeDefined()
    expect((await rowText(ui, target.subject))?.props.inverse).toBe(true)
    expect(await texts(ui, /matches/)).toBeDefined()
    expect(await ui.find({ key: 'match-next' })).toBeDefined()
    expect(await ui.find({ key: 'back' })).toBeUndefined()
  })

  test('a comparison names both ends, and so does one against the working tree', async ($, on) => {
    const { calls, ui } = await setup($, on)
    await ui.press({ key: `select:${second.hash}` })
    await ui.press({ key: 'cursor-up' }) // commits[0]
    await ui.press({ key: 'compare' })
    await ui.press({ key: 'diff:src/app.ts' })
    expect(await texts(ui, `${second.hash.slice(0, 7)} ↔ ${top.hash.slice(0, 7)}`)).toBeDefined()
    expect(calls.filter(argv => argv.includes('-U3')).at(-1)?.slice(-5)).toEqual(['-U3', second.hash, top.hash, '--', 'src/app.ts'])
    await ui.press({ key: 'back' })
    await ui.press({ key: 'cursor-up' }) // the Uncommitted row
    await ui.press({ key: 'compare' })
    await ui.press({ key: 'diff:src/app.ts' })
    expect(await texts(ui, `${second.hash.slice(0, 7)} ↔ working tree`)).toBeDefined()
  })

  test('a git command in the session re-reads the diff and keeps the screen; a file that left the range sends it back', async ($, on) => {
    const { calls, ui } = await setup($, on)
    await openFirst(ui)
    const reads = () => calls.filter(argv => argv.includes('-U3')).length
    const before = reads()

    await callBash($, 'git commit -m x')
    expect(await isGraph(ui)).toBe(false)
    expect(await counter(ui)).toBe('(1/4)')
    expect(reads()).toBe(before + 1)

    feed.nameStatus = NAME_STATUS.replace(`M${NUL}src/app.ts${NUL}`, '')
    await callBash($, 'git checkout other')
    expect(await isGraph(ui)).toBe(true)
  })
})

describe('branch filter', () => {
  type Ui = Awaited<ReturnType<typeof mountAt>>
  /** The entries of the list, opened and closed again. */
  const options = async (ui: Ui) => {
    await ui.press({ key: 'branch' })
    const labels = (await ui.findAll({ type: 'Button', text: /^ *[● ] ./ }))
      .filter(button => button.key?.startsWith('branch:'))
      .map(button => (button.text ?? '').replace(/^ *[● ] /, ''))
    await ui.press({ key: 'branch' })
    return labels
  }
  /** Opens the list and clicks the entry for a ref (`*` for Show All). */
  const pick = async (ui: Ui, value: string) => {
    await ui.press({ key: 'branch' })
    await ui.press({ key: `branch:${value}` })
  }
  /** What the toolbar button says the filter is. */
  const shown = async (ui: Ui) => ((await ui.find({ key: 'branch' }))?.text ?? '').replace('Branches: ', '')

  test('lists Show All, then local and remote branches, and filters the log by one ref', async ($, on) => {
    const calls = fakeGit(on)
    fakePanes(on)
    await $.command.run(RUN)
    const ui = await mountAt($, 140)

    expect(await options(ui)).toEqual(['Show All', 'develop', 'main', 'origin/develop', 'origin/feature/remote-only', 'origin/main'])
    expect(await shown(ui)).toBe('Show All')

    await pick(ui, 'refs/remotes/origin/feature/remote-only')
    const log = logCalls(calls).at(-1) ?? []
    expect(log).toContain('refs/remotes/origin/feature/remote-only')
    expect(log).not.toContain('--branches')
    expect(log).not.toContain('HEAD')
    expect(await shown(ui)).toBe('origin/feature/remote-o…') // cut to 24 cells

    await pick(ui, '*')
    expect(logCalls(calls).at(-1)).toContain('--branches')
    expect(await shown(ui)).toBe('Show All')
  })

  test('the remote toggle only trims the list; hiding remotes drops a remote selection', async ($, on) => {
    const calls = fakeGit(on)
    fakePanes(on)
    await $.command.run(RUN)
    const ui = await mountAt($, 140)

    await pick(ui, 'refs/heads/main')
    await ui.press({ key: 'remotes' })
    expect(await options(ui)).toEqual(['Show All', 'develop', 'main'])
    expect(await shown(ui)).toBe('main') // a local branch stays selected
    expect(logCalls(calls).at(-1)).toContain('refs/heads/main')

    await ui.press({ key: 'remotes' })
    await pick(ui, 'refs/remotes/origin/main')
    await ui.press({ key: 'remotes' })
    expect(await shown(ui)).toBe('Show All')
    expect(logCalls(calls).at(-1)).toContain('--branches')
  })

  test('a branch that is gone (pruned) falls back to everything', async ($, on) => {
    let refs = 'refs/heads/develop\nrefs/heads/old\n'
    const calls = fakeGit(on, { answer: argv => (argv.includes('for-each-ref') ? { stdout: refs } : undefined) })
    fakePanes(on)
    await $.command.run(RUN)
    const ui = await mountAt($, 140)
    await pick(ui, 'refs/heads/old')
    expect(await shown(ui)).toBe('old')

    refs = 'refs/heads/develop\n'
    await ui.press({ key: 'refresh' })
    expect(await shown(ui)).toBe('Show All')
    expect(logCalls(calls).at(-1)).toContain('--branches')
  })

  test('the Uncommitted row is left out when the branch does not contain HEAD', async ($, on) => {
    const withoutHead = FIXTURE_LOG.split(NUL).slice(1).join(NUL)
    fakeGit(on, { answer: argv => (argv.includes('log') && argv.includes('refs/heads/main') ? { stdout: withoutHead } : undefined) })
    fakePanes(on)
    await $.command.run(RUN)
    const ui = await mountAt($, 140)
    expect(await ui.find({ key: 'changes' })).toBeDefined()
    await pick(ui, 'refs/heads/main')
    expect(await ui.find({ key: 'changes' })).toBeUndefined()
  })

  test('picking a branch folds the open details', async ($, on) => {
    const { ui } = await setup($, on)
    await ui.press({ key: `select:${second.hash}` })
    await pick(ui, 'refs/heads/main')
    expect(await ui.find({ key: `details:${second.hash}` })).toBeUndefined()
  })
})

describe('branch list', () => {
  type Ui = Awaited<ReturnType<typeof mountAt>>
  const picked = async (ui: Ui) =>
    (await ui.findAll({ type: 'Button' }))
      .filter(button => button.key?.startsWith('branch:') && JSON.stringify(button).includes('"inverse":true'))
      .map(button => button.key)
  const shown = async (ui: Ui) => ((await ui.find({ key: 'branch' }))?.text ?? '').replace('Branches: ', '')

  test('l opens it with the highlight on the current filter; l again closes it', async ($, on) => {
    fakeGit(on)
    fakePanes(on)
    await $.command.run(RUN)
    const ui = await mountAt($, 140)
    expect(await ui.find({ key: 'branch:*' })).toBeUndefined()
    await ui.press({ key: 'branch' })
    expect(await picked(ui)).toEqual(['branch:*'])
    expect(await ui.find({ key: 'branch:refs/heads/main' })).toBeDefined()
    await ui.press({ key: 'branch' })
    expect(await ui.find({ key: 'branch:*' })).toBeUndefined()
    await ui.unmount()
  })

  test('j / k move the highlight (not the commit cursor) and stop at the ends; o picks it', async ($, on) => {
    const calls = fakeGit(on)
    fakePanes(on)
    await $.command.run(RUN)
    const ui = await mountAt($, 140)
    await ui.press({ key: 'branch' })
    await ui.press({ key: 'cursor-up' })
    expect(await picked(ui)).toEqual(['branch:*'])
    await ui.press({ key: 'cursor-down' })
    await ui.press({ key: 'cursor-down' })
    expect(await picked(ui)).toEqual(['branch:refs/heads/main'])
    for (let i = 0; i < 10; i++) await ui.press({ key: 'cursor-down' })
    expect(await picked(ui)).toEqual(['branch:refs/remotes/origin/main'])
    await ui.press({ key: 'cursor-up' })
    await ui.press({ key: 'details' }) // o
    expect(logCalls(calls).at(-1)).toContain('refs/remotes/origin/feature/remote-only')
    expect(await ui.find({ key: 'branch:*' })).toBeUndefined() // closed
    expect(await ui.find({ key: `commit:${commits[0]?.hash}` })).toBeDefined()
    expect((await ui.findAll({ type: 'Text', text: 'Uncommitted Changes (3)' })).at(-1)?.props.inverse).toBeFalsy() // no commit cursor
    await ui.unmount()
  })

  test('the first nine entries answer to a digit', async ($, on) => {
    const calls = fakeGit(on)
    fakePanes(on)
    await $.command.run(RUN)
    const ui = await mountAt($, 140)
    await ui.press({ key: 'branch' })
    expect((await ui.find({ key: 'branch:refs/heads/develop' }))?.props.hotkey).toBe('2')
    await ui.press({ key: 'branch:refs/heads/develop' }) // what the digit 2 presses
    expect(logCalls(calls).at(-1)).toContain('refs/heads/develop')
    expect(await shown(ui)).toBe('develop')
    await ui.press({ key: 'branch' })
    expect(await picked(ui)).toEqual(['branch:refs/heads/develop']) // opens on the current filter
    await ui.unmount()
  })

  test('with remotes hidden the list has no remote branches', async ($, on) => {
    fakeGit(on)
    fakePanes(on)
    await $.command.run(RUN)
    const ui = await mountAt($, 140)
    await ui.press({ key: 'remotes' })
    await ui.press({ key: 'branch' })
    expect(await ui.find({ key: 'branch:refs/remotes/origin/main' })).toBeUndefined()
    expect(await ui.find({ key: 'branch:refs/heads/main' })).toBeDefined()
    await ui.unmount()
  })

  test('opening it closes the details; opening the actions closes it', async ($, on) => {
    fakeGit(on, { answer: argv => (argv.includes('show') ? { exitCode: 128, stderr: 'x' } : undefined) })
    fakePanes(on)
    await $.command.run(RUN)
    const ui = await mountAt($, 140)
    await ui.press({ key: `select:${commits[1]?.hash}` })
    expect(await ui.find({ key: `details:${commits[1]?.hash}` })).toBeDefined()
    await ui.press({ key: 'branch' })
    expect(await ui.find({ key: `details:${commits[1]?.hash}` })).toBeUndefined()
    await ui.press({ key: 'actions' })
    expect(await ui.find({ key: 'branch:*' })).toBeUndefined()
    expect(await ui.find({ key: 'action:commit#revert' })).toBeDefined()
    await ui.press({ key: 'branch' })
    expect(await ui.find({ key: 'action:commit#revert' })).toBeUndefined()
    await ui.unmount()
  })

  test('a long list shows a window around the highlight', async ($, on) => {
    const names = Array.from({ length: 40 }, (_, i) => `refs/heads/b${String(i).padStart(2, '0')}`)
    fakeGit(on, { refs: `${names.join('\n')}\n` })
    fakePanes(on)
    await $.command.run(RUN)
    const ui = await mountAt($, 140)
    await ui.press({ key: 'branch' })
    const rows = async () => (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('branch:')).length
    expect(await rows()).toBe(10)
    expect(await ui.find({ type: 'Text', text: /more below/ })).toBeDefined()
    for (let i = 0; i < 20; i++) await ui.press({ key: 'cursor-down' })
    expect(await rows()).toBe(10)
    expect(await ui.find({ type: 'Text', text: /more above/ })).toBeDefined()
    expect(await picked(ui)).toEqual(['branch:refs/heads/b19'])
    await ui.unmount()
  })
})

describe('find', () => {
  const loaded = commits.slice(0, 50)

  test('the field opens on `s`; typing highlights, the count follows, Enter lands the cursor on the first match', async ($, on) => {
    const { ui } = await setup($, on)
    const matches = findMatches(loaded, 'login')
    expect(matches.length).toBeGreaterThan(1)

    expect(await ui.find({ key: 'find-input' })).toBeUndefined()
    await ui.press({ key: 'find' })
    expect(await ui.find({ key: 'find-input' })).toBeDefined()

    await ui.input({ key: 'find-input', text: 'login', kind: 'change' })
    expect(await texts(ui, `${matches.length} matches`)).toBeDefined()
    const marked = await ui.findAll({ type: 'Text', text: /^login$/i })
    expect(marked.some(one => one.props.backgroundColor === 'warning')).toBe(true)

    await ui.input({ key: 'find-input', text: 'login' }) // Enter
    expect(await ui.find({ key: 'find-input' })).toBeUndefined() // the field goes, the highlight stays
    expect(await texts(ui, `1/${matches.length} matches`)).toBeDefined()
    const first = loaded.find(commit => commit.hash === matches[0])!
    expect((await rowText(ui, first.subject))?.props.inverse).toBe(true)
  })

  test('n and p walk the matches and wrap around', async ($, on) => {
    const { ui } = await setup($, on)
    const matches = findMatches(loaded, 'login')
    await ui.press({ key: 'find' })
    await ui.input({ key: 'find-input', text: 'login' })

    await ui.press({ key: 'match-next' })
    expect(await texts(ui, `2/${matches.length} matches`)).toBeDefined()
    await ui.press({ key: 'match-prev' })
    await ui.press({ key: 'match-prev' }) // before the first: the last
    expect(await texts(ui, `${matches.length}/${matches.length} matches`)).toBeDefined()
    await ui.press({ key: 'match-next' })
    expect(await texts(ui, `1/${matches.length} matches`)).toBeDefined()
  })

  test('message, author, hash and branch names all match; nothing matching says so', async ($, on) => {
    const { ui } = await setup($, on)
    await ui.press({ key: 'find' })
    for (const query of ['결제', 'jiwoo'.slice(0, 0) + '한지우', top.hash.slice(0, 7), 'origin/feature/remote-only', 'V1.0.1']) {
      await ui.input({ key: 'find-input', text: query, kind: 'change' })
      const count = findMatches(loaded, query).length
      expect(count).toBeGreaterThan(0)
      expect(await texts(ui, new RegExp(`^${count} matches$`))).toBeDefined()
    }
    await ui.input({ key: 'find-input', text: 'zzz-no-such', kind: 'change' })
    expect(await texts(ui, 'No matches')).toBeDefined()
    expect(await ui.find({ key: 'match-next' })).toBeUndefined()
  })

  test('an empty field or Clear drops the highlight and the count', async ($, on) => {
    const { ui } = await setup($, on)
    await ui.press({ key: 'find' })
    await ui.input({ key: 'find-input', text: 'login', kind: 'change' })
    await ui.input({ key: 'find-input', text: '', kind: 'change' })
    expect(await texts(ui, /matches/)).toBeUndefined()
    expect(await ui.find({ key: 'match-next' })).toBeUndefined()

    await ui.input({ key: 'find-input', text: 'login' })
    expect(await ui.find({ key: 'find-clear' })).toBeDefined()
    await ui.press({ key: 'find-clear' })
    expect(await ui.find({ key: 'find-clear' })).toBeUndefined()
    expect(await texts(ui, /matches/)).toBeUndefined()
  })

  test('the keys are n and p, and `s` is Find (a hotkey is a digit or a lowercase letter)', async ($, on) => {
    const { ui } = await setup($, on)
    expect((await ui.find({ key: 'find' }))?.props.hotkey).toBe('s')
    expect((await ui.find({ key: 'fetch' }))?.props.hotkey).toBe('f')
    expect((await ui.find({ key: 'cursor-down' }))?.props.hotkey).toBe('j')
    expect((await ui.find({ key: 'cursor-up' }))?.props.hotkey).toBe('k')
    expect((await ui.find({ key: 'details' }))?.props.hotkey).toBe('o')
  })
})

describe('fetch', () => {
  test('shows a status line while it runs, toasts the result, then refreshes', async ($, on) => {
    const calls = fakeGit(on, { answer: argv => (argv[0] === 'fetch' ? { stdout: '' } : undefined) })
    fakePanes(on)
    const events = fakeScreen(on)
    await $.command.run(RUN)
    const ui = await mountAt($, 140)
    const logsBefore = logCalls(calls).length

    await ui.press({ key: 'fetch' })
    expect(calls.find(argv => argv[1] === 'fetch')).toEqual(['git', 'fetch', '--all', '--prune'])
    expect(events).toEqual(['status:Fetching…', 'status:undefined', 'toast:Fetched all remotes'])
    expect(logCalls(calls)).toHaveLength(logsBefore + 1) // the refresh after it
    expect((await ui.find({ key: 'fetch' }))?.text).toContain('Fetch')
  })

  test('a failure toasts the first line of the error and still refreshes', async ($, on) => {
    const calls = fakeGit(on, {
      answer: argv => (argv[0] === 'fetch' ? { exitCode: 128, stderr: '\nfatal: unable to access \'https://x\'\nmore detail' } : undefined),
    })
    fakePanes(on)
    const events = fakeScreen(on)
    await $.command.run(RUN)
    const ui = await mountAt($, 140)
    const logsBefore = logCalls(calls).length

    await ui.press({ key: 'fetch' })
    expect(events).toEqual(['status:Fetching…', 'status:undefined', "toast:Fetch failed: fatal: unable to access 'https://x'"])
    expect(logCalls(calls)).toHaveLength(logsBefore + 1)
  })
})

describe('toolbar and file hotkeys', () => {
  const toolbarRows = async (ui: Awaited<ReturnType<typeof mountAt>>) => {
    const root = (await ui.drawn()) as { children?: { type?: string; props?: Record<string, unknown> }[] }
    const children = root.children ?? []
    const header = children.findIndex(child => child.props?.key === 'header')
    return children.slice(0, header).filter(child => child.type === 'Box' && child.props?.key === undefined).length
  }

  test('the toolbar takes one row at 140 columns and two at 83, with details and a search open too', async ($, on) => {
    fakeGit(on, { answer: answers() })
    fakePanes(on)
    await $.command.run(RUN)
    const wide = await mountAt($, 140)
    expect(await toolbarRows(wide)).toBe(1)
    await wide.unmount()
    const narrow = await mountAt($, 83)
    expect(await toolbarRows(narrow)).toBe(2)
    await narrow.press({ key: `select:${second.hash}` })
    await narrow.press({ key: 'find' })
    await narrow.input({ key: 'find-input', text: 'login' })
    expect(await toolbarRows(narrow)).toBe(2)
    expect((await narrow.find({ key: 'style' }))?.text).toBe('text') // a narrow pane shortens the label
  })

  test('the first nine files carry the digits 1 to 9', async ($, on) => {
    const { ui } = await setup($, on)
    await ui.press({ key: `select:${second.hash}` })
    expect((await ui.find({ key: 'diff:src/app.ts' }))?.props.hotkey).toBe('1')
    expect((await ui.find({ key: 'diff:big.txt' }))?.props.hotkey).toBe('4')
  })
})
