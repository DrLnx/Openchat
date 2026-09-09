// Tier 2 — on-disk state: the Corestore that holds every hypercore, and the
// database that remembers which accounts exist and what each of them knows.
//
// Everything the UI renders is derived from the store, never from memory alone.
// That is what makes an offline member catching up work: the logs are already
// on disk, replication just fills in the gaps.
//
// State is scoped to a *profile*, so one machine can hold several independent
// identities — one per terminal, if you like. Profiles share nothing: separate
// keys, separate stores, separate rooms.
//
// This file is where a profile is decided; accounts-db.js is where it is kept.
// The split matters because there are two places a database can be, and which
// one you get is a question about the *directory*, not about SQL:
//
//   ~/.openchat/profiles/<name>   a managed account. Its row lives in the one
//                                 database at ~/.openchat/openchat.db, along
//                                 with every other account and the record of
//                                 which one is in use.
//   anywhere else                 a directory pointed at directly, which is what
//                                 OPENCHAT_DIR means and what every test peer
//                                 is. That directory *is* the profile, so it
//                                 carries its own database and shares nothing.
//
// Every function below reads and writes the same shapes it always did. The
// callers were never told where a config was kept and still are not.

import os from 'node:os'
import path from 'node:path'
import { mkdir, rm } from 'node:fs/promises'
import Corestore from 'corestore'
import b4a from 'b4a'

import { openAccounts, defaultConfig, DB_FILE } from './accounts-db.js'

export { defaultConfig }

export const DEFAULT_PROFILE = 'default'

/** Everything openchat owns on this machine. */
export function rootDir () {
  return process.env.OPENCHAT_HOME || path.join(os.homedir(), '.openchat')
}

/**
 * Where one profile lives.
 *
 * OPENCHAT_DIR overrides the lot and points straight at a profile directory —
 * that is how the tests keep each peer isolated, and it predates profiles.
 */
export function profileDir (name = DEFAULT_PROFILE) {
  if (process.env.OPENCHAT_DIR) return process.env.OPENCHAT_DIR
  return path.join(rootDir(), 'profiles', sanitizeProfile(name))
}

/** The one database that knows what accounts this machine has. */
function registry () {
  return openAccounts(path.join(rootDir(), DB_FILE))
}

/**
 * Which database holds a directory's account, and under what name.
 *
 * A managed profile is a row in the machine's database. Anything else is a
 * directory somebody pointed at, and it keeps its own — see the note at the top
 * of this file.
 */
function accountFor (dir) {
  const resolved = path.resolve(dir)
  const managed = path.resolve(path.join(rootDir(), 'profiles'))

  if (path.dirname(resolved) === managed) {
    return { store: registry(), profile: path.basename(resolved) }
  }
  return { store: openAccounts(path.join(resolved, DB_FILE)), profile: DEFAULT_PROFILE }
}

/** The profile in use when none is named: the last one logged into. */
export async function currentProfile () {
  if (process.env.OPENCHAT_PROFILE) return sanitizeProfile(process.env.OPENCHAT_PROFILE)
  const current = registry().current()
  return current ? sanitizeProfile(current) : DEFAULT_PROFILE
}

export async function setCurrentProfile (name) {
  registry().setCurrent(sanitizeProfile(name))
  return name
}

/**
 * Every account on this machine.
 *
 * A row, not a directory. A directory with a key in it and no row is something
 * that was half-made and then abandoned — which used to be indistinguishable
 * from an account and is how a machine ends up listing three of them that
 * nobody meant to create.
 */
export async function listProfiles () {
  return registry().list()
}

export async function profileExists (name) {
  return registry().has(sanitizeProfile(name))
}

export async function deleteProfile (name) {
  const profile = sanitizeProfile(name)
  registry().remove(profile)
  await rm(path.join(rootDir(), 'profiles', profile), { recursive: true, force: true })
}

/**
 * Profile names become directory names, so they must not be able to climb out
 * of the profiles directory or collide with each other by case on a
 * case-insensitive filesystem.
 */
