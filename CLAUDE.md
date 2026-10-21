# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`context-mod` is a marketplace repository for `context-meter`, a Claude Code mod (a plugin made of function hooks) that shows context-window usage in the prompt footer, next to the usage bar of the `sub-meter` plugin. Status: the plugin is implemented and verified in a terminal session; the desktop app has not been checked.

## Commands

Package manager is pnpm. The plugin has no build step and no runtime dependencies: Claude Code loads the `.tsx` files directly.

```
claude plugin validate ./context-meter --strict   # manifest + hooks module
claude plugin validate .                          # marketplace manifest
claude plugin test ./context-meter                # runs every *.test.ts(x) under the folder; no per-test filter
pnpm dlx --package typescript tsc -p ./context-meter   # pnpm 12 rejects `-p typescript`; `--package` is the form that works
claude --plugin-dir ./context-meter               # dev load, hot-reloads on save (terminal only)
pnpm dlx skills add obra/superpowers --skill test-driven-development verification-before-completion systematic-debugging --agent claude-code --copy --yes
```

- `tsc -p` only works after the engine has loaded the plugin once, because the engine writes the types it extends into `context-meter/.claude-plugin/types/`.
- In the desktop app, where no flag can be passed, set `CLAUDE_CODE_PLUGIN_DIRS`. Do not load the dev folder and an installed copy at the same time: the hooks would run twice.
- The last command restores the development skills in `.claude/skills/`, which are third-party and not committed (`skills-lock.json` records them).

## Architecture

Layout:

- `.claude-plugin/marketplace.json` at the repo root lists the plugin with `source: "./context-meter"`.
- `context-meter/` is the plugin root: `.claude-plugin/plugin.json` (with `types` and `userConfig`), `hooks/hooks.json` pointing to the single module `hooks/register.tsx`, `hooks/register.test.tsx`, `hooks/meter.ts` (pure rules: formatting, levels, thresholds, bar cells, marker, widths; no `$`, no JSX) with `hooks/meter.test.ts`, `types/index.d.ts` (the `PluginState` contract).
- Data flow: `session.measure` and the reads at `session.start` and `classic.SessionStart` store the context figure in `$.state` atoms. A timer started in `session.start` polls `$.session.usage()` only while a main turn runs. A `ui.render` hook on `SessionMode` draws the `ctx` meter and then `await next(e)`, which holds the engine's mode labels and whatever is beneath the meter. `sub-meter`'s room is reserved from `enabledPlugins` read via `$.settings.read`.
- Reference implementation: the installed `sub-meter` plugin (`~/.claude/plugins/cache/better-claude/sub-meter/<version>/hooks/register.tsx` and its `register.test.tsx`). Read it as a model for the footer width logic and the test harness. Treat it as read-only.

## Conventions and pitfalls

Product decisions already made:

- Yellow at 500K tokens and red at 700K tokens (absolute, configurable through `userConfig` in thousands of tokens). When a threshold is at or above the model's window (200K models), use the same proportion of the window instead, so the color can still change.
- A toast when the context first enters red, once per episode; re-arm after it drops below yellow or after a compaction or `/clear`. Toast text is in Spanish by default, and English through the `toastLanguage` option (`es` or `en`).
- A marker on the bar at the real auto-compact point (`autoCompactThreshold / window`), hidden when auto-compact is off.
- `context-meter` is a separate plugin. Do not modify `sub-meter` or its cache; it is overwritten on update.

Mods API:

- The mods API is early access. The `.d.ts` that `/plugin-authoring` generates for the installed Claude Code version is the authority; the docs are at https://code.claude.com/docs/en/plugins/mods/. Check names there before using them.
- `/plugin-authoring` suggests writing mods in `~/.claude/dev-mods/<session>/`, which is temporary. In this repo the plugin lives in `context-meter/`.
- `claude plugin validate` reads the source statically. Write every call in full as `$.namespace.method`; do not alias or destructure `$`, and pass `$` only to top-level functions of the same file. Event names in `on(...)` are string literals, with one registration per event and matcher. Import only relative files and `claude-code`; no dynamic `import()`.
- `atom({ plugin, key } as const, ...)` goes in a `const` with literal `plugin` and `key`; every `$.state` value is declared in `types/index.d.ts`. A `ui.render` hook may read state but not write it.
- A hook that throws is skipped. Wrap `$.session.usage()` in `try/catch` and fall back to `next(e)`.
- `$.state` resets on `/clear`, `/resume` and `/branch`, and `session.start` does not fire again: reseed from `classic.SessionStart`. Timers from `$.clock.every` stop on reload, so start them in `session.start`.

