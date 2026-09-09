// Tier 1 — portable keymap. The bindings themselves, the canonical name for a
// keypress, and the chord resolver that turns a stream of keypresses into an
// action.
//
// The vocabulary is LazyVim's, because that is what the people this is built
// for already have in their fingers: two modes, space as the leader, `<leader>f`
// for anything you find, `<leader>u` for anything you toggle, `]`/`[` to move
// between buffers, and a which-key popup whenever a chord is half-typed.
//
// Chat is the exception LazyVim does not have to solve: you are here to type
// prose, not to edit a file, so INSERT is the mode you start in and every
// binding that matters is also reachable from it with a control chord.
//
// `:` opens the command line, the same as it does in vim — which is why the
// message box does not have to reserve a prefix character of its own.

export const LEADER = '<space>'

/**
 * @typedef {object} Binding
 * @property {string} keys      chord, using `<leader>` and `<C-x>` notation
 * @property {'normal'|'insert'|'both'} mode
 * @property {string} desc      shown in which-key and the keymap picker
 * @property {string} action    what the app should do — see App.jsx
 * @property {string} [group]   which-key grouping label
 * @property {string} [icon]
 */

/** Group labels for a half-typed chord, the way which-key shows them. */
export const GROUPS = [
  { keys: '<leader>f', desc: 'find', icon: '󰍉' },
  { keys: '<leader>u', desc: 'toggle', icon: '󰒓' },
  { keys: '<leader>g', desc: 'go to', icon: '󰆾' },
  { keys: '<leader>q', desc: 'quit', icon: '󰈆' },
  { keys: '<leader>r', desc: 'room', icon: '󰭹' }
]

