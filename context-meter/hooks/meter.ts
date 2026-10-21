import type { RenderNode } from 'claude-code'

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

/** How many cells wide the bar is. */
export const CELLS = 10

/** How many cells of the bar the context fills. */
export function filledCells (tokens: number, window: number): number {
  if (!(window > 0)) return 0
  return Math.round(Math.min(Math.max(tokens / window, 0), 1) * CELLS)
}

/** The cell (1 to CELLS) where auto-compact will run, or null with auto-compact off. */
export function markerCell (threshold: number | undefined, window: number): number | null {
  if (threshold === undefined || !(window > 0)) return null
  return Math.min(Math.max(Math.round((threshold / window) * CELLS), 1), CELLS)
}

/** A stretch of the bar drawn alike: `isMarker` runs are the single cell auto-compact is marked in. */
export type BarRun = { cells: number; isFilled: boolean; isMarker: boolean }

/** The bar as runs of alike cells, left to right; `marker` is the 1-based cell to mark, or null. */
export function barRuns (filled: number, marker: number | null): BarRun[] {
  const runs: BarRun[] = []
  for (let cell = 1; cell <= CELLS; cell++) {
    const isFilled = cell <= filled
    const isMarker = cell === marker
    const last = runs.at(-1)
    if (last !== undefined && !isMarker && !last.isMarker && last.isFilled === isFilled) last.cells += 1
    else runs.push({ cells: 1, isFilled, isMarker })
  }
  return runs
}

// The terminal footer's row: two columns of padding at each end, the permission mode label at the left
// (20 columns for the longest) and at least two columns between that and what is drawn at the right.
const FOOTER_PADDING = 4
const FOOTER_GAP = 2
const MODE_LABEL = 20

/** Separates the meter from what is drawn after it. */
export const SEPARATOR = ' · '

// Kept free, when no other plugin is beneath, for one that may wrap the meter and draw after it.
export const AROUND = 1 + SEPARATOR.length

/** Whether `enabledPlugins` (settings.json's map of `name@marketplace`) has `name` on in some marketplace. */
export function isPluginEnabled (enabledPlugins: unknown, name: string): boolean {
  if (typeof enabledPlugins !== 'object' || enabledPlugins === null || Array.isArray(enabledPlugins)) return false
  return Object.entries(enabledPlugins).some(([id, isOn]) => isOn === true && id.startsWith(`${name}@`))
}

/** Columns a text takes on one row. */
export function widthOf (text: string): number {
  return [...text.replace(/[︎️]/g, '')].length
}

/**
 * Whether a drawing shows nothing: no text and no control. The engine's own node is no drawing of
 * its own here, it stands for the mode labels, which are told apart by the footer's `modes`.
 */
export function isBlank (node: RenderNode | undefined): boolean {
  if (node === undefined || node === null) return true
  if (typeof node === 'string') return node.trim() === ''
  if (node.type === 'engine') return true
  if (node.type !== 'Box' && node.type !== 'Text') return false
  return (node.children ?? []).every(isBlank)
}

/** Columns the text of a drawing takes on one row, not counting the engine's own node. */
export function treeWidth (node: RenderNode | undefined): number {
  if (node === undefined || node === null || (typeof node !== 'string' && node.type === 'engine')) return 0
  if (typeof node === 'string') return widthOf(node)
  return (node.children ?? []).reduce((sum, child) => sum + treeWidth(child), 0)
}

/** Whether a drawing holds another plugin's: the engine marks the root of each hook's tree with its plugin. */
export function holdsPlugin (node: RenderNode | undefined): boolean {
  if (node === undefined || node === null || typeof node === 'string' || node.type === 'engine') return false
  return 'part' in node || (node.children ?? []).some(holdsPlugin)
}

/**
 * Columns the footer leaves at its right end, beside the mode label and the hint after it: all of
 * them off the terminal or where no width was measured.
 */
export function roomOf (surface: string, columns: number | undefined, hintWidth: number): number {
  if (surface !== 'terminal' || columns === undefined) return Infinity
  return columns - FOOTER_PADDING - FOOTER_GAP - MODE_LABEL - (hintWidth > 0 ? 1 + hintWidth : 0)
}

/** What the meter still draws: the bar, the window beside the tokens, the percent. */
export type Detail = { hasBar: boolean; hasWindow: boolean; hasPercent: boolean }

/** The most the meter can draw in `room` columns, or null when not even the tokens fit. */
export function detailFor (room: number, words: { tokens: string; window: string; percent: string }): Detail | null {
  const label = 'ctx'.length
  const tokens = 1 + words.tokens.length
  const window = 1 + words.window.length
  const percent = 1 + words.percent.length
  const fit = [
    { hasBar: true, hasWindow: true, hasPercent: true, width: label + 1 + CELLS + tokens + window + percent },
    { hasBar: false, hasWindow: true, hasPercent: true, width: label + tokens + window + percent },
    { hasBar: false, hasWindow: false, hasPercent: true, width: label + tokens + percent },
    { hasBar: false, hasWindow: false, hasPercent: false, width: label + tokens }
  ].find(({ width }) => width <= room)
  return fit === undefined ? null : { hasBar: fit.hasBar, hasWindow: fit.hasWindow, hasPercent: fit.hasPercent }
}

/** The color for a token count: `claude` is the normal one. */
export function levelFor (tokens: number, thresholds: Thresholds): Level {
  return tokens >= thresholds.critical ? 'error' : tokens >= thresholds.warn ? 'warning' : 'claude'
}
