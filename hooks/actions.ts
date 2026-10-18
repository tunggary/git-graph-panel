// What the buttons and keys do. Each takes `$` and reads the state it needs fresh, so a key and a click share one path.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { GitGraphFile } from '../types'
import { EMPTY_TREE, UNCOMMITTED, fetchAll, loadChangedFiles, loadCommitDetails, loadFileDiff, loadSnapshot } from './lib/git'
import { checkRefArgv, displayCommand, factsOf, nameError, planFor, rowMenu } from './lib/commands'
import type { MenuItem, Operation, Plan, Prompt } from './lib/commands'
import { prepareDiff } from './lib/diff'
import { findMatches, stepMatch } from './lib/search'
import { PAGE_SIZE, PANE } from './state'

type Dollar = EngineInterface

// The state reference scan reads atoms only where `read` and `update` are called, so each file that uses them declares them.
const snapshot = atom({ plugin: 'git-graph-panel', key: 'snapshot' } as const, { kind: 'loading' })
const isRemotesShown = atom({ plugin: 'git-graph-panel', key: 'isRemotesShown' } as const, true)
const limit = atom({ plugin: 'git-graph-panel', key: 'limit' } as const, PAGE_SIZE)
const isChangesOpen = atom({ plugin: 'git-graph-panel', key: 'isChangesOpen' } as const, false)
const graphStyle = atom({ plugin: 'git-graph-panel', key: 'graphStyle' } as const, null)
const cursor = atom({ plugin: 'git-graph-panel', key: 'cursor' } as const, null)
const details = atom({ plugin: 'git-graph-panel', key: 'details' } as const, null)
const comparison = atom({ plugin: 'git-graph-panel', key: 'comparison' } as const, null)
const branchFilter = atom({ plugin: 'git-graph-panel', key: 'branchFilter' } as const, null)
const search = atom({ plugin: 'git-graph-panel', key: 'search' } as const, { isOpen: false, query: '' })
const isFetching = atom({ plugin: 'git-graph-panel', key: 'isFetching' } as const, false)
const diff = atom({ plugin: 'git-graph-panel', key: 'diff' } as const, { kind: 'idle' })
const actionMenu = atom({ plugin: 'git-graph-panel', key: 'actionMenu' } as const, null)

/** The element key of a graph row, which `$.ui.scroll` addresses. */
export const rowKey = (hash: string): string => (hash === UNCOMMITTED ? 'uncommitted' : `commit:${hash}`)

/** `abc1234`, `working tree` or `empty tree`: how a point of a comparison or diff reads. */
export const pointLabel = (rev: string): string =>
  rev === UNCOMMITTED ? 'working tree' : rev === EMPTY_TREE ? 'empty tree' : rev.slice(0, 7)

export async function refresh($: Dollar): Promise<void> {
  const requested = await read($, branchFilter)
  const next = await loadSnapshot($, { limit: await read($, limit), isRemotesShown: await read($, isRemotesShown), branchFilter: requested })
  await update($, snapshot, () => next)
  if (next.kind !== 'ready') return
  if (next.filter !== requested) await update($, branchFilter, () => next.filter)
  // The working tree moves under a comparison against it.
  const compare = await read($, comparison)
  if (compare?.to === UNCOMMITTED) await loadComparison($, compare.from, compare.to, true)
  await reloadDiff($)
}

/** The rows top to bottom: the uncommitted row, when there is one, then the commits. */
async function rowOrder($: Dollar): Promise<string[]> {
  const snap = await read($, snapshot)
  if (snap.kind !== 'ready') return []
  return [...(snap.changes.length > 0 ? [UNCOMMITTED] : []), ...snap.commits.map(commit => commit.hash)]
}

/** Scrolls an element of the pane into view. Cosmetic: a pane that cannot scroll (not drawn yet) is left alone. */
async function reveal($: Dollar, key: string): Promise<void> {
  try {
    await $.ui.scroll({ to: { key }, in: PANE })
  } catch {
    // The state is already updated; the row just stays where it is.
  }
}

