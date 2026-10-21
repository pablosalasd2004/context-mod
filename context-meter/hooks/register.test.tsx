// Tests of the hooks, run against the engine itself: `claude plugin test ./context-meter`
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const NOW = Date.parse('2026-10-21T10:00:00Z')

/** What the engine says about the context. Without `autoCompactThreshold` auto-compact is off. */
type Fake = { tokens?: number; window: number; autoCompactThreshold?: number; isFailing: boolean }

/** Everything beneath the mod: the clock, the session's usage and what the engine draws. */
function world (on: On, start: Partial<Fake> = {}) {
  const clock = mock.clock(on, { now: NOW })
  const fake: Fake = { window: 1_000_000, isFailing: false, ...start }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => {
    if (fake.isFailing) return { deny: 'usage is down' }
    const breakdown = { autoCompactThreshold: fake.autoCompactThreshold, isAutoCompactEnabled: fake.autoCompactThreshold !== undefined }
    return { value: { startedAt: NOW, rateLimits: [], context: { window: fake.window, tokens: fake.tokens, breakdown } } as never }
  })
  // The engine's own node, as core answers it; with mode labels, a Box the tests find.
  on('ui.render', ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    if (e.component !== 'SessionMode') return <Text>engine</Text>
    return e.props.modes.length > 0 ? <Box key="engine" /> : ({ type: 'engine', ref: 0 } as const)
  })
  return { clock, fake }
}

const startSession = ($: Engine) => $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
const footer = ($: Engine, modes: string[] = [], columns?: number) =>
  $.ui.mount({ plugin: 'context-meter', surface: 'terminal', component: 'SessionMode', props: { modes }, viewport: columns === undefined ? undefined : { columns, rows: 30 } })
const texts = async (ui: { findAll: (query: { type: 'Text' }) => Promise<{ text?: string }[]> }) => (await ui.findAll({ type: 'Text' })).map(text => text.text)

test('with no reading yet the meter shows a dimmed dash', async ($, on) => {
  world(on)
  await startSession($)
  const ui = await footer($)
  expect((await ui.find({ type: 'Text', text: 'ctx –' }))?.props.dimColor).toBe(true)
})

test('shows the bar, the tokens against the window and the percent', async ($, on) => {
  world(on, { tokens: 142_000 })
  await startSession($)
  expect(await texts(await footer($))).toEqual(['ctx', ' ━', '─────────', ' 142k/1M 14%'])
})

test('an empty bar and a full one have no run of the other kind', async ($, on) => {
  const w = world(on, { tokens: 3_000 })
  await startSession($)
  expect(await texts(await footer($))).toEqual(['ctx', ' ──────────', ' 3k/1M 0%'])
  w.fake.tokens = 1_000_000
  await startSession($)
  expect(await texts(await footer($))).toEqual(['ctx', ' ━━━━━━━━━━', ' 1M/1M 100%'])
})

test('is drawn the same on the desktop, where the footer has no measured width', async ($, on) => {
  world(on, { tokens: 142_000 })
  await startSession($)
  const ui = await $.ui.mount({ plugin: 'context-meter', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  expect(await texts(ui)).toEqual(['ctx', ' ━', '─────────', ' 142k/1M 14%'])
})

test('when usage fails the meter shows the dash', async ($, on) => {
  world(on, { isFailing: true })
  await startSession($)
  expect(await (await footer($)).find({ type: 'Text', text: 'ctx –' })).toBeDefined()
})
