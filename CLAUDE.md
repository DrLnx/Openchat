# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

openchat is a serverless, end-to-end encrypted terminal chat client (rooms + DMs) built on the
Holepunch stack (Hypercore / Autobase / Hyperswarm / Hyperblobs) with an Ink + React TUI.
There is no server component anywhere — peers meet on a DHT and replicate encrypted logs directly.
ESM only, Node >= 22.

## Commands

```bash
npm run build          # esbuild bundle src/cli.js -> dist/cli.js
npm run dev            # same, in watch mode
npm run check          # lint + full test suite (run this before calling work done)
npm run lint           # standard (no semicolons, 2-space); lint:fix to autofix
npm test               # full suite; `pretest` builds first
npm run test:unit      # unit tests only, fast, no network
npm start              # run the app from bin/openchat.js (needs a build)
npm run demo           # guided two-account tour on a local DHT, no network
npm run shot           # screenshots of the real UI into shots/; `npm run shot -- keys` filters
```

Run a single test file (the `--import` hook is what transpiles `.jsx` on the fly, so it is required):

```bash
node --import ./scripts/jsx-register.js --test test/unit/fuzzy.test.js
node --import ./scripts/jsx-register.js --test --test-concurrency=1 test/integration/room.test.js
node --import ./scripts/jsx-register.js --test --test-name-pattern='unread' test/unit/state.test.js
```

Integration tests spin up real clients on a local `hyperdht` testnet pinned to `127.0.0.1`
(see [test/helpers.js](test/helpers.js)) — they need no network but are slow, and the full suite
runs them with `--test-concurrency=1`.

## The three-tier split (enforced, not conventional)

| Tier | Dirs | Rule |
| --- | --- | --- |
| 1 — portable | `src/protocol/`, `src/ui/model/` | No `node:` builtins, no native modules, no imports from `src/core/`. Only `b4a`, `compact-encoding`, `@noble/*` are allowed packages. |
| 2 — runtime | `src/core/`, `src/ui/ink/` | Corestore/Hypercore/Autobase/Hyperswarm/Hyperblobs, `sodium-native`, `node:sqlite`, Ink components. |

[test/unit/portability.test.js](test/unit/portability.test.js) fails the build if tier 1 imports
anything unportable — so putting an `import fs` or a `src/core/` import into `src/protocol/` or
`src/ui/model/` is a test failure, not a style note. It is what keeps the wire format and the
view-model free of the runtime: tier 1 is the part you can read, test and reason about without a
DHT, a swarm or a terminal, and [src/protocol/crypto-web.js](src/protocol/crypto-web.js) — the
second implementation that keeps the envelope honest — lives there because of it.

Two crypto backends implement the same interface: [src/core/crypto-node.js](src/core/crypto-node.js)
(sodium + `node:crypto`) and [src/protocol/crypto-web.js](src/protocol/crypto-web.js)
(WebCrypto + `@noble`). [src/protocol/envelope.js](src/protocol/envelope.js) owns the byte layout;
[test/unit/vectors.test.js](test/unit/vectors.test.js) asserts each backend can decrypt the other's
frames. Changing the frame layout means changing envelope.js only, and the vectors test is the check.

## Architecture invariants

- **One keypress handler.** Only [src/ui/ink/App.jsx](src/ui/ink/App.jsx) reads stdin. A modal UI has
  to decide what a key *means* before anything acts on it, so the message buffer
  ([src/ui/model/editor.js](src/ui/model/editor.js)) is a pure reducer, not a text-input widget.
  Never introduce a component that calls `useInput` or grabs stdin.
- **One ordering rule.** [src/protocol/order.js](src/protocol/order.js) — Lamport clock, wall clock,
  author key, id. Both front ends run every message set through it; nothing else may sort a transcript.
- **One view-model.** [src/ui/model/state.js](src/ui/model/state.js) is a plain reducer over plain
  data. It is where unread counts, member tracking and the transcript live, and it is testable
  without rendering anything.
- **One geometry function.** [src/ui/model/layout.js](src/ui/model/layout.js) computes window and
  sidebar positions from the bottom of the screen; both the renderer and the mouse hit test read it,
  which is the only thing keeping a click and the row under the pointer in agreement.
- **Nothing you open moves anything, and nothing covers the conversation list.** `screenLayout` does
  not take an argument for what is on screen. [Screen.jsx](src/ui/ink/Screen.jsx) stands the sidebar,
  the rule and the chat up as three *columns*, and only the chat column is handed to whatever is on
  top — so a window replaces chat rows, never whole rows, and the list beside it stays drawn.
  `floatLayout` centres a window over the chat pane; `popupLayout` puts one at the *top* of it —
  the command line ([Cmdline.jsx](src/ui/ink/Cmdline.jsx)) — because the transcript is anchored to
  the bottom of its pane, so those rows are empty in any conversation short of a full screen.
  `cornerLayout` puts one in the **bottom-right**, standing on the prompt: the key menu
  ([WhichKey.jsx](src/ui/ink/WhichKey.jsx)), where which-key goes in LazyVim. Those are the rows the
  transcript *is* using, so a corner window does not take them — it is marked `beside`, and Float
  keeps every chat row it covers in the columns to its left, clipped where the frame begins. That is
  also why the key menu grows taller before it grows wider: a row it covers keeps its conversation,
  a column it takes does not. Two earlier designs are worth not repeating — painting over the middle
  of the transcript, and reserving rows and drawing the transcript shorter (moved the conversation
  under you).
