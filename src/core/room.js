// Tier 2 — a room: an Autobase of per-member writer cores, linearized into a
// Hyperbee of sealed envelopes.
//
// Membership is the Autobase's writer set. A joiner holding the invite
// broadcasts a JOIN block over the pairing channel (see pairing.js); any member
// who is already a writer verifies the signature binds that writer core to that
// identity key, then appends it, which admits them.
//
// This is the MVP trust model from the plan and it is deliberately open: anyone
// with the invite becomes a writer, no admin approval. Two consequences worth
// knowing — an existing writer has to be online for a newcomer to get in, and a
// leaked invite is a leaked room. Admin-gated membership is phase 7.

import { EventEmitter } from 'node:events'
import Autobase from 'autobase'
import Hyperbee from 'hyperbee'
import b4a from 'b4a'

import backend from './crypto-node.js'
import {
  decodeBlock, encodeBlock, joinChallenge,
  messageKey, writerRecordKey, MESSAGE_PREFIX, WRITER_PREFIX
} from './blocks.js'
import { attachPairing } from './pairing.js'
import { seal, open as openEnvelope } from '../protocol/envelope.js'
import { decodeMessage, encodeMessage, text, file, nick, presence } from '../protocol/messages.js'
import { linearize, nextClock } from '../protocol/order.js'
import { topicFor, encodeInvite } from '../protocol/invite.js'
import { ENCRYPTION_KEY_BYTES } from '../protocol/constants.js'

export class Room extends EventEmitter {
  /**
   * @param {object} opts
   * @param {import('corestore')} opts.store
   * @param {import('./identity.js').Identity} opts.identity
   * @param {Uint8Array} opts.encryptionKey  32-byte room secret from the invite
   * @param {Uint8Array} [opts.roomKey]      Autobase bootstrap key; omit to create a new room
   * @param {string} [opts.name]
   * @param {string} [opts.namespace]        Corestore namespace holding this room's cores
   */
  constructor ({ store, identity, encryptionKey, roomKey = null, name = '', namespace }) {
    super()
    if (!encryptionKey || encryptionKey.byteLength !== ENCRYPTION_KEY_BYTES) {
      throw new Error(`encryptionKey must be ${ENCRYPTION_KEY_BYTES} bytes`)
    }

    this.identity = identity
    this.encryptionKey = b4a.from(encryptionKey)
    this.name = name
    this.namespace = namespace || (roomKey ? b4a.toString(roomKey, 'hex') : randomNamespace())
    this.store = store.namespace(this.namespace)
    this.closed = false

    this._messages = []
    this._seen = new Set()
    this._writers = new Map() // author hex -> writer core key hex
    this._joinBlock = null
    this._pairings = new Set()
    this._swarm = null

    this.base = new Autobase(this.store, roomKey ? b4a.from(roomKey) : null, {
      encryptionKey: this.encryptionKey,
      encrypted: true,
      valueEncoding: 'binary',
      ackInterval: 1000,
      open: (store) => new Hyperbee(store.get('messages'), {
        keyEncoding: 'utf-8',
        valueEncoding: 'binary',
        extension: false
      }),
      apply: (nodes, view, host) => this._apply(nodes, view, host)
    })

    this._onUpdate = () => {
      this._refresh().catch((err) => this.emit('error', err))
    }
  }

  async ready () {
    await this.base.ready()
    this.base.on('update', this._onUpdate)
    await this._refresh()
    await this._recordSelf()
    return this
  }

  /**
   * A room's creator is a writer from birth and so never goes through the join
   * flow — which means nothing ever writes their membership record and they are
   * missing from their own member list. Write it once, here.
   */
  async _recordSelf () {
    if (!this.base.writable) return
    if (this._writers.has(this.identity.publicKeyHex)) return

    const writerKey = this.base.local.key
    const signature = await backend.sign(this.identity.seed, joinChallenge(writerKey))
    await this.base.append(encodeBlock({
      type: 'join',
      writerKey,
      author: this.identity.publicKey,
      signature
    }))
    await this._refresh()
  }

