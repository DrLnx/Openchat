// Tier 1 — portable. The encrypted frame layout, defined exactly once.
//
// Two crypto backends implement the primitives (`crypto-node.js` on sodium /
// node:crypto, `crypto-web.js` on WebCrypto / @noble). This module owns the
// byte layout so both produce identical frames — a property test/unit/vectors
// enforces by having each backend decrypt the other's output.
//
//   magic(3) | version(1) | author(32) | iv(12) | len(4, BE) | ciphertext(len) | signature(64)
//
// `ciphertext` includes the 16-byte AES-GCM tag. The header is authenticated
// twice over: as AES-GCM additional data, and by the Ed25519 signature which
// covers everything before it. Signing the ciphertext rather than the plaintext
// lets a receiver reject a forged frame before spending anything on decryption.
//
// The author key is deliberately in the clear. Room membership is already known
// to everyone holding the invite, and it is what makes verify-before-decrypt
// possible. It does mean a passive observer of the transport can see which keys
// are talking, without learning what they said.

import b4a from 'b4a'

import {
  ENVELOPE_MAGIC,
  PROTOCOL_VERSION,
  MAGIC_BYTES,
  VERSION_BYTES,
  PUBKEY_BYTES,
  IV_BYTES,
  LENGTH_BYTES,
  SIGNATURE_BYTES,
  HEADER_BYTES
} from './constants.js'

const MAGIC = b4a.from(ENVELOPE_MAGIC, 'ascii')

export class EnvelopeError extends Error {
  constructor (message, code) {
    super(message)
    this.name = 'EnvelopeError'
    this.code = code
  }
}

/**
 * Encrypt, sign and frame a payload.
 *
 * @param {object} opts
 * @param {object} opts.backend      crypto backend (node or web)
 * @param {Uint8Array} opts.encryptionKey  32-byte room key
 * @param {Uint8Array} opts.seed     32-byte Ed25519 seed of the author
 * @param {Uint8Array} opts.publicKey 32-byte Ed25519 public key of the author
 * @param {Uint8Array} opts.payload  plaintext bytes (an encoded message)
 * @param {Uint8Array} [opts.iv]     override the random IV (tests only)
 * @returns {Promise<Uint8Array>} the framed envelope
 */
export async function seal ({ backend, encryptionKey, seed, publicKey, payload, iv }) {
  assertLength(encryptionKey, 32, 'encryptionKey')
  assertLength(publicKey, PUBKEY_BYTES, 'publicKey')

  const nonce = iv || backend.randomBytes(IV_BYTES)
  assertLength(nonce, IV_BYTES, 'iv')

  const header = b4a.alloc(HEADER_BYTES)
  b4a.copy(MAGIC, header, 0)
  header[MAGIC_BYTES] = PROTOCOL_VERSION
  b4a.copy(publicKey, header, MAGIC_BYTES + VERSION_BYTES)
  b4a.copy(nonce, header, MAGIC_BYTES + VERSION_BYTES + PUBKEY_BYTES)

  const ciphertext = await backend.encrypt(encryptionKey, nonce, payload, header.subarray(0, HEADER_BYTES - LENGTH_BYTES))
  writeUint32BE(header, HEADER_BYTES - LENGTH_BYTES, ciphertext.byteLength)

  const signed = b4a.alloc(HEADER_BYTES + ciphertext.byteLength)
  b4a.copy(header, signed, 0)
  b4a.copy(ciphertext, signed, HEADER_BYTES)

  const signature = await backend.sign(seed, signed)
  assertLength(signature, SIGNATURE_BYTES, 'signature')

  const frame = b4a.alloc(signed.byteLength + SIGNATURE_BYTES)
  b4a.copy(signed, frame, 0)
  b4a.copy(signature, frame, signed.byteLength)
  return frame
}

/**
 * Verify and decrypt a framed envelope.
 *
 * @returns {Promise<{ author: string, payload: Uint8Array }>} author is hex
 * @throws {EnvelopeError} on a malformed frame, bad signature, or failed decrypt
 */
export async function open ({ backend, encryptionKey, frame }) {
  if (frame.byteLength < HEADER_BYTES + SIGNATURE_BYTES) {
    throw new EnvelopeError('frame is shorter than the minimum envelope', 'TRUNCATED')
  }
  if (!b4a.equals(frame.subarray(0, MAGIC_BYTES), MAGIC)) {
    throw new EnvelopeError('not an openchat envelope', 'BAD_MAGIC')
  }

  const version = frame[MAGIC_BYTES]
  if (version !== PROTOCOL_VERSION) {
    throw new EnvelopeError(`unsupported protocol version: ${version}`, 'BAD_VERSION')
  }

  const publicKey = frame.subarray(MAGIC_BYTES + VERSION_BYTES, MAGIC_BYTES + VERSION_BYTES + PUBKEY_BYTES)
  const nonce = frame.subarray(MAGIC_BYTES + VERSION_BYTES + PUBKEY_BYTES, HEADER_BYTES - LENGTH_BYTES)
  const length = readUint32BE(frame, HEADER_BYTES - LENGTH_BYTES)

  if (frame.byteLength !== HEADER_BYTES + length + SIGNATURE_BYTES) {
    throw new EnvelopeError('declared ciphertext length does not match the frame', 'BAD_LENGTH')
  }

  const signed = frame.subarray(0, HEADER_BYTES + length)
  const signature = frame.subarray(HEADER_BYTES + length)

  const valid = await backend.verify(publicKey, signature, signed)
  if (!valid) throw new EnvelopeError('signature verification failed', 'BAD_SIGNATURE')

  const ciphertext = frame.subarray(HEADER_BYTES, HEADER_BYTES + length)
  const aad = frame.subarray(0, HEADER_BYTES - LENGTH_BYTES)

  let payload
  try {
    payload = await backend.decrypt(encryptionKey, nonce, ciphertext, aad)
  } catch {
    // Wrong room key, or a tampered frame the signature check could not catch
    // (a member re-signing someone else's ciphertext, say).
    throw new EnvelopeError('could not decrypt — wrong room key?', 'DECRYPT_FAILED')
  }

  return { author: b4a.toString(publicKey, 'hex'), payload }
}

function writeUint32BE (buf, offset, value) {
  buf[offset] = (value >>> 24) & 0xff
  buf[offset + 1] = (value >>> 16) & 0xff
  buf[offset + 2] = (value >>> 8) & 0xff
  buf[offset + 3] = value & 0xff
}

function readUint32BE (buf, offset) {
  return (
    ((buf[offset] << 24) >>> 0) +
    (buf[offset + 1] << 16) +
    (buf[offset + 2] << 8) +
    buf[offset + 3]
  )
}

function assertLength (value, expected, name) {
  if (!value || value.byteLength !== expected) {
    throw new EnvelopeError(`${name} must be ${expected} bytes`, 'BAD_ARGUMENT')
  }
}
