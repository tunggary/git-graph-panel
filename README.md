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

- **Graph** of `git log --all --date-order`, one row per commit, with lanes drawn in box characters (`●` commit, `│` lane, `╭ ╮ ╰ ╯ ─ ├ ┤ ┬ ┴ ┼` branches and merges) in Git Graph's lane colors. At most 8 lanes are drawn; further lanes are folded into a `…` at the right edge.
- **Columns**: graph, labels and message, date (`10-18 16:25`, local time), author, short hash. Labels are colored by kind (local branch, `origin/…` branch, tag, `HEAD`); the checked-out branch is highlighted. When the pane is narrow the hash, then the author, then the date are hidden.
- **Uncommitted Changes (n)** on top, with an open node above `HEAD`. Press it to unfold the files with their status (`M` `A` `D` `R` `??`). The row is hidden when the working tree is clean.
- **Show remote branches** toggle (on by default). Off, the graph covers local branches, tags and `HEAD` only.
- **Load more** at the bottom loads 50 more commits (the first load is 50).
- **Refresh** re-reads the repository. The pane also refreshes when it opens and after any Bash tool call whose command contains `git`; there is no polling.

Keys inside the pane (once focused with ctrl+x tab or a click): `r` refresh, `b` toggle remote branches.

This is stage 1 (viewing). Commit details and diffs, branch filtering, search, and write actions (checkout, merge, ...) are not implemented yet.

## Development

```
scripts/make-fixture-repo.sh /tmp/graph-fixture   # a Git Flow-shaped repo with 10+ open lanes, tags, an octopus merge
(cd /tmp/graph-fixture && claude --plugin-dir "$OLDPWD")   # hot-reloads on save
claude plugin validate .
claude plugin test .
```

`hooks/lib/` holds the pure logic (`parse.ts` for git output, `lanes.ts` for the lane layout, `columns.ts` for narrow-pane column hiding, `git.ts` for the repository reads); `hooks/register.tsx` has the hooks and the pane. `scripts/dump-fixture-log.mjs` regenerates `tests/fixtures/fixture-log.ts` from a fixture repository.