Context numbers:

- `context.tokens` is empty on a new session and after `/clear`, until the next response. `window` is always present.
- After a compaction the engine keeps reporting the figure from before it (the same `tokens` and `apiUsage`), also inside `classic.SessionStart` with `source: 'compact'`. The meter treats that figure as stale and shows `ctx –` until a different figure arrives. Do not reseed from it.
- `session.measure` fires after each main turn, not during one. `$.session.usage()` does change during a long turn (checked in a spike, one turn of about 13 s), so the meter polls it every 2 s while a main turn runs, and not at all otherwise.
- `$.session.usage({ breakdown: 'summary' })` estimates locally and is the only breakdown mode to use; `'full'` calls the token-count API. A `session.compact` with `trigger: 'precompute'` is not a real compaction.
- The default auto-compact point for 1M-window models is documented at https://code.claude.com/docs/en/model-config.md; read it there instead of hard-coding it.

Footer (`SessionMode`):

- Return a tree that contains `await next(e)` exactly once, or the engine's mode labels disappear. Return `next(e)` when there is nothing to show.
- Each plugin only measures what is beneath it, so the outer plugin yields width first. The docs do not define the order of `sub-meter` and `context-meter`. In the installed session `sub-meter` is drawn on the left and `ctx` on the right, which is the opposite of the order seen in an earlier spike loaded with `--plugin-dir`. So `context-meter` reserves its room for `sub-meter` when `enabledPlugins` lists `sub-meter@…` as true, and yields first on a narrow terminal.
- If you copy helpers from `sub-meter` (MIT, midudev), keep its copyright notice. Reimplementing them is preferred.

Repository:

- The repository is public. Do not commit secrets, personal paths or spike logs (`.spike/` is ignored).
- Code, comments, README and commit messages are in English. Commits follow Conventional Commits.
- The repo-local git identity uses the GitHub `noreply` address on purpose; do not change it.
- GitHub merges are squash-only. No force-push, tags or releases.

## Verification

A change is done when these pass, with fresh output, in this order:

1. `claude plugin validate ./context-meter --strict` and `claude plugin validate .`
2. `claude plugin test ./context-meter`, with no failures or warnings
3. `tsc -p ./context-meter` clean
4. A manual check in a real interactive session with `sub-meter` active, at several terminal widths. Lower the thresholds temporarily through `pluginConfigs` (for example 20K and 40K) to see the colors; the user confirms the result visually.

A syntax-only check, or a check command that failed to start, does not count. Missing declared dependencies are installed with pnpm and the lockfile, never with `sudo` or a system package manager. If no real check can run, say which one was skipped and why instead of reporting the change as done.

Work test-first with the project skills in `.claude/skills/`: `test-driven-development`, `verification-before-completion` and `systematic-debugging`. The test command is `claude plugin test`, not `npm test`; the engine stubs in the mod test kit are the unavoidable mocks. Throwaway spikes are exempt from test-first, but their code is deleted, not reused.

## Working agreements

- Keep working until everything asked is done. Stop to ask only when blocked or before a risky step.
- When the requested work is done and verified, stop and report. Do not add features, tests, files, docs or refactors that were not asked for; mention them at the end. Do not start extra review rounds or launch reviewer sub-agents unless asked.
- For ideas, options or a plan, give that and stop until told to proceed.
- Ask before: editing `~/.claude/settings.json`, installing or enabling plugins, adding dependencies, touching `sub-meter` or its cache, force-pushing, creating tags or releases, or changing the GitHub repository settings or visibility.
- Check current facts that may have changed since training (mods API, Claude Code behavior, model limits) against the docs or the generated `.d.ts` instead of answering from memory.
