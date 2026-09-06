// The local index: what it must get right to be worth having, and what it must
// never do — which is disagree with the log it was built from.
//
// Everything here runs against an in-memory database, because the index is
// derived state and none of these properties depend on it being a file.

import test from 'node:test'
import assert from 'node:assert/strict'

import { openIndex } from '../../src/core/index-db.js'

const ME = 'a'.repeat(64)
const THEM = 'b'.repeat(64)

function index () {
  return openIndex('.', { file: ':memory:' })
}

function text (id, body, over = {}) {
  return { id, type: 'text', author: THEM, body, ts: 1000, ...over }
}

test('the same message indexed twice is indexed once', () => {
  const ix = index()

  assert.equal(ix.record('room', [text('m1', 'hello')]), 1)
  assert.equal(ix.record('room', [text('m1', 'hello')]), 0, 'replication redelivers constantly')
  assert.equal(ix.count('room'), 1)

  // And it does not quietly accumulate in the search table either, which would
  // show the same line twice in a result list.
  assert.equal(ix.search('hello').length, 1)
  ix.close()
})

test('search finds whole words, prefixes, and the names of files', () => {
  const ix = index()
  ix.record('room', [
    text('m1', 'the sidebar is staying'),
    text('m2', 'nothing to do with furniture'),
    { id: 'm3', type: 'file', author: THEM, name: 'agenda-2026.md', ts: 2000 }
  ])

  assert.deepEqual(ix.search('sidebar').map((r) => r.id), ['m1'])
  assert.deepEqual(ix.search('side').map((r) => r.id), ['m1'], 'half a word is enough')
  assert.deepEqual(ix.search('agenda').map((r) => r.id), ['m3'], 'a file is found by its name')
  assert.deepEqual(ix.search('SIDEBAR').map((r) => r.id), ['m1'], 'case does not matter')

  // Several terms narrow rather than widen.
  assert.deepEqual(ix.search('sidebar staying').map((r) => r.id), ['m1'])
  assert.deepEqual(ix.search('sidebar furniture'), [], 'all terms have to match')
  ix.close()
})

test('a query full of punctuation is a typo, not a crash', () => {
  const ix = index()
  ix.record('room', [text('m1', 'hello')])

  for (const query of ['', '   ', '"', '*', '?!', 'AND', '((', 'NEAR/']) {
    assert.doesNotThrow(() => ix.search(query), `search(${JSON.stringify(query)})`)
  }
  ix.close()
})

test('joins and renames are not searchable, because nobody searches for them', () => {
  const ix = index()
  ix.record('room', [
    { id: 's1', type: 'system', author: THEM, event: 'join', ts: 1000 },
    { id: 'n1', type: 'nick', author: THEM, nick: 'grace', ts: 1000 },
    text('m1', 'grace joined the design review')
  ])

  // The real sentence is findable; the machine-generated ones are not, or every
  // search for a name would return every arrival since the room opened.
  assert.deepEqual(ix.search('joined').map((r) => r.id), ['m1'])
  ix.close()
})

test('search can be pinned to one conversation, or span everything', () => {
  const ix = index()
  ix.record('room-a', [text('m1', 'shared word here')])
  ix.record('room-b', [text('m2', 'shared word there')])

  assert.equal(ix.search('shared').length, 2, 'everything by default')
  assert.deepEqual(
    ix.search('shared', { conversation: 'room-a' }).map((r) => r.id),
    ['m1']
  )
  ix.close()
})

test('results are newest first, which is the order you want them in', () => {
  const ix = index()
  ix.record('room', [
    text('old', 'ship it', { ts: 1000 }),
    text('mid', 'ship it', { ts: 2000 }),
    text('new', 'ship it', { ts: 3000 })
  ])

  assert.deepEqual(ix.search('ship').map((r) => r.id), ['new', 'mid', 'old'])
  ix.close()
})

// --- unread -----------------------------------------------------------------

test('unread counts what arrived after you last read, and never your own words', () => {
  const ix = index()
  ix.record('room', [
    text('m1', 'before', { ts: 1000 }),
    text('m2', 'after', { ts: 3000 }),
    text('mine', 'my own message', { author: ME, ts: 4000 })
  ])

  assert.equal(ix.unread(ME).get('room'), 2, 'both of theirs, neither of mine')

  ix.markRead('room', 2000)
  assert.equal(ix.unread(ME).get('room'), 1)

  ix.markRead('room', 5000)
  assert.equal(ix.unread(ME).get('room'), undefined, 'nothing unread is absent, not zero')
  ix.close()
})

test('reading never goes backwards', () => {
  const ix = index()
  ix.record('room', [text('m1', 'hi', { ts: 5000 })])

  ix.markRead('room', 9000)
  ix.markRead('room', 1000)
  assert.equal(ix.lastRead('room'), 9000, 'a stale mark cannot un-read a conversation')
  ix.close()
})

test('a count survives being closed and reopened, which is the point of it', (t) => {
  const file = `${process.env.TMPDIR || '/tmp'}/openchat-index-${process.pid}-${Date.now()}.db`
  t.after(async () => {
    const { rm } = await import('node:fs/promises')
    for (const suffix of ['', '-wal', '-shm']) {
      await rm(file + suffix, { force: true })
    }
  })

  const first = openIndex('.', { file })
  first.record('room', [text('m1', 'still here later', { ts: 1000 })])
  first.markRead('room', 500)
  first.close()

  const second = openIndex('.', { file })
  assert.equal(second.unread(ME).get('room'), 1, 'the count came back')
  assert.deepEqual(second.search('still').map((r) => r.id), ['m1'], 'so did the text')
  second.close()
})

test('forgetting a conversation forgets all of it', () => {
  const ix = index()
  ix.record('room-a', [text('m1', 'gone soon')])
  ix.record('room-b', [text('m2', 'stays put')])
  ix.markRead('room-a', 1)

  ix.forget('room-a')

  assert.equal(ix.count('room-a'), 0)
  assert.equal(ix.search('gone').length, 0, 'and out of the search table too')
  assert.equal(ix.lastRead('room-a'), 0)
  assert.equal(ix.count('room-b'), 1, 'the other conversation is untouched')
  ix.close()
})

test('a message with nothing to index is still recorded', () => {
  const ix = index()
  ix.record('room', [{ id: 'empty', type: 'text', author: THEM, body: '', ts: 1 }])

  assert.equal(ix.count('room'), 1, 'it exists')
  assert.equal(ix.search('anything').length, 0)
  ix.close()
})
