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
import { floatLayout, hitTest, scrollTo } from '../../src/ui/model/layout.js'
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

test('setValue replaces the line, which is what completion does', () => {
  assert.deepEqual(setValue(createBuffer('abc'), '/invite ').value, '/invite ')
})

// --- float geometry ---------------------------------------------------------

test('a float sits above the prompt with room to spare', () => {
  const layout = floatLayout({ rows: 40, columns: 120 }, { items: 8 })

  assert.equal(layout.top + layout.height - 1, 36, 'it ends just above the prompt box')
  assert.equal(layout.listTop, layout.top + 3, 'the list starts under the query and the rule')
  assert.equal(layout.listRows, layout.height - 5)
  assert.ok(layout.width <= 120 - 4)
})

test('a float never eats the whole screen', () => {
  const layout = floatLayout({ rows: 12, columns: 60 }, { items: 40 })
  assert.ok(layout.height < 12)
  assert.ok(layout.top >= 1)
})

test('a click maps back to the row it landed on', () => {
  const layout = floatLayout({ rows: 40, columns: 120 }, { items: 8 })

  assert.equal(hitTest(layout, { x: 10, y: layout.listTop }, 0, 8), 0)
  assert.equal(hitTest(layout, { x: 10, y: layout.listTop + 3 }, 0, 8), 3)
  assert.equal(hitTest(layout, { x: 10, y: layout.listTop + 3 }, 5, 20), 8, 'scrolling is accounted for')
  assert.equal(hitTest(layout, { x: 10, y: layout.top }, 0, 8), null, 'the border is not a row')
  assert.equal(hitTest(layout, { x: 10, y: layout.listTop + 7 }, 0, 3), null, 'nor is empty space')
  assert.equal(hitTest(layout, { x: 200, y: layout.listTop }, 0, 8), null, 'nor is anything beside it')
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
