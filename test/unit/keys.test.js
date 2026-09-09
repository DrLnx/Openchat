// The keyboard: how a keypress becomes a chord, how chords become an action,
// and what the message buffer does with everything the keymap did not claim.
//
// These are the parts that decide whether a modal interface feels like an
// editor or like a bug, so they are tested away from any terminal.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BINDINGS, bindingsFor, chordFor, createResolver, describeChord, keysOf, groupFor
} from '../../src/ui/model/keymap.js'
import { createBuffer, applyKey, setValue } from '../../src/ui/model/editor.js'
import { typed } from '../../src/ui/model/text.js'
import {
  screenLayout, floatLayout, popupLayout, cornerLayout, gridFor, hitTest, hitSidebar, scrollTo
} from '../../src/ui/model/layout.js'
import { whichKeyLayout, keyEntries } from '../../src/ui/ink/WhichKey.jsx'
import { read, write, cycle, get, display, SETTINGS } from '../../src/ui/model/settings.js'

const key = (over = {}) => ({
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  pageUp: false,
  pageDown: false,
  home: false,
  end: false,
  return: false,
  escape: false,
  ctrl: false,
  shift: false,
  tab: false,
  backspace: false,
  delete: false,
  meta: false,
  ...over
})

// --- chords -----------------------------------------------------------------

test('a keypress gets one canonical name', () => {
  assert.equal(chordFor(' ', key()), '<space>')
  assert.equal(chordFor('p', key({ ctrl: true })), '<C-p>')
  assert.equal(chordFor('', key({ tab: true, shift: true })), '<S-tab>')
  assert.equal(chordFor('', key({ escape: true })), '<esc>')
  assert.equal(chordFor('L', key()), 'L')
  assert.equal(chordFor('hello world', key()), null, 'a paste is not a chord')
})

test('a raw control byte is named the same as the ctrl flag', () => {
  // Some terminals hand Ink the byte rather than the flag; both are Ctrl-P.
  assert.equal(chordFor(String.fromCharCode(16), key({ ctrl: true })), '<C-p>')
})

test('<leader> expands to the leader key', () => {
  assert.deepEqual(keysOf('<leader>ff'), ['<space>', 'f', 'f'])
  assert.deepEqual(keysOf(']b'), [']', 'b'])
  assert.equal(describeChord('<leader>ff'), '␣ f f')
  assert.equal(describeChord('<C-p>'), 'C-p')
})

test('a chord fires only when it is complete', () => {
  const resolver = createResolver(bindingsFor('normal'))

  assert.equal(resolver.feed('<space>').type, 'pending')
  assert.equal(resolver.feed('f').type, 'pending')

  const result = resolver.feed('f')
  assert.equal(result.type, 'action')
  assert.equal(result.binding.action, 'picker:conversations')
  assert.deepEqual(resolver.pending, [], 'the chord is cleared once it fires')
})

test('a key that starts nothing is left for whoever wants it', () => {
  const resolver = createResolver(bindingsFor('insert'))
  assert.equal(resolver.feed('a').type, 'ignored', 'so it can be typed into a message')
  assert.equal(resolver.feed('<space>').type, 'ignored', 'space is not the leader while typing')
})

test('a key that breaks a half-typed chord is swallowed rather than typed', () => {
  const resolver = createResolver(bindingsFor('normal'))
  resolver.feed('<space>')
  assert.equal(resolver.feed('z').type, 'miss')
  assert.deepEqual(resolver.pending, [])
})

test('which-key can list what a half-typed chord could still become', () => {
  const resolver = createResolver(bindingsFor('normal'))
  resolver.feed('<space>')
  const next = resolver.candidates().map((c) => c.next)

  assert.ok(next.includes('f'), 'the find group is reachable')
  assert.ok(next.includes('s'), 'so is settings')
  assert.equal(groupFor(['<space>', 'f']).desc, 'find', 'and a prefix has a name')
})

