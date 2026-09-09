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
import { Identity, identityPath, hasIdentity, saveIdentity } from './identity.js'
import { COMMANDS } from '../ui/model/commands.js'
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
 * Create an account: a fresh keypair in a profile directory of its own.
 *
 * There is no way to bring an identity in from somewhere else. A keypair is
 * generated where it is used and never travels, so an account made here has
 * never existed anywhere before this call.
 *
 * @param {object} options
 * @param {string} options.profile
 * @param {string} [options.nick]
 * @returns {Promise<{ profile: string, dir: string, publicKey: string, mnemonic: string }>}
 */
export async function createAccount ({ profile, nick }) {
  const name = sanitizeProfile(profile)
  const dir = profileDir(name)

  if (await hasIdentity(dir)) {
    throw new Error(`"${name}" already has an identity — switch to it instead of overwriting it`)
  }

  const identity = new Identity({ seed: backend.randomBytes(SEED_BYTES), nick })
  await saveIdentity(identity, dir)

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

/**
 * The account named by a bare argument to `openchat`, if that is what it is.
 *
 * `openchat work` opens the account called work. `openchat whoami` is somebody
 * reaching for a subcommand that has never existed, because that answer lives
 * behind `:whoami` inside the app. The two are the same shape on a command
 * line, so something has to decide between them, and it may as well be one
 * function with a test rather than a condition buried in an entry point.
 *
 * The rule, in order: nothing typed means the account you used last; more than
 * one word cannot be an account name; an account that already exists always
 * wins, whatever it is called; and of what is left, anything named after a
 * slash command is taken as somebody looking for that command. Everything else
 * is a new account, which is the whole point of being able to name one.
 *
 * @param {string[]} args  the non-flag arguments, in order
 * @returns {Promise<string|null>} the account name, '' for none, null when the
 *          argument is not an account name at all
 */
export async function resolveAccountArg (args = []) {
  if (args.length === 0) return ''
  if (args.length > 1) return null

  const [name] = args
  if (typeof name !== 'string' || name === '' || name.startsWith('-')) return null
  if (await profileExists(sanitizeProfile(name))) return name
  if (COMMANDS.some((command) => command.name === name.toLowerCase())) return null

  return name
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
