// First run. There is no account to sign up for, so onboarding has exactly two
// jobs: get a usable identity onto the machine, and make sure the recovery
// phrase is seen before anyone depends on it.
//
// There is one path through it. A key is generated on the machine that uses it
// and there is no way to bring one in from anywhere else, so nothing here asks
// you to choose between creating and restoring.

import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { render } from 'ink-testing-library'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Root } from '../../src/ui/ink/Root.jsx'
import * as identityCore from '../../src/core/identity.js'
import { hasIdentity, loadIdentity } from '../../src/core/identity.js'
import {
  readConfig, currentProfile, listProfiles, profileDir, DEFAULT_PROFILE
} from '../../src/core/store.js'
import { createTestDht, TEST_HOST, waitFor, sleep } from '../helpers.js'

const ESC = String.fromCharCode(27)

function screen (app) {
  // eslint-disable-next-line no-control-regex
  return (app.lastFrame() || '').replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '')
}

async function type (app, line) {
  app.stdin.write(line)
  await sleep(60)
  app.stdin.write('\r')
  await sleep(120)
}

/**
 * A machine with nothing on it, with the openchat home pointed at it.
 *
 * The other tests here hand Root a directory directly, which is the
 * OPENCHAT_DIR case; this is the one a person actually gets, where the home
 * holds the account database and the profile directory under it.
 */
async function freshHome (t) {
  const home = await mkdtemp(path.join(tmpdir(), 'openchat-home-'))
  const previousHome = process.env.OPENCHAT_HOME
  const previousDir = process.env.OPENCHAT_DIR

  process.env.OPENCHAT_HOME = home
  delete process.env.OPENCHAT_DIR

  t.after(async () => {
    if (previousHome === undefined) delete process.env.OPENCHAT_HOME
    else process.env.OPENCHAT_HOME = previousHome
    if (previousDir !== undefined) process.env.OPENCHAT_DIR = previousDir
    await rm(home, { recursive: true, force: true })
  })

  return home
}

/**
 * A profile directory of its own, on a machine of its own.
 *
 * The home matters even when the test hands Root a directory directly: Root
 * records which account this *machine* is in, and a test without a home of its
 * own writes that into the real one — which is how a developer running the
 * suite ends up with accounts on their laptop named after fixtures.
 */
