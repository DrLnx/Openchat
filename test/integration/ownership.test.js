// Room lifecycle: who owns a room, and what only they can do.
//
// The rule that matters is not the local check before sending a control block —
// it is that every *other* member independently refuses to honour one that did
// not come from the current owner. These tests come at it from that side.

import test from 'node:test'
import assert from 'node:assert/strict'

import { createRoom, openRoom } from '../../src/core/room.js'
import { decodeInvite } from '../../src/protocol/invite.js'
import { createPeer, createTestDht, waitForMessage, waitFor, sleep } from '../helpers.js'

async function pair (t) {
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

  const invite = decodeInvite(hosted.invite)
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

  t.after(async () => {
    await hosted.close().catch(() => {})
    await guest.close().catch(() => {})
  })

  return { alice, bob, hosted, guest }
}

test('the creator owns the room, and everyone agrees who that is', async (t) => {
  const { alice, hosted, guest } = await pair(t)

  assert.equal(hosted.owner, alice.identity.publicKeyHex)
  assert.ok(hosted.isOwner, 'alice sees herself as owner')

  await waitFor(async () => guest.owner === alice.identity.publicKeyHex, {
    message: 'bob to learn who owns the room'
  })
  assert.ok(!guest.isOwner, 'bob does not think he owns it')
})

test('a member cannot close a room they do not own', async (t) => {
  const { guest, hosted } = await pair(t)

  await assert.rejects(() => guest.control('close'), /only the room's owner/)
  assert.ok(!hosted.isClosed, 'the room is untouched')
})

test('closing a room stops new members joining but not existing ones talking', async (t) => {
  const testnet = await createTestDht()
  const alice = await createPeer({ bootstrap: testnet.bootstrap, nick: 'alice' })
  const bob = await createPeer({ bootstrap: testnet.bootstrap, nick: 'bob' })
  const carol = await createPeer({ bootstrap: testnet.bootstrap, nick: 'carol' })

  t.after(async () => {
    await alice.destroy()
    await bob.destroy()
    await carol.destroy()
    await testnet.destroy()
  })

  const hosted = await createRoom({ store: alice.store, identity: alice.identity, name: 'design' })
  await hosted.attachSwarm(alice.swarm)
  const invite = decodeInvite(hosted.invite)

  const openArgs = (peer) => ({
    store: peer.store,
    identity: peer.identity,
    roomKey: invite.roomKey,
    encryptionKey: invite.encryptionKey,
    name: invite.name
  })

  // Bob gets in before the doors shut.
  const guest = await openRoom(openArgs(bob))
  await guest.attachSwarm(bob.swarm)
  await guest.requestJoin()
  await guest.waitForWritable()

  await hosted.control('close')
  assert.ok(hosted.isClosed)

  // Bob keeps talking.
  await guest.sendText('still here')
  await waitForMessage(hosted, (m) => m.body === 'still here')

  // Carol has a perfectly valid invite and still cannot get in.
  const latecomer = await openRoom(openArgs(carol))
  await latecomer.attachSwarm(carol.swarm)
  await latecomer.requestJoin()

  await assert.rejects(
    () => latecomer.waitForWritable(6000),
    /timed out/,
    'a closed room must not admit anyone'
  )
  assert.ok(!hosted.members.includes(carol.identity.publicKeyHex))

  // Reopening lets her in.
  await hosted.control('reopen')
  await latecomer.requestJoin()
  await latecomer.waitForWritable(20000)
  assert.ok(latecomer.writable, 'carol got in after the room reopened')

  await latecomer.close()
  await guest.close()
  await hosted.close()
})

test('ownership can be handed over, and the old owner loses control', async (t) => {
  const { alice, bob, hosted, guest } = await pair(t)

  await hosted.control('transfer', bob.identity.publicKeyHex)

  await waitFor(async () => guest.isOwner, { message: 'bob to become owner' })
  assert.equal(guest.owner, bob.identity.publicKeyHex)

  await waitFor(async () => hosted.owner === bob.identity.publicKeyHex, {
    message: 'alice to see the handover'
  })
  assert.ok(!hosted.isOwner, 'alice is no longer the owner')
  await assert.rejects(() => hosted.control('close'), /only the room's owner/)

  // And the new owner really can act.
  await guest.control('close')
  await waitFor(async () => hosted.isClosed, { message: "alice to see bob's close" })
  assert.ok(alice.identity.publicKeyHex !== guest.owner)
})

test('a removed member cannot post any more', async (t) => {
  const { bob, hosted, guest } = await pair(t)

  await guest.sendText('before the removal')
  await waitForMessage(hosted, (m) => m.body === 'before the removal')

  await hosted.control('remove', bob.identity.publicKeyHex)

  await waitFor(async () => !hosted.members.includes(bob.identity.publicKeyHex), {
    message: 'bob to disappear from the member list'
  })

  // Bob's client notices too, and stops him writing into a room he has left.
  await waitFor(async () => !guest.members.includes(bob.identity.publicKeyHex), {
    message: 'bob to see his own removal'
  })
  await assert.rejects(() => guest.sendText('let me back in'), /removed from this room/)

  // The history he wrote while a member is still there — removal is not erasure.
  assert.ok(hosted.messages.some((m) => m.body === 'before the removal'))
})

test('a removed member cannot simply rejoin with the invite they still hold', async (t) => {
  const { bob, hosted, guest } = await pair(t)

  await hosted.control('remove', bob.identity.publicKeyHex)
  await waitFor(async () => !hosted.members.includes(bob.identity.publicKeyHex), {
    message: 'the removal to apply'
  })

  // Bob still has a perfectly valid invite and a signed join block. Removal is
  // worth nothing if asking again puts him straight back in.
  await guest.requestJoin()
  await sleep(6000)

  assert.ok(
    !hosted.members.includes(bob.identity.publicKeyHex),
    'a removed member rejoined — removal must outlive the act of removing'
  )
  assert.ok(hosted.removedMembers.includes(bob.identity.publicKeyHex), 'the ban is recorded')

  // The owner can change their mind.
  await hosted.control('allow', bob.identity.publicKeyHex)
  await waitFor(async () => !hosted.removedMembers.includes(bob.identity.publicKeyHex), {
    message: 'the ban to lift'
  })

  await guest.requestJoin()
  await waitFor(async () => hosted.members.includes(bob.identity.publicKeyHex), {
    message: 'bob to be readmitted after /allow',
    timeout: 30000
  })
})
