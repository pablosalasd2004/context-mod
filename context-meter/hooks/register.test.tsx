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
  /** How many times the engine was asked to draw the footer. */
  const draws = { count: 0 }
  /** The text of each toast the mod raised. */
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
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
  // The engine's own node, as core answers it: the mode labels, which it draws itself.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    draws.count += 1
    if (e.component === 'PromptHint') return <Text>{e.props.hint}</Text>
    if (e.component !== 'SessionMode') return <Text>engine</Text>
    return { type: 'engine', ref: 0 } as const
  })
  return { clock, fake, queries, draws, toasts }
}

const startSession = ($: Engine) => $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
const hint = ($: Engine, text: string) =>
  $.ui.mount({ plugin: 'context-meter', surface: 'terminal', component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: text } })
const footer = ($: Engine, modes: string[] = [], columns?: number) =>
  $.ui.mount({ plugin: 'context-meter', surface: 'terminal', component: 'SessionMode', props: { modes }, viewport: columns === undefined ? undefined : { columns, rows: 30 } })
const texts = async (ui: { findAll: (query: { type: 'Text' }) => Promise<{ text?: string }[]> }) => (await ui.findAll({ type: 'Text' })).map(text => text.text)
const startTurn = ($: Engine, turnId = 't1', agentId?: string) => $.turn.start({ text: 'go', turnId, agentId })
const endTurn = ($: Engine, turnId = 't1', agentId?: string) =>
  $.turn.complete({ turnId, agentId, answer: 'done', durationMs: 5_000, isAborted: false, reason: 'answer' })
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

test('while a turn runs the meter follows the engine every two seconds', async ($, on) => {
  const w = world(on, { tokens: 100_000 })
  await startSession($)
  const ui = await footer($)
  await startTurn($)
  w.fake.tokens = 150_000
  await w.clock.advance(2_000)
  expect((await texts(ui)).at(-1)).toBe(' 150k/1M 15%')
  w.fake.tokens = 200_000
  await w.clock.advance(1_999)
  expect((await texts(ui)).at(-1)).toBe(' 150k/1M 15%')
  await w.clock.advance(1)
  expect((await texts(ui)).at(-1)).toBe(' 200k/1M 20%')
})

test('with no turn running the meter does not ask the engine', async ($, on) => {
  const w = world(on, { tokens: 100_000 })
  await startSession($)
  const ui = await footer($)
  w.fake.tokens = 150_000
  await w.clock.advance(10_000)
  expect((await texts(ui)).at(-1)).toBe(' 100k/1M 10%')
  expect(w.queries).toEqual(['summary'])
})

test('it stops asking when the turn ends', async ($, on) => {
  const w = world(on, { tokens: 100_000 })
  await startSession($)
  const ui = await footer($)
  await startTurn($)
  await endTurn($)
  w.fake.tokens = 150_000
  await w.clock.advance(10_000)
  expect((await texts(ui)).at(-1)).toBe(' 100k/1M 10%')
})

test("a subagent's turns neither start nor stop it", async ($, on) => {
  const w = world(on, { tokens: 100_000 })
  await startSession($)
  const ui = await footer($)
  await startTurn($, 'sub-1', 'helper')
  w.fake.tokens = 150_000
  await w.clock.advance(4_000)
  expect((await texts(ui)).at(-1)).toBe(' 100k/1M 10%')
  await startTurn($, 'main-1')
  await endTurn($, 'sub-1', 'helper')
  await w.clock.advance(2_000)
  expect((await texts(ui)).at(-1)).toBe(' 150k/1M 15%')
})

test('a usage that failed at the start does not stop the refresh later', async ($, on) => {
  const w = world(on, { isFailing: true })
  await startSession($)
  const ui = await footer($)
  expect(await texts(ui)).toEqual(['ctx –'])
  await startTurn($)
  w.fake.isFailing = false
  w.fake.tokens = 300_000
  await w.clock.advance(2_000)
  expect((await texts(ui)).at(-1)).toBe(' 300k/1M 30%')
})

test('the timer does not bring back the figure a compaction left behind', async ($, on) => {
  const w = world(on, { tokens: 700_000 })
  await startSession($)
  const ui = await footer($)
  await $.session.compact({ trigger: 'auto', messages: MESSAGES })
  await startTurn($)
  await w.clock.advance(2_000)
  expect(await texts(ui)).toEqual(['ctx –'])
  w.fake.tokens = 80_000
  await w.clock.advance(2_000)
  expect((await texts(ui)).at(-1)).toBe(' 80k/1M 8%')
})

test('a tick that finds the same figure does not draw the footer again', async ($, on) => {
  const w = world(on, { tokens: 100_000 })
  await startSession($)
  await footer($)
  await startTurn($)
  const drawn = w.draws.count
  await w.clock.advance(6_000)
  expect(w.draws.count).toBe(drawn)
})

