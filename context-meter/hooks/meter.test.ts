// Pure rules of the meter, run with `claude plugin test ./context-meter`.
import { expect, test } from 'claude-code/testing'

import { barRuns, detailFor, filledCells, formatTokens, isPluginEnabled, levelFor, markerCell, thresholdsFor, widthOf } from './meter'

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

test('the bar fills in proportion to the window, ten cells wide', () => {
  const cases: [number, number, number][] = [
    [0, 1_000_000, 0],
    [49_999, 1_000_000, 0],
    [50_000, 1_000_000, 1],
    [142_000, 1_000_000, 1],
    [500_000, 1_000_000, 5],
    [967_000, 1_000_000, 10],
    [100_000, 200_000, 5]
  ]
  for (const [tokens, window, cells] of cases) expect(filledCells(tokens, window), `${tokens} of ${window}`).toBe(cells)
})

test('the bar never overflows or goes negative, and an empty window draws nothing', () => {
  expect(filledCells(1_200_000, 1_000_000)).toBe(10)
  expect(filledCells(-5, 1_000_000)).toBe(0)
  expect(filledCells(100, 0)).toBe(0)
})

test('the auto-compact marker sits in the cell of its share of the window', () => {
  const cases: [number, number, number][] = [
    [967_000, 1_000_000, 10],
    [267_000, 1_000_000, 3],
    [100_000, 1_000_000, 1],
    [167_000, 200_000, 8]
  ]
  for (const [threshold, window, cell] of cases) expect(markerCell(threshold, window), `${threshold} of ${window}`).toBe(cell)
})

test('the auto-compact marker stays inside the bar', () => {
  expect(markerCell(40_000, 1_000_000)).toBe(1)
  expect(markerCell(1_200_000, 1_000_000)).toBe(10)
})

test('there is no marker when auto-compact is off or the window is unknown', () => {
  expect(markerCell(undefined, 1_000_000)).toBeNull()
  expect(markerCell(967_000, 0)).toBeNull()
})

test('where the row is short the meter gives up its bar, then the window, then the percent, then itself', () => {
  // `ctx ━━━━━━━━━━ 142k/1M 14%` is 26 columns; without the bar 15; without the window 12; without the percent 8.
  const words = { tokens: '142k', window: '1M', percent: '14%' }
  const full = { hasBar: true, hasWindow: true, hasPercent: true }
  const cases: [number, object | null][] = [
    [Infinity, full],
    [26, full],
    [25, { hasBar: false, hasWindow: true, hasPercent: true }],
    [15, { hasBar: false, hasWindow: true, hasPercent: true }],
    [14, { hasBar: false, hasWindow: false, hasPercent: true }],
    [12, { hasBar: false, hasWindow: false, hasPercent: true }],
    [11, { hasBar: false, hasWindow: false, hasPercent: false }],
    [8, { hasBar: false, hasWindow: false, hasPercent: false }],
    [7, null]
  ]
  for (const [room, detail] of cases) expect(detailFor(room, words), `room ${room}`).toEqual(detail)
})

test('a plugin is enabled when some marketplace lists it as true', () => {
  expect(isPluginEnabled({ 'sub-meter@better-claude': true }, 'sub-meter')).toBe(true)
  expect(isPluginEnabled({ 'other@x': true, 'sub-meter@mine': true }, 'sub-meter')).toBe(true)
  expect(isPluginEnabled({ 'sub-meter@a': false, 'sub-meter@b': true }, 'sub-meter')).toBe(true)
})

test('a plugin that is switched off, absent or only named alike is not enabled', () => {
  expect(isPluginEnabled({ 'sub-meter@better-claude': false }, 'sub-meter')).toBe(false)
  expect(isPluginEnabled({ 'sub-meter-extra@x': true }, 'sub-meter')).toBe(false)
  expect(isPluginEnabled({ 'other@sub-meter': true }, 'sub-meter')).toBe(false)
  expect(isPluginEnabled({ 'sub-meter@x': 'true' }, 'sub-meter')).toBe(false)
  expect(isPluginEnabled({}, 'sub-meter')).toBe(false)
})

test('settings that are not a map of plugins enable nothing', () => {
  for (const settings of [undefined, null, 'sub-meter@x', 7, true, ['sub-meter@x']]) {
    expect(isPluginEnabled(settings, 'sub-meter'), JSON.stringify(settings)).toBe(false)
  }
})

test('a text takes a column per character, and a variation selector none', () => {
  expect(widthOf('')).toBe(0)
  expect(widthOf('? for shortcuts')).toBe(15)
  expect(widthOf('⏵⏵ accept edits on')).toBe(18)
  expect(widthOf('▶︎▶️')).toBe(2)
})

test('longer figures take more room', () => {
  // `ctx ━━━━━━━━━━ 1.3M/2M 100%` is one column wider than the one above: 27.
  const words = { tokens: '1.3M', window: '2M', percent: '100%' }
  expect(detailFor(27, words)).toEqual({ hasBar: true, hasWindow: true, hasPercent: true })
  expect(detailFor(26, words)).toEqual({ hasBar: false, hasWindow: true, hasPercent: true })
})

test('the bar is split into runs of filled, empty and marker cells', () => {
  const fill = (cells: number) => ({ cells, isFilled: true, isMarker: false })
  const empty = (cells: number) => ({ cells, isFilled: false, isMarker: false })
  expect(barRuns(0, null)).toEqual([empty(10)])
  expect(barRuns(10, null)).toEqual([fill(10)])
  expect(barRuns(4, null)).toEqual([fill(4), empty(6)])
  expect(barRuns(1, 10)).toEqual([fill(1), empty(8), { cells: 1, isFilled: false, isMarker: true }])
  expect(barRuns(6, 3)).toEqual([fill(2), { cells: 1, isFilled: true, isMarker: true }, fill(3), empty(4)])
  expect(barRuns(10, 10)).toEqual([fill(9), { cells: 1, isFilled: true, isMarker: true }])
  expect(barRuns(0, 1)).toEqual([{ cells: 1, isFilled: false, isMarker: true }, empty(9)])
})
