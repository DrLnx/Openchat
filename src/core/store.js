// Tier 2 — on-disk state: the Corestore that holds every hypercore, plus the
// small JSON config that remembers which rooms this install belongs to.
//
// Everything the UI renders is derived from the store, never from memory alone.
// That is what makes an offline member catching up work: the logs are already
// on disk, replication just fills in the gaps.

import os from 'node:os'
import path from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import Corestore from 'corestore'
import b4a from 'b4a'

import { DEFAULT_AUTO_DOWNLOAD_BYTES } from '../protocol/constants.js'

const CONFIG_VERSION = 1

/** Root for all local state. OPENCHAT_DIR lets tests run fully isolated. */
export function configDir () {
  return process.env.OPENCHAT_DIR || path.join(os.homedir(), '.openchat')
}

export function storePath (dir = configDir()) {
  return path.join(dir, 'store')
}

export function configPath (dir = configDir()) {
  return path.join(dir, 'config.json')
}

export async function openStore (dir = configDir()) {
  await mkdir(dir, { recursive: true })
  const store = new Corestore(storePath(dir))
  await store.ready()
  return store
}

export function defaultConfig () {
  return {
    v: CONFIG_VERSION,
    nick: null,
    autoDownloadBytes: DEFAULT_AUTO_DOWNLOAD_BYTES,
    rooms: [],
    lastRoom: null
  }
}

export async function readConfig (dir = configDir()) {
  try {
    const raw = JSON.parse(await readFile(configPath(dir), 'utf8'))
    return { ...defaultConfig(), ...raw }
  } catch (err) {
    if (err.code === 'ENOENT') return defaultConfig()
    throw err
  }
}

export async function writeConfig (config, dir = configDir()) {
  await mkdir(dir, { recursive: true })
  await writeFile(configPath(dir), JSON.stringify(config, null, 2), { mode: 0o600 })
  return config
}

/**
 * Record a room this install has joined. Keyed by room key, so re-joining an
 * existing room updates it rather than duplicating it.
 *
 * @param {{ roomKey: Uint8Array, encryptionKey: Uint8Array, name: string }} room
 */
export async function rememberRoom (room, dir = configDir()) {
  const config = await readConfig(dir)
  const key = b4a.toString(room.roomKey, 'hex')
  const entry = {
    key,
    name: room.name,
    encryptionKey: b4a.toString(room.encryptionKey, 'hex'),
    joinedAt: Date.now()
  }

  const existing = config.rooms.findIndex((r) => r.key === key)
  if (existing === -1) config.rooms.push(entry)
  else config.rooms[existing] = { ...config.rooms[existing], ...entry }

  config.lastRoom = key
  await writeConfig(config, dir)
  return entry
}

export async function forgetRoom (roomKeyHex, dir = configDir()) {
  const config = await readConfig(dir)
  config.rooms = config.rooms.filter((r) => r.key !== roomKeyHex)
  if (config.lastRoom === roomKeyHex) config.lastRoom = config.rooms.at(-1)?.key ?? null
  await writeConfig(config, dir)
  return config
}

/** Inflate a stored room entry back into buffers. */
export function roomFromConfig (entry) {
  return {
    roomKey: b4a.from(entry.key, 'hex'),
    encryptionKey: b4a.from(entry.encryptionKey, 'hex'),
    name: entry.name
  }
}