test('every binding is reachable and none shadows another', () => {
  const seen = new Map()
  for (const binding of BINDINGS) {
    const id = `${binding.mode}:${binding.keys}`
    assert.ok(!seen.has(id), `${binding.keys} is bound twice in ${binding.mode} mode`)
    seen.set(id, binding)
  }

  // Insert mode is where you type prose. Nothing there may be a bare
  // character, or it would be impossible to write.
  for (const binding of bindingsFor('insert')) {
    assert.ok(binding.keys.startsWith('<'), `${binding.keys} would swallow a keystroke while typing`)
  }
})

// --- the message buffer -----------------------------------------------------

function type (buffer, text) {
  for (const ch of text) buffer = applyKey(buffer, ch, key()).buffer
  return buffer
}

test('typing, moving and deleting behave the way readline does', () => {
  let buffer = type(createBuffer(), 'hello world')
  assert.equal(buffer.value, 'hello world')
  assert.equal(buffer.cursor, 11)

  buffer = applyKey(buffer, 'w', key({ ctrl: true })).buffer
  assert.equal(buffer.value, 'hello ', 'ctrl-w deletes a word back')

  buffer = applyKey(buffer, 'a', key({ ctrl: true })).buffer
  assert.equal(buffer.cursor, 0, 'ctrl-a goes to the start')

  buffer = type(buffer, 'oh ')
  assert.equal(buffer.value, 'oh hello ', 'typing happens at the cursor')

  buffer = applyKey(buffer, 'u', key({ ctrl: true })).buffer
  assert.equal(buffer.value, 'hello ', 'ctrl-u clears to the start')
})

test('enter hands the line over and remembers it', () => {
  const result = applyKey(type(createBuffer(), 'ship it'), '', key({ return: true }))
  assert.equal(result.submit, 'ship it')
  assert.equal(result.buffer.value, '', 'the prompt is cleared')
  assert.deepEqual(result.buffer.history, ['ship it'])

  const recalled = applyKey(result.buffer, '', key({ upArrow: true })).buffer
  assert.equal(recalled.value, 'ship it', 'up brings it back')

  const forward = applyKey(recalled, '', key({ downArrow: true })).buffer
  assert.equal(forward.value, '', 'down returns to what you were writing')
})

test('the buffer refuses the keys the app has claimed', () => {
  const buffer = type(createBuffer(), 'hi')
  assert.equal(applyKey(buffer, 'p', key({ ctrl: true })), null, 'ctrl-p is the app')
  assert.equal(applyKey(buffer, '', key({ escape: true })), null, 'so is escape')
  assert.equal(applyKey(buffer, '', key({ tab: true })), null, 'so is tab')
})

test('a control byte is never typed into a message', () => {
  const buffer = type(createBuffer(), 'hi')
  assert.equal(applyKey(buffer, String.fromCharCode(14), key()), null)
})

test('a pasted newline becomes a space rather than a dozen half-messages', () => {
  const buffer = applyKey(createBuffer(), 'one\ntwo', key()).buffer
  assert.equal(buffer.value, 'one two')
})

test('a chunk that ends in a newline is a line, not text with a newline in it', () => {
  // What a terminal actually hands over is whatever was in its buffer when it
  // was read: one character when you type slowly, a whole pasted invite when
  // you paste, and `ada\r` when you type a short answer and press enter
  // quickly. Ink only sets key.return for a chunk that is *exactly* a carriage
  // return, so everything else used to be inserted verbatim — the control
  // character included — and the enter was silently swallowed. Pasting is the
  // normal way to use half the fields in this app.
  assert.deepEqual(typed('a'), { text: 'a', submit: false })
  assert.deepEqual(typed('ada\r'), { text: 'ada', submit: true })
  assert.deepEqual(typed('hello\n'), { text: 'hello', submit: true })
  assert.deepEqual(typed('openchat1:AAAA\r\n'), { text: 'openchat1:AAAA', submit: true })

  // A break inside a paste is a space: a pasted paragraph is one message, not
  // a dozen half-messages.
  assert.deepEqual(typed('one\ntwo'), { text: 'one two', submit: false })
  assert.deepEqual(typed('one\ntwo\n'), { text: 'one two', submit: true })

  // Nothing printable ever carries a control byte into a line.
  for (const chunk of ['a\u0000b', 'a\u001bb', 'a\u007fb', 'x\r']) {
    // eslint-disable-next-line no-control-regex
    assert.ok(!/[\u0000-\u001f\u007f]/.test(typed(chunk).text), `${JSON.stringify(chunk)} is clean`)
  }
})

