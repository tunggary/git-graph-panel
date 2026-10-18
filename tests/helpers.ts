// What the pane tests share: a fake host (git, panes, the calls the pane makes on `$.ui`) and the mount call.

import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { parseLog } from '../hooks/lib/parse'
import { FIXTURE_HEAD, FIXTURE_LOG, FIXTURE_STATUS } from './fixtures/fixture-log'

export const PLUGIN = 'git-graph-panel'
export const PANE = 'git-graph'
export const commits = parseLog(FIXTURE_LOG)
export const RUN = { command: 'graph', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as never

export const REFS = [
  'refs/heads/develop',
  'refs/heads/main',
  'refs/remotes/origin/HEAD',
  'refs/remotes/origin/develop',
  'refs/remotes/origin/feature/remote-only',
  'refs/remotes/origin/main',
  '',
].join('\n')

export type GitAnswer = { stdout?: string; stderr?: string; exitCode?: number }

/**
 * Stands in for the host's git: answers `$.process.run` from the fixture's output. `answer` sees every call first
 * (its argv, without the leading `git`) and may answer it; anything neither knows is an error in the test.
 */
export function fakeGit(
  on: On,
  {
    isRepo = true,
    status = FIXTURE_STATUS,
    env = {},
    store = new Map(),
    refs = REFS,
    answer,
  }: {
    isRepo?: boolean
    status?: string
    env?: Record<string, string>
    store?: Map<string, unknown>
    refs?: string
    answer?: (argv: string[]) => GitAnswer | undefined
  } = {},
) {
  mock.env(on, env) // no terminal variables: the text graph
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  const calls: string[][] = []
  /** The `{ env, timeoutMs }` each call was given, parallel to `calls`. */
  const inits: Array<{ env?: Record<string, string>; timeoutMs?: number } | undefined> = []
  const reply = ({ stdout = '', stderr = '', exitCode = 0 }: GitAnswer) => ({
    value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
  })
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    calls.push(argv)
    inits.push(e.init)
    if (!isRepo) return reply({ exitCode: 128, stderr: 'fatal: not a git repository' })
    const custom = answer?.(argv.slice(1))
    if (custom) return reply(custom)
    if (argv.includes('--is-inside-work-tree')) return reply({ stdout: 'true\n' })
    if (argv.includes('--verify')) return reply({ stdout: `${FIXTURE_HEAD}\n` })
    if (argv.includes('for-each-ref')) return reply({ stdout: refs })
    if (argv.includes('log')) return reply({ stdout: FIXTURE_LOG })
    if (argv.includes('status')) return reply({ stdout: status })
    throw new Error(`unexpected git call: ${argv.join(' ')}`)
  })
  return Object.assign(calls, { inits })
}

/** The panes the plugin has open, as the host would keep them; `titles` holds the latest title of each, `focused` the focus requests. */
export function fakePanes(on: On) {
  const open = new Set<string>()
  const titles = new Map<string, string>()
  /** The ids of the panes asked to take the keyboard, in order. */
  const focused: string[] = []
  on('ui.open', (_$, e) => {
    if (e.focus) focused.push(e.id)
    open.add(e.id)
    titles.set(e.id, e.title ?? e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', (_$, e) => {
    open.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: [...open].map(id => ({ id, title: titles.get(id) ?? id, isShown: true, isFocused: false, isPlaced: true })),
  }))
  return Object.assign(open, { titles, focused })
}

/**
 * Records the status line and toasts. (`$.ui.scroll` and `$.ui.focus` cannot be observed here: the kit has no
 * layout to resolve an element against, so the pane's calls to them are swallowed as the cosmetic they are.)
 */
export function fakeScreen(on: On) {
  const events: string[] = []
  on('ui.status', (_$, e) => {
    events.push(`status:${e.text}`)
    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    events.push(`toast:${e.text}`)
    return { value: undefined }
  })
  return events
}

export const paneProps = (bodyColumns: number, requestTitle = 'Git Graph') => ({
  title: requestTitle,
  isFocused: false,
  bodyColumns,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
})

export const mountAt = ($: Engine, columns: number, requestId = PANE) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId, props: paneProps(columns), viewport: { columns, rows: 40 } })

export const logCalls = (calls: string[][]) => calls.filter(argv => argv.includes('log'))
