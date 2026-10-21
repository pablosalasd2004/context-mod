// Pure rules of the meter, run with `claude plugin test ./context-meter`.
import { expect, test } from 'claude-code/testing'

import { formatTokens, levelFor, thresholdsFor } from './meter'

test('a count under a thousand is shown whole', () => {
  const cases: [number, string][] = [
    [0, '0'],
    [7, '7'],
    [999, '999']
  ]
  for (const [tokens, label] of cases) expect(formatTokens(tokens), `${tokens} tokens`).toBe(label)
})

test('thousands are rounded to the nearest k', () => {
  const cases: [number, string][] = [
    [1_000, '1k'],
    [1_499, '1k'],
    [1_500, '2k'],
    [142_000, '142k'],
    [967_000, '967k'],
    [999_499, '999k']
  ]
  for (const [tokens, label] of cases) expect(formatTokens(tokens), `${tokens} tokens`).toBe(label)
})

test('millions keep one decimal at most, and 1M starts where 999k would round up to 1000k', () => {
  const cases: [number, string][] = [
    [999_500, '1M'],
    [1_000_000, '1M'],
    [1_240_000, '1.2M'],
    [1_250_000, '1.3M'],
    [2_000_000, '2M']
  ]
  for (const [tokens, label] of cases) expect(formatTokens(tokens), `${tokens} tokens`).toBe(label)
})

test('the color changes exactly at the yellow and red thresholds', () => {
  const thresholds = { warn: 500_000, critical: 700_000 }
  const cases: [number, string][] = [
    [0, 'claude'],
    [499_999, 'claude'],
    [500_000, 'warning'],
    [699_999, 'warning'],
    [700_000, 'error'],
    [1_000_000, 'error']
  ]
  for (const [tokens, level] of cases) expect(levelFor(tokens, thresholds), `${tokens} tokens`).toBe(level)
})

test('the thresholds default to 500k and 700k', () => {
  expect(thresholdsFor(1_000_000, {})).toEqual({ warn: 500_000, critical: 700_000 })
})

test('the thresholds come from the config, in thousands of tokens', () => {
  expect(thresholdsFor(1_000_000, { warnTokensK: 300, criticalTokensK: 450 })).toEqual({ warn: 300_000, critical: 450_000 })
})

test('a value that is not a number of at least 1 falls back to its default', () => {
  const cases: [Record<string, unknown>, { warn: number; critical: number }][] = [
    [{ warnTokensK: 0, criticalTokensK: 800 }, { warn: 500_000, critical: 800_000 }],
    [{ warnTokensK: 0.5, criticalTokensK: 800 }, { warn: 500_000, critical: 800_000 }],
    [{ warnTokensK: -5, criticalTokensK: 'x' }, { warn: 500_000, critical: 700_000 }],
    [{ warnTokensK: '300', criticalTokensK: 450 }, { warn: 500_000, critical: 700_000 }],
    [{ warnTokensK: 300, criticalTokensK: Infinity }, { warn: 300_000, critical: 700_000 }],
    [{ warnTokensK: Number.NaN }, { warn: 500_000, critical: 700_000 }]
  ]
  for (const [options, want] of cases) expect(thresholdsFor(1_000_000, options), JSON.stringify(options)).toEqual(want)
})

test('a red threshold at or below the yellow one sends both back to the defaults', () => {
  expect(thresholdsFor(1_000_000, { warnTokensK: 800, criticalTokensK: 700 })).toEqual({ warn: 500_000, critical: 700_000 })
  expect(thresholdsFor(1_000_000, { warnTokensK: 600, criticalTokensK: 600 })).toEqual({ warn: 500_000, critical: 700_000 })
})

test('on a 200k window the defaults keep their share of it, so the color can still change', () => {
  const thresholds = thresholdsFor(200_000, {})
  const cases: [number, string][] = [
    [99_999, 'claude'],
    [100_000, 'warning'],
    [139_999, 'warning'],
    [140_000, 'error']
  ]
  for (const [tokens, level] of cases) expect(levelFor(tokens, thresholds), `${tokens} tokens`).toBe(level)
})

test('thresholds below the window are kept as they are', () => {
  expect(thresholdsFor(200_000, { warnTokensK: 150, criticalTokensK: 180 })).toEqual({ warn: 150_000, critical: 180_000 })
})

test('when the red threshold reaches the window both keep their share of it, in order', () => {
  expect(thresholdsFor(200_000, { warnTokensK: 150, criticalTokensK: 250 })).toEqual({ warn: 30_000, critical: 50_000 })
  expect(thresholdsFor(200_000, { warnTokensK: 100, criticalTokensK: 200 })).toEqual({ warn: 20_000, critical: 40_000 })
})