/** Puts the cursor on a row and scrolls to it. */
async function moveTo($: Dollar, hash: string): Promise<void> {
  await update($, cursor, () => hash)
  await update($, actionMenu, () => null)
  await reveal($, rowKey(hash))
}

export async function moveCursor($: Dollar, step: 1 | -1): Promise<void> {
  const order = await rowOrder($)
  if (order.length === 0) return
  const at = order.indexOf((await read($, cursor)) ?? '')
  const next = at < 0 ? 0 : Math.min(order.length - 1, Math.max(0, at + step))
  await moveTo($, order[next] ?? UNCOMMITTED)
}

/** Opens the commit's details under its row, or closes them when they are open. The uncommitted row unfolds its files. */
export async function toggleDetails($: Dollar, hash: string): Promise<void> {
  if (hash === UNCOMMITTED) {
    await update($, isChangesOpen, open => !open)
    return
  }
  const open = await read($, details)
  await update($, comparison, () => null)
  if (open?.hash === hash) {
    await update($, details, () => null)
    return
  }
  await update($, details, () => ({ kind: 'loading' as const, hash }))
  const isCurrent = async () => (await read($, details))?.hash === hash
  try {
    const loaded = await loadCommitDetails($, hash)
    if (!(await isCurrent())) return
    await update($, details, () => ({ kind: 'ready' as const, hash, ...loaded }))
    await reveal($, `details:${hash}`)
  } catch (error) {
    if (await isCurrent()) await update($, details, () => ({ kind: 'error' as const, hash, message: errorText(error) }))
  }
}

/**
 * Runs slow work (git over the network, a question the person answers) after the handler that started it has
 * returned. A press or an Enter handler that is still running after 10 s is cut off by the engine ("ran past its
 * budget"), so those handlers only start the work; the test kit still waits for it to settle.
 */
export function detach($: Dollar, work: () => Promise<unknown>): void {
  void work().catch(error => $.ui.toast(`git failed: ${errorText(error)}`))
}

/** A click on a row: the cursor goes there and its details toggle. */
export async function selectRow($: Dollar, hash: string): Promise<void> {
  await update($, cursor, () => hash)
  await update($, actionMenu, () => null)
  detach($, () => toggleDetails($, hash))
}

/** `o`: toggles the details of the row the cursor is on. */
export async function toggleAtCursor($: Dollar): Promise<void> {
  const at = await read($, cursor)
  if (at !== null) detach($, () => toggleDetails($, at))
}

export async function loadComparison($: Dollar, from: string, to: string, isQuiet = false): Promise<void> {
  if (!isQuiet) await update($, comparison, () => ({ kind: 'loading' as const, from, to }))
  const isCurrent = async () => {
    const now = await read($, comparison)
    return now?.from === from && now.to === to
  }
  try {
    const files = await loadChangedFiles($, from, to)
    if (await isCurrent()) await update($, comparison, () => ({ kind: 'ready' as const, from, to, files }))
  } catch (error) {
    if (await isCurrent()) await update($, comparison, () => ({ kind: 'error' as const, from, to, message: errorText(error) }))
  }
}

/** `x`: with details open, compares the opened commit with the one under the cursor (older first); on the opened commit itself it goes back. */
export async function compareAtCursor($: Dollar): Promise<void> {
  const open = await read($, details)
  const at = await read($, cursor)
  if (open === null || at === null) return
  if (at === open.hash) {
    await update($, comparison, () => null)
    return
  }
  const order = await rowOrder($)
  const [older, newer] = order.indexOf(open.hash) > order.indexOf(at) ? [open.hash, at] : [at, open.hash]
  await loadComparison($, older, newer)
}

/** The body of the diff screen for one file. */
async function readDiffBody($: Dollar, from: string, to: string, file: GitGraphFile) {
  const binary = { kind: 'notice' as const, text: 'Binary file: there is no text diff to show.' }
  if (file.added === null) return binary
  try {
    const prepared = prepareDiff(await loadFileDiff($, from, to, file))
    if (prepared.kind === 'diff') return { kind: 'ready' as const, source: prepared.source, hiddenLines: prepared.hiddenLines }
    if (prepared.kind === 'binary') return binary
    const text = file.status === 'R' ? 'Renamed without changes to the content.' : 'No changes to the content (a mode change or an empty file).'
    return { kind: 'notice' as const, text }
  } catch (error) {
    return { kind: 'error' as const, message: errorText(error) }
  }
}

