// Tier 2 — Node crypto backend. Same interface as `protocol/crypto-web.js`,
// same algorithms, byte-identical output (proven in test/unit/vectors.test.js).
//
// AES-GCM comes from node:crypto rather than sodium: libsodium's AES-256-GCM
// binding is gated on a runtime hardware check and would leave us with a
// backend that works on some machines and not others, while WebCrypto in the
// browser always has it. Ed25519 comes from sodium, which is what Hypercore
// itself signs with, so identity keys are the same primitive top to bottom.

import { createCipheriv, createDecipheriv, randomBytes as nodeRandomBytes, createHash } from 'node:crypto'
import sodium from 'sodium-native'
import b4a from 'b4a'

import { GCM_TAG_BYTES, SEED_BYTES } from '../protocol/constants.js'

export const name = 'node'

export function randomBytes (n) {
  return b4a.from(nodeRandomBytes(n))
}

export async function encrypt (key, iv, plaintext, aad) {
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: GCM_TAG_BYTES })
  cipher.setAAD(b4a.from(aad))
  const body = Buffer.concat([cipher.update(b4a.from(plaintext)), cipher.final()])
  // WebCrypto appends the tag to the ciphertext; node keeps it separate, so
  // concatenate to match the shared frame layout.
  return b4a.from(Buffer.concat([body, cipher.getAuthTag()]))
}

export async function decrypt (key, iv, ciphertext, aad) {
  if (ciphertext.byteLength < GCM_TAG_BYTES) throw new Error('ciphertext too short for a GCM tag')

  const body = b4a.from(ciphertext.subarray(0, ciphertext.byteLength - GCM_TAG_BYTES))
  const tag = b4a.from(ciphertext.subarray(ciphertext.byteLength - GCM_TAG_BYTES))

  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: GCM_TAG_BYTES })
  decipher.setAAD(b4a.from(aad))
  decipher.setAuthTag(tag)
  return b4a.from(Buffer.concat([decipher.update(body), decipher.final()]))
}

/**
 * @param {Uint8Array} seed 32-byte Ed25519 seed
 */
export async function sign (seed, data) {
  const { secretKey } = keyPairFromSeed(seed)
  const signature = b4a.alloc(sodium.crypto_sign_BYTES)
  sodium.crypto_sign_detached(signature, b4a.from(data), secretKey)
  return signature
}

export async function verify (publicKey, signature, data) {
  return sodium.crypto_sign_verify_detached(
    b4a.from(signature),
    b4a.from(data),
    b4a.from(publicKey)
  )
}

export async function publicKeyFromSeed (seed) {
  return keyPairFromSeed(seed).publicKey
}

export function sha256 (data) {
  return b4a.from(createHash('sha256').update(b4a.from(data)).digest())
}

/**
 * Deterministically derive an Ed25519 keypair from a 32-byte seed. The seed is
 * the only thing worth backing up — everything else follows from it.
 */
export function keyPairFromSeed (seed) {
  if (!seed || seed.byteLength !== SEED_BYTES) {
    throw new Error(`seed must be ${SEED_BYTES} bytes`)
  }
  const publicKey = b4a.alloc(sodium.crypto_sign_PUBLICKEYBYTES)
  const secretKey = b4a.alloc(sodium.crypto_sign_SECRETKEYBYTES)
  sodium.crypto_sign_seed_keypair(publicKey, secretKey, b4a.from(seed))
  return { publicKey, secretKey }
}

export default { name, randomBytes, encrypt, decrypt, sign, verify, publicKeyFromSeed, sha256, keyPairFromSeed }
