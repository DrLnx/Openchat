import test from 'node:test'
import assert from 'node:assert/strict'
import b4a from 'b4a'

import {
  encodeMessage, decodeMessage, text, file, presence, system, nick,
  UnknownMessageTypeError
} from '../../src/protocol/messages.js'
import { encodeInvite, decodeInvite, topicFor, InviteError, INVITE_PREFIX } from '../../src/protocol/invite.js'
import { linearize, compareMessages, nextClock, merge } from '../../src/protocol/order.js'

const AUTHOR = 'aa'.repeat(32)
const OTHER = 'bb'.repeat(32)

test('every message type survives a codec round trip', () => {
  const cases = [
    text(AUTHOR, 1, 'hello world'),
    text(AUTHOR, 2, 'unicode: 日本語 🔐 — em dash'),
    file(AUTHOR, 3, {
      name: 'holiday.png',
      size: 1234567,
      mime: 'image/png',
      sha256: 'cc'.repeat(32),
      blobCoreKey: 'dd'.repeat(32),
      blobId: { blockOffset: 4, blockLength: 9, byteOffset: 1024, byteLength: 1234567 }
    }),
    presence(AUTHOR, 4, 'typing'),
    system(AUTHOR, 5, 'join', OTHER),
    nick(AUTHOR, 6, 'ada')
  ]

  for (const original of cases) {
    assert.deepEqual(decodeMessage(encodeMessage(original)), original, original.type)
  }
})

test('an empty text body round trips', () => {
  const m = text(AUTHOR, 1, '')
  assert.deepEqual(decodeMessage(encodeMessage(m)), m)
})

test('encoding rejects an unknown message type instead of writing a bad frame', () => {
  assert.throws(
    () => encodeMessage({ v: 1, type: 'wat', id: 'x', ts: 0, clock: 0, author: AUTHOR }),
    UnknownMessageTypeError
  )
})

test('encoding rejects a malformed author key', () => {
  assert.throws(() => encodeMessage(text('abcd', 1, 'hi')), /32-byte hex/)
})

test('invites round trip and derive a stable topic', () => {
  const roomKey = b4a.from('12'.repeat(32), 'hex')
  const encryptionKey = b4a.from('34'.repeat(32), 'hex')

  const invite = encodeInvite({ roomKey, encryptionKey, name: 'design-team' })
  assert.ok(invite.startsWith(INVITE_PREFIX))
  assert.ok(!invite.includes('+') && !invite.includes('/'), 'must be base64url safe')

  const decoded = decodeInvite(invite)
  assert.equal(decoded.name, 'design-team')
  assert.equal(b4a.toString(decoded.roomKey, 'hex'), b4a.toString(roomKey, 'hex'))
  assert.equal(b4a.toString(decoded.encryptionKey, 'hex'), b4a.toString(encryptionKey, 'hex'))
  assert.equal(b4a.toString(decoded.topic, 'hex'), b4a.toString(topicFor(roomKey), 'hex'))
})

test('the discovery topic is not the room key or the encryption key', () => {
  // The whole security split depends on the topic leaking neither secret.
  const roomKey = b4a.from('12'.repeat(32), 'hex')
  const topic = topicFor(roomKey)
  assert.notEqual(b4a.toString(topic, 'hex'), b4a.toString(roomKey, 'hex'))
})

test('an invite string does not survive tampering', () => {
  const invite = encodeInvite({
    roomKey: b4a.from('12'.repeat(32), 'hex'),
    encryptionKey: b4a.from('34'.repeat(32), 'hex'),
    name: 'x'
  })

  assert.throws(() => decodeInvite('nope'), (e) => e instanceof InviteError && e.code === 'BAD_PREFIX')
  assert.throws(
    () => decodeInvite(invite.slice(0, invite.length - 12)),
    (e) => e instanceof InviteError && e.code === 'MALFORMED'
  )
  assert.throws(() => decodeInvite(42), (e) => e instanceof InviteError && e.code === 'BAD_INPUT')
})

test('surrounding whitespace in a pasted invite is tolerated', () => {
  const invite = encodeInvite({
    roomKey: b4a.from('12'.repeat(32), 'hex'),
    encryptionKey: b4a.from('34'.repeat(32), 'hex'),
    name: 'paste'
  })
  assert.equal(decodeInvite(`  ${invite}\n`).name, 'paste')
})

test('ordering is total and independent of arrival order', () => {
  const messages = [
    { id: 'd', clock: 2, ts: 100, author: OTHER },
    { id: 'a', clock: 1, ts: 100, author: AUTHOR },
    { id: 'c', clock: 2, ts: 100, author: AUTHOR }, // concurrent with d, author tiebreak
    { id: 'b', clock: 1, ts: 200, author: AUTHOR }
  ]

  const expected = linearize(messages).map((m) => m.id)
  assert.deepEqual(expected, ['a', 'b', 'c', 'd'])

  // Every permutation must produce that same list — this is what stops two
  // members seeing different transcripts of the same room.
  for (const perm of permutations(messages)) {
    assert.deepEqual(linearize(perm).map((m) => m.id), expected)
  }
})

test('linearize deduplicates by id and does not mutate its input', () => {
  const a = { id: 'a', clock: 1, ts: 1, author: AUTHOR }
  const input = [a, { ...a }, { id: 'b', clock: 2, ts: 1, author: AUTHOR }]
  const before = [...input]

  assert.equal(linearize(input).length, 2)
  assert.deepEqual(input, before)
})

test('compareMessages is antisymmetric and reflexive', () => {
  const a = { id: 'a', clock: 1, ts: 1, author: AUTHOR }
  const b = { id: 'b', clock: 1, ts: 1, author: AUTHOR }
  assert.equal(compareMessages(a, a), 0)
  assert.ok(compareMessages(a, b) < 0)
  assert.ok(compareMessages(b, a) > 0)
})

test('nextClock advances past everything observed', () => {
  assert.equal(nextClock([]), 1)
  assert.equal(nextClock([{ clock: 4 }, { clock: 9 }, { clock: 2 }]), 10)
})

test('merge folds new messages into an ordered list', () => {
  const existing = linearize([{ id: 'a', clock: 1, ts: 1, author: AUTHOR }])
  const merged = merge(existing, { id: 'b', clock: 0, ts: 1, author: AUTHOR })
  assert.deepEqual(merged.map((m) => m.id), ['b', 'a'])
  assert.equal(existing.length, 1, 'input untouched')
})

function * permutations (items) {
  if (items.length <= 1) { yield items; return }
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)]
    for (const p of permutations(rest)) yield [items[i], ...p]
  }
}
