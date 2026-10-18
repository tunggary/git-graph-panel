// Prepares `git diff` output for a `Code format="diff"` element. Pure.
//
// The engine draws 100000 characters of a Code in all and cannot parse a diff cut mid-hunk, so a long diff is
// cut here, on a line, and the last hunk's header is rewritten to count the lines kept.

/** Under the engine's 100000 characters, leaving room for the header lines it may add. */
export const MAX_DIFF_CHARS = 90_000
export const MAX_DIFF_LINES = 2_500

export type PreparedDiff =
  | { kind: 'binary' }
  | { kind: 'empty' }
  | { kind: 'diff'; source: string; hiddenLines: number }

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/

/** The hunk with only its first `keep` body lines, its header counting those. */
function cutHunk(hunk: string[], keep: number): string[] {
  const [header = '', ...body] = hunk
  const kept = body.slice(0, keep)
  const match = HUNK.exec(header)
  if (!match) return [header, ...kept]
  let oldCount = 0
  let newCount = 0
  for (const line of kept) {
    if (line.startsWith('\\')) continue
    if (!line.startsWith('+')) oldCount++
    if (!line.startsWith('-')) newCount++
  }
  return [`@@ -${match[1]},${oldCount} +${match[2]},${newCount} @@${match[3]}`, ...kept]
}

export function prepareDiff(raw: string, { maxChars = MAX_DIFF_CHARS, maxLines = MAX_DIFF_LINES } = {}): PreparedDiff {
  const lines = raw.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  const first = lines.findIndex(line => line.startsWith('@@ '))
  if (first < 0) {
    return /^Binary files .* differ$|^GIT binary patch$/m.test(raw) ? { kind: 'binary' } : { kind: 'empty' }
  }

  const hunks: string[][] = []
  for (const line of lines.slice(first)) {
    if (line.startsWith('@@ ')) hunks.push([line])
    else hunks[hunks.length - 1]?.push(line)
  }

  const kept: string[] = []
  let chars = 0
  for (const hunk of hunks) {
    const size = hunk.reduce((sum, line) => sum + line.length + 1, 0)
    if (chars + size <= maxChars && kept.length + hunk.length <= maxLines) {
      kept.push(...hunk)
      chars += size
      continue
    }
    // Take as many body lines of this hunk as still fit.
    let keep = 0
    let used = (hunk[0]?.length ?? 0) + 60 // the rewritten header may be longer
    while (keep < hunk.length - 1 && chars + used + (hunk[keep + 1]?.length ?? 0) + 1 <= maxChars && kept.length + keep + 2 <= maxLines) {
      keep++
      used += (hunk[keep]?.length ?? 0) + 1
    }
    if (keep > 0) kept.push(...cutHunk(hunk, keep))
    break
  }

  const total = lines.length - first
  return { kind: 'diff', source: kept.join('\n'), hiddenLines: total - kept.length }
}
