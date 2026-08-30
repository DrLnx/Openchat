// Tier 1 — portable presentation helpers. No rendering here, just strings, so
// the terminal and the browser label things the same way.

export function formatTime (ts) {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
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
