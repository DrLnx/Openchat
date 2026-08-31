// Several accounts on one machine — one per terminal, which is the case that
// motivated this: two clients on the same box, same IP, talking to each other.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  profileDir, listProfiles, currentProfile, setCurrentProfile,
  sanitizeProfile, rootDir, DEFAULT_PROFILE
} from '../../src/core/store.js'
import { Client } from '../../src/core/client.js'
import { loadIdentity } from '../../src/core/identity.js'
import { createTestDht, TEST_HOST, waitForMessage, waitFor } from '../helpers.js'

/** OPENCHAT_DIR pins a single profile, so profile tests need it out of the way. */
async function withHome (t) {
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

test('profile names cannot escape the profiles directory', () => {
  assert.equal(sanitizeProfile('../../etc'), '..-..-etc')
  assert.equal(sanitizeProfile('..'), DEFAULT_PROFILE)
  assert.equal(sanitizeProfile(''), DEFAULT_PROFILE)
  assert.equal(sanitizeProfile('Work Laptop'), 'work-laptop')
  assert.equal(sanitizeProfile('a/b'), 'a-b')

  // Whatever the input, the result stays inside the profiles directory.
  for (const evil of ['../../..', '/etc/passwd', '..\\..\\win']) {
    const dir = path.resolve(profileDir(sanitizeProfile(evil)))
    assert.ok(
      dir.startsWith(path.resolve(rootDir(), 'profiles') + path.sep),
      `${evil} escaped to ${dir}`
    )
  }
})

test('two profiles on one machine are separate accounts', async (t) => {
  await withHome(t)

  const work = new Client({ profile: 'work' })
  const personal = new Client({ profile: 'personal' })
  await work.ready()
  await personal.ready()

  t.after(async () => {
    await work.close()
    await personal.close()
  })

  assert.notEqual(work.identity.publicKeyHex, personal.identity.publicKeyHex, 'different keys')
  assert.notEqual(work.dir, personal.dir, 'different directories')

  assert.deepEqual((await listProfiles()).sort(), ['personal', 'work'])

  // A room in one profile is invisible to the other.
  await work.createRoom('standup')
  assert.equal(work.roomList.length, 1)
  assert.equal(personal.roomList.length, 0)

  // Identities survive a reload of the same profile.
  const again = await loadIdentity({ dir: profileDir('work') })
  assert.equal(again.publicKeyHex, work.identity.publicKeyHex)
})

test('the current profile is remembered between commands', async (t) => {
  await withHome(t)

  assert.equal(await currentProfile(), DEFAULT_PROFILE)
  await setCurrentProfile('work')
  assert.equal(await currentProfile(), 'work')

  // The environment variable wins, so one terminal can differ from the rest.
  process.env.OPENCHAT_PROFILE = 'personal'
  assert.equal(await currentProfile(), 'personal')
  delete process.env.OPENCHAT_PROFILE

  assert.equal(await currentProfile(), 'work')
})

test('two profiles on one machine can DM each other', async (t) => {
  await withHome(t)
  const testnet = await createTestDht()

  const one = new Client({ profile: 'one', bootstrap: testnet.bootstrap, host: TEST_HOST })
  const two = new Client({ profile: 'two', bootstrap: testnet.bootstrap, host: TEST_HOST })
  await one.ready()
  await two.ready()

  t.after(async () => {
    await one.close()
    await two.close()
    await testnet.destroy()
  })

  // All each side has is the other's public key — exactly what you would read
  // off `openchat whoami` in the other terminal.
  const a = await one.openDm(two.identity.publicKeyHex)
  const b = await two.openDm(one.identity.publicKeyHex)

  await one.sendText('hello from the other terminal')
  const seen = await waitForMessage(b, (m) => m.body === 'hello from the other terminal')
  assert.equal(seen.author, one.identity.publicKeyHex)

  await two.sendText('got it')
  await waitForMessage(a, (m) => m.body === 'got it')

  await waitFor(async () => a.messages.length === b.messages.length, {
    message: 'both sides to converge'
  })
})
