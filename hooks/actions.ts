// What the buttons and keys do. Each takes `$` and reads the state it needs fresh, so a key and a click share one path.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { GitGraphFile } from '../types'
import { EMPTY_TREE, UNCOMMITTED, fetchAll, loadChangedFiles, loadCommitDetails, loadFileDiff, loadSnapshot } from './lib/git'
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

/** A click on a row: the cursor goes there and its details toggle. */
export async function selectRow($: Dollar, hash: string): Promise<void> {
  await update($, cursor, () => hash)
  await toggleDetails($, hash)
}

/** `o`: toggles the details of the row the cursor is on. */
export async function toggleAtCursor($: Dollar): Promise<void> {
  const at = await read($, cursor)
  if (at !== null) await toggleDetails($, at)
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

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))
