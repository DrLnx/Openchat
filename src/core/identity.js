// Tier 2 — local identity. One Ed25519 keypair per install, derived from a
// 32-byte seed stored at ~/.openchat/identity.json with 0600 permissions.
//
// Only the seed is persisted; the keypair is re-derived on load. That makes the
// backup story trivial — a BIP39 mnemonic of the seed restores the same
// identity on another machine, and your messages keep the same author key.

import { readFile, writeFile, mkdir, chmod, rename } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import b4a from 'b4a'
import * as bip39 from 'bip39'

import { keyPairFromSeed } from './crypto-node.js'
import { SEED_BYTES } from '../protocol/constants.js'

const IDENTITY_VERSION = 1

export class Identity {
  constructor ({ seed, nick }) {
    const { publicKey, secretKey } = keyPairFromSeed(seed)
    this.seed = seed
    this.publicKey = publicKey
    this.secretKey = secretKey
    this.nick = nick || shortKey(publicKey)
  }

  get publicKeyHex () {
    return b4a.toString(this.publicKey, 'hex')
  }

  /** BIP39 mnemonic of the seed — the whole backup. */
  get mnemonic () {
    return bip39.entropyToMnemonic(b4a.toString(this.seed, 'hex'))
  }

  toJSON () {
    return {
      v: IDENTITY_VERSION,
      seed: b4a.toString(this.seed, 'hex'),
      publicKey: this.publicKeyHex,
      nick: this.nick
    }
  }
}

export function identityPath (dir) {
  return path.join(dir, 'identity.json')
}

/** True when this profile has an identity already — i.e. it has been set up. */
export async function hasIdentity (dir) {
  try {
    await readFile(identityPath(dir), 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * Load the local identity, creating one on first run.
 * @param {{ dir: string, nick?: string }} opts
 */
export async function loadIdentity (opts = {}) {
  const dir = opts.dir
  if (!dir) throw new Error('loadIdentity needs a profile directory')
  const file = identityPath(dir)

  let contents
  try {
    contents = await readFile(file, 'utf8')
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }

  if (contents !== undefined) {
    // Never silently replace an identity: losing it means losing the ability to
    // post as yourself, and no server can reissue it. Fail loudly and point at
    // the recovery phrase instead.
    let raw
    try {
      raw = JSON.parse(contents)
    } catch {
      throw new Error(
        `${file} is not valid JSON. Do not delete it — if you have your recovery ` +
        'phrase, move the file aside and run `openchat restore <phrase>`.'
      )
    }

    if (raw.v !== IDENTITY_VERSION) {
      throw new Error(`identity file is v${raw.v}, this build expects v${IDENTITY_VERSION}`)
    }
    if (typeof raw.seed !== 'string' || !/^[0-9a-f]{64}$/i.test(raw.seed)) {
      throw new Error(`${file} has no usable key. Restore with \`openchat restore <phrase>\`.`)
    }

    return new Identity({ seed: b4a.from(raw.seed, 'hex'), nick: raw.nick })
  }

  const identity = new Identity({ seed: b4a.from(randomBytes(SEED_BYTES)), nick: opts.nick })
  await saveIdentity(identity, dir)
  return identity
}

export async function saveIdentity (identity, dir) {
  await mkdir(dir, { recursive: true })
  const file = identityPath(dir)

  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(identity.toJSON(), null, 2), { mode: 0o600 })
  await rename(temporary, file)
  // writeFile only applies `mode` when it creates the file; re-assert it so an
  // identity written before this rule existed gets locked down too.
  await chmod(file, 0o600)
  return identity
}

/** Restore an identity from a BIP39 mnemonic, overwriting the local one. */
export async function restoreFromMnemonic (mnemonic, opts = {}) {
  const normalized = mnemonic.trim().split(/\s+/).join(' ')
  if (!bip39.validateMnemonic(normalized)) throw new Error('invalid recovery phrase')

  const seed = b4a.from(bip39.mnemonicToEntropy(normalized), 'hex')
  const identity = new Identity({ seed, nick: opts.nick })
  await saveIdentity(identity, opts.dir)
  return identity
}

export function shortKey (key) {
  const hex = typeof key === 'string' ? key : b4a.toString(key, 'hex')
  return hex.slice(0, 8)
}
