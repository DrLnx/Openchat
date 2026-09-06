// Tier 1 — where everything sits on the screen.
//
// openchat paints the whole terminal: a title bar, a conversation list, the
// chat, the prompt, a statusline. Nothing here is laid out by a flexbox pass —
// every pane's rows and columns are decided by this file, and both the
// renderer and the mouse hit test read from the same numbers.
//
// That is not fussiness. A terminal reports a click as an absolute row and
// column, and the only way to turn that back into "the fourth item in the
// list" is for the code that drew the list and the code that receives the
// click to agree on where it was drawn, exactly, to the row. A layout pass you
// cannot ask questions of cannot give you that.
//
// Coordinates are 1-based, the way the terminal itself reports them.

/** The title bar across the top. */
export const HEADER_ROWS = 1

/** The prompt: a bordered box, so three rows. */
export const INPUT_ROWS = 3

/** The statusline along the bottom. */
export const STATUS_ROWS = 1

// Ink writes a newline after the last row of a frame. On a screen painted to
// its full height that newline is what scrolls the top row away, so the app is
// drawn one row short and the terminal's last row belongs to the newline.
export const RESERVED_ROWS = 1

/** Rows a float's own chrome takes: border, prompt, rule, footer, border. */
export const CHROME_ROWS = 5

/** The chrome plus one row of content — the smallest a float can be drawn. */
export const MIN_FLOAT_ROWS = CHROME_ROWS + 1

/** Below this many columns the conversation list costs more than it gives. */
export const SIDEBAR_MIN_COLUMNS = 64

/**
 * The whole screen, pane by pane.
 *
 * @param {{ rows: number, columns: number }} terminal
 * @param {object} [options]
 * @param {boolean} [options.sidebar]   false hides the conversation list
 * @param {number} [options.reserve]    extra rows the prompt needs this frame,
 *                                      for the command menu and which-key
 */
export function screenLayout ({ rows = 24, columns = 80 } = {}, options = {}) {
  const { sidebar = true, reserve = 0 } = options

  const height = Math.max(8, rows - RESERVED_ROWS)
  const chrome = HEADER_ROWS + INPUT_ROWS + STATUS_ROWS

  // The prompt's extras eat into the chat, never into the prompt: a command
  // menu that pushes the thing you are typing off the bottom of the screen is
  // worse than a short chat pane.
  const bodyRows = Math.max(1, height - chrome - Math.max(0, reserve))

  const withSidebar = sidebar && columns >= SIDEBAR_MIN_COLUMNS
  // Wide enough for `❯ #a-room-name  12`, and never more than a fifth of a
  // wide terminal — past that it is a list you look at twice an hour taking
  // space from the thing you are actually reading.
  const sidebarWidth = withSidebar
    ? Math.max(18, Math.min(26, Math.floor(columns * 0.2)))
    : 0

  return {
    rows,
    columns,
    height,
    /** 1-based row of the title bar. */
    headerTop: 1,
    /** 1-based row of the first body row. */
    bodyTop: 1 + HEADER_ROWS,
    bodyRows,
    sidebar: withSidebar,
    sidebarWidth,
    /** 1-based column of the first chat column. */
    chatLeft: withSidebar ? sidebarWidth + 2 : 1,
    chatWidth: Math.max(20, columns - (withSidebar ? sidebarWidth + 1 : 0)),
    /** 1-based row of the prompt's top border. */
    inputTop: 1 + HEADER_ROWS + bodyRows + Math.max(0, reserve),
    /** 1-based row of the statusline. */
    statusTop: height
  }
}

/**
 * Where a floating window goes: centred over the body, never over the prompt.
 *
 * Every float — the finders, settings, accounts, help — is placed by this one
 * function, so they all land in the same place and a click lands where the eye
 * expects it to.
 *
 * @param {object} terminal  { rows, columns }
 * @param {object} [options]
 * @param {number} [options.items]     how many rows the list would like
 * @param {number} [options.maxRows]   cap on the whole float
 * @param {number} [options.minRows]
 * @param {number} [options.width]     preferred width in columns
 */
export function floatLayout (terminal = {}, options = {}) {
  const { items = 10, maxRows = 20, minRows = 7, width: preferred } = options
  const screen = screenLayout(terminal)

  // A float takes the rows it asked for, up to the whole body — and never one
  // more. It may cover the conversation; it may never cover the title bar or
  // the prompt, because a float one row taller than the body it sits in pushes
  // the prompt off the bottom of the screen.
  //
  // On anything but a short terminal the float asks for less than the body has,
  // and the strip of conversation left above and below it is what makes it read
  // as a window laid over the app rather than as a different screen.
  const wanted = Math.max(minRows, Math.min(maxRows, items + CHROME_ROWS))
  const height = Math.max(MIN_FLOAT_ROWS, Math.min(wanted, screen.bodyRows))

  const width = Math.max(30, Math.min(preferred ?? 78, screen.columns - 4))

  const top = screen.bodyTop + Math.max(0, Math.floor((screen.bodyRows - height) / 2))
  const left = Math.max(1, 1 + Math.floor((screen.columns - width) / 2))

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
    left,
    /** Rows of the body above and below it, which stay on screen behind it. */
    above: Math.max(0, top - screen.bodyTop),
    below: Math.max(0, screen.bodyRows - (top - screen.bodyTop) - height)
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
 * Which conversation a click in the sidebar landed on, or null when it missed.
 *
 * @param {object} screen   from screenLayout
 * @param {{ x: number, y: number }} point
 * @param {number} count    how many rows the sidebar drew
 */
export function hitSidebar (screen, point, count) {
  if (!screen.sidebar) return null
  if (point.x < 1 || point.x > screen.sidebarWidth) return null
  const row = point.y - screen.bodyTop
  if (row < 0 || row >= Math.min(count, screen.bodyRows)) return null
  return row
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
