import type { Level } from '../types'

/** Token counts at which the meter turns yellow and red. */
export type Thresholds = { warn: number; critical: number }

/** A token count as the meter writes it: `999`, `142k`, `1M`. */
export function formatTokens (tokens: number): string {
  if (tokens < 1_000) return String(tokens)
  const thousands = Math.round(tokens / 1_000)
  if (thousands < 1_000) return `${thousands}k`
  return `${Math.round(tokens / 100_000) / 10}M`
}

/** The color for a token count: `claude` is the normal one. */
export function levelFor (tokens: number, thresholds: Thresholds): Level {
  return tokens >= thresholds.critical ? 'error' : tokens >= thresholds.warn ? 'warning' : 'claude'
}
