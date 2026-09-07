// Tier 1 — portable presentation helpers. No rendering here, just strings, so
// the terminal and the browser label things the same way.

/**
 * What a conversation is called on screen: `#room`, `@person`.
 *
 * One function, because the prefix used to be decided in two places — the
 * theme, for the chrome, and a hardcoded `#` in every notice — and the two
 * could disagree. They did: with Nerd Font icons switched on, the chrome drew a
 * glyph most terminals render as nothing, while `/new` and `/rooms` went on
 * printing a literal `#`. The same room had two names depending on where you
 * were looking at it.
 *
 * `#` and `@` are not decoration. They are the convention every chat client has
 * used since IRC, they are one cell wide everywhere, and they say which kind of
 * thing you are looking at without needing a legend.
 */
export function conversationLabel (kind, name) {
  return `${kind === 'dm' ? '@' : '#'}${name ?? ''}`
}

export function formatTime (ts) {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * The day a timestamp falls on, as a chat client says it: `today`, `yesterday`,
 * or a date. Used for the rule the transcript draws when the day changes —
 * without one, a conversation that has been going for a week is one wall of
 * clock times that all look like they happened this afternoon.
 */
export function formatDay (ts, now = Date.now()) {
  const day = new Date(ts)
  const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((midnight(new Date(now)) - midnight(day)) / 86400000)

  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'

  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][day.getMonth()]
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day.getDay()]
  const year = day.getFullYear() === new Date(now).getFullYear() ? '' : ` ${day.getFullYear()}`

  return `${weekday} ${day.getDate()} ${month}${year}`
}

/** Whether two timestamps fall on the same calendar day. */
export function sameDay (a, b) {
  const x = new Date(a)
  const y = new Date(b)
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}

export function formatBytes (bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '?'
  if (bytes < 1024) return `${bytes}B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}${units[i]}`
}

export function shortKey (hex, length = 8) {
  return typeof hex === 'string' ? hex.slice(0, length) : ''
}

/** A member's display name: their chosen nick, else a short key. */
export function displayName (member, authorHex) {
  if (member?.nick) return member.nick
  return shortKey(authorHex)
}

// Stable per-author colour so the same person looks the same in every session.
// Terminal-safe names; the web renderer maps them to CSS variables of the same
// name, which is why the palette lives here rather than in either renderer.
export const AUTHOR_COLORS = ['cyan', 'green', 'yellow', 'magenta', 'blue', 'red', 'white']

export function colorForAuthor (authorHex) {
  let hash = 0
  for (let i = 0; i < authorHex.length; i++) {
    hash = (hash * 31 + authorHex.charCodeAt(i)) >>> 0
  }
  return AUTHOR_COLORS[hash % AUTHOR_COLORS.length]
}

/** A one-line summary of an attachment, used by both renderers. */
export function describeAttachment (message, attachment) {
  const size = formatBytes(message.size)
  switch (attachment?.status) {
    case 'ready':
      return `${message.name} (${size}) — saved`
    case 'downloading':
      return `${message.name} (${size}) — ${Math.round((attachment.progress || 0) * 100)}%`
    case 'failed':
      return `${message.name} (${size}) — failed: ${attachment.error || 'unknown error'}`
    default:
      return `${message.name} (${size}) — /download ${message.id.slice(0, 6)}`
  }
}

/**
 * A nick message reads as a rename only if we knew a different name before. The
 * first one we see from someone is an introduction, and "bob is now known as
 * bob" is not a sentence anyone wants to read.
 */
export function formatNickChange (message, previousName) {
  if (!previousName || previousName === message.nick) return `${message.nick} joined`
  return `${previousName} is now known as ${message.nick}`
}

export function formatSystemEvent (message, members) {
  const who = displayName(members?.[message.subject], message.subject || message.author)
  switch (message.event) {
    case 'join': return `${who} joined the room`
    case 'leave': return `${who} left the room`
    case 'writer-added': return `${who} can now post to this room`
    default: return `${who}: ${message.event}`
  }
}

function pad (n) {
  return String(n).padStart(2, '0')
}