  get key () { return this.base.key }
  get keyHex () { return b4a.toString(this.base.key, 'hex') }
  get topic () { return topicFor(this.base.key) }
  get writable () { return this.base.writable }
  get messages () { return this._messages }

  get invite () {
    return encodeInvite({
      roomKey: this.base.key,
      encryptionKey: this.encryptionKey,
      name: this.name
    })
  }

  /** Members known to the room: everyone whose writer core has been admitted. */
  get members () {
    return [...this._writers.keys()]
  }

  // --- Autobase internals -------------------------------------------------

  async _apply (nodes, view, host) {
    for (const node of nodes) {
      let block
      try {
        block = decodeBlock(node.value)
      } catch {
        // A block we cannot parse is either corrupt or from a future protocol
        // version. Skipping keeps old clients usable rather than wedging them.
        continue
      }

      if (block.type === 'join') {
        // The signature is the gate: it proves the identity key in the block
        // owns the writer core the block is admitting. Without this check any
        // member could add an arbitrary core as a writer. Note this runs on
        // every reapply, so it must stay deterministic — it is, given the key.
        const valid = await backend.verify(
          block.author,
          block.signature,
          joinChallenge(block.writerKey)
        )
        if (!valid) continue

        await host.addWriter(block.writerKey, { indexer: true })
        await view.put(writerRecordKey(b4a.toString(block.author, 'hex')), block.writerKey)
        continue
      }

      if (block.type === 'message') {
        await view.put(messageKey(block), block.frame)
      }
    }
  }

  /**
   * Re-read the linearized view and emit whatever is new.
   *
   * Autobase can reorder history as it learns about concurrent writes, so this
   * re-reads the whole message range rather than tailing it, and dedupes by
   * message id. Fine at room scale; if a room ever grows past a few thousand
   * messages this is the thing to make incremental.
   */
  async _refresh () {
    if (this.closed) return
    await this.base.update()

    const view = this.base.view
    if (!view) return

    const fresh = []
    for await (const entry of view.createReadStream({ gte: MESSAGE_PREFIX, lt: MESSAGE_PREFIX + '~' })) {
      const id = entry.key.slice(entry.key.lastIndexOf(':') + 1)
      if (this._seen.has(id)) continue

      try {
        const { author, payload } = await openEnvelope({
          backend,
          encryptionKey: this.encryptionKey,
          frame: entry.value
        })
        const message = decodeMessage(payload)

        // The envelope's signature proves who sealed it; make sure the message
        // body agrees, so a member cannot post under someone else's name.
        if (message.author !== author) continue

        this._seen.add(id)
        fresh.push(message)
      } catch (err) {
        this.emit('undecodable', { key: entry.key, error: err })
      }
    }

    const writers = new Map()
    for await (const entry of view.createReadStream({ gte: WRITER_PREFIX, lt: WRITER_PREFIX + '~' })) {
      writers.set(entry.key.slice(WRITER_PREFIX.length), b4a.toString(entry.value, 'hex'))
    }

    const joined = [...writers.keys()].filter((k) => !this._writers.has(k))
    this._writers = writers

    if (fresh.length) {
      this._messages = linearize([...this._messages, ...fresh])
      this.emit('messages', fresh)
    }
    for (const author of joined) this.emit('member', author)
    if (fresh.length || joined.length) this.emit('update')
  }

  // --- Membership ---------------------------------------------------------

  /**
   * Wire this room to a swarm: join its topic and attach the pairing channel to
   * every connection, now and in future.
   */
  async attachSwarm (swarm) {
    this._swarm = swarm
    swarm.on('connection', (connection) => this._attachPairing(connection))
    for (const connection of swarm.connections) this._attachPairing(connection)
    await swarm.join(this.topic)
    return this
  }

  _attachPairing (connection) {
    const pairing = attachPairing({
      connection,
      roomKey: this.base.key,
      onAnnounce: (block) => {
        this._admit(block).catch((err) => this.emit('error', err))
      }
    })

    this._pairings.add(pairing)
    connection.once('close', () => this._pairings.delete(pairing))

    // Announce ourselves to whoever just showed up. Members already in the room
    // ignore a block they have applied before; a member who has never seen us
    // admits us.
    if (this._joinBlock) pairing.announce(this._joinBlock)
    return pairing
  }

