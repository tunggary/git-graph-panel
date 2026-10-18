// Branch / tag pills of a commit row. Pure: refs in, display labels out.

import type { GitGraphRef } from '../../types'
import { cellWidth } from './text'

export type Label = {
  kind: GitGraphRef['kind']
  /** Branch, tag or `origin/name` (a remote branch without a local one). */
  name: string
  /** Remotes holding the same branch as the local `name`, e.g. ['origin']. */
  remotes: string[]
  isCurrent: boolean
}

/** What the pill says: `develop │ origin` for a local branch that a remote also has. */
export const labelText = (label: Label): string => [label.name, ...label.remotes].join(' │ ')

const RANK = { head: 0, branch: 1, remote: 2, tag: 3 } as const

/**
 * Local branches absorb their remote twins (`origin/develop` next to `develop`); other remote
 * branches stay as `origin/xxx`. Checked-out branch / HEAD first, then branches, remotes, tags.
 */
export function mergeLabels(refs: readonly GitGraphRef[]): Label[] {
  const locals = new Map<string, Label>()
  for (const ref of refs) {
    if (ref.kind === 'branch') locals.set(ref.name, { kind: 'branch', name: ref.name, remotes: [], isCurrent: ref.isCurrent })
  }
  const labels: Label[] = [...locals.values()]
  for (const ref of refs) {
    if (ref.kind === 'branch') continue
    if (ref.kind === 'remote') {
      const slash = ref.name.indexOf('/')
      const twin = locals.get(ref.name.slice(slash + 1))
      if (slash > 0 && twin) {
        twin.remotes.push(ref.name.slice(0, slash))
        continue
      }
    }
    labels.push({ kind: ref.kind, name: ref.name, remotes: [], isCurrent: ref.isCurrent })
  }
  return labels.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || RANK[a.kind] - RANK[b.kind])
}

export type PillPart = { text: string; bg: string; fg: string }

/** Black or white, whichever reads better on `bg` (the luminance where both contrast equally is 0.179). */
export function contrastColor(bg: string): '#000000' | '#ffffff' {
  const [r, g, b] = [1, 3, 5].map(i => {
    const c = parseInt(bg.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? '#000000' : '#ffffff'
}

/** The color a little darker, for the remote half of a pill. */
export function darken(color: string, amount = 0.3): string {
  const channel = (i: number): string =>
    Math.round(parseInt(color.slice(i, i + 2), 16) * (1 - amount)).toString(16).padStart(2, '0')
  return `#${channel(1)}${channel(3)}${channel(5)}`
}

const HEAD_COLOR = '#8957e5'
const TAG_COLOR = '#9a6700'

/**
 * What a pill is made of: branches take the color of their commit's lane (a remote-only branch a darker
 * tone of it, and the `│ origin` half of a merged pill too), tags are amber, a detached HEAD purple.
 */
export function pillParts(label: Label, laneColor: string): PillPart[] {
  const part = (text: string, bg: string): PillPart => ({ text, bg, fg: contrastColor(bg) })
  if (label.kind === 'head') return [part(` ${label.name} `, HEAD_COLOR)]
  if (label.kind === 'tag') return [part(` ${label.name} `, TAG_COLOR)]
  if (label.kind === 'remote') return [part(` ${label.name} `, darken(laneColor))]
  const parts = [part(` ${label.name} `, laneColor)]
  if (label.remotes.length > 0) parts.push(part(`│ ${label.remotes.join(' │ ')} `, darken(laneColor)))
  return parts
}

/** The leading labels whose pills (and the space after each) fit in `width` cells, and the cells they take. */
export function fitLabels(labels: readonly Label[], width: number): { shown: Label[]; used: number } {
  const shown: Label[] = []
  let used = 0
  for (const label of labels) {
    const cells = pillParts(label, '#000000').reduce((sum, part) => sum + cellWidth(part.text), 0) + 1
    if (used + cells > width) break
    shown.push(label)
    used += cells
  }
  return { shown, used }
}
