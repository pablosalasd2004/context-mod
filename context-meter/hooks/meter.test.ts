// Pure rules of the meter, run with `claude plugin test ./context-meter`.
import { expect, test } from 'claude-code/testing'

import { formatTokens } from './meter'

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
