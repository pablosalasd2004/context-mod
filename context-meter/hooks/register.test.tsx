// Tests of the hooks, run against the engine itself: `claude plugin test ./context-meter`
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const NOW = Date.parse('2026-10-21T10:00:00Z')
/** A compaction always leaves at least one message. */
const MESSAGES = [{ role: 'user' as const, text: 'summary', toolUses: [] }]

/**
 * What the engine says about the context. Without `autoCompactThreshold` auto-compact is off.
 * `skipCompaction` is the reason a hook beneath gives for not compacting.
 */
type Fake = { tokens?: number; window: number; autoCompactThreshold?: number; isFailing: boolean; skipCompaction?: string }

/** Everything beneath the mod: the clock, the session's usage and what the engine draws. */
function world (on: On, start: Partial<Fake> = {}) {
  const clock = mock.clock(on, { now: NOW })
  const fake: Fake = { window: 1_000_000, isFailing: false, ...start }
  /** How each call to usage() was made: `summary` when it asked for the breakdown. */
  const queries: (string | undefined)[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('command.run', () => ({}))
  on('config.set', ($, e) => ({ value: e.value }))
  on('classic.SessionStart', () => ({}))
  on('session.compact', () => (fake.skipCompaction === undefined ? { messages: MESSAGES } : { skip: fake.skipCompaction }))
  on('session.usage', (_, e) => {
    queries.push(e?.breakdown)
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
  return { clock, fake, queries }
}

const startSession = ($: Engine) => $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
const footer = ($: Engine, modes: string[] = [], columns?: number) =>
  $.ui.mount({ plugin: 'context-meter', surface: 'terminal', component: 'SessionMode', props: { modes }, viewport: columns === undefined ? undefined : { columns, rows: 30 } })
const texts = async (ui: { findAll: (query: { type: 'Text' }) => Promise<{ text?: string }[]> }) => (await ui.findAll({ type: 'Text' })).map(text => text.text)
/** The engine reports a new figure after a response. */
const measure = ($: Engine, tokens: number, window = 1_000_000) =>
  $.session.measure({ context: { tokens, window }, rateLimits: [], changed: ['context'] })
/** The run of filled cells: the second text of the meter, after its label. */
const fillOf = async (ui: { findAll: (query: { type: 'Text' }) => Promise<{ text?: string; props: Record<string, unknown> }[]> }) => (await ui.findAll({ type: 'Text' }))[1]

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

test('marks the cell where auto-compact will run, dim while the context is short of it', async ($, on) => {
  world(on, { tokens: 142_000, autoCompactThreshold: 967_000 })
  await startSession($)
  const ui = await footer($)
  expect(await texts(ui)).toEqual(['ctx', ' ━', '────────', '┃', ' 142k/1M 14%'])
  expect((await ui.find({ type: 'Text', text: '┃' }))?.props.dimColor).toBe(true)
})

test('the marker takes the color of the bar once the context is past it', async ($, on) => {
  world(on, { tokens: 600_000, autoCompactThreshold: 267_000 })
  await startSession($)
  const ui = await footer($)
  expect(await texts(ui)).toEqual(['ctx', ' ━━', '┃', '━━━', '────', ' 600k/1M 60%'])
  expect((await ui.find({ type: 'Text', text: '┃' }))?.props.color).toBe('warning')
})

test('the breakdown is asked for at the start, not at each measurement', async ($, on) => {
  const w = world(on, { tokens: 142_000, autoCompactThreshold: 967_000 })
  await startSession($)
  expect(w.queries).toEqual(['summary'])
  await measure($, 200_000)
  await measure($, 250_000)
  await measure($, 300_000)
  expect(w.queries).toEqual(['summary'])
})

test('a different window asks for the breakdown again and the marker follows', async ($, on) => {
  const w = world(on, { tokens: 142_000, autoCompactThreshold: 967_000 })
  await startSession($)
  const ui = await footer($)
  w.fake.window = 200_000
  w.fake.tokens = 50_000
  w.fake.autoCompactThreshold = 167_000
  await measure($, 50_000, 200_000)
  expect(w.queries).toEqual(['summary', 'summary'])
  expect(await texts(ui)).toEqual(['ctx', ' ━━━', '────', '┃', '──', ' 50k/200k 25%'])
})

test('/autocompact moves the marker at once', async ($, on) => {
  const w = world(on, { tokens: 142_000, autoCompactThreshold: 967_000 })
  await startSession($)
  const ui = await footer($)
  w.fake.autoCompactThreshold = 267_000
  await $.command.run({ command: 'autocompact', args: '300k', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(await texts(ui)).toEqual(['ctx', ' ━', '─', '┃', '───────', ' 142k/1M 14%'])
})

test('there is no marker while auto-compact is off', async ($, on) => {
  world(on, { tokens: 142_000 })
  await startSession($)
  expect(await texts(await footer($))).toEqual(['ctx', ' ━', '─────────', ' 142k/1M 14%'])
})

test('the marker can be switched off in the config', { options: { showMarker: false } }, async ($, on) => {
  world(on, { tokens: 142_000, autoCompactThreshold: 967_000 })
  await startSession($)
  expect(await texts(await footer($))).toEqual(['ctx', ' ━', '─────────', ' 142k/1M 14%'])
})

test('turning auto-compact off in /config takes the marker away', async ($, on) => {
  const w = world(on, { tokens: 142_000, autoCompactThreshold: 967_000 })
  await startSession($)
  const ui = await footer($)
  w.fake.autoCompactThreshold = undefined
  await $.config.set({ key: 'autoCompact', value: false, previous: true, provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } })
  expect(await ui.find({ type: 'Text', text: '┃' })).toBeUndefined()
})

test('after /clear the meter reads the engine again and shows the dash', async ($, on) => {
  const w = world(on, { tokens: 600_000, autoCompactThreshold: 967_000 })
  await startSession($)
  const ui = await footer($)
  w.fake.tokens = undefined
  await $.classic.SessionStart({ source: 'clear' })
  expect(await texts(ui)).toEqual(['ctx –'])
  expect(w.queries).toEqual(['summary', 'summary'])
})

test('after /resume and a fork the meter shows the figure of the session it came back to', async ($, on) => {
  const w = world(on)
  await startSession($)
  const ui = await footer($)
  w.fake.tokens = 250_000
  await $.classic.SessionStart({ source: 'resume' })
  expect(await texts(ui)).toEqual(['ctx', ' ━━━', '───────', ' 250k/1M 25%'])
  w.fake.tokens = 400_000
  await $.classic.SessionStart({ source: 'fork' })
  expect(await texts(ui)).toEqual(['ctx', ' ━━━━', '──────', ' 400k/1M 40%'])
})

for (const trigger of ['manual', 'auto', 'plugin'] as const) {
  test(`a ${trigger} compaction that stands clears the reading and asks for the breakdown again`, async ($, on) => {
    const w = world(on, { tokens: 700_000, autoCompactThreshold: 967_000 })
    await startSession($)
    const ui = await footer($)
    expect((await texts(ui)).at(-1)).toBe(' 700k/1M 70%')
    await $.session.compact({ trigger, messages: MESSAGES })
    expect(await texts(ui)).toEqual(['ctx –'])
    expect(w.queries.filter(query => query === 'summary').length).toBe(2)
  })
}

test('a precompute, a vetoed compaction and a subagent compacting leave the reading alone', async ($, on) => {
  const w = world(on, { tokens: 700_000 })
  await startSession($)
  const ui = await footer($)
  await $.session.compact({ trigger: 'precompute', messages: MESSAGES })
  await $.session.compact({ trigger: 'manual', agentId: 'helper', messages: MESSAGES })
  w.fake.skipCompaction = 'off'
  await $.session.compact({ trigger: 'manual', messages: MESSAGES })
  expect((await texts(ui)).at(-1)).toBe(' 700k/1M 70%')
})

test('the SessionStart a compaction raises does not make the meter read the engine again', async ($, on) => {
  const w = world(on, { tokens: 700_000 })
  await startSession($)
  await $.classic.SessionStart({ source: 'compact' })
  expect(w.queries).toEqual(['summary'])
})

test('a compaction is not undone by the figure the engine still reports for it', async ($, on) => {
  const w = world(on, { tokens: 700_000 })
  await startSession($)
  const ui = await footer($)
  await $.session.compact({ trigger: 'manual', messages: MESSAGES })
  // The engine says the same as before until a new response arrives.
  await $.classic.SessionStart({ source: 'compact' })
  await measure($, 700_000)
  expect(await texts(ui)).toEqual(['ctx –'])
  // The next response reports the real size.
  w.fake.tokens = 80_000
  await measure($, 80_000)
  expect(await texts(ui)).toEqual(['ctx', ' ━', '─────────', ' 80k/1M 8%'])
})

test('a new measurement redraws the footer already on screen', async ($, on) => {
  world(on)
  await startSession($)
  const ui = await footer($)
  expect(await texts(ui)).toEqual(['ctx –'])
  await measure($, 300_000)
  expect(await texts(ui)).toEqual(['ctx', ' ━━━', '───────', ' 300k/1M 30%'])
  await measure($, 400_000)
  expect(await texts(ui)).toEqual(['ctx', ' ━━━━', '──────', ' 400k/1M 40%'])
})

test('the bar turns yellow at 500k tokens and red at 700k', async ($, on) => {
  world(on)
  await startSession($)
  const ui = await footer($)
  const cases: [number, string, string][] = [
    [499_999, ' ━━━━━', 'claude'],
    [500_000, ' ━━━━━', 'warning'],
    [699_999, ' ━━━━━━━', 'warning'],
    [700_000, ' ━━━━━━━', 'error']
  ]
  for (const [tokens, run, color] of cases) {
    await measure($, tokens)
    const fill = await fillOf(ui)
    expect(fill?.text, `${tokens} tokens`).toBe(run)
    expect(fill?.props.color, `${tokens} tokens`).toBe(color)
  }
})

test('the thresholds follow the config', { options: { warnTokensK: 100, criticalTokensK: 200 } }, async ($, on) => {
  world(on)
  await startSession($)
  const ui = await footer($)
  const cases: [number, string][] = [
    [99_999, 'claude'],
    [100_000, 'warning'],
    [199_999, 'warning'],
    [200_000, 'error']
  ]
  for (const [tokens, color] of cases) {
    await measure($, tokens)
    expect((await fillOf(ui))?.props.color, `${tokens} tokens`).toBe(color)
  }
})

test('on a 200k window the color still changes, at the same share of the window', async ($, on) => {
  world(on, { window: 200_000 })
  await startSession($)
  const ui = await footer($)
  const cases: [number, string][] = [
    [99_999, 'claude'],
    [100_000, 'warning'],
    [139_999, 'warning'],
    [140_000, 'error']
  ]
  for (const [tokens, color] of cases) {
    await measure($, tokens, 200_000)
    expect((await fillOf(ui))?.props.color, `${tokens} tokens`).toBe(color)
  }
})
