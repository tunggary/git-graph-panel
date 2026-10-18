import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { parseLog } from '../hooks/lib/parse'
import { FIXTURE_HEAD, FIXTURE_LOG, FIXTURE_STATUS } from './fixtures/fixture-log'

const PLUGIN = 'git-graph-panel'
const PANE = 'git-graph'
const commits = parseLog(FIXTURE_LOG)
const RUN = { command: 'graph', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as never

/** Stands in for the host's git: answers `$.process.run` from the fixture's output. */
function fakeGit(on: On, { isRepo = true, status = FIXTURE_STATUS }: { isRepo?: boolean; status?: string } = {}) {
  const calls: string[][] = []
  const ok = (stdout: string) => ({
    value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  })
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    calls.push(argv)
    if (!isRepo) {
      return { value: { ...ok('').value, exitCode: 128, stderr: 'fatal: not a git repository' } }
    }
    if (argv.includes('--is-inside-work-tree')) return ok('true\n')
    if (argv.includes('--verify')) return ok(`${FIXTURE_HEAD}\n`)
    if (argv.includes('log')) return ok(FIXTURE_LOG)
    if (argv.includes('status')) return ok(status)
    throw new Error(`unexpected git call: ${argv.join(' ')}`)
  })
  return calls
}

/** The panes the plugin has open, as the host would keep them. */
function fakePanes(on: On) {
  const open = new Set<string>()
  on('ui.open', (_$, e) => {
    open.add(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', (_$, e) => {
    open.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: [...open].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })),
  }))
  return open
}

const paneProps = (bodyColumns: number) => ({
  title: 'Git Graph',
  isFocused: false,
  bodyColumns,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
})

// `$.tool.call` is typed over every connected MCP tool as well, and the compiler gives up on that union
// (TS2589) for a Bash call; this narrows it to the one shape the tests use.
const callBash = ($: Engine, command: string) =>
  ($.tool.call as unknown as (input: { tool: 'Bash'; command: string }) => Promise<unknown>)({ tool: 'Bash', command })

const logCalls = (calls: string[][]) => calls.filter(argv => argv.includes('log'))

