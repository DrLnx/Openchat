// Tier 2 — the account database.
//
// Everything openchat knows *about* an account lives here: its display name,
// the rooms it has joined, the people it has names for, the conversations it
// has open, its settings, and which account this machine is currently in. One
// SQLite file, one row per account, rather than a config.json in every profile
// directory and a current.json beside them.
//
// The reason for the change was not tidiness. Scattered files have no answer to
// "what accounts exist" except reading the directory and hoping, so an account
// half-made — a directory with a key in it and nothing else, a directory made
// by a command that then failed — was indistinguishable from a real one, and
// the account list filled up with things nobody had meant to create. A row
// exists or it does not.
//
// **This database is authoritative.** That is the opposite of index-db.js,
// which is a cache over the logs and is thrown away and rebuilt whenever it
// looks wrong. Nothing here can be recomputed from anywhere: the room keys in
// it are how you get back into a room, and losing them loses the room. So a
// schema this version does not understand is a hard failure, never a drop, and
// writes are `synchronous = FULL` — the cost of an fsync is nothing next to
// forgetting a room because the machine lost power a second later.
//
// The one thing it does *not* hold is the identity itself. A keypair is the one
// irreplaceable thing on the machine, and it stays in its own 0600 file so that
// a database bug can never be the reason an account is gone.

import path from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { DEFAULT_AUTO_DOWNLOAD_BYTES } from '../protocol/constants.js'

/** What the database file is called, wherever it lives. */
export const DB_FILE = 'openchat.db'

