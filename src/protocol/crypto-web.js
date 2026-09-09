// Tier 1 — portable crypto backend: WebCrypto AES-256-GCM + @noble Ed25519.
//
// A second, independent implementation of the same interface as the sodium
// backend the app actually runs on, kept because a wire format with one
// implementation is a wire format nobody has checked. test/unit/vectors.test.js
// makes each backend open what the other sealed, so a change to the envelope
// that is wrong in the same direction in both places still has to get past a
// frozen vector. Node has WebCrypto built in, so this costs nothing to run.

import b4a from 'b4a'
import * as ed from '@noble/ed25519'
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js'

const subtle = () => {
  const c = globalThis.crypto?.subtle
  if (!c) throw new Error('WebCrypto is unavailable in this environment')
  return c
}

const keyCache = new Map()

async function importKey (key) {
  const id = b4a.toString(key, 'hex')
  let promise = keyCache.get(id)
  if (!promise) {
    promise = subtle().importKey('raw', toArrayBuffer(key), 'AES-GCM', false, ['encrypt', 'decrypt'])
    keyCache.set(id, promise)
  }
  return promise
}

export const name = 'web'

export function randomBytes (n) {
  const bytes = new Uint8Array(n)
  globalThis.crypto.getRandomValues(bytes)
  return b4a.from(bytes)
}

export async function encrypt (key, iv, plaintext, aad) {
  const cryptoKey = await importKey(key)
  const out = await subtle().encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv), additionalData: toArrayBuffer(aad), tagLength: 128 },
    cryptoKey,
    toArrayBuffer(plaintext)
  )
  return b4a.from(new Uint8Array(out))
}

export async function decrypt (key, iv, ciphertext, aad) {
  const cryptoKey = await importKey(key)
  const out = await subtle().decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv), additionalData: toArrayBuffer(aad), tagLength: 128 },
    cryptoKey,
    toArrayBuffer(ciphertext)
  )
  return b4a.from(new Uint8Array(out))
}

/**
 * @param {Uint8Array} seed 32-byte Ed25519 seed (not the 64-byte sodium key)
 */
export async function sign (seed, data) {
  return b4a.from(await ed.signAsync(toUint8(data), toUint8(seed)))
}

export async function verify (publicKey, signature, data) {
  try {
    return await ed.verifyAsync(toUint8(signature), toUint8(data), toUint8(publicKey))
  } catch {
    return false
  }
}

export async function publicKeyFromSeed (seed) {
  return b4a.from(await ed.getPublicKeyAsync(toUint8(seed)))
}

// Synchronous, to match the node backend's hash signature — WebCrypto's digest
// is async, so use @noble/hashes (already a dependency via the invite module).
export function sha256 (data) {
  return b4a.from(nobleSha256(toUint8(data)))
}

function toUint8 (v) {
  if (v instanceof Uint8Array) return v
  return new Uint8Array(v)
}

function toArrayBuffer (v) {
  const u8 = toUint8(v)
  if (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength) return u8.buffer
  // Copy out of the backing buffer. Note `new Uint8Array(u8)` and not
  // `u8.slice()`: on a Node Buffer, `slice` is the deprecated alias for
  // `subarray`, so `.slice().buffer` would hand WebCrypto the entire 8KB
  // allocation pool instead of these 32 bytes.
  return new Uint8Array(u8).buffer
}

export default { name, randomBytes, encrypt, decrypt, sign, verify, publicKeyFromSeed, sha256 }
