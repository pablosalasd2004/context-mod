# context-mod

A Claude Code mod (plugin) that shows how much of the context window the session
has used, right next to the [sub-meter](https://github.com/midudev/better-claude)
usage bar in the prompt footer.

> **Status: planning.** There is no plugin code yet. This repository holds the
> project setup; the plugin will live in `context-meter/`.

## Planned behavior

- A `ctx` meter in the `SessionMode` footer, beside sub-meter: tokens used of the
  window, a bar and a percentage.
- Color by absolute token thresholds: yellow at 500K, red at 700K (configurable).
- A toast when the context crosses into red, as a nudge to run `/compact`.
- A marker on the bar at the real auto-compact point.
- A separate plugin: it does not modify sub-meter.

## Planned layout

```text
.claude-plugin/marketplace.json   marketplace "context-mod"
context-meter/                    the plugin
  .claude-plugin/plugin.json
  hooks/hooks.json
  hooks/register.tsx
  hooks/register.test.tsx
  types/index.d.ts
```

## Development

Needs Claude Code 2.1.306 or later.

```text
claude plugin validate ./context-meter --strict
claude plugin test ./context-meter
```

The development skills under `.claude/skills/` are third-party and not committed.
`skills-lock.json` records them; restore them with:

```text
pnpm dlx skills add obra/superpowers --skill test-driven-development verification-before-completion systematic-debugging --agent claude-code --copy --yes
```

## License

[MIT](LICENSE)
