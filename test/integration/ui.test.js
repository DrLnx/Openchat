// The Ink UI, rendered against a real client on a local testnet — no mocked
// data. The plan was explicit about this: if the UI only ever sees fixtures,
// the bugs that matter (a message that arrives but never paints, a member list
// that does not update) survive all the way to a user's terminal.

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
 * tick in between: ink-text-input processes a chunk as one keypress, so
 * "text\r" in a single write arrives as a paste and never submits.
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

  await waitFor(async () => screen(app).includes('#design'), { message: 'room name in the status bar' })

  const initial = screen(app)
  assert.match(initial, /#design/, 'status bar shows the room')
  assert.match(initial, /ROOMS/, 'sidebar renders')
  assert.match(initial, /MEMBERS/, 'member list renders')
  assert.match(initial, /No messages yet/, 'empty state explains what to do')

  // Bob joins for real, over the swarm, and says something.
  await bob.joinRoom(room.invite)
  await bob.sendText('is this thing on?')

  await waitFor(async () => screen(app).includes('is this thing on?'), {
    message: "bob's message to paint in alice's UI"
  })

  const withMessage = screen(app)
  assert.ok(!withMessage.includes('No messages yet'), 'empty state cleared')
  assert.match(withMessage, /\d\d:\d\d/, 'messages are timestamped')
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

  await type(app, '/invite')
  await waitFor(async () => screen(app).includes('openchat1:'), { message: 'the invite output' })
  assert.match(screen(app), /share it out of band/i, 'the warning is shown with the invite')

  await type(app, '/nick ada')
  await waitFor(async () => screen(app).includes('you are now ada'), { message: 'the nick change' })

  await type(app, '/nope')
  await waitFor(async () => screen(app).includes('unknown command'), { message: 'the error notice' })
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
  assert.match(frame, /📎 agenda\.md/, 'rendered as an attachment')
  assert.ok(!frame.includes('blobCoreKey'), 'raw metadata is not leaked into the transcript')
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
  assert.match(frame, /no room/, 'says there is no room')
  assert.match(frame, /join <invite>/, 'tells you how to get one')
})
