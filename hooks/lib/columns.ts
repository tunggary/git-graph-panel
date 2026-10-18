// Which optional columns fit in the pane. Pure, so the hiding rules are unit-tested.

export const DATE_WIDTH = 11 // "10-18 16:25"
export const AUTHOR_WIDTH = 12
export const HASH_WIDTH = 7
/** The header `Graph` needs this many cells; a narrower graph is padded to it. */
export const GRAPH_MIN_WIDTH = 5
/** The graph may take up to this share of the pane's width before further lanes fold into `…`. */
export const GRAPH_SHARE = 0.4
/** Lanes drawn whatever the width, so a narrow pane still shows a usable graph. */
export const MIN_LANES = 8

/** How many lanes fit in GRAPH_SHARE of the pane (two cells per lane), never fewer than MIN_LANES. */
export const maxLanesFor = (bodyColumns: number): number => Math.max(MIN_LANES, Math.floor((bodyColumns * GRAPH_SHARE) / 2))

/** Cells between two neighbouring columns. */
export const GAP = 2
/** The message column is never squeezed below this before another column is hidden. */
export const MIN_MESSAGE_WIDTH = 24

export type Layout = {
  showDate: boolean
  showAuthor: boolean
  showHash: boolean
  /** Cells left for labels + message. */
  messageWidth: number
}

/**
 * Columns are graph | message | date | author | hash. When the message would be
 * narrower than MIN_MESSAGE_WIDTH the hash goes first, then the author, then the date.
 */
export function pickColumns(bodyColumns: number, graphWidth: number): Layout {
  const flags = { showDate: true, showAuthor: true, showHash: true }
  const hideOrder = ['showHash', 'showAuthor', 'showDate'] as const
  const messageWidth = (): number => {
    let used = graphWidth + GAP // graph, then the gap before the message
    if (flags.showDate) used += GAP + DATE_WIDTH
    if (flags.showAuthor) used += GAP + AUTHOR_WIDTH
    if (flags.showHash) used += GAP + HASH_WIDTH
    return bodyColumns - used
  }
  for (const key of hideOrder) {
    if (messageWidth() >= MIN_MESSAGE_WIDTH) break
    flags[key] = false
  }
  return { ...flags, messageWidth: Math.max(1, messageWidth()) }
}
