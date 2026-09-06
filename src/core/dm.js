// Tier 2 — direct messages.
//
// A DM needs no invite, and that falls out of the identity design rather than
// being bolted on. Both people already have Ed25519 identity keys; those
// convert to X25519, so each side can run Diffie-Hellman against the other's
// *public* key and independently arrive at the same secret. Nothing is
// transmitted, nothing is negotiated, and there is no invite string to leak.
//
// From that shared secret we derive:
//   · the discovery topic — so only the two of you can even compute where the
//     conversation lives. A third party watching the DHT cannot tell you are
//     talking, let alone read it.
//   · the encryption key for both outbox cores and every envelope in them.
//
// Structurally a DM is not an Autobase. With exactly two participants there is
// nothing to linearize across an unknown writer set: each side appends to its
// own outbox core, both sides read both, and protocol/order.js merges them into
// one transcript. That is the same ordering rule the rooms use, which is why
// two people always see the same conversation.

import { EventEmitter } from 'node:events'
import sodium from 'sodium-native'
import b4a from 'b4a'

import backend from './crypto-node.js'
import { attachChannel } from './pairing.js'
import { seal, open as openEnvelope } from '../protocol/envelope.js'
import { decodeMessage, encodeMessage, text, file, nick } from '../protocol/messages.js'
import { linearize, nextClock } from '../protocol/order.js'
import { ENCRYPTION_KEY_BYTES } from '../protocol/constants.js'

const TOPIC_CONTEXT = 'openchat:dm:topic:v1'
const KEY_CONTEXT = 'openchat:dm:enc:v1'
const INBOX_CONTEXT = 'openchat:dm:inbox:v1'
export const DM_PROTOCOL = 'openchat/dm/1'
export const DM_HELLO_PROTOCOL = 'openchat/dm-hello/1'

/**
 * The topic you can be reached on by anyone who knows your public key.
 *
 * A conversation's own topic is derived from *both* identities, which is what
 * makes it unguessable — and also what makes an unannounced first message
 * impossible: the person you are writing to cannot derive that topic without
 * already knowing your key, so they are not listening on it, so you are talking
 * to an empty room.
 *
 * This is the one rendezvous that needs only one key: yours. You announce it,
 * anyone holding your public key can find you there and say who they are, and
 * from that point on both sides can derive the real topic and move to it.
 * Nothing sensitive rides on it — someone who can compute it already had your
 * public key, which is the thing you hand out.
 */
export function inboxTopic (publicKey) {
  const out = b4a.alloc(32)
  const input = b4a.concat([
    b4a.from(`${INBOX_CONTEXT}:`, 'utf8'),
    b4a.from(publicKey)
  ])
  sodium.crypto_generichash(out, input)
  return out
}

/** How often an unpaired side repeats its outbox key on an open connection. */
const ANNOUNCE_RETRY_MS = 3000

/**
 * Ed25519 → X25519 → shared secret.
 *
 * @param {Uint8Array} seed        our 32-byte identity seed
 * @param {Uint8Array} theirPublicKey  their 32-byte Ed25519 public key
 * @returns {Uint8Array} 32-byte shared secret, identical on both sides
 */
export function sharedSecret (seed, theirPublicKey) {
  const { secretKey } = backend.keyPairFromSeed(seed)

  const mine = b4a.alloc(sodium.crypto_scalarmult_SCALARBYTES)
  sodium.crypto_sign_ed25519_sk_to_curve25519(mine, secretKey)

  const theirs = b4a.alloc(sodium.crypto_scalarmult_BYTES)
  sodium.crypto_sign_ed25519_pk_to_curve25519(theirs, b4a.from(theirPublicKey))

  const secret = b4a.alloc(sodium.crypto_scalarmult_BYTES)
  sodium.crypto_scalarmult(secret, mine, theirs)
  return secret
}

/**
 * Everything a DM needs, derived from the two identities alone.
 *
 * @returns {{ topic: Uint8Array, encryptionKey: Uint8Array, pair: string }}
 */
export function deriveChannel (seed, ourPublicKey, theirPublicKey) {
  const secret = sharedSecret(seed, theirPublicKey)

  // Order the two keys so both sides hash the same thing.
  const ours = b4a.toString(ourPublicKey, 'hex')
  const theirs = b4a.toString(theirPublicKey, 'hex')
  const pair = ours < theirs ? `${ours}:${theirs}` : `${theirs}:${ours}`

  return {
    topic: derive(secret, TOPIC_CONTEXT, pair),
    encryptionKey: derive(secret, KEY_CONTEXT, pair),
    pair
  }
}