/** Replaces the graph with the diff of `files[index]` between two points, scrolled to the top. */
export async function showDiff($: Dollar, from: string, to: string, files: GitGraphFile[], index: number, range: string): Promise<void> {
  const file = files[index]
  if (file === undefined) return
  await update($, diff, () => ({ kind: 'open' as const, from, to, files, index, range, body: { kind: 'loading' as const } }))
  try {
    await $.ui.scroll({ to: 'start', in: PANE })
  } catch {
    // Cosmetic, as in `reveal`.
  }
  const body = await readDiffBody($, from, to, file)
  const now = await read($, diff)
  if (now.kind === 'open' && now.from === from && now.to === to && now.index === index) {
    await update($, diff, view => (view.kind === 'open' ? { ...view, body } : view))
  }
}

/** n / p: the next or previous file of the same list; it stops at the ends. */
export async function stepDiff($: Dollar, step: 1 | -1): Promise<void> {
  const view = await read($, diff)
  if (view.kind === 'open') await gotoDiff($, view.index + step)
}

/** The digits: the file at `index` of the same list. */
export async function gotoDiff($: Dollar, index: number): Promise<void> {
  const view = await read($, diff)
  if (view.kind !== 'open' || index === view.index || index < 0 || index >= view.files.length) return
  await showDiff($, view.from, view.to, view.files, index, view.range)
}

/** h: back to the graph, with the cursor, details, comparison and search as they were. */
export async function closeDiff($: Dollar): Promise<void> {
  await update($, diff, () => ({ kind: 'idle' as const }))
  const at = await read($, cursor)
  if (at !== null) await reveal($, rowKey(at))
}

/** After a refresh: re-reads the open diff in place, or goes back to the graph when its file left the range. */
async function reloadDiff($: Dollar): Promise<void> {
  const view = await read($, diff)
  if (view.kind !== 'open') return
  const shown = view.files[view.index]
  try {
    const files = await loadChangedFiles($, view.from, view.to)
    const index = files.findIndex(file => file.path === shown?.path)
    const file = files[index]
    if (file === undefined) {
      await update($, diff, () => ({ kind: 'idle' as const }))
      return
    }
    const body = await readDiffBody($, view.from, view.to, file)
    await update($, diff, now => (now.kind === 'open' ? { ...now, files, index, body } : now))
  } catch {
    // git failed this time; the diff on screen stays.
  }
}

/** Restricts the log to one branch (a full ref), or to all with null. */
export async function setBranchFilter($: Dollar, ref: string | null): Promise<void> {
  await update($, branchFilter, () => ref)
  await update($, details, () => null)
  await update($, comparison, () => null)
  await refresh($)
}

export async function toggleRemotes($: Dollar): Promise<void> {
  const shown = !(await read($, isRemotesShown))
  await update($, isRemotesShown, () => shown)
  // A remote branch cannot stay selected once the remotes are hidden.
  if ((await read($, branchFilter))?.startsWith('refs/remotes/') && !shown) {
    await update($, branchFilter, () => null)
    await update($, details, () => null)
    await update($, comparison, () => null)
  }
  await refresh($)
}

export async function openFind($: Dollar): Promise<void> {
  await update($, search, state => ({ ...state, isOpen: true }))
  try {
    await $.ui.focus({ requestId: PANE, key: 'find-input' })
  } catch {
    // The field is drawn; the person can still Tab to it.
  }
}

export function setQuery($: Dollar, query: string) {
  return update($, search, state => ({ ...state, query }))
}

export function clearFind($: Dollar) {
  return update($, search, () => ({ isOpen: false, query: '' }))
}

async function matchesNow($: Dollar): Promise<string[]> {
  const snap = await read($, snapshot)
  return snap.kind === 'ready' ? findMatches(snap.commits, (await read($, search)).query) : []
}

