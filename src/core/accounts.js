// Tier 2 — the accounts on this machine.
//
// An account here is not a row in anyone's database: it is a keypair in a
// directory, with a username attached so you have something to call it. That is
// the whole model, and it is why you can have as many as you like — one for
// work, one for a project, one that is not linked to your name — with nothing
// to sign up for and nobody to tell.
//
// This reads the profile directories directly rather than opening each one's
// hypercore store, because listing your accounts should not cost a disk full of
// cores being opened and closed.

import { readFile } from 'node:fs/promises'
import b4a from 'b4a'

import {
  listProfiles, profileDir, currentProfile, setCurrentProfile, sanitizeProfile,
  profileExists, readConfig, writeConfig, DEFAULT_PROFILE
} from './store.js'
import { Identity, identityPath, hasIdentity, saveIdentity, restoreFromMnemonic } from './identity.js'
import { SEED_BYTES } from '../protocol/constants.js'
import backend from './crypto-node.js'

/**
 * @typedef {object} Account
 * @property {string} profile     directory name, and what --profile takes
 * @property {string|null} nick   what people see
 * @property {string|null} publicKey
 * @property {boolean} current
 * @property {boolean} ready      false for a directory with no identity yet
 * @property {number} rooms
 * @property {number} dms
 */

/** Every account on this machine, current one first. */
export async function listAccounts () {
  const [names, current] = await Promise.all([listProfiles(), currentProfile()])

  // A machine with no accounts yet still has one to offer: the profile the
  // next `openchat` would open. Once real ones exist, list only those — a
  // "default" nobody has set up is a row that does nothing.
  const all = names.length === 0 ? [current] : names

  const accounts = await Promise.all(all.map((profile) => describeAccount(profile, current)))
  return accounts.sort((a, b) => (
    Number(b.current) - Number(a.current) || a.profile.localeCompare(b.profile)
  ))
}

export async function describeAccount (profile, current = null) {
  const dir = profileDir(profile)
  const [identity, config] = await Promise.all([readIdentity(dir), readConfig(dir).catch(() => null)])

  return {
    profile,
    dir,
    nick: config?.nick || identity?.nick || null,
    publicKey: identity?.publicKey || null,
    ready: Boolean(identity),
    current: current === null ? profile === (await currentProfile()) : profile === current,
    rooms: config?.rooms?.length || 0,
    dms: config?.dms?.length || 0
  }
}

/**
 * Create an account, or restore one from its recovery phrase.
 *
 * Restoring is how you have the *same* identity on a second machine: the
 * mnemonic is the seed, the seed is the keypair, and the keypair is who you
 * are. There is nothing else to move across.
 *
 * @param {object} options
 * @param {string} options.profile
 * @param {string} [options.nick]
 * @param {string} [options.mnemonic]  restore instead of generating
 * @returns {Promise<{ profile: string, dir: string, publicKey: string, mnemonic: string }>}
 */
export async function createAccount ({ profile, nick, mnemonic }) {
  const name = sanitizeProfile(profile)
  const dir = profileDir(name)

  if (await hasIdentity(dir)) {
    throw new Error(`"${name}" already has an identity — switch to it instead of overwriting it`)
  }

  const identity = mnemonic
    ? await restoreFromMnemonic(mnemonic, { dir, nick: nick || undefined })
    : new Identity({ seed: backend.randomBytes(SEED_BYTES), nick })

  if (!mnemonic) await saveIdentity(identity, dir)

  const config = await readConfig(dir)
  config.nick = identity.nick
  config.onboarded = true
  await writeConfig(config, dir)

  return {
    profile: name,
    dir,
    nick: identity.nick,
    publicKey: identity.publicKeyHex,
    mnemonic: identity.mnemonic
  }
}

/** Remember which account to open next time, so `openchat` alone resumes it. */
export async function useAccount (profile) {
  const name = sanitizeProfile(profile)
  await setCurrentProfile(name)
  return name
}

/** A profile name nobody is using yet, for the "new account" prompt. */
export async function suggestProfile (base = 'account') {
  const seed = sanitizeProfile(base)
  if (!(await profileExists(seed)) && seed !== DEFAULT_PROFILE) return seed

  for (let i = 2; i < 100; i++) {
    const candidate = sanitizeProfile(`${seed}-${i}`)
    if (!(await profileExists(candidate))) return candidate
  }
  return sanitizeProfile(`${seed}-${Date.now()}`)
}

async function readIdentity (dir) {
  try {
    const raw = JSON.parse(await readFile(identityPath(dir), 'utf8'))
    if (raw.publicKey) return { publicKey: raw.publicKey, nick: raw.nick || null }
    // Older files stored only the seed; deriving is cheap enough for a list.
    const identity = new Identity({ seed: b4a.from(raw.seed, 'hex'), nick: raw.nick })
    return { publicKey: identity.publicKeyHex, nick: identity.nick }
  } catch {
    return null
  }
}
