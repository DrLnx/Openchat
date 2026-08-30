# openchat

Serverless, end-to-end encrypted group chat that lives in your terminal.

There is no server to run, sign up for, or trust. Members find each other on a
distributed hash table, hole-punch a direct connection, and replicate an
encrypted append-only log between themselves. Built on the Holepunch stack —
[Hyperswarm](https://github.com/holepunchto/hyperswarm) for discovery,
[Hypercore](https://github.com/holepunchto/hypercore) and
[Autobase](https://github.com/holepunchto/autobase) for the log,
[Hyperblobs](https://github.com/holepunchto/hyperblobs) for attachments, and
[Ink](https://github.com/vadimdemedes/ink) for the interface.

**[Try it in a browser →](https://claude.ai/code/artifact/dd5e2dee-e631-4e35-80a2-86c671dacf9c)**
— a live harness that runs the real protocol, encryption and UI logic without
needing an install. See [The browser harness](#the-browser-harness) for what it
does and does not simulate.

## Requirements

Node.js 22 or newer.

## Install

```bash
npm install
npm run build
```

Optionally put it on your `PATH`:

```bash
npm install -g .
```

The examples below use `node bin/openchat.js`; substitute `openchat` if you
installed globally.

## Chatting with someone

On your machine, create a room:

```bash
node bin/openchat.js room create design-team
```

That prints an invite string:

```
openchat1:AUEp_UIOShE7g9tC3Do9ZA6sVeZvkFax14hJac-BtIfmylZyEejGUuW8v94FHo0-...
```

Send it to the other person **out of band** — a call, a QR code, a channel you
already trust. Anyone holding that string is a member of the room. On their
machine:

```bash
node bin/openchat.js room join openchat1:AUEp_UIOSh...
```

Then either of you runs `openchat` to open the chat UI:

```bash
node bin/openchat.js
```

You must be online while someone joins. Admitting a new member is something an
existing member does, so a room whose members are all offline cannot accept
anyone — see [Known limitations](#known-limitations).

## Commands

```
openchat                          launch the chat UI (resumes your rooms)
openchat room create <name>       create a room and print its invite
openchat room join <invite>       join a room from an invite string
openchat rooms                    list rooms you have joined
openchat whoami                   show your identity and public key
openchat backup                   print the recovery phrase for your identity
openchat restore <phrase…>        restore an identity from a recovery phrase
```

Inside the UI:

```
/join <invite>  join a room from an invite string
/invite         print an invite for the current room
/nick <name>    set your display name
/file <path>    send a file to the room
/download <id>  fetch an attachment you skipped
/rooms          list the rooms you have joined
/members        list the members of this room
/help           show this list
/quit           leave and exit
```

Tab completes commands. Ctrl+C quits.

## Security model

**The discovery topic and the encryption key are separate, and only one of them
is public.** This split is the whole design, so it is worth being precise about:

- The **topic** is `sha256("openchat:topic:v1" || roomKey)`. It is announced to
  the DHT, which means anyone can look it up, find the swarm, and open a
  connection to your room. That is expected and fine.
- The **encryption key** is 32 random bytes generated when the room is created.
  It encrypts every Hypercore in the room and every message envelope. It is
  never announced, never derived from anything public, and never sent over the
  network.

A stranger who discovers your room on the DHT can connect and will read nothing.
There is a test for exactly this
(`test/integration/room.test.js` — "a peer without the encryption key cannot
read the room").

**An invite carries both.** That is what makes it work, and what makes it
dangerous: an invite string is not a link, it is the key to the room. Treat it
like a password. Anyone who sees it — in a screenshot, a pasted log, a
group chat you forgot was public — is a member.

**Identity** is an Ed25519 keypair derived from a 32-byte seed stored at
`~/.openchat/identity.json` with `0600` permissions. Only the seed is saved; the
keypair is re-derived on load, which is why `openchat backup` can hand you a
BIP39 phrase that restores the same identity elsewhere. That phrase is
equivalent to your identity — anyone with it can post as you.

**Every message is signed and encrypted.** The envelope
(`src/protocol/envelope.js`) is:

```
magic(3) | version(1) | author(32) | iv(12) | len(4) | ciphertext(len) | signature(64)
```

AES-256-GCM for the body, Ed25519 over the header and ciphertext. Signing the
ciphertext rather than the plaintext lets a receiver throw out a forged frame
before spending anything decrypting it. On the way in, the signature is checked
*and* the decrypted message's author field is checked against the key that
signed it, so a member cannot post under someone else's name.

The author's public key is deliberately in the clear. Room membership is
already known to everyone holding the invite, and it is what makes
verify-before-decrypt possible — but it does mean someone observing the
transport sees which keys are talking, without learning what they said.

## Known limitations

This is an MVP, and these are deliberate:

- **Anyone with the invite becomes a writer.** There is no admin approval. A
  leaked invite is a leaked room, and there is currently no way to remove
  someone. Admin-gated membership is the next security milestone.
- **Someone must be online to admit a newcomer.** Joining requires an existing
  writer to receive the join request and append it. If every member is offline,
  a new member waits.
- **No forward secrecy.** One long-lived room key encrypts everything. Someone
  who obtains it can read the room's whole history.
- **`Room._refresh()` re-reads the entire message range** on every update and
  dedupes by id. That is fine for a room with a few thousand messages and is
  the first thing to make incremental if a room outgrows it.
- **Public DHT connectivity has not been exercised in CI.** The test suite runs
  against a local DHT testnet. Real internet peer discovery and NAT traversal
  should be verified on real machines before trusting it.

## Architecture

Source is split into three tiers, and the split is enforced by a test rather
than by convention:

| Tier | Location | Contents |
| --- | --- | --- |
| **Shared** | `src/protocol/`, `src/ui/model/` | Message schema and codecs, the encrypted envelope, causal ordering, invite encode/decode, slash-command parsing, the chat state reducer. No Node built-ins, no native modules. |
| **CLI only** | `src/core/`, `src/ui/ink/` | Corestore, Hypercore, Autobase, Hyperswarm, Hyperblobs, sodium-native, and the Ink components. |
| **Browser only** | `web/` | A BroadcastChannel transport, simulated members, and a DOM renderer reading the same view-model as the Ink components. |

Two tests hold this together:

- `test/unit/portability.test.js` fails if anything in the shared tier imports a
  Node built-in or a package that cannot run in a browser.
- `test/unit/vectors.test.js` runs both crypto backends — sodium + `node:crypto`
  on one side, WebCrypto + `@noble` on the other — and asserts they produce
  byte-identical frames and can each decrypt what the other sealed.

A few notes on how it fits together:

- A room is an Autobase of per-member writer cores, linearized into a Hyperbee
  of sealed envelopes (`src/core/room.js`).
- Membership needs a **pairing handshake** (`src/core/pairing.js`). Corestore
  replicates cores *by key*, so an existing member has no way to discover a
  newcomer's writer core — it has never seen it, so it never requests it, so a
  join request appended optimistically is invisible to everyone else. Instead a
  joiner broadcasts a signed JOIN block over a Protomux channel multiplexed onto
  the same connection Corestore replicates over, and any writer verifies and
  appends it.
- Display order is one shared rule (`src/protocol/order.js`): Lamport clock,
  then wall clock, then author key, then id. Both front ends run every message
  set through it, so two members cannot see different transcripts.
- Attachments are metadata in the log plus bytes in a Hyperblobs core
  (`src/core/blobs.js`). Files under 5MB are fetched automatically; larger ones
  wait for `/download`. The sender's sha256 is verified after every fetch, and
  incoming filenames are sanitised before they touch the download directory.

## The browser harness

`web/` builds to a single self-contained HTML page that runs openchat in a
browser. It is a test harness, not a second client, and the distinction is
worth stating plainly:

**Real, running unmodified:** the binary message codecs, the AES-256-GCM
envelope and Ed25519 signatures, invite encode/decode, causal ordering, the
slash-command parser, the chat view-model, and chunked checksum-verified
attachments. The simulated members hold their own Ed25519 keys and seal their
own envelopes, so the receive path being exercised is the production one.

**Standing in:** peer discovery. Hyperswarm's DHT needs UDP and `sodium-native`
is a C addon, so neither can run in a browser. A `BroadcastChannel` carries
frames between tabs instead, and Autobase replication is replaced by re-sending
history on request.

```bash
npm run record       # record real CLI frames from two peers on a local DHT
npm run build:web    # bundle the harness into web/openchat-demo.html
node scripts/check-web.js --shot demo.png   # drive it in Chromium
```

## Testing

```bash
npm test
```

Unit tests cover the codecs, invites, ordering determinism under shuffled input,
the crypto vectors, and the portability lint. Integration tests run two or three
real clients against a local `hyperdht` testnet and cover two-peer chat,
join-by-invite, an offline member replaying what it missed, the encryption
boundary, attachment transfer, and the Ink UI rendered against live peers.

The tests pin the DHT to `127.0.0.1`. Sandboxed containers often have an
outward interface with an address the host cannot reach itself on, and hyperdht
will announce it and then fail to connect; binding to loopback keeps the local
testnet self-consistent.

## License

MIT