test('a toast suggests /compact the first time the context reaches red', async ($, on) => {
  const w = world(on)
  await startSession($)
  await measure($, 699_999)
  expect(w.toasts).toEqual([])
  await measure($, 700_000)
  expect(w.toasts.length).toBe(1)
  expect(w.toasts[0]).toContain('700k')
  expect(w.toasts[0]).toContain('/compact')
})

test('it does not repeat while the context stays red or between yellow and red', async ($, on) => {
  const w = world(on)
  await startSession($)
  for (const tokens of [700_000, 750_000, 800_000, 600_000, 520_000, 710_000]) await measure($, tokens)
  expect(w.toasts.length).toBe(1)
})

test('it is armed again once the context drops below yellow', async ($, on) => {
  const w = world(on)
  await startSession($)
  await measure($, 700_000)
  await measure($, 499_999)
  await measure($, 700_000)
  expect(w.toasts.length).toBe(2)
})

test('it is armed again after a compaction', async ($, on) => {
  const w = world(on, { tokens: 700_000 })
  await startSession($)
  expect(w.toasts.length).toBe(1)
  await $.session.compact({ trigger: 'manual', messages: MESSAGES })
  w.fake.tokens = 720_000
  await measure($, 720_000)
  expect(w.toasts.length).toBe(2)
})

test('it is armed again after /clear', async ($, on) => {
  const w = world(on, { tokens: 700_000 })
  await startSession($)
  w.fake.tokens = undefined
  await $.classic.SessionStart({ source: 'clear' })
  await measure($, 700_000)
  expect(w.toasts.length).toBe(2)
})

test('a session that comes back already red is told once', async ($, on) => {
  const w = world(on, { tokens: 800_000 })
  await startSession($)
  w.fake.tokens = 800_000
  await $.classic.SessionStart({ source: 'resume' })
  expect(w.toasts.length).toBe(1)
})

test('the toast can be switched off in the config', { options: { showToast: false } }, async ($, on) => {
  const w = world(on)
  await startSession($)
  await measure($, 800_000)
  expect(w.toasts).toEqual([])
})

test('the toast follows the thresholds of the config', { options: { warnTokensK: 100, criticalTokensK: 200 } }, async ($, on) => {
  const w = world(on)
  await startSession($)
  await measure($, 199_999)
  expect(w.toasts).toEqual([])
  await measure($, 200_000)
  expect(w.toasts.length).toBe(1)
})

test('on a 200k window the toast comes at the same share of the window', async ($, on) => {
  const w = world(on, { window: 200_000 })
  await startSession($)
  await measure($, 139_999, 200_000)
  expect(w.toasts).toEqual([])
  await measure($, 140_000, 200_000)
  expect(w.toasts.length).toBe(1)
})

// The footer's row on the terminal leaves the meter its columns minus 30: 4 of padding, 2 between, 20 for
// the mode label at the left, and 4 for a plugin that may wrap the meter.
test('where the row is short the meter gives up its bar, then the window, then the percent, then itself', async ($, on) => {
  world(on, { tokens: 142_000 })
  await startSession($)
  expect(await texts(await footer($, [], 56))).toEqual(['ctx', ' ━', '─────────', ' 142k/1M 14%'])
  expect(await texts(await footer($, [], 55))).toEqual(['ctx', ' 142k/1M 14%'])
  expect(await texts(await footer($, [], 45))).toEqual(['ctx', ' 142k/1M 14%'])
  expect(await texts(await footer($, [], 44))).toEqual(['ctx', ' 142k 14%'])
  expect(await texts(await footer($, [], 42))).toEqual(['ctx', ' 142k 14%'])
  expect(await texts(await footer($, [], 41))).toEqual(['ctx', ' 142k'])
  expect(await texts(await footer($, [], 38))).toEqual(['ctx', ' 142k'])
  expect(await texts(await footer($, [], 37))).toEqual([])
})

test('the hint beside the mode label takes its room from the meter', async ($, on) => {
  world(on, { tokens: 142_000 })
  await startSession($)
  await hint($, '? for shortcuts')
  expect(await texts(await footer($, [], 72))).toEqual(['ctx', ' ━', '─────────', ' 142k/1M 14%'])
  expect(await texts(await footer($, [], 71))).toEqual(['ctx', ' 142k/1M 14%'])
})

test('a footer already on screen is drawn again when the hint changes its width', async ($, on) => {
  world(on, { tokens: 142_000 })
  await startSession($)
  const ui = await footer($, [], 71)
  expect(await texts(ui)).toEqual(['ctx', ' ━', '─────────', ' 142k/1M 14%'])
  await hint($, '? for shortcuts')
  expect(await texts(ui)).toEqual(['ctx', ' 142k/1M 14%'])
  await hint($, '')
  expect(await texts(ui)).toEqual(['ctx', ' ━', '─────────', ' 142k/1M 14%'])
})

