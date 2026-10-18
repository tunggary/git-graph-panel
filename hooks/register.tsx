import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GitGraphCommit, GitGraphFile, GitGraphStatusEntry } from '../types'
import {
  clearFind,
  closeDiff,
  compareAtCursor,
  fetchRemotes,
  gotoDiff,
  moveCursor,
  openFind,
  pointLabel,
  refresh,
  selectRow,
  setBranchFilter,
  setQuery,
  showDiff,
  stepDiff,
  stepFind,
  submitFind,
  toggleAtCursor,
  toggleRemotes,
} from './actions'
import { AUTHOR_WIDTH, DATE_WIDTH, GAP, GRAPH_MIN_WIDTH, HASH_WIDTH, maxLanesFor, pickColumns } from './lib/columns'
import { UNCOMMITTED, isGitRepo } from './lib/git'
import { fitLabels, mergeLabels, pillParts } from './lib/labels'
import type { Label } from './lib/labels'
import { PALETTE, cellsToText, laneColor, layoutGraph, toRuns } from './lib/lanes'
import type { GraphRow } from './lib/lanes'
import { formatDate, formatDateTime } from './lib/parse'
import { imageBudget, rowImage } from './lib/raster'
import type { RowImage } from './lib/raster'
import { containsQuery, findMatches, highlightParts } from './lib/search'
import { cellWidth, packRows, truncate, truncateStart, wrap } from './lib/text'
import { supportsImages } from './lib/terminal'
import { ALL_BRANCHES, PAGE_SIZE } from './state'


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

// Spelled out here, not imported: `claude plugin validate` reads a `ui.render` matcher's requestId from a const of this file.
const PANE = 'git-graph'
const STYLE_STORE_KEY = 'graphStyle'
/** Files listed under a commit before the rest are summed up in one line. */
const MAX_FILES = 200

type Dollar = EngineInterface

async function openPane($: Dollar): Promise<void> {
  await $.ui.open({ id: PANE, title: 'Git Graph' })
  await refresh($)
}

const isPaneOpen = async ($: Dollar): Promise<boolean> => (await $.ui.panes()).some(pane => pane.id === PANE)

/** Image-capable terminals only: tmux and everything unknown get the text graph. */
async function detectImages($: Dollar): Promise<boolean> {
  return supportsImages({
    TMUX: await $.env.get('TMUX'),
    TERM_PROGRAM: await $.env.get('TERM_PROGRAM'),
    KITTY_WINDOW_ID: await $.env.get('KITTY_WINDOW_ID'),
  })
}

const colorOfCell = (cell: number | null): string | undefined => (cell === null ? undefined : PALETTE[cell])

