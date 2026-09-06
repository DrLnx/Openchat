// Tier 2 — how a joiner gets admitted.
//
// The problem this solves: Corestore replicates cores *by key*, so an existing
// member has no way to discover a newcomer's writer core — they have never seen
// it, so they never ask for it, so the newcomer's join request is invisible no
// matter how it is appended. (This is the same gap Keet fills with blind
// pairing; this is a much smaller version of the same idea.)
//
// So each connection carries a side channel, multiplexed onto the same stream
// Corestore replicates over. On connect, a peer announces its signed JOIN block.
// Any member who is already a writer verifies it and appends it to the room,
// which is what actually admits the newcomer.
//
// The channel is scoped by room key, so two members who share several rooms get
// one pairing channel per room rather than a mixed-up single one.

import Protomux from 'protomux'
import c from 'compact-encoding'
import b4a from 'b4a'

export const PAIRING_PROTOCOL = 'openchat/pair/1'

/**
 * Open one multiplexed side channel on a connection.
 *
 * Shared by room pairing and by DMs, which need the same shape: a small
 * out-of-band message riding alongside Corestore's replication rather than on a
 * socket of its own.
 *
 * @param {object} opts
 * @param {import('stream').Duplex} opts.connection
 * @param {string} opts.protocol   protocol name
 * @param {Uint8Array} opts.id     scopes the channel (a room key, a DM topic)
 * @param {(payload: Uint8Array) => void} opts.onMessage
 * @param {() => void} [opts.onOpen]  the remote has opened its side too
 * @returns {{ send(payload: Uint8Array): void, close(): void, opened: boolean }}
 */
export function attachChannel ({ connection, protocol, id, onMessage, onOpen }) {
  // Protomux.from caches the muxer on the stream, so this is the same muxer
  // Corestore's replication stream is already using — we are adding a channel
  // to it, not competing for the socket.
  const mux = Protomux.from(connection)

  // A channel is only usable once *both* ends have opened it. Anything sent
  // before that is dropped on the floor — which is exactly how a join
  // announcement goes missing and a joiner sits there apparently ignored.
  let opened = false

  const channel = mux.createChannel({
    protocol,
    id: b4a.from(id),
    onopen () {
      opened = true
      onOpen?.()
    },
    onclose () {
      opened = false
    }
  })

  if (!channel) return { send () {}, close () {}, opened: false }

  const message = channel.addMessage({
    encoding: c.buffer,
    onmessage: (payload) => {
      if (payload && payload.byteLength) onMessage(payload)
    }
  })

  channel.open()

  return {
    /** True once the remote has opened its side and a send will arrive. */
    get opened () { return opened && !channel.closed },
    send (payload) {
      if (channel.closed || !opened) return false
      message.send(b4a.from(payload))
      return true
    },
    close () {
      if (!channel.closed) channel.close()
    }
  }
}

/**
 * Attach the room pairing channel to one connection.
 *
 * @param {object} opts
 * @param {import('stream').Duplex} opts.connection  a Hyperswarm connection
 * @param {Uint8Array} opts.roomKey                  scopes the channel
 * @param {(announcement: Uint8Array) => void} opts.onAnnounce
 * @param {() => void} [opts.onReady]  both ends are open; safe to announce
 * @returns {{ announce(block): boolean, opened: boolean, close(): void }}
 */
export function attachPairing ({ connection, roomKey, onAnnounce, onReady }) {
  const channel = attachChannel({
    connection,
    protocol: PAIRING_PROTOCOL,
    id: roomKey,
    onMessage: onAnnounce,
    onOpen: onReady
  })

  return {
    announce: channel.send,
    get opened () { return channel.opened },
    close: channel.close
  }
}
