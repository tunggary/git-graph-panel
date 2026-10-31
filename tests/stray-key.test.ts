import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, PromptBox, PromptEditInput } from 'claude-code'

import { PANE, PLUGIN, RUN, fakeGit, fakePanes, fakeScreen, paneProps } from './helpers'

/** The editor beneath the plugins: the splice applied, the caret after it. */
function fakeComposer(on: On) {
  on('prompt.edit', (_$, e) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    return { text, cursor: e.start + e.inputText.length }
  })
}

const mountFocused = ($: Engine, isFocused: boolean) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: { ...paneProps(120), isFocused }, viewport: { columns: 120, rows: 40 } })

// The kit raises `prompt.edit` on `$`, but its typing of the prompt noun leaves the event out.
type Edit = (input: PromptEditInput) => Promise<PromptBox | undefined>
const typeKey = ($: Engine, char: string, text = '', modifiers: { ctrl?: true } = {}) =>
  ($.prompt as unknown as { edit: Edit }).edit({ origin: { kind: 'composer' }, key: { key: char, ...modifiers }, text, cursor: text.length, start: text.length, end: text.length, inputText: char })

describe('a key the pane does not answer', () => {
  test('typed while the pane held the keys: dropped, and the pane takes the keys back', async ($, on) => {
    fakeGit(on)
    fakeComposer(on)
    const screen = fakeScreen(on)
    const panes = fakePanes(on)
    await $.command.run(RUN)
    await mountFocused($, true)

    const box = await typeKey($, 'z')
    expect(box?.text).toBe('')
    expect(panes.focused).toContain(PANE)
    expect(screen.some(line => line.startsWith('toast:"z" is not a Git Graph key'))).toBe(true)
  })

  test('arriving just after the render that saw the pane let go: still dropped', async ($, on) => {
    fakeGit(on)
    fakeComposer(on)
    const screen = fakeScreen(on)
    const panes = fakePanes(on)
    await $.command.run(RUN)
    await (await mountFocused($, true)).unmount()
    await mountFocused($, false)

    const box = await typeKey($, 'z')
    expect(box?.text).toBe('')
    expect(panes.focused).toContain(PANE)
  })

  test('a Hangul letter (the Korean input source on) is taken back too, with a hint to switch', async ($, on) => {
    fakeGit(on)
    fakeComposer(on)
    const screen = fakeScreen(on)
    const panes = fakePanes(on)
    await $.command.run(RUN)
    await mountFocused($, true)

    expect((await typeKey($, 'ㅓ'))?.text).toBe('')
    expect(panes.focused).toContain(PANE)
    expect(screen.some(line => line.includes('한/영'))).toBe(true)
  })

  test('only the first key is taken: the next one types', async ($, on) => {
    fakeGit(on)
    fakeComposer(on)
    const screen = fakeScreen(on)
    fakePanes(on)
    await $.command.run(RUN)
    await mountFocused($, true)

    await typeKey($, 'z')
    expect((await typeKey($, 'z'))?.text).toBe('z')
  })

  test('the pane never held the keys: the prompt gets it', async ($, on) => {
    fakeGit(on)
    fakeComposer(on)
    const screen = fakeScreen(on)
    const panes = fakePanes(on)
    await $.command.run(RUN)
    await mountFocused($, false)

    expect((await typeKey($, 'z'))?.text).toBe('z')
    expect(panes.focused).not.toContain(PANE)
  })

  test('a chord or a draft with text: left alone', async ($, on) => {
    fakeGit(on)
    fakeComposer(on)
    const screen = fakeScreen(on)
    fakePanes(on)
    await $.command.run(RUN)
    await mountFocused($, true)

    expect((await typeKey($, 'z', 'ab'))?.text).toBe('abz')
    expect((await typeKey($, 'z', '', { ctrl: true }))?.text).toBe('z')
  })
})
