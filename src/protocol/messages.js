// Tier 1 — portable. Message schema + compact-encoding codecs.
//
// The in-memory shape keeps `author` as a lowercase hex string because it is
// used as a Map key throughout the UI; the codec converts to/from raw 32 bytes
// at the wire boundary. Nothing above this module should ever see a buffer.

import c from 'compact-encoding'
import b4a from 'b4a'

import {
  PROTOCOL_VERSION,
  MESSAGE_TYPE,
  MESSAGE_TYPE_NAME,
  PRESENCE_STATUS,
  PRESENCE_STATUS_NAME,
  SYSTEM_EVENT,
  SYSTEM_EVENT_NAME
} from './constants.js'

class UnknownMessageTypeError extends Error {
  constructor (type) {
    super(`unknown message type: ${type}`)
    this.name = 'UnknownMessageTypeError'
    this.type = type
  }
}

const blobId = {
  preencode (state, id) {
    c.uint.preencode(state, id.blockOffset)
    c.uint.preencode(state, id.blockLength)
    c.uint.preencode(state, id.byteOffset)
    c.uint.preencode(state, id.byteLength)
  },
  encode (state, id) {
    c.uint.encode(state, id.blockOffset)
    c.uint.encode(state, id.blockLength)
    c.uint.encode(state, id.byteOffset)
    c.uint.encode(state, id.byteLength)
  },
  decode (state) {
    return {
      blockOffset: c.uint.decode(state),
      blockLength: c.uint.decode(state),
      byteOffset: c.uint.decode(state),
      byteLength: c.uint.decode(state)
    }
  }
}

export const message = {
  preencode (state, m) {
    c.uint.preencode(state, m.v)
    c.uint.preencode(state, typeCode(m.type))
    c.string.preencode(state, m.id)
    c.uint.preencode(state, m.ts)
    c.uint.preencode(state, m.clock)
    c.fixed32.preencode(state, hexToBuffer(m.author))

    switch (m.type) {
      case 'text':
        c.string.preencode(state, m.body)
        break
      case 'file':
        c.string.preencode(state, m.name)
        c.uint.preencode(state, m.size)
        c.string.preencode(state, m.mime)
        c.fixed32.preencode(state, hexToBuffer(m.sha256))
        c.fixed32.preencode(state, hexToBuffer(m.blobCoreKey))
        blobId.preencode(state, m.blobId)
        break
      case 'presence':
        c.uint.preencode(state, PRESENCE_STATUS[m.status])
        break
      case 'system':
        c.uint.preencode(state, SYSTEM_EVENT[m.event])
        c.string.preencode(state, m.subject || '')
        break
      case 'nick':
        c.string.preencode(state, m.nick)
        break
      default:
        throw new UnknownMessageTypeError(m.type)
    }
  },

  encode (state, m) {
    c.uint.encode(state, m.v)
    c.uint.encode(state, typeCode(m.type))
    c.string.encode(state, m.id)
    c.uint.encode(state, m.ts)
    c.uint.encode(state, m.clock)
    c.fixed32.encode(state, hexToBuffer(m.author))

    switch (m.type) {
      case 'text':
        c.string.encode(state, m.body)
        break
      case 'file':
        c.string.encode(state, m.name)
        c.uint.encode(state, m.size)
        c.string.encode(state, m.mime)
        c.fixed32.encode(state, hexToBuffer(m.sha256))
        c.fixed32.encode(state, hexToBuffer(m.blobCoreKey))
        blobId.encode(state, m.blobId)
        break
      case 'presence':
        c.uint.encode(state, PRESENCE_STATUS[m.status])
        break
      case 'system':
        c.uint.encode(state, SYSTEM_EVENT[m.event])
        c.string.encode(state, m.subject || '')
        break
      case 'nick':
        c.string.encode(state, m.nick)
        break
      default:
        throw new UnknownMessageTypeError(m.type)
    }
  },

  decode (state) {
    const v = c.uint.decode(state)
    const code = c.uint.decode(state)
    const type = MESSAGE_TYPE_NAME[code]
    if (type === undefined) throw new UnknownMessageTypeError(code)

    const base = {
      v,
      type,
      id: c.string.decode(state),
      ts: c.uint.decode(state),
      clock: c.uint.decode(state),
      author: b4a.toString(c.fixed32.decode(state), 'hex')
    }

    switch (type) {
      case 'text':
        return { ...base, body: c.string.decode(state) }
      case 'file':
        return {
          ...base,
          name: c.string.decode(state),
          size: c.uint.decode(state),
          mime: c.string.decode(state),
          sha256: b4a.toString(c.fixed32.decode(state), 'hex'),
          blobCoreKey: b4a.toString(c.fixed32.decode(state), 'hex'),
          blobId: blobId.decode(state)
        }
      case 'presence':
        return { ...base, status: PRESENCE_STATUS_NAME[c.uint.decode(state)] }
      case 'system':
        return {
          ...base,
          event: SYSTEM_EVENT_NAME[c.uint.decode(state)],
          subject: c.string.decode(state)
        }
      case 'nick':
        return { ...base, nick: c.string.decode(state) }
      default:
        throw new UnknownMessageTypeError(type)
    }
  }
}

export function encodeMessage (m) {
  return c.encode(message, m)
}

export function decodeMessage (buf) {
  return c.decode(message, buf)
}

// Builders. Each stamps the protocol version and a random id so callers can
// never forget either.
export function createMessage (type, author, clock, fields = {}) {
  return {
    v: PROTOCOL_VERSION,
    type,
    id: randomId(),
    ts: Date.now(),
    clock,
    author,
    ...fields
  }
}

export const text = (author, clock, body) =>
  createMessage('text', author, clock, { body })

export const file = (author, clock, meta) =>
  createMessage('file', author, clock, meta)

export const presence = (author, clock, status) =>
  createMessage('presence', author, clock, { status })

export const system = (author, clock, event, subject = '') =>
  createMessage('system', author, clock, { event, subject })

export const nick = (author, clock, name) =>
  createMessage('nick', author, clock, { nick: name })

export function randomId () {
  const bytes = new Uint8Array(8)
  globalThis.crypto.getRandomValues(bytes)
  return b4a.toString(b4a.from(bytes), 'hex')
}

function typeCode (type) {
  const code = MESSAGE_TYPE[String(type).toUpperCase()]
  if (code === undefined) throw new UnknownMessageTypeError(type)
  return code
}

function hexToBuffer (hex) {
  const buf = b4a.from(hex, 'hex')
  if (buf.byteLength !== 32) {
    throw new Error(`expected a 32-byte hex value, got ${buf.byteLength} bytes`)
  }
  return buf
}

export { UnknownMessageTypeError }
