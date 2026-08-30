// Simulated room members.
//
// These are not fake messages painted onto the screen. Each simulated member
// has its own Ed25519 identity, seals its own envelopes with the room key, and
// posts them over the same transport a second browser tab would use — the
// client decrypts and verifies them without knowing they came from in-page.
// That is the difference between a demo and a mock: the receive path being
// exercised here is the real one.
//
// Only the host tab runs them (see transport._elect), so opening a second tab
// does not double every reply.

import b4a from 'b4a'

import backend from '../src/protocol/crypto-web.js'
import { seal } from '../src/protocol/envelope.js'
import { encodeMessage, text, nick, presence } from '../src/protocol/messages.js'
import { nextClock } from '../src/protocol/order.js'

const MEMBERS = [
  {
    name: 'ada',
    seedByte: 0x11,
    opening: 'morning — did the invite reach everyone?',
    replies: [
      'makes sense to me.',
      'agreed. want me to write that up?',
      "I'll take a look after standup.",
      'good catch — that would have bitten us.',
      'yep, same on my side.'
    ]
  },
  {
    name: 'grace',
    seedByte: 0x22,
    opening: 'got it, joined from the laptop. no server in sight 🎉',
    replies: [
      'one thing: does that hold if someone is offline for a week?',
      'nice. that is the bit I was worried about.',
      'can you share the invite again? I want to test a third device.',
      'let me try that now.',
      'sounds right.'
    ]
  },
  {
    name: 'linus',
    seedByte: 0x33,
    opening: null,
    replies: [
      '+1',
      'shipping it.',
      'hm, what happens on a reconnect?',
      'reads fine to me.'
    ]
  }
]

export class SimulatedMembers {
  /**
   * @param {import('./client.js').BrowserClient} client
   */
  constructor (client) {
    this.client = client
    this.members = []
    this.active = false
    this._timers = new Set()
    this._replyIndex = 0
    this._introduced = false
  }

  async ready () {
    this.members = await Promise.all(MEMBERS.map(async (spec) => {
      // Seed is fixed per member, so the same simulated people keep the same
      // keys across reloads and both tabs agree on who is who.
      const seed = b4a.alloc(32, spec.seedByte)
      const publicKey = await backend.publicKeyFromSeed(seed)
      return { ...spec, seed, publicKey, publicKeyHex: b4a.toString(publicKey, 'hex') }
    }))
    return this
  }

  /** Called when this tab wins (or loses) the host election. */
  setActive (active) {
    this.active = active
    if (!active) this._clearTimers()
    else this._introduce()
  }

  /** React to something the human said. */
  onHumanMessage (message) {
    if (!this.active) return
    if (message.type !== 'text') return
    if (this.members.some((m) => m.publicKeyHex === message.author)) return

    const responder = this.members[this._replyIndex % this.members.length]
    this._replyIndex++

    // Show a typing indicator first, then the reply — the presence path gets
    // exercised too, not just text.
    this._later(() => this._presence(responder, 'typing'), 250)
    this._later(() => {
      const line = responder.replies[Math.floor(Math.random() * responder.replies.length)]
      this._say(responder, line)
      this._presence(responder, 'online')
    }, 900 + Math.random() * 900)

    // Sometimes a second person chimes in.
    if (Math.random() < 0.35) {
      const other = this.members[(this._replyIndex + 1) % this.members.length]
      if (other !== responder) {
        this._later(() => this._say(other, other.replies[Math.floor(Math.random() * other.replies.length)]), 2200)
      }
    }
  }

  /** Introduce the members once, so a fresh room is not an empty screen. */
  _introduce () {
    if (this._introduced) return
    this._introduced = true

    let delay = 400
    for (const member of this.members) {
      this._later(() => this._nick(member), delay)
      delay += 150
    }

    for (const member of this.members) {
      if (!member.opening) continue
      this._later(() => this._say(member, member.opening), delay)
      delay += 1100
    }
  }

  async _say (member, body) {
    await this._publish(member, text(member.publicKeyHex, this._clock(), body))
  }

  async _nick (member) {
    await this._publish(member, nick(member.publicKeyHex, this._clock(), member.name))
  }

  async _presence (member, status) {
    await this._publish(member, presence(member.publicKeyHex, this._clock(), status))
  }

  async _publish (member, message) {
    const client = this.client
    if (!client.room) return

    const frame = await seal({
      backend,
      encryptionKey: client.room.encryptionKey,
      seed: member.seed,
      publicKey: member.publicKey,
      payload: encodeMessage(message)
    })

    // Straight onto the wire. The client receives, verifies and decrypts it the
    // same way it would a message from another tab.
    client.transport.send(frame)
    client.transport.dispatchEvent(new CustomEvent('message', {
      detail: { kind: 'frame', from: 'sim', frame: new Uint8Array(frame) }
    }))
  }

  _clock () {
    return nextClock(this.client.messages)
  }

  _later (fn, ms) {
    const id = setTimeout(() => {
      this._timers.delete(id)
      Promise.resolve(fn()).catch(() => {})
    }, ms)
    this._timers.add(id)
  }

  _clearTimers () {
    for (const id of this._timers) clearTimeout(id)
    this._timers.clear()
  }

  destroy () {
    this._clearTimers()
  }
}
