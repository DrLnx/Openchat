// Tier 1 — portable chat view-model.
//
// A plain reducer over plain data: unread counts, member tracking, the
// transcript. Keeping it out of the components is what makes any of it testable
// — none of these tests need a terminal, a room or a network.
//
// The transcript holds messages and nothing else. Anything this client wants to
// say for itself — a command's answer, an error, an acknowledgement — is said
// above the prompt and then taken back down; see the note on `flash` in
// ui/ink/App.jsx. A log that mixes what people said with what the program said
// is a log you stop trusting to be the conversation.
//
// Ordering of the transcript is delegated to protocol/order.js, the same
// function the CLI applies to Autobase's linearized view.

import { linearize, merge, nextClock } from '../../protocol/order.js'

export function initialState (self = null) {
  return {
    self, // { publicKey, nick }
    room: null, // { key, name }
    rooms: [], // [{ key, name, unread }]
    messages: [], // ordered by protocol/order.js
    // You are a member of your own room before you have said anything, so seed
    // yourself — otherwise the member list is empty until you first speak.
    members: self ? { [self.publicKey]: { nick: self.nick, status: 'online' } } : {},
    attachments: {}, // message id -> { status, progress, path, error }
    connection: { state: 'offline', peers: 0 }
  }
}

export function reduce (state, action) {
  switch (action.type) {
    case 'self':
      return { ...state, self: { ...state.self, ...action.self } }

    case 'room': {
      const room = action.room
      const rooms = upsertRoom(state.rooms, room)
      const messages = action.messages ? linearize(action.messages) : []

      let next = {
        ...state,
        room,
        rooms: rooms.map((r) => (r.key === room?.key ? { ...r, unread: 0 } : r)),
        // Transcript belongs to a room; switching rooms must not blend them.
        messages,
        attachments: action.messages ? state.attachments : {}
      }

      // A transcript loaded from disk carries the same nick and presence
      // messages a live one does, and they have to be applied the same way.
      // Without this, everyone who spoke before this session started shows up
      // as a hex key until they say something again.
      for (const m of messages) next = applyToMembers(next, m)
      return next
    }

    case 'rooms': {
      // A refresh re-reads the conversation list. What it must not do is reset
      // the counts: switching rooms would quietly mark everything else as read.
      //
      // A conversation we already had a count for keeps it. One we have never
      // seen this session takes whatever the caller supplied — which is how a
      // count from the index survives a restart, rather than every room looking
      // read the moment you open the app.
      const seen = new Map(state.rooms.map((r) => [r.key, r.unread || 0]))
      return {
        ...state,
        rooms: action.rooms.map((room) => ({
          ...room,
          unread: room.key === state.room?.key
            ? 0
            : (seen.has(room.key) ? seen.get(room.key) : (room.unread || 0))
        }))
      }
    }

    case 'messages': {
      const incoming = Array.isArray(action.messages) ? action.messages : [action.messages]
      if (incoming.length === 0) return state

      let next = { ...state, messages: merge(state.messages, incoming) }
      // Nick and presence updates are messages like any other, so the member
      // list rebuilds itself from the transcript rather than from side channels.
      for (const m of incoming) next = applyToMembers(next, m)

      if (action.roomKey && action.roomKey !== state.room?.key) {
        const unread = incoming.filter((m) => m.type === 'text' || m.type === 'file').length
        return { ...state, rooms: bumpUnread(state.rooms, action.roomKey, unread) }
      }
      return next
    }

    case 'members':
      return { ...state, members: action.members }

    // Membership the room knows about directly (the Autobase writer set), as
    // opposed to what can be inferred from the transcript. Someone who joined
    // and never spoke is still in the room, and should be listed.
    case 'known-members': {
      const members = { ...state.members }
      for (const publicKey of action.publicKeys) {
        members[publicKey] = { status: 'online', ...members[publicKey] }
      }
      return { ...state, members }
    }

    case 'member':
      return {
        ...state,
        members: {
          ...state.members,
          [action.publicKey]: { ...state.members[action.publicKey], ...action.member }
        }
      }

    case 'connection':
      return { ...state, connection: { ...state.connection, ...action.connection } }

    case 'attachment':
      return {
        ...state,
        attachments: {
          ...state.attachments,
          [action.id]: { ...state.attachments[action.id], ...action.attachment }
        }
      }

    default:
      return state
  }
}

/** The Lamport clock for this client's next message. */
export function clockFor (state) {
  return nextClock(state.messages)
}

/**
 * The transcript as rendered, oldest first.
 *
 * Only messages: what people said, what the room did, who renamed themselves.
 * Nothing this client has to say for itself ever appears here.
 */
export function transcript (state) {
  // Names as they were at each point in the log, not as they are now: a rename
  // line has to say what someone was called *before* it, and the member map
  // only knows the latest. Walking the ordered messages is the only way to get
  // that right for a line scrolled back to hours later.
  const nameAt = new Map()
  const entries = []

  for (const m of state.messages) {
    if (m.type === 'presence') continue // presence drives the sidebar, not the log
    const entry = { kind: 'message', key: m.id, ts: m.ts, message: m }
    if (m.type === 'nick') {
      entry.previousName = nameAt.get(m.author) || null
      nameAt.set(m.author, m.nick)
    }
    entries.push(entry)
  }

  return entries
}

export function memberList (state) {
  return Object.entries(state.members)
    .map(([publicKey, member]) => ({ publicKey, ...member }))
    .sort((a, b) => (a.nick || a.publicKey).localeCompare(b.nick || b.publicKey))
}

export function totalUnread (state) {
  return state.rooms.reduce((sum, r) => sum + (r.unread || 0), 0)
}

function applyToMembers (state, m) {
  const existing = state.members[m.author] || {}
  const member = { ...existing, lastSeen: Math.max(existing.lastSeen || 0, m.ts) }

  if (m.type === 'nick') member.nick = m.nick
  if (m.type === 'presence') member.status = m.status
  if (existing.status === undefined && m.type !== 'presence') member.status = existing.status || 'online'

  return { ...state, members: { ...state.members, [m.author]: member } }
}

function upsertRoom (rooms, room) {
  if (!room) return rooms
  return rooms.some((r) => r.key === room.key)
    ? rooms.map((r) => (r.key === room.key ? { ...r, ...room } : r))
    : [...rooms, { ...room, unread: 0 }]
}

function bumpUnread (rooms, key, by) {
  return rooms.map((r) => (r.key === key ? { ...r, unread: (r.unread || 0) + by } : r))
}
