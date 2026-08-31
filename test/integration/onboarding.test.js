// First run. There is no account to sign up for, so onboarding has exactly two
// jobs: get a usable identity onto the machine, and make sure the recovery
// phrase is seen before anyone depends on it.

import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { render } from 'ink-testing-library'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Root } from '../../src/ui/ink/Root.jsx'
import { hasIdentity, loadIdentity } from '../../src/core/identity.js'
import { readConfig } from '../../src/core/store.js'
import { createTestDht, TEST_HOST, waitFor, sleep } from '../helpers.js'

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`

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

async function freshProfile (t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'openchat-onboard-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
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

  await waitFor(async () => screen(app).includes('Set up "work"'), { message: 'the first step' })
  assert.match(screen(app), /No sign-up and no server/, 'explains what an account is here')
  assert.match(screen(app), /Create a new identity/)
  assert.match(screen(app), /Restore one from a recovery phrase/)

  // Take the default choice, then name yourself.
  app.stdin.write('\r')
  await waitFor(async () => screen(app).includes('Pick a display name'), { message: 'the nick step' })
  await type(app, 'ada')

  // The recovery phrase has to be shown before anything else happens.
  await waitFor(async () => screen(app).includes('Save your recovery phrase'), {
    message: 'the recovery phrase'
  })
  const shown = screen(app)
  assert.match(shown, /Anyone who has them can post as/, 'says what the phrase is worth')
  assert.match(shown, /no server that can reset it/, 'says nobody can recover it for you')

  const identity = await loadIdentity({ dir })
  const words = identity.mnemonic.split(' ')
  assert.equal(words.length, 24)
  assert.ok(shown.includes(words[0]), 'the real phrase is on screen')

  // Acknowledging it starts the client.
  app.stdin.write('\r')
  await waitFor(async () => screen(app).includes('Welcome to openchat'), {
    message: 'the app to start',
    timeout: 30000
  })

  assert.equal(await hasIdentity(dir), true)
  const config = await readConfig(dir)
  assert.equal(config.nick, 'ada')
  assert.equal(config.onboarded, true)
})

test('an existing identity can be restored from its phrase', async (t) => {
  const testnet = await createTestDht()
  const original = await freshProfile(t)
  const replacement = await freshProfile(t)
  t.after(() => testnet.destroy())

  // Make an identity to restore.
  const first = render(React.createElement(Root, {
    profile: 'first', dir: original, needsOnboarding: true, bootstrap: testnet.bootstrap, host: TEST_HOST
  }))
  await waitFor(async () => screen(first).includes('Set up'), { message: 'setup' })
  first.stdin.write('\r')
  await waitFor(async () => screen(first).includes('Pick a display name'), { message: 'nick' })
  await type(first, 'ada')
  await waitFor(async () => screen(first).includes('Save your recovery phrase'), { message: 'phrase' })
  const identity = await loadIdentity({ dir: original })
  first.unmount()

  // Restore it into a clean profile.
  const app = render(React.createElement(Root, {
    profile: 'restored', dir: replacement, needsOnboarding: true, bootstrap: testnet.bootstrap, host: TEST_HOST
  }))
  t.after(() => app.unmount())

  await waitFor(async () => screen(app).includes('Set up "restored"'), { message: 'setup' })
  app.stdin.write(DOWN)
  await sleep(80)
  app.stdin.write('\r')

  await waitFor(async () => screen(app).includes('Restore from a recovery phrase'), {
    message: 'the restore step'
  })
  await type(app, identity.mnemonic)

  await waitFor(async () => screen(app).includes('Welcome to openchat'), {
    message: 'the app to start',
    timeout: 30000
  })

  const restored = await loadIdentity({ dir: replacement })
  assert.equal(restored.publicKeyHex, identity.publicKeyHex, 'same identity, different machine')
})

test('a bad recovery phrase is rejected rather than silently accepted', async (t) => {
  const testnet = await createTestDht()
  const dir = await freshProfile(t)
  t.after(() => testnet.destroy())

  const app = render(React.createElement(Root, {
    profile: 'work', dir, needsOnboarding: true, bootstrap: testnet.bootstrap, host: TEST_HOST
  }))
  t.after(() => app.unmount())

  await waitFor(async () => screen(app).includes('Set up "work"'), { message: 'setup' })
  app.stdin.write(DOWN)
  await sleep(80)
  app.stdin.write('\r')
  await waitFor(async () => screen(app).includes('Restore from a recovery phrase'), { message: 'restore' })

  await type(app, 'these are definitely not the right words at all nope')
  await waitFor(async () => screen(app).includes('invalid recovery phrase'), {
    message: 'the error'
  })
  assert.equal(await hasIdentity(dir), false, 'nothing was written')
})
