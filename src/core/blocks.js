// Tier 2 — what actually gets appended to a writer's Autobase core.
//
// Two block types. A MESSAGE block wraps a sealed envelope plus the routing
// metadata `apply()` needs to file it in the view without decrypting anything —
// apply must be deterministic and cheap, and it has no business doing crypto on
// every reapply. That metadata is not a leak: the Autobase cores are themselves
// encrypted with the room key, so only members ever see it.
//
// A JOIN block is a writer asking to be admitted. It is appended optimistically
// (the appender is not a writer yet, by definition) and carries a signature
// binding the requester's identity key to their writer core key, which is what
// `apply()` checks before admitting them.

import c from 'compact-encoding'
import b4a from 'b4a'

import { PROTOCOL_VERSION } from '../protocol/constants.js'

export const BLOCK_TYPE = { MESSAGE: 0, JOIN: 1, CONTROL: 2 }
export const BLOCK_TYPE_NAME = { 0: 'message', 1: 'join', 2: 'control' }

/** Things the room's owner can do. Append only — never renumber. */
export const CONTROL_ACTION = { close: 0, reopen: 1, transfer: 2, remove: 3 }
export const CONTROL_ACTION_NAME = { 0: 'close', 1: 'reopen', 2: 'transfer', 3: 'remove' }

/** Signed by the joiner's identity key to prove the writer core is theirs. */
export const JOIN_CONTEXT = b4a.from('openchat:join:v1', 'ascii')

/** Signed by the owner to prove a control block is really theirs. */
export const CONTROL_CONTEXT = b4a.from('openchat:control:v1', 'ascii')

const block = {
  preencode (state, b) {
    c.uint.preencode(state, b.v)
    c.uint.preencode(state, BLOCK_TYPE[b.type.toUpperCase()])
    if (b.type === 'message') {
      c.uint.preencode(state, b.clock)
      c.string.preencode(state, b.id)
      c.fixed32.preencode(state, b.author)
      c.buffer.preencode(state, b.frame)
    } else if (b.type === 'control') {
      c.uint.preencode(state, CONTROL_ACTION[b.action])
      c.fixed32.preencode(state, b.author)
      c.fixed32.preencode(state, b.subject)
      c.uint.preencode(state, b.ts)
      c.fixed64.preencode(state, b.signature)
    } else {
      c.fixed32.preencode(state, b.writerKey)
      c.fixed32.preencode(state, b.author)
      c.fixed64.preencode(state, b.signature)
    }
  },
  encode (state, b) {
    c.uint.encode(state, b.v)
    c.uint.encode(state, BLOCK_TYPE[b.type.toUpperCase()])
    if (b.type === 'message') {
      c.uint.encode(state, b.clock)
      c.string.encode(state, b.id)
      c.fixed32.encode(state, b.author)
      c.buffer.encode(state, b.frame)
    } else if (b.type === 'control') {
      c.uint.encode(state, CONTROL_ACTION[b.action])
      c.fixed32.encode(state, b.author)
      c.fixed32.encode(state, b.subject)
      c.uint.encode(state, b.ts)
      c.fixed64.encode(state, b.signature)
    } else {
      c.fixed32.encode(state, b.writerKey)
      c.fixed32.encode(state, b.author)
      c.fixed64.encode(state, b.signature)
    }
  },
  decode (state) {
    const v = c.uint.decode(state)
    const type = BLOCK_TYPE_NAME[c.uint.decode(state)]
    if (type === undefined) throw new Error('unknown block type')

    if (type === 'message') {
      return {
        v,
        type,
        clock: c.uint.decode(state),
        id: c.string.decode(state),
        author: c.fixed32.decode(state),
        frame: c.buffer.decode(state)
      }
    }

    if (type === 'control') {
      const action = CONTROL_ACTION_NAME[c.uint.decode(state)]
      if (action === undefined) throw new Error('unknown control action')
      return {
        v,
        type,
        action,
        author: c.fixed32.decode(state),
        subject: c.fixed32.decode(state),
        ts: c.uint.decode(state),
        signature: c.fixed64.decode(state)
      }
    }

    return {
      v,
      type,
      writerKey: c.fixed32.decode(state),
      author: c.fixed32.decode(state),
      signature: c.fixed64.decode(state)
    }
  }
}

export function encodeBlock (b) {
  return c.encode(block, { v: PROTOCOL_VERSION, ...b })
}

export function decodeBlock (buf) {
  const decoded = c.decode(block, buf)
  if (decoded.v !== PROTOCOL_VERSION) throw new Error(`unsupported block version ${decoded.v}`)
  return decoded
}

/** The bytes a joiner signs: context || writerKey. */
export function joinChallenge (writerKey) {
  const out = b4a.alloc(JOIN_CONTEXT.byteLength + writerKey.byteLength)
  b4a.copy(JOIN_CONTEXT, out, 0)
  b4a.copy(writerKey, out, JOIN_CONTEXT.byteLength)
  return out
}

/**
 * The bytes an owner signs to authorise a control action. The timestamp is in
 * there so an old, still-valid signature cannot be replayed to undo a later
 * decision — apply only honours a control block newer than the last one.
 */
export function controlChallenge ({ action, subject, ts }) {
  return b4a.concat([
    CONTROL_CONTEXT,
    b4a.from([CONTROL_ACTION[action]]),
    b4a.from(subject),
    b4a.from(String(ts), 'utf8')
  ])
}

// Hyperbee view keys. Messages sort by Lamport clock so a range read comes back
// close to display order; `protocol/order.js` still has the final say.
export const MESSAGE_PREFIX = 'msg:'
export const WRITER_PREFIX = 'writer:'
export const META_PREFIX = 'meta:'

export const META = {
  owner: `${META_PREFIX}owner`,
  closed: `${META_PREFIX}closed`,
  controlTs: `${META_PREFIX}control-ts`
}

export function messageKey ({ clock, id }) {
  return `${MESSAGE_PREFIX}${String(clock).padStart(12, '0')}:${id}`
}

export function writerRecordKey (authorHex) {
  return `${WRITER_PREFIX}${authorHex}`
}