function derive (secret, context, pair) {
  const out = b4a.alloc(32)
  const input = b4a.concat([secret, b4a.from(`${context}:${pair}`, 'utf8')])
  sodium.crypto_generichash(out, input)
  return out
}

export class DirectChannel extends EventEmitter {
  /**
   * @param {object} opts
   * @param {import('corestore')} opts.store
   * @param {import('./identity.js').Identity} opts.identity
   * @param {string} opts.peerKey   their Ed25519 public key, hex
   * @param {string} [opts.peerName]
   * @param {string} [opts.peerOutbox]  their outbox core key, if already known
   */
  constructor ({ store, identity, peerKey, peerName = null, peerOutbox = null }) {
    super()
    this.identity = identity
    this.peerKey = peerKey.toLowerCase()
    this.peerName = peerName
    this.closed = false

    const derived = deriveChannel(identity.seed, identity.publicKey, b4a.from(this.peerKey, 'hex'))
    this.topic = derived.topic
    this.encryptionKey = derived.encryptionKey

    if (this.encryptionKey.byteLength !== ENCRYPTION_KEY_BYTES) {
      throw new Error('derived a DM key of the wrong size')
    }

    this.store = store.namespace(`dm:${this.peerKey}`)
    this._peerOutboxKey = peerOutbox
    this._messages = []
    this._seen = new Set()
    this._channels = new Set()

    this.outbox = null
    this.inbox = null
  }

  /** A stable id for this conversation, for the UI's conversation list. */
  get id () {
    return `dm:${this.peerKey}`
  }

  get name () {
    return this.peerName || this.peerKey.slice(0, 8)
  }

  get messages () {
    return this._messages
  }

  get outboxKey () {
    return this.outbox ? b4a.toString(this.outbox.key, 'hex') : null
  }

  async ready () {
    // Our own outbox. Only we ever append to it; the peer replicates it.
    this.outbox = this.store.get({ name: 'outbox', encryptionKey: this.encryptionKey })
    await this.outbox.ready()

    if (this._peerOutboxKey) await this._openInbox(this._peerOutboxKey)
    await this._refresh()
    return this
  }

  async _openInbox (keyHex) {
    if (this.inbox) return this.inbox
    if (!keyHex || keyHex === this.outboxKey) return null

    this.inbox = this.store.get({
      key: b4a.from(keyHex, 'hex'),
      encryptionKey: this.encryptionKey
    })
    await this.inbox.ready()
    this._peerOutboxKey = keyHex

    const reread = () => {
      this._refresh().catch((err) => this.emit('error', err))
    }

    // 'append' fires when their core grows, but a core opened by key already
    // knows its length before any block has arrived — the read below would find
    // nothing and never be retried. 'download' is the event that says the bytes
    // are actually here.
    this.inbox.on('append', reread)
    this.inbox.on('download', reread)

    // Keep pulling their history in the background rather than only on demand.
    this.inbox.download({ start: 0, end: -1, linear: true })

    this.emit('peer-outbox', keyHex)
    return this.inbox
  }

  /**
   * Join the derived topic and swap outbox keys with whoever turns up.
   *
   * The exchange is the one round trip a DM needs: the topic tells us we found
   * the right person (only they can compute it), but each side still has to
   * learn which core to replicate. After the first meeting it is cached.
   */
  async attachSwarm (swarm) {
    this._swarm = swarm
    swarm.on('connection', (connection) => this._attach(connection))
    for (const connection of swarm.connections) this._attach(connection)

    swarm.join(this.topic)

    // Also knock on their door. They cannot be listening on our shared topic
    // until they know who we are, so the first contact happens on the one
    // topic they *are* listening on: their own.
    swarm.join(inboxTopic(b4a.from(this.peerKey, 'hex')))
    return this
  }

