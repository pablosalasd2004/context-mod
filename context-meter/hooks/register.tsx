import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Reading } from '../types'
import { CELLS, filledCells, formatTokens, levelFor, thresholdsFor } from './meter'

const reading = atom({ plugin: 'context-meter', key: 'reading' } as const, null as Reading | null)

/** Keeps a context figure from the engine for the footer. */
async function take ($: EngineInterface, context: { tokens?: number; window: number }) {
  await update($, reading, () => ({ tokens: context.tokens ?? null, window: context.window }))
}

/** Reads the context from the engine; where the engine cannot say, the meter keeps what it had. */
async function seed ($: EngineInterface) {
  try {
    const { context } = await $.session.usage()
    await take($, context)
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
    await take($, e.context)
    return next(e)
  })

  // The meter, then what is beneath it (the engine's mode labels, another plugin's switch).
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const current = await read($, reading)
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

    const filled = filledCells(current.tokens, current.window)
    const percent = Math.round((current.tokens / current.window) * 100)
    const level = levelFor(current.tokens, thresholdsFor(current.window, options))

    return (
      <Box flexDirection="row">
        <Text dimColor>ctx</Text>
        {filled > 0 ? <Text color={level}>{' ' + '━'.repeat(filled)}</Text> : null}
        {filled < CELLS ? <Text dimColor>{(filled > 0 ? '' : ' ') + '─'.repeat(CELLS - filled)}</Text> : null}
        <Text>{` ${formatTokens(current.tokens)}/${formatTokens(current.window)} ${percent}%`}</Text>
        {beneath}
      </Box>
    )
  })
}
