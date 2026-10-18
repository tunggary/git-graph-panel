import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GitGraphCommit, GitGraphRef, GitGraphStatusEntry } from '../types'
import { AUTHOR_WIDTH, DATE_WIDTH, GAP, HASH_WIDTH, pickColumns } from './lib/columns'
import { isGitRepo, loadSnapshot } from './lib/git'
import { PALETTE, layoutGraph, toRuns } from './lib/lanes'
import type { Cell } from './lib/lanes'
import { formatDate } from './lib/parse'

const PANE = 'git-graph'
const PAGE_SIZE = 50
const UNCOMMITTED = 'uncommitted'

const snapshot = atom({ plugin: 'git-graph-panel', key: 'snapshot' } as const, { kind: 'loading' })
const isRemotesShown = atom({ plugin: 'git-graph-panel', key: 'isRemotesShown' } as const, true)
const limit = atom({ plugin: 'git-graph-panel', key: 'limit' } as const, PAGE_SIZE)
const isChangesOpen = atom({ plugin: 'git-graph-panel', key: 'isChangesOpen' } as const, false)

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

const colorOfCell = (cell: number | null): string | undefined => (cell === null ? undefined : PALETTE[cell])

/** Local branch, then remote branches, then tags; the checked-out branch / HEAD first. */
function sortRefs(refs: readonly GitGraphRef[]): GitGraphRef[] {
  const rank = { head: 0, branch: 1, remote: 2, tag: 3 } as const
  return [...refs].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || rank[a.kind] - rank[b.kind])
}

const REF_COLORS = { head: 'claude', branch: 'success', remote: 'suggestion', tag: 'warning' } as const

const STATUS_COLORS: Record<string, string> = { M: 'warning', A: 'success', D: 'error', R: 'suggestion', '??': 'inactive' }

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'graph', description: 'Open or close the git graph pane' })
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
    const { Box, Text, Button } = $.ui.resolve(e)
    const snap = await read($, snapshot)
    const remotes = await read($, isRemotesShown)
    const changesOpen = await read($, isChangesOpen)

    if (snap.kind === 'loading') return <Text dimColor>Loading git history...</Text>
    if (snap.kind === 'not-repo') {
      return <Text dimColor>This directory is not a git repository. Run /graph again after cd-ing into one.</Text>
    }
    if (snap.kind === 'error') return <Text color="error">git failed: {snap.message}</Text>

    const { commits, changes } = snap
    const inputs = [
      ...(changes.length > 0
        ? [{ hash: UNCOMMITTED, parents: snap.head === null ? [] : [snap.head], isUncommitted: true }]
        : []),
      ...commits,
    ]
    const graph = layoutGraph(inputs)
    const layout = pickColumns(e.props.bodyColumns, graph.width)

    const Graph = ({ cells }: { cells: Cell[] }) => (
      <Box width={graph.width} flexShrink={0}>
        <Text>
          {toRuns(cells).map(run => (
            <Text color={colorOfCell(run.color)}>{run.text}</Text>
          ))}
        </Text>
      </Box>
    )

    const Labels = ({ refs }: { refs: readonly GitGraphRef[] }) => (
      <Text>
        {sortRefs(refs).map(ref => (
          <Text color={REF_COLORS[ref.kind]} bold={ref.isCurrent} inverse={ref.isCurrent}>
            {` ${ref.name} `}
          </Text>
        ))}
        {refs.length > 0 ? ' ' : ''}
      </Text>
    )

    // One row per commit; `key` is the extension point for selecting a commit later.
    const CommitRow = ({ commit, cells }: { commit: GitGraphCommit; cells: Cell[] }) => (
      <Box key={`commit:${commit.hash}`} gap={GAP}>
        <Graph cells={cells} />
        <Box width={layout.messageWidth} flexShrink={0}>
          <Text wrap="truncate-end">
            <Labels refs={commit.refs} />
            {commit.subject}
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

    const FileRow = ({ entry, cells }: { entry: GitGraphStatusEntry; cells: Cell[] }) => (
      <Box key={`file:${entry.path}`} gap={GAP}>
        <Graph cells={cells} />
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
      if (commit) return <CommitRow commit={commit} cells={row.cells} />

      return (
        <Box key="uncommitted" flexDirection="column">
          <Box gap={GAP}>
            <Graph cells={row.cells} />
            <Button key="changes" plain hotkey="c" onPress={() => update($, isChangesOpen, open => !open)}>
              {changesOpen ? '▾' : '▸'} <Text italic>Uncommitted Changes ({changes.length})</Text>
            </Button>
          </Box>
          {changesOpen && changes.map(entry => <FileRow entry={entry} cells={row.trail} />)}
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
        </Box>
        {commits.length === 0 && changes.length === 0 && <Text dimColor>No commits yet.</Text>}
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
