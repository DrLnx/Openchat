// Screenshots of the real UI.
//
//   npm run shot            everything, into shots/
//   npm run shot -- chat    just the scenes whose name contains "chat"
//
// Two real clients on a local DHT, the real Ink app rendered into a harness,
// and the ANSI frame it produces painted into a headless browser. Nothing is
// mocked and nothing is redrawn by hand, so a screenshot that looks wrong is
// the UI looking wrong.

import React from 'react'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import createTestnet from 'hyperdht/testnet.js'
import { chromium } from 'playwright'

import { App } from '../src/ui/ink/App.jsx'
import { Client } from '../src/core/client.js'
import { renderApp, sleep, KEY } from './lib/ink-harness.js'
import { terminalPage } from './lib/ansi-html.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(root, 'shots')
const HOST = '127.0.0.1'
const COLUMNS = 104
const ROWS = 32
// Read rather than hardcoded: a screenshot showing last release's version is
// the kind of wrong nobody notices until it is on the README.
const VERSION = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const dirs = []

async function main () {
  await mkdir(OUT, { recursive: true })

  const testnet = await createTestnet(3, { host: HOST })
  // Honour a browser the environment already has, so this runs where a
  // Playwright download is not possible.
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
  )
  const page = await browser.newPage({ deviceScaleFactor: 2 })

  const ada = await startClient(testnet.bootstrap, 'work')
  const grace = await startClient(testnet.bootstrap, 'personal')
  await ada.setNick('ada')
  await grace.setNick('grace')

  const app = renderApp(
    React.createElement(App, { client: ada, profile: 'work', version: VERSION }),
    { columns: COLUMNS, rows: ROWS }
  )
  await sleep(800)

  const shots = []
  const shot = async (name, caption) => {
    if (only.length && !only.some((q) => name.includes(q))) return
    const file = await capture(page, app, name, caption)
    shots.push(file)
    console.log(`  ${path.relative(root, file)}`)
  }

  // --- the pane before anything is open -----------------------------------

  await shot('01-welcome', 'Nothing open yet: who you are, and the keys that get you somewhere.')

  // --- a conversation -----------------------------------------------------

  const room = await ada.createRoom('design')
  await grace.joinRoom(room.invite)
  await sleep(1200)

  await grace.sendText('got the invite — this is going over the DHT, no server anywhere')
  await sleep(900)
  await app.type('that is the idea. offline members catch up when they reconnect.')
  await sleep(600)
  await grace.sendText('ada: does the room key rotate when someone is removed?')
  await sleep(900)
  await app.type('not yet — removal is an admission-list block, so they stop being admitted.')
  await sleep(900)

  await shot('02-chat', 'The conversation: grouped by speaker, mentions marked, your own words behind a caret.')

  // --- keys, in a window rather than in the transcript ---------------------

  await command(app, 'invite')
  await sleep(700)
  await shot('03-invite', 'An invite is a secret, so it opens in a window instead of scrolling away in the log.')
  await app.press(KEY.escape)
  await sleep(400)

  await command(app, 'whoami')
  await sleep(700)
  await shot('04-identity', 'Your keys, in one window. The recovery phrase stays hidden until you ask.')
  await app.press('r')
  await sleep(400)
  await shot('05-identity-revealed', 'Press r once you have checked nobody is behind you.')
  await app.press(KEY.escape)
  await sleep(400)

  // --- the command line ---------------------------------------------------

  await app.press(KEY.escape)
  await sleep(200)
  await app.press(':')
  await sleep(600)
  await shot('06-command', 'Commands have a line of their own, opened with `:` the way vim opens one.')
  await app.press(KEY.escape)
  await sleep(300)

  // --- finding things -----------------------------------------------------

  await app.press(KEY.escape)
  await app.press(' ')
  await sleep(500)
  await shot('07-keys', 'Space, then wait: every chord that starts here, and what it does.')
  await app.press(KEY.escape)
  await sleep(300)

  await app.press(' ')
  await app.press('f')
  await app.press('f')
  await sleep(600)
  await shot('08-find', 'Fuzzy-find any conversation.')
  await app.press(KEY.escape)
  await sleep(300)

  app.unmount()
  await browser.close()
  await ada.close()
  await grace.close()
  await testnet.destroy()

  console.log(`\n${shots.length} screenshots -> ${path.relative(root, OUT)}/`)
}

/** Run a command the way a user does: escape to normal, `:`, type it, enter. */
async function command (app, line) {
  await app.press(KEY.escape)
  await sleep(200)
  await app.press(':')
  await sleep(300)
  await app.press(line)
  await sleep(200)
  await app.press('\r')
  await sleep(300)
}

async function capture (page, app, name, caption) {
  const frame = app.lastFrame() || ''
  const html = terminalPage({ frame, title: `openchat — ${name.replace(/^\d+-/, '')}`, caption })
  const file = path.join(OUT, `${name}.png`)

  await page.setContent(html, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await page.locator('.stage').screenshot({ path: file })

  await writeFile(path.join(OUT, `${name}.txt`), stripAnsi(frame))
  return file
}

function stripAnsi (value) {
  const esc = String.fromCharCode(27)
  return String(value || '').replace(new RegExp(`${esc}\\[[0-9;?]*[A-Za-z]`, 'g'), '')
}

async function startClient (bootstrap, profile) {
  const dir = await mkdtemp(path.join(tmpdir(), `openchat-shot-${profile}-`))
  dirs.push(dir)
  const client = new Client({ dir, profile, bootstrap, host: HOST })
  await client.ready()
  return client
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true }).catch(() => {})
    setTimeout(() => process.exit(process.exitCode || 0), 200).unref()
  })