export const BINDINGS = [
  // --- finders ------------------------------------------------------------
  { keys: '<leader><leader>', mode: 'normal', desc: 'Find conversation', action: 'picker:conversations' },
  { keys: '<leader>ff', mode: 'normal', desc: 'Find conversation', action: 'picker:conversations' },
  { keys: '<leader>fd', mode: 'normal', desc: 'Find a person', action: 'picker:people' },
  { keys: '<leader>fr', mode: 'normal', desc: 'Find room', action: 'picker:rooms' },
  { keys: '<leader>fm', mode: 'normal', desc: 'Find a member', action: 'picker:members' },
  { keys: '<leader>fc', mode: 'normal', desc: 'Commands', action: 'cmdline' },
  { keys: '<leader>fk', mode: 'normal', desc: 'Keymaps', action: 'picker:keymaps' },
  { keys: '<leader>fa', mode: 'normal', desc: 'Accounts', action: 'picker:accounts' },
  { keys: '<leader>fs', mode: 'normal', desc: 'Search messages', action: 'picker:messages' },
  { keys: '<leader>,', mode: 'normal', desc: 'Switch conversation', action: 'picker:conversations' },
  { keys: '/', mode: 'normal', desc: 'Search messages', action: 'picker:messages' },
  { keys: ':', mode: 'normal', desc: 'Command line', action: 'cmdline' },

  // --- floats -------------------------------------------------------------
  { keys: '<leader>s', mode: 'normal', desc: 'Settings', action: 'float:settings' },
  { keys: '<leader>a', mode: 'normal', desc: 'Accounts', action: 'float:accounts' },
  { keys: '<leader>?', mode: 'normal', desc: 'Help', action: 'float:help' },
  { keys: '?', mode: 'normal', desc: 'Help', action: 'float:help' },
  { keys: '<leader>k', mode: 'normal', desc: 'Your keys', action: 'float:identity' },

  // --- rooms and people ---------------------------------------------------
  { keys: '<leader>rn', mode: 'normal', desc: 'New room', action: 'prompt:new' },
  { keys: '<leader>rj', mode: 'normal', desc: 'Join with an invite', action: 'prompt:join' },
  { keys: '<leader>ri', mode: 'normal', desc: 'Invite someone', action: 'cmd:invite' },
  { keys: '<leader>rm', mode: 'normal', desc: 'List members', action: 'cmd:members' },
  { keys: '<leader>y', mode: 'normal', desc: 'Your public key', action: 'cmd:whoami' },

  // --- navigation ---------------------------------------------------------
  { keys: ']b', mode: 'normal', desc: 'Next conversation', action: 'nav:next' },
  { keys: '[b', mode: 'normal', desc: 'Previous conversation', action: 'nav:prev' },
  { keys: 'L', mode: 'normal', desc: 'Next conversation', action: 'nav:next' },
  { keys: 'H', mode: 'normal', desc: 'Previous conversation', action: 'nav:prev' },
  { keys: 'gd', mode: 'normal', desc: 'Newest unread', action: 'nav:unread' },
  { keys: '<leader>e', mode: 'normal', desc: 'Conversation list', action: 'focus:sidebar' },
  { keys: '<C-e>', mode: 'both', desc: 'Conversation list', action: 'focus:sidebar' },

  // --- reading back -------------------------------------------------------
  // The transcript lives in a pane rather than in the terminal's scrollback, so
  // moving through it is the app's job now. The bindings are the ones a pager
  // has, because that is what your hands expect of a screen full of text.
  { keys: '<pageup>', mode: 'both', desc: 'Scroll back a page', action: 'scroll:page' },
  { keys: '<pagedown>', mode: 'both', desc: 'Scroll forward a page', action: 'scroll:unpage' },
  { keys: '<C-u>', mode: 'normal', desc: 'Scroll back', action: 'scroll:up' },
  { keys: '<C-d>', mode: 'normal', desc: 'Scroll forward', action: 'scroll:down' },
  { keys: 'gg', mode: 'normal', desc: 'Jump to the start', action: 'scroll:home' },
  { keys: 'G', mode: 'normal', desc: 'Jump to the newest', action: 'scroll:end' },

  // --- toggles ------------------------------------------------------------
  { keys: '<leader>ut', mode: 'normal', desc: 'Timestamps', action: 'toggle:timestamps' },
  { keys: '<leader>uc', mode: 'normal', desc: 'Compact lines', action: 'toggle:compact' },
  { keys: '<leader>um', mode: 'normal', desc: 'Mouse capture', action: 'toggle:mouse' },
  { keys: '<leader>ue', mode: 'normal', desc: 'Conversation list', action: 'toggle:sidebar' },

  // --- modes and exit -----------------------------------------------------
  { keys: 'i', mode: 'normal', desc: 'Write a message', action: 'mode:insert' },
  { keys: 'a', mode: 'normal', desc: 'Write a message', action: 'mode:insert' },
  { keys: '<leader>qq', mode: 'normal', desc: 'Quit openchat', action: 'cmd:quit' },
  { keys: 'ZZ', mode: 'normal', desc: 'Quit openchat', action: 'cmd:quit' },

  // --- insert mode --------------------------------------------------------
  // Everything above is reachable while typing too, because a chat client that
  // makes you leave the message you are writing to switch room is a chat client
  // you stop using.
  { keys: '<esc>', mode: 'insert', desc: 'Normal mode', action: 'mode:normal' },
  { keys: '<C-p>', mode: 'both', desc: 'Find conversation', action: 'picker:conversations' },
  { keys: '<C-k>', mode: 'both', desc: 'Command line', action: 'cmdline' },
  { keys: '<C-g>', mode: 'both', desc: 'Settings', action: 'float:settings' },
  { keys: '<C-o>', mode: 'both', desc: 'Accounts', action: 'float:accounts' },
  { keys: '<S-tab>', mode: 'both', desc: 'Next conversation', action: 'nav:next' }
]

/** Bindings that apply in a given mode, in the order they were declared. */
export function bindingsFor (mode) {
  return BINDINGS.filter((b) => b.mode === mode || b.mode === 'both')
}

/**
 * The canonical name for a keypress, as Ink hands it to us.
 *
 * @param {string} input
 * @param {object} key  Ink's key object
 * @returns {string | null} null for a keypress that is not a binding candidate
 */