test('the message buffer sends a line that arrived with its own newline', () => {
  const sent = applyKey(createBuffer(), 'hello world\r', key())
  assert.equal(sent.submit, 'hello world', 'the chunk was a whole line')
  assert.equal(sent.buffer.value, '', 'and the box was emptied for the next one')
  assert.deepEqual(sent.buffer.history, ['hello world'], 'and it went into the history')

  // A paste with no newline is text, and lands at the cursor like any other.
  const pasted = applyKey(createBuffer('say '), 'one\ntwo', key())
  assert.equal(pasted.submit, undefined)
  assert.equal(pasted.buffer.value, 'say one two')
})

test('setValue replaces the line, which is what completion does', () => {
  assert.deepEqual(setValue(createBuffer('abc'), '/invite ').value, '/invite ')
})

// --- screen geometry --------------------------------------------------------

test('the screen adds up to the height of the terminal', () => {
  const layout = screenLayout({ rows: 40, columns: 120 })

  assert.equal(layout.height, 39, 'one row is left for the newline Ink writes')
  assert.equal(
    1 + layout.bodyRows + 3 + 1,
    layout.height,
    'title bar, body, prompt and statusline fill it exactly'
  )
  assert.equal(layout.bodyTop, 2, 'the body starts under the title bar')
  assert.equal(layout.statusTop, layout.height, 'the statusline is the last row')
})

test('the screen is the same shape whatever is open', () => {
  // Every window is laid over the frame rather than wedged into it, so nothing
  // you press may change where the conversation, the prompt or the statusline
  // are. This is the property that makes reaching for a key feel like nothing
  // rather than like the page moving under you.
  const a = screenLayout({ rows: 40, columns: 120 })
  const b = screenLayout({ rows: 40, columns: 120 })

  assert.deepEqual(a, b)
  assert.equal(a.bodyRows + a.bodyTop, a.inputTop, 'the prompt follows the body, always')
})

test('the conversation list gives way on a narrow terminal', () => {
  assert.equal(screenLayout({ rows: 24, columns: 120 }).sidebar, true)
  assert.equal(screenLayout({ rows: 24, columns: 50 }).sidebar, false)
  assert.equal(screenLayout({ rows: 24, columns: 120 }, { sidebar: false }).sidebar, false)

  const wide = screenLayout({ rows: 24, columns: 200 })
  assert.ok(wide.sidebarWidth <= 26, 'and never takes half the screen on a wide one')
  assert.equal(wide.sidebarWidth + 1 + wide.chatWidth, wide.columns, 'the panes tile the width')
})

// --- float geometry ---------------------------------------------------------

