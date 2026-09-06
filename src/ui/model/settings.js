// Tier 1 — portable settings schema.
//
// One declarative table describes every setting: what it is called, what it can
// hold, and one line of prose explaining it. The floating settings panel is
// generated from this, so adding a setting is a single entry here rather than a
// new widget, and the browser harness reads the same defaults.
//
// Settings live in the profile's config.json alongside rooms and contacts, so
// they are per-account — which is what you want when one account is your work
// identity on a shared machine and another is not.

export const THEMES = [
  'tokyonight-storm',
  'tokyonight-night',
  'catppuccin-mocha',
  'gruvbox-dark',
  'rose-pine',
  'monochrome'
]

/**
 * @typedef {object} Setting
 * @property {string} key       where it lives in config.settings
 * @property {string} label
 * @property {string} help
 * @property {'enum'|'boolean'|'number'|'text'} type
 * @property {any} default
 * @property {string[]} [values]  for enums
 * @property {string} section
 */

/** @type {Setting[]} */
export const SETTINGS = [
  {
    key: 'theme',
    section: 'Appearance',
    label: 'Theme',
    help: 'Palette for the whole interface.',
    type: 'enum',
    values: THEMES,
    default: 'tokyonight-storm'
  },
  {
    key: 'timestamps',
    section: 'Appearance',
    label: 'Timestamps',
    help: 'Clock in front of every message.',
    type: 'enum',
    values: ['24h', '12h', 'off'],
    default: '24h'
  },
  {
    key: 'compact',
    section: 'Appearance',
    label: 'Compact lines',
    help: 'Drop the blank line between speakers.',
    type: 'boolean',
    default: false
  },
  {
    key: 'nerdFonts',
    section: 'Appearance',
    label: 'Nerd Font icons',
    help: 'Glyph icons in the statusline. Needs a patched font.',
    type: 'boolean',
    default: false
  },
  {
    key: 'sidebar',
    section: 'Appearance',
    label: 'Conversation list',
    help: 'The rooms and DMs down the left. Hidden below 64 columns either way.',
    type: 'boolean',
    default: true
  },
  {
    key: 'banner',
    section: 'Appearance',
    label: 'Welcome logo',
    help: 'The logo on the pane you see before a conversation is open.',
    type: 'boolean',
    default: true
  },

  {
    key: 'startInNormalMode',
    section: 'Keys',
    label: 'Start in NORMAL mode',
    help: 'Off means you can type a message the moment openchat opens.',
    type: 'boolean',
    default: false
  },
  {
    key: 'mouse',
    section: 'Keys',
    label: 'Mouse',
    help: 'floats: click inside pickers. always: wheel scrolls, the list is clickable.',
    type: 'enum',
    values: ['floats', 'always', 'off'],
    default: 'floats'
  },
  {
    key: 'whichKeyDelayMs',
    section: 'Keys',
    label: 'Which-key delay',
    help: 'Milliseconds before a half-typed chord shows its options.',
    type: 'number',
    default: 250,
    min: 0,
    max: 3000,
    step: 50
  },

  {
    key: 'autoDownloadBytes',
    section: 'Privacy',
    label: 'Auto-download limit',
    help: 'Attachments up to this size are fetched without asking. 0 never fetches.',
    type: 'number',
    default: 5 * 1024 * 1024,
    min: 0,
    max: 512 * 1024 * 1024,
    step: 1024 * 1024
  },
  {
    key: 'showKeys',
    section: 'Privacy',
    label: 'Show full public keys',
    help: 'Off abbreviates every key on screen — safer when you share a screen.',
    type: 'boolean',
    default: false
  },
  {
    key: 'readReceipts',
    section: 'Privacy',
    label: 'Presence',
    help: 'Tell the room you are online. Off means nobody learns when you are here.',
    type: 'boolean',
    default: true
  },
  {
    key: 'bell',
    section: 'Privacy',
    label: 'Terminal bell',
    help: 'Ring on a message that mentions you.',
    type: 'boolean',
    default: false
  }
]

export const SECTIONS = [...new Set(SETTINGS.map((s) => s.section))]

const BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]))

export function defaults () {
  const out = {}
  for (const setting of SETTINGS) out[setting.key] = setting.default
  return out
}

/**
 * Settings as the UI should see them: defaults, overlaid with whatever is in
 * the config, with anything invalid dropped rather than trusted. A config that
 * has been hand-edited into nonsense should not be able to crash a renderer.
 */
export function read (config = {}) {
  const stored = config.settings && typeof config.settings === 'object' ? config.settings : {}
  const out = defaults()

  for (const setting of SETTINGS) {
    if (!(setting.key in stored)) continue
    const value = coerce(setting, stored[setting.key])
    if (value !== undefined) out[setting.key] = value
  }

  // `autoDownloadBytes` predates this table and lives at the top level of the
  // config; keep honouring it so an upgrade does not silently change what gets
  // downloaded behind someone's back.
  if (!('autoDownloadBytes' in stored) && Number.isFinite(config.autoDownloadBytes)) {
    out.autoDownloadBytes = config.autoDownloadBytes
  }

  return out
}

/** A config with one setting changed. Pure — the caller decides when to write. */
export function write (config, key, value) {
  const setting = BY_KEY.get(key)
  if (!setting) throw new Error(`unknown setting: ${key}`)

  const coerced = coerce(setting, value)
  if (coerced === undefined) throw new Error(`invalid value for ${key}: ${value}`)

  const next = { ...config, settings: { ...(config.settings || {}), [key]: coerced } }
  if (key === 'autoDownloadBytes') next.autoDownloadBytes = coerced
  return next
}

/** The value one step along from where it is — what enter does in the panel. */
export function cycle (setting, value, step = 1) {
  switch (setting.type) {
    case 'boolean':
      return !value
    case 'enum': {
      const at = setting.values.indexOf(value)
      const from = at === -1 ? 0 : at
      return setting.values[(from + step + setting.values.length) % setting.values.length]
    }
    case 'number': {
      const next = (Number(value) || 0) + step * (setting.step || 1)
      return Math.min(setting.max ?? Infinity, Math.max(setting.min ?? 0, next))
    }
    default:
      return value
  }
}

export function get (key) {
  return BY_KEY.get(key) || null
}

/** How a value should read in the panel. */
export function display (setting, value) {
  if (setting.type === 'boolean') return value ? 'on' : 'off'
  if (setting.key === 'autoDownloadBytes') {
    if (!value) return 'never'
    return `${Math.round(value / (1024 * 1024))} MB`
  }
  if (setting.key === 'whichKeyDelayMs') return `${value} ms`
  return String(value)
}

function coerce (setting, value) {
  switch (setting.type) {
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined
    case 'enum':
      return setting.values.includes(value) ? value : undefined
    case 'number': {
      const n = Number(value)
      if (!Number.isFinite(n)) return undefined
      return Math.min(setting.max ?? Infinity, Math.max(setting.min ?? 0, n))
    }
    default:
      return typeof value === 'string' ? value : undefined
  }
}
