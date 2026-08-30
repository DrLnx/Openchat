// Tier 1 — portable. Invite strings: the only way into a room.
//
// The security of the whole product rests on the split encoded here. The
// discovery topic is derived from the room key and is public — it is what gets
// announced to the DHT, so anyone can find the swarm and connect to it. The
// encryption key is a separate 32-byte secret that never touches the network.
// Without it a peer who finds the room can hold a connection open and read
// nothing.
//
// An invite carries both, which is why it must travel out of band: a voice
// call, a QR code, an already-secure channel. Anyone who sees the string is a
// member.

import c from 'compact-encoding'
import b4a from 'b4a'
import { sha256 } from '@noble/hashes/sha2.js'

import { PROTOCOL_VERSION, ENCRYPTION_KEY_BYTES } from './constants.js'

export const INVITE_PREFIX = 'openchat1:'

const TOPIC_CONTEXT = b4a.from('openchat:topic:v1', 'ascii')

export class InviteError extends Error {
  constructor (message, code) {
    super(message)
    this.name = 'InviteError'
    this.code = code
  }
}

const invitePayload = {
  preencode (state, i) {
    c.uint.preencode(state, i.v)
    c.fixed32.preencode(state, i.roomKey)
    c.fixed32.preencode(state, i.encryptionKey)
    c.string.preencode(state, i.name)
  },
  encode (state, i) {
    c.uint.encode(state, i.v)
    c.fixed32.encode(state, i.roomKey)
    c.fixed32.encode(state, i.encryptionKey)
    c.string.encode(state, i.name)
  },
  decode (state) {
    return {
      v: c.uint.decode(state),
      roomKey: c.fixed32.decode(state),
      encryptionKey: c.fixed32.decode(state),
      name: c.string.decode(state)
    }
  }
}

/**
 * The public DHT topic for a room. Derived rather than carried in the invite —
 * one less thing that can disagree, and it keeps the invite short.
 *
 * @param {Uint8Array} roomKey 32-byte Autobase bootstrap key
 * @returns {Uint8Array} 32-byte topic
 */
export function topicFor (roomKey) {
  const input = b4a.alloc(TOPIC_CONTEXT.byteLength + roomKey.byteLength)
  b4a.copy(TOPIC_CONTEXT, input, 0)
  b4a.copy(roomKey, input, TOPIC_CONTEXT.byteLength)
  return b4a.from(sha256(input))
}

/**
 * @param {{ roomKey: Uint8Array, encryptionKey: Uint8Array, name: string }} room
 * @returns {string} an `openchat1:` prefixed, base64url invite
 */
export function encodeInvite ({ roomKey, encryptionKey, name }) {
  assertLength(roomKey, 32, 'roomKey')
  assertLength(encryptionKey, ENCRYPTION_KEY_BYTES, 'encryptionKey')

  const buf = c.encode(invitePayload, {
    v: PROTOCOL_VERSION,
    roomKey,
    encryptionKey,
    name: name || ''
  })
  return INVITE_PREFIX + base64urlEncode(buf)
}

/**
 * @param {string} invite
 * @returns {{ v: number, roomKey: Uint8Array, encryptionKey: Uint8Array, name: string, topic: Uint8Array }}
 * @throws {InviteError} if malformed or from an unsupported protocol version
 */
export function decodeInvite (invite) {
  if (typeof invite !== 'string') throw new InviteError('invite must be a string', 'BAD_INPUT')

  const trimmed = invite.trim()
  if (!trimmed.startsWith(INVITE_PREFIX)) {
    throw new InviteError(`invite must start with "${INVITE_PREFIX}"`, 'BAD_PREFIX')
  }

  let decoded
  try {
    decoded = c.decode(invitePayload, base64urlDecode(trimmed.slice(INVITE_PREFIX.length)))
  } catch {
    throw new InviteError('invite is malformed or truncated', 'MALFORMED')
  }

  if (decoded.v !== PROTOCOL_VERSION) {
    throw new InviteError(
      `invite is protocol v${decoded.v}, this build speaks v${PROTOCOL_VERSION}`,
      'BAD_VERSION'
    )
  }

  return { ...decoded, topic: topicFor(decoded.roomKey) }
}

function base64urlEncode (buf) {
  return b4a.toString(buf, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecode (str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/')
  return b4a.from(padded, 'base64')
}

function assertLength (value, expected, name) {
  if (!value || value.byteLength !== expected) {
    throw new InviteError(`${name} must be ${expected} bytes`, 'BAD_ARGUMENT')
  }
}
