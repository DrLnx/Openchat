// Turns a frame of ANSI-coloured terminal output into HTML, so a screenshot of
// the real UI can be taken without a real terminal.
//
// Only what Ink actually emits is handled — SGR colour, bold, dim, inverse and
// reset. Cursor movement never appears in a frame captured from the harness,
// because the harness collects whole frames rather than a stream of updates.

const ESC = String.fromCharCode(27)
const SGR = new RegExp(`${ESC}\\[([0-9;]*)m`, 'g')

/** The 16 ANSI names, as the colours a modern terminal actually draws. */
const BASIC = [
  '#15161e', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#a9b1d6',
  '#414868', '#ff899d', '#c0e389', '#ffc777', '#8db0ff', '#d2a6ff', '#b4f9f8', '#c0caf5'
]

function xterm (n) {
  if (n < 16) return BASIC[n]
  if (n < 232) {
    const i = n - 16
    const level = (v) => [0, 95, 135, 175, 215, 255][v]
    return rgb(level(Math.floor(i / 36) % 6), level(Math.floor(i / 6) % 6), level(i % 6))
  }
  const grey = 8 + (n - 232) * 10
  return rgb(grey, grey, grey)
}

function rgb (r, g, b) {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`
}

const BLANK = { fg: null, bg: null, bold: false, dim: false, inverse: false }

/**
 * Apply one SGR parameter list to a style.
 *
 * @param {object} style
 * @param {number[]} codes
 */
function apply (style, codes) {
  let next = { ...style }

  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]

    if (code === 0) { next = { ...BLANK }; continue }
    if (code === 1) { next.bold = true; continue }
    if (code === 2) { next.dim = true; continue }
    if (code === 7) { next.inverse = true; continue }
    if (code === 22) { next.bold = false; next.dim = false; continue }
    if (code === 27) { next.inverse = false; continue }
    if (code === 39) { next.fg = null; continue }
    if (code === 49) { next.bg = null; continue }
    if (code >= 30 && code <= 37) { next.fg = BASIC[code - 30]; continue }
    if (code >= 90 && code <= 97) { next.fg = BASIC[code - 90 + 8]; continue }
    if (code >= 40 && code <= 47) { next.bg = BASIC[code - 40]; continue }
    if (code >= 100 && code <= 107) { next.bg = BASIC[code - 100 + 8]; continue }

    if (code === 38 || code === 48) {
      const target = code === 38 ? 'fg' : 'bg'
      if (codes[i + 1] === 2) {
        next[target] = rgb(codes[i + 2], codes[i + 3], codes[i + 4])
        i += 4
      } else if (codes[i + 1] === 5) {
        next[target] = xterm(codes[i + 2])
        i += 2
      }
    }
  }

  return next
}

function escapeHtml (text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function css (style, palette) {
  const fg = style.inverse ? (style.bg || palette.background) : style.fg
  const bg = style.inverse ? (style.fg || palette.foreground) : style.bg

  const rules = []
  if (fg) rules.push(`color:${fg}`)
  if (bg) rules.push(`background:${bg}`)
  if (style.bold) rules.push('font-weight:600')
  if (style.dim && !style.bold) rules.push('opacity:.72')
  return rules.join(';')
}

/**
 * One frame of terminal output as HTML spans, one `<div>` per row.
 *
 * @param {string} frame
 * @param {{ background?: string, foreground?: string }} [palette]
 */
export function ansiToHtml (frame, palette = {}) {
  const colours = {
    background: palette.background || '#1a1b26',
    foreground: palette.foreground || '#c0caf5'
  }

  return String(frame ?? '').split('\n').map((line) => {
    let style = { ...BLANK }
    let out = ''
    let at = 0

    SGR.lastIndex = 0
    let match
    while ((match = SGR.exec(line)) !== null) {
      const text = line.slice(at, match.index)
      if (text) out += span(text, style, colours)
      style = apply(style, match[1].split(';').map((n) => (n === '' ? 0 : Number(n))))
      at = SGR.lastIndex
    }

    const rest = line.slice(at)
    if (rest) out += span(rest, style, colours)

    // An empty row still has to be a row, or the frame loses its height.
    return `<div class="row">${out || '&nbsp;'}</div>`
  }).join('\n')
}

function span (text, style, colours) {
  const rules = css(style, colours)
  const body = escapeHtml(text)
  return rules ? `<span style="${rules}">${body}</span>` : `<span>${body}</span>`
}

/**
 * A complete, self-contained page showing one frame as a terminal window.
 *
 * @param {object} options
 * @param {string} options.frame     raw ANSI from the harness
 * @param {string} [options.title]   what the window's title bar says
 * @param {string} [options.caption] a line under the window
 */
export function terminalPage ({
  frame, title = 'openchat', caption = '', background = '#1a1b26', foreground = '#c0caf5',
  fontSize = 15, lineHeight = 1.32
}) {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #0c0d13; }
  .stage {
    width: max-content;
    padding: 44px 48px;
    background: radial-gradient(130% 120% at 18% -10%, #2b3049 0%, #14151d 58%, #0b0c11 100%);
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 16px;
    font-family: "JetBrains Mono", ui-monospace, monospace;
  }
  .window {
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid #262a3b;
    box-shadow: 0 28px 64px rgba(0,0,0,.55);
    background: ${background};
  }
  .chrome {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 14px;
    background: #191b26;
    border-bottom: 1px solid #24273a;
  }
  .dot { width: 10px; height: 10px; border-radius: 50%; }
  .chrome .title {
    margin-left: 10px;
    color: #6d7594;
    font-size: 12px;
    letter-spacing: .04em;
  }
  .screen {
    padding: 13px 15px 15px;
    color: ${foreground};
    font-size: ${fontSize}px;
    line-height: ${lineHeight};
    font-variant-ligatures: none;
    tab-size: 8;
  }
  /* The rows carry the pre, not the block: whitespace between the row
     elements would otherwise be laid out as rows and double the height. */
  .row { white-space: pre; min-height: 1em; }
  .caption {
    color: #7f88a8;
    font-size: 12.5px;
    letter-spacing: .02em;
    text-align: center;
  }
</style></head>
<body>
  <div class="stage">
    <div class="window">
      <div class="chrome">
        <span class="dot" style="background:#f7768e"></span>
        <span class="dot" style="background:#e0af68"></span>
        <span class="dot" style="background:#9ece6a"></span>
        <span class="title">${escapeHtml(title)}</span>
      </div>
      <div class="screen">${ansiToHtml(frame, { background, foreground })}</div>
    </div>
    ${caption ? `<div class="caption">${escapeHtml(caption)}</div>` : ''}
  </div>
</body></html>`
}