export function chordFor (input, key) {
  if (key.escape) return '<esc>'
  if (key.return) return '<cr>'
  if (key.tab) return key.shift ? '<S-tab>' : '<tab>'
  if (key.backspace || key.delete) return '<bs>'
  if (key.upArrow) return '<up>'
  if (key.downArrow) return '<down>'
  if (key.leftArrow) return '<left>'
  if (key.rightArrow) return '<right>'
  if (key.pageUp) return '<pageup>'
  if (key.pageDown) return '<pagedown>'
  if (key.home) return '<home>'
  if (key.end) return '<end>'
  if (input === ' ') return '<space>'

  if (key.ctrl && input) {
    // Ink reports Ctrl+P as input "p" with ctrl set; a raw control byte can
    // also arrive when the terminal is in a mode Ink does not decode.
    const code = input.charCodeAt(0)
    const letter = code < 32 ? String.fromCharCode(code + 96) : input.toLowerCase()
    return `<C-${letter}>`
  }

  if (!input || input.length !== 1) return null
  return input
}

/**
 * Expand `<leader>` so a chord can be compared against typed keys.
 * `<leader>ff` becomes ['<space>', 'f', 'f'].
 */
export function keysOf (chord) {
  const out = []
  let i = 0
  while (i < chord.length) {
    if (chord[i] === '<') {
      const close = chord.indexOf('>', i)
      if (close === -1) {
        out.push(chord[i])
        i++
        continue
      }
      const token = chord.slice(i, close + 1)
      out.push(token === '<leader>' ? LEADER : token)
      i = close + 1
      continue
    }
    out.push(chord[i])
    i++
  }
  return out
}

/**
 * A chord resolver for one mode.
 *
 * Feeding it a key returns what to do about it: run an action, wait for more
 * (which is what puts the which-key popup on screen), or nothing — in which
 * case the key belongs to whatever was going to handle it anyway.
 */
export function createResolver (bindings) {
  const table = bindings.map((binding) => ({ ...binding, sequence: keysOf(binding.keys) }))
  let pending = []

  const api = {
    /** Keys typed so far in an unfinished chord. */
    get pending () {
      return pending
    },

    reset () {
      pending = []
    },

    /**
     * Bindings still reachable from the pending keys, for which-key. With
     * nothing pending this is every binding that starts a chord.
     */
    candidates (prefix = pending) {
      return table
        .filter((b) => b.sequence.length > prefix.length && startsWith(b.sequence, prefix))
        .map((b) => ({ ...b, next: b.sequence[prefix.length] }))
    },

    /**
     * @param {string | null} chord
     * @returns {{ type: 'action', binding: Binding }
     *          | { type: 'pending', keys: string[] }
     *          | { type: 'miss', keys: string[] }
     *          | { type: 'ignored' }}
     */
    feed (chord) {
      if (!chord) return { type: 'ignored' }

      const next = [...pending, chord]
      const exact = table.find((b) => equal(b.sequence, next))
      const longer = table.some((b) => b.sequence.length > next.length && startsWith(b.sequence, next))

      // An exact match that is also a prefix of something longer still fires:
      // waiting on a timeout to find out whether `<leader>f` meant `<leader>ff`
      // is the one part of modal editing nobody enjoys, so chords are designed
      // not to shadow each other.
      if (exact) {
        pending = []
        return { type: 'action', binding: exact }
      }

      if (longer) {
        pending = next
        return { type: 'pending', keys: next }
      }

      const had = pending.length > 0
      pending = []
      // A key that started nothing is not ours — the caller can still use it.
      // A key that broke a half-typed chord is, and is swallowed.
      return had ? { type: 'miss', keys: next } : { type: 'ignored' }
    }
  }

  return api
}

function startsWith (sequence, prefix) {
  for (let i = 0; i < prefix.length; i++) if (sequence[i] !== prefix[i]) return false
  return true
}

function equal (a, b) {
  return a.length === b.length && startsWith(a, b)
}

/** How a chord should read on screen: `<leader>ff` as `␣ f f`. */
export function describeChord (chord) {
  return keysOf(chord)
    .map((key) => (key === LEADER ? '␣' : key.replace(/^<|>$/g, '')))
    .join(' ')
}

/** The label for a half-typed chord's next key, for which-key. */
export function groupFor (prefixKeys) {
  const chord = prefixKeys.map((k) => (k === LEADER ? '<leader>' : k)).join('')
  return GROUPS.find((g) => g.keys === chord) || null
}
