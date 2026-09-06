// Tier 2 — on-disk state: the Corestore that holds every hypercore, plus the
// small JSON config that remembers which rooms and people this profile knows.
//
// Everything the UI renders is derived from the store, never from memory alone.
// That is what makes an offline member catching up work: the logs are already
// on disk, replication just fills in the gaps.
//
// State is scoped to a *profile*, so one machine can hold several independent
// identities — one per terminal, if you like. Profiles share nothing: separate
// keys, separate stores, separate rooms.

import os from 'node:os'
import path from 'node:path'
import { readFile, writeFile, mkdir, readdir, rm, rename } from 'node:fs/promises'
import Corestore from 'corestore'
import b4a from 'b4a'

import { DEFAULT_AUTO_DOWNLOAD_BYTES } from '../protocol/constants.js'

const CONFIG_VERSION = 1

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

/** The profile in use when none is named: the last one logged into. */
export async function currentProfile () {
  if (process.env.OPENCHAT_PROFILE) return sanitizeProfile(process.env.OPENCHAT_PROFILE)
  try {
    const raw = JSON.parse(await readFile(path.join(rootDir(), 'current.json'), 'utf8'))
    return raw.profile ? sanitizeProfile(raw.profile) : DEFAULT_PROFILE
  } catch {
    return DEFAULT_PROFILE
  }
}

export async function setCurrentProfile (name) {
  await mkdir(rootDir(), { recursive: true })
  await writeFile(
    path.join(rootDir(), 'current.json'),
    JSON.stringify({ profile: sanitizeProfile(name) }, null, 2),
    { mode: 0o600 }
  )
  return name
}

export async function listProfiles () {
  try {
    const entries = await readdir(path.join(rootDir(), 'profiles'), { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

export async function profileExists (name) {
  return (await listProfiles()).includes(sanitizeProfile(name))
}

export async function deleteProfile (name) {
  const dir = path.join(rootDir(), 'profiles', sanitizeProfile(name))
  await rm(dir, { recursive: true, force: true })
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

export function configPath (dir) {
  return path.join(dir, 'config.json')
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

export function defaultConfig () {
  return {
    v: CONFIG_VERSION,
    nick: null,
    autoDownloadBytes: DEFAULT_AUTO_DOWNLOAD_BYTES,
    rooms: [],
    contacts: [], // [{ key, name, addedAt, verifiedAt }]
    dms: [], // [{ key, name, outbox }] — peers we have a conversation with
    lastRoom: null,
    onboarded: false
  }
}

export async function readConfig (dir) {
  let raw
  try {
    raw = await readFile(configPath(dir), 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return defaultConfig()
    throw err
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    // A truncated write or a hand-edit should not be a stack trace on startup.
    // Keep the damaged file so nothing is silently destroyed, and carry on with
    // defaults — identity lives in a separate file and is unaffected.
    const salvaged = `${configPath(dir)}.corrupt-${Date.now()}`
    await writeFile(salvaged, raw).catch(() => {})
    return { ...defaultConfig(), recovered: salvaged }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaultConfig()

  // Coerce the collections: a config edited by hand can have the right keys
  // with the wrong shapes, and everything downstream assumes arrays.
  return {
    ...defaultConfig(),
    ...parsed,
    rooms: Array.isArray(parsed.rooms) ? parsed.rooms.filter(isRoomEntry) : [],
    contacts: Array.isArray(parsed.contacts) ? parsed.contacts.filter(isPeerEntry) : [],
    dms: Array.isArray(parsed.dms) ? parsed.dms.filter(isPeerEntry) : []
  }
}

const HEX64 = /^[0-9a-f]{64}$/i

function isRoomEntry (entry) {
  return !!entry && HEX64.test(entry.key || '') && HEX64.test(entry.encryptionKey || '')
}

function isPeerEntry (entry) {
  return !!entry && HEX64.test(entry.key || '')
}

export async function writeConfig (config, dir) {
  await mkdir(dir, { recursive: true })

  // Write-then-rename: a crash between the two leaves the old config intact
  // rather than a half-written one. Renaming within a directory is atomic.
  const target = configPath(dir)
  const temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(config, null, 2), { mode: 0o600 })
  await rename(temporary, target)
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

/** Remember that we have a conversation with someone. */
export async function rememberDm ({ key, name, outbox }, dir) {
  const config = await readConfig(dir)
  const existing = config.dms.find((d) => d.key === key)

  if (existing) {
    if (name) existing.name = name
    if (outbox) existing.outbox = outbox
  } else {
    config.dms.push({ key, name: name || null, outbox: outbox || null, startedAt: Date.now() })
  }

  await writeConfig(config, dir)
  return config.dms.find((d) => d.key === key)
}