test('the hint is left as the engine draws it', async ($, on) => {
  world(on, { tokens: 142_000 })
  await startSession($)
  expect(await texts(await hint($, '? for shortcuts'))).toEqual(['? for shortcuts'])
})

test("keeps the engine's mode labels after the meter, once and last", async ($, on) => {
  world(on, { tokens: 142_000 })
  await startSession($)
  const ui = await footer($, ['focus'])
  expect(await texts(ui)).toEqual(['ctx', ' ━', '─────────', ' 142k/1M 14%', ' · '])
  expect((await ui.findAll({ type: 'engine' })).length).toBe(1)
  expect((await ui.findAll({})).at(-1)?.type).toBe('engine')
})

test('alone, with no mode labels, the meter ends the footer without a separator', async ($, on) => {
  world(on, { tokens: 142_000 })
  await startSession($)
  expect((await texts(await footer($))).at(-1)).toBe(' 142k/1M 14%')
})

test('the mode labels take their room from the meter', async ($, on) => {
  // `focus` is 5 columns, and 3 more for the separator.
  world(on, { tokens: 142_000 })
  await startSession($)
  expect(await texts(await footer($, ['focus'], 64))).toEqual(['ctx', ' ━', '─────────', ' 142k/1M 14%', ' · '])
  expect(await texts(await footer($, ['focus'], 63))).toEqual(['ctx', ' 142k/1M 14%', ' · '])
})

/** Another plugin's switch, drawn beneath the meter in place of the engine's own node: 13 columns. */
const switchBeneath = {
  name: 'switch',
  tier: 'append' as const,
  register (on: On) {
    on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
      await next(e)
      const { Text } = $.ui.resolve(e)
      return <Text>{'⏵ narrator on'}</Text>
    })
  }
}

test("another plugin's drawing beneath keeps its place after the meter and its room", { plugins: [switchBeneath] }, async ($, on) => {
  world(on, { tokens: 142_000 })
  await startSession($)
  expect(await texts(await footer($, [], 68))).toEqual(['ctx', ' ━', '─────────', ' 142k/1M 14%', ' · ', '⏵ narrator on'])
  expect(await texts(await footer($, [], 67))).toEqual(['ctx', ' 142k/1M 14%', ' · ', '⏵ narrator on'])
  expect(await texts(await footer($, [], 54))).toEqual(['ctx', ' 142k 14%', ' · ', '⏵ narrator on'])
  expect(await texts(await footer($, [], 50))).toEqual(['ctx', ' 142k', ' · ', '⏵ narrator on'])
  expect(await texts(await footer($, [], 49))).toEqual(['⏵ narrator on'])
})

/** A plugin beneath that has nothing to show and passes the engine's drawing on. */
const quietBeneath = {
  name: 'quiet',
  tier: 'append' as const,
  register (on: On) {
    on('ui.render', { component: 'SessionMode' }, ($, e, next) => next(e))
  }
}

test('a plugin beneath that shows nothing costs the meter nothing', { plugins: [quietBeneath] }, async ($, on) => {
  world(on, { tokens: 142_000 })
  await startSession($)
  expect(await texts(await footer($))).toEqual(['ctx', ' ━', '─────────', ' 142k/1M 14%'])
})

/** A plugin above the meter, wrapping what is beneath it: it draws its own text first. */
const usageAbove = {
  name: 'usage',
  tier: 'prepend' as const,
  register (on: On) {
    on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
      const beneath = await next(e)
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="row">
          <Text>{'5h 58%'}</Text>
          {beneath}
        </Box>
      )
    })
  }
}

test('wrapped by another plugin, the meter still draws and the engine\'s node is once and last', { plugins: [usageAbove] }, async ($, on) => {
  world(on, { tokens: 142_000 })
  await startSession($)
  const ui = await footer($, ['focus'])
  expect(await texts(ui)).toEqual(['5h 58%', 'ctx', ' ━', '─────────', ' 142k/1M 14%', ' · '])
  expect((await ui.findAll({ type: 'engine' })).length).toBe(1)
  expect((await ui.findAll({})).at(-1)?.type).toBe('engine')
})

test('the dash gives way too, and last', async ($, on) => {
  world(on)
  await startSession($)
  expect(await texts(await footer($, [], 35))).toEqual(['ctx –'])
  expect(await texts(await footer($, [], 34))).toEqual([])
})

test('off the terminal the meter is drawn whole, however narrow the viewport says it is', async ($, on) => {
  world(on, { tokens: 142_000 })
  await startSession($)
  const ui = await $.ui.mount({ plugin: 'context-meter', surface: 'desktop', component: 'SessionMode', props: { modes: [] }, viewport: { columns: 30, rows: 30 } })
  expect(await texts(ui)).toEqual(['ctx', ' ━', '─────────', ' 142k/1M 14%'])
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
