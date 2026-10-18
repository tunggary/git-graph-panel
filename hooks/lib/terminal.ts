// Decides whether the terminal can draw the picture graph. Pure: the environment goes in.

export type TerminalEnv = {
  TMUX?: string
  TERM_PROGRAM?: string
  KITTY_WINDOW_ID?: string
}

/** `TERM_PROGRAM` values (lower case) of terminals that draw `Image`. */
const IMAGE_PROGRAMS = ['ghostty', 'kitty', 'wezterm']

/** tmux swallows the image protocol, so inside it the text graph is used whatever the terminal is. */
export function supportsImages(env: TerminalEnv): boolean {
  if (env.TMUX) return false
  if (env.KITTY_WINDOW_ID) return true
  return IMAGE_PROGRAMS.includes((env.TERM_PROGRAM ?? '').toLowerCase())
}