test('a float is centred over the chat pane and clear of the prompt', () => {
  const screen = screenLayout({ rows: 40, columns: 120 })
  const layout = floatLayout(screen, { items: 8 })

  assert.ok(layout.top >= screen.bodyTop, 'it starts inside the body')
  assert.ok(layout.top + layout.height - 1 < screen.inputTop, 'and ends above the prompt')
  assert.equal(layout.above, layout.top - screen.bodyTop)
  assert.equal(
    layout.above + layout.height + layout.below,
    screen.bodyRows,
    'the rows it covers plus the ones it leaves are the whole body'
  )
  assert.ok(Math.abs(layout.above - layout.below) <= 1, 'centred, to the row')

  assert.equal(layout.listTop, layout.top + 3, 'the list starts under the query and the rule')
  // Four rows of chrome: the two borders, the query, and the rule under it.
  // The key hints live in the closing border rather than on a row of their own.
  assert.equal(layout.listRows, layout.height - 4)
  assert.ok(layout.width <= screen.chatWidth, 'it fits the chat pane')
  assert.ok(layout.left >= screen.chatLeft, 'and starts inside it')
  assert.equal(layout.left + layout.width - 1 <= 120, true, 'and stays on screen')

  // Drawn inside the chat pane, so the conversation list beside it is not
  // blanked out for as long as the window is open. The pane keeps a column of
  // padding on its left, which is the one between the two.
  assert.equal(layout.left, screen.chatLeft + 1 + layout.column)
})

test('a float never eats more than the body it is laid over', () => {
  for (const rows of [12, 15, 20, 24, 40, 60]) {
    const screen = screenLayout({ rows, columns: 60 })
    const layout = floatLayout(screen, { items: 40 })

    assert.ok(
      layout.height <= screen.bodyRows,
      `a float on a ${rows}-row terminal fits the body`
    )
    assert.ok(layout.top >= 1)
  }
})

// --- the key menu and the command line --------------------------------------

test('a popup sits at the top of the body, where the transcript is not', () => {
  const screen = screenLayout({ rows: 40, columns: 120 })
  const menu = popupLayout(screen, { rows: 4, width: 56 })

  assert.equal(menu.height, 6, 'its two borders are rows too')
  assert.equal(menu.top, screen.bodyTop, 'against the top of the body')
  assert.equal(menu.above, 0)
  assert.equal(
    menu.above + menu.height + menu.below,
    screen.bodyRows,
    'the rows it covers plus the ones it leaves are the whole body'
  )

  // The transcript is anchored to the bottom of its pane, so the rows a popup
  // takes are the ones nothing was using.
  assert.ok(menu.below > 0, 'and the conversation carries on underneath it')
})

test('a popup is centred over the chat pane, not over the conversation list', () => {
  const screen = screenLayout({ rows: 40, columns: 120 })
  const menu = popupLayout(screen, { rows: 2, width: 56 })

  assert.ok(menu.left >= screen.chatLeft, 'it starts inside the chat pane')
  assert.ok(menu.left + menu.width - 1 <= screen.columns, 'and stays on screen')
  const room = screen.chatWidth - 1
  const after = room - menu.width - menu.column
  assert.ok(Math.abs(menu.column - after) <= 1, 'with the same margin either side, to the column')
  assert.equal(menu.left, screen.chatLeft + 1 + menu.column, 'and a click lands where it is drawn')

  // Asking for more columns or rows than there are is a small terminal, not a
  // bug: it takes what there is and says how many rows it actually got.
  const small = screenLayout({ rows: 12, columns: 40 })
  const wide = popupLayout(small, { rows: 40, width: 200 })
  assert.equal(wide.width, small.chatWidth - 1, 'the pane keeps its column of padding')
  assert.equal(wide.height, small.bodyRows)
  assert.equal(wide.rows, wide.height - 2)
  assert.equal(wide.below, 0)
})

test('the key menu stands in the bottom-right corner, on the prompt', () => {
  const screen = screenLayout({ rows: 40, columns: 120 })
  const menu = cornerLayout(screen, { rows: 6, width: 30 })

  assert.equal(menu.height, 8, 'its two borders are rows too')
  assert.equal(
    menu.top + menu.height - 1,
    screen.bodyTop + screen.bodyRows - 1,
    'its bottom border is the last row of the body, directly above the prompt'
  )
  assert.equal(menu.below, 0)
  assert.equal(menu.above, screen.bodyRows - menu.height)

  const room = screen.chatWidth - 1
  assert.equal(menu.column + menu.width, room, 'flush with the right of the chat pane')
  assert.equal(menu.left, screen.chatLeft + 1 + menu.column, 'and a click lands where it is drawn')
  assert.ok(menu.left + menu.width - 1 <= screen.columns, 'and it stays on screen')

  // It sits over the newest messages, which is why it does not take their rows:
  // Float keeps each covered chat row in the columns to its left.
  assert.equal(menu.beside, true)
  assert.ok(menu.column > 20, 'and leaves most of the conversation showing beside it')
})

