// The browser client. Deliberately mirrors src/core/client.js: same method
// names, same events, same message flow. What differs is exactly two things —
// the transport (BroadcastChannel instead of Hyperswarm) and blob storage
// (chunks over that channel instead of Hyperblobs).
//
// Everything else is the production code path: protocol/messages.js encodes,
// protocol/envelope.js seals and opens, protocol/order.js orders, and
// ui/model/* holds the state. A bug in any of those shows up here.

import b4a from 'b4a'

import backend from '../src/protocol/crypto-web.js'
import { seal, open as openEnvelope } from '../src/protocol/envelope.js'
import { encodeMessage, decodeMessage, text, file, nick, presence } from '../src/protocol/messages.js'
import { linearize, nextClock } from '../src/protocol/order.js'
import { encodeInvite, decodeInvite, topicFor } from '../src/protocol/invite.js'
import { ENCRYPTION_KEY_BYTES, DEFAULT_AUTO_DOWNLOAD_BYTES } from '../src/protocol/constants.js'
import { BrowserTransport } from './transport.js'
import { read, store } from './identity.js'

const ROOM_KEY = 'openchat:room'
const CHUNK_BYTES = 48 * 1024

export class BrowserClient extends EventTarget {
  constructor ({ identity }) {
    super()
    this.identity = identity
    this.room = null
    this.transport = null

    this.messages = []
    this.frames = new Map() // message id -> sealed frame, for back-filling a new tab
    this.blobs = new Map() // message id -> { chunks, received, total, bytes }
    this.autoDownloadBytes = DEFAULT_AUTO_DOWNLOAD_BYTES
  }

  get activeRoom () {
    return this.room && { key: this.room.keyHex, name: this.room.name }
  }

  get roomList () {
    return this.room ? [{ key: this.room.keyHex, name: this.room.name }] : []
  }

  get invite () {
    if (!this.room) return null
    return encodeInvite({
      roomKey: this.room.roomKey,
      encryptionKey: this.room.encryptionKey,
      name: this.room.name
    })
  }

  get peerCount () {
    return this.transport?.peerCount ?? 0
  }

  get isHost () {
    return this.transport?.isHost ?? true
  }

  /**
   * Open the room this browser last used, creating one on first visit. Two tabs
   * read the same stored room, which is what puts them in the same channel.
   */
  async ready () {
    const saved = readRoom()
    await this._openRoom(saved || createRoomRecord())
    return this
  }

  async joinRoom (invite) {
    const decoded = decodeInvite(invite) // throws on a bad invite, as the CLI does
    await this._openRoom({
      roomKey: decoded.roomKey,
      encryptionKey: decoded.encryptionKey,
      name: decoded.name
    })
    return this.activeRoom
  }

  async _openRoom (record) {
    this.transport?.close()

    this.messages = []
    this.frames.clear()
    this.blobs.clear()

    this.room = {
      ...record,
      keyHex: b4a.toString(record.roomKey, 'hex'),
      topicHex: b4a.toString(topicFor(record.roomKey), 'hex')
    }
    writeRoom(record)

    this.transport = new BrowserTransport(this.room.keyHex)
    this.transport.addEventListener('message', (event) => {
      this._handle(event.detail).catch((err) => this._notice(err.message, 'error'))
    })
    this.transport.addEventListener('peer', () => this._emitConnection())
    this.transport.addEventListener('host', () => this.dispatchEvent(new CustomEvent('host')))

    this._emitConnection()

    // Ask whoever is already here for the history we missed — the browser
    // equivalent of a hypercore catching up on reconnect.
    this.transport.post({ kind: 'sync-request' })
  }

  // --- sending ------------------------------------------------------------

  async sendText (body) {
    return this._publish(text(this.identity.publicKeyHex, this._clock(), body))
  }

  async setNick (name) {
    this.identity.setNick(name)
    return this._publish(nick(this.identity.publicKeyHex, this._clock(), name))
  }

