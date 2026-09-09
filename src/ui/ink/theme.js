// The palette, the glyphs, and the one place that decides what anything on
// screen is coloured.
//
// The defaults are Tokyo Night, which is what LazyVim ships with, because the
// point of this interface is that it does not feel like a different world from
// the editor next to it. Every palette here is a real, tested terminal theme
// rather than an invention, so a user who already runs one of them gets a chat
// client that matches their terminal instead of fighting it.

const PALETTES = {
  'tokyonight-storm': {
    on: '#1a1b26',
    fg: '#c0caf5',
    dim: '#565f89',
    subtle: '#414868',
    accent: '#7aa2f7',
    accent2: '#bb9af7',
    border: '#3b4261',
    borderFocus: '#7aa2f7',
    float: '#24283b',
    selection: '#364a82',
    red: '#f7768e',
    orange: '#ff9e64',
    yellow: '#e0af68',
    green: '#9ece6a',
    teal: '#1abc9c',
    cyan: '#7dcfff',
    blue: '#7aa2f7',
    magenta: '#bb9af7'
  },
  'tokyonight-night': {
    on: '#1a1b26',
    fg: '#c0caf5',
    dim: '#545c7e',
    subtle: '#3b4261',
    accent: '#7aa2f7',
    accent2: '#bb9af7',
    border: '#292e42',
    borderFocus: '#7aa2f7',
    float: '#1f2335',
    selection: '#283457',
    red: '#f7768e',
    orange: '#ff9e64',
    yellow: '#e0af68',
    green: '#9ece6a',
    teal: '#1abc9c',
    cyan: '#7dcfff',
    blue: '#7aa2f7',
    magenta: '#bb9af7'
  },
  'catppuccin-mocha': {
    on: '#11111b',
    fg: '#cdd6f4',
    dim: '#6c7086',
    subtle: '#45475a',
    accent: '#89b4fa',
    accent2: '#cba6f7',
    border: '#45475a',
    borderFocus: '#89b4fa',
    float: '#1e1e2e',
    selection: '#313244',
    red: '#f38ba8',
    orange: '#fab387',
    yellow: '#f9e2af',
    green: '#a6e3a1',
    teal: '#94e2d5',
    cyan: '#89dceb',
    blue: '#89b4fa',
    magenta: '#cba6f7'
  },
  'gruvbox-dark': {
    on: '#282828',
    fg: '#ebdbb2',
    dim: '#928374',
    subtle: '#504945',
    accent: '#fabd2f',
    accent2: '#d3869b',
    border: '#504945',
    borderFocus: '#fabd2f',
    float: '#32302f',
    selection: '#45403d',
    red: '#fb4934',
    orange: '#fe8019',
    yellow: '#fabd2f',
    green: '#b8bb26',
    teal: '#8ec07c',
    cyan: '#8ec07c',
    blue: '#83a598',
    magenta: '#d3869b'
  },
  'rose-pine': {
    on: '#191724',
    fg: '#e0def4',
    dim: '#6e6a86',
    subtle: '#524f67',
    accent: '#c4a7e7',
    accent2: '#ebbcba',
    border: '#403d52',
    borderFocus: '#c4a7e7',
    float: '#1f1d2e',
    selection: '#312f44',
    red: '#eb6f92',
    orange: '#ebbcba',
    yellow: '#f6c177',
    green: '#31748f',
    teal: '#9ccfd8',
    cyan: '#9ccfd8',
    blue: '#31748f',
    magenta: '#c4a7e7'
  },
  nord: {
    on: '#2e3440',
    fg: '#e5e9f0',
    dim: '#7b88a1',
    subtle: '#4c566a',
    accent: '#88c0d0',
    accent2: '#b48ead',
    border: '#434c5e',
    borderFocus: '#88c0d0',
    float: '#3b4252',
    selection: '#434c5e',
    red: '#bf616a',
    orange: '#d08770',
    yellow: '#ebcb8b',
    green: '#a3be8c',
    teal: '#8fbcbb',
    cyan: '#88c0d0',
    blue: '#81a1c1',
    magenta: '#b48ead'
  },
  // The one light palette. A terminal on a white background renders every dark
  // theme above as grey text on grey, and "use a dark terminal" is not an
  // answer — plenty of people work in daylight.
  'catppuccin-latte': {
    on: '#eff1f5',
    fg: '#4c4f69',
    dim: '#6c6f85',
    subtle: '#9ca0b0',
    accent: '#1e66f5',
    accent2: '#8839ef',
    border: '#bcc0cc',
    borderFocus: '#1e66f5',
    float: '#e6e9ef',
    selection: '#dce0e8',
    red: '#d20f39',
    orange: '#fe640b',
    yellow: '#df8e1d',
    green: '#40a02b',
    teal: '#179299',
    cyan: '#04a5e5',
    blue: '#1e66f5',
    magenta: '#8839ef'
  },
  // For 16-colour terminals, tmux over ssh, and anyone who wants the terminal's
  // own colours honoured rather than overridden.
  monochrome: {
    on: 'black',
    fg: undefined,
    dim: 'gray',
    subtle: 'gray',
    accent: 'white',
    accent2: 'white',
    border: 'gray',
    borderFocus: 'white',
    float: undefined,
    selection: undefined,
    red: 'red',
    orange: 'yellow',
    yellow: 'yellow',
    green: 'green',
    teal: 'cyan',
    cyan: 'cyan',
    blue: 'blue',
    magenta: 'magenta'
  }
}

