// Tier 1 — portable. Runs unchanged in Node and in the browser.
//
// Every wire format in openchat is versioned from the first commit so the
// schema can evolve without invalidating invites already in circulation.

export const PROTOCOL_VERSION = 1

// Envelope framing.
export const ENVELOPE_MAGIC = 'OCH' // 3 bytes, ASCII
export const MAGIC_BYTES = 3
export const VERSION_BYTES = 1
export const PUBKEY_BYTES = 32
export const IV_BYTES = 12 // AES-GCM standard IV length
export const LENGTH_BYTES = 4
export const SIGNATURE_BYTES = 64
export const GCM_TAG_BYTES = 16
export const ENCRYPTION_KEY_BYTES = 32
export const SEED_BYTES = 32

export const HEADER_BYTES =
  MAGIC_BYTES + VERSION_BYTES + PUBKEY_BYTES + IV_BYTES + LENGTH_BYTES

// Message types, encoded as a uint on the wire. Never renumber these — append
// only, so a v1 peer decoding a v2 message fails cleanly on an unknown type
// rather than silently misreading a known one.
export const MESSAGE_TYPE = {
  TEXT: 0,
  FILE: 1,
  PRESENCE: 2,
  SYSTEM: 3,
  NICK: 4
}

export const MESSAGE_TYPE_NAME = {
  0: 'text',
  1: 'file',
  2: 'presence',
  3: 'system',
  4: 'nick'
}

export const PRESENCE_STATUS = { online: 0, typing: 1, offline: 2 }
export const PRESENCE_STATUS_NAME = { 0: 'online', 1: 'typing', 2: 'offline' }

export const SYSTEM_EVENT = { join: 0, leave: 1, 'writer-added': 2 }
export const SYSTEM_EVENT_NAME = { 0: 'join', 1: 'leave', 2: 'writer-added' }

// Attachments below this size are fetched automatically on arrival; larger ones
// wait for an explicit `/download <id>`.
export const DEFAULT_AUTO_DOWNLOAD_BYTES = 5 * 1024 * 1024
