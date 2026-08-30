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

export function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const hex = (buf) => b4a.toString(buf, 'hex')
