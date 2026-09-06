// Tier 2 — a local index over the logs.
//
// Hypercore is the source of truth and stays that way. Every message in here
// came out of a log that was replicated, verified and decrypted first, and if
// this file were deleted the app would lose nothing: it rebuilds from the logs
// on the next run. Nothing is ever read from here that could not be recomputed,
// and nothing here is ever sent to a peer.
//
// What it buys is the three things a log is bad at:
//
//   - searching everything you have ever been told, rather than the few hundred
//     messages the UI happens to be holding in memory
//   - unread counts that survive closing the app, because "how far had I read"
//     is a fact about this machine and belongs nowhere near the shared log
//   - answering both of those in under a millisecond, without walking a log
//
// It is per account. Two accounts on one machine share nothing, here as
// everywhere else.

import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** Bumped when the schema changes in a way that makes the old one unusable. */
const SCHEMA_VERSION = 1

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS messages (
    id            TEXT PRIMARY KEY,
    conversation  TEXT NOT NULL,
    author        TEXT NOT NULL,
    type          TEXT NOT NULL,
    body          TEXT NOT NULL DEFAULT '',
    ts            INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS messages_by_conversation
    ON messages (conversation, ts);

  -- Kept as its own table rather than an external-content one: the duplication
  -- is a few bytes per message, and it means a corrupt or half-written index
  -- can be dropped and rebuilt without the two ever disagreeing.
  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    body,
    id UNINDEXED,
    conversation UNINDEXED,
    tokenize = 'unicode61'
  );

  -- How far you have read. Local by definition: nobody else's business, and
  -- nothing a peer could tell you.
  CREATE TABLE IF NOT EXISTS reads (
    conversation  TEXT PRIMARY KEY,
    last_read_ts  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meta (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );
`

/**
 * Open (or create) the index for one profile.
 *
 * @param {string} dir      the profile directory
 * @param {object} [opts]
 * @param {string} [opts.file]  override the path; ':memory:' for tests
 * @returns {MessageIndex}
 */
export function openIndex (dir, { file } = {}) {
  return new MessageIndex(file ?? path.join(dir, 'index.db'))
}

export class MessageIndex {
  constructor (file) {
    this.file = file
    this.db = new DatabaseSync(file)

    // WAL so a read never blocks behind a write, and NORMAL because losing the
    // last few rows of a rebuildable index to a power cut costs nothing.
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA synchronous = NORMAL')

    this._migrate()

    this._insert = this.db.prepare(`
      INSERT OR IGNORE INTO messages (id, conversation, author, type, body, ts)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    this._insertFts = this.db.prepare(
      'INSERT INTO messages_fts (body, id, conversation) VALUES (?, ?, ?)'
    )
    this._markRead = this.db.prepare(`
      INSERT INTO reads (conversation, last_read_ts) VALUES (?, ?)
      ON CONFLICT (conversation) DO UPDATE SET
        last_read_ts = MAX(last_read_ts, excluded.last_read_ts)
    `)
  }

  /**
   * A schema this version does not understand is thrown away rather than
   * migrated. It is an index — rebuilding it is cheaper than any migration, and
   * far cheaper than a subtle disagreement with the log it came from.
   */
  _migrate () {
    let version = 0
    try {
      const row = this.db.prepare("SELECT value FROM meta WHERE key = 'schema'").get()
      version = row ? Number(row.value) : 0
    } catch {
      version = 0 // no meta table yet, so nothing has been created
    }

    if (version > 0 && version !== SCHEMA_VERSION) this._drop()

    this.db.exec(SCHEMA)
    this.db
      .prepare("INSERT INTO meta (key, value) VALUES ('schema', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
      .run(String(SCHEMA_VERSION))
  }

  _drop () {
    for (const table of ['messages_fts', 'messages', 'reads', 'meta']) {
      this.db.exec(`DROP TABLE IF EXISTS ${table}`)
    }
  }

  /**
   * Record messages for a conversation. Idempotent — the same message arriving
   * twice, which replication does routinely, indexes once.
   *
   * @param {string} conversation
   * @param {object[]} messages
   * @returns {number} how many were new
   */
  record (conversation, messages = []) {
    if (!conversation || messages.length === 0) return 0

    let added = 0
    this.db.exec('BEGIN')
    try {
      for (const message of messages) {
        if (!message?.id) continue

        const body = searchableText(message)
        const result = this._insert.run(
          message.id,
          conversation,
          message.author ?? '',
          message.type ?? 'text',
          body,
          Number(message.ts) || 0
        )

        // Only index text that is actually new; the FTS table has no primary
        // key of its own to deduplicate against.
        if (result.changes > 0) {
          added++
          if (body) this._insertFts.run(body, message.id, conversation)
        }
      }
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }

    return added
  }

  /**
   * Full-text search over everything indexed.
   *
   * @param {string} query
   * @param {object} [opts]
   * @param {string} [opts.conversation]  restrict to one conversation
   * @param {number} [opts.limit]
   * @returns {{ id, conversation, author, type, body, ts }[]} newest first
   */
  search (query, { conversation, limit = 100 } = {}) {
    const match = toMatchQuery(query)
    if (!match) return []

    const sql = `
      SELECT m.id, m.conversation, m.author, m.type, m.body, m.ts
      FROM messages_fts f
      JOIN messages m ON m.id = f.id
      WHERE messages_fts MATCH ?
        ${conversation ? 'AND m.conversation = ?' : ''}
      ORDER BY m.ts DESC
      LIMIT ?
    `

    const args = conversation ? [match, conversation, limit] : [match, limit]

    try {
      return this.db.prepare(sql).all(...args)
    } catch {
      // A query FTS cannot parse is a typo, not a crash.
      return []
    }
  }

  /** The most recent messages in a conversation, oldest first. */
  recent (conversation, limit = 200) {
    const rows = this.db.prepare(`
      SELECT id, conversation, author, type, body, ts
      FROM messages WHERE conversation = ?
      ORDER BY ts DESC LIMIT ?
    `).all(conversation, limit)
    return rows.reverse()
  }

  /** Remember that everything up to `ts` in this conversation has been read. */
  markRead (conversation, ts = Date.now()) {
    if (!conversation) return
    this._markRead.run(conversation, Number(ts) || 0)
  }

  /** Where you had read up to, or 0 if you never have. */
  lastRead (conversation) {
    const row = this.db
      .prepare('SELECT last_read_ts FROM reads WHERE conversation = ?')
      .get(conversation)
    return row ? Number(row.last_read_ts) : 0
  }

  /**
   * Unread counts per conversation, excluding your own messages — you have read
   * everything you wrote.
   *
   * @param {string} self  your public key
   * @returns {Map<string, number>}
   */
  unread (self) {
    const rows = this.db.prepare(`
      SELECT m.conversation AS conversation, COUNT(*) AS n
      FROM messages m
      LEFT JOIN reads r ON r.conversation = m.conversation
      WHERE m.ts > COALESCE(r.last_read_ts, 0)
        AND m.author <> ?
        AND m.type IN ('text', 'file')
      GROUP BY m.conversation
    `).all(self ?? '')

    return new Map(rows.map((row) => [row.conversation, Number(row.n)]))
  }

  /** How many messages are indexed, for tests and for /stats-shaped questions. */
  count (conversation) {
    const row = conversation
      ? this.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation = ?').get(conversation)
      : this.db.prepare('SELECT COUNT(*) AS n FROM messages').get()
    return Number(row.n)
  }

  /** Forget a conversation entirely — what leaving a room should also do. */
  forget (conversation) {
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM messages_fts WHERE conversation = ?').run(conversation)
      this.db.prepare('DELETE FROM messages WHERE conversation = ?').run(conversation)
      this.db.prepare('DELETE FROM reads WHERE conversation = ?').run(conversation)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  close () {
    try {
      this.db.close()
    } catch { /* already closed, or never opened */ }
  }
}

/**
 * What of a message is worth searching.
 *
 * A file is findable by its name, which is the only part of it anyone
 * remembers. System and presence lines are not indexed at all — searching your
 * history for "joined" and getting every arrival since the room opened is worse
 * than not finding it.
 */
function searchableText (message) {
  if (message.type === 'text') return String(message.body ?? '')
  if (message.type === 'file') return String(message.name ?? '')
  return ''
}

/**
 * Turn what someone typed into an FTS5 query.
 *
 * Everything is quoted and given a prefix wildcard, so typing half a word finds
 * it and typing punctuation does not produce a syntax error. FTS5's own
 * operators are deliberately not exposed: this is a search box in a chat
 * client, not a query language.
 */
function toMatchQuery (query) {
  const terms = String(query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.replace(/["*]/g, '').trim())
    .filter(Boolean)

  if (terms.length === 0) return null
  return terms.map((term) => `"${term}"*`).join(' AND ')
}
