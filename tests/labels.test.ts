import { describe, expect, test } from 'claude-code/testing'

import { contrastColor, darken, fitLabels, labelText, mergeLabels, pillParts } from '../hooks/lib/labels'
import type { Label } from '../hooks/lib/labels'
import { PALETTE, laneColor } from '../hooks/lib/lanes'
import { parseRefs } from '../hooks/lib/parse'

const labels = (decoration: string) => mergeLabels(parseRefs(decoration)).map(labelText)

describe('mergeLabels', () => {
  test('a local branch and its remote twin become one label', () => {
    expect(labels('refs/heads/develop, refs/remotes/origin/develop')).toEqual(['develop │ origin'])
  })

  test('a remote branch without a local one keeps its remote prefix', () => {
    expect(labels('refs/remotes/origin/feature/x')).toEqual(['origin/feature/x'])
  })

  test('slashes in the branch name still match the twin', () => {
    expect(labels('refs/remotes/origin/feature/x, refs/heads/feature/x')).toEqual(['feature/x │ origin'])
  })

  test('several remotes are listed in turn; a twin on another branch name does not merge', () => {
    expect(labels('refs/heads/main, refs/remotes/origin/main, refs/remotes/upstream/main, refs/remotes/origin/dev')).toEqual([
      'main │ origin │ upstream',
      'origin/dev',
    ])
  })

  test('the checked-out branch first, then branches, remote-only branches and tags', () => {
    expect(
      labels('tag: refs/tags/v1, refs/remotes/origin/z, refs/heads/b, HEAD -> refs/heads/a, refs/remotes/origin/a').join(' ; '),
    ).toBe('a │ origin ; b ; origin/z ; v1')
  })

  test('a detached HEAD is a label of its own and comes first', () => {
    const merged = mergeLabels(parseRefs('HEAD, refs/heads/main'))
    expect(merged.map(label => label.kind)).toEqual(['head', 'branch'])
    expect(merged[0]?.isCurrent).toBe(true)
  })

  test('no refs, no labels', () => {
    expect(labels('')).toEqual([])
  })
})

describe('pill colors', () => {
  const first = (decoration: string) => mergeLabels(parseRefs(decoration))[0]!

  test('text is black on light fills and white on dark ones', () => {
    expect(contrastColor('#ffffff')).toBe('#000000')
    expect(contrastColor('#00d90a')).toBe('#000000') // green
    expect(contrastColor('#d98500')).toBe('#000000') // orange
    expect(contrastColor('#0000ff')).toBe('#ffffff')
    expect(contrastColor('#a300d9')).toBe('#ffffff')
    expect(contrastColor('#1e1e1e')).toBe('#ffffff')
  })

  test('darken scales every channel', () => {
    expect(darken('#ff8000', 0.5)).toBe('#804000')
    expect(darken('#000000')).toBe('#000000')
  })

  test('a branch takes the lane color; its remote half is a darker tone of it', () => {
    const lane = PALETTE[3]!
    const parts = pillParts(first('refs/heads/develop, refs/remotes/origin/develop'), lane)
    expect(parts.map(part => part.text)).toEqual([' develop ', '│ origin '])
    expect(parts[0]).toEqual({ text: ' develop ', bg: lane, fg: contrastColor(lane) })
    expect(parts[1]?.bg).toBe(darken(lane))
    expect(parts[1]?.bg).not.toBe(lane)
    expect(parts.map(part => part.text).join('')).toBe(` ${labelText(first('refs/heads/develop, refs/remotes/origin/develop'))} `)
  })

  test('a remote-only branch is the darker tone; tags and a detached HEAD keep their own colors', () => {
    const lane = laneColor(1)
    expect(pillParts(first('refs/remotes/origin/x'), lane)).toEqual([{ text: ' origin/x ', bg: darken(lane), fg: contrastColor(darken(lane)) }])
    expect(pillParts(first('tag: refs/tags/v1'), lane)[0]?.bg).toBe('#9a6700')
    expect(pillParts(first('HEAD'), lane)[0]?.bg).toBe('#8957e5')
  })
})

describe('fitLabels', () => {
  const label = (name: string): Label => ({ kind: 'branch', name, remotes: [], isCurrent: false })

  test('keeps the leading pills that fit, each with the space after it', () => {
    const labels = [label('main'), label('develop'), label('feature/x')]
    expect(fitLabels(labels, 100)).toEqual({ shown: labels, used: 7 + 10 + 12 })
    expect(fitLabels(labels, 17)).toEqual({ shown: [labels[0], labels[1]], used: 17 })
    expect(fitLabels(labels, 16).shown).toEqual([labels[0]])
    expect(fitLabels(labels, 3)).toEqual({ shown: [], used: 0 })
  })
})
