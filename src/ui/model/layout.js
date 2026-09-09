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

/**
 * Rows a float's own chrome takes: border, prompt, rule, border.
 *
 * The key hints along the bottom are set *into* the closing border rather than
 * drawn on a row of their own. They are a legend, not content — giving them a
 * full row costs the list an item on every float in the app, and a legend is
 * exactly the kind of thing a border is for.
 */
export const CHROME_ROWS = 4

/** The chrome plus one row of content — the smallest a float can be drawn. */
export const MIN_FLOAT_ROWS = CHROME_ROWS + 1

/** Below this many columns the conversation list costs more than it gives. */
export const SIDEBAR_MIN_COLUMNS = 64

/** A frame's own chrome when it has no header: the two borders. */
export const FRAME_ROWS = 2

/** Narrow enough for one key and its label, and no narrower. */
export const MIN_MENU_COLUMNS = 24

/**
 * The whole screen, pane by pane.
 *
 * Nothing here depends on what is open. Every window in openchat is laid over
 * the frame rather than wedged into it, so the title bar, the conversation, the
 * prompt and the statusline are in the same place whatever is on screen.
 *
 * @param {{ rows: number, columns: number }} terminal
 * @param {object} [options]
 * @param {boolean} [options.sidebar]   false hides the conversation list
 */