export function sanitizeProfile (name) {
  const cleaned = String(name || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-')
  if (!cleaned || cleaned === '.' || cleaned === '..') return DEFAULT_PROFILE
  return cleaned.slice(0, 40)
}

export function storePath (dir) {
  return path.join(dir, 'store')
}

/**
 * Open a profile's storage.
 *
 * An account can only be open in one process at a time — hypercore takes an
 * exclusive lock on its storage, and two writers to one log would fork it. That
 * is the right behaviour, but the error it fails with ("File descriptor could
 * not be locked") tells you nothing about what you did or what to do instead,
 * which is a bad way to find out that a second terminal needs a second account.
 */
export async function openStore (dir) {
  await mkdir(dir, { recursive: true })
  const store = new Corestore(storePath(dir))

  try {
    await store.ready()
  } catch (err) {
    if (isLocked(err)) throw new AccountInUseError(dir)
    throw err
  }

  return store
}

/** Whichever way the storage layer phrases "someone else holds the lock". */
function isLocked (err) {
  return /could not be locked|EBUSY|ELOCKED|resource temporarily unavailable/i.test(err?.message || '')
}

export class AccountInUseError extends Error {
  constructor (dir) {
    const profile = path.basename(dir)
    super(
      `the account "${profile}" is already open in another terminal.\n` +
      'An account can only be open once — its message log is a single writer.\n' +
      'To run a second account alongside it: openchat --profile <another-name>\n' +
      'Anything you type there is a separate identity, with its own keypair.'
    )
    this.name = 'AccountInUseError'
    this.profile = profile
    this.code = 'ACCOUNT_IN_USE'
  }
}

/**
 * Everything one account knows, as one object.
 *
 * Reading an account that has no row is not an error — it is a directory with a
 * key in it and nothing said about it yet, which is exactly where onboarding
 * leaves you — so it comes back as the defaults.
 */
export async function readConfig (dir) {
  const { store, profile } = accountFor(dir)
  return store.read(profile) ?? defaultConfig()
}

export async function writeConfig (config, dir) {
  await mkdir(dir, { recursive: true })
  const { store, profile } = accountFor(dir)
  store.write(profile, config)
  return config
}

/**
 * Record a room this profile has joined. Keyed by room key, so re-joining an
 * existing room updates it rather than duplicating it.
 */
export async function rememberRoom (room, dir) {
  const config = await readConfig(dir)
  const key = b4a.toString(room.roomKey, 'hex')
  const entry = {
    key,
    name: room.name,
    encryptionKey: b4a.toString(room.encryptionKey, 'hex'),
    namespace: room.namespace,
    joinedAt: Date.now()
  }

  const existing = config.rooms.findIndex((r) => r.key === key)
  if (existing === -1) config.rooms.push(entry)
  else config.rooms[existing] = { ...config.rooms[existing], ...entry }

  config.lastRoom = key
  await writeConfig(config, dir)
  return entry
}

export async function forgetRoom (roomKeyHex, dir) {
  const config = await readConfig(dir)
  config.rooms = config.rooms.filter((r) => r.key !== roomKeyHex)
  if (config.lastRoom === roomKeyHex) config.lastRoom = config.rooms.at(-1)?.key ?? null
  await writeConfig(config, dir)
  return config
}

/** Drop a direct conversation from the config, the way forgetRoom does. */
export async function forgetDm (peerKeyHex, dir) {
  const config = await readConfig(dir)
  config.dms = (config.dms || []).filter((d) => d.key !== peerKeyHex)
  if (config.lastRoom === `dm:${peerKeyHex}`) config.lastRoom = null
  await writeConfig(config, dir)
  return config
}

/** Inflate a stored room entry back into buffers. */
export function roomFromConfig (entry) {
  return {
    roomKey: b4a.from(entry.key, 'hex'),
    encryptionKey: b4a.from(entry.encryptionKey, 'hex'),
    name: entry.name,
    namespace: entry.namespace
  }
}

// --- Contacts -------------------------------------------------------------
//
// There is no global user directory in a serverless network — no server to hold
// one. You reach someone because you have their key: from a room you share, or
// from a keycard they handed you. Contacts are just local names for keys.

export async function addContact ({ key, name }, dir) {
  const config = await readConfig(dir)
  const existing = config.contacts.find((c) => c.key === key)

  if (existing) {
    existing.name = name || existing.name
  } else {
    config.contacts.push({ key, name, addedAt: Date.now(), verifiedAt: null })
  }

  await writeConfig(config, dir)
  return config.contacts.find((c) => c.key === key)
}

export async function removeContact (key, dir) {
  const config = await readConfig(dir)
  config.contacts = config.contacts.filter((c) => c.key !== key)
  await writeConfig(config, dir)
  return config
}

/**
 * Resolve what someone typed to a public key: a full hex key, a unique key
 * prefix, or a contact's name.
 */
export function resolvePeer (input, config) {
  const query = String(input || '').trim()
  if (!query) return null

  const byName = config.contacts.filter(
    (c) => c.name && c.name.toLowerCase() === query.toLowerCase()
  )
  if (byName.length === 1) return byName[0].key

  if (/^[0-9a-f]{64}$/i.test(query)) return query.toLowerCase()

  if (/^[0-9a-f]{4,}$/i.test(query)) {
    const candidates = new Set(
      config.contacts.map((c) => c.key).concat(config.dms.map((d) => d.key))
    )
    const matches = [...candidates].filter((k) => k.startsWith(query.toLowerCase()))
    if (matches.length === 1) return matches[0]
    if (matches.length > 1) throw new Error(`"${query}" matches ${matches.length} people — use more characters`)
  }

  return null
}

/**
 * Remember that we have a conversation with someone.
 *
 * `name` is a label you chose for them and `announced` is the name they gave
 * themselves — kept apart so that a nick change on their side cannot quietly
 * rename a contact you named, and so a conversation opened from a bare public
 * key still has something to be called before they are online.
 */
export async function rememberDm ({ key, name, announced, outbox }, dir) {
  const config = await readConfig(dir)
  const existing = config.dms.find((d) => d.key === key)

  if (existing) {
    if (name) existing.name = name
    if (announced) existing.announced = announced
    if (outbox) existing.outbox = outbox
  } else {
    config.dms.push({
      key,
      name: name || null,
      announced: announced || null,
      outbox: outbox || null,
      startedAt: Date.now()
    })
  }

  await writeConfig(config, dir)
  return config.dms.find((d) => d.key === key)
}
