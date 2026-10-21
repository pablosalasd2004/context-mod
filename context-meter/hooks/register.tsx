import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { Reading } from '../types'
import {
  AROUND, SEPARATOR, SUB_METER_WIDTH, barRuns, detailFor, filledCells, formatTokens, holdsPlugin, isBlank, isPluginEnabled, levelFor, markerCell,
  roomOf, thresholdsFor, toastText, treeWidth, widthOf
} from './meter'

const reading = atom({ plugin: 'context-meter', key: 'reading' } as const, null as Reading | null)
const compactAt = atom({ plugin: 'context-meter', key: 'compactAt' } as const, null as number | null)
const stale = atom({ plugin: 'context-meter', key: 'stale' } as const, null as number | null)
const isWorking = atom({ plugin: 'context-meter', key: 'isWorking' } as const, false)
const isAlerted = atom({ plugin: 'context-meter', key: 'isAlerted' } as const, false)
const isSubMeterOn = atom({ plugin: 'context-meter', key: 'isSubMeterOn' } as const, false)

// While a turn runs the engine's figure moves with each response, but it is only announced when the turn ends.
const REFRESH_MS = 2000

// Columns of `ctx –`, which the meter shows while it has no figure.
const DASH = 5

// The hint line as last drawn on the terminal, in columns. A render hook cannot write the session's
// state, so this one value is kept here; a reload loses it until the hint is drawn again.
let hintWidth = 0

/**
 * Raises the toast the first time the context enters red. It stays quiet while the context stays red or
 * between yellow and red, and is armed again below yellow and when there is no figure (a compaction, /clear).
 */
async function judge ($: EngineInterface, options: PluginOptions, tokens: number | null, window: number) {
  const alerted = await read($, isAlerted)
  const { warn, critical } = thresholdsFor(window, options)
  if (tokens === null || tokens < warn) {
    if (alerted) await update($, isAlerted, () => false)
    return
  }
  if (tokens < critical || alerted) return
  await update($, isAlerted, () => true)
  if (options.showToast === false) return
  const percent = Math.round((tokens / window) * 100)
  await $.ui.toast(toastText(options, tokens, percent))
}

/**
 * Keeps a context figure from the engine for the footer. After a compaction the engine goes on
 * reporting the figure from before it, so that one is not kept; the first different figure is.
 */
async function take ($: EngineInterface, options: PluginOptions, context: { tokens?: number; window: number }) {
  const old = await read($, stale)
  if (old !== null) {
    if (context.tokens === old) return
    await update($, stale, () => null)
  }
  const tokens = context.tokens ?? null
  const current = await read($, reading)
  if (current !== null && current.tokens === tokens && current.window === context.window) return
  await update($, reading, () => ({ tokens, window: context.window }))
  await judge($, options, tokens, context.window)
}

/**
 * Reads the context and the auto-compact point from the engine; where the engine cannot say, the meter
 * keeps what it had. The breakdown is the costly part, so this runs at the start and when the point may
 * have moved, not at each measurement.
 */
async function seed ($: EngineInterface, options: PluginOptions) {
  try {
    const { context } = await $.session.usage({ breakdown: 'summary' })
    await take($, options, context)
    await update($, compactAt, () => context.breakdown?.autoCompactThreshold ?? null)
  } catch {
    // no reading this time
  }
}

/** Notes whether sub-meter is enabled; where the settings cannot be read, the meter keeps what it knew. */
async function noteSubMeter ($: EngineInterface) {
  try {
    const enabled = await $.settings.read({ key: 'enabledPlugins' })
    await update($, isSubMeterOn, () => isPluginEnabled(enabled, 'sub-meter'))
  } catch {
    // the footer is shared as before
  }
}

/** Asks the engine for the figure again, but only while a turn of the main conversation runs. */
async function tick ($: EngineInterface, options: PluginOptions) {
  try {
    if (!(await read($, isWorking))) return
    const { context } = await $.session.usage()
    await take($, options, context)
  } catch {
    // the next tick tries again
  }
}

/** A compaction emptied the context: show no figure until a response reports the new one. */
async function afterCompaction ($: EngineInterface, options: PluginOptions) {
  try {
    const { context } = await $.session.usage()
    await update($, stale, () => context.tokens ?? null)
    await update($, reading, current => (current === null ? null : { ...current, tokens: null }))
    await update($, isAlerted, () => false)
  } catch {
    // the next measurement sets it right
  }
  await seed($, options)
}

