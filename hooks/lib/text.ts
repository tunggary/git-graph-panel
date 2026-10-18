// Terminal cell widths of strings, for cutting text to a column. Pure.

/** Hangul, CJK, full-width forms and emoji take two cells; combining marks and joiners none. */
export function charWidth(code: number): number {
  if (code === 0x200d || (code >= 0x0300 && code <= 0x036f) || (code >= 0xfe00 && code <= 0xfe0f)) return 0
  const isWide =
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f64f) ||
    (code >= 0x1f900 && code <= 0x1f9ff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  return isWide ? 2 : 1
}

export const cellWidth = (text: string): number => {
  let width = 0
  for (const ch of text) width += charWidth(ch.codePointAt(0) ?? 0)
  return width
}

/** `text` cut to `width` cells, ending in `…` when something was cut. */
export function truncate(text: string, width: number): string {
  if (width <= 0) return ''
  if (cellWidth(text) <= width) return text
  let out = ''
  let used = 0
  for (const ch of text) {
    const w = charWidth(ch.codePointAt(0) ?? 0)
    if (used + w > width - 1) break
    out += ch
    used += w
  }
  return `${out}…`
}

/** Like `truncate`, but keeps the end: a path loses its leading directories. */
export function truncateStart(text: string, width: number): string {
  if (width <= 0) return ''
  if (cellWidth(text) <= width) return text
  const chars = [...text]
  let out = ''
  let used = 0
  for (let i = chars.length - 1; i >= 0; i--) {
    const ch = chars[i] ?? ''
    const w = charWidth(ch.codePointAt(0) ?? 0)
    if (used + w > width - 1) break
    out = ch + out
    used += w
  }
  return `…${out}`
}

/** `text` split into lines of at most `width` cells; an empty text is one empty line. */
export function wrap(text: string, width: number): string[] {
  const limit = Math.max(1, width)
  const lines: string[] = []
  let line = ''
  let used = 0
  for (const ch of text) {
    const w = charWidth(ch.codePointAt(0) ?? 0)
    if (used + w > limit) {
      lines.push(line)
      line = ''
      used = 0
    }
    line += ch
    used += w
  }
  lines.push(line)
  return lines
}

/** Items laid out left to right in rows of at most `columns` cells, `gap` apart; an item wider than a row has one to itself. */
export function packRows<T extends { width: number }>(items: readonly T[], columns: number, gap = 2): T[][] {
  const rows: T[][] = [[]]
  let used = 0
  for (const item of items) {
    const row = rows[rows.length - 1]!
    if (row.length > 0 && used + gap + item.width > columns) {
      rows.push([item])
      used = item.width
    } else {
      used += (row.length > 0 ? gap : 0) + item.width
      row.push(item)
    }
  }
  return rows
}
