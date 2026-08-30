// Browser identity. Same Ed25519 keypair-from-seed scheme as the CLI's
// ~/.openchat/identity.json, with localStorage standing in for the file.

import b4a from 'b4a'
import backend from '../src/protocol/crypto-web.js'
import { SEED_BYTES } from '../src/protocol/constants.js'

const SEED_KEY = 'openchat:seed'
const NICK_KEY = 'openchat:nick'

const NICK_WORDS = [
  'ada', 'grace', 'alan', 'edsger', 'barbara', 'donald', 'linus', 'katherine',
  'radia', 'margaret', 'ken', 'dennis'
]

export async function loadIdentity () {
  let seed = readSeed()
  if (!seed) {
    seed = backend.randomBytes(SEED_BYTES)
    store(SEED_KEY, b4a.toString(seed, 'hex'))
  }

  const publicKey = await backend.publicKeyFromSeed(seed)
  const publicKeyHex = b4a.toString(publicKey, 'hex')

  let nick = read(NICK_KEY)
  if (!nick) {
    // Derive a default nick from the key so it is stable per browser.
    const n = parseInt(publicKeyHex.slice(0, 4), 16)
    nick = NICK_WORDS[n % NICK_WORDS.length]
    store(NICK_KEY, nick)
  }

  return {
    seed,
    publicKey,
    publicKeyHex,
    nick,
    setNick (next) {
      this.nick = next
      store(NICK_KEY, next)
    }
  }
}

function readSeed () {
  const hex = read(SEED_KEY)
  if (!hex || hex.length !== SEED_BYTES * 2) return null
  try {
    return b4a.from(hex, 'hex')
  } catch {
    return null
  }
}

// localStorage can throw outright (private windows, blocked site data, preview
// contexts), so every access is guarded and the page works without it.
export function read (key) {
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

export function store (key, value) {
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    /* not fatal: identity just will not survive a reload */
  }
}
