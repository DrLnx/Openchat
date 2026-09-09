// The full-screen layer: measuring text, cutting it to a pane, and turning a
// transcript into a fixed number of rows.
//
// The invariant worth testing here is boring and absolute: a pane that says it
// is N rows tall renders exactly N rows. Everything on this screen is stacked —
// title bar, body, prompt, statusline — so a pane that renders one row too many
// does not overflow its own box, it pushes the prompt off the bottom of the
// terminal and takes the title bar with it on the next repaint.

import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { Box } from 'ink'
import { render } from 'ink-testing-library'

import { width, truncate, pad, fit, wrap } from '../../src/ui/model/text.js'
import { chatRows, chatWindow, maxScroll, scrollToRow, bodyColumns } from '../../src/ui/ink/Chat.jsx'
import { sidebarRows } from '../../src/ui/ink/Sidebar.jsx'
import { welcomeRows } from '../../src/ui/ink/Banner.jsx'
import { createTheme } from '../../src/ui/ink/theme.js'

const theme = createTheme({})
const self = { publicKey: 'a'.repeat(64), nick: 'ada' }
const members = { [self.publicKey]: { nick: 'ada' }, ['b'.repeat(64)]: { nick: 'grace' } }

function message (over = {}) {
  return {
    kind: 'message',
    key: over.id || 'm1',
    ts: 1700000000000,
    message: { id: 'm1', type: 'text', author: 'b'.repeat(64), body: 'hello', ts: 1700000000000, ...over }
  }
}

function rowsFor (entries, over = {}) {
  return chatRows({
    entries,
    width: 60,
    theme,
    settings: { timestamps: '24h', compact: true },
    members,
    attachments: {},
    self,
    ...over
  }).rows
}

function anchorsFor (entries) {
  return chatRows({
    entries,
    width: 60,
    theme,
    settings: { timestamps: '24h', compact: true },
    members,
    attachments: {},
    self
  }).anchors
}

// --- measuring --------------------------------------------------------------

test('width counts terminal cells, not characters', () => {
  assert.equal(width('hello'), 5)
  assert.equal(width(''), 0)
  assert.equal(width(null), 0)
  assert.equal(width('日本語'), 6, 'CJK takes two cells each')
  assert.equal(width('\u{1f600}'), 2, 'so does an emoji')
  assert.equal(width('é'), 1, 'a combining accent takes none')
})

test('truncate and pad land on the exact column asked for', () => {
  assert.equal(width(truncate('abcdefghij', 5)), 5)
  assert.equal(truncate('abc', 10), 'abc', 'something that fits is left alone')
  assert.equal(width(fit('abc', 10)), 10)
  assert.equal(width(fit('abcdefghij', 4)), 4)
  assert.equal(width(pad('日本', 6)), 6)
  assert.equal(truncate('anything', 0), '')
})

test('wrap breaks on spaces, and mid-word when it has to', () => {
  assert.deepEqual(wrap('the quick brown fox', 10), ['the quick', 'brown fox'])
  assert.deepEqual(wrap('', 10), [''], 'a blank line is still a line')

  // A pasted URL has no spaces to break on and still has to fit.
  const long = wrap('x'.repeat(50), 8)
  assert.equal(long.length, 7)
  for (const line of long) assert.ok(width(line) <= 8)
})

test('wrap honours a hanging indent', () => {
  const lines = wrap('one two three four five six', 12, 6)
  assert.ok(width(lines[0]) <= 12)
  for (const line of lines.slice(1)) assert.ok(width(line) <= 6)
})

test('every wrapped line fits, whatever the input', () => {
  const samples = ['', 'short', 'a '.repeat(40), '日本語'.repeat(20), 'word ' + 'y'.repeat(30)]
  for (const sample of samples) {
    for (const line of wrap(sample, 17)) {
      assert.ok(width(line) <= 17, `"${line}" fits in 17 columns`)
    }
  }
})

// --- the transcript as rows -------------------------------------------------

test('a message that wraps takes as many rows as it wraps to', () => {
  const one = rowsFor([message({ body: 'hi' })])
  assert.equal(one.length, 1)

  const many = rowsFor([message({ body: 'word '.repeat(40) })])
  assert.ok(many.length > 1, 'a long message is more than one row')

  // Nothing is dropped and nothing is doubled: the body wraps into the space
  // left by the clock and the name column, and every line of it gets a row.
  const columns = bodyColumns(60, { timestamps: '24h' })
  assert.equal(many.length, wrap('word '.repeat(40).trimEnd(), columns).length)
})

test('a run of messages from one person is one block', () => {
  const run = [
    message({ id: 'a', body: 'one' }),
    message({ id: 'b', body: 'two' }),
    message({ id: 'c', body: 'three' })
  ]
  assert.equal(rowsFor(run).length, 3, 'three lines, one header')
})

test('the window is exactly as tall as the pane, however much is in it', () => {
  for (const count of [0, 1, 5, 200]) {
    const entries = Array.from({ length: count }, (_, i) => message({ id: `m${i}`, body: `line ${i}` }))
    const rows = rowsFor(entries)

    for (const height of [1, 6, 18, 40]) {
      for (const scroll of [0, 3, 1000]) {
        assert.equal(
          chatWindow(rows, height, scroll).length,
          height,
          `${count} entries in a ${height}-row pane, scrolled ${scroll}`
        )
      }
    }
  }
})

test('scrolling stops at the top of the transcript', () => {
  assert.equal(maxScroll(10, 18), 0, 'a transcript that fits does not scroll')
  assert.equal(maxScroll(30, 18), 12)
})

