// Tier 2 — discovery and transport.
//
// Hyperswarm finds peers on the DHT by topic and holepunches through NATs; the
// connections it hands back are already Noise-encrypted and authenticated to
// the peer's public key. We pipe each one straight into Corestore's replication
// stream, which is what actually moves hypercore blocks between members.
//
// Joining a topic is public: anyone can look it up and connect. The room's
// content stays unreadable without the encryption key from the invite.

import Hyperswarm from 'hyperswarm'
import DHT from 'hyperdht'
import b4a from 'b4a'
import { EventEmitter } from 'node:events'

export class Swarm extends EventEmitter {
  /**
   * @param {object} opts
   * @param {import('corestore')} opts.store
   * @param {Uint8Array} [opts.seed]       32-byte seed, so the swarm keypair is stable across restarts
   * @param {Array} [opts.bootstrap]       override DHT bootstrap nodes (tests use a local testnet)
   * @param {string} [opts.host]           bind the DHT to a specific address
   */
  constructor ({ store, seed, bootstrap, host }) {
    super()
    this.store = store

    // Normally Hyperswarm builds its own DHT node. We only construct one by
    // hand when `host` is set, which the tests need: address discovery picks the
    // container's outward interface, and in a sandbox that can be an address
    // the machine cannot reach itself on, so a local testnet never connects.
    const dht = host
      ? new DHT({ host, ...(bootstrap ? { bootstrap } : {}) })
      : null

    this.swarm = new Hyperswarm({
      seed: seed ? b4a.from(seed) : undefined,
      ...(bootstrap ? { bootstrap } : {}),
      ...(dht ? { dht } : {})
    })
    this._ownsDht = !!dht
    this.connections = new Set()
    this.topics = new Map()

    this.swarm.on('connection', (connection, info) => {
      const remote = b4a.toString(connection.remotePublicKey, 'hex')
      this.connections.add(connection)

      // Corestore decides which cores this peer may replicate; a peer without
      // the room's encryption key gets blocks it cannot decrypt.
      this.store.replicate(connection)

      connection.on('close', () => {
        this.connections.delete(connection)
        this.emit('peer-close', remote, info)
      })
      connection.on('error', (err) => this.emit('peer-error', remote, err))

      // Rooms listen for this to attach their pairing channel to the same
      // stream — see core/pairing.js.
      this.emit('connection', connection, info)
      this.emit('peer', remote, info)
    })
  }

  get publicKey () {
    return this.swarm.keyPair.publicKey
  }

  get peerCount () {
    return this.connections.size
  }

  /**
   * Deliberately does not wait for the DHT to bootstrap. Announcing and looking
   * up take seconds on a good connection and forever on a bad one, and blocking
   * on either means the UI cannot paint until the network cooperates. Hyperswarm
   * queues the work; peers arrive later via the `connection` event.
   */
  async ready () {
    return this
  }

  /** Resolve once the DHT node is bootstrapped — for tests and diagnostics. */
  async bootstrapped () {
    await this.swarm.dht.ready()
    return this
  }

  /**
   * Announce and look up a room topic. Returns as soon as the lookup is queued;
   * await `discovery.flushed()` yourself if you need it to have landed.
   *
   * @param {Uint8Array} topic 32-byte discovery topic (see protocol/invite.js)
   */
  join (topic) {
    const id = b4a.toString(topic, 'hex')
    if (this.topics.has(id)) return this.topics.get(id)

    const discovery = this.swarm.join(b4a.from(topic), { server: true, client: true })
    this.topics.set(id, discovery)

    // Surface announce failures rather than leaving an unhandled rejection.
    discovery.flushed().then(
      () => this.emit('announced', id),
      (err) => this.emit('announce-error', id, err)
    )

    return discovery
  }

  async leave (topic) {
    const id = b4a.toString(topic, 'hex')
    const discovery = this.topics.get(id)
    if (!discovery) return
    this.topics.delete(id)
    await discovery.destroy()
  }

  /** Resolve once every currently-known peer has been connected to. */
  async flush () {
    return this.swarm.flush()
  }

  async destroy () {
    for (const discovery of this.topics.values()) await discovery.destroy().catch(() => {})
    this.topics.clear()
    await this.swarm.destroy()
    // Hyperswarm only tears down a DHT node it created itself.
    if (this._ownsDht) await this.swarm.dht.destroy()
  }
}

export async function createSwarm (opts) {
  const swarm = new Swarm(opts)
  await swarm.ready()
  return swarm
}