async function freshProfile (t) {
  await freshHome(t)
  const dir = await mkdtemp(path.join(tmpdir(), 'openchat-onboard-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/**
 * The screen as one line, for asserting on prose that has been wrapped.
 *
 * The card's own borders come out with it: a sentence that wraps inside a box
 * has a `│` and two runs of padding in the middle of it, and none of that is
 * anything the test is about.
 */
function prose (frame) {
  return frame.replace(/[\u2500-\u257f]/g, ' ').replace(/\s+/g, ' ')
}

test('a new profile is walked through creating an identity', async (t) => {
  const testnet = await createTestDht()
  const dir = await freshProfile(t)
  t.after(() => testnet.destroy())

  assert.equal(await hasIdentity(dir), false, 'nothing set up yet')

  const app = render(React.createElement(Root, {
    profile: 'work',
    dir,
    needsOnboarding: true,
    bootstrap: testnet.bootstrap,
    host: TEST_HOST
  }))
  t.after(() => app.unmount())

  await waitFor(async () => screen(app).includes('no server in the middle'), {
    message: 'the welcome step'
  })
  assert.match(screen(app), /your identity is a keypair generated on this machine/, 'explains what an account is here')
  app.stdin.write('\r')

  // Straight to the name: there is no choice to make about where the key comes
  // from, because there is only one place it can come from.
  await waitFor(async () => screen(app).includes('Pick a display name'), { message: 'the nick step' })
  await type(app, 'ada')

  // The recovery phrase has to be shown before anything else happens.
  await waitFor(async () => screen(app).includes('Write down your recovery phrase'), {
    message: 'the recovery phrase'
  })
  const shown = screen(app)
  // The prose is wrapped to the card, so a sentence can be checked for but a
  // line cannot: where it breaks is a property of the terminal, not of what it
  // says.
  assert.match(prose(shown), /Anyone who has them can post as you/, 'says what the phrase is worth')
  assert.match(prose(shown), /no server that can reset this for you/, 'says nobody can recover it')

  const identity = await loadIdentity({ dir })
  const words = identity.mnemonic.split(' ')
  assert.equal(words.length, 24)
  assert.ok(shown.includes(words[0]), 'the real phrase is on screen')

  // The phrase has to be acknowledged before anything moves on: enter alone
  // does nothing until you have said you wrote it down.
  app.stdin.write('\r')
  await sleep(80)
  assert.match(screen(app), /Write down your recovery phrase/, 'enter alone does not dismiss it')

  app.stdin.write('y')
  await sleep(80)
  app.stdin.write('\r')
  await waitFor(async () => screen(app).includes('end-to-end encrypted'), {
    message: 'the app to start',
    timeout: 30000
  })

  assert.equal(await hasIdentity(dir), true)
  const config = await readConfig(dir)
  assert.equal(config.nick, 'ada')
  assert.equal(config.onboarded, true)
})

test('onboarding happens once, and the next launch opens what it made', async (t) => {
  const testnet = await createTestDht()
  await freshHome(t)
  t.after(() => testnet.destroy())

  // What the binary decides at startup, in one place, so the test asks the same
  // question the entry point does rather than a paraphrase of it.
  const wouldOnboard = async () => {
    const profile = await currentProfile()
    return { profile, onboarding: !(await hasIdentity(profileDir(profile))) }
  }

  assert.deepEqual(
    await wouldOnboard(),
    { profile: DEFAULT_PROFILE, onboarding: true },
    'a machine with nothing on it onboards'
  )

  const app = render(React.createElement(Root, {
    profile: DEFAULT_PROFILE,
    dir: profileDir(DEFAULT_PROFILE),
    needsOnboarding: true,
    bootstrap: testnet.bootstrap,
    host: TEST_HOST
  }))
  t.after(() => app.unmount())

  await waitFor(async () => screen(app).includes('no server in the middle'), { message: 'welcome' })
  app.stdin.write('\r')
  await waitFor(async () => screen(app).includes('Pick a display name'), { message: 'the nick step' })
  await type(app, 'ada')
  await waitFor(async () => screen(app).includes('Write down your recovery phrase'), {
    message: 'the recovery phrase'
  })
  app.stdin.write('y')
  await sleep(80)
  app.stdin.write('\r')
  await waitFor(async () => screen(app).includes('end-to-end encrypted'), {
    message: 'the app to start',
    timeout: 30000
  })

  // The whole complaint this test exists for: doing it once has to be enough.
  assert.deepEqual(
    await wouldOnboard(),
    { profile: DEFAULT_PROFILE, onboarding: false },
    'and never again on this machine'
  )

  // And it made exactly one account, not a directory that merely looks like one.
  assert.deepEqual(await listProfiles(), [DEFAULT_PROFILE])
  assert.equal((await readConfig(profileDir(DEFAULT_PROFILE))).nick, 'ada')
})

/**
 * What a copy key actually put on the clipboard.
 *
 * OSC 52 goes to the real process.stdout rather than to Ink's, because the
 * clipboard belongs to the terminal and not to the frame — so that is where the
 * test has to listen. See clipboard.js.
 */
function clipboard (chunks) {
  const last = chunks.filter((chunk) => chunk.includes(`${ESC}]52;`)).pop()
  if (!last) return null
  return Buffer.from(last.match(/\]52;c;([A-Za-z0-9+/=]*)/)[1], 'base64').toString('utf8')
}

test('the two things on the phrase screen have a copy key each', async (t) => {
  const testnet = await createTestDht()
  const dir = await freshProfile(t)
  t.after(() => testnet.destroy())

  const app = render(React.createElement(Root, {
    profile: 'work', dir, needsOnboarding: true, bootstrap: testnet.bootstrap, host: TEST_HOST
  }))
  t.after(() => app.unmount())

  await waitFor(async () => screen(app).includes('no server in the middle'), { message: 'welcome' })
  app.stdin.write('\r')
  await waitFor(async () => screen(app).includes('Pick a display name'), { message: 'the nick step' })
  await type(app, 'ada')
  await waitFor(async () => screen(app).includes('Write down your recovery phrase'), {
    message: 'the recovery phrase'
  })

  const made = await loadIdentity({ dir })
  const written = []
  const real = process.stdout.write.bind(process.stdout)
  process.stdout.write = (chunk) => { written.push(String(chunk)); return true }
  t.after(() => { process.stdout.write = real })

  // `c` is the one you can hit by accident, so it takes the harmless value.
  app.stdin.write('c')
  await sleep(120)
  assert.equal(clipboard(written), made.publicKeyHex, 'c copies the public key')
  assert.match(screen(app), /your public key copied/, 'and says which of the two it took')

  // The phrase is behind shift, and it goes out whole — the point of copying it
  // is that nobody retypes twenty-four words correctly.
  written.length = 0
  app.stdin.write('C')
  await sleep(120)
  assert.equal(clipboard(written), made.mnemonic, 'shift-c copies all 24 words')
  assert.match(screen(app), /all 24 words copied/)

  process.stdout.write = real
})

test('there is no way to bring an identity in from somewhere else', async (t) => {
  const testnet = await createTestDht()
  const dir = await freshProfile(t)
  t.after(() => testnet.destroy())

  // The mechanism is gone, not just the screen that used to reach it. A key is
  // generated where it is used, and nothing in the program reads a mnemonic
  // back — so identity.json is the only copy of an account there will be.
  assert.equal(identityCore.restoreFromMnemonic, undefined, 'no restore in the core either')

  const app = render(React.createElement(Root, {
    profile: 'work', dir, needsOnboarding: true, bootstrap: testnet.bootstrap, host: TEST_HOST
  }))
  t.after(() => app.unmount())

  await waitFor(async () => screen(app).includes('no server in the middle'), { message: 'welcome' })
  app.stdin.write('\r')
  await waitFor(async () => screen(app).includes('Pick a display name'), { message: 'the nick step' })

  assert.doesNotMatch(screen(app), /[Rr]estore/, 'nothing offers to restore one')

  await type(app, 'ada')
  await waitFor(async () => screen(app).includes('Write down your recovery phrase'), {
    message: 'the recovery phrase'
  })

  const made = await loadIdentity({ dir })
  assert.equal(made.mnemonic.split(' ').length, 24, 'the key it made is the key you keep')
})
