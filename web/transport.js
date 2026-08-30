// The browser stand-in for Hyperswarm.
//
// What it genuinely is: a real transport between real, separate clients. Two
// tabs of this page share an origin, so a BroadcastChannel carries sealed
// envelopes between them and each tab decrypts with its own copy of the room
// key. Nothing above this file knows the difference.
//
// What it is not: the DHT. There is no peer discovery, no NAT traversal, no
// connection to anyone outside this browser. That is the one layer the harness
// simulates, and the page says so.

const CHANNEL_PREFIX = 'openchat:room:'
const HEARTBEAT_MS = 2000
const HOST_ELECTION_MS = 400

export class BrowserTransport extends EventTarget {
  /**
   * @param {string} roomKeyHex scopes the channel, like a swarm topic
   */
  constructor (roomKeyHex) {
    super()
    this.roomKeyHex = roomKeyHex
    this.tabId = Math.random().toString(36).slice(2, 10)
    this.startedAt = Date.now()

    this.peers = new Map() // tabId -> { startedAt, lastSeen }
    this.isHost = true

    this._local = new Set() // in-page listeners: the simulated members
    this._channel = openChannel(CHANNEL_PREFIX + roomKeyHex)

    if (this._channel) {
      this._channel.onmessage = (event) => this._receive(event.data)
    }

    this._announce()
    this._timer = setInterval(() => this._announce(), HEARTBEAT_MS)

    // Give any existing tab a moment to answer before claiming the simulated
    // members, so two tabs do not both run them.
    setTimeout(() => this._elect(), HOST_ELECTION_MS)
  }

  /** Other browser tabs currently in this room. */
  get peerCount () {
    return this.peers.size
  }

  /**
   * Send an envelope to every other client — other tabs and the in-page
   * simulated members alike.
   */
  send (frame) {
    const payload = { kind: 'frame', from: this.tabId, frame: toTransferable(frame) }
    this._post(payload)
    this._deliverLocally(payload)
  }

  /** Send a raw control message (sync requests, blob chunks). */
  post (message) {
    const payload = { ...message, from: this.tabId }
    this._post(payload)
    this._deliverLocally(payload)
  }

  /** Register an in-page participant (a simulated member). */
  addLocalPeer (handler) {
    this._local.add(handler)
    return () => this._local.delete(handler)
  }

  _post (payload) {
    try {
      this._channel?.postMessage(payload)
    } catch {
      // A structured-clone failure would mean a bug in what we are sending;
      // dropping is better than tearing down the room.
    }
  }

  _deliverLocally (payload) {
    for (const handler of this._local) handler(payload)
  }

  _receive (data) {
    if (!data || data.from === this.tabId) return

    if (data.kind === 'hello') {
      this._track(data)
      this._announce() // so the newcomer learns about us too
      this._elect()
      this.dispatchEvent(new CustomEvent('peer', { detail: { tabId: data.from } }))
      return
    }

    if (data.kind === 'bye') {
      this.peers.delete(data.from)
      this._elect()
      this.dispatchEvent(new CustomEvent('peer', { detail: { tabId: data.from, gone: true } }))
      return
    }

    this._track({ from: data.from, startedAt: data.startedAt })

    // Everything else is for the client: envelopes, sync requests, blob chunks.
    this.dispatchEvent(new CustomEvent('message', { detail: data }))
    this._deliverLocally(data)
  }

  _track (data) {
    if (!data.from) return
    const existing = this.peers.get(data.from)
    this.peers.set(data.from, {
      startedAt: data.startedAt ?? existing?.startedAt ?? Date.now(),
      lastSeen: Date.now()
    })
  }

  _announce () {
    this._post({ kind: 'hello', from: this.tabId, startedAt: this.startedAt })

    // Forget tabs that stopped heartbeating (closed without saying goodbye).
    const cutoff = Date.now() - HEARTBEAT_MS * 3
    for (const [id, peer] of this.peers) {
      if (peer.lastSeen < cutoff) this.peers.delete(id)
    }
    this._elect()
  }

  /**
   * Exactly one tab runs the simulated members, otherwise every tab would reply
   * to the same message and the room would echo. Oldest tab wins, with the id
   * as a tiebreak so the choice is the same in every tab.
   */
  _elect () {
    let host = { id: this.tabId, startedAt: this.startedAt }
    for (const [id, peer] of this.peers) {
      if (peer.startedAt < host.startedAt || (peer.startedAt === host.startedAt && id < host.id)) {
        host = { id, startedAt: peer.startedAt }
      }
    }

    const isHost = host.id === this.tabId
    if (isHost === this.isHost) return
    this.isHost = isHost
    this.dispatchEvent(new CustomEvent('host', { detail: { isHost } }))
  }

  close () {
    clearInterval(this._timer)
    this._post({ kind: 'bye', from: this.tabId })
    try {
      this._channel?.close()
    } catch { /* already gone */ }
  }
}

function openChannel (name) {
  try {
    return new BroadcastChannel(name)
  } catch {
    // No BroadcastChannel (very old browser, or a sandbox that blocks it). The
    // page still works; it just cannot talk to other tabs.
    return null
  }
}

// structuredClone handles Uint8Array, but b4a hands back Buffer-flavoured views
// in some builds; normalise so postMessage never chokes.
function toTransferable (bytes) {
  return new Uint8Array(bytes)
}
