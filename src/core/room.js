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
  decodeBlock, encodeBlock, joinChallenge, controlChallenge,
  messageKey, writerRecordKey, removedRecordKey,
  MESSAGE_PREFIX, WRITER_PREFIX, REMOVED_PREFIX, META
} from './blocks.js'
import { attachPairing } from './pairing.js'
import { seal, open as openEnvelope } from '../protocol/envelope.js'
import { decodeMessage, encodeMessage, text, file, nick, presence } from '../protocol/messages.js'
import { linearize, nextClock } from '../protocol/order.js'
import { topicFor, encodeInvite } from '../protocol/invite.js'
import { ENCRYPTION_KEY_BYTES } from '../protocol/constants.js'

/** How often an unadmitted joiner repeats its request on an open connection. */
const ANNOUNCE_RETRY_MS = 3000

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
    this._owner = null
    this._closedByOwner = false
    this._removed = false
    this._removedMembers = new Set()

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

  /** The identity key that currently owns the room, hex. */
  get owner () {
    return this._owner
  }

  get isOwner () {
    return this._owner === this.identity.publicKeyHex
  }

  /** A closed room keeps working for its members but admits nobody new. */
  get isClosed () {
    return this._closedByOwner
  }

  /** Identity keys the owner has removed; they cannot rejoin until allowed. */
  get removedMembers () {
    return [...this._removedMembers]
  }

  /**
   * Issue an owner-only action: close, reopen, transfer, or remove a member.
   * Rejected locally when we are not the owner, and again in apply() by every
   * other member — the local check is a courtesy, the one in apply is the rule.
   */
  async control (action, subjectHex = null) {
    if (!this.base.writable) throw new Error('you are not a member of this room')
    if (!this.isOwner) throw new Error(`only the room's owner can ${action} it`)

    const subject = subjectHex
      ? b4a.from(subjectHex, 'hex')
      : b4a.alloc(32)

    if (subjectHex && subject.byteLength !== 32) throw new Error('expected a 32-byte key')

    const ts = Date.now()
    const signature = await backend.sign(
      this.identity.seed,
      controlChallenge({ action, subject, ts })
    )

    await this.base.append(encodeBlock({
      type: 'control',
      action,
      author: this.identity.publicKey,
      subject,
      ts,
      signature
    }))
    await this._refresh()
    return action
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

        const authorHex = b4a.toString(block.author, 'hex')

        // Removal is enforced here, in the log, and not only by the client that
        // relays a join. A removed member still holds the invite and can simply
        // ask again; without this they would be back in immediately.
        if (await view.get(removedRecordKey(authorHex))) continue

        // Note there is deliberately no "is the room closed?" test here.
        // Autobase reapplies the log whenever it learns about concurrent
        // writes, and a close that was concurrent with an existing member's
        // join can be reapplied *before* it — which would silently evict a
        // member who joined while the room was open. Closing is enforced in
        // _admit() instead, at the point where a member decides whether to
        // relay a newcomer at all.
        await host.addWriter(block.writerKey, { indexer: true })
        await view.put(writerRecordKey(authorHex), block.writerKey)

        // Whoever opened the room owns it: the creator's own record is the
        // first join block written, so ownership needs no separate ceremony.
        const owner = await readMeta(view, META.owner)
        if (!owner) await view.put(META.owner, block.author)
        continue
      }

      if (block.type === 'control') {
        const owner = await readMeta(view, META.owner)
        if (!owner || !b4a.equals(owner, block.author)) continue // only the owner

        const valid = await backend.verify(
          block.author,
          block.signature,
          controlChallenge({ action: block.action, subject: block.subject, ts: block.ts })
        )
        if (!valid) continue

        // Refuse anything not newer than the last honoured control block, so a
        // replayed close cannot undo a later reopen.
        const lastTs = Number(b4a.toString((await readMeta(view, META.controlTs)) || b4a.from('0'), 'utf8'))
        if (block.ts <= lastTs) continue
        await view.put(META.controlTs, b4a.from(String(block.ts), 'utf8'))

        switch (block.action) {
          case 'close':
            await view.put(META.closed, b4a.from([1]))
            break
          case 'reopen':
            await view.put(META.closed, b4a.from([0]))
            break
          case 'transfer':
            await view.put(META.owner, block.subject)
            break
          case 'remove': {
            const subjectHex = b4a.toString(block.subject, 'hex')
            // An owner removing themselves would leave the room unownable.
            if (b4a.equals(block.subject, block.author)) break

            await view.put(removedRecordKey(subjectHex), b4a.from([1]))

            const record = await view.get(writerRecordKey(subjectHex))
            if (!record) break
            if (host.removeable(record.value)) await host.removeWriter(record.value)
            await view.del(writerRecordKey(subjectHex))
            break
          }

          case 'allow': {
            // Undo a removal, so a kick is not necessarily permanent.
            await view.del(removedRecordKey(b4a.toString(block.subject, 'hex')))
            break
          }
        }
        continue
      }

      if (block.type === 'message') {
        // A member removed from the room stops being able to add to its log.
        const authorHex = b4a.toString(block.author, 'hex')
        if (!(await view.get(writerRecordKey(authorHex)))) continue
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
    try {
      await this._read()
    } catch (err) {
      // Closing tears cores down under any refresh still in flight; that is
      // teardown, not a fault worth reporting.
      if (this.closed) return
      throw err
    }
  }

  async _read () {
    await this.base.update()
    if (this.closed) return

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
    const left = [...this._writers.keys()].filter((k) => !writers.has(k))

    // Track our own removal as a transition rather than as absence: at startup
    // we are writable before the first refresh has populated the writer list,
    // and "not in the list yet" must not read as "kicked out".
    const me = this.identity.publicKeyHex
    if (writers.has(me)) this._removed = false
    else if (this._writers.has(me)) this._removed = true

    this._writers = writers

    const removed = new Set()
    for await (const entry of view.createReadStream({ gte: REMOVED_PREFIX, lt: REMOVED_PREFIX + '~' })) {
      removed.add(entry.key.slice(REMOVED_PREFIX.length))
    }
    this._removedMembers = removed

    const owner = await readMeta(view, META.owner)
    this._owner = owner ? b4a.toString(owner, 'hex') : null
    const closed = await readMeta(view, META.closed)
    this._closedByOwner = !!(closed && closed[0] === 1)

    if (fresh.length) {
      this._messages = linearize([...this._messages, ...fresh])
      this.emit('messages', fresh)
    }
    for (const author of joined) this.emit('member', author)
    for (const author of left) this.emit('member-removed', author)
    if (fresh.length || joined.length || left.length) this.emit('update')
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
    swarm.join(this.topic) // returns immediately; discovery settles in the background
    return this
  }

  _attachPairing (connection) {
    let pairing = null

    // Announce ourselves to whoever just showed up. Members already in the room
    // ignore a block they have applied before; a member who has never seen us
    // admits us.
    //
    // Announced more than once, on purpose. A protomux channel drops anything
    // written before the remote has opened its side, so a single announcement
    // at attach time is a coin flip — win it and you are admitted in a second,
    // lose it and you sit there forever, connected to a member who never heard
    // you ask. So we say it when the channel opens, say it again straight away
    // in case it was already open, and keep saying it while we are still not a
    // writer. A member who has already applied our block ignores the repeats.
    const announce = () => {
      if (pairing && this._joinBlock && !this.base.writable) pairing.announce(this._joinBlock)
    }

    pairing = attachPairing({
      connection,
      roomKey: this.base.key,
      onAnnounce: (block) => {
        this._admit(block).catch((err) => this.emit('error', err))
      },
      onReady: announce
    })

    this._pairings.add(pairing)
    announce()

    // Unref'd so a room waiting to be admitted is never the reason the process
    // stays up.
    const retry = setInterval(announce, ANNOUNCE_RETRY_MS)
    retry.unref?.()

    connection.once('close', () => {
      clearInterval(retry)
      this._pairings.delete(pairing)
    })

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

    // A closed room admits nobody new. This is enforced by members' clients
    // rather than by the log itself: a member who wanted to could still relay
    // a join, exactly as they could hand out the invite again. Closing keeps
    // honest clients out, it does not make the room cryptographically sealed.
    if (this._closedByOwner) return

    // Someone the owner removed does not get relayed back in. apply() enforces
    // this too; refusing here just saves a pointless append.
    if (this._removedMembers.has(authorHex)) return

    const valid = await backend.verify(block.author, block.signature, joinChallenge(block.writerKey))
    if (!valid) return

    await this.base.append(blockBuffer)
    await this._refresh()
  }

  /**
   * Resolve once we can post, or reject on timeout.
   *
   * A timeout of 0 waits indefinitely, which is what the app does after a
   * `/join`: admission needs another member to be online, that is not something
   * the joiner can hurry along, and a deadline would only turn "nobody is
   * around yet" into an error for something that is still going to happen.
   */
  async waitForWritable (timeout = 30000) {
    if (this.base.writable) return true

    return new Promise((resolve, reject) => {
      const timer = timeout
        ? setTimeout(() => {
          cleanup()
          reject(new Error('timed out waiting to be admitted — is another member online?'))
        }, timeout)
        : null

      // Unref'd so a background wait can never be the reason a command will not
      // exit: a one-shot `openchat room join` would otherwise sit here for the
      // full timeout after it had already done its work.
      timer?.unref?.()

      const check = () => {
        if (this.closed) {
          cleanup()
          reject(new Error('room closed while waiting to be admitted'))
          return
        }
        if (!this.base.writable) return
        cleanup()
        resolve(true)
      }
      const cleanup = () => {
        if (timer) clearTimeout(timer)
        this.base.off('update', check)
        this.off('closing', check)
      }

      this.base.on('update', check)
      this.once('closing', check)
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
    // Removal is checked first: it also takes away write access, so the generic
    // "not a writer yet" message would be technically true and actively
    // misleading — you are not waiting for anything.
    if (this._removed) {
      throw new Error('you have been removed from this room')
    }
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
    this.emit('closing')
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

/** Hyperbee returns { key, value } or null; meta values are raw buffers. */
async function readMeta (view, key) {
  const node = await view.get(key)
  return node ? node.value : null
}

function randomNamespace () {
  return b4a.toString(backend.randomBytes(16), 'hex')
}
