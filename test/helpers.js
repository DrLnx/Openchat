import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import createTestnet from 'hyperdht/testnet.js'
import b4a from 'b4a'

import { openStore } from '../src/core/store.js'
import { loadIdentity } from '../src/core/identity.js'
import { createSwarm } from '../src/core/swarm.js'

// Everything in the tests binds to loopback. Sandboxed CI containers often have
// an outward interface with an address the host cannot reach itself on
// (192.0.2.0/24, say), and hyperdht will happily announce it and then fail to
// connect. Pinning to 127.0.0.1 keeps the local testnet self-consistent.
export const TEST_HOST = '127.0.0.1'

/** Spin up a local DHT the tests can rely on. */
export function createTestDht (size = 3) {
  return createTestnet(size, { host: TEST_HOST })
}

/**
 * A whole openchat install in a temp directory, wired to a local DHT testnet so
 * the tests never touch the public network.
 */
export async function createPeer ({ bootstrap, nick, host = TEST_HOST }) {
  const dir = await mkdtemp(path.join(tmpdir(), 'openchat-test-'))
  const store = await openStore(dir)
  const identity = await loadIdentity({ dir, nick })
  const swarm = await createSwarm({ store, seed: identity.seed, bootstrap, host })

  return {
    dir,
    store,
    identity,
    swarm,
    async destroy () {
      await swarm.destroy()
      await store.close()
      await rm(dir, { recursive: true, force: true })
    }
  }
}

/** Resolve when `room` has a message satisfying `predicate`, else reject. */
export function waitForMessage (room, predicate, timeout = 20000) {
  const existing = room.messages.find(predicate)
  if (existing) return Promise.resolve(existing)

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('timed out waiting for a message'))
    }, timeout)

    const onMessages = (messages) => {
      const hit = messages.find(predicate)
      if (!hit) return
      cleanup()
      resolve(hit)
    }
    const cleanup = () => {
      clearTimeout(timer)
      room.off('messages', onMessages)
    }

    room.on('messages', onMessages)
  })
}

/** Poll a condition — for state that has no event to hang off. */
export async function waitFor (fn, { timeout = 20000, interval = 100, message = 'condition' } = {}) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await fn()) return true
    await sleep(interval)
  }
  throw new Error(`timed out waiting for ${message}`)
}

/**
 * Send an idempotent keystroke until the app shows that it landed.
 *
 * ink-testing-library's stdin holds exactly one chunk and keeps no queue: a
 * write replaces whatever has not been read yet, and a write that lands while
 * Ink is busy is simply gone. Real terminals do not do this — stdin is a
 * stream — so a test that loses a keypress is testing the harness rather than
 * the app.
 *
 * Only for keys that can be sent twice with no second effect: escape, or a
 * mode change. Never for one that advances something.
 */
export async function pressUntil (app, key, predicate, { timeout = 20000, interval = 150, message = 'the key to land' } = {}) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    app.stdin.write(key)
    await sleep(interval)
    if (await predicate()) return true
  }
  throw new Error(`timed out waiting for ${message}`)
}

/**
 * Run a command the way a user does: escape to normal, `:`, type it, enter.
 *
 * Commands are not messages any more — the message box only sends messages —
 * so a test that wants one has to open the command line, which is what this is.
 * Each step waits for the app to show that the last one landed; see pressUntil
 * for why typing against the clock is not reliable here.
 *
 * @param {object} app       from ink-testing-library's render
 * @param {string} line      the command, without the colon
 * @param {(app: object) => string} screen  reads the current frame
 */
export async function runCommand (app, line, screen) {
  await pressUntil(app, ESCAPE, async () => screen(app).includes('NORMAL'), {
    message: 'normal mode'
  })

  app.stdin.write(':')
  await waitFor(async () => screen(app).includes('esc cancel'), { message: 'the command line' })

  app.stdin.write(line)
  await waitFor(async () => screen(app).includes(line.slice(0, 10)), {
    message: `"${line.slice(0, 10)}" to be typed`
  })

  app.stdin.write('\r')
  await waitFor(async () => !screen(app).includes('esc cancel'), {
    message: 'the command line to close'
  })
}

const ESCAPE = String.fromCharCode(27)

export function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const hex = (buf) => b4a.toString(buf, 'hex')