  async sendPresence (status) {
    return this._publish(presence(this.identity.publicKeyHex, this._clock(), status))
  }

  /**
   * Send a file. The message carries metadata only and the bytes follow as
   * separate sealed chunks — the same split the CLI makes between a `file`
   * message and its Hyperblobs core.
   *
   * @param {File} f
   */
  async sendFile (f) {
    const bytes = new Uint8Array(await f.arrayBuffer())
    const sha256 = b4a.toString(backend.sha256(bytes), 'hex')

    const message = file(this.identity.publicKeyHex, this._clock(), {
      name: f.name,
      size: bytes.byteLength,
      mime: f.type || 'application/octet-stream',
      sha256,
      // No blob core here, so the author key stands in as the source id.
      blobCoreKey: this.identity.publicKeyHex,
      blobId: { blockOffset: 0, blockLength: 1, byteOffset: 0, byteLength: bytes.byteLength }
    })

    // Keep our own copy so the sender can preview it without a round trip.
    this._completeBlob(message.id, bytes, message)
    await this._publish(message)

    const total = Math.max(1, Math.ceil(bytes.byteLength / CHUNK_BYTES))
    for (let seq = 0; seq < total; seq++) {
      const chunk = bytes.subarray(seq * CHUNK_BYTES, (seq + 1) * CHUNK_BYTES)
      const frame = await this._seal(chunk)
      this.transport.post({ kind: 'blob', id: message.id, seq, total, frame: new Uint8Array(frame) })
    }

    return message
  }

  /** Fetch an attachment that was too big to arrive automatically. */
  async download (idOrPrefix) {
    const message = this.messages.find(
      (m) => m.type === 'file' && (m.id === idOrPrefix || m.id.startsWith(idOrPrefix))
    )
    if (!message) throw new Error(`no attachment matching "${idOrPrefix}"`)

    const held = this.blobs.get(message.id)
    if (held?.bytes) {
      this._emitAttachment(message.id, { status: 'ready', progress: 1 })
      return held
    }

    this._emitAttachment(message.id, { status: 'downloading', progress: held ? held.received / held.total : 0 })
    this.transport.post({ kind: 'blob-request', id: message.id })
    return null
  }

  async _publish (message) {
    const frame = await this._seal(encodeMessage(message))
    this.frames.set(message.id, frame)
    this._ingest(message)
    this.transport.send(frame)
    return message
  }

  async _seal (payload) {
    return seal({
      backend,
      encryptionKey: this.room.encryptionKey,
      seed: this.identity.seed,
      publicKey: this.identity.publicKey,
      payload
    })
  }

  // --- receiving ----------------------------------------------------------

  async _handle (data) {
    switch (data.kind) {
      case 'frame':
        return this._openFrame(data.frame)

      case 'sync-request': {
        // Hand the newcomer everything we hold, exactly as replication would.
        for (const frame of this.frames.values()) {
          this.transport.post({ kind: 'frame', frame: new Uint8Array(frame) })
        }
        return
      }

      case 'blob':
        return this._collectChunk(data)

      case 'blob-request': {
        const held = this.blobs.get(data.id)
        if (!held?.bytes) return
        const total = Math.max(1, Math.ceil(held.bytes.byteLength / CHUNK_BYTES))
        for (let seq = 0; seq < total; seq++) {
          const chunk = held.bytes.subarray(seq * CHUNK_BYTES, (seq + 1) * CHUNK_BYTES)
          const frame = await this._seal(chunk)
          this.transport.post({ kind: 'blob', id: data.id, seq, total, frame: new Uint8Array(frame) })
        }
        break
      }

      default:
        break
    }
  }