  /**
   * Ask to become a writer: build our signed JOIN block and broadcast it. An
   * existing writer has to be online to act on it — see waitForWritable.
   */
  async requestJoin () {
    if (this.base.writable) return

    if (!this._joinBlock) {
      const writerKey = this.base.local.key
      const signature = await backend.sign(this.identity.seed, joinChallenge(writerKey))
      this._joinBlock = encodeBlock({
        type: 'join',
        writerKey,
        author: this.identity.publicKey,
        signature
      })
    }

    for (const pairing of this._pairings) pairing.announce(this._joinBlock)
  }

  /**
   * Act on someone else's join announcement. Only a writer can admit anyone;
   * everyone else just holds onto it in case they become one.
   */
  async _admit (blockBuffer) {
    let block
    try {
      block = decodeBlock(blockBuffer)
    } catch {
      return // not a block we understand — ignore rather than crash the peer
    }
    if (block.type !== 'join') return

    const authorHex = b4a.toString(block.author, 'hex')
    if (this._writers.has(authorHex)) return // already a member
    if (!this.base.writable) return // we cannot admit anyone ourselves

    const valid = await backend.verify(block.author, block.signature, joinChallenge(block.writerKey))
    if (!valid) return

    await this.base.append(blockBuffer)
    await this._refresh()
  }

  /** Resolve once we can post, or reject on timeout. */
  async waitForWritable (timeout = 30000) {
    if (this.base.writable) return true

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('timed out waiting to be admitted — is another member online?'))
      }, timeout)

      const check = () => {
        if (!this.base.writable) return
        cleanup()
        resolve(true)
      }
      const cleanup = () => {
        clearTimeout(timer)
        this.base.off('update', check)
      }

      this.base.on('update', check)
      check()
    })
  }

  // --- Sending ------------------------------------------------------------

  async sendText (body) {
    return this._append(text(this.identity.publicKeyHex, this._nextClock(), body))
  }

  async sendFile (meta) {
    return this._append(file(this.identity.publicKeyHex, this._nextClock(), meta))
  }

  async setNick (name) {
    return this._append(nick(this.identity.publicKeyHex, this._nextClock(), name))
  }

  async sendPresence (status) {
    return this._append(presence(this.identity.publicKeyHex, this._nextClock(), status))
  }

  async _append (message) {
    if (!this.base.writable) {
      throw new Error('not a writer in this room yet — waiting to be admitted')
    }

    const frame = await seal({
      backend,
      encryptionKey: this.encryptionKey,
      seed: this.identity.seed,
      publicKey: this.identity.publicKey,
      payload: encodeMessage(message)
    })

    await this.base.append(encodeBlock({
      type: 'message',
      clock: message.clock,
      id: message.id,
      author: this.identity.publicKey,
      frame
    }))

    await this._refresh()
    return message
  }

  _nextClock () {
    return nextClock(this._messages)
  }

  async close () {
    if (this.closed) return
    this.closed = true
    this.base.off('update', this._onUpdate)
    for (const pairing of this._pairings) pairing.close()
    this._pairings.clear()
    await this.base.close()
  }
}

/**
 * Create a brand new room. The encryption key is generated here and never
 * leaves this machine except inside an invite.
 */
export async function createRoom ({ store, identity, name }) {
  const room = new Room({
    store,
    identity,
    name,
    encryptionKey: backend.randomBytes(ENCRYPTION_KEY_BYTES)
  })
  await room.ready()
  return room
}

/** Open a room from an invite (or from remembered config). */
export async function openRoom ({ store, identity, roomKey, encryptionKey, name, namespace }) {
  const room = new Room({ store, identity, roomKey, encryptionKey, name, namespace })
  await room.ready()
  return room
}

function randomNamespace () {
  return b4a.toString(backend.randomBytes(16), 'hex')
}
