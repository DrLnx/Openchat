// Direct messages end to end. The property under test is that two people who
// have only ever seen each other's *public key* end up in the same encrypted
// conversation — no invite, no shared secret transmitted, nothing negotiated by
// hand.

import test from 'node:test'
import assert from 'node:assert/strict'
import b4a from 'b4a'

import { DirectChannel, deriveChannel, sharedSecret } from '../../src/core/dm.js'
import { createPeer, createTestDht, waitForMessage, waitFor } from '../helpers.js'

test('both sides derive the same channel from opposite directions', async (t) => {
  const testnet = await createTestDht()
  const alice = await createPeer({ bootstrap: testnet.bootstrap, nick: 'alice' })
  const bob = await createPeer({ bootstrap: testnet.bootstrap, nick: 'bob' })

  t.after(async () => {
    await alice.destroy()
    await bob.destroy()
    await testnet.destroy()
  })

  // Alice knows only bob's public key, and bob only alice's.
  const fromAlice = deriveChannel(alice.identity.seed, alice.identity.publicKey, bob.identity.publicKey)
  const fromBob = deriveChannel(bob.identity.seed, bob.identity.publicKey, alice.identity.publicKey)

  assert.equal(b4a.toString(fromAlice.topic, 'hex'), b4a.toString(fromBob.topic, 'hex'), 'same topic')
  assert.equal(
    b4a.toString(fromAlice.encryptionKey, 'hex'),
    b4a.toString(fromBob.encryptionKey, 'hex'),
    'same encryption key'
  )
  assert.notEqual(
    b4a.toString(fromAlice.topic, 'hex'),
    b4a.toString(fromAlice.encryptionKey, 'hex'),
    'the topic must not be the key'
  )
})

test('a third party cannot derive the channel', async (t) => {
  const testnet = await createTestDht()
  const alice = await createPeer({ bootstrap: testnet.bootstrap })
  const bob = await createPeer({ bootstrap: testnet.bootstrap })
  const mallory = await createPeer({ bootstrap: testnet.bootstrap })

  t.after(async () => {
    await alice.destroy()
    await bob.destroy()
    await mallory.destroy()
    await testnet.destroy()
  })

  const real = deriveChannel(alice.identity.seed, alice.identity.publicKey, bob.identity.publicKey)

  // Mallory knows both public keys — they are public — but has neither secret.
  const guess = deriveChannel(mallory.identity.seed, mallory.identity.publicKey, bob.identity.publicKey)

  assert.notEqual(b4a.toString(guess.topic, 'hex'), b4a.toString(real.topic, 'hex'))
  assert.notEqual(b4a.toString(guess.encryptionKey, 'hex'), b4a.toString(real.encryptionKey, 'hex'))

  // Knowing both public keys is not enough to reconstruct the shared secret.
  const secret = sharedSecret(alice.identity.seed, bob.identity.publicKey)
  assert.notEqual(
    b4a.toString(secret, 'hex'),
    b4a.toString(sharedSecret(mallory.identity.seed, bob.identity.publicKey), 'hex')
  )
})

test('two people exchange direct messages with no invite', async (t) => {
  const testnet = await createTestDht()
  const alice = await createPeer({ bootstrap: testnet.bootstrap, nick: 'alice' })
  const bob = await createPeer({ bootstrap: testnet.bootstrap, nick: 'bob' })

  t.after(async () => {
    await alice.destroy()
    await bob.destroy()
    await testnet.destroy()
  })

  const aliceSide = new DirectChannel({
    store: alice.store,
    identity: alice.identity,
    peerKey: bob.identity.publicKeyHex
  })
  const bobSide = new DirectChannel({
    store: bob.store,
    identity: bob.identity,
    peerKey: alice.identity.publicKeyHex
  })

  await aliceSide.ready()
  await bobSide.ready()
  t.after(async () => {
    await aliceSide.close()
    await bobSide.close()
  })

  await aliceSide.attachSwarm(alice.swarm)
  await bobSide.attachSwarm(bob.swarm)

  await aliceSide.sendText('hey bob — no invite required')
  const seenByBob = await waitForMessage(bobSide, (m) => m.body === 'hey bob — no invite required')
  assert.equal(seenByBob.author, alice.identity.publicKeyHex)

  await bobSide.sendText('and it just works')
  await waitForMessage(aliceSide, (m) => m.body === 'and it just works')

  // Both sides converge on one transcript, ordered by the shared rule.
  await waitFor(async () => aliceSide.messages.length === bobSide.messages.length, {
    message: 'transcripts to converge'
  })
  assert.deepEqual(
    aliceSide.messages.map((m) => m.body),
    bobSide.messages.map((m) => m.body)
  )
})

test('a message written while the other side is offline lands when they return', async (t) => {
  const testnet = await createTestDht()
  const alice = await createPeer({ bootstrap: testnet.bootstrap, nick: 'alice' })
  const bob = await createPeer({ bootstrap: testnet.bootstrap, nick: 'bob' })

  t.after(async () => {
    await alice.destroy()
    await bob.destroy()
    await testnet.destroy()
  })

  // Alice writes before bob has ever opened the conversation.
  const aliceSide = new DirectChannel({
    store: alice.store,
    identity: alice.identity,
    peerKey: bob.identity.publicKeyHex
  })
  await aliceSide.ready()
  await aliceSide.attachSwarm(alice.swarm)
  await aliceSide.sendText('sent before you were ever here')

  const bobSide = new DirectChannel({
    store: bob.store,
    identity: bob.identity,
    peerKey: alice.identity.publicKeyHex
  })
  await bobSide.ready()
  await bobSide.attachSwarm(bob.swarm)

  t.after(async () => {
    await aliceSide.close()
    await bobSide.close()
  })

  const seen = await waitForMessage(bobSide, (m) => m.body === 'sent before you were ever here')
  assert.equal(seen.author, alice.identity.publicKeyHex)
})
