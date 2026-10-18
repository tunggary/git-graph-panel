# git-graph-panel

A Claude Code mod that shows a VS Code [Git Graph](https://marketplace.visualstudio.com/items?itemName=mhutchie.git-graph)-style commit graph in a terminal pane.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install git-graph-panel --marketplace tunggary/git-graph-panel
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

From a shell:

```
claude plugin install git-graph-panel --marketplace tunggary/git-graph-panel
```

## Usage

`/graph` opens or closes the pane. It also opens on its own when a session starts inside a git repository (a narrow terminal keeps it waiting until you run `/graph` or widen the window, as Claude Code does for any pane a mod opens unasked).

What the pane shows:

- **Header** `Graph  Description  Date  Author  Commit`, then one row per commit of `git log --branches --remotes --tags HEAD --date-order`.
- **Graph** in Git Graph's lane colors, as many lanes as fit in 40% of the pane's width (two cells per lane, at least 8); further lanes are folded into a `…` at the right edge. Two styles, see below.
- **Labels** are pills. Branches are painted in the lane color of their commit with black or white text, whichever reads better; a remote-only branch (`origin/xxx`) takes a darker tone of it, tags are amber, a detached `HEAD` purple; the checked-out branch is bold. A local branch that a remote also has is one pill, `develop │ origin`, the remote half in the darker tone.
- **Stashes** and other tools' private refs (such as cmux's `refs/cmux/*`) are left out of the graph, as in Git Graph.
- **Description** of a merge commit is dimmed.
- **Columns**: graph, labels and message, date (`10-18 16:25`, local time), author, short hash, two cells apart. When the pane is narrow the hash, then the author, then the date are hidden (the header follows).
- **Uncommitted Changes (n)** on top, with an open node above `HEAD`. Press it to unfold the files with their status (`M` `A` `D` `R` `??`). The row is hidden when the working tree is clean.
- **Show remote branches** toggle (on by default). Off, the graph covers local branches, tags and `HEAD` only.
- **Load more** at the bottom loads 50 more commits (the first load is 50).
- **Refresh** re-reads the repository. The pane also refreshes when it opens and after any Bash tool call whose command contains `git`; there is no polling.
- **Graph style** button (`g`): `image` or `text`, remembered across sessions.

Keys inside the pane (once focused with ctrl+x tab or a click): `r` refresh, `b` toggle remote branches, `g` graph style, `c` unfold uncommitted changes, `m` load more, arrow keys scroll.

### Graph style

- `image`: every row is a small PNG drawn over two cells per lane: straight 3px lines, smooth curves where a branch leaves or joins, filled nodes, an open ring for the checked-out commit, and a gray ring over a dotted line for Uncommitted Changes. It needs a terminal that shows pictures: **kitty, Ghostty and WezTerm** (read from `TERM_PROGRAM` / `KITTY_WINDOW_ID`). The pictures assume cells about twice as tall as wide (10x20 px); with other proportions the nodes look oval.
- Pictures are handed out from the top down until 1.5 MiB of image data is in the pane (the engine refuses a pane carrying more than 2 MiB); rows below that are drawn as text, so a very long history after several **Load more** stays drawable.
- `text`: box-drawing characters (`●` commit, `○` uncommitted, `│` lane, `╭ ╮ ╰ ╯ ─` curves, `├ ┤ ┬ ┴` where lines meet). A line crossing a lane shows the lane.

The default is `image` where the terminal is one of the above, `text` everywhere else, and always `text` inside tmux (it does not pass pictures through). Pressing `g` overrides the default and is kept in the plugin's store.

This is stage 1 (viewing). Commit details and diffs, branch filtering, search, and write actions (checkout, merge, ...) are not implemented yet.

## Development

```
scripts/make-fixture-repo.sh /tmp/graph-fixture   # a Git Flow-shaped repo with 10+ open lanes, tags, an octopus merge
(cd /tmp/graph-fixture && claude --plugin-dir "$OLDPWD")   # hot-reloads on save
claude plugin validate .
claude plugin test .
npx -p typescript@5.6.3 tsc -p .                  # the engine writes tsconfig.json and .claude-plugin/types/ on first load
```

`hooks/lib/` holds the pure logic (`parse.ts` for git output, `lanes.ts` for the lane layout, `raster.ts` and `png.ts` for the picture graph, `labels.ts` for the pills, `terminal.ts` for the picture check, `columns.ts` for narrow-pane column hiding, `git.ts` for the repository reads); `hooks/register.tsx` has the hooks and the pane. `scripts/dump-fixture-log.mjs` regenerates `tests/fixtures/fixture-log.ts` from a fixture repository.
