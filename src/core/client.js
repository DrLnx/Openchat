// Tier 2 — the whole local install behind one object: identity, storage, swarm,
// the rooms you belong to, and their attachments.
//
// The UI talks to this and nothing below it. That is deliberate — it is the
// seam the browser harness substitutes, so the Ink components never reach for a
// hypercore directly and stay renderable against either.

import { EventEmitter } from 'node:events'
import path from 'node:path'

import { loadIdentity } from './identity.js'
import { openStore, readConfig, writeConfig, configDir, rememberRoom, roomFromConfig } from './store.js'
import { createSwarm } from './swarm.js'
import { createRoom, openRoom } from './room.js'
import { Blobs } from './blobs.js'
import { decodeInvite } from '../protocol/invite.js'

export class Client extends EventEmitter {
  constructor ({ dir = configDir(), bootstrap, host } = {}) {
    super()
    this.dir = dir
    this.bootstrap = bootstrap
    this.host = host

    this.identity = null
    this.store = null
    this.swarm = null
    this.config = null

    this.rooms = new Map() // room key hex -> { room, blobs }
    this.activeKey = null
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

  get activeRoom () {
    return this.activeKey ? this.rooms.get(this.activeKey)?.room ?? null : null
  }

  get activeBlobs () {
    return this.activeKey ? this.rooms.get(this.activeKey)?.blobs ?? null : null
  }

  get roomList () {
    return [...this.rooms.values()].map(({ room }) => ({ key: room.keyHex, name: room.name }))
  }

  /** Re-open every room this install has joined before. */
  async restore () {
    for (const entry of this.config.rooms) {
      try {
        const { roomKey, encryptionKey, name } = roomFromConfig(entry)
        const room = await openRoom({
          store: this.store,
          identity: this.identity,
          roomKey,
          encryptionKey,
          name,
          namespace: entry.namespace
        })
        await this._adopt(room)
      } catch (err) {
        this.emit('notice', { level: 'error', text: `could not open room ${entry.name}: ${err.message}` })
      }
    }

    const last = this.config.lastRoom
    if (last && this.rooms.has(last)) this.activeKey = last
    else this.activeKey = this.rooms.keys().next().value ?? null

    return this.roomList
  }

  async createRoom (name) {
    const room = await createRoom({ store: this.store, identity: this.identity, name })
    await this._adopt(room)
    await this._remember(room)
    this.activeKey = room.keyHex
    return room
  }

  /**
   * Join from an invite string. Resolves once we can actually post — which
   * needs an existing member online to admit us.
   */
  async joinRoom (invite, { wait = true } = {}) {
    const decoded = decodeInvite(invite)

    const existing = this.rooms.get(bufferToHex(decoded.roomKey))
    if (existing) {
      this.activeKey = existing.room.keyHex
      return existing.room
    }

    const room = await openRoom({
      store: this.store,
      identity: this.identity,
      roomKey: decoded.roomKey,
      encryptionKey: decoded.encryptionKey,
      name: decoded.name
    })

    await this._adopt(room)
    await this._remember(room)
    this.activeKey = room.keyHex

    await room.requestJoin()
    if (wait) await room.waitForWritable()

    return room
  }

  async setNick (name) {
    this.identity.nick = name
    this.config.nick = name
    await writeConfig(this.config, this.dir)
    if (this.activeRoom?.writable) await this.activeRoom.setNick(name)
    return name
  }

  async sendText (body) {
    const room = this._requireRoom()
    return room.sendText(body)
  }

  /** Put a file in the room's blob store and announce it. */
  async sendFile (filePath) {
    const room = this._requireRoom()
    const blobs = this.activeBlobs
    const meta = await blobs.put(filePath)
    return room.sendFile(meta)
  }

  /** Fetch an attachment by message id (or a unique id prefix). */
  async download (idOrPrefix) {
    const room = this._requireRoom()
    const message = room.messages.find(
      (m) => m.type === 'file' && (m.id === idOrPrefix || m.id.startsWith(idOrPrefix))
    )
    if (!message) throw new Error(`no attachment matching "${idOrPrefix}"`)

    return this._fetch(message)
  }

  async _fetch (message) {
    const blobs = this.rooms.get(this.activeKey).blobs
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

  async _adopt (room) {
    const blobs = new Blobs({
      store: room.store,
      encryptionKey: room.encryptionKey,
      downloadDir: path.join(this.dir, 'downloads', room.keyHex.slice(0, 12)),
      autoDownloadBytes: this.config.autoDownloadBytes
    })

    blobs.on('progress', (p) => {
      this.emit('attachment', { id: p.id, status: 'downloading', progress: p.progress })
    })

    this.rooms.set(room.keyHex, { room, blobs })

    room.on('messages', (messages) => {
      this.emit('messages', { roomKey: room.keyHex, messages })
      this._autoDownload(room, messages)
    })
    room.on('member', (author) => this.emit('member', { roomKey: room.keyHex, author }))
    room.on('error', (err) => this.emit('notice', { level: 'error', text: err.message }))
    room.on('undecodable', ({ error }) => {
      // Not fatal: a block we cannot open is usually a member on a newer
      // protocol version, or one stray corrupt entry.
      this.emit('notice', { level: 'warn', text: `skipped an unreadable message (${error.code || error.message})` })
    })

    await room.attachSwarm(this.swarm)
    return room
  }

  _autoDownload (room, messages) {
    if (room.keyHex !== this.activeKey) return

    for (const message of messages) {
      if (message.type !== 'file') continue
      if (message.author === this.identity.publicKeyHex) continue

      const blobs = this.rooms.get(room.keyHex).blobs
      if (!blobs.shouldAutoDownload(message.size)) {
        this.emit('attachment', { id: message.id, status: 'available' })
        continue
      }

      this._fetch(message).catch((err) => {
        this.emit('notice', { level: 'error', text: `download failed: ${err.message}` })
      })
    }
  }

  async _remember (room) {
    await rememberRoom(
      {
        roomKey: room.key,
        encryptionKey: room.encryptionKey,
        name: room.name
      },
      this.dir
    )
    // rememberRoom does not know about namespaces; record it so the room's
    // cores can be found again on restart.
    this.config = await readConfig(this.dir)
    const entry = this.config.rooms.find((r) => r.key === room.keyHex)
    if (entry) {
      entry.namespace = room.namespace
      await writeConfig(this.config, this.dir)
    }
  }

  _emitConnection () {
    this.emit('connection', {
      state: this.swarm.peerCount > 0 ? 'online' : 'connecting',
      peers: this.swarm.peerCount
    })
  }

  _requireRoom () {
    const room = this.activeRoom
    if (!room) throw new Error('no room open — try /join <invite> or `openchat room create <name>`')
    if (!room.writable) throw new Error('waiting to be admitted to this room')
    return room
  }

  async close () {
    for (const { room, blobs } of this.rooms.values()) {
      await blobs.close().catch(() => {})
      await room.close().catch(() => {})
    }
    this.rooms.clear()
    if (this.swarm) await this.swarm.destroy()
    if (this.store) await this.store.close()
  }
}

function bufferToHex (buf) {
  return Buffer.from(buf).toString('hex')
}

export async function createClient (opts) {
  const client = new Client(opts)
  await client.ready()
  return client
}