test('a search result can be scrolled to, because every message knows its row', () => {
  const entries = Array.from({ length: 40 }, (_, i) => message({ id: `m${i}`, body: `line ${i}` }))
  const anchors = anchorsFor(entries)
  const rows = rowsFor(entries)

  assert.equal(anchors.size, 40, 'every message is anchored')
  assert.equal(anchors.get('m0'), 0)

  // Scrolling to a row puts it on screen, wherever in the transcript it is.
  for (const id of ['m0', 'm19', 'm39']) {
    const row = anchors.get(id)
    const scroll = scrollToRow(row, rows.length, 10)
    const start = rows.length - 10 - scroll
    assert.ok(row >= start && row < start + 10, `${id} is inside the pane after scrolling`)
    assert.ok(scroll >= 0 && scroll <= maxScroll(rows.length, 10), 'and the scroll is in range')
  }
})

test('the newest line is the last row of the pane', () => {
  const rows = rowsFor([message({ id: 'a', body: 'old' }), message({ id: 'b', body: 'newest' })])
  const window = chatWindow(rows, 10, 0)
  assert.equal(window[window.length - 1], rows[rows.length - 1])
})

// --- the conversation list --------------------------------------------------

test('every sidebar row says what clicking it opens, including the ones that open nothing', () => {
  const { rows, targets } = sidebarRows({
    conversations: [
      { id: 'r1', name: 'design', kind: 'room', unread: 0, owned: true },
      { id: 'r2', name: 'ops', kind: 'room', unread: 3 },
      { id: 'd1', name: 'grace', kind: 'dm', unread: 0 }
    ],
    activeId: 'r1',
    columns: 20,
    theme
  })

  assert.equal(rows.length, targets.length, 'a target for every row drawn')
  assert.deepEqual(
    targets.filter(Boolean),
    ['r1', 'r2', 'd1'],
    'the headings and the gap are not clickable'
  )
})

test('an empty conversation list says what to press instead of nothing', () => {
  const { rows, targets } = sidebarRows({ conversations: [], activeId: null, columns: 20, theme })
  assert.ok(rows.length > 0)
  assert.deepEqual(targets.filter(Boolean), [])
})

// --- the pane before anything is open ---------------------------------------

test('the welcome pane is rows like everything else', () => {
  const withLogo = welcomeRows({ theme, self, profile: 'work', version: '1.0.0', columns: 60 })
  const without = welcomeRows({ theme, self, profile: 'work', version: '1.0.0', columns: 60, logo: false })

  assert.ok(withLogo.length > without.length, 'the logo is rows you can turn off')
  assert.ok(without.length > 0, 'and what is left still tells you who you are')
})

/** The welcome pane as text, the way a terminal would show it. */
function paint (options) {
  const rows = welcomeRows({ theme, self, profile: 'work', version: '1.0.0', ...options })
  const app = render(
    React.createElement(
      Box,
      { flexDirection: 'column', width: options.columns + 2 },
      rows
    )
  )
  // eslint-disable-next-line no-control-regex
  const text = (app.lastFrame() || '').replace(/\u001B\[[0-9;]*m/g, '')
  return { rows, text, lines: text.split('\n') }
}

test('the welcome pane fills the height it is given, so it sits in the middle', () => {
  // The transcript is anchored to the bottom of its pane, which is right for a
  // conversation and wrong for this: left to it, the welcome sat on the floor
  // of the screen with half a terminal of nothing above it. Handing back
  // exactly as many rows as the pane has is what centres it.
  for (const rows of [20, 26, 34, 44]) {
    assert.equal(paint({ columns: 90, rows }).rows.length, rows, `${rows} rows`)
  }

  // A pane too short for the block is the one case it cannot fill; it hands
  // back what it has and the pane drops from the front, logo first.
  assert.ok(paint({ columns: 90, rows: 8 }).rows.length > 8)
})

test('the logo is as big as the pane can hold, and no bigger', () => {
  const big = paint({ columns: 90, rows: 34 })
  const small = paint({ columns: 50, rows: 34 })
  const none = paint({ columns: 50, rows: 18 })

  assert.match(big.text, /██████╗/, 'a wide, tall pane gets the block letters')
  assert.doesNotMatch(small.text, /██████╗/)
  assert.match(small.text, /█▀▀█/, 'a narrower one gets the half-block name')
  assert.doesNotMatch(none.text, /█/, 'and a short one gets the wordmark')
  assert.match(none.text, /openchat/)

  // Whichever it drew, the pane still says who you are and what to press.
  for (const { text } of [big, small, none]) {
    assert.match(text, /ada/, 'your name')
    assert.match(text, /␣ r n/, 'and the first thing to do with it')
  }
})

test('the welcome pane is centred as a block, not row by row', () => {
  const { lines } = paint({ columns: 90, rows: 34 })

  // The block letters are measured out of it: several of them begin with a
  // column of their own padding — ` ██████╗` — so where their ink starts is a
  // property of the letter O and not of the layout.
  const drawn = lines.filter((line) => line.trim() && !/[█╗╔╝╚═▀▄]/.test(line))

  const indents = drawn.map((line) => line.length - line.trimStart().length)
  assert.ok(indents.length > 8, 'there is something on the screen')

  // One indent for everything: the card, the numbers and the key columns keep
  // the edges they were laid out against. Centring each row on its own would
  // leave nothing lining up with anything.
  const left = Math.min(...indents)
  assert.ok(left > 4, 'and the block is pushed off the left edge')
  assert.equal(
    indents.filter((at) => at === left).length,
    indents.length,
    'every row starts in the same column'
  )
})