export const register: Register = (on, options) => {
  // Timers stop when the module reloads, so this is where one starts.
  on('session.start', async ($, e, next) => {
    await noteSubMeter($)
    await seed($, options)
    $.clock.every(REFRESH_MS, () => {
      void tick($, options)
    })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await update($, isWorking, () => true)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await update($, isWorking, () => false)
    return next(e)
  })

  // /clear, /resume and a fork reset the state without a new session.start. A compaction also raises this
  // with source `compact`, while the engine still reports the figure from before it.
  on('classic.SessionStart', async ($, e, next) => {
    if (e.source !== 'compact') {
      await noteSubMeter($)
      await seed($, options)
    }
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.trigger !== 'precompute' && e.agentId === undefined && result.skip === undefined) await afterCompaction($, options)
    return result
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    const before = await read($, reading)
    await take($, options, e.context)
    if (before === null || before.window !== e.context.window) await seed($, options)
    return next(e)
  })

  // The auto-compact point moves with /autocompact and with the /config toggle.
  on('command.run', { command: 'autocompact' }, async ($, e, next) => {
    const result = await next(e)
    await seed($, options)
    return result
  }).catch(($, e, next) => next(e))

  on('config.set', { key: 'autoCompact' }, async ($, e, next) => {
    const result = await next(e)
    await seed($, options)
    return result
  }).catch(($, e, next) => next(e))

  // The hint after the mode label shares the row with the meter, so its width tells how much room is left.
  on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
    if (e.surface === 'terminal' && widthOf(e.props.hint) !== hintWidth) {
      hintWidth = widthOf(e.props.hint)
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  // The meter, then what is beneath it (the engine's mode labels, another plugin's switch).
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const current = await read($, reading)
    const point = await read($, compactAt)
    const beneath = await next(e)
    const { Box, Text } = $.ui.resolve(e)

    // What is beneath is drawn after the meter, and the row has only so much room for both.
    const hasModes = e.props.modes.length > 0
    const hasBeneath = hasModes || !isBlank(beneath)
    const below = (hasModes ? widthOf(e.props.modes.join(' & ')) : 0) + treeWidth(beneath)
    // A plugin beneath is measured here and gives up room itself; with none, one above may wrap the meter.
    const above = (await read($, isSubMeterOn)) ? SUB_METER_WIDTH + SEPARATOR.length : AROUND
    const room =
      roomOf(e.surface, e.viewport?.columns, hintWidth) - (hasBeneath ? below + SEPARATOR.length : 0) - (holdsPlugin(beneath) ? 0 : above)
    const separator = hasBeneath ? <Text dimColor>{SEPARATOR}</Text> : null

    if (current === null || current.tokens === null) {
      if (room < DASH) return beneath
      return (
        <Box flexDirection="row">
          <Text dimColor>ctx –</Text>
          {separator}
          {beneath}
        </Box>
      )
    }

    const percent = Math.round((current.tokens / current.window) * 100)
    const words = { tokens: formatTokens(current.tokens), window: formatTokens(current.window), percent: `${percent}%` }
    const detail = detailFor(room, words)
    if (detail === null) return beneath

    const level = levelFor(current.tokens, thresholdsFor(current.window, options))
    const marker = options.showMarker === false ? null : markerCell(point ?? undefined, current.window)
    const runs = barRuns(filledCells(current.tokens, current.window), marker)

    return (
      <Box flexDirection="row">
        <Text dimColor>ctx</Text>
        {detail.hasBar
          ? runs.map((run, i) => {
              const cells = (i === 0 ? ' ' : '') + (run.isMarker ? '┃' : run.isFilled ? '━' : '─').repeat(run.cells)
              return run.isFilled ? <Text color={level}>{cells}</Text> : <Text dimColor>{cells}</Text>
            })
          : null}
        <Text>{` ${words.tokens}${detail.hasWindow ? '/' + words.window : ''}${detail.hasPercent ? ' ' + words.percent : ''}`}</Text>
        {separator}
        {beneath}
      </Box>
    )
  })
}