  async _openFrame (frameBytes) {
    const frame = b4a.from(frameBytes)
    let opened
    try {
      opened = await openEnvelope({ backend, encryptionKey: this.room.encryptionKey, frame })
    } catch (err) {
      // Exactly what a peer without the room key would experience.
      this._notice(`could not read a message (${err.code || err.message})`, 'warn')
      return
    }

    const message = decodeMessage(opened.payload)
    if (message.author !== opened.author) return // signed by someone else

    this.frames.set(message.id, frame)
    this._ingest(message)
  }

  _ingest (message) {
    if (this.messages.some((m) => m.id === message.id)) return

    this.messages = linearize([...this.messages, message])
    this.dispatchEvent(new CustomEvent('messages', { detail: { messages: [message] } }))

    if (message.type === 'file' && message.author !== this.identity.publicKeyHex) {
      if (message.size <= this.autoDownloadBytes) {
        this._emitAttachment(message.id, { status: 'downloading', progress: 0 })
      } else {
        this._emitAttachment(message.id, { status: 'available' })
      }
    }
  }

  async _collectChunk ({ id, seq, total, frame }) {
    const message = this.messages.find((m) => m.id === id)
    if (!message) return

    let held = this.blobs.get(id)
    if (!held || held.bytes) {
      if (held?.bytes) return // already complete
      held = { chunks: new Array(total), received: 0, total }
      this.blobs.set(id, held)
    }
    if (held.chunks[seq]) return

    let opened
    try {
      opened = await openEnvelope({
        backend,
        encryptionKey: this.room.encryptionKey,
        frame: b4a.from(frame)
      })
    } catch {
      this._emitAttachment(id, { status: 'failed', error: 'a chunk failed to decrypt' })
      return
    }

    held.chunks[seq] = opened.payload
    held.received++
    this._emitAttachment(id, { status: 'downloading', progress: held.received / held.total })

    if (held.received < held.total) return

    const bytes = concat(held.chunks)
    this._completeBlob(id, bytes, message)
  }

  _completeBlob (id, bytes, message) {
    // The sender's checksum is the only thing proving these are the bytes they
    // sent — verify it here exactly as the CLI does after a blob fetch.
    const digest = b4a.toString(backend.sha256(bytes), 'hex')
    const verified = digest === message.sha256

    this.blobs.set(id, { bytes, verified, total: 1, received: 1 })
    this._emitAttachment(id, {
      status: verified ? 'ready' : 'failed',
      progress: 1,
      error: verified ? undefined : 'checksum mismatch — the file does not match what was sent'
    })
  }

  /** The decrypted bytes of a completed attachment, for rendering a preview. */
  blobFor (id) {
    return this.blobs.get(id)?.bytes ?? null
  }

  _clock () {
    return nextClock(this.messages)
  }

  _emitAttachment (id, attachment) {
    this.dispatchEvent(new CustomEvent('attachment', { detail: { id, ...attachment } }))
  }

  _emitConnection () {
    this.dispatchEvent(new CustomEvent('connection', {
      detail: {
        state: this.peerCount > 0 ? 'online' : 'connecting',
        peers: this.peerCount
      }
    }))
  }

  _notice (text, level = 'info') {
    this.dispatchEvent(new CustomEvent('notice', { detail: { text, level } }))
  }
}

function createRoomRecord () {
  return {
    roomKey: backend.randomBytes(32),
    encryptionKey: backend.randomBytes(ENCRYPTION_KEY_BYTES),
    name: 'demo'
  }
}

function readRoom () {
  const raw = read(ROOM_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return {
      roomKey: b4a.from(parsed.roomKey, 'hex'),
      encryptionKey: b4a.from(parsed.encryptionKey, 'hex'),
      name: parsed.name
    }
  } catch {
    return null
  }
}

function writeRoom (record) {
  store(ROOM_KEY, JSON.stringify({
    roomKey: b4a.toString(record.roomKey, 'hex'),
    encryptionKey: b4a.toString(record.encryptionKey, 'hex'),
    name: record.name
  }))
}

function concat (chunks) {
  const size = chunks.reduce((n, c) => n + c.byteLength, 0)
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}
