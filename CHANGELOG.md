# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **A keyboard-first, modal interface**, with LazyVim's vocabulary. `esc` and
  `i` move between NORMAL and INSERT, space is the leader, and a **which-key**
  popup lists everything a half-typed chord could still become — so the keymap
  is learnable by using it rather than by reading it. `?` shows the whole map.
- **Fuzzy finders** for conversations, rooms, people, room members, commands,
  keymaps, accounts and the messages in front of you. Scoring follows fzf:
  boundary and consecutive-character bonuses, matched characters highlighted so
  you can see why a row matched. Public keys are matched as a prefix rather
  than fuzzily — every short query is a subsequence of 64 hex characters, so
  fuzzy-matching keys would make every picker return every row.
- **Floating windows** — pickers, settings, accounts, the keymap and your
  identity — drawn over the conversation rather than in an alternate screen, so
  the transcript stays visible and stays in your terminal's scrollback.
- **Settings**, per account, written as you change them: six terminal themes
  (Tokyo Night storm and night, Catppuccin Mocha, Gruvbox Dark, Rosé Pine, and
  a monochrome one that leaves your terminal's colours alone), timestamp
  format, compact lines, Nerd Font icons, which-key delay, the auto-download
  limit, and whether public keys are shown in full — for when you are sharing a
  screen.
- **An account switcher.** Accounts are a username and a keypair; the switcher
  creates, restores and switches between them without leaving the app, and a
  switch is a real teardown — the swarm and every core close before a different
  keypair comes up. Nothing is shared between two accounts.
- **Mouse support inside floating windows**: click a row, scroll the wheel,
  click outside to dismiss. Reporting is off everywhere else by default, so the
  terminal keeps its own scrollback and text selection; `mouse: always` opts
  into the other trade. Reports are filtered out of stdin before Ink sees them,
  so a click can never be typed into a message.
- **A rewritten onboarding flow** that explains what an account is here before
  making you one, and will not move past the recovery phrase until you confirm
  you have written it down.
- `/accounts`, `/settings`, `/theme`, `/keys` and `/find`, so every window is
  reachable by typing as well as by chord.

### Changed

- The command menu completes fuzzily: `/dl` finds `/download`. It matches
  command names only — matching help text too would turn `/nope` into whichever
  command's description happened to contain those letters, instead of the error
  it should be.
- The message input is openchat's own: readline bindings (`Ctrl+A`/`Ctrl+E`,
  `Ctrl+W`, `Ctrl+U`) and ↑/↓ history, replacing `ink-text-input`. Every key is
  now routed by one handler, which is what makes modal editing possible —
  Ctrl-P switches conversation instead of also typing a `p`.
- The statusline is a lualine-style row: mode, where you are, connection and
  peer count, which account you are, and what is unread elsewhere.
### Fixed

- Names from a transcript loaded off disk. Nick messages were only applied to
  the member list when they arrived live, so everyone who had spoken before the
  session started showed up as a hex key until they said something again.
- Unread counts survive a refresh instead of being cleared whenever the
  conversation list was re-read.

## [0.1.0] — 2026-08-31

First release. Serverless, end-to-end encrypted chat for the terminal.

### Added

- **One command.** `openchat` opens the app; rooms, invites, direct messages,
  contacts and the rest are slash commands inside it. `--profile` is the only
  flag, because which account you are is a property of the session you start.
  A second surface would only be a second place for behaviour to drift.

- **Group rooms** over Autobase: many writers, one causally ordered transcript,
  joined with an invite string. Offline members replay what they missed.
- **Direct messages with no invite.** Ed25519 identities convert to X25519, so
  both sides derive the same channel by ECDH from public keys alone. The
  discovery topic is derived from that secret too, so a third party cannot tell
  the conversation exists.
- **Room ownership** — close, reopen, transfer, and remove members. Control
  actions are verified against the current owner by every member's client.
- **Profiles**: several independent accounts on one machine, one per terminal,
  via `--profile` or `OPENCHAT_PROFILE`. `/profiles` lists them.
- **Onboarding** for a new profile, including restoring an identity from its
  BIP39 recovery phrase.
- **Attachments** over Hyperblobs: metadata in the log, bytes on demand, real
  progress, checksum verified on arrival.
- **Contacts**, so a key can have a name.
- `/backup`, so the recovery phrase is reachable from inside the app.
- A terminal UI in the style of Claude Code: the transcript goes to your shell's
  own scrollback, with a command menu on `/`.
- `npm run demo` — a guided tour of everything, on one machine, with no network.
- A browser harness that runs the real protocol and crypto with the DHT
  simulated, for looking at the app without installing it.

### Security

- Discovery topics and encryption keys are separate. A room's topic is public;
  its key travels only inside an invite.
- Every message is signed and encrypted; the signature is checked and the
  claimed author verified against it before the message is displayed.
- Identity keys live in `~/.openchat/profiles/<name>/identity.json` at mode
  `0600`, and are written atomically.

### Known limitations

These are documented in the README rather than implied:

- No forward secrecy. One long-lived key per conversation.
- `/close` is enforced by members' clients, not cryptographically.
- Anyone holding an invite becomes a writer; there is no admin approval.
- Public DHT connectivity has not been exercised in CI, which runs against a
  local testnet.
