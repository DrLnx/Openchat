// Records a real session: two genuine openchat clients on a local hyperdht
// testnet, with the actual Ink UI rendering one of them. Every frame captured
// here came out of the real render, over the real swarm, decrypted from real
// envelopes — the browser harness replays it so the page can show the CLI
// working even though the page itself cannot run it.
//
//   npm run record

import React from 'react'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import createTestnet from 'hyperdht/testnet.js'

import { App } from '../src/ui/ink/App.jsx'
import { Client } from '../src/core/client.js'
import { renderApp, sleep, stripAnsi } from './lib/ink-harness.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(root, 'web/demo/transcript.json')
const HOST = '127.0.0.1'

const frames = []

const render = (node) => renderApp(node)

async function main () {
  const testnet = await createTestnet(3, { host: HOST })

  const alice = await startClient(testnet.bootstrap)
  const bob = await startClient(testnet.bootstrap)

  const room = await alice.createRoom('design')
  const app = render(React.createElement(App, { client: alice }))

  await settle(app, 'Alice creates a room. It is hers alone until she shares the invite.')

  await bob.joinRoom(room.invite)
  await settle(app, 'Bob joins with the invite string. He is admitted as a writer.')

  await bob.setNick('bob')
  await bob.sendText('got the invite — this is over the DHT, no server anywhere')
  await settle(app, "Bob's message arrives, decrypted and verified.")

  await app.type( 'that is the idea. offline members catch up on reconnect.')
  await settle(app, 'Alice replies. Her message is sealed before it touches the wire.')

  // Capture the command menu open, before it is completed.
  app.stdin.write('/me')
  await settle(app, 'Typing a slash opens the command menu, filtered as you type.')
  app.stdin.write('\r')
  await settle(app, 'Enter takes the highlighted command and runs it.')

  const file = path.join(await mkdtemp(path.join(tmpdir(), 'openchat-demo-')), 'protocol-notes.md')
  await writeFile(file, '# openchat\n\ntopic is public. the key never is.\n')
  await app.type( `/file ${file}`)
  await settle(app, 'A file is sent as metadata; the bytes follow from a blob core.')

  await app.type( '/invite')
  await settle(app, '/invite prints the string that admits the next member.')

  await app.type( '/nope')
  await settle(app, 'An unknown command is reported without sending it to the room.')

  app.unmount()
  await alice.close()
  await bob.close()
  await testnet.destroy()

  await mkdir(path.dirname(OUT), { recursive: true })
  await writeFile(OUT, JSON.stringify({ recordedAt: Date.now(), frames }, null, 2))

  console.log(`recorded ${frames.length} frames -> ${path.relative(root, OUT)}`)
}

async function startClient (bootstrap) {
  const dir = await mkdtemp(path.join(tmpdir(), 'openchat-record-'))
  const client = new Client({ dir, bootstrap, host: HOST })
  await client.ready()
  return client
}

async function settle (app, caption) {
  await sleep(1200)
  const frame = app.lastFrame() || ''
  frames.push({ caption, frame: stripAnsi(frame) })
}

await main()
process.exit(0)