/** Enter in the Find field: hides the field, keeps the highlight, and lands the cursor on a match. */
export async function submitFind($: Dollar): Promise<void> {
  await update($, search, state => ({ ...state, isOpen: false }))
  const matches = await matchesNow($)
  const at = await read($, cursor)
  if (at !== null && matches.includes(at)) return
  const next = stepMatch(await rowOrder($), matches, at, 1)
  if (next !== null) await moveTo($, next)
}

/** `n` / `p`: the cursor to the next or previous match, wrapping. */
export async function stepFind($: Dollar, step: 1 | -1): Promise<void> {
  const next = stepMatch(await rowOrder($), await matchesNow($), await read($, cursor), step)
  if (next !== null) await moveTo($, next)
}

/** `git fetch --all --prune` with a status line while it runs, a toast when it ends and a refresh after. */
export async function fetchRemotes($: Dollar): Promise<void> {
  if (await read($, isFetching)) return
  await update($, isFetching, () => true)
  $.ui.status('Fetching…')
  detach($, () => runFetch($))
}

async function runFetch($: Dollar): Promise<void> {
  let text: string
  try {
    const result = await fetchAll($)
    text = result.ok ? 'Fetched all remotes' : `Fetch failed: ${result.message}`
  } catch (error) {
    text = `Fetch failed: ${errorText(error)}`
  } finally {
    $.ui.status(undefined)
    await update($, isFetching, () => false)
  }
  $.ui.toast(text)
  await refresh($)
}

// --- Write actions: the list under a row (`a`), its text fields, and running what was chosen ---

/** A merge, rebase, cherry-pick or revert that stopped: git leaves a marker in its directory. */
async function readOperation($: Dollar): Promise<Operation | null> {
  try {
    const dir = await $.process.run(['git', 'rev-parse', '--absolute-git-dir'])
    if (dir.exitCode !== 0) return null
    const base = dir.stdout.trim()
    const markers: Array<[string, Operation]> = [['MERGE_HEAD', 'merge'], ['rebase-merge', 'rebase'], ['rebase-apply', 'rebase'], ['CHERRY_PICK_HEAD', 'cherry-pick'], ['REVERT_HEAD', 'revert']]
    for (const [name, operation] of markers) if (await $.fs.exists(`${base}/${name}`)) return operation
  } catch {
    // Not knowing means no Abort item, nothing more.
  }
  return null
}

/** `a`: opens the action list under the cursor's row (the top row when there is no cursor), or closes it. */
export async function toggleActions($: Dollar): Promise<void> {
  const snap = await read($, snapshot)
  const order = await rowOrder($)
  const at = await read($, cursor)
  const hash = at !== null && order.includes(at) ? at : order[0]
  if (snap.kind !== 'ready' || hash === undefined) return
  if ((await read($, actionMenu))?.hash === hash) {
    await update($, actionMenu, () => null)
    return
  }
  const operation = hash === UNCOMMITTED ? await readOperation($) : null
  await update($, cursor, () => hash)
  await update($, actionMenu, () => ({ hash, operation, index: 0, form: null }))
  await reveal($, `actions:${hash}`)
}

/** The items of the open list, top to bottom, sections flattened. */
function itemsOfMenu(snap: Parameters<typeof rowMenu>[0], menu: { hash: string; operation: Operation | null }, protectedBranches: readonly string[]): MenuItem[] {
  return rowMenu(snap, menu.hash, menu.operation, protectedBranches, true).flatMap(section => section.items)
}

/** `j` / `k` while the list is open: the highlight moves, stopping at the ends. */
export async function moveMenuCursor($: Dollar, step: 1 | -1): Promise<void> {
  const snap = await read($, snapshot)
  const menu = await read($, actionMenu)
  if (snap.kind !== 'ready' || menu === null || menu.form !== null) return
  const items = itemsOfMenu(snap, menu, [])
  const index = Math.min(items.length - 1, Math.max(0, menu.index + step))
  await update($, actionMenu, now => (now === null ? now : { ...now, index }))
  const item = items[index]
  if (item) await reveal($, `action:${item.key}`)
}

