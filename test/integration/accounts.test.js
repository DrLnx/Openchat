// Several accounts on one machine.
//
// The claim being tested is a privacy claim, not a convenience one: two
// accounts share a machine and nothing else — not a key, not a room list, not
// a contact — and switching between them is a real teardown rather than a
// change of label. If any of that stopped being true, the reason to have a
// second identity would go with it.

import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { render } from 'ink-testing-library'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Root } from '../../src/ui/ink/Root.jsx'
import {
  listAccounts, createAccount, describeAccount, useAccount, suggestProfile
} from '../../src/core/accounts.js'
import { readConfig, profileDir } from '../../src/core/store.js'
import { loadIdentity } from '../../src/core/identity.js'
import { createTestDht, TEST_HOST, waitFor, pressUntil } from '../helpers.js'

const ESC = String.fromCharCode(27)

function screen (app) {
  // eslint-disable-next-line no-control-regex
  return (app.lastFrame() || '').replace(/\[[0-9;]*m/g, '')
}

/**
 * Point openchat at a scratch home. Profiles are directories under it, so this
 * is the whole isolation story — the same one two accounts get from each other.
 */
async function scratchHome (t) {
  const home = await mkdtemp(path.join(tmpdir(), 'openchat-accounts-'))
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

test('an account is a username and a keypair, and two of them share nothing', async (t) => {
  await scratchHome(t)

  const work = await createAccount({ profile: 'work', nick: 'ada' })
  const alias = await createAccount({ profile: 'alias', nick: 'nobody' })

  assert.notEqual(work.publicKey, alias.publicKey, 'different keys')
  assert.notEqual(work.dir, alias.dir, 'different directories')
  assert.notEqual(work.mnemonic, alias.mnemonic, 'different recovery phrases')

  const accounts = await listAccounts()
  assert.deepEqual(accounts.map((a) => a.profile).sort(), ['alias', 'work'])
  assert.equal(accounts.find((a) => a.profile === 'work').nick, 'ada')
  assert.equal(accounts.find((a) => a.profile === 'alias').publicKey, alias.publicKey)

  // Saving a contact in one account must not put it in the other.
  const config = await readConfig(profileDir('work'))
  config.contacts = [{ key: 'a'.repeat(64), name: 'grace' }]
  const { writeConfig } = await import('../../src/core/store.js')
  await writeConfig(config, profileDir('work'))

  assert.deepEqual((await readConfig(profileDir('alias'))).contacts, [], 'the other account never saw it')
})

test('an account will not be overwritten by accident', async (t) => {
  await scratchHome(t)
  await createAccount({ profile: 'work', nick: 'ada' })

  await assert.rejects(
    () => createAccount({ profile: 'work', nick: 'someone else' }),
    /already has an identity/,
    'because doing so would destroy a key nobody can reissue'
  )
})

test('every account is a key that has never existed before', async (t) => {
  await scratchHome(t)

  const laptop = await createAccount({ profile: 'laptop', nick: 'ada' })
  const desktop = await createAccount({ profile: 'desktop', nick: 'ada' })

  // Two accounts with the same display name are still two strangers. There is
  // no way to put an existing key into a new account — createAccount generates
  // one and that is the only thing it does.
  assert.notEqual(desktop.publicKey, laptop.publicKey, 'same name, different people')
  assert.notEqual(desktop.mnemonic, laptop.mnemonic)
  assert.notEqual(desktop.dir, laptop.dir)
})

test('the current account is remembered, and a free name can be suggested', async (t) => {
  await scratchHome(t)
  await createAccount({ profile: 'work', nick: 'ada' })

  await useAccount('work')
  assert.equal((await describeAccount('work')).current, true)

  assert.equal(await suggestProfile('work'), 'work-2', 'a taken name gets a number')
  assert.equal(await suggestProfile('alias'), 'alias', 'a free one does not')
})

test('a second account can be made and switched into without leaving the app', async (t) => {
  const testnet = await createTestDht()
  await scratchHome(t)
  t.after(() => testnet.destroy())

  const first = await createAccount({ profile: 'work', nick: 'ada' })

  const app = render(React.createElement(Root, {
    profile: 'work',
    dir: first.dir,
    needsOnboarding: false,
    bootstrap: testnet.bootstrap,
    host: TEST_HOST
  }))
  t.after(() => app.unmount())

  await waitFor(async () => screen(app).includes('INSERT'), {
    message: 'the app to start',
    timeout: 30000
  })
  assert.match(screen(app), /ada@work/, 'the statusline says which account you are in')

  // Open the accounts float and start a new one from it.
  //
  // Each key waits for the app to show that it landed rather than for a fixed
  // number of milliseconds. The test stdin hands Ink one chunk at a time and
  // drops it if a second arrives before Ink has read the first, so a chord
  // typed against the clock is a chord that occasionally loses its first key
  // and hangs here with nothing open.
  await pressUntil(app, ESC, async () => screen(app).includes('NORMAL'), { message: 'normal mode' })

  app.stdin.write(' ')
  await waitFor(async () => screen(app).includes('esc cancel'), { message: 'the key menu' })

  app.stdin.write('a')
  await waitFor(async () => screen(app).includes('each one is its own keypair'), {
    message: 'the accounts float'
  })
  assert.match(screen(app), /work/, 'the account you are in is listed')

  app.stdin.write('n')
  await waitFor(async () => screen(app).includes('New account'), { message: 'the username prompt' })

  app.stdin.write('alias')
  await waitFor(async () => screen(app).includes('alias'), { message: 'the username typed' })
  app.stdin.write('\r')

  await waitFor(async () => screen(app).includes('Display name'), { message: 'the name prompt' })
  app.stdin.write('nobody')
  await waitFor(async () => screen(app).includes('nobody'), { message: 'the display name typed' })
  app.stdin.write('\r')

  // A new key means a new recovery phrase, and it has to be acknowledged.
  await waitFor(async () => screen(app).includes('Write down your recovery phrase'), {
    message: 'the phrase for the new account',
    timeout: 20000
  })

  await pressUntil(app, 'y', async () => screen(app).includes('press enter to open openchat'), {
    message: 'the phrase to be acknowledged'
  })
  await pressUntil(app, '\r', async () => screen(app).includes('nobody@alias'), {
    message: 'the new account to open',
    timeout: 30000
  })

  const alias = await loadIdentity({ dir: profileDir('alias') })
  assert.notEqual(alias.publicKeyHex, first.publicKey, 'it really is a different identity')
  assert.equal((await readConfig(profileDir('alias'))).nick, 'nobody')
})
