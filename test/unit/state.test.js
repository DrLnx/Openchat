// The chat view-model. Everything on screen is derived from this one reducer,
// so unread counts, member tracking and transcript ordering can be tested here
// without rendering anything.

import test from 'node:test'
import assert from 'node:assert/strict'

import { initialState, reduce, transcript, memberList, totalUnread } from '../../src/ui/model/state.js'

const self = { publicKey: 'a'.repeat(64), nick: 'ada' }
const BOB = 'b'.repeat(64)

const text = (over) => ({ type: 'text', clock: 1, ts: 1000, author: BOB, ...over })

test('names are picked up from a transcript loaded off disk, not just live ones', () => {
  // Opening a room replays what is already stored. Everyone who spoke before
  // this session started has to keep their name, or the log reads as a wall of
  // hex until each of them happens to say something again.
  const state = reduce(initialState(self), {
    type: 'room',
    room: { key: 'r1', name: 'design', kind: 'room' },
    messages: [
      { id: 'm1', type: 'nick', clock: 1, ts: 1000, author: BOB, nick: 'grace' },
      { id: 'm2', ...text({ id: 'm2', clock: 2, ts: 2000, body: 'hello' }) }
    ]
  })

  assert.equal(state.members[BOB].nick, 'grace')
  assert.deepEqual(memberList(state).map((m) => m.nick).sort(), ['ada', 'grace'])
})

test('switching conversation does not blend two transcripts', () => {
  let state = reduce(initialState(self), {
    type: 'room',
    room: { key: 'r1', name: 'one', kind: 'room' },
    messages: [{ id: 'm1', ...text({ id: 'm1', body: 'in one' }) }]
  })

  state = reduce(state, {
    type: 'room',
    room: { key: 'r2', name: 'two', kind: 'room' },
    messages: [{ id: 'm2', ...text({ id: 'm2', body: 'in two' }) }]
  })

  assert.deepEqual(state.messages.map((m) => m.body), ['in two'])
})

test('unread counts survive the conversation list being re-read', () => {
  let state = reduce(initialState(self), {
    type: 'room',
    room: { key: 'r1', name: 'one', kind: 'room' },
    messages: []
  })

  state = reduce(state, { type: 'rooms', rooms: [{ key: 'r1', name: 'one' }, { key: 'r2', name: 'two' }] })
  state = reduce(state, {
    type: 'messages',
    roomKey: 'r2',
    messages: [{ id: 'm1', ...text({ id: 'm1', body: 'over here' }) }]
  })

  assert.equal(totalUnread(state), 1)

  // Anything that changes which room is active re-reads the list from the
  // client, which has no idea what you have read.
  state = reduce(state, { type: 'rooms', rooms: [{ key: 'r1', name: 'one' }, { key: 'r2', name: 'two' }] })
  assert.equal(totalUnread(state), 1, 'a refresh must not mark everything read')

  state = reduce(state, { type: 'room', room: { key: 'r2', name: 'two', kind: 'room' }, messages: [] })
  assert.equal(totalUnread(state), 0, 'opening it does')
})

test('the transcript is messages and nothing else', () => {
  // Anything openchat has to say for itself — a command's answer, an error, an
  // acknowledgement — is said above the prompt and then taken back down. A log
  // that mixes what people said with what the program said is a log you stop
  // trusting to be the conversation.
  let state = initialState(self)
  state = reduce(state, {
    type: 'messages',
    messages: [text({ id: 'a', ts: 1000, body: 'first' }), text({ id: 'b', ts: 2000, body: 'second' })]
  })

  assert.deepEqual(transcript(state).map((e) => e.kind), ['message', 'message'])
  assert.deepEqual(transcript(state).map((e) => e.message.body), ['first', 'second'])
  assert.equal('notices' in state, false, 'there is nowhere for one to be kept')

  // Presence is how the sidebar knows who is about; it is not something anybody
  // said, so it is not in the log either.
  state = reduce(state, {
    type: 'messages',
    messages: [{ id: 'p', type: 'presence', author: BOB, status: 'online', ts: 3000, clock: 3 }]
  })
  assert.equal(transcript(state).length, 2)
})
