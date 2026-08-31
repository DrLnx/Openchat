// Tier 2 — the whole local profile behind one object: identity, storage, swarm,
// the rooms you belong to, the people you talk to directly, and their
// attachments.
//
// The UI talks to this and nothing below it. Rooms and DMs are different
// underneath — an Autobase of many writers versus two outbox cores — but both
// are *conversations* here, with the same methods and the same events, so the
// UI does not care which it is looking at.

import { EventEmitter } from 'node:events'
import path from 'node:path'

import { loadIdentity } from './identity.js'
import {
  openStore, readConfig, writeConfig, rememberRoom, roomFromConfig,
  addContact, removeContact, resolvePeer, rememberDm, profileDir, DEFAULT_PROFILE
} from './store.js'
import { createSwarm } from './swarm.js'
import { createRoom, openRoom } from './room.js'
import { DirectChannel } from './dm.js'
import { Blobs } from './blobs.js'
import { decodeInvite } from '../protocol/invite.js'

export class Client extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} [opts.dir]      profile directory; derived from `profile` when absent
   * @param {string} [opts.profile]  profile name
   */
  constructor ({ dir, profile = DEFAULT_PROFILE, bootstrap, host } = {}) {
    super()
    this.profile = profile
    this.dir = dir || profileDir(profile)
    this.bootstrap = bootstrap
    this.host = host

    this.identity = null
    this.store = null
    this.swarm = null
    this.config = null

    /** @type {Map<string, { kind: 'room'|'dm', room?, channel?, blobs }>} */
    this.conversations = new Map()
    this.activeId = null
  }

  async ready () {
    this.store = await openStore(this.dir)
    this.identity = await loadIdentity({ dir: this.dir })
    this.config = await readConfig(this.dir)

    if (this.config.nick) this.identity.nick = this.config.nick

    this.swarm = await createSwarm({
      store: this.store,
      seed: this.identity.seed,
      bootstrap: this.bootstrap,
      host: this.host
    })

    this.swarm.on('peer', () => this._emitConnection())
    this.swarm.on('peer-close', () => this._emitConnection())

    return this
  }

  // --- conversations ------------------------------------------------------

  get active () {
    return this.activeId ? this.conversations.get(this.activeId) ?? null : null
  }

  /** The room behind the active conversation, or null when it is a DM. */
  get activeRoom () {
    const active = this.active
    return active?.kind === 'room' ? active.room : null
  }

  get activeChannel () {
    const active = this.active
    return active?.kind === 'dm' ? active.channel : null
  }

  /** Whichever of the two is active — both answer `messages`, `name`, `id`. */
  get activeTarget () {
    const active = this.active
    return active ? (active.room || active.channel) : null
  }

  get activeBlobs () {
    return this.active?.blobs ?? null
  }

  /** Everything open, for the switcher: rooms first, then DMs. */
  get conversationList () {
    return [...this.conversations.values()].map((entry) => (
      entry.kind === 'room'
        ? {
            id: entry.room.keyHex,
            kind: 'room',
            name: entry.room.name,
            closed: entry.room.isClosed,
            owned: entry.room.isOwner
          }
        : { id: entry.channel.id, kind: 'dm', name: entry.channel.name, peer: entry.channel.peerKey }
    ))
  }

  /** Kept for the existing UI and tests, which speak in rooms. */
  get roomList () {
    return this.conversationList.filter((c) => c.kind === 'room').map((c) => ({ key: c.id, name: c.name }))
  }

  get activeKey () {
    return this.activeId
  }

  switchTo (id) {
    if (!this.conversations.has(id)) throw new Error('no such conversation')
    this._setActive(id)
    return this.conversations.get(id)
  }

  /**
   * Every path that changes which conversation is active goes through here.
   * Creating a room or opening a DM switches you into it just as much as
   * `switchTo` does, and the UI has to hear about all of them — not only the
   * ones that happen to be followed by a command calling refresh.
   */
  _setActive (id) {
    this.activeId = id
    this.emit('switched', id)
  }

  /** Cycle to the next conversation — what Ctrl+N is wired to. */
  cycle (step = 1) {
    const ids = [...this.conversations.keys()]
    if (ids.length === 0) return null
    const at = ids.indexOf(this.activeId)
    const next = ids[(at + step + ids.length) % ids.length]
    return this.switchTo(next)
  }

  /** Re-open every room and DM this profile knows about. */
  async restore () {
    for (const entry of this.config.rooms) {
      try {
        const { roomKey, encryptionKey, name, namespace } = roomFromConfig(entry)
        const room = await openRoom({
          store: this.store,
          identity: this.identity,
          roomKey,
          encryptionKey,
          name,
          namespace
        })
        await this._adoptRoom(room)
      } catch (err) {
        this.emit('notice', { level: 'error', text: `could not open room ${entry.name}: ${err.message}` })
      }
    }

    for (const entry of this.config.dms) {
      try {
        await this._adoptDm(entry.key, { name: entry.name, outbox: entry.outbox })
      } catch (err) {
        this.emit('notice', { level: 'error', text: `could not open DM with ${entry.key.slice(0, 8)}: ${err.message}` })
      }
    }

    const last = this.config.lastRoom
    this.activeId = this.conversations.has(last) ? last : (this.conversations.keys().next().value ?? null)

    return this.conversationList
  }

  // --- rooms --------------------------------------------------------------

  async createRoom (name) {
    const room = await createRoom({ store: this.store, identity: this.identity, name })
    await this._adoptRoom(room)
    await this._rememberRoom(room)
    this._setActive(room.keyHex)
    return room
  }

  async joinRoom (invite, { wait = true } = {}) {
    const decoded = decodeInvite(invite)
    const keyHex = Buffer.from(decoded.roomKey).toString('hex')

    const existing = this.conversations.get(keyHex)
    if (existing) {
      this._setActive(keyHex)
      return existing.room
    }

    const room = await openRoom({
      store: this.store,
      identity: this.identity,
      roomKey: decoded.roomKey,
      encryptionKey: decoded.encryptionKey,
      name: decoded.name
    })

    await this._adoptRoom(room)
    await this._rememberRoom(room)
    this._setActive(room.keyHex)

    await room.requestJoin()
    if (wait) await room.waitForWritable()

    return room
  }

  /** Owner-only: close, reopen, transfer, or remove someone. */
  async controlRoom (action, subject = null) {
    const room = this.activeRoom
    if (!room) throw new Error('that only works in a room')

    const subjectKey = subject ? this.resolvePeer(subject) : null
    if (subject && !subjectKey) throw new Error(`no one matching "${subject}"`)

    await room.control(action, subjectKey)
    return { action, subject: subjectKey }
  }

  // --- direct messages ----------------------------------------------------

  /**
   * Open a conversation with someone by public key. No invite, no handshake:
   * the channel is derived from the two identities (see core/dm.js).
   */
  async openDm (peerInput, { name } = {}) {
    const peerKey = this.resolvePeer(peerInput)
    if (!peerKey) throw new Error(`"${peerInput}" is not a key or a known contact`)
    if (peerKey === this.identity.publicKeyHex) throw new Error('you cannot DM yourself')

    const id = `dm:${peerKey}`
    if (this.conversations.has(id)) {
      this._setActive(id)
      return this.conversations.get(id).channel
    }

    const known = this.config.dms.find((d) => d.key === peerKey)
    const contact = this.config.contacts.find((c) => c.key === peerKey)

    const channel = await this._adoptDm(peerKey, {
      name: name || known?.name || contact?.name || null,
      outbox: known?.outbox
    })

    await rememberDm({ key: peerKey, name: channel.peerName, outbox: channel.outboxKey }, this.dir)
    this.config = await readConfig(this.dir)
    this._setActive(id)
    return channel
  }

  // --- contacts -----------------------------------------------------------

  /** Resolve a name, a key, or a key prefix to a full public key. */
  resolvePeer (input) {
    const direct = resolvePeer(input, this.config)
    if (direct) return direct

    // Anyone in a room with you is reachable, whether or not you saved them.
    const query = String(input || '').trim().toLowerCase()
    if (/^[0-9a-f]{4,}$/.test(query)) {
      const members = new Set()
      for (const entry of this.conversations.values()) {
        if (entry.kind !== 'room') continue
        for (const member of entry.room.members) members.add(member)
      }
      const matches = [...members].filter((k) => k.startsWith(query))
      if (matches.length === 1) return matches[0]
      if (matches.length > 1) throw new Error(`"${input}" matches ${matches.length} people — use more characters`)
    }

    return null
  }

  async addContact (input, name) {
    const key = this.resolvePeer(input) || (/^[0-9a-f]{64}$/i.test(String(input).trim()) ? String(input).trim().toLowerCase() : null)
    if (!key) throw new Error(`"${input}" is not a public key`)

    const contact = await addContact({ key, name }, this.dir)
    this.config = await readConfig(this.dir)
    return contact
  }

  async removeContact (input) {
    const key = this.resolvePeer(input)
    if (!key) throw new Error(`no contact matching "${input}"`)
    await removeContact(key, this.dir)
    this.config = await readConfig(this.dir)
    return key
  }

  get contacts () {
    return this.config.contacts
  }

  // --- sending ------------------------------------------------------------

  async setNick (name) {
    this.identity.nick = name
    this.config.nick = name
    await writeConfig(this.config, this.dir)

    const target = this.activeTarget
    if (target && (this.activeRoom ? this.activeRoom.writable : true)) await target.setNick(name)
    return name
  }

  async sendText (body) {
    return this._requireTarget().sendText(body)
  }

  async sendFile (filePath) {
    const target = this._requireTarget()
    const meta = await this.activeBlobs.put(filePath)
    const message = await target.sendFile(meta)

    // We already have the bytes — mark it complete so our own attachment does
    // not render as something still waiting to be fetched.
    this.emit('attachment', { id: message.id, status: 'ready', progress: 1, path: filePath, sent: true })
    return message
  }

  async download (idOrPrefix) {
    const target = this._requireTarget()
    const message = target.messages.find(
      (m) => m.type === 'file' && (m.id === idOrPrefix || m.id.startsWith(idOrPrefix))
    )
    if (!message) throw new Error(`no attachment matching "${idOrPrefix}"`)
    return this._fetch(message)
  }

  async _fetch (message) {
    const blobs = this.activeBlobs
    this.emit('attachment', { id: message.id, status: 'downloading', progress: 0 })

    try {
      const result = await blobs.get(message)
      this.emit('attachment', {
        id: message.id,
        status: result.verified ? 'ready' : 'failed',
        progress: 1,
        path: result.path,
        error: result.verified ? undefined : 'checksum mismatch — the file does not match what was sent'
      })
      return result
    } catch (err) {
      this.emit('attachment', { id: message.id, status: 'failed', error: err.message })
      throw err
    }
  }

  // --- wiring -------------------------------------------------------------

  async _adoptRoom (room) {
    const entry = {
      kind: 'room',
      room,
      blobs: this._blobsFor(room.keyHex, room.store, room.encryptionKey)
    }
    this.conversations.set(room.keyHex, entry)

    room.on('messages', (messages) => {
      this.emit('messages', { conversationId: room.keyHex, roomKey: room.keyHex, messages })
      this._autoDownload(room.keyHex, messages)
    })
    room.on('member', (author) => this.emit('member', { roomKey: room.keyHex, author }))
    room.on('member-removed', (author) => {
      this.emit('notice', { level: 'warn', text: `${author.slice(0, 8)} was removed from ${room.name}` })
    })
    room.on('error', (err) => this.emit('notice', { level: 'error', text: err.message }))
    room.on('undecodable', ({ error }) => {
      this.emit('notice', { level: 'warn', text: `skipped an unreadable message (${error.code || error.message})` })
    })

    await room.attachSwarm(this.swarm)
    this._announceNick(room)
    return room
  }

  async _adoptDm (peerKey, { name, outbox } = {}) {
    const channel = new DirectChannel({
      store: this.store,
      identity: this.identity,
      peerKey,
      peerName: name,
      peerOutbox: outbox
    })
    await channel.ready()

    const entry = {
      kind: 'dm',
      channel,
      blobs: this._blobsFor(channel.id, channel.store, channel.encryptionKey)
    }
    this.conversations.set(channel.id, entry)

    channel.on('messages', (messages) => {
      this.emit('messages', { conversationId: channel.id, messages })
      this._autoDownload(channel.id, messages)
    })
    channel.on('peer-outbox', (key) => {
      rememberDm({ key: peerKey, outbox: key }, this.dir).catch(() => {})
    })
    channel.on('error', (err) => this.emit('notice', { level: 'error', text: err.message }))

    await channel.attachSwarm(this.swarm)
    this._announceNick(channel)
    return channel
  }

  /**
   * Say what you are called, once per conversation.
   *
   * Without this a member only ever has your key: `setNick` publishes into the
   * conversation you are in, so a nick chosen before joining anything, or set
   * in another room, never reaches these people. Runs when we can actually
   * write, and skips if we have already introduced ourselves here.
   */
  _announceNick (target) {
    const nick = this.identity.nick
    if (!nick) return

    const introduce = async () => {
      if (target.closed) return
      const already = target.messages.some(
        (m) => m.type === 'nick' && m.author === this.identity.publicKeyHex && m.nick === nick
      )
      if (already) return
      await target.setNick(nick)
    }

    // This runs in the background, so its failures have to be caught here or
    // they surface as an unhandled rejection. A one-shot command routinely
    // exits before the introduction lands — `openchat room create` did exactly
    // that, printing the invite and then crashing with "Autobase is closing" —
    // so teardown is an expected outcome, not an error worth reporting.
    const announce = () => introduce().catch((err) => {
      if (target.closed || /clos(ing|ed)/i.test(err.message || '')) return
      this.emit('notice', { level: 'warn', text: `could not announce your name: ${err.message}` })
    })

    // A room needs us to be an admitted writer first; a DM never does.
    if (target.waitForWritable) target.waitForWritable(60000).then(announce, () => {})
    else announce()
  }

  _blobsFor (id, store, encryptionKey) {
    const blobs = new Blobs({
      store,
      encryptionKey,
      downloadDir: path.join(this.dir, 'downloads', id.replace(/[^a-z0-9]/gi, '').slice(0, 12)),
      autoDownloadBytes: this.config.autoDownloadBytes
    })
    blobs.on('progress', (p) => {
      this.emit('attachment', { id: p.id, status: 'downloading', progress: p.progress })
    })
    return blobs
  }

  _autoDownload (conversationId, messages) {
    if (conversationId !== this.activeId) return
    const entry = this.conversations.get(conversationId)
    if (!entry) return

    for (const message of messages) {
      if (message.type !== 'file') continue
      if (message.author === this.identity.publicKeyHex) continue

      if (!entry.blobs.shouldAutoDownload(message.size)) {
        this.emit('attachment', { id: message.id, status: 'available' })
        continue
      }

      this._fetch(message).catch((err) => {
        this.emit('notice', { level: 'error', text: `download failed: ${err.message}` })
      })
    }
  }

  async _rememberRoom (room) {
    await rememberRoom(
      {
        roomKey: room.key,
        encryptionKey: room.encryptionKey,
        name: room.name,
        namespace: room.namespace
      },
      this.dir
    )
    this.config = await readConfig(this.dir)
  }

  _emitConnection () {
    this.emit('connection', {
      state: this.swarm.peerCount > 0 ? 'online' : 'connecting',
      peers: this.swarm.peerCount
    })
  }

  _requireTarget () {
    const active = this.active
    if (!active) throw new Error('nothing open — try /join <invite>, /dm <key>, or create a room')

    if (active.kind === 'room') {
      if (!active.room.writable) throw new Error('waiting to be admitted to this room')
      return active.room
    }
    return active.channel
  }

  async close () {
    for (const entry of this.conversations.values()) {
      await entry.blobs.close().catch(() => {})
      await (entry.room || entry.channel).close().catch(() => {})
    }
    this.conversations.clear()
    if (this.swarm) await this.swarm.destroy()
    if (this.store) await this.store.close()
  }
}

export async function createClient (opts) {
  const client = new Client(opts)
  await client.ready()
  return client
}
