import { describe, expect, test } from 'claude-code/testing'

import { supportsImages } from '../hooks/lib/terminal'

describe('supportsImages', () => {
  test('ghostty, kitty and WezTerm draw pictures', () => {
    expect(supportsImages({ TERM_PROGRAM: 'ghostty' })).toBe(true)
    expect(supportsImages({ TERM_PROGRAM: 'WezTerm' })).toBe(true)
    expect(supportsImages({ TERM_PROGRAM: 'kitty' })).toBe(true)
    expect(supportsImages({ KITTY_WINDOW_ID: '3' })).toBe(true)
  })

  test('tmux does not, whatever the terminal around it', () => {
    expect(supportsImages({ TERM_PROGRAM: 'ghostty', TMUX: '/tmp/tmux-501/default,123,0' })).toBe(false)
    expect(supportsImages({ KITTY_WINDOW_ID: '3', TMUX: '/tmp/tmux-501/default,123,0' })).toBe(false)
  })

  test('other and unknown terminals get the text graph', () => {
    expect(supportsImages({ TERM_PROGRAM: 'Apple_Terminal' })).toBe(false)
    expect(supportsImages({ TERM_PROGRAM: 'iTerm.app' })).toBe(false)
    expect(supportsImages({})).toBe(false)
  })
})
