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
 * Attach the pairing channel to one connection.
 *
 * @param {object} opts
 * @param {import('stream').Duplex} opts.connection  a Hyperswarm connection
 * @param {Uint8Array} opts.roomKey                  scopes the channel
 * @param {(announcement: Uint8Array) => void} opts.onAnnounce
 * @returns {{ announce(block: Uint8Array): void, close(): void }}
 */
export function attachPairing ({ connection, roomKey, onAnnounce }) {
  // Protomux.from caches the muxer on the stream, so this is the same muxer
  // Corestore's replication stream is already using — we are adding a channel
  // to it, not competing for the socket.
  const mux = Protomux.from(connection)

  const channel = mux.createChannel({
    protocol: PAIRING_PROTOCOL,
    id: b4a.from(roomKey),
    // A peer that does not speak this protocol simply never opens the channel;
    // replication still works, they just cannot admit anyone.
    onopen () {},
    onclose () {}
  })

  if (!channel) return { announce () {}, close () {} }

  const announcement = channel.addMessage({
    encoding: c.buffer,
    onmessage: (block) => {
      if (block && block.byteLength) onAnnounce(block)
    }
  })

  channel.open()

  return {
    announce (block) {
      if (channel.closed) return
      announcement.send(b4a.from(block))
    },
    close () {
      if (!channel.closed) channel.close()
    }
  }
}