test('a corner window takes what a small terminal has and no more', () => {
  const small = screenLayout({ rows: 12, columns: 40 })
  const menu = cornerLayout(small, { rows: 40, width: 200 })

  assert.equal(menu.width, small.chatWidth - 1, 'the pane keeps its column of padding')
  assert.equal(menu.height, small.bodyRows)
  assert.equal(menu.rows, menu.height - 2)
  assert.equal(menu.column, 0)
  assert.equal(menu.above, 0)
  assert.equal(menu.below, 0)
})

test('the key menu grows upwards before it grows sideways', () => {
  // Every column it takes is a column of conversation clipped; every row it
  // takes keeps its conversation beside it. So rows are the cheap direction.
  const screen = screenLayout({ rows: 40, columns: 120 })
  const entries = Array.from({ length: 12 }, (_, i) => ({
    key: String(i), label: 'find conversation', group: false
  }))

  const tall = whichKeyLayout(screen, entries)
  assert.equal(tall.columns, 1, 'a body with room for twelve rows takes one column')
  assert.equal(tall.rows, 12)

  // Until there is no height left to take.
  const short = whichKeyLayout(screenLayout({ rows: 14, columns: 120 }), entries)
  assert.ok(short.columns > 1, 'a short terminal spreads sideways instead')
  assert.ok(short.columns * short.rows >= 12, 'and every key still lands somewhere')
})

test('the key menu is narrower than the pane it stands in', () => {
  const screen = screenLayout({ rows: 40, columns: 120 })

  for (const pending of [['<space>'], ['<space>', 'f'], ['<space>', 'u']]) {
    const candidates = createResolver(bindingsFor('normal')).candidates(pending)
    const layout = whichKeyLayout(screen, keyEntries(candidates, pending))

    assert.ok(candidates.length > 0, `${pending.join('')} has keys under it`)
    assert.ok(
      layout.column > layout.width,
      `${pending.join('')} leaves more conversation showing than it covers`
    )
  }
})

test('the key menu spreads sideways before it grows downwards', () => {
  // Every row it takes is a row of conversation, and columns are free.
  const wide = gridFor(12, { width: 120, columnWidth: 28, preferredRows: 4 })
  assert.equal(wide.rows, 4)
  assert.equal(wide.columns, 3)
  assert.ok(wide.width <= 120)

  // Until there are no columns left to take.
  const narrow = gridFor(12, { width: 40, columnWidth: 28, preferredRows: 4 })
  assert.equal(narrow.columns, 1)
  assert.equal(narrow.rows, 12)

  // And every entry lands somewhere, whatever the shape.
  for (const count of [1, 2, 5, 12, 30]) {
    for (const width of [30, 60, 120, 200]) {
      const grid = gridFor(count, { width, columnWidth: 28, preferredRows: 4 })
      assert.ok(grid.columns * grid.rows >= count, `${count} entries fit at ${width} columns`)
      assert.ok(grid.width <= Math.max(32, width), 'and the window fits the screen')
    }
  }
})

test('a click maps back to the row it landed on', () => {
  const layout = floatLayout(screenLayout({ rows: 40, columns: 120 }), { items: 8 })
  const x = layout.left + 4

  assert.equal(hitTest(layout, { x, y: layout.listTop }, 0, 8), 0)
  assert.equal(hitTest(layout, { x, y: layout.listTop + 3 }, 0, 8), 3)
  assert.equal(hitTest(layout, { x, y: layout.listTop + 3 }, 5, 20), 8, 'scrolling is accounted for')
  assert.equal(hitTest(layout, { x, y: layout.top }, 0, 8), null, 'the border is not a row')
  assert.equal(hitTest(layout, { x, y: layout.listTop + 7 }, 0, 3), null, 'nor is empty space')
  assert.equal(hitTest(layout, { x: 200, y: layout.listTop }, 0, 8), null, 'nor is anything beside it')
})

