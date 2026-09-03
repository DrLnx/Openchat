// The matcher behind every picker. Ranking is the whole feature — a finder
// that returns the right rows in the wrong order is a finder you stop trusting
// after the third time it puts what you wanted second.

import test from 'node:test'
import assert from 'node:assert/strict'

import { score, rank, segments } from '../../src/ui/model/fuzzy.js'

test('a query has to be a subsequence of the target', () => {
  assert.ok(score('dsg', 'design'), 'letters in order match')
  assert.equal(score('gsd', 'design'), null, 'letters out of order do not')
  assert.equal(score('designs', 'design'), null, 'a longer query cannot match')
  assert.deepEqual(score('', 'design'), { score: 0, positions: [] }, 'an empty query matches anything')
})

test('the positions returned are the characters that matched', () => {
  const match = score('dsg', 'design')
  assert.deepEqual(match.positions, [0, 2, 4])
  assert.deepEqual(
    segments('design', match.positions).map((part) => `${part.match ? '[' : ''}${part.text}${part.match ? ']' : ''}`).join(''),
    '[d]e[s]i[g]n'
  )
})

test('a match that starts on a word boundary beats one buried in the middle', () => {
  // The case that made the scoring worth writing: both contain d, s and g in
  // order, and only one of them is what anybody typing "dsg" meant.
  assert.ok(score('dsg', 'design').score > score('dsg', 'wds-logging').score)
})

test('consecutive characters beat scattered ones', () => {
  assert.ok(score('gen', 'general').score > score('gen', 'engineering').score)
})

test('an exact prefix wins over a later match of the same shape', () => {
  const ranked = rank(['ops', 'backups', 'op-notes'], 'op')
  assert.equal(ranked[0].item, 'ops')
})

test('matching is case insensitive until the query has a capital in it', () => {
  assert.ok(score('abc', 'ABC'), 'a lowercase query ignores case')
  assert.equal(score('ABC', 'abc'), null, 'a query with a capital does not')
})

test('an empty query returns everything in its original order', () => {
  const ranked = rank(['c', 'a', 'b'], '')
  assert.deepEqual(ranked.map((r) => r.item), ['c', 'a', 'b'])
})

test('a field can ask to be matched as a prefix rather than fuzzily', () => {
  // A public key is 64 hex characters, so *every* short query is a subsequence
  // of one. Without this, one picker row would match every search.
  const key = 'de00112233445566778899aabbccddeeff00112233445566778899aabbccddee'
  const items = [{ name: 'design', key: 'a1de9f00'.padEnd(64, '0') }, { name: 'ops', key }]
  const fields = (item) => [item.name, { text: item.key, match: 'prefix' }]

  assert.deepEqual(
    rank(items, 'sign', { key: fields }).map((r) => r.item.name),
    ['design'],
    'a two-letter query does not drag in every key'
  )
  assert.deepEqual(
    rank(items, 'de0011', { key: fields }).map((r) => r.item.name),
    ['ops'],
    'pasting the front of a key still finds it'
  )
})

test('a substring field matches only a real run of characters', () => {
  const items = [{ label: 'x', hint: 'here · yours' }, { label: 'y', hint: 'closed' }]
  const fields = (item) => [item.label, { text: item.hint, match: 'substring' }]

  assert.deepEqual(rank(items, 'yours', { key: fields }).map((r) => r.item.label), ['x'])
  assert.deepEqual(rank(items, 'yrs', { key: fields }).map((r) => r.item.label), [])
})

test('an absurdly long target still matches without quadratic cost', () => {
  const long = 'z'.repeat(5000) + 'openchat'
  const match = score('opench', long)
  assert.ok(match, 'the fallback still finds it')
  assert.equal(match.positions.length, 6)
})

test('limit caps the result without changing the order', () => {
  const ranked = rank(['aaa', 'aab', 'aac'], 'aa', { limit: 2 })
  assert.equal(ranked.length, 2)
})