// Author colours are picked from the palette rather than from the 16 ANSI
// names, so two people never end up as the same shade of "yellow-ish" and the
// set stays legible on the theme's own background.
const AUTHOR_KEYS = ['cyan', 'green', 'yellow', 'magenta', 'blue', 'orange', 'teal', 'accent2']

// A note on the marker column. It is one cell, and three things want it: a line
// somebody else wrote, a line you wrote, and a line that is talking to you.
//
// The last two are the ones that have to be found at a glance, so they get the
// shapes that carry furthest — a caret for yours, a solid bar for a mention.
// What is left for everybody else is a dot, drawn in that person's own colour.
// It is the quietest mark on the screen on purpose: it is not there to be
// noticed, it is there so a block of text has a coloured edge to start from
// instead of beginning in the middle of an empty pane.
const GLYPHS = {
  plain: {
    room: '#',
    dm: '@',
    incoming: '●',
    self: '›',
    detail: '⎿',
    error: '✗',
    warn: '▲',
    ok: '✓',
    welcome: '✻',
    selected: '❯',
    lock: '·',
    peers: '•',
    owner: '★',
    closed: '⊘',
    unread: '●',
    search: '⌕',
    command: '▸',
    left: '◀',
    right: '▶',
    bar: '│',
    edge: '▌',
    sep: '·',
    ellipsis: '…',
    // U+26BF, the obvious choice for a key, is missing from most of the fonts
    // people actually run and draws as a replacement box in all of them. A
    // circled dot is in every font that has ever shipped with a terminal, and
    // at this size it reads as a keyhole, which is close enough.
    key: '⊙',
    account: '◆'
  },
  nerd: {
    // Deliberately the same as the plain set. A Nerd Font glyph here buys
    // nothing — `#` and `@` already say room and person — and costs a great
    // deal: it is a private-use codepoint, so a terminal without the patched
    // font draws either nothing at all or a replacement box, and it is two
    // cells wide in fonts that have it and one in fonts that do not, which
    // misaligns every row in the conversation list.
    room: '#',
    dm: '@',
    incoming: '●',
    self: '›',
    detail: '⎿',
    error: '',
    warn: '',
    ok: '',
    welcome: '',
    selected: '❯',
    lock: '',
    peers: '',
    owner: '',
    closed: '',
    unread: '●',
    search: '',
    command: '▸',
    left: '',
    right: '',
    bar: '│',
    edge: '▌',
    sep: '·',
    ellipsis: '…',
    key: '',
    account: ''
  }
}

/**
 * Build the theme the whole UI renders against.
 *
 * @param {object} [settings]  as returned by ui/model/settings.js
 */
export function createTheme (settings = {}) {
  const palette = PALETTES[settings.theme] || PALETTES['tokyonight-storm']
  const icons = settings.nerdFonts ? GLYPHS.nerd : GLYPHS.plain

  return {
    name: settings.theme || 'tokyonight-storm',
    ...palette,
    icons,
    // Mode colours, straight out of lualine: blue means you are navigating,
    // green means what you type goes into the room.
    mode: {
      normal: palette.blue,
      insert: palette.green,
      command: palette.magenta,
      float: palette.accent2
    },
    authorColor (hex) {
      let hash = 0
      const source = String(hex || '')
      for (let i = 0; i < source.length; i++) hash = (hash * 31 + source.charCodeAt(i)) >>> 0
      return palette[AUTHOR_KEYS[hash % AUTHOR_KEYS.length]]
    }
  }
}

export const THEME_NAMES = Object.keys(PALETTES)

// The pre-theme constants, kept so anything not yet theme-aware still renders.
export const ACCENT = PALETTES['tokyonight-storm'].accent
export const MUTED = PALETTES['tokyonight-storm'].dim
export const MARKER = GLYPHS.plain
