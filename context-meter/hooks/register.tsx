import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Reading } from '../types'
import { barRuns, filledCells, formatTokens, levelFor, markerCell, thresholdsFor } from './meter'

const reading = atom({ plugin: 'context-meter', key: 'reading' } as const, null as Reading | null)
const compactAt = atom({ plugin: 'context-meter', key: 'compactAt' } as const, null as number | null)

/** Keeps a context figure from the engine for the footer. */
async function take ($: EngineInterface, context: { tokens?: number; window: number }) {
  await update($, reading, () => ({ tokens: context.tokens ?? null, window: context.window }))
}

/**
 * Reads the context and the auto-compact point from the engine; where the engine cannot say, the meter
 * keeps what it had. The breakdown is the costly part, so this runs at the start and when the point may
 * have moved, not at each measurement.
 */
async function seed ($: EngineInterface) {
  try {
    const { context } = await $.session.usage({ breakdown: 'summary' })
    await take($, context)
    await update($, compactAt, () => context.breakdown?.autoCompactThreshold ?? null)
  } catch {
    // no reading this time
  }
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await seed($)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const before = await read($, reading)
    await take($, e.context)
    if (before === null || before.window !== e.context.window) await seed($)
    return next(e)
  })

  // The auto-compact point moves with /autocompact and with the /config toggle.
  on('command.run', { command: 'autocompact' }, async ($, e, next) => {
    const result = await next(e)
    await seed($)
    return result
  }).catch(($, e, next) => next(e))

  on('config.set', { key: 'autoCompact' }, async ($, e, next) => {
    const result = await next(e)
    await seed($)
    return result
  }).catch(($, e, next) => next(e))

  // The meter, then what is beneath it (the engine's mode labels, another plugin's switch).
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const current = await read($, reading)
    const point = await read($, compactAt)
    const beneath = await next(e)
    const { Box, Text } = $.ui.resolve(e)

    if (current === null || current.tokens === null) {
      return (
        <Box flexDirection="row">
          <Text dimColor>ctx –</Text>
          {beneath}
        </Box>
      )
    }

    const percent = Math.round((current.tokens / current.window) * 100)
    const level = levelFor(current.tokens, thresholdsFor(current.window, options))
    const marker = options.showMarker === false ? null : markerCell(point ?? undefined, current.window)
    const runs = barRuns(filledCells(current.tokens, current.window), marker)

    return (
      <Box flexDirection="row">
        <Text dimColor>ctx</Text>
        {runs.map((run, i) => {
          const cells = (i === 0 ? ' ' : '') + (run.isMarker ? '┃' : run.isFilled ? '━' : '─').repeat(run.cells)
          return run.isFilled ? <Text color={level}>{cells}</Text> : <Text dimColor>{cells}</Text>
        })}
        <Text>{` ${formatTokens(current.tokens)}/${formatTokens(current.window)} ${percent}%`}</Text>
        {beneath}
      </Box>
    )
  })
}
