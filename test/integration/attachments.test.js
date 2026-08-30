// Attachments end to end: a file written into one member's blob core, fetched
// out of it by another over the swarm, byte-for-byte.

import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomBytes, createHash } from 'node:crypto'

import { createRoom, openRoom } from '../../src/core/room.js'
import { Blobs, mimeFor } from '../../src/core/blobs.js'
import { decodeInvite } from '../../src/protocol/invite.js'
import { createPeer, createTestDht, waitForMessage } from '../helpers.js'

test('a file sent by one member is fetched intact by another', async (t) => {
  const testnet = await createTestDht()
  const alice = await createPeer({ bootstrap: testnet.bootstrap, nick: 'alice' })
  const bob = await createPeer({ bootstrap: testnet.bootstrap, nick: 'bob' })

  t.after(async () => {
    await alice.destroy()
    await bob.destroy()
    await testnet.destroy()
  })

  const hosted = await createRoom({ store: alice.store, identity: alice.identity, name: 'files' })
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

  // Big enough to span several blobs blocks, so this exercises chunking rather
  // than a single-block happy path.
  const payload = randomBytes(512 * 1024)
  const source = path.join(await mkdtemp(path.join(tmpdir(), 'openchat-file-')), 'report.pdf')
  await writeFile(source, payload)

  const aliceBlobs = new Blobs({
    store: hosted.store,
    encryptionKey: hosted.encryptionKey,
    downloadDir: await mkdtemp(path.join(tmpdir(), 'openchat-dl-a-'))
  })
  const bobBlobs = new Blobs({
    store: guest.store,
    encryptionKey: guest.encryptionKey,
    downloadDir: await mkdtemp(path.join(tmpdir(), 'openchat-dl-b-'))
  })
  t.after(async () => {
    await aliceBlobs.close()
    await bobBlobs.close()
  })

  const meta = await aliceBlobs.put(source)
  assert.equal(meta.name, 'report.pdf')
  assert.equal(meta.mime, 'application/pdf')
  assert.equal(meta.size, payload.byteLength)
  assert.equal(meta.sha256, createHash('sha256').update(payload).digest('hex'))

  await hosted.sendFile(meta)

  const received = await waitForMessage(guest, (m) => m.type === 'file')
  assert.equal(received.name, 'report.pdf')
  assert.equal(received.sha256, meta.sha256)

  const progress = []
  bobBlobs.on('progress', (p) => progress.push(p.progress))

  const result = await bobBlobs.get(received)
  assert.ok(result.verified, 'checksum matched what alice sent')
  assert.deepEqual(await readFile(result.path), payload, 'bytes are identical')

  assert.ok(progress.length > 1, 'progress was reported as chunks arrived')
  assert.ok(progress.at(-1) >= 0.99, `progress finished at ${progress.at(-1)}`)

  await hosted.close()
  await guest.close()
})

test('a corrupted attachment is reported rather than silently accepted', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'openchat-corrupt-'))
  const testnet = await createTestDht()
  const alice = await createPeer({ bootstrap: testnet.bootstrap, nick: 'alice' })

  t.after(async () => {
    await alice.destroy()
    await testnet.destroy()
  })

  const room = await createRoom({ store: alice.store, identity: alice.identity, name: 'files' })
  const blobs = new Blobs({ store: room.store, encryptionKey: room.encryptionKey, downloadDir: dir })
  t.after(async () => {
    await blobs.close()
    await room.close()
  })

  const source = path.join(dir, 'notes.txt')
  await writeFile(source, 'the real contents')
  const meta = await blobs.put(source)

  // Claim a hash that does not match the bytes — what a malicious or buggy
  // sender would produce.
  const result = await blobs.get({ ...meta, id: 'x', sha256: 'ab'.repeat(32) })
  assert.equal(result.verified, false, 'mismatch must be surfaced')
})

test('mime types are guessed from the extension', () => {
  assert.equal(mimeFor('a.png'), 'image/png')
  assert.equal(mimeFor('a.PNG'), 'image/png')
  assert.equal(mimeFor('README.md'), 'text/markdown')
  assert.equal(mimeFor('mystery.xyz'), 'application/octet-stream')
})