const STATUS_COLORS: Record<string, string> = { M: 'warning', A: 'success', D: 'error', R: 'suggestion', '??': 'inactive' }

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'graph', description: 'Open or close the git graph pane' })
    const saved = await $.store.get(STYLE_STORE_KEY)
    if (saved === 'image' || saved === 'text') await update($, graphStyle, () => saved)
    if (await isGitRepo($)) void openPane($).catch(() => {})

    return next(e)
  })

  on('command.run', { command: 'graph' }, async $ => {
    const panes = await $.ui.panes()
    if (panes.find(one => one.id === PANE)?.isPlaced) {
      await $.ui.close({ id: PANE })
    } else {
      await openPane($)
    }

    return {}
  })

  // A git command in the session's shell may have moved branches or the working tree.
  // No `{ tool: 'Bash' }` matcher: with MCP tools connected, typing that overload overflows the compiler (TS2589).
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && e.tool === 'Bash' && /\bgit\b/.test(e.command) && (await isPaneOpen($))) {
      try {
        await refresh($)
      } catch {
        // The tool call already ran; a failed redraw must not change its result.
      }
    }

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Image = 'Image' in ui ? ui.Image : null // only the terminal surface draws pictures
    const Select = 'Select' in ui ? ui.Select : null // and not every surface has a picker or a field
    const Input = 'Input' in ui ? ui.Input : null
    const snap = await read($, snapshot)
    const remotes = await read($, isRemotesShown)
    const changesOpen = await read($, isChangesOpen)
    const chosenStyle = await read($, graphStyle)
    const cursorAt = await read($, cursor)
    const openDetails = await read($, details)
    const compare = await read($, comparison)
    const find = await read($, search)
    const fetching = await read($, isFetching)
    const view = await read($, diff)

    if (view.kind === 'open') {
      // The diff replaces the whole pane (no pictures here, so the Image budget is untouched).
      const Code = 'Code' in ui ? ui.Code : null
      const file = view.files[view.index]
      const isNarrowBar = e.props.bodyColumns < 100
      const back = isNarrowBar ? 'Back' : '← Back'
      const count = `(${view.index + 1}/${view.files.length})`
      const status = file?.status ?? ''
      const pathRoom = Math.max(8, e.props.bodyColumns - (3 + cellWidth(back)) - 7 - 7 - cellWidth(count) - 2 - 10)
      const name = file === undefined ? '' : file.oldPath === undefined ? file.path : `${file.oldPath} → ${file.path}`
      const strip = view.files.slice(0, 9).map((one, i) => {
        const label = truncateStart(one.path.split('/').pop() ?? one.path, 14)
        return {
          width: 3 + cellWidth(label),
          node: <Button key={`file:${i}`} plain dimColor={i !== view.index} hotkey={String(i + 1)} label={label} onPress={() => gotoDiff($, i)} />,
        }
      })
      return (
        <Box flexDirection="column">
          <Box gap={2}>
            <Button key="back" plain hotkey="h" label={back} onPress={() => closeDiff($)} />
            <Text bold>
              <Text color={STATUS_COLORS[status] ?? 'text'}>{status}</Text> {truncateStart(name, pathRoom)}
            </Text>
            <Text dimColor>{count}</Text>
            <Button key="diff-prev" plain hotkey="p" label={'Prev'} onPress={() => stepDiff($, -1)} />
            <Button key="diff-next" plain hotkey="n" label="Next" onPress={() => stepDiff($, 1)} />
          </Box>
          <Text dimColor>{view.range}</Text>
          {view.files.length > 1 &&
            packRows(strip, e.props.bodyColumns).map(line => <Box gap={2}>{line.map(item => item.node)}</Box>)}
          {view.body.kind === 'loading' && <Text dimColor>Loading diff...</Text>}
          {view.body.kind === 'error' && <Text color="error">git failed: {view.body.message}</Text>}
          {view.body.kind === 'notice' && <Text>{view.body.text}</Text>}
          {view.body.kind === 'ready' && Code && file && <Code source={view.body.source} format="diff" path={file.path} />}
          {view.body.kind === 'ready' && view.body.hiddenLines > 0 && (
            <Text dimColor>… {view.body.hiddenLines} more lines not shown (the diff is too long to draw whole)</Text>
          )}
        </Box>
      )
    }

    if (snap.kind === 'loading') return <Text dimColor>Loading git history...</Text>
    if (snap.kind === 'not-repo') {
      return <Text dimColor>This directory is not a git repository. Run /graph again after cd-ing into one.</Text>
    }
    if (snap.kind === 'error') return <Text color="error">git failed: {snap.message}</Text>

    const style = chosenStyle ?? ((await detectImages($)) ? 'image' : 'text')
    const { commits, changes } = snap
    const inputs = [
      ...(changes.length > 0
        ? [{ hash: UNCOMMITTED, parents: snap.head === null ? [] : [snap.head], isUncommitted: true }]
        : []),
      ...commits,
    ]
    const graph = layoutGraph(inputs, maxLanesFor(e.props.bodyColumns))
    const graphWidth = Math.max(graph.width, GRAPH_MIN_WIDTH)
    const layout = pickColumns(e.props.bodyColumns, graphWidth)
    /** Cells right of the graph: where the details of a commit are written. */
    const detailWidth = Math.max(10, e.props.bodyColumns - graphWidth - GAP)

    const query = find.query
    const matches = findMatches(commits, query)
    const matched = new Set(matches)
    const order = inputs.map(input => input.hash)
    // A cursor on a row that is gone (another branch, a refresh) is no cursor.
    const cursorHash = cursorAt !== null && order.includes(cursorAt) ? cursorAt : null

    // Pictures are handed out from the top down until the tree's Image budget is spent; the rest is text.
    const budget = imageBudget()
    const pictureOf = (row: GraphRow, options: { isHead?: boolean; isTrail?: boolean }, uses = 1) => {
      if (style !== 'image' || !Image) return null
      const image = rowImage(row, graph.laneCount, options)
      return budget.take(image.png.length * uses) ? image : null
    }

    const Graph = ({ row, picture, isTrail = false }: { row: GraphRow; picture: RowImage | null; isTrail?: boolean }) => {
      const cells = isTrail ? row.trail : row.cells
      if (picture && Image) {
        const image = picture
        return (
          <Box width={graphWidth} flexShrink={0}>
            <Image source={image} columns={graph.width} rows={1} alt={cellsToText(cells)} />
          </Box>
        )
      }

      return (
        <Box width={graphWidth} flexShrink={0}>
          <Text>
            {toRuns(cells).map(run => (
              <Text color={colorOfCell(run.color)}>{run.text}</Text>
            ))}
          </Text>
        </Box>
      )
    }

    const Labels = ({ labels, color }: { labels: Label[]; color: string }) => (
      <Text>
        {labels
          .map(label => (
            <Text>
              {pillParts(label, color).map(part => (
                <Text backgroundColor={part.bg} color={part.fg} bold={label.isCurrent} underline={containsQuery(label.name, query)}>
                  {part.text}
                </Text>
              ))}
            </Text>
          ))
          .flatMap(pill => [pill, ' '])}
      </Text>
    )

    /** `text` with the occurrences of the search query marked; plain when there is no query or no hit. */
    const Marked = ({ text, dim = false, isCursor = false, padTo = 0 }: { text: string; dim?: boolean; isCursor?: boolean; padTo?: number }) => {
      const parts = highlightParts(text, query)
      const pad = isCursor && padTo > cellWidth(text) ? ' '.repeat(padTo - cellWidth(text)) : ''
      return (
        <Text dimColor={dim} inverse={isCursor}>
          {parts.length === 1 && !parts[0]?.isMatch
            ? text
            : parts.map(part => (part.isMatch ? <Text backgroundColor="warning" color="inverseText">{part.text}</Text> : part.text))}
          {pad}
        </Text>
      )
    }

    const Header = () => (
      <Box key="header" gap={GAP}>
        <Box width={graphWidth} flexShrink={0}>
          <Text bold dimColor>Graph</Text>
        </Box>
        <Box width={layout.messageWidth} flexShrink={0}>
          <Text bold dimColor>Description</Text>
        </Box>
        {layout.showDate && (
          <Box width={DATE_WIDTH} flexShrink={0}>
            <Text bold dimColor>Date</Text>
          </Box>
        )}
        {layout.showAuthor && (
          <Box width={AUTHOR_WIDTH} flexShrink={0}>
            <Text bold dimColor>Author</Text>
          </Box>
        )}
        {layout.showHash && (
          <Box width={HASH_WIDTH} flexShrink={0}>
            <Text bold dimColor>Commit</Text>
          </Box>
        )}
      </Box>
    )

    // One row per commit. The description is the Button that selects it (a Button holds only strings and Text,
    // so the graph and the other columns cannot be inside it), and it is cut to the column by hand.
    const CommitRow = ({ commit, row, picture }: { commit: GitGraphCommit; row: GraphRow; picture: RowImage | null }) => {
      const isCursor = commit.hash === cursorHash
      const { shown, used } = fitLabels(mergeLabels(commit.refs), layout.messageWidth)
      const subjectWidth = layout.messageWidth - used
      return (
        <Box key={`commit:${commit.hash}`} gap={GAP}>
          <Graph row={row} picture={picture} />
          <Box width={layout.messageWidth} flexShrink={0}>
            <Button key={`select:${commit.hash}`} plain onPress={() => selectRow($, commit.hash)}>
              <Labels labels={shown} color={laneColor(row.lane)} />
              <Marked text={truncate(commit.subject, subjectWidth)} dim={commit.parents.length > 1} isCursor={isCursor} padTo={subjectWidth} />
            </Button>
          </Box>
          {layout.showDate && (
            <Box width={DATE_WIDTH} flexShrink={0}>
              <Text dimColor inverse={isCursor}>{formatDate(commit.timestamp)}</Text>
            </Box>
          )}
          {layout.showAuthor && (
            <Box width={AUTHOR_WIDTH} flexShrink={0}>
              <Text wrap="truncate-end" inverse={isCursor}>
                <Marked text={commit.author} isCursor={isCursor} />
              </Text>
            </Box>
          )}
          {layout.showHash && (
            <Box width={HASH_WIDTH} flexShrink={0}>
              <Marked text={commit.hash.slice(0, HASH_WIDTH)} dim isCursor={isCursor} />
            </Box>
          )}
        </Box>
      )
    }

    const FileRow = ({ entry, row, picture }: { entry: GitGraphStatusEntry; row: GraphRow; picture: RowImage | null }) => (
      <Box key={`file:${entry.path}`} gap={GAP}>
        <Graph row={row} picture={picture} isTrail />
        <Box width={layout.messageWidth} flexShrink={0}>
          <Text wrap="truncate-start">
            <Text color={STATUS_COLORS[entry.code] ?? 'text'}>{entry.code.padEnd(2)}</Text> {entry.path}
          </Text>
        </Box>
      </Box>
    )

    /** A file of a commit or comparison: a Button that opens its diff in the Diff pane. */
    const FileButton = ({ files, index, from, to, range }: { files: readonly GitGraphFile[]; index: number; from: string; to: string; range: string }) => {
      const file = files[index]!
      const hotkey = index < 9 ? String(index + 1) : undefined // the first nine files answer to a digit
      const stats = file.added === null ? 'bin' : `+${file.added} -${file.deleted}`
      const path = file.oldPath === undefined ? file.path : `${file.oldPath} → ${file.path}`
      return (
        <Button key={`diff:${file.path}`} plain hotkey={hotkey} onPress={() => showDiff($, from, to, [...files], index, range)}>
          <Text color={STATUS_COLORS[file.status] ?? 'text'}>{file.status} </Text>
          {truncateStart(path, detailWidth - 2 - stats.length - 1 - (hotkey ? 3 : 0))}{' '}
          {file.added === null
            ? [<Text dimColor>{stats}</Text>]
            : [<Text color="success">{`+${file.added}`}</Text>, ' ', <Text color="error">{`-${file.deleted}`}</Text>]}
        </Button>
      )
    }

    /** The lines written under a commit's row. */
    const detailLines = (commit: GitGraphCommit) => {
      const lines: ReturnType<typeof Graph>[] = []
      const text = (value: string, props: { bold?: boolean; dimColor?: boolean; color?: string } = {}) => (
        <Text {...props}>{value === '' ? ' ' : value}</Text>
      )
      const files = (list: readonly GitGraphFile[], from: string, to: string, range: string) => {
        const added = list.reduce((sum, file) => sum + (file.added ?? 0), 0)
        const deleted = list.reduce((sum, file) => sum + (file.deleted ?? 0), 0)
        lines.push(text(`${list.length} file${list.length === 1 ? '' : 's'} changed  +${added} -${deleted}`, { dimColor: true }))
        list.slice(0, MAX_FILES).forEach((_file, index) => lines.push(<FileButton files={list} index={index} from={from} to={to} range={range} />))
        if (list.length > MAX_FILES) lines.push(text(`… ${list.length - MAX_FILES} more files`, { dimColor: true }))
      }

      if (compare !== null) {
        lines.push(text(`Comparing ${pointLabel(compare.from)} ↔ ${compare.to === UNCOMMITTED ? 'Uncommitted Changes' : pointLabel(compare.to)}`, { bold: true }))
        if (compare.kind === 'loading') lines.push(text('Loading…', { dimColor: true }))
        else if (compare.kind === 'error') lines.push(text(`git failed: ${compare.message}`, { color: 'error' }))
        else files(compare.files, compare.from, compare.to, `${pointLabel(compare.from)} ↔ ${pointLabel(compare.to)}`)
        return lines
      }
      if (openDetails === null || openDetails.hash !== commit.hash) return lines
      if (openDetails.kind === 'loading') return [text('Loading…', { dimColor: true })]
      if (openDetails.kind === 'error') return [text(`git failed: ${openDetails.message}`, { color: 'error' })]

      const { info } = openDetails
      const person = (name: string, email: string, at: number) => `${name} <${email}> · ${formatDateTime(at)}`
      const parents = info.parents.length === 0 ? 'none' : info.parents.map(parent => parent.slice(0, 7)).join(' ')
      for (const line of wrap(`${info.hash} · parents ${parents}`, detailWidth)) lines.push(text(line, { dimColor: true }))
      for (const line of wrap(`Author  ${person(info.author, info.authorEmail, info.authorTimestamp)}`, detailWidth)) lines.push(text(line))
      const isSameCommitter =
        info.committer === info.author && info.committerEmail === info.authorEmail && info.committerTimestamp === info.authorTimestamp
      if (!isSameCommitter) {
        for (const line of wrap(`Committer  ${person(info.committer, info.committerEmail, info.committerTimestamp)}`, detailWidth)) lines.push(text(line))
      }
      lines.push(text(''))
      info.message.split('\n').forEach((line, i) => {
        for (const part of wrap(line, detailWidth)) lines.push(text(part, { bold: i === 0 }))
      })
      lines.push(text(''))
      files(openDetails.files, openDetails.base, commit.hash, `${pointLabel(commit.hash)} (vs ${pointLabel(openDetails.base)})`)
      return lines
    }

    const Details = ({ commit, row }: { commit: GitGraphCommit; row: GraphRow }) => {
      const lines = detailLines(commit)
      const picture = pictureOf(row, { isTrail: true }, lines.length)
      return (
        <Box key={`details:${commit.hash}`} flexDirection="column">
          {lines.map(line => (
            <Box gap={GAP}>
              <Graph row={row} picture={picture} isTrail />
              <Box width={detailWidth} flexShrink={0}>
                {line}
              </Box>
            </Box>
          ))}
        </Box>
      )
    }

    const commitRows = new Map(commits.map(commit => [commit.hash, commit]))
    const rows = graph.rows.map(row => {
      const commit = commitRows.get(row.hash)
      if (commit) {
        const rowElement = <CommitRow commit={commit} row={row} picture={pictureOf(row, { isHead: commit.hash === snap.head })} />
        if (openDetails?.hash !== commit.hash) return rowElement
        return (
          <Box key={`block:${commit.hash}`} flexDirection="column">
            {rowElement}
            <Details commit={commit} row={row} />
          </Box>
        )
      }

      const picture = pictureOf(row, {})
      const trailPicture = changesOpen ? pictureOf(row, { isTrail: true }, changes.length) : null
      const isCursor = cursorHash === UNCOMMITTED

      return (
        <Box key="uncommitted" flexDirection="column">
          <Box gap={GAP}>
            <Graph row={row} picture={picture} />
            <Button key="changes" plain hotkey="c" onPress={() => selectRow($, UNCOMMITTED)}>
              <Text inverse={isCursor}>{changesOpen ? '▾' : '▸'} </Text>
              <Text italic inverse={isCursor}>Uncommitted Changes ({changes.length})</Text>
            </Button>
          </Box>
          {changesOpen && changes.map(entry => <FileRow entry={entry} row={row} picture={trailPicture} />)}
        </Box>
      )
    })

    const matchAt = cursorHash === null ? -1 : matches.indexOf(cursorHash)
    const matchText =
      matches.length === 0 ? 'No matches' : matchAt >= 0 ? `${matchAt + 1}/${matches.length} matches` : `${matches.length} matches`
    const branchOptions = snap.branches
      .filter(branch => remotes || branch.kind === 'branch')
      .map(branch => ({ value: branch.ref, label: branch.name }))

    // The toolbar is packed into explicit rows (a wrapping Box would stretch its lines apart with blank rows) and
    // takes shorter labels in a narrow pane.
    const isNarrow = e.props.bodyColumns < 100
    const currentBranch = snap.filter === null ? 'Show All' : (snap.branches.find(branch => branch.ref === snap.filter)?.name ?? 'Show All')
    const hasQuery = query.trim() !== '' && matches.length > 0
    type Item = { width: number; node: ReturnType<typeof Graph> }
    const button = (key: string, hotkey: string, label: string, onPress: () => unknown, isDim = false): Item => ({
      width: hotkey.length + 2 + cellWidth(label),
      node: <Button key={key} plain dimColor={isDim} hotkey={hotkey} label={label} onPress={onPress} />,
    })
    const items: Item[] = [
      ...(Select
        ? [
            {
              width: 'Branches'.length + 2 + cellWidth(currentBranch) + 2,
              node: (
                <Select
                  key="branch"
                  label="Branches"
                  options={[{ value: ALL_BRANCHES, label: 'Show All' }, ...branchOptions]}
                  value={snap.filter ?? ALL_BRANCHES}
                  onSelect={value => setBranchFilter($, value === ALL_BRANCHES ? null : value)}
                />
              ),
            },
          ]
        : []),
      button('remotes', 'b', `${remotes ? '☑' : '☐'} remote`, () => toggleRemotes($)),
      ...(Input ? [button('find', 's', 'Find', () => openFind($))] : []),
      button('fetch', 'f', fetching ? 'Fetching…' : 'Fetch', () => fetchRemotes($)),
      button('refresh', 'r', 'Refresh', () => refresh($)),
      button(
        'style',
        'g',
        isNarrow ? style : `Graph style: ${style}`,
        async () => {
          const next = style === 'image' ? 'text' : 'image'
          await update($, graphStyle, () => next)
          await $.store.set(STYLE_STORE_KEY, next)
        },
      ),
      button('cursor-down', 'j', '↓', () => moveCursor($, 1), true),
      button('cursor-up', 'k', '↑', () => moveCursor($, -1), true),
      button('details', 'o', 'Details', () => toggleAtCursor($), true),
      ...(openDetails !== null ? [button('compare', 'x', 'Compare', () => compareAtCursor($), true)] : []),
      ...(hasQuery ? [button('match-next', 'n', 'Next', () => stepFind($, 1), true), button('match-prev', 'p', 'Prev', () => stepFind($, -1), true)] : []),
    ]
    const toolbar = packRows(items, e.props.bodyColumns)

    return (
      <Box flexDirection="column">
        {toolbar.map(line => (
          <Box gap={2}>{line.map(item => item.node)}</Box>
        ))}
        {Input && (find.isOpen || query !== '') && (
          <Box key="search" gap={2}>
            {find.isOpen && (
              <Input
                key="find-input"
                label="Find"
                placeholder="message, author, hash or branch"
                value={query}
                submitLabel="keep"
                onInput={value => setQuery($, value)}
                onSubmit={async value => {
                  await setQuery($, value)
                  await submitFind($)
                }}
              />
            )}
            {query.trim() !== '' && <Text dimColor={matches.length === 0}>{matchText}</Text>}
            {query !== '' && <Button key="find-clear" plain label="✕ Clear" onPress={() => clearFind($)} />}
          </Box>
        )}
        {commits.length === 0 && changes.length === 0 && <Text dimColor>No commits yet.</Text>}
        {(commits.length > 0 || changes.length > 0) && <Header />}
        {rows}
        {snap.hasMore && (
          <Button
            key="load-more"
            plain
            hotkey="m"
            label="Load more"
            onPress={async () => {
              await update($, limit, n => n + PAGE_SIZE)
              await refresh($)
            }}
          />
        )}
      </Box>
    )
  })
}