export function screenLayout ({ rows = 24, columns = 80 } = {}, options = {}) {
  const { sidebar = true } = options

  const height = Math.max(8, rows - RESERVED_ROWS)
  const chrome = HEADER_ROWS + INPUT_ROWS + STATUS_ROWS

  const bodyRows = Math.max(1, height - chrome)

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
    inputTop: 1 + HEADER_ROWS + bodyRows,
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
 * It is centred over the *chat pane*, not the terminal: the conversation list is
 * the one thing you might want to keep reading while a window is open, and a
 * window is composited by row, so anything that reaches into the sidebar's
 * columns blanks it out.
 *
 * @param {object} screen  from screenLayout
 * @param {object} [options]
 * @param {number} [options.items]     how many rows the list would like
 * @param {number} [options.maxRows]   cap on the whole float
 * @param {number} [options.minRows]
 * @param {number} [options.width]     preferred width in columns
 */
export function floatLayout (screen, options = {}) {
  const { items = 10, maxRows = 20, minRows = 7, width: preferred } = options

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

  // The chat pane keeps a column of padding on its left, so a window drawn
  // inside it is offset from there rather than from the edge of the screen.
  const room = Math.max(MIN_MENU_COLUMNS, screen.chatWidth - 1)
  const width = Math.max(20, Math.min(preferred ?? 78, room))
  const column = Math.max(0, Math.floor((room - width) / 2))

  const top = screen.bodyTop + Math.max(0, Math.floor((screen.bodyRows - height) / 2))

  return {
    height,
    width,
    /** 1-based screen row of the float's top border. */
    top,
    /** 1-based screen row of the first list item. */
    listTop: top + 3,
    /** How many items fit. */
    listRows: Math.max(1, height - CHROME_ROWS),
    /** Blank columns to its left inside the chat pane, which is where it draws. */
    column,
    /** 1-based column of its left edge on the screen, which is what a click has. */
    left: screen.chatLeft + 1 + column,
    /** Rows of the body above and below it, which stay on screen behind it. */
    above: Math.max(0, top - screen.bodyTop),
    below: Math.max(0, screen.bodyRows - (top - screen.bodyTop) - height)
  }
}

/**
 * A window at the top of the body, centred, laid over it.
 *
 * The key menu and the command line live here, and where "here" is took three
 * tries to get right. Painted across the middle of the transcript, it covered
 * the conversation. Given rows of its own with the transcript redrawn shorter,
 * it covered nothing and still shunted everything you were reading upward every
 * time you reached for a key. Laid over the *bottom* of the body it moved
 * nothing but sat on the newest messages — the ones you actually care about.
 *
 * The transcript is anchored to the bottom of its pane, so the top of that pane
 * is empty in every conversation short of a full screen. That is where a window
 * belongs: it moves nothing, and in the ordinary case it covers nothing either,
 * because there is nothing there to cover.
 *
 * It is centred over the *chat pane* rather than over the terminal: the
 * conversation list is the one thing on this screen you might want to read
 * while a menu is open, and it costs nothing to leave it alone.
 *
 * @param {object} screen  from screenLayout
 * @param {object} options
 * @param {number} options.rows    content rows the window would like
 * @param {number} options.width   preferred width in columns
 */
export function popupLayout (screen, { rows = 1, width = 40 } = {}) {
  const height = Math.max(FRAME_ROWS + 1, Math.min(rows + FRAME_ROWS, screen.bodyRows))
  const room = Math.max(MIN_MENU_COLUMNS, screen.chatWidth - 1)
  const outer = Math.max(MIN_MENU_COLUMNS, Math.min(width, room))
  const column = Math.max(0, Math.floor((room - outer) / 2))

  return {
    width: outer,
    /** Columns inside the borders and their one-column padding. */
    inner: outer - 4,
    /** Content rows there is actually room for, which may be fewer than asked. */
    rows: height - FRAME_ROWS,
    height,
    /** Blank columns to its left inside the chat pane, which is where it draws. */
    column,
    /** 1-based column of its left edge on the screen, which is what a click has. */
    left: screen.chatLeft + 1 + column,
    /** 1-based screen row of the window's top border. */
    top: screen.bodyTop,
    /** Rows of the conversation above it — none; it is against the top. */
    above: 0,
    below: Math.max(0, screen.bodyRows - height)
  }
}

/**
 * A window in the bottom-right corner of the body, standing on the prompt.
 *
 * This is where the key menu goes, and it is where LazyVim's which-key goes:
 * the corner nearest the keys, so a chord you are halfway through resolves
 * itself where your eye already is rather than at the far end of the screen.
 *
 * The transcript is anchored to the bottom of its pane, though, so the bottom
 * of the body is the one part of it that is never empty — a window laid over it
 * the way `floatLayout` and `popupLayout` lay one over rows would sit on the
 * newest messages, which are the ones you are reading. So this window does not
 * replace the rows it covers. It stands *beside* them: `beside` tells Float to
 * keep each covered chat row in the columns to the left of the frame and clip
 * it there, rather than throwing the row away. A conversation is left-aligned
 * text in a wide pane, so in the ordinary case nothing is lost at all, and in
 * the worst case a long line is cut where the frame starts instead of the whole
 * line going dark.
 *
 * `column` is therefore both the frame's offset inside the chat pane and the
 * width of the strip of conversation still showing to its left.
 *
 * @param {object} screen  from screenLayout
 * @param {object} options
 * @param {number} options.rows    content rows the window would like
 * @param {number} options.width   preferred width in columns
 */
export function cornerLayout (screen, { rows = 1, width = 40 } = {}) {
  const height = Math.max(FRAME_ROWS + 1, Math.min(rows + FRAME_ROWS, screen.bodyRows))
  const room = Math.max(MIN_MENU_COLUMNS, screen.chatWidth - 1)
  const outer = Math.max(MIN_MENU_COLUMNS, Math.min(width, room))

  // Against the right edge of the chat pane, and everything left of it is
  // conversation that stays on screen.
  const column = Math.max(0, room - outer)
  const above = Math.max(0, screen.bodyRows - height)

  return {
    width: outer,
    /** Columns inside the borders and their one-column padding. */
    inner: outer - 4,
    /** Content rows there is actually room for, which may be fewer than asked. */
    rows: height - FRAME_ROWS,
    height,
    /** Blank columns to its left inside the chat pane, which is where it draws. */
    column,
    /** 1-based column of its left edge on the screen, which is what a click has. */
    left: screen.chatLeft + 1 + column,
    /** 1-based screen row of the window's top border. */
    top: screen.bodyTop + above,
    /** Rows of the conversation above it, drawn in full. */
    above,
    /** Rows below it — none; it stands on the prompt. */
    below: 0,
    /** The rows it covers keep their conversation to its left. See Float.jsx. */
    beside: true
  }
}

/**
 * How to pack `count` entries into columns that fit.
 *
 * Grows downwards first and sideways only when the list would get too tall, so
 * a handful of keys is one narrow column tucked against the prompt rather than
 * a band across the whole screen.
 */
export function gridFor (count, { width, columnWidth, preferredRows = 6 }) {
  const total = Math.max(1, count)
  const fits = Math.max(1, Math.floor((width - 4) / columnWidth))
  const columns = Math.max(1, Math.min(fits, Math.ceil(total / preferredRows)))

  return { columns, rows: Math.ceil(total / columns), width: columns * columnWidth + 4 }
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
