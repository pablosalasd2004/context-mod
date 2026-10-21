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

const DEFAULT_WARN_K = 500
const DEFAULT_CRITICAL_K = 700
// The window the thresholds are written for: where one does not fit the window, its share of this one is used.
const REFERENCE_WINDOW = 1_000_000

const isThousands = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 1

/**
 * The thresholds for a window, from the config's `warnTokensK` and `criticalTokensK`.
 * A value that is not a number of at least 1 takes its default; a red threshold at or below the
 * yellow one sends both to the defaults. Where the red threshold reaches the window, both keep
 * their share of the window instead, so the color can still change.
 */
export function thresholdsFor (window: number, options: Readonly<Record<string, unknown>>): Thresholds {
  const warnK = isThousands(options.warnTokensK) ? options.warnTokensK : DEFAULT_WARN_K
  const criticalK = isThousands(options.criticalTokensK) ? options.criticalTokensK : DEFAULT_CRITICAL_K
  const isOrdered = warnK < criticalK
  const warn = (isOrdered ? warnK : DEFAULT_WARN_K) * 1_000
  const critical = (isOrdered ? criticalK : DEFAULT_CRITICAL_K) * 1_000
  if (critical < window) return { warn, critical }
  return { warn: (warn * window) / REFERENCE_WINDOW, critical: (critical * window) / REFERENCE_WINDOW }
}

/** The color for a token count: `claude` is the normal one. */
export function levelFor (tokens: number, thresholds: Thresholds): Level {
  return tokens >= thresholds.critical ? 'error' : tokens >= thresholds.warn ? 'warning' : 'claude'
}
