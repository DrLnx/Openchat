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
npm run record         # record real CLI frames for the browser harness
npm run build:web      # bundle web/ into web/openchat-demo.html
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
| 2 — CLI only | `src/core/`, `src/ui/ink/` | Corestore/Hypercore/Autobase/Hyperswarm/Hyperblobs, `sodium-native`, `node:sqlite`, Ink components. |
| 3 — browser only | `web/` | BroadcastChannel transport + simulated members, rendering the same tier-1 view-model. |

[test/unit/portability.test.js](test/unit/portability.test.js) fails the build if tier 1 imports
anything unportable — so putting an `import fs` or a `src/core/` import into `src/protocol/` or
`src/ui/model/` is a test failure, not a style note. Any new shared logic belongs in tier 1 so the
browser harness keeps exercising the same code.

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
  data, driven by both the Ink app and the browser harness.
- **One geometry function.** [src/ui/model/layout.js](src/ui/model/layout.js) computes float and
  sidebar positions from the bottom of the screen; both the renderer and the mouse hit test read it,
  which is the only thing keeping a click and the row under the pointer in agreement.
- **Rooms vs DMs are the same thing to the UI.** [src/core/client.js](src/core/client.js) is the one
  object the UI talks to; underneath, a room is an Autobase of per-member writer cores
  ([src/core/room.js](src/core/room.js)) and a DM is two outbox cores with a topic and key derived
  from an X25519 DH over both identity keys ([src/core/dm.js](src/core/dm.js)). Both expose the same
  methods and events.
- **Joining needs the pairing channel.** Corestore replicates cores by key, so an existing member
  cannot discover a newcomer's core. A joiner broadcasts a signed JOIN block over a Protomux channel
  ([src/core/pairing.js](src/core/pairing.js)); a writer verifies and appends it. An existing writer
  must be online for anyone to get in.
- **`index.db` is derived and disposable.** [src/core/index-db.js](src/core/index-db.js) (`node:sqlite`)
  holds search and unread state only; Hypercore logs are the source of truth, and nothing in the index
  is ever sent to a peer. Never make it authoritative for anything.
- **Exit cleanly.** [src/core/shutdown.js](src/core/shutdown.js) — an unclosed Hypercore locks its
  storage and Ink leaves the terminal in raw mode with a hidden cursor. Register teardown via
  `onShutdown`.

## Adding things

- **A slash command**: parse/describe in [src/ui/model/commands.js](src/ui/model/commands.js) (tier 1),
  execute in [src/commands/index.js](src/commands/index.js) via `notice()` rather than printing.
  Commands whose answer is a key or a list are intercepted by `UI_COMMANDS` in `App.jsx` and open a
  float or picker instead — keys never go into the transcript.
- **A keybinding**: one entry in `BINDINGS` in [src/ui/model/keymap.js](src/ui/model/keymap.js).
  Vocabulary is LazyVim's; insert mode is the default mode, so anything that matters needs a ctrl chord too.
- **A setting**: one entry in the table in [src/ui/model/settings.js](src/ui/model/settings.js) — the
  settings panel is generated from it. Settings live per-profile in `config.json`.

## Storage and env

```
~/.openchat/profiles/<account>/
  identity.json   the keypair — the only irreplaceable file
  config.json     rooms, contacts, settings
  store/          Hypercore logs (source of truth)
  index.db        SQLite index (rebuildable)
```

`OPENCHAT_HOME` moves the root, `OPENCHAT_DIR` points straight at a profile directory,
`OPENCHAT_PROFILE` picks the profile, `OPENCHAT_BOOTSTRAP=host:port,...` and `OPENCHAT_HOST` point at
a private DHT, `OPENCHAT_DEBUG` prints stack traces. Note: a bootstrap bound entirely to loopback
does not holepunch between two processes — the tests work around this with `hyperdht/testnet.js`.

## Build details

`dist/cli.js` is bundled with `packages: 'external'` — native addons like `sodium-native` must be
loaded by Node, never inlined. `__OPENCHAT_VERSION__` is defined at build time
([scripts/build.js](scripts/build.js)) and falls back to `0.0.0-dev` when running from source.
[bin/openchat.js](bin/openchat.js) is a shim that requires `dist/` to exist.

Releases are manual — see [RELEASING.md](RELEASING.md); user-visible changes go in `CHANGELOG.md`
under `[Unreleased]`, written as prose about what changed and why.
