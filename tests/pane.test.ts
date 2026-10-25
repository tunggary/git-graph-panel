import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { darken } from '../hooks/lib/labels'
import { PALETTE } from '../hooks/lib/lanes'
import { PANE, PLUGIN, RUN, commits, fakeGit, fakePanes, logCalls, mountAt, paneProps } from './helpers'

// `$.tool.call` is typed over every connected MCP tool as well, and the compiler gives up on that union
// (TS2589) for a Bash call; this narrows it to the one shape the tests use.
const callBash = ($: Engine, command: string) =>
  ($.tool.call as unknown as (input: { tool: 'Bash'; command: string }) => Promise<unknown>)({ tool: 'Bash', command })

describe('git graph pane', () => {
  test('/graph opens the pane, loads the repository and toggles it closed', async ($, on) => {
    const calls = fakeGit(on)
    const open = fakePanes(on)

    await $.command.run(RUN)
    expect(open.has(PANE)).toBe(true)
    expect(logCalls(calls)).toHaveLength(1)
    // branches, remotes, tags and HEAD only: no `--all`, so stashes and tools' private refs stay out
    expect(logCalls(calls)[0]).toEqual(expect.arrayContaining(['--branches', '--remotes', '--tags', 'HEAD']))
    expect(logCalls(calls)[0]).not.toContain('--all')
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
    expect(await ui.find({ key: 'load-more' })).toBeUndefined() // all 75 commits are loaded
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

    expect((await ui.find({ key: 'remotes' }))?.text).toContain('☑ remote')
    await ui.press({ key: 'remotes' })
    const log = logCalls(calls).at(-1) ?? []
    expect(log).not.toContain('--remotes')
    expect(log).toEqual(expect.arrayContaining(['--branches', '--tags', 'HEAD']))
    expect((await ui.find({ key: 'remotes' }))?.text).toContain('☐ remote')
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
    // the fixture has 13 lanes; from 65 columns all of them fit in 40% of the pane (26 cells)
    expect(await columns(80)).toEqual({ hash: false, author: true, date: true })
    expect(await columns(70)).toEqual({ hash: false, author: false, date: true })
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
    for (let i = 0; i < 1000 && logCalls(calls).length === 0; i++) await Promise.resolve()
    expect(open.has(PANE)).toBe(true)
    expect(logCalls(calls)).toHaveLength(1)
  })

  for (const source of ['clear', 'resume', 'compact', 'fork'] as const) {
    test(`${source} reloads the open pane`, async ($, on) => {
      const calls = fakeGit(on)
      fakePanes(on)
      on('classic.SessionStart', () => ({}) as never)
      await $.command.run(RUN)
      expect(logCalls(calls)).toHaveLength(1)

      await $.classic.SessionStart({ source })
      expect(logCalls(calls)).toHaveLength(2)
      const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: paneProps(140), viewport: { columns: 140, rows: 40 } })
      expect(await ui.find({ key: `commit:${commits[0]?.hash}` })).toBeDefined()
      await ui.unmount()
    })
  }

  test('startup leaves the reload to session.start', async ($, on) => {
    const calls = fakeGit(on)
    fakePanes(on)
    on('classic.SessionStart', () => ({}) as never)
    await $.command.run(RUN)

    await $.classic.SessionStart({ source: 'startup' })
    expect(logCalls(calls)).toHaveLength(1)
  })

  test('/clear leaves a closed pane closed', async ($, on) => {
    const calls = fakeGit(on)
    const open = fakePanes(on)
    on('classic.SessionStart', () => ({}) as never)

    await $.classic.SessionStart({ source: 'clear' })
    expect(open.has(PANE)).toBe(false)
    expect(logCalls(calls)).toHaveLength(0)
  })

  test('session.start does not open the pane outside a repository', async ($, on) => {
    fakeGit(on, { isRepo: false })
    const open = fakePanes(on)
    on('command.register', () => ({ value: undefined }) as never)
    on('session.start', (_$, e) => ({ cwd: e.cwd }))

    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    expect(open.has(PANE)).toBe(false)
  })

  test('a header row names the columns and loses them with the same rules as the rows', async ($, on) => {
    fakeGit(on)
    fakePanes(on)
    await $.command.run(RUN)
    const headers = async (columns: number) => {
      const ui = await mountAt($, columns)
      const shown = await Promise.all(
        ['Graph', 'Description', 'Date', 'Author', 'Commit'].map(async text => (await ui.find({ type: 'Text', text })) !== undefined),
      )
      await ui.unmount()
      return shown
    }

    expect(await headers(140)).toEqual([true, true, true, true, true])
    expect(await headers(80)).toEqual([true, true, true, true, false])
    expect(await headers(70)).toEqual([true, true, true, false, false])
    expect(await headers(45)).toEqual([true, true, false, false, false])
  })

  test('labels: a local branch absorbs its remote twin, the rest keep their names; merge messages are dim', async ($, on) => {
    fakeGit(on)
    fakePanes(on)
    await $.command.run(RUN)
    const ui = await mountAt($, 160)

    const exact = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`)
    // A pill is a Text around its colored parts; `find` takes the innermost one that has a color.
    const find = async (text: string) => (await ui.findAll({ type: 'Text', text: exact(text) })).at(-1)

    // Branch pills are painted in the lane color of their commit; the remote half is a darker tone.
    const [local, remote] = ((await find(' main │ origin '))?.children ?? []) as { props: Record<string, unknown>; children: string[] }[]
    expect(local?.children).toEqual([' main '])
    expect(remote?.children).toEqual(['│ origin '])
    expect(PALETTE).toContain(local?.props.backgroundColor)
    expect(remote?.props.backgroundColor).toBe(darken(local?.props.backgroundColor as string))
    expect(local?.props.bold).toBe(false)
    expect(await find(' origin/develop ')).toBeDefined()
    expect((await find(' v1.0.1 '))?.props.backgroundColor).toBe('#9a6700')
    expect((await find(' develop '))?.props.bold).toBe(true) // the checked-out branch
    expect((await find(' develop '))?.props.backgroundColor).toBe(PALETTE[0]) // lane 0

    expect((await find('merge: hotfix/1.0.1 병합'))?.props.dimColor).toBe(true)
    expect((await find('docs: 변경 내역 정리'))?.props.dimColor).toBe(false)
    await ui.unmount()
  })

  test('a click on a button in the pane asks for the keyboard, so its hotkeys work next', async ($, on) => {
    fakeGit(on)
    const panes = fakePanes(on)
    await $.command.run(RUN)
    const ui = await mountAt($, 140)
    expect(panes.focused).toEqual([])
    await ui.press({ key: `select:${commits[2]!.hash}` }) // the description and labels of a row
    expect(panes.focused).toEqual([PANE])
    await ui.unmount()
  })

  test('a ghostty terminal draws the graph as pictures', async ($, on) => {
    fakeGit(on, { env: { TERM_PROGRAM: 'ghostty' } })
    fakePanes(on)
    await $.command.run(RUN)
    const ui = await mountAt($, 140)

    expect(await ui.find({ type: 'Image' })).toBeDefined()
    expect((await ui.find({ key: 'style' }))?.text).toContain('Graph style: image')
    await ui.unmount()
  })

  test('the desktop app gets the text graph: only the terminal draws pictures', async ($, on) => {
    fakeGit(on, { env: { TERM_PROGRAM: 'ghostty' } })
    fakePanes(on)
    await $.command.run(RUN)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: PANE, props: paneProps(140), viewport: { columns: 140, rows: 40 } })

    expect(await ui.find({ type: 'Text', text: /●/ })).toBeDefined() // the graph column is drawn in text, not left empty
    await ui.unmount()
  })

  test('tmux gets the text graph even inside ghostty', async ($, on) => {
    fakeGit(on, { env: { TERM_PROGRAM: 'ghostty', TMUX: '/tmp/tmux-501/default,1,0' } })
    fakePanes(on)
    await $.command.run(RUN)
    const ui = await mountAt($, 140)

    expect(await ui.find({ type: 'Image' })).toBeUndefined()
    expect((await ui.find({ key: 'style' }))?.text).toContain('Graph style: text')
    await ui.unmount()
  })

  test('g toggles the style and remembers the choice in the store', async ($, on) => {
    const store = new Map<string, unknown>()
    fakeGit(on, { env: { TERM_PROGRAM: 'ghostty' }, store })
    fakePanes(on)
    await $.command.run(RUN)
    const ui = await mountAt($, 140)

    expect(store.get('graphStyle')).toBeUndefined()
    await ui.press({ key: 'style' })
    expect(await ui.find({ type: 'Image' })).toBeUndefined()
    expect((await ui.find({ key: 'style' }))?.text).toContain('Graph style: text')
    expect(store.get('graphStyle')).toBe('text')
    await ui.press({ key: 'style' })
    expect(await ui.find({ type: 'Image' })).toBeDefined()
    expect(store.get('graphStyle')).toBe('image')
    await ui.unmount()
  })

  test('a style saved in an earlier session wins over the terminal', async ($, on) => {
    fakeGit(on, { env: { TERM_PROGRAM: 'ghostty' }, store: new Map([['graphStyle', 'text']]) })
    const open = fakePanes(on)
    on('command.register', () => ({ value: undefined }) as never)
    on('session.start', (_$, e) => ({ cwd: e.cwd }))

    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    expect(open.has(PANE)).toBe(true)
    const ui = await mountAt($, 140)
    expect(await ui.find({ type: 'Image' })).toBeUndefined()
    expect((await ui.find({ key: 'style' }))?.text).toContain('Graph style: text')
    await ui.unmount()
  })
})
