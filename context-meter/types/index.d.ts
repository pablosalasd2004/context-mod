/** The meter's color, as the theme names it: normal, past the yellow threshold, past the red one. */
export type Level = 'claude' | 'warning' | 'error'

/** The last context figure: input tokens of the last response (null until one reports) against the window. */
export type Reading = { tokens: number | null; window: number }

declare module 'claude-code' {
  interface PluginState {
    'context-meter': {
      reading: Reading | null
      /** Tokens at which auto-compact runs; null when it is off or not known yet. */
      compactAt: number | null
      /** The figure the engine keeps reporting after a compaction, until a response reports a new one. */
      stale: number | null
    }
  }
}
