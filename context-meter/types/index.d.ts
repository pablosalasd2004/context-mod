/** The meter's color, as the theme names it: normal, past the yellow threshold, past the red one. */
export type Level = 'claude' | 'warning' | 'error'

declare module 'claude-code' {
  interface PluginState {
    'context-meter': Record<string, never>
  }
}