/** `o` while the list is open: runs the highlighted item. */
export async function runMenuCursor($: Dollar, protectedBranches: readonly string[]): Promise<void> {
  const snap = await read($, snapshot)
  const menu = await read($, actionMenu)
  if (snap.kind !== 'ready' || menu === null || menu.form !== null) return
  const item = itemsOfMenu(snap, menu, protectedBranches)[menu.index]
  if (item) await chooseAction($, item.key, protectedBranches)
}

async function focusSafely($: Dollar, key: string): Promise<void> {
  try {
    await $.ui.focus({ requestId: PANE, key })
  } catch {
    // The element is drawn; the person can still Tab to it.
  }
}

/** The open list's item for a key, with the snapshot it was drawn from. */
async function findItem($: Dollar, key: string, protectedBranches: readonly string[]) {
  const snap = await read($, snapshot)
  const menu = await read($, actionMenu)
  if (snap.kind !== 'ready' || menu === null) return null
  const item = rowMenu(snap, menu.hash, menu.operation, protectedBranches, true).flatMap(section => section.items).find(one => one.key === key)
  return item === undefined ? null : { snap, menu, item }
}

/** A press on an item: runs it, or asks for the name or message it needs first. */
export async function chooseAction($: Dollar, key: string, protectedBranches: readonly string[]): Promise<void> {
  const found = await findItem($, key, protectedBranches)
  if (found === null) return
  const { prompt } = found.item
  if (prompt === undefined) {
    detach($, () => perform($, found.item, '', protectedBranches))
    return
  }
  await update($, actionMenu, menu => (menu === null ? menu : { ...menu, form: { key, value: prompt.initial ?? '' } }))
  await focusSafely($, 'action-input')
}

export function setActionInput($: Dollar, value: string) {
  return update($, actionMenu, menu => (menu?.form ? { ...menu, form: { key: menu.form.key, value } } : menu))
}

/** Back from a text field to the list. */
export function cancelActionForm($: Dollar) {
  return update($, actionMenu, menu => (menu === null ? menu : { ...menu, form: null }))
}

/** Enter in the text field: checks the text, then runs the item. */
export async function submitActionForm($: Dollar, value: string, protectedBranches: readonly string[]): Promise<void> {
  const menu = await read($, actionMenu)
  if (menu?.form == null) return
  const found = await findItem($, menu.form.key, protectedBranches)
  const prompt = found?.item.prompt
  if (found === null || prompt === undefined) return
  // While the field has the keys no hotkey reaches the pane, so an empty Enter is the keyboard's way back.
  if (prompt.kind !== 'text' && value.trim() === '') {
    await cancelActionForm($)
    return
  }
  const error = await promptError($, prompt, value.trim())
  if (error !== null) {
    await update($, actionMenu, now => (now?.form ? { ...now, form: { key: now.form.key, value, error } } : now))
    return
  }
  detach($, () => perform($, found.item, value, protectedBranches))
}

async function promptError($: Dollar, prompt: Prompt, text: string): Promise<string | null> {
  if (prompt.kind === 'text') return null
  const quick = nameError(text)
  if (quick !== null) return quick
  try {
    const check = await $.process.run(['git', ...checkRefArgv(prompt.kind, text)])
    return check.exitCode === 0 ? null : `"${text}" is not a valid ${prompt.kind} name`
  } catch (error) {
    return errorText(error)
  }
}

/** Fills in what only git knows about the target (its upstream, whether it is merged). */
async function factsFor($: Dollar, snap: Parameters<typeof factsOf>[0], menu: { operation: Operation | null }, item: MenuItem, protectedBranches: readonly string[]) {
  const facts = factsOf(snap, menu.operation, protectedBranches)
  if (item.target.kind !== 'branch') return facts
  const ref = `refs/heads/${item.target.name}`
  try {
    if (item.id === 'push' || item.id === 'push-force') {
      const up = await $.process.run(['git', 'for-each-ref', '--format=%(upstream:short)', ref])
      facts.upstream = up.exitCode === 0 && up.stdout.trim() !== '' ? up.stdout.trim() : null
    }
    if (item.id === 'delete') facts.isMerged = (await $.process.run(['git', 'merge-base', '--is-ancestor', ref, 'HEAD'])).exitCode === 0
  } catch {
    // Unknown: a push goes to a new origin branch, a delete is treated as unmerged (the more careful reading).
  }
  return facts
}

