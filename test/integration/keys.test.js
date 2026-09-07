// The keyboard-first surface, driven through a real terminal render against a
// real client: modes, the which-key popup, the pickers, and the settings panel.
//
// Rendered rather than unit-tested because the parts that break here are the
// ones only a render shows — a float whose border does not line up, a chord
// that fires but paints nothing, a picker that filters the list but not the
// row the cursor is on.

import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { render } from 'ink-testing-library'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { App } from '../../src/ui/ink/App.jsx'
import { MouseContext } from '../../src/ui/ink/mouse.js'
import { floatLayout } from '../../src/ui/model/layout.js'
import { Client } from '../../src/core/client.js'
import { readConfig } from '../../src/core/store.js'
import { createTestDht, TEST_HOST, waitFor, sleep } from '../helpers.js'
import { EventEmitter } from 'node:events'

const ESC = String.fromCharCode(27)

/** What ink-testing-library reports as the window it renders into. */
const TERMINAL = { rows: 24, columns: 100 }

function screen (app) {
  // eslint-disable-next-line no-control-regex
  return (app.lastFrame() || '').replace(/\[[0-9;]*m/g, '')
}

/**
 * The floating window's own lines. A float is centred over the body, so it is
 * the only rounded box on screen that is indented — the prompt's box starts at
 * column zero.
 */
function floatFrame (app) {
  const lines = screen(app).split('\n')
  const top = lines.findIndex((line) => /^ +╭─/.test(line))
  if (top === -1) return []
  const end = lines.findIndex((line, i) => i > top && /^ +╰/.test(line))
  return lines.slice(top, end + 1)
}

async function press (app, keys, wait = 120) {
  for (const chunk of keys) {
    app.stdin.write(chunk)
    await sleep(wait)
  }
}

async function startClient (t, bootstrap) {
  const dir = await mkdtemp(path.join(tmpdir(), 'openchat-keys-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const client = new Client({ dir, bootstrap, host: TEST_HOST })
  await client.ready()
  return client
}

async function openApp (t, { rooms = ['design'], mouse } = {}) {
  const testnet = await createTestDht()
  const client = await startClient(t, testnet.bootstrap)

  for (const name of rooms) await client.createRoom(name)

  const element = React.createElement(App, { client, profile: 'work' })
  const app = render(mouse
    ? React.createElement(MouseContext.Provider, { value: mouse }, element)
    : element)

  t.after(async () => {
    app.unmount()
    await client.close()
    await testnet.destroy()
  })

  await waitFor(async () => screen(app).includes('INSERT'), { message: 'the app to start' })
  return { app, client }
}

test('escape leaves insert mode and i comes back to it', async (t) => {
  const { app } = await openApp(t)

  assert.match(screen(app), /INSERT/, 'you can type the moment it opens')

  await press(app, [ESC])
  assert.match(screen(app), /NORMAL/, 'escape is normal mode')
  assert.match(screen(app), /press i to write/, 'and says how to get back')

  // In normal mode a letter is a command, not text.
  await press(app, ['x'])
  assert.ok(!screen(app).includes('│ x'), 'a stray key is not typed into the message')

  await press(app, ['i'])
  assert.match(screen(app), /INSERT/)

  await press(app, ['hi'])
  assert.match(screen(app), /hi/, 'and now letters are text again')
})

test('the leader key opens which-key, and a chord runs from it', async (t) => {
  const { app } = await openApp(t)

  await press(app, [ESC, ' '], 400)
  const menu = screen(app)
  assert.match(menu, /→ find/, 'the find group is offered')
  assert.match(menu, /→ Settings/, 'so is settings')

  // Half a chord narrows the menu to what is still reachable.
  await press(app, ['f'], 400)
  assert.match(screen(app), /Find conversation/)
  assert.ok(!screen(app).includes('→ Settings'), 'and drops what is not')

  await press(app, ['f'])
  assert.match(screen(app), /Conversations/, 'the picker opened')
  assert.match(screen(app), /MENU/, 'and the statusline says a float has the keys')
})

test('a float draws as a rectangle, whatever is in it', async (t) => {
  const { app } = await openApp(t)

  for (const [keys, name] of [[[ESC, ' ', 'f', 'f'], 'picker'], [[ESC, ' ', 's'], 'settings'], [[ESC, '?'], 'keymap']]) {
    await press(app, keys)
    const frame = floatFrame(app)

    assert.ok(frame.length > 3, `the ${name} float is on screen`)
    const widths = new Set(frame.map((line) => [...line].length))
    assert.equal(widths.size, 1, `every line of the ${name} float is the same width: ${[...widths]}`)
    assert.ok(frame[0].endsWith('╮'), `the ${name} title bar closes`)
  }
})

test('the picker filters as you type and opens what you pick', async (t) => {
  const { app, client } = await openApp(t, { rooms: ['design', 'operations'] })

  await press(app, [ESC, ' ', 'f', 'f'])
  assert.match(floatFrame(app).join('\n'), /#design/)
  assert.match(floatFrame(app).join('\n'), /#operations/)

  // The statusline names the room you are in, so the assertion has to look
  // inside the float rather than at the whole screen.
  await press(app, ['dsg'])
  const filtered = floatFrame(app).join('\n')
  assert.match(filtered, /#design/, 'a fuzzy match survives')
  assert.ok(!filtered.includes('#operations'), 'and everything else is gone')

  await press(app, ['\r'])
  await waitFor(async () => client.activeTarget?.name === 'design', {
    message: 'the picked room to open'
  })
  assert.ok(!screen(app).includes('Conversations'), 'and the float closed behind it')
})

test('escape closes a float without doing anything', async (t) => {
  const { app, client } = await openApp(t, { rooms: ['design', 'operations'] })
  const before = client.activeId

  await press(app, [ESC, ' ', 'f', 'f'])
  assert.match(screen(app), /Conversations/)

  await press(app, [ESC])
  assert.ok(!screen(app).includes('Conversations'), 'the float is gone')
  assert.equal(client.activeId, before, 'and nothing was opened')
})

test('settings change the interface and are written to the account', async (t) => {
  const { app, client } = await openApp(t)

  await press(app, [ESC, ' ', 's'])
  assert.match(screen(app), /Settings/)
  assert.match(screen(app), /tokyonight-storm/, 'the current theme is shown')

  // Enter cycles the highlighted setting, which starts on the theme.
  await press(app, ['\r'])
  assert.match(screen(app), /tokyonight-night/, 'the panel shows the new value')

  await waitFor(async () => (await readConfig(client.dir)).settings?.theme === 'tokyonight-night', {
    message: 'the setting to reach the config file'
  })

  // Timestamps are the setting you can see take effect in the transcript.
  await press(app, ['j', '\r'])
  assert.match(screen(app), /off/, 'timestamps can be turned off')

  await press(app, [ESC])
  assert.ok(!screen(app).includes('Which-key delay'), 'the panel closed')
})

test('the command palette runs a command that needs no argument', async (t) => {
  const { app } = await openApp(t)

  await press(app, [ESC, ' ', 'f', 'c'])
  assert.match(screen(app), /Commands/)

  await press(app, ['whoami'])
  await press(app, ['\r'])

  // /whoami is one of the commands that opens a window rather than writing
  // into the conversation, and the palette has to run it the same way typing
  // it does.
  await waitFor(async () => screen(app).includes('Your keys'), { message: '/whoami to run' })
  assert.match(screen(app), /anyone who has it can reach you/, 'and says what the key is worth')
})

test('a command that takes an argument is left in the prompt to finish', async (t) => {
  const { app } = await openApp(t)

  await press(app, [ESC, ' ', 'f', 'c'])
  await press(app, ['new'])
  await press(app, ['\r'])

  await waitFor(async () => screen(app).includes('/new '), { message: 'the prompt to be primed' })
  assert.match(screen(app), /INSERT/, 'and you are put back into insert mode to type it')
})

test('a room can be created from a floating prompt rather than a command', async (t) => {
  const { app, client } = await openApp(t)

  await press(app, [ESC, ' ', 'r', 'n'])
  assert.match(screen(app), /New room/)
  assert.match(screen(app), /You will own it/, 'and says what that means')

  await press(app, ['book-club'])
  await press(app, ['\r'])

  await waitFor(async () => client.activeTarget?.name === 'book-club', {
    message: 'the room to be created'
  })
})

test('shift+tab cycles conversations without leaving the message you are writing', async (t) => {
  const { app, client } = await openApp(t, { rooms: ['one', 'two'] })
  const before = client.activeId

  await press(app, ['half a thought'])
  app.stdin.write(`${ESC}[Z`)
  await sleep(200)

  assert.notEqual(client.activeId, before, 'the conversation changed')
  assert.match(screen(app), /half a thought/, 'and the draft is still there')
})

test('the floating windows are reachable by typing, not only by chord', async (t) => {
  const { app, client } = await openApp(t)

  // The keymap is a shortcut, not the only door: someone who has never pressed
  // space should still be able to find settings.
  await press(app, ['/settings'])
  await press(app, ['\r'])
  await waitFor(async () => screen(app).includes('Auto-download limit'), {
    message: 'settings to open'
  })

  await press(app, [ESC])
  await press(app, ['/theme gruvbox-dark'])
  await press(app, ['\r'])

  await waitFor(async () => (await readConfig(client.dir)).settings?.theme === 'gruvbox-dark', {
    message: 'the theme to change'
  })

  await press(app, ['/theme nonsense'])
  await press(app, ['\r'])
  await waitFor(async () => screen(app).includes('themes: tokyonight-storm'), {
    message: 'the list of real themes'
  })
})

test('a click in a picker opens the row it landed on', async (t) => {
  // The one part of the mouse story that cannot be checked by reasoning: the
  // float knows its own screen position, and a report from the terminal has to
  // land on the row a human saw under the pointer.
  const mouse = {
    events: new EventEmitter(),
    supported: true,
    enable () { this.enabled = true },
    disable () { this.enabled = false }
  }

  const { app, client } = await openApp(t, { rooms: ['design', 'operations'], mouse })

  await press(app, [ESC, ' ', 'f', 'f'])
  assert.equal(mouse.enabled, true, 'reporting is turned on for the float')

  // The float is centred, so where it is depends on how big the terminal is:
  // the click has to be computed against the same size the app laid out for.
  const layout = floatLayout(TERMINAL, { items: 2, maxRows: 22 })
  const rows = floatFrame(app)
  assert.equal(rows.length, layout.height, 'the float is the height its geometry claims')

  mouse.events.emit('mouse', {
    type: 'press',
    button: 'left',
    x: layout.left + 4,
    y: layout.listTop + 1
  })

  await waitFor(async () => client.activeTarget?.name === 'operations', {
    message: 'the clicked conversation to open'
  })

  await sleep(150)
  assert.ok(!screen(app).includes('Conversations'), 'and the picker closed')
  assert.equal(mouse.enabled, false, 'reporting is handed back to the terminal')
})

test('a click outside a float dismisses it', async (t) => {
  const mouse = {
    events: new EventEmitter(),
    supported: true,
    enable () {},
    disable () {}
  }

  const { app, client } = await openApp(t, { rooms: ['design', 'operations'], mouse })
  const before = client.activeId

  await press(app, [ESC, ' ', 'f', 'f'])
  const layout = floatLayout(TERMINAL, { items: 2, maxRows: 22 })

  mouse.events.emit('mouse', {
    type: 'press',
    button: 'left',
    x: layout.left + 4,
    y: layout.top - 2
  })
  await sleep(150)

  assert.ok(!screen(app).includes('Conversations'), 'the float is gone')
  assert.equal(client.activeId, before, 'and nothing was opened')
})

test('the conversation list is a place you can go, not just something to look at', async (t) => {
  const { app, client } = await openApp(t, { rooms: ['design', 'operations', 'book-club'] })
  const before = client.activeId

  // The list takes the keyboard, and says so rather than leaving you guessing
  // which pane your keys are going to.
  await press(app, [ESC, ' ', 'e'], 300)
  assert.match(screen(app), /LIST/, 'the statusline says where the keyboard is')
  assert.match(screen(app), /move.*open.*back/, 'and what the keys do there')

  // The cursor starts on the conversation you are in, so moving off it and
  // opening lands somewhere else. Moving alone opens nothing.
  await press(app, ['k'])
  assert.equal(client.activeId, before, 'moving is not opening')

  // Enter opens what the cursor is on and hands the keyboard back, so the next
  // thing you type is a message rather than a navigation key.
  await press(app, ['\r'], 300)
  await waitFor(async () => client.activeId !== before, { message: 'the picked conversation to open' })
  assert.ok(!screen(app).includes('LIST'), 'and the list gave the keyboard back')

  // Typing goes to the message again, not to the list.
  await press(app, ['i'])
  await press(app, ['h', 'j', 'k'], 80)
  assert.match(screen(app), /hjk/, 'letters are typed, not treated as movement')
})

test('escape leaves the conversation list without opening anything', async (t) => {
  const { app, client } = await openApp(t, { rooms: ['design', 'operations'] })
  const before = client.activeId

  await press(app, [ESC, ' ', 'e'], 300)
  assert.match(screen(app), /LIST/)

  await press(app, ['k'])
  await press(app, [ESC], 300)

  assert.ok(!screen(app).includes('LIST'), 'the keyboard came back')
  assert.equal(client.activeId, before, 'and nothing was opened on the way out')
})