- **A window is an array of rows.** Every frame part in [Float.jsx](src/ui/ink/Float.jsx) is one
  element per screen row, offset by `layout.column` — its position *inside* the chat pane. A window
  that returns a nested box instead of rows cannot be composited, and `layout.left` (absolute, what
  a mouse click carries) is `chatLeft + 1 + column`; the two must agree or clicks land in the wrong
  place. Every row goes through `FrameLine`, which owns the columns to the frame's left as well as
  the frame: blank normally, and the clipped chat row for a `beside` window.
- **The transcript is the conversation, and only the conversation.** Anything openchat has to say
  for itself goes through `notice()` in `App`, which puts one line above the prompt for a few
  seconds and then takes it down. Nothing is written into the chat pane. So a command's answer is
  one sentence; anything bigger — a list of members, of accounts, of commands, anything key-shaped —
  opens a window instead, via `UI_COMMANDS`. Never add a case that writes into the transcript.
- **Rooms vs DMs are the same thing to the UI.** [src/core/client.js](src/core/client.js) is the one
  object the UI talks to; underneath, a room is an Autobase of per-member writer cores
  ([src/core/room.js](src/core/room.js)) and a DM is two outbox cores with a topic and key derived
  from an X25519 DH over both identity keys ([src/core/dm.js](src/core/dm.js)). Both expose the same
  methods and events.
- **Joining needs the pairing channel.** Corestore replicates cores by key, so an existing member
  cannot discover a newcomer's core. A joiner broadcasts a signed JOIN block over a Protomux channel
  ([src/core/pairing.js](src/core/pairing.js)); a writer verifies and appends it. An existing writer
  must be online for anyone to get in.
- **Two databases, and only one of them is disposable.**
  [src/core/accounts-db.js](src/core/accounts-db.js) is the *authoritative* one: one SQLite file at
  `~/.openchat/openchat.db` holding every account, its rooms, contacts, conversations and settings,
  and which account is in use. Nothing in it can be recomputed — the room keys in it are how you get
  back into a room — so a schema mismatch throws rather than dropping, and writes are
  `synchronous = FULL`. [src/core/store.js](src/core/store.js) decides *which* database a directory
  belongs to: a managed profile is a row in the machine's one database, and a directory pointed at
  directly (`OPENCHAT_DIR`, every test peer) carries its own. An account is a row, never a directory
  that happens to exist — `Client.ready()` is what registers one.
- **`index.db` is derived and disposable.** [src/core/index-db.js](src/core/index-db.js) (`node:sqlite`)
  holds search and unread state only; Hypercore logs are the source of truth, and nothing in the index
  is ever sent to a peer. Never make it authoritative for anything.
- **Exit cleanly.** [src/core/shutdown.js](src/core/shutdown.js) — an unclosed Hypercore locks its
  storage and Ink leaves the terminal in raw mode with a hidden cursor. Register teardown via
  `onShutdown`.

## Adding things

- **A command**: parse/describe in [src/ui/model/commands.js](src/ui/model/commands.js) (tier 1),
  execute in [src/commands/index.js](src/commands/index.js) via `notice()` rather than printing.
  Commands are typed after `:` — the message box only ever sends messages, so nothing there is
  parsed for a prefix. Adding one also changes what `openchat <name>` will refuse to treat as an
  account name — see `resolveAccountArg` in [src/core/accounts.js](src/core/accounts.js).
  Commands whose answer is a key or a list are intercepted by `UI_COMMANDS` in `App.jsx` and open a
  float or picker instead — keys never go into the transcript.
- **A keybinding**: one entry in `BINDINGS` in [src/ui/model/keymap.js](src/ui/model/keymap.js).
  Vocabulary is LazyVim's; insert mode is the default mode, so anything that matters needs a ctrl chord too.
- **A setting**: one entry in the table in [src/ui/model/settings.js](src/ui/model/settings.js) — the
  settings panel is generated from it. Settings live per-account in the account database.

## Storage and env

```
~/.openchat/
  openchat.db     accounts, rooms, contacts, settings, which account is current
  profiles/<account>/
    identity.json the keypair — the only irreplaceable file
    store/        Hypercore logs (source of truth)
    index.db      SQLite index (rebuildable)
```

`openchat <account>` opens a profile and creates it if it is new; `--profile` is the same thing and
`--list` enumerates them. `OPENCHAT_HOME` moves the root, `OPENCHAT_DIR` points straight at a profile
directory, `OPENCHAT_PROFILE` picks the profile, `OPENCHAT_BOOTSTRAP=host:port,...` and `OPENCHAT_HOST` point at
a private DHT, `OPENCHAT_DEBUG` prints stack traces. Note: a bootstrap bound entirely to loopback
does not holepunch between two processes — the tests work around this with `hyperdht/testnet.js`.

## Build details

`dist/cli.js` is bundled with `packages: 'external'` — native addons like `sodium-native` must be
loaded by Node, never inlined. `__OPENCHAT_VERSION__` is defined at build time
([scripts/build.js](scripts/build.js)) and falls back to `0.0.0-dev` when running from source.
[bin/openchat.js](bin/openchat.js) is a shim that requires `dist/` to exist.

User-visible changes go in `CHANGELOG.md` under `[Unreleased]`, written as prose about what
changed and why. Cutting a release — tagging, and whatever is published from that tag — happens
outside this repo; nothing here automates it.
