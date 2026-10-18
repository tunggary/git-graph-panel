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
- **Show remote branches** toggle (`☑ remote`, on by default). Off, the graph covers local branches, tags and `HEAD` only, and the Branches picker lists local branches only.
- **Load more** at the bottom loads 50 more commits (the first load is 50).
- **Refresh** re-reads the repository. The pane also refreshes when it opens and after any Bash tool call whose command contains `git`; there is no polling.
- **Graph style** button (`g`): `image` or `text`, remembered across sessions.

Keys inside the pane (once focused with ctrl+x tab or a click):

| Key | Does |
| --- | --- |
| `j` / `k` | move the cursor down / up one row (the highlighted row; the pane scrolls to follow it). The first press lands on the top row |
| `o` | open or close the details of the cursor's commit (on the Uncommitted row: unfold its files, like `c`) |
| `x` | with a commit's details open: compare it with the commit under the cursor (see Compare); on the open commit itself, back to its details |
| `s` | Find (`/` cannot be a hotkey: hotkeys are one digit or lowercase letter) |
| `n` / `p` | next / previous match while a Find is active (Shift+n is `n` too, so `p` is the way back) |
| `f` | fetch |
| `1`-`9` | with details or a comparison open: the diff of that file (and on the diff screen, jump to it) |
| `h` / `n` / `p` | on the diff screen: back / next file / previous file |
| `r` `b` `g` `c` `m` | refresh, toggle remote branches, graph style, unfold uncommitted changes, load more |
| arrow keys | scroll |

A click on a row's description works like `j`/`k` to that row plus `o`; with the pane focused, Tab walks the rows and Enter presses the focused one.

### Commit details

Pressing a row (or `o`) unfolds the commit under it, one at a time, with the graph lines carrying on beside it:

- the full hash and its parents (`<hash> · parents a1b2c3d e4f5a6b`), the author with email and date (`2024-01-01 09:00`), and the committer too when it differs;
- the whole commit message, body included;
- the changed files, `M src/app.ts +12 -3` (`bin` for a binary file, `R old → new` for a rename). A merge is measured against its first parent, a root commit against the empty tree. Over 200 files, the rest is summed up in a line.

Pressing a file (a click, or its digit `1`-`9` for the first nine) turns the whole pane into the **diff screen**: a bar `h: ← Back  M src/app.ts  (2/5)  p: Prev  n: Next`, a dim line for the range (`abc1234 (vs def5678)`, `abc1234 ↔ def5678`, `abc1234 ↔ working tree`), a strip of the files (`1`-`9` jump to them) and the coloured unified diff, scrolled to the top. `n` / `p` walk the same list of files (they stop at its ends), `h` returns to the graph with the cursor, open details, comparison and Find as they were. The graph's toolbar and keys are not drawn on the diff screen, so `n` / `p` do not clash with Find's. A diff too long to draw (the engine draws 100000 characters of a code block) is cut at 2500 lines or 90000 characters, on a line, and says how many lines it left out. A binary file or a rename without edits gets a one-line note instead. A refresh (including one after a git command in the session) re-reads the diff in place; if its file has left the range, the pane goes back to the graph.

### Compare

With a commit's details open, move the cursor to another commit (or the Uncommitted row) and press `x`: the details turn into `Comparing <older> ↔ <newer>` with the files that differ between the two (`git diff -M older newer`; against the Uncommitted row, the working tree is the newer end and tracked files only). Pressing a file shows that file's diff between the same two points, on the diff screen. `x` on another row changes the target; `x` on the open commit goes back to its details.

### Branches, Find, Fetch

- **Branches** picker: `Show All` or one local or remote branch. A branch restricts the graph to the commits `git log <ref>` reaches (tags on those commits still show). The Uncommitted row is hidden when the chosen branch does not contain `HEAD`. A branch that disappears (pruned by a fetch) falls back to `Show All`. Picking a branch folds the open details.
- **Find** (`s`) opens a field; as you type, the text is highlighted in the loaded commits' message, author and hash, and the branches and tags whose name has it are underlined. `3/12 matches` says where the cursor is among them (`12 matches` when it is on another row). Enter hides the field, keeps the highlight and puts the cursor on the first match from where it was; `n` / `p` step, wrapping round. Emptying the field or pressing `✕ Clear` drops it. Only the commits loaded so far are searched.
- **Fetch** (`f`) runs `git fetch --all --prune` with `Fetching…` on the status line, a toast with the result (the first line of git's error when it fails) and a refresh after. There is no confirmation, and git never prompts for credentials here.

### Graph style

- `image`: every row is a small PNG drawn over two cells per lane: straight 3px lines, smooth curves where a branch leaves or joins, filled nodes, an open ring for the checked-out commit, and a gray ring over a dotted line for Uncommitted Changes. It needs a terminal that shows pictures: **kitty, Ghostty and WezTerm** (read from `TERM_PROGRAM` / `KITTY_WINDOW_ID`). The pictures assume cells about twice as tall as wide (10x20 px); with other proportions the nodes look oval.
- Pictures are handed out from the top down until 1.5 MiB of image data is in the pane (the engine refuses a pane carrying more than 2 MiB); rows below that are drawn as text, so a very long history after several **Load more** stays drawable.
- `text`: box-drawing characters (`●` commit, `○` uncommitted, `│` lane, `╭ ╮ ╰ ╯ ─` curves, `├ ┤ ┬ ┴` where lines meet). A line crossing a lane shows the lane.

The default is `image` where the terminal is one of the above, `text` everywhere else, and always `text` inside tmux (it does not pass pictures through). Pressing `g` overrides the default and is kept in the plugin's store.

Stages 1 (viewing) and 2 (details, diff, compare, branch filter, find, fetch) are done. Write actions (checkout, merge, ...) are not implemented yet.

## Development

```
scripts/make-fixture-repo.sh /tmp/graph-fixture   # a Git Flow-shaped repo with 10+ open lanes, tags, an octopus merge
(cd /tmp/graph-fixture && claude --plugin-dir "$OLDPWD")   # hot-reloads on save
claude plugin validate .
claude plugin test .
npx -p typescript@5.6.3 tsc -p .                  # the engine writes tsconfig.json and .claude-plugin/types/ on first load
```

`hooks/lib/` holds the pure logic (`parse.ts` for git output, `lanes.ts` for the lane layout, `raster.ts` and `png.ts` for the picture graph, `labels.ts` for the pills, `terminal.ts` for the picture check, `columns.ts` for narrow-pane column hiding, `text.ts` for cell widths, `diff.ts` for cutting long diffs, `search.ts` for Find, `git.ts` for the repository reads); `hooks/actions.ts` is what the buttons and keys do; `hooks/register.tsx` has the hooks and the panes. `claude plugin validate` reads state references only in the file that uses them, so the atoms are declared in both of those files. The fixture also has a multi-line message, a rename, a binary file and a 4000-line diff for the details view. `scripts/dump-fixture-log.mjs` regenerates `tests/fixtures/fixture-log.ts` from a fixture repository.
