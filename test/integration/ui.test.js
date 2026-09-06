// The Ink UI, rendered against a real client on a local testnet — no mocked
// data. The plan was explicit about this: if the UI only ever sees fixtures,
// the bugs that matter (a message that arrives but never paints, a member list
// that does not update) survive all the way to a user's terminal.
//
// The app paints the whole terminal, so `screen()` below is the whole terminal:
// title bar, conversation list, chat, prompt, statusline, in that order.

import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { render } from 'ink-testing-library'

import { App } from '../../src/ui/ink/App.jsx'
import { Client } from '../../src/core/client.js'
import { createTestDht, TEST_HOST, waitFor, sleep } from '../helpers.js'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

async function startClient (bootstrap) {
  const dir = await mkdtemp(path.join(tmpdir(), 'openchat-ui-'))
  const client = new Client({ dir, bootstrap, host: TEST_HOST })
  await client.ready()
  return client
}

/**
 * Type a line and press enter. The newline has to be a separate write with a
 * tick in between: a chunk arriving in one write is a paste, not a line
 * followed by a keypress, so "text\r" in a single write never submits.
 */
async function type (app, line) {
  app.stdin.write(line)
  await sleep(60)
  app.stdin.write('\r')
  await sleep(60)
}

/** The last rendered frame, with ANSI styling stripped. */
function screen (app) {
  // eslint-disable-next-line no-control-regex
  return (app.lastFrame() || '').replace(/\u001B\[[0-9;]*m/g, '')
}

test('the UI renders a live room and paints messages as they arrive', async (t) => {
  const testnet = await createTestDht()
  const alice = await startClient(testnet.bootstrap)
  const bob = await startClient(testnet.bootstrap)

  t.after(async () => {
    await alice.close()
    await bob.close()
    await testnet.destroy()
  })

  const room = await alice.createRoom('design')
  const app = render(React.createElement(App, { client: alice }))
  t.after(() => app.unmount())

  await waitFor(async () => screen(app).includes('#design'), { message: 'the room to appear' })

  const initial = screen(app)
  assert.match(initial, /#design/, 'the title bar and the status line name the room')
  assert.match(initial, /ROOMS/, 'the conversation list is on screen')
  assert.match(initial, /member/, 'the title bar says how many people are in it')
  assert.match(initial, /esc normal/, 'the statusline says how to get out of insert mode')

  // The app paints a frame the height of the terminal, so the prompt and the
  // statusline are always the last two things on it — that is the property the
  // whole layout hangs off, and the one a stray row would break.
  const lines = initial.split('\n')
  assert.match(lines[lines.length - 1], /INSERT/, 'the statusline is the last row')
  assert.match(lines[lines.length - 2], /╰/, 'with the prompt directly above it')

  // Bob joins for real, over the swarm, and says something.
  await bob.joinRoom(room.invite)
  await bob.sendText('is this thing on?')

  await waitFor(async () => screen(app).includes('is this thing on?'), {
    message: "bob's message to paint in alice's UI"
  })

  const withMessage = screen(app)
  assert.match(withMessage, /\d\d:\d\d/, 'messages are timestamped')
  assert.match(withMessage, /⏺/, 'an arriving message is marked as incoming')
})

test('typing a message sends it; typing a slash command runs it', async (t) => {
  const testnet = await createTestDht()
  const alice = await startClient(testnet.bootstrap)

  t.after(async () => {
    await alice.close()
    await testnet.destroy()
  })

  await alice.createRoom('solo')
  const app = render(React.createElement(App, { client: alice }))
  t.after(() => app.unmount())

  await waitFor(async () => screen(app).includes('#solo'), { message: 'the UI to start' })

  await type(app, 'hello world')
  await waitFor(async () => screen(app).includes('hello world'), { message: 'the sent message' })
  assert.match(screen(app), /› you\s+hello world/, 'your own message echoes behind a caret')

  await type(app, '/invite')
  await waitFor(async () => screen(app).includes('openchat1:'), { message: 'the invite output' })
  assert.match(screen(app), /share it out of band/i, 'the warning is shown with the invite')

  await type(app, '/nick ada')
  await waitFor(async () => screen(app).includes('you are now ada'), { message: 'the nick change' })

  await type(app, '/nope')
  await waitFor(async () => screen(app).includes('unknown command'), { message: 'the error notice' })
  assert.match(screen(app), /✗ unknown command/, 'errors are marked')
})

test('the app can do the things that used to need a shell command', async (t) => {
  const testnet = await createTestDht()
  const alice = await startClient(testnet.bootstrap)

  t.after(async () => {
    await alice.close()
    await testnet.destroy()
  })

  await alice.restore()
  const app = render(React.createElement(App, { client: alice, profile: 'work' }))
  t.after(() => app.unmount())

  await waitFor(async () => screen(app).includes('end-to-end encrypted'), { message: 'the app to start' })

  // A room is created in here, not from a shell command.
  await type(app, '/new design-team')
  await waitFor(async () => screen(app).includes('#design-team'), { message: 'the new room' })
  assert.match(screen(app), /you own it/, 'says the room is yours')

  await type(app, '/invite')
  await waitFor(async () => screen(app).includes('openchat1:'), { message: 'the invite' })

  // The recovery phrase has to be reachable without leaving the app, since
  // there is no longer a shell command that shows it.
  await type(app, '/backup')
  await waitFor(async () => screen(app).includes('Recovery phrase'), { message: 'the phrase' })
  const words = alice.identity.mnemonic.split(' ')
  assert.ok(screen(app).includes(words[0]), 'the real phrase is shown')
  assert.match(screen(app), /post as you/, 'warns what it is worth')

  await type(app, '/whoami')
  await waitFor(async () => screen(app).includes(alice.identity.publicKeyHex), {
    message: 'your key'
  })

  await type(app, '/profiles')
  await waitFor(async () => screen(app).includes('--profile'), {
    message: 'how to open another account'
  })
})

test('typing a slash opens a command menu', async (t) => {
  const testnet = await createTestDht()
  const alice = await startClient(testnet.bootstrap)

  t.after(async () => {
    await alice.close()
    await testnet.destroy()
  })

  await alice.createRoom('menu')
  const app = render(React.createElement(App, { client: alice }))
  t.after(() => app.unmount())

  await waitFor(async () => screen(app).includes('#menu'), { message: 'the UI to start' })

  // The menu lists matching commands with their help, and narrows as you type.
  app.stdin.write('/')
  await waitFor(async () => screen(app).includes('join a room from an invite string'), {
    message: 'the command menu'
  })
  assert.match(screen(app), /print an invite for the current room/, 'every match is listed')

  app.stdin.write('me')
  await waitFor(
    async () => {
      const frame = app.lastFrame() || ''
      return frame.includes('list the members of this room') && !frame.includes('leave and exit')
    },
    { message: 'the menu to narrow to /members' }
  )

  // Enter takes the highlighted command rather than sending "/me" as a message.
  app.stdin.write('\r')
  await waitFor(async () => screen(app).includes('(you)'), { message: '/members to run' })
  assert.ok(!screen(app).includes('unknown command'), 'the partial command was never sent')
})

test('a sent file renders as an attachment, not as raw metadata', async (t) => {
  const testnet = await createTestDht()
  const alice = await startClient(testnet.bootstrap)

  t.after(async () => {
    await alice.close()
    await testnet.destroy()
  })

  await alice.createRoom('files')
  const app = render(React.createElement(App, { client: alice }))
  t.after(() => app.unmount())

  await waitFor(async () => screen(app).includes('#files'), { message: 'the UI to start' })

  const dir = await mkdtemp(path.join(tmpdir(), 'openchat-ui-file-'))
  const file = path.join(dir, 'agenda.md')
  await writeFile(file, '# agenda\n\n- ship it\n')

  await type(app, `/file ${file}`)
  await waitFor(async () => screen(app).includes('agenda.md'), { message: 'the attachment line' })

  const frame = screen(app)
  assert.match(frame, /agenda\.md \(\d+B\)/, 'the attachment shows its name and size')
  assert.match(frame, /⎿/, 'its state hangs under the message that announced it')
  assert.ok(!frame.includes('blobCoreKey'), 'raw metadata is not leaked into the transcript')
})

test('joining opens the room at once and waits to be admitted in the background', async (t) => {
  // The complaint this covers: `/join` used to block the prompt for up to
  // thirty seconds while it waited for a member to admit you, which looks
  // exactly like a join that has failed. Opening the room is local and
  // immediate; being admitted is not, and is not something the joiner can
  // hurry along, so it must not hold the interface hostage.
  const testnet = await createTestDht()
  const owner = await startClient(testnet.bootstrap)
  const joiner = await startClient(testnet.bootstrap)

  t.after(async () => {
    await owner.close().catch(() => {})
    await joiner.close()
    await testnet.destroy()
  })

  const room = await owner.createRoom('closed-shop')
  const invite = room.invite

  // Nobody is home, so admission cannot happen — which is the case that used
  // to hang.
  await owner.close()

  const app = render(React.createElement(App, { client: joiner, profile: 'work' }))
  t.after(() => app.unmount())

  await waitFor(async () => screen(app).includes('nothing open'), { message: 'the app to start' })

  const started = Date.now()
  await type(app, `/join ${invite}`)

  await waitFor(async () => screen(app).includes('waiting to be admitted'), {
    message: 'the room to open and say what it is waiting for'
  })

  const elapsed = Date.now() - started
  assert.ok(elapsed < 10000, `the prompt came back in ${elapsed}ms rather than blocking`)

  const frame = screen(app)
  assert.match(frame, /#closed-shop/, 'the room is open and named in the title bar')
  assert.match(frame, /by itself as soon as a member is online/, 'and says it needs nothing from you')
})

test('the UI comes up with no rooms and says what to do', async (t) => {
  const testnet = await createTestDht()
  const alice = await startClient(testnet.bootstrap)

  t.after(async () => {
    await alice.close()
    await testnet.destroy()
  })

  await alice.restore()
  const app = render(React.createElement(App, { client: alice }))
  t.after(() => app.unmount())

  await sleep(200)
  const frame = screen(app)
  assert.match(frame, /end-to-end encrypted/, 'the empty pane still introduces itself')
  assert.match(frame, /nothing open/, 'the title bar says there is nothing open')
  assert.match(frame, /find someone to message/, 'tells you how to reach someone')
  assert.match(frame, /no rooms yet/, 'and so does the empty conversation list')
  assert.ok(frame.includes(alice.identity.publicKeyHex), 'shows your key, which is how people reach you')
})
