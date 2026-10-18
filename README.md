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

`/graph` opens or closes the pane. It opens on its own when a session starts inside a git repository and the terminal is wide enough.

> Work in progress — see the roadmap in issues.
