# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-08-31

First release. Serverless, end-to-end encrypted chat for the terminal.

### Added

- **Group rooms** over Autobase: many writers, one causally ordered transcript,
  joined with an invite string. Offline members replay what they missed.
- **Direct messages with no invite.** Ed25519 identities convert to X25519, so
  both sides derive the same channel by ECDH from public keys alone. The
  discovery topic is derived from that secret too, so a third party cannot tell
  the conversation exists.
- **Room ownership** — close, reopen, transfer, and remove members. Control
  actions are verified against the current owner by every member's client.
- **Profiles**: several independent accounts on one machine, one per terminal,
  via `--profile` or `OPENCHAT_PROFILE`.
- **Onboarding** for a new profile, including restoring an identity from its
  BIP39 recovery phrase.
- **Attachments** over Hyperblobs: metadata in the log, bytes on demand, real
  progress, checksum verified on arrival.
- **Contacts**, so a key can have a name.
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
