# context-mod

A Claude Code mod (plugin) that shows how much of the context window the session
has used, right next to the [sub-meter](https://github.com/midudev/better-claude)
usage bar in the prompt footer.

> **Status: early version.** Needs Claude Code 2.1.306 or later. The plugin lives
> in `context-meter/`; this repository is also its marketplace.

## What it shows

```text
ctx ━────────┃ 142k/1M 14%
```

- A ten-cell bar, filled in proportion to the context window, then the tokens
  used against the window and the percent.
- The bar is yellow from 500K tokens and red from 700K (both configurable). On a
  model whose window is no larger than the red threshold, the same share of the
  window is used instead, so the color can still change.
- `┃` marks the cell where auto-compact will run. It is hidden when auto-compact
  is off, and it follows `/autocompact`.
- A toast suggests `/compact` the first time the context enters red. It is raised
  once per stretch in red, and again after the context drops below yellow, after a
  compaction, or after `/clear`. The toast text is in Spanish.
- `ctx –` is shown while there is no figure yet, for example in a new session and
  right after a compaction, until the next response.
- Where the footer is short, the meter gives up its bar, then the window, then the
  percent, and finally hides, so it never pushes the mode labels or other plugins out.

`context-meter` is a separate plugin and does not modify `sub-meter`.

## Install

In a Claude Code session in the terminal:

```text
/plugin install context-meter --marketplace pablosalasd2004/context-mod
```

From a shell:

```text
claude plugin install context-meter --marketplace pablosalasd2004/context-mod
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt
box, then **Plugins**, **Add marketplace** with `pablosalasd2004/context-mod`, then
**Add plugin**.

## Configure

The options are rows in the `/config` menu.

| Option | Default | What it does |
| --- | --- | --- |
| `warnTokensK` | 500 | Thousands of tokens at which the bar turns yellow. |
| `criticalTokensK` | 700 | Thousands of tokens at which the bar turns red and the toast is raised. |
| `showToast` | on | Raise the toast when the context enters red. |
| `showMarker` | on | Mark the auto-compact cell on the bar. |

A value that is not a number of at least 1 takes its default, and a red threshold
at or below the yellow one sends both thresholds back to the defaults.

## Development

The plugin has no build step and no runtime dependencies. Commands run from the
root of the repository; the package manager is pnpm.

```text
claude plugin validate ./context-meter --strict
claude plugin validate .
claude plugin test ./context-meter
pnpm dlx --package typescript tsc -p ./context-meter
```

`tsc -p` needs the types the engine writes into `context-meter/.claude-plugin/types/`
when it loads the plugin, so load it once first. To load the folder for a session
with hot reload, from a terminal:

```text
claude --plugin-dir ./context-meter
```

Do not load the folder and an installed copy at the same time: the hooks would run
twice.

The development skills under `.claude/skills/` are third-party and not committed.
`skills-lock.json` records them; restore them with:

```text
pnpm dlx skills add obra/superpowers --skill test-driven-development verification-before-completion systematic-debugging --agent claude-code --copy --yes
```

## License

[MIT](LICENSE)