  _attach (connection) {
    // The whole handshake happens here, on their inbox channel, and it carries
    // the outbox key rather than a bare knock.
    //
    // It has to, because the conversation's own channel cannot be relied on for
    // it. We open ours the moment we connect; they cannot open theirs until
    // this message has told them the conversation exists. A protomux channel
    // whose remote opens late never pairs — the OPEN arrived when there was
    // nothing to deliver it to and is not sent again — so the key would sit
    // there undelivered and the conversation would carry nothing.
    //
    // The inbox channel has no such race: both sides attach it the moment the
    // connection exists, one from this conversation and one from the client
    // listening on its own inbox topic. See Client._listenForDms.
    let hello = null
    const knock = () => {
      if (this.outbox) hello?.send(this.outbox.key)
    }
    hello = attachChannel({
      connection,
      protocol: DM_HELLO_PROTOCOL,
      id: inboxTopic(b4a.from(this.peerKey, 'hex')),
      onMessage: (payload) => {
        this._handleAnnounce(payload).catch((err) => this.emit('error', err))
      },
      onOpen: knock
    })
    knock()
    this._channels.add(hello)

    let channel = null

    // Swap outbox keys once the channel is open at both ends, and keep offering
    // until the other side has told us theirs. A protomux channel drops
    // anything written before the remote opens its side, and a dropped key here
    // is a DM that connects and then silently carries nothing.
    const announce = () => {
      if (channel && this.outbox) channel.send(this.outbox.key)
    }

    channel = attachChannel({
      connection,
      protocol: DM_PROTOCOL,
      id: this.topic,
      onMessage: (payload) => {
        this._handleAnnounce(payload).catch((err) => this.emit('error', err))
      },
      onOpen: announce
    })

    this._channels.add(channel)
    announce()

    const retry = setInterval(() => {
      if (this.inbox) clearInterval(retry)
      else announce()
    }, ANNOUNCE_RETRY_MS)
    retry.unref?.()

    connection.once('close', () => {
      clearInterval(retry)
      this._channels.delete(channel)
    })

    return channel
  }

  async _handleAnnounce (payload) {
    if (!payload || payload.byteLength !== 32) return
    const keyHex = b4a.toString(payload, 'hex')
    if (keyHex === this.outboxKey) return // our own announcement echoed back

    await this._openInbox(keyHex)
    await this._refresh()
  }

  // --- reading ------------------------------------------------------------

  async _refresh () {
    if (this.closed) return
    try {
      await this._read()
    } catch (err) {
      // See Room._refresh: closing pulls the cores out from under a read.
      if (this.closed) return
      throw err
    }
  }

  async _read () {
    const fresh = []
    for (const core of [this.outbox, this.inbox]) {
      if (!core) continue
      for (let i = 0; i < core.length; i++) {
        const message = await this._readBlock(core, i)
        if (message) fresh.push(message)
      }
    }

    const added = fresh.filter((m) => !this._seen.has(m.id))
    for (const m of added) this._seen.add(m.id)

    if (added.length) {
      this._messages = linearize([...this._messages, ...added])
      this.emit('messages', added)
    }
  }

  async _readBlock (core, index) {
    let frame
    try {
      frame = await core.get(index, { wait: false })
    } catch {
      return null
    }
    if (!frame) return null

    try {
      const { author, payload } = await openEnvelope({
        backend,
        encryptionKey: this.encryptionKey,
        frame
      })
      const message = decodeMessage(payload)

      // The envelope proves who sealed it; the body has to agree, and in a DM
      // there are only two people it can legitimately be.
      if (message.author !== author) return null
      if (author !== this.peerKey && author !== this.identity.publicKeyHex) return null

      return message
    } catch (err) {
      this.emit('undecodable', { index, error: err })
      return null
    }
  }

  // --- sending ------------------------------------------------------------

  async sendText (body) {
    return this._append(text(this.identity.publicKeyHex, this._nextClock(), body))
  }

  async sendFile (meta) {
    return this._append(file(this.identity.publicKeyHex, this._nextClock(), meta))
  }

  async setNick (name) {
    return this._append(nick(this.identity.publicKeyHex, this._nextClock(), name))
  }

  async _append (message) {
    const frame = await seal({
      backend,
      encryptionKey: this.encryptionKey,
      seed: this.identity.seed,
      publicKey: this.identity.publicKey,
      payload: encodeMessage(message)
    })

    await this.outbox.append(frame)
    await this._refresh()
    return message
  }

  _nextClock () {
    return nextClock(this._messages)
  }

  async close () {
    if (this.closed) return
    this.closed = true
    for (const channel of this._channels) channel.close()
    this._channels.clear()
    if (this.outbox) await this.outbox.close()
    if (this.inbox) await this.inbox.close()
  }
}
