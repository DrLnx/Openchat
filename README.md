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

## Install

> **v0.1.0 has not been published to npm, the AUR or Homebrew yet.** The
> commands below are what they will be; until the first release is tagged, use
> [From source](#from-source), which works today. Release steps are in
> [RELEASING.md](RELEASING.md).

Everything needs **Node.js 22 or newer** and nothing else. There is no server to
run and no account to create.

### npm — any platform

```bash
npm install -g openchat
```

### Arch, Manjaro, EndeavourOS

```bash
yay -S openchat        # or: paru -S openchat
```

<details>
<summary>Building the package by hand</summary>

```bash
git clone https://aur.archlinux.org/openchat.git
cd openchat && makepkg -si
```

The `PKGBUILD` lives in [`packaging/PKGBUILD`](packaging/PKGBUILD).
</details>

### macOS and Linux — Homebrew

```bash
brew install n3xtpy/openchat/openchat
```

### One line

```bash
curl -fsSL https://raw.githubusercontent.com/n3xtpy/Openchat/main/install.sh | sh
```

That script checks your Node version and runs the npm install above — nothing
else. Piping a script from the internet into a shell is a habit worth being
suspicious of, especially from a security tool, so
[read it first](install.sh); it is short on purpose.

### From source

```bash
git clone https://github.com/n3xtpy/Openchat.git
cd Openchat
npm install
npm run build
npm link          # optional: puts `openchat` on your PATH
```

Without `npm link`, run it as `node bin/openchat.js` wherever the docs below say
`openchat`.

## First run

```bash
openchat
```

That walks you through setting up an account — which here means generating a
keypair, not signing up for anything — and shows a recovery phrase. Write it
down: it is the only way back to your identity, and no server can reissue it.

Then, to talk to someone:

```bash
openchat room create design-team     # prints an invite string
```

Send that invite **out of band** — a call, a QR code, a channel you already
trust. Anyone holding it is a member. On their machine:

```bash
openchat room join openchat1:AUEp_UIOSh...
openchat                             # open the app
```

One of you has to be online while the other joins: admitting a member is
something an existing member does, and there is no server to do it for you.

## Two accounts, two terminals

Profiles are separate accounts on one machine — different keys, different
storage, different rooms, different contacts. One per terminal works well.

```bash
# terminal one
openchat --profile work

# terminal two
openchat --profile personal
```

Run `openchat whoami --profile work` to get its public key, then `/dm <key>` in
the other terminal. No invite is involved; see [Direct
messages](#direct-messages).

```bash
openchat profiles                 # list the accounts on this machine
openchat login personal           # change which one is the default
openchat logout                   # back to the default profile
```

`OPENCHAT_PROFILE` does the same job as `--profile`, so a terminal can be pinned
to an account by exporting it once. Nothing is shared between profiles, and
`logout` only changes which one is current — it deletes nothing.

## Trying it without a second machine

```bash
npm install && npm run demo
```

That runs a guided tour on one machine with no network: two real profiles, two
real clients, the real Ink UI, and a local DHT. It opens a room, joins it from
the second account, sends a DM derived from nothing but a public key, switches
between conversations, closes the room and watches a valid invite get refused,
transfers ownership, and sends a file. Every frame it prints came out of the
actual app.

`npm test` runs the same machinery as assertions — 50 tests, no network needed.

## Finding people

There is no global user directory, because there is no server to hold one. You
reach someone because you have their **public key**, and there are three ways to
get it:

- **A room you share.** `/members` lists everyone's key, and you can DM any of
  them. In practice this is how most conversations start.
- **A contact you saved.** `/add <key> <name>`, then `/dm <name>` from then on.
- **A key they gave you.** `openchat whoami` prints yours; hand it over however
  you like.

Nobody can enumerate users, and nobody can cold-message you without your key.

## Direct messages

A DM needs no invite at all. Both identities are Ed25519 keys, which convert to
X25519, so each side runs Diffie-Hellman against the other's *public* key and
independently derives the same secret. Nothing is transmitted and nothing is
negotiated:

```bash
node bin/openchat.js dm 03d35f4c5d0f36a0…    # or a contact name
```

From that shared secret openchat derives the discovery topic *and* the
encryption key. Deriving the topic from a secret is the interesting part: a
third party watching the DHT cannot compute it, so they cannot tell the
conversation exists, let alone read it. Contrast a room, whose topic is public
by design.

Structurally a DM is not an Autobase. With two participants there is nothing to
linearize across an unknown writer set — each side appends to its own outbox
core, both read both, and `protocol/order.js` merges them. Same ordering rule as
rooms, so both people always see the same conversation.

## Rooms you own

The person who opens a room owns it. Ownership is established by the log itself:
the creator's own membership record is the first one written, so it needs no
separate ceremony, and every member independently agrees who the owner is.

```
/close              stop new members joining (existing ones keep talking)
/reopen             let the invite work again
/transfer <who>     hand the room over — you lose control immediately
/remove <who>       remove a member; their history stays
/allow <who>        undo a removal
```

Removal is recorded in the room's log, not just acted on once. That matters
because a removed member still holds the invite: without the record they would
simply ask to join again and any honest client would relay them back in.

Only the owner can do these, and that is checked by *every* member's client when
applying the block, not just by the owner's. One honest caveat: `/close` is
enforced by members' clients refusing to relay a newcomer's join. A member who
modified their client could still let someone in, exactly as they could hand out
the invite again. It is not a cryptographic seal.

## Commands

```
openchat                          launch the chat UI (resumes your conversations)
openchat room create <name>       create a room and print its invite
openchat room join <invite>       join a room from an invite string
openchat rooms                    list rooms you have joined
openchat dm <key|contact>         open a direct conversation
openchat contacts [add|remove]    manage saved contacts
openchat whoami                   show your identity and public key
openchat profiles                 list the accounts on this machine
openchat login [name]             switch profile
openchat logout                   switch back to the default profile
openchat backup                   print the recovery phrase for your identity
openchat restore <phrase…>        restore an identity from a recovery phrase

  --profile <name>                act as another account for one command
```

Inside the UI:

```
/dm <key|name>      message someone directly — no invite needed
/join <invite>      join a room from an invite string
/new <name>         open a new room you own
/switch <name>      jump to another room or conversation
/invite             print an invite for the current room
/nick <name>        set your display name
/file <path>        send a file
/download <id>      fetch an attachment you skipped
/rooms              list everything you have open
/members            list the members of this room
/contacts           list the people you have saved
/add <key> [name]   save someone as a contact
/whoami             show your public key, so others can reach you
/close /reopen      open or close this room to new members (owner only)
/transfer <who>     hand the room to someone else (owner only)
/remove <who>       remove a member and keep them out (owner only)
/allow <who>        let a removed member back in (owner only)
/help               show this list
/quit               leave and exit
```

Several rooms and DMs stay open at once. **Shift+Tab** moves between them,
`/switch <name>` jumps directly, and the status line shows how many messages are
waiting elsewhere. (Shift+Tab rather than Ctrl+N because the text input consumes
every control chord except Ctrl+C — Ctrl+N would switch *and* type an "n".)

Typing `/` opens a command menu that filters as you type; arrow keys move, Tab or
Enter takes the highlighted command. Ctrl+C quits.

The interface follows Claude Code rather than a full-screen terminal app. The
transcript is written into your shell's own scrollback via Ink's `<Static>` and
never repainted, so scrolling, selection and copy/paste keep working and a long
room costs nothing to redraw. Only the prompt is live:

```
╭─────────────────────────────────────────────────────────╮
│ ✻ Welcome to openchat                                   │
│                                                         │
│   end-to-end encrypted · no server · /help for commands │
│                                                         │
│   room: #design                                         │
│   you:  ada (51400cd3)                                  │
╰─────────────────────────────────────────────────────────╯

  ⎿  bob joined
20:06 ⏺ bob  got the invite — this is over the DHT, no server anywhere
20:06 > that is the idea. offline members catch up on reconnect.
╭──────────────────────────────────────────────────────────────────────╮
│ > /me                                                                │
╰──────────────────────────────────────────────────────────────────────╯
  ❯ /members          list the members of this room
  #design · ● 1 peer · ada         /help for commands · ctrl+c to quit
```

Your own messages echo behind a caret, anything that arrives is introduced by a
dot in the sender's colour, and detail belonging to the line above — command
output, an attachment's progress — hangs under an elbow.

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
- **No forward secrecy.** One long-lived key encrypts everything in a room or a
  DM. Someone who obtains it can read that conversation's whole history.
- **`/close` is enforced by clients, not by the log.** See [Rooms you
  own](#rooms-you-own). `/remove` *is* enforced by the log.
- **A DM partner can write into their own outbox freely.** That is the point,
  but it means the only spam control in a DM is not giving out your key.
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
