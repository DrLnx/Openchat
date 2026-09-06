// Tier 1 — measuring and cutting text to a column budget.
//
// A full-screen interface is a grid: every pane owns a fixed number of columns
// and a fixed number of rows, and a line one character too long does not
// overflow gracefully, it wraps and pushes the row below it off the bottom of
// the screen. So nothing is handed to the renderer until it is known to fit,
// and the only way to know that is to measure it here.
//
// Width is measured in terminal cells rather than in code points, because the
// two are not the same number: a CJK ideograph and an emoji take two cells, a
// combining accent takes none, and a Nerd Font glyph takes two in every
// terminal that has the font and one in every terminal that does not — we
// assume two, since that is what the terminals people run this in do.

// eslint-disable-next-line no-misleading-character-class
const ZERO_WIDTH = /[\u0300-\u036f\u200b-\u200f\ufe00-\ufe0f\u{e0100}-\u{e01ef}]/u

/** How many terminal cells one code point occupies. */
function cellsOf (code) {
  if (code === 0x200d) return 0 // zero-width joiner
  if (
    (code >= 0x1100 && code <= 0x115f) || // hangul jamo
    (code >= 0x2e80 && code <= 0xa4cf) || // CJK radicals through Yi
    (code >= 0xac00 && code <= 0xd7a3) || // hangul syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK compatibility ideographs
    (code >= 0xfe30 && code <= 0xfe6f) || // CJK compatibility forms
    (code >= 0xff00 && code <= 0xff60) || // fullwidth forms
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0xe000 && code <= 0xf8ff) || // private use — Nerd Font glyphs
    (code >= 0x1f300 && code <= 0x1faff) || // emoji
    (code >= 0x20000 && code <= 0x3fffd)
  ) return 2
  return 1
}

/** Width of a string in terminal cells. */
export function width (text) {
  let total = 0
  for (const ch of String(text ?? '')) {
    if (ZERO_WIDTH.test(ch)) continue
    total += cellsOf(ch.codePointAt(0))
  }
  return total
}

/**
 * Cut a string to `columns` cells, marking the cut with an ellipsis.
 *
 * Cutting by cells rather than by characters is what stops a two-cell glyph
 * from being sliced in half — which does not render as half a glyph, it
 * renders as a broken row.
 */
export function truncate (text, columns, ellipsis = '…') {
  const source = String(text ?? '')
  if (columns <= 0) return ''
  if (width(source) <= columns) return source

  const mark = width(ellipsis)
  const budget = Math.max(0, columns - mark)

  let out = ''
  let used = 0
  for (const ch of source) {
    const cells = ZERO_WIDTH.test(ch) ? 0 : cellsOf(ch.codePointAt(0))
    if (used + cells > budget) break
    out += ch
    used += cells
  }
  return out + ellipsis
}

/** Pad a string out to `columns` cells. Never returns something wider. */
export function pad (text, columns) {
  const source = String(text ?? '')
  const short = columns - width(source)
  return short > 0 ? source + ' '.repeat(short) : source
}

/** Exactly `columns` cells: cut if long, padded if short. */
export function fit (text, columns, ellipsis = '…') {
  return pad(truncate(text, columns, ellipsis), columns)
}

/**
 * Wrap a paragraph to a column budget, breaking on spaces where it can and
 * mid-word where it cannot — a pasted 300-character URL still has to end up on
 * a row, and a row it does not fit on is a row that eats the next one.
 *
 * @param {string} text
 * @param {number} columns   width of the first line
 * @param {number} [rest]    width of every line after it, for a hanging indent
 * @returns {string[]}       never empty; a blank input wraps to ['']
 */
export function wrap (text, columns, rest = columns) {
  const source = String(text ?? '')
  const lines = []

  for (const raw of source.split('\n')) {
    // Trailing whitespace is never content, and on a line that ends near the
    // column budget it costs a whole extra row — a blank one, in the middle of
    // a message.
    //
    // Leading whitespace is the opposite: command output lines its columns up
    // with it, so it is held aside, kept out of the wrapping, and put back on
    // every line the paragraph wraps to.
    const indent = raw.match(/^[ \t]*/)[0]
    const paragraph = raw.slice(indent.length).replace(/\s+$/, '')
    const inset = width(indent)

    const first = lines.length
    const budget = () => Math.max(1, (lines.length === first ? columns : rest) - inset)
    let line = ''

    const push = () => {
      lines.push(indent + line)
      line = ''
    }

    for (const word of paragraph.split(' ')) {
      let piece = word

      // A word longer than the whole line is broken across as many lines as it
      // takes, rather than being allowed to overflow one.
      while (width(piece) > budget()) {
        if (line) push()
        const head = cut(piece, budget())
        lines.push(head)
        piece = piece.slice(head.length)
      }

      const separated = line ? `${line} ${piece}` : piece
      if (width(separated) > budget()) {
        push()
        line = piece
      } else {
        line = separated
      }
    }

    push()
  }

  return lines
}

/** The longest prefix of `text` that fits in `columns` cells. */
function cut (text, columns) {
  let out = ''
  let used = 0
  for (const ch of text) {
    const cells = ZERO_WIDTH.test(ch) ? 0 : cellsOf(ch.codePointAt(0))
    if (used + cells > columns) break
    out += ch
    used += cells
  }
  return out || text.slice(0, 1)
}
