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
  With `sub-meter` enabled in your settings, the meter also keeps free the room for
  the widest `sub-meter` bar, so `ctx` is the one that shrinks first on a narrow
  terminal, whichever of the two plugins is drawn first.

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

### Install from a local copy

To run the plugin from a folder on your machine (for development), register the
folder as a marketplace from its parent directory, then install from it:

```text
cd C:\Users\<you>\Projects
claude plugin marketplace add ./Context-Mod
claude plugin install context-meter@context-mod
```

`claude plugin marketplace add .` is rejected: the source must be `owner/repo`,
a URL, or a path that starts with `./`. The marketplace then reads the plugin from
the folder itself, so edits take effect after `/reload-plugins`, without a new
version. Do not load the same folder with `--plugin-dir` at the same time: the hooks
would run twice.

## Configure

Set the options with `/plugin configure context-meter@context-mod` in a session.

| Option | Default | What it does |
| --- | --- | --- |
| `warnTokensK` | 500 | Thousands of tokens at which the bar turns yellow. |
| `criticalTokensK` | 700 | Thousands of tokens at which the bar turns red and the toast is raised. |
| `showToast` | on | Raise the toast when the context enters red. |
| `showMarker` | on | Mark the auto-compact cell on the bar. |

A value that is not a number of at least 1 takes its default, and a red threshold
at or below the yellow one sends both thresholds back to the defaults.

## Things to know

- **Where the figures come from.** The meter reads the engine's own context figures
  (`$.session.usage()` and `session.measure`). It never counts tokens itself, so
  its numbers are the ones the engine reports.
- **Refresh.** While a main-conversation turn runs, the meter asks the engine every
  two seconds and redraws only when the figure changes. Subagent turns do not
  trigger a refresh, and nothing is polled while the session is idle.
- **Auto-compact point.** Read from the engine's breakdown when the session starts,
  after a window change, and after `/autocompact` or the auto-compact switch in
  `/config`. A changed threshold made some other way shows up after the next
  `/clear`, `/resume` or `/reload-plugins`.
- **After a compaction.** The engine keeps reporting the figure from before the
  compaction until the next response. The meter ignores that figure and shows
  `ctx –` instead, so the number never goes back up by itself.
- **`sub-meter` detection.** The meter reads `enabledPlugins` from your settings
  when the session starts and after `/clear`, `/resume` and a fork. A plugin that
  you enable or disable in the middle of a session is picked up after
  `/reload-plugins`. The detection looks for the name `sub-meter` in
  `enabledPlugins`, so it is not sure to work with a copy loaded from a folder
  rather than installed.
- **Narrow terminals.** The room reserved for `sub-meter` is a fixed 29 columns,
  its widest form. If `sub-meter` changes its layout, that number needs updating.
- **Hint width.** The meter also reserves room for the hint line after the mode
  label. That width is held in the module, so a reload starts it at zero until the
  hint is drawn again.
- **Trust.** A mod is code that runs with your permissions and can read your files
  and settings. Read the source before you install it.

`context-meter` is verified in a terminal session and through the test kit on the
desktop surface. It has not been looked at in the desktop app.

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

The development skills under `.claude/skills/` are third-party and not committed.
`skills-lock.json` records them; restore them with:

```text
pnpm dlx skills add obra/superpowers --skill test-driven-development verification-before-completion systematic-debugging --agent claude-code --copy --yes
```

## License

[MIT](LICENSE)
