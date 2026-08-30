// End-to-end over a real Hyperswarm, on a local DHT testnet so nothing leaves
// the machine. This is the test that says the product works: two installs, one
// invite, messages both ways, and a third member back-filling history they were
// never online for.

import test from 'node:test'
import assert from 'node:assert/strict'
import b4a from 'b4a'

import { createRoom, openRoom } from '../../src/core/room.js'
import { decodeInvite } from '../../src/protocol/invite.js'
import { createPeer, createTestDht, waitForMessage, waitFor, sleep } from '../helpers.js'

test('two peers exchange encrypted messages through a room', async (t) => {
  const testnet = await createTestDht()
  const alice = await createPeer({ bootstrap: testnet.bootstrap, nick: 'alice' })
  const bob = await createPeer({ bootstrap: testnet.bootstrap, nick: 'bob' })

  t.after(async () => {
    await alice.destroy()
    await bob.destroy()
    await testnet.destroy()
  })

  const hosted = await createRoom({ store: alice.store, identity: alice.identity, name: 'design' })
  await hosted.attachSwarm(alice.swarm)

  // Bob only ever sees the invite string — everything else is derived from it.
  const invite = decodeInvite(hosted.invite)
  assert.equal(invite.name, 'design')

  const guest = await openRoom({
    store: bob.store,
    identity: bob.identity,
    roomKey: invite.roomKey,
    encryptionKey: invite.encryptionKey,
    name: invite.name
  })
  await guest.attachSwarm(bob.swarm)

  await guest.requestJoin()
  await guest.waitForWritable()
  assert.ok(guest.writable, 'bob was admitted as a writer')

  await hosted.sendText('hello from alice')
  const seenByBob = await waitForMessage(guest, (m) => m.body === 'hello from alice')
  assert.equal(seenByBob.author, alice.identity.publicKeyHex)

  await guest.sendText('hi alice, bob here')
  const seenByAlice = await waitForMessage(hosted, (m) => m.body === 'hi alice, bob here')
  assert.equal(seenByAlice.author, bob.identity.publicKeyHex)

  // Both sides agree on the transcript, which is the whole point of the
  // shared ordering rule.
  await waitFor(async () => hosted.messages.length === guest.messages.length, {
    message: 'transcripts to converge'
  })
  assert.deepEqual(
    hosted.messages.map((m) => m.id),
    guest.messages.map((m) => m.id),
    'both members see the same order'
  )

  await hosted.close()
  await guest.close()
})

test('a member who was offline replays what they missed on reconnect', async (t) => {
  const testnet = await createTestDht()
  const alice = await createPeer({ bootstrap: testnet.bootstrap, nick: 'alice' })
  const bob = await createPeer({ bootstrap: testnet.bootstrap, nick: 'bob' })

  t.after(async () => {
    await alice.destroy()
    await bob.destroy()
    await testnet.destroy()
  })

  const hosted = await createRoom({ store: alice.store, identity: alice.identity, name: 'standup' })
  await hosted.attachSwarm(alice.swarm)

  const invite = decodeInvite(hosted.invite)
  const guestArgs = {
    store: bob.store,
    identity: bob.identity,
    roomKey: invite.roomKey,
    encryptionKey: invite.encryptionKey,
    name: invite.name
  }

  let guest = await openRoom(guestArgs)
  const namespace = guest.namespace
  await guest.attachSwarm(bob.swarm)
  await guest.requestJoin()
  await guest.waitForWritable()

  await hosted.sendText('before the outage')
  await waitForMessage(guest, (m) => m.body === 'before the outage')

  // Bob goes away. His cores stay on disk — that is what makes catch-up work.
  await guest.close()

  await hosted.sendText('while bob was gone: one')
  await hosted.sendText('while bob was gone: two')

  // Bob comes back with the same store and namespace, as the CLI does on restart.
  guest = await openRoom({ ...guestArgs, namespace })
  await guest.attachSwarm(bob.swarm)
  await waitForMessage(guest, (m) => m.body === 'while bob was gone: two')

  const bodies = guest.messages.filter((m) => m.type === 'text').map((m) => m.body)
  assert.deepEqual(bodies, [
    'before the outage',
    'while bob was gone: one',
    'while bob was gone: two'
  ])

  await hosted.close()
  await guest.close()
})

test('a peer without the encryption key cannot read the room', async (t) => {
  const testnet = await createTestDht()
  const alice = await createPeer({ bootstrap: testnet.bootstrap, nick: 'alice' })
  const mallory = await createPeer({ bootstrap: testnet.bootstrap, nick: 'mallory' })

  t.after(async () => {
    await alice.destroy()
    await mallory.destroy()
    await testnet.destroy()
  })

  const hosted = await createRoom({ store: alice.store, identity: alice.identity, name: 'private' })
  await hosted.attachSwarm(alice.swarm)
  await hosted.sendText('the secret is 42')

  // Mallory learns the topic — it is public, that is the design — and connects
  // to the swarm. What she does not have is the encryption key from the invite,
  // so she can hold the connection open and still read nothing.
  const intruder = await openRoom({
    store: mallory.store,
    identity: mallory.identity,
    roomKey: hosted.key,
    encryptionKey: b4a.from('ff'.repeat(32), 'hex'), // guessed, not from an invite
    name: 'private'
  })
  await intruder.attachSwarm(mallory.swarm)

  await waitFor(async () => mallory.swarm.peerCount > 0, { message: 'mallory to connect' })
  await sleep(5000) // give replication every chance to hand her something

  assert.deepEqual(intruder.messages, [], 'mallory decrypted nothing')
  assert.ok(!intruder.writable, 'mallory was not admitted as a writer')
  assert.deepEqual(hosted.members, [alice.identity.publicKeyHex], 'room membership unchanged')

  await intruder.close()
  await hosted.close()
})
