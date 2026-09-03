// Tier 1 — where a floating window sits on the screen.
//
// The terminal reports a click as an absolute row and column, and a float has
// to turn that back into "the fourth item in the list". Nothing in a terminal
// UI toolkit hands you a component's screen position, so this computes it, and
// both the renderer and the hit test read from the same function — the only way
// a click and the row it lands on can be guaranteed to agree.
//
// Everything is measured up from the bottom of the screen, because that is
// where the live part of the interface is anchored: the transcript above it is
// the terminal's own scrollback, of unknown and irrelevant height.

/** Rows the float's own chrome takes: border, prompt, rule, footer, border. */
export const CHROME_ROWS = 5

/** The prompt box (3) and the statusline (1) sit below every float. */
export const BELOW_ROWS = 4

/**
 * @param {object} terminal  { rows, columns }
 * @param {object} [options]
 * @param {number} [options.items]     how many rows the list would like
 * @param {number} [options.maxRows]   cap on the whole float
 * @param {number} [options.minRows]
 * @param {number} [options.width]     preferred width in columns
 */
export function floatLayout ({ rows = 24, columns = 80 } = {}, options = {}) {
  const { items = 10, maxRows = 20, minRows = 7, width: preferred } = options

  // Never take the whole screen: a float you cannot see past is a modal, and
  // the point of this one is that the conversation stays visible behind it.
  const ceiling = Math.max(minRows, Math.min(maxRows, rows - BELOW_ROWS - 2))
  const wanted = items + CHROME_ROWS
  const height = Math.max(minRows, Math.min(ceiling, wanted))

  const width = Math.max(30, Math.min(preferred ?? 78, columns - 4))

  const top = Math.max(1, rows - height - BELOW_ROWS + 1)

  return {
    height,
    width,
    /** 1-based screen row of the float's top border. */
    top,
    /** 1-based screen row of the first list item. */
    listTop: top + 3,
    /** How many items fit. */
    listRows: Math.max(1, height - CHROME_ROWS),
    /** 1-based column of the float's left edge. */
    left: 2
  }
}

/**
 * Which list index a click landed on, or null when it missed.
 *
 * @param {object} layout   from floatLayout
 * @param {{ x: number, y: number }} point  1-based screen coordinates
 * @param {number} offset   index of the first visible item
 * @param {number} count    how many items there are in total
 */
export function hitTest (layout, point, offset, count) {
  const row = point.y - layout.listTop
  if (row < 0 || row >= layout.listRows) return null
  const index = offset + row
  if (index < 0 || index >= count) return null
  if (point.x < layout.left || point.x > layout.left + layout.width) return null
  return index
}

/**
 * Keep the selected item on screen, scrolling by as little as possible — the
 * same rule an editor's scrolloff uses.
 *
 * @returns {number} the new index of the first visible item
 */
export function scrollTo (offset, selected, visible, count) {
  const max = Math.max(0, count - visible)
  let next = Math.min(offset, max)
  if (selected < next) next = selected
  if (selected >= next + visible) next = selected - visible + 1
  return Math.max(0, Math.min(next, max))
}