describe('git graph pane', () => {
  test('/graph opens the pane, loads the repository and toggles it closed', async ($, on) => {
    const calls = fakeGit(on)
    const open = fakePanes(on)

    await $.command.run(RUN)
    expect(open.has(PANE)).toBe(true)
    expect(logCalls(calls)).toHaveLength(1)
    expect(logCalls(calls)[0]).toContain('--all')
    expect(logCalls(calls)[0]).toContain('-n51')

    await $.command.run(RUN)
    expect(open.has(PANE)).toBe(false)
  })

  test('draws the toolbar, the uncommitted row and 50 commits; Load more fetches 50 more', async ($, on) => {
    const calls = fakeGit(on)
    fakePanes(on)
    await $.command.run(RUN)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: paneProps(140), viewport: { columns: 140, rows: 40 } })

    expect(await ui.find({ key: 'refresh' })).toBeDefined()
    expect(await ui.find({ key: 'remotes' })).toBeDefined()
    expect(await ui.find({ key: 'changes', text: 'Uncommitted Changes (3)' })).toBeDefined()
    expect(await ui.find({ key: `commit:${commits[0]?.hash}` })).toBeDefined()
    expect(await ui.find({ key: `commit:${commits[49]?.hash}` })).toBeDefined()
    expect(await ui.find({ key: `commit:${commits[50]?.hash}` })).toBeUndefined()

    await ui.press({ key: 'load-more' })
    expect(logCalls(calls).at(-1)).toContain('-n101')
    expect(await ui.find({ key: `commit:${commits[70]?.hash}` })).toBeDefined()
    expect(await ui.find({ key: 'load-more' })).toBeUndefined() // all 71 commits are loaded
    await ui.unmount()
  })

  test('the uncommitted row unfolds into its files', async ($, on) => {
    fakeGit(on)
    fakePanes(on)
    await $.command.run(RUN)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: paneProps(140), viewport: { columns: 140, rows: 40 } })

    expect(await ui.find({ key: 'file:develop.txt' })).toBeUndefined()
    await ui.press({ key: 'changes' })
    expect(await ui.find({ key: 'file:develop.txt' })).toBeDefined()
    expect(await ui.find({ key: 'file:staged-new.txt' })).toBeDefined()
    expect(await ui.find({ key: 'file:untracked-note.txt' })).toBeDefined()
    await ui.press({ key: 'changes' })
    expect(await ui.find({ key: 'file:develop.txt' })).toBeUndefined()
    await ui.unmount()
  })

  test('without changes there is no uncommitted row', async ($, on) => {
    fakeGit(on, { status: '' })
    fakePanes(on)
    await $.command.run(RUN)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: paneProps(140), viewport: { columns: 140, rows: 40 } })

    expect(await ui.find({ key: 'changes' })).toBeUndefined()
    expect(await ui.find({ key: `commit:${commits[0]?.hash}` })).toBeDefined()
    await ui.unmount()
  })

  test('the remote branch toggle reloads without remote refs', async ($, on) => {
    const calls = fakeGit(on)
    fakePanes(on)
    await $.command.run(RUN)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: paneProps(140), viewport: { columns: 140, rows: 40 } })

    expect((await ui.find({ key: 'remotes' }))?.text).toContain('☑ Show remote branches')
    await ui.press({ key: 'remotes' })
    const log = logCalls(calls).at(-1) ?? []
    expect(log).not.toContain('--all')
    expect(log).toEqual(expect.arrayContaining(['--branches', '--tags', 'HEAD']))
    expect((await ui.find({ key: 'remotes' }))?.text).toContain('☐ Show remote branches')
    await ui.unmount()
  })

  test('Refresh runs git again', async ($, on) => {
    const calls = fakeGit(on)
    fakePanes(on)
    await $.command.run(RUN)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: paneProps(140), viewport: { columns: 140, rows: 40 } })

    await ui.press({ key: 'refresh' })
    expect(logCalls(calls)).toHaveLength(2)
    await ui.unmount()
  })

  test('a narrow pane drops the hash, then the author, then the date', async ($, on) => {
    fakeGit(on)
    fakePanes(on)
    await $.command.run(RUN)
    const hash = commits[0]?.hash.slice(0, 7) ?? ''
    const author = commits[0]?.author ?? ''
    const columns = async (bodyColumns: number) => {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: paneProps(bodyColumns), viewport: { columns: bodyColumns, rows: 40 } })
      const shown = {
        hash: (await ui.find({ type: 'Text', text: hash })) !== undefined,
        author: (await ui.find({ type: 'Text', text: author })) !== undefined,
        date: (await ui.find({ type: 'Text', text: /^\d\d-\d\d \d\d:\d\d$/ })) !== undefined,
      }
      await ui.unmount()
      return shown
    }

    expect(await columns(140)).toEqual({ hash: true, author: true, date: true })
    expect(await columns(70)).toEqual({ hash: false, author: true, date: true })
    expect(await columns(60)).toEqual({ hash: false, author: false, date: true })
    expect(await columns(45)).toEqual({ hash: false, author: false, date: false })
  })

  test('outside a git repository the pane says so', async ($, on) => {
    fakeGit(on, { isRepo: false })
    fakePanes(on)
    await $.command.run(RUN)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: paneProps(100), viewport: { columns: 100, rows: 40 } })

    expect(await ui.find({ type: 'Text', text: /not a git repository/ })).toBeDefined()
    await ui.unmount()
  })

  test('a git command run through Bash refreshes an open pane; other commands do not', async ($, on) => {
    const calls = fakeGit(on)
    const open = fakePanes(on)
    on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }) as never)

    await callBash($, 'git status')
    expect(logCalls(calls)).toHaveLength(0) // pane not open

    await $.command.run(RUN)
    expect(open.has(PANE)).toBe(true)
    expect(logCalls(calls)).toHaveLength(1)

    await callBash($, 'ls -la')
    expect(logCalls(calls)).toHaveLength(1)

    await callBash($, 'git commit -m "fix: x"')
    expect(logCalls(calls)).toHaveLength(2)
  })

  test('session.start opens the pane inside a repository and stays quiet outside one', async ($, on) => {
    const calls = fakeGit(on)
    const open = fakePanes(on)
    on('command.register', () => ({ value: undefined }) as never)
    on('session.start', (_$, e) => ({ cwd: e.cwd }))

    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    // The pane is opened and filled in the background, after session.start has answered.
    for (let i = 0; i < 100 && logCalls(calls).length === 0; i++) await Promise.resolve()
    expect(open.has(PANE)).toBe(true)
    expect(logCalls(calls)).toHaveLength(1)
  })

  test('session.start does not open the pane outside a repository', async ($, on) => {
    fakeGit(on, { isRepo: false })
    const open = fakePanes(on)
    on('command.register', () => ({ value: undefined }) as never)
    on('session.start', (_$, e) => ({ cwd: e.cwd }))

    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    expect(open.has(PANE)).toBe(false)
  })
})