/** Bumped when the schema changes. A mismatch throws; see the note above. */
const SCHEMA_VERSION = 1

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS accounts (
    profile             TEXT PRIMARY KEY,
    nick                TEXT,
    onboarded           INTEGER NOT NULL DEFAULT 0,
    last_room           TEXT,
    auto_download_bytes INTEGER NOT NULL,
    settings            TEXT NOT NULL DEFAULT '{}',
    created             INTEGER NOT NULL
  );

  -- Rooms, contacts and conversations are rows rather than a JSON blob in the
  -- account row, because they are lists this app appends to, searches and
  -- deletes from one at a time. Insertion order is the display order and is
  -- kept by rowid: a write replaces the whole list in the order it was given.
  CREATE TABLE IF NOT EXISTS rooms (
    profile        TEXT NOT NULL,
    key            TEXT NOT NULL,
    name           TEXT,
    encryption_key TEXT NOT NULL,
    namespace      TEXT,
    joined_at      INTEGER,
    PRIMARY KEY (profile, key)
  );

  CREATE TABLE IF NOT EXISTS contacts (
    profile     TEXT NOT NULL,
    key         TEXT NOT NULL,
    name        TEXT,
    added_at    INTEGER,
    verified_at INTEGER,
    PRIMARY KEY (profile, key)
  );

  CREATE TABLE IF NOT EXISTS dms (
    profile    TEXT NOT NULL,
    key        TEXT NOT NULL,
    name       TEXT,
    announced  TEXT,
    outbox     TEXT,
    started_at INTEGER,
    PRIMARY KEY (profile, key)
  );

  -- Facts about the machine rather than about an account. There is exactly one
  -- of them so far: which account is in use.
  CREATE TABLE IF NOT EXISTS state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`

/**
 * The shape every account row inflates back to.
 *
 * It is the shape the rest of the app has always seen — one object with the
 * lists on it — because the database is a storage decision and not an excuse to
 * rewrite every caller. `v` is kept so a config handed around in memory still
 * says what it is.
 */
export function defaultConfig () {
  return {
    v: SCHEMA_VERSION,
    nick: null,
    autoDownloadBytes: DEFAULT_AUTO_DOWNLOAD_BYTES,
    rooms: [],
    contacts: [], // [{ key, name, addedAt, verifiedAt }]
    dms: [], // [{ key, name, announced, outbox, startedAt }]
    lastRoom: null,
    onboarded: false,
    settings: {}
  }
}

// One handle per file. Two accounts open in two terminals are two processes and
// SQLite's WAL handles that; two handles in *one* process to the same file is
// just waste, and a stale prepared statement waiting to happen.
const open = new Map()

/**
 * Open (or create) an account database.
 *
 * @param {string} file  path to the .db
 * @returns {AccountStore}
 */
export function openAccounts (file) {
  const resolved = path.resolve(file)
  let store = open.get(resolved)
  if (!store) {
    store = new AccountStore(resolved)
    open.set(resolved, store)
  }
  return store
}

/** Close every open handle. For tests, and for a clean shutdown. */
export function closeAccounts () {
  for (const store of open.values()) store.close()
  open.clear()
}

export class AccountStore {
  /**
   * Opening is deferred, and reading never creates anything.
   *
   * `openchat --help` and `openchat --list` must leave a machine exactly as
   * they found it — asking a question is not setting anything up — and the
   * files this would otherwise leave behind (the database, its WAL, its shared
   * memory) are the kind of thing somebody later has to wonder about. A machine
   * with no accounts reads as a machine with no accounts.
   */
  constructor (file) {
    this.file = file
    this.db = null
  }

  /** The handle, or null when there is nothing on disk to read. */
  _reading () {
    if (this.db) return this.db
    if (!existsSync(this.file)) return null
    return this._writing()
  }

  /** The handle, creating the database if this is the first write. */
  _writing () {
    if (this.db) return this.db

    mkdirSync(path.dirname(this.file), { recursive: true })
    this.db = new DatabaseSync(this.file)
    // WAL so a second terminal reading the account list never blocks behind a
    // write, and FULL because this file is the only copy of what it holds.
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA synchronous = FULL')
    this.db.exec(SCHEMA)
    this._checkSchema()

    return this.db
  }

  _checkSchema () {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'schema'").get()
    const version = row ? Number(row.value) : 0

    if (version === 0) {
      this.db
        .prepare("INSERT INTO meta (key, value) VALUES ('schema', ?)")
        .run(String(SCHEMA_VERSION))
      return
    }

    // Refuse rather than migrate blindly and refuse rather than drop. What is
    // in here cannot be rebuilt from anything, so the only safe thing an older
    // build can do with a newer file is stop and say so.
    if (version !== SCHEMA_VERSION) {
      throw new Error(
        `${this.file} is schema v${version}, this build expects v${SCHEMA_VERSION}. ` +
        'Do not delete it — it holds the keys to every room this account is in.'
      )
    }
  }

  /** @returns {object|null} the account's config, or null if there is no row. */
  read (profile) {
    const db = this._reading()
    if (!db) return null

    const row = db.prepare('SELECT * FROM accounts WHERE profile = ?').get(profile)
    if (!row) return null

    return {
      ...defaultConfig(),
      nick: row.nick ?? null,
      autoDownloadBytes: row.auto_download_bytes,
      lastRoom: row.last_room ?? null,
      onboarded: Boolean(row.onboarded),
      settings: parseJson(row.settings),
      rooms: this._rooms(profile),
      contacts: this._contacts(profile),
      dms: this._dms(profile)
    }
  }

  _rooms (profile) {
    return this._reading()
      .prepare('SELECT * FROM rooms WHERE profile = ? ORDER BY rowid')
      .all(profile)
      .map((r) => ({
        key: r.key,
        name: r.name ?? null,
        encryptionKey: r.encryption_key,
        namespace: r.namespace ?? null,
        joinedAt: r.joined_at ?? null
      }))
  }

  _contacts (profile) {
    return this._reading()
      .prepare('SELECT * FROM contacts WHERE profile = ? ORDER BY rowid')
      .all(profile)
      .map((c) => ({
        key: c.key,
        name: c.name ?? null,
        addedAt: c.added_at ?? null,
        verifiedAt: c.verified_at ?? null
      }))
  }

  _dms (profile) {
    return this._reading()
      .prepare('SELECT * FROM dms WHERE profile = ? ORDER BY rowid')
      .all(profile)
      .map((d) => ({
        key: d.key,
        name: d.name ?? null,
        announced: d.announced ?? null,
        outbox: d.outbox ?? null,
        startedAt: d.started_at ?? null
      }))
  }

  /**
   * Write an account's whole config.
   *
   * The lists are replaced rather than diffed. That is what the callers already
   * mean — every one of them reads the config, changes something in it and
   * hands the whole thing back — and doing it in one transaction means a crash
   * mid-write leaves the account exactly as it was rather than half-joined to a
   * room.
   */
  write (profile, config = {}) {
    const merged = { ...defaultConfig(), ...config }
    const db = this._writing()

    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare(`
        INSERT INTO accounts (profile, nick, onboarded, last_room, auto_download_bytes, settings, created)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (profile) DO UPDATE SET
          nick = excluded.nick,
          onboarded = excluded.onboarded,
          last_room = excluded.last_room,
          auto_download_bytes = excluded.auto_download_bytes,
          settings = excluded.settings
      `).run(
        profile,
        merged.nick ?? null,
        merged.onboarded ? 1 : 0,
        merged.lastRoom ?? null,
        Number(merged.autoDownloadBytes ?? DEFAULT_AUTO_DOWNLOAD_BYTES),
        JSON.stringify(merged.settings ?? {}),
        Date.now()
      )

      this._replaceRooms(profile, merged.rooms)
      this._replaceContacts(profile, merged.contacts)
      this._replaceDms(profile, merged.dms)

      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }

    return merged
  }

  _replaceRooms (profile, rooms) {
    this.db.prepare('DELETE FROM rooms WHERE profile = ?').run(profile)
    const insert = this.db.prepare(`
      INSERT INTO rooms (profile, key, name, encryption_key, namespace, joined_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    for (const room of asArray(rooms)) {
      if (!HEX64.test(room?.key || '') || !HEX64.test(room?.encryptionKey || '')) continue
      insert.run(
        profile, room.key, room.name ?? null, room.encryptionKey,
        room.namespace ?? null, numberOrNull(room.joinedAt)
      )
    }
  }

  _replaceContacts (profile, contacts) {
    this.db.prepare('DELETE FROM contacts WHERE profile = ?').run(profile)
    const insert = this.db.prepare(`
      INSERT INTO contacts (profile, key, name, added_at, verified_at) VALUES (?, ?, ?, ?, ?)
    `)
    for (const contact of asArray(contacts)) {
      if (!HEX64.test(contact?.key || '')) continue
      insert.run(
        profile, contact.key, contact.name ?? null,
        numberOrNull(contact.addedAt), numberOrNull(contact.verifiedAt)
      )
    }
  }

  _replaceDms (profile, dms) {
    this.db.prepare('DELETE FROM dms WHERE profile = ?').run(profile)
    const insert = this.db.prepare(`
      INSERT INTO dms (profile, key, name, announced, outbox, started_at) VALUES (?, ?, ?, ?, ?, ?)
    `)
    for (const dm of asArray(dms)) {
      if (!HEX64.test(dm?.key || '')) continue
      insert.run(
        profile, dm.key, dm.name ?? null, dm.announced ?? null,
        dm.outbox ?? null, numberOrNull(dm.startedAt)
      )
    }
  }

  /** Every account with a row, in name order. */
  list () {
    const db = this._reading()
    if (!db) return []
    return db
      .prepare('SELECT profile FROM accounts ORDER BY profile')
      .all()
      .map((row) => row.profile)
  }

  has (profile) {
    const db = this._reading()
    if (!db) return false
    return Boolean(db.prepare('SELECT 1 FROM accounts WHERE profile = ?').get(profile))
  }

  /** Forget an account entirely — the row and everything hanging off it. */
  remove (profile) {
    const db = this._reading()
    if (!db) return

    db.exec('BEGIN IMMEDIATE')
    try {
      for (const table of ['rooms', 'contacts', 'dms', 'accounts']) {
        db.prepare(`DELETE FROM ${table} WHERE profile = ?`).run(profile)
      }
      const current = db.prepare("SELECT value FROM state WHERE key = 'current'").get()
      if (current?.value === profile) {
        db.prepare("DELETE FROM state WHERE key = 'current'").run()
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }

  /** @returns {string|null} the account in use, or null if none is recorded. */
  current () {
    const db = this._reading()
    if (!db) return null
    const row = db.prepare("SELECT value FROM state WHERE key = 'current'").get()
    return row?.value ?? null
  }

  setCurrent (profile) {
    this._writing().prepare(`
      INSERT INTO state (key, value) VALUES ('current', ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value
    `).run(profile)
    return profile
  }

  close () {
    try {
      this.db?.close()
    } catch { /* already closed, or never opened */ }
    this.db = null
    open.delete(this.file)
  }
}

const HEX64 = /^[0-9a-f]{64}$/i

function asArray (value) {
  return Array.isArray(value) ? value : []
}

function numberOrNull (value) {
  return Number.isFinite(Number(value)) ? Number(value) : null
}

function parseJson (raw) {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}
