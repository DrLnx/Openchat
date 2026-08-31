// A guided tour of openchat you can run on one machine, with no network.
//
//   npm run demo
//
// Two real profiles, two real clients, a local DHT, and the real Ink UI. Every
// frame below came out of the actual app: messages are sealed, sent over the
// swarm, and decrypted on the other side. Nothing here is mocked — the only
// thing that differs from real use is that the DHT is a local testnet rather
// than the public one, so it works offline.

import React from 'react'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import createTestnet from 'hyperdht/testnet.js'

import { App } from '../src/ui/ink/App.jsx'
import { Client } from '../src/core/client.js'
import { renderApp, sleep, stripAnsi, KEY } from './lib/ink-harness.js'

const HOST = '127.0.0.1'
const dirs = []

const BOLD = '[1m'
const DIM = '[2m'
const RESET = '[0m'

let step = 0

function say (title, detail) {
  step++
  console.log(`\n${BOLD}${String(step).padStart(2, ' ')}. ${title}${RESET}`)
  if (detail) console.log(`${DIM}    ${detail}${RESET}`)
}

function show (app) {
  const frame = stripAnsi(app.lastFrame() || '')
  console.log()
  for (const line of frame.split('\n')) console.log(`    ${line}`)
}

async function settle (app, ms = 1200) {
  await sleep(ms)
}

async function startClient (bootstrap, profile) {
  const dir = await mkdtemp(path.join(tmpdir(), `openchat-demo-${profile}-`))
  dirs.push(dir)
  const client = new Client({ dir, profile, bootstrap, host: HOST })
  await client.ready()
  return client
}

async function main () {
  console.log(`${BOLD}openchat — guided tour${RESET}`)
  console.log(`${DIM}Two accounts on one machine, talking to each other over a local DHT.${RESET}`)

  const testnet = await createTestnet(3, { host: HOST })

  // Two profiles, exactly as two terminals on your machine would have.
  const work = await startClient(testnet.bootstrap, 'work')
  const personal = await startClient(testnet.bootstrap, 'personal')

  await work.setNick('ada')
  await personal.setNick('grace')

  say(
    'Two separate accounts on one machine',
    'Different keys, different stores. This is `--profile work` and `--profile personal`.'
  )
  console.log(`    work      ada    ${work.identity.publicKeyHex}`)
  console.log(`    personal  grace  ${personal.identity.publicKeyHex}`)

  // --- a room -------------------------------------------------------------

  const room = await work.createRoom('design')

  // The UI we watch throughout is ada's. The banner is printed once at startup
  // and then scrolls away, so start it with the room already open.
  const app = renderApp(React.createElement(App, { client: work, profile: 'work' }))
  await settle(app)
  say('Ada opens a room', 'She owns it. The invite is the only way in.')
  show(app)

  await personal.joinRoom(room.invite)
  await personal.sendText('got the invite — no server involved anywhere')
  await settle(app)
  say('Grace joins with the invite and says hello', 'Her message was sealed before it hit the wire.')
  show(app)

  // --- a direct message, with no invite -----------------------------------

  say(
    'Ada messages Grace directly, using nothing but her public key',
    'No invite, no handshake: the channel is derived from the two identities by ECDH.'
  )
  await app.type(`/dm ${personal.identity.publicKeyHex}`)
  await settle(app)
  show(app)

  const graceSide = await personal.openDm(work.identity.publicKeyHex)
  await sleep(1500)
  await personal.sendText('and this one nobody can even see us having')
  await settle(app, 1800)
  say('Grace replies in the DM', 'A third party cannot compute this topic, so they cannot tell it exists.')
  show(app)

  // --- switching ----------------------------------------------------------

  await app.press(KEY.shiftTab)
  await settle(app, 600)
  say('Shift+Tab moves between everything open', 'Back to the room; the DM keeps running behind it.')
  show(app)

  // --- ownership ----------------------------------------------------------

  await app.type('/close')
  await settle(app)
  say('Ada closes the room', 'Existing members keep talking; the invite stops admitting anyone new.')
  show(app)

  const outsider = await startClient(testnet.bootstrap, 'outsider')
  const denied = await outsider.joinRoom(room.invite, { wait: false }).catch(() => null)
  await sleep(4000)
  say(
    'A third person tries the same invite',
    `They hold a perfectly valid invite and are still not a member: ${
      room.members.length
    } member(s) in the room.`
  )
  console.log(`    admitted: ${denied && denied.writable ? 'yes — that would be a bug' : 'no'}`)

  await app.type('/reopen')
  await settle(app)
  await app.type(`/transfer ${personal.identity.publicKeyHex}`)
  await settle(app, 1800)
  say('Ada hands the room to Grace', 'Every member verifies that against the current owner, not just Ada.')
  show(app)

  console.log(`\n${DIM}    grace owns it now: ${room.owner === personal.identity.publicKeyHex}${RESET}`)
  console.log(`${DIM}    ada can still close it: ${room.isOwner}${RESET}`)

  // --- attachments --------------------------------------------------------

  const file = path.join(dirs[0], 'notes.md')
  await writeFile(file, '# openchat\n\nthe topic is public. the key never is.\n')
  await app.type(`/file ${file}`)
  await settle(app, 1600)
  say('A file goes across', 'Metadata in the log, bytes in a blob core, checksum verified on arrival.')
  show(app)

  // --- done ---------------------------------------------------------------

  app.unmount()
  await work.close()
  await personal.close()
  await outsider.close()
  await testnet.destroy()
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })

  console.log(`\n${BOLD}That was the real thing.${RESET}`)
  console.log(`${DIM}To do it yourself across two terminals, see "Trying it" in the README.${RESET}\n`)
}

await main()
process.exit(0)