test('a click in the conversation list maps back to a conversation', () => {
  const screen = screenLayout({ rows: 40, columns: 120 })

  assert.equal(hitSidebar(screen, { x: 3, y: screen.bodyTop }, 5), 0)
  assert.equal(hitSidebar(screen, { x: 3, y: screen.bodyTop + 4 }, 5), 4)
  assert.equal(hitSidebar(screen, { x: 3, y: screen.bodyTop + 9 }, 5), null, 'past the last row')
  assert.equal(hitSidebar(screen, { x: 3, y: 1 }, 5), null, 'the title bar is not the list')
  assert.equal(hitSidebar(screen, { x: 90, y: screen.bodyTop }, 5), null, 'nor is the chat pane')
  assert.equal(
    hitSidebar(screenLayout({ rows: 40, columns: 50 }), { x: 3, y: 2 }, 5),
    null,
    'and a hidden list catches nothing'
  )
})

test('scrolling moves as little as it can', () => {
  assert.equal(scrollTo(0, 12, 8, 40), 5, 'scroll down just enough to show the row')
  assert.equal(scrollTo(10, 3, 8, 40), 3, 'scroll up to the row itself')
  assert.equal(scrollTo(0, 2, 8, 40), 0, 'a visible row does not scroll at all')
  assert.equal(scrollTo(30, 39, 8, 40), 32, 'the last page does not scroll past the end')
})

// --- settings ---------------------------------------------------------------

test('settings fall back to their defaults and reject nonsense', () => {
  assert.equal(read({}).theme, 'tokyonight-storm')
  assert.equal(read({ settings: { theme: 'not-a-theme' } }).theme, 'tokyonight-storm')
  assert.equal(read({ settings: { compact: 'yes' } }).compact, false)
  assert.equal(read({ settings: { theme: 'gruvbox-dark' } }).theme, 'gruvbox-dark')
})

test('the auto-download limit set before settings existed is still honoured', () => {
  assert.equal(read({ autoDownloadBytes: 999 }).autoDownloadBytes, 999)
  assert.equal(read({ autoDownloadBytes: 999, settings: { autoDownloadBytes: 5 } }).autoDownloadBytes, 5)
})

test('writing a setting leaves the rest of the config alone', () => {
  const config = { nick: 'ada', rooms: [1], settings: { compact: true } }
  const next = write(config, 'theme', 'rose-pine')

  assert.equal(next.nick, 'ada')
  assert.deepEqual(next.rooms, [1])
  assert.equal(next.settings.compact, true, 'other settings survive')
  assert.equal(next.settings.theme, 'rose-pine')
  assert.equal(config.settings.theme, undefined, 'the original is not mutated')

  assert.throws(() => write(config, 'nope', 1), /unknown setting/)
  assert.throws(() => write(config, 'theme', 'nope'), /invalid value/)
})

test('cycling a setting walks its values and wraps', () => {
  const theme = get('theme')
  assert.equal(cycle(theme, theme.values.at(-1)), theme.values[0])
  assert.equal(cycle(theme, theme.values[0], -1), theme.values.at(-1))
  assert.equal(cycle(get('compact'), false), true)

  const limit = get('autoDownloadBytes')
  assert.equal(cycle(limit, 0, -1), 0, 'a number stops at its floor')
  assert.equal(display(limit, 0), 'never')
})

test('every setting is renderable', () => {
  for (const setting of SETTINGS) {
    assert.equal(typeof display(setting, setting.default), 'string', setting.key)
    assert.ok(setting.help.length > 10, `${setting.key} needs a real explanation`)
  }
})