/** Plans the item, asks for the go-ahead, runs it, reports, refreshes and closes the list. */
async function perform($: Dollar, item: MenuItem, input: string, protectedBranches: readonly string[]): Promise<void> {
  const snap = await read($, snapshot)
  const menu = await read($, actionMenu)
  if (snap.kind !== 'ready' || menu === null) return
  const plan = planFor(item.target, item.id, input, await factsFor($, snap, menu, item, protectedBranches))

  if (plan.kind === 'blocked') {
    $.ui.toast(plan.reason)
    await update($, actionMenu, () => null)
    return
  }
  if (plan.kind === 'copy') {
    await copyText($, plan.label, plan.text)
    await update($, actionMenu, () => null)
    return
  }
  if (!(await confirmRun($, plan))) {
    await cancelActionForm($) // back to the list: another item may be the one wanted
    return
  }
  await runPlan($, plan)
  await update($, actionMenu, () => null)
  await refresh($)
}

/** Every write goes through this question; a risky one opens with the warning and has Cancel first. */
async function confirmRun($: Dollar, plan: Extract<Plan, { kind: 'run' }>): Promise<boolean> {
  const commands = plan.commands.map(displayCommand).join('\n')
  const question = plan.danger === undefined ? `Run this?\n${commands}` : `⚠ ${plan.danger}\nRun this?\n${commands}`
  try {
    const answer = await $.ui.ask(question, { options: plan.danger === undefined ? ['Run', 'Cancel'] : ['Cancel', 'Run'], header: plan.danger === undefined ? 'Git' : '⚠ Dangerous' })
    return answer === 'Run'
  } catch {
    return false // dismissed
  } finally {
    await takeFocusBack($)
  }
}

/** The dialog hands the keys to the prompt when it closes; the pane asks for them back (refused while text is being typed). */
async function takeFocusBack($: Dollar): Promise<void> {
  try {
    await $.ui.open({ id: PANE, title: 'Git Graph', focus: true })
  } catch {
    // The pane stays as it is; ctrl+x tab focuses it.
  }
}

/** Runs the commands in order with a status line; the first failure ends it with a toast. */
async function runPlan($: Dollar, plan: Extract<Plan, { kind: 'run' }>): Promise<void> {
  try {
    for (const argv of plan.commands) {
      $.ui.status(`Running ${displayCommand(argv)}…`)
      const result = await $.process.run(['git', ...argv], {
        env: { GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' },
        timeoutMs: plan.network ? 120_000 : 30_000,
      })
      if (result.exitCode === 0) continue
      const output = `${result.stderr}\n${result.stdout}`
      if (plan.mayConflict && /CONFLICT|could not apply|conflict/i.test(output)) {
        $.ui.toast('conflict: resolve then continue (Actions on Uncommitted Changes can abort)')
      } else {
        const first = output.split('\n').find(line => line.trim() !== '')
        $.ui.toast(`git failed: ${first?.trim() ?? `${displayCommand(argv)} exited with ${result.exitCode}`}`)
      }
      return
    }
    $.ui.toast(plan.label)
  } catch (error) {
    $.ui.toast(`git failed: ${errorText(error)}`)
  } finally {
    $.ui.status(undefined)
  }
}

/** To the clipboard through the host; if that does not take, the value is shown so it can be copied by hand. */
async function copyText($: Dollar, label: string, text: string): Promise<void> {
  try {
    if ((await $.ui.copy({ text })).isCopied) {
      $.ui.toast(`Copied ${label}`)
      return
    }
  } catch {
    // Handled below, as for a refusal.
  }
  $.ui.toast(`Could not copy; the ${label} is ${text}`)
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))
