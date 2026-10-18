import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GitGraphCommit, GitGraphRef, GitGraphStatusEntry } from '../types'
import { AUTHOR_WIDTH, DATE_WIDTH, GAP, GRAPH_MIN_WIDTH, HASH_WIDTH, maxLanesFor, pickColumns } from './lib/columns'
import { isGitRepo, loadSnapshot } from './lib/git'
import { mergeLabels, pillParts } from './lib/labels'
import type { Label } from './lib/labels'
import { PALETTE, cellsToText, laneColor, layoutGraph, toRuns } from './lib/lanes'
import type { GraphRow } from './lib/lanes'
import { formatDate } from './lib/parse'
import { imageBudget, rowImage } from './lib/raster'
import type { RowImage } from './lib/raster'
import { supportsImages } from './lib/terminal'

const PANE = 'git-graph'
const PAGE_SIZE = 50
const UNCOMMITTED = 'uncommitted'

const snapshot = atom({ plugin: 'git-graph-panel', key: 'snapshot' } as const, { kind: 'loading' })
const isRemotesShown = atom({ plugin: 'git-graph-panel', key: 'isRemotesShown' } as const, true)
const limit = atom({ plugin: 'git-graph-panel', key: 'limit' } as const, PAGE_SIZE)
const isChangesOpen = atom({ plugin: 'git-graph-panel', key: 'isChangesOpen' } as const, false)
const graphStyle = atom({ plugin: 'git-graph-panel', key: 'graphStyle' } as const, null)

const STYLE_STORE_KEY = 'graphStyle'

type Dollar = EngineInterface

async function refresh($: Dollar): Promise<void> {
  const next = await loadSnapshot($, { limit: await read($, limit), isRemotesShown: await read($, isRemotesShown) })
  await update($, snapshot, () => next)
}

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
    const pane = (await $.ui.panes()).find(one => one.id === PANE)
    if (pane?.isPlaced) {
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
    const snap = await read($, snapshot)
    const remotes = await read($, isRemotesShown)
    const changesOpen = await read($, isChangesOpen)
    const chosenStyle = await read($, graphStyle)

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
                <Text backgroundColor={part.bg} color={part.fg} bold={label.isCurrent}>
                  {part.text}
                </Text>
              ))}
            </Text>
          ))
          .flatMap(pill => [pill, ' '])}
      </Text>
    )

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

    // One row per commit; `key` is the extension point for selecting a commit later.
    const CommitRow = ({ commit, row, picture }: { commit: GitGraphCommit; row: GraphRow; picture: RowImage | null }) => (
      <Box key={`commit:${commit.hash}`} gap={GAP}>
        <Graph row={row} picture={picture} />
        <Box width={layout.messageWidth} flexShrink={0}>
          <Text wrap="truncate-end">
            <Labels labels={mergeLabels(commit.refs)} color={laneColor(row.lane)} />
            <Text dimColor={commit.parents.length > 1}>{commit.subject}</Text>
          </Text>
        </Box>
        {layout.showDate && (
          <Box width={DATE_WIDTH} flexShrink={0}>
            <Text dimColor>{formatDate(commit.timestamp)}</Text>
          </Box>
        )}
        {layout.showAuthor && (
          <Box width={AUTHOR_WIDTH} flexShrink={0}>
            <Text wrap="truncate-end">{commit.author}</Text>
          </Box>
        )}
        {layout.showHash && (
          <Box width={HASH_WIDTH} flexShrink={0}>
            <Text dimColor>{commit.hash.slice(0, HASH_WIDTH)}</Text>
          </Box>
        )}
      </Box>
    )

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

    const commitRows = new Map(commits.map(commit => [commit.hash, commit]))
    const rows = graph.rows.map(row => {
      const commit = commitRows.get(row.hash)
      if (commit) return <CommitRow commit={commit} row={row} picture={pictureOf(row, { isHead: commit.hash === snap.head })} />

      const picture = pictureOf(row, {})
      const trailPicture = changesOpen ? pictureOf(row, { isTrail: true }, changes.length) : null

      return (
        <Box key="uncommitted" flexDirection="column">
          <Box gap={GAP}>
            <Graph row={row} picture={picture} />
            <Button key="changes" plain hotkey="c" onPress={() => update($, isChangesOpen, open => !open)}>
              {changesOpen ? '▾' : '▸'} <Text italic>Uncommitted Changes ({changes.length})</Text>
            </Button>
          </Box>
          {changesOpen && changes.map(entry => <FileRow entry={entry} row={row} picture={trailPicture} />)}
        </Box>
      )
    })

    return (
      <Box flexDirection="column">
        <Box gap={2}>
          <Button key="refresh" plain label="Refresh" hotkey="r" onPress={() => refresh($)} />
          <Button
            key="remotes"
            plain
            hotkey="b"
            label={`${remotes ? '☑' : '☐'} Show remote branches`}
            onPress={async () => {
              await update($, isRemotesShown, shown => !shown)
              await refresh($)
            }}
          />
          <Button
            key="style"
            plain
            hotkey="g"
            label={`Graph style: ${style}`}
            onPress={async () => {
              const next = style === 'image' ? 'text' : 'image'
              await update($, graphStyle, () => next)
              await $.store.set(STYLE_STORE_KEY, next)
            }}
          />
        </Box>
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
