# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0-alpha.1] — 2026-09-09

### Added

- **The key menu moved to the bottom-right corner, and stopped covering the
  conversation.** Press space and the menu of what you could press next now
  opens in the corner nearest the prompt — where which-key opens in LazyVim, and
  where your hands and your eyes already are — instead of at the top of the pane,
  which was out of the way and also nowhere near what you were doing. The corner
  is where the newest messages are, so the menu does not take their rows: it
  stands *beside* them, and every line it reaches keeps the columns to the left
  of the frame, cut with an ellipsis only where it would actually run underneath.
  For the same reason the menu now grows taller before it grows wider — a row it
  covers keeps its conversation, a column it takes does not — so a menu of a few
  keys is a small strip in the corner rather than a band across the screen.
- **A welcome screen worth landing on.** The pane you see with nothing open is
  now centred in the middle of the screen rather than sitting on the floor of it,
  and it says three things instead of one: who you are, in a card wearing the
  same chrome as every window in the app; the three keys that actually get you
  talking, numbered in the order you need them; and the six worth knowing on day
  one, in two columns. It signs its name in block letters above all of it, in
  the two colours the rest of the interface is drawn in — in three sizes, taking
  the largest the terminal can hold, down to a one-line wordmark on a pane that
  can hold nothing else. The last line is the thing about openchat that
  surprises people, said once, up front: you both have to be online, because
  nothing is held anywhere in between.

- **`c` copies the recovery phrase during setup.** Twenty-four words is a lot to
  retype into a password manager by hand, and somebody who cannot get them off
  that screen quickly is somebody who does not save them at all — which is the
  one failure the screen exists to prevent. It goes out over OSC 52, so it works
  through ssh and tmux with no helper binary.
- **Keys live in a window now, not in the conversation.** `:whoami`, `:backup`
  and `:invite` used to write their answer into the transcript, which was the
  worst place in the app for it: a 64-character key wrapped across the message
  column, indented under a speaker's name, in a pane the next message scrolls —
  and it stayed there, in whatever that transcript was later shown to. They now
  open a floating window that lays the value out whole in a box wide enough to
  hold it, says on the same row what it is worth to somebody else (`safe to
  share` against a public key, `never share` against a recovery phrase), and
  closes without leaving anything behind. `c` copies the value to your system
  clipboard over OSC 52, so it works through ssh and tmux with no helper
  binary; `⇥` moves between the values in a window; `r` shows or hides a
  secret, which stays masked until you ask for it. `space k` opens your own
  keys from anywhere. `:members`, `:contacts` and `:rooms` — the other commands
  whose answer was a column of public keys — open the finder instead of a
  paragraph of output.
- **A full-screen interface.** openchat now takes the whole terminal — the
  alternate buffer, the one `vim` uses — and paints a frame the size of your
  window: a title bar naming the conversation, a **conversation list** down the
  left with unread counts, the chat, the prompt, and the statusline. Your
  shell's scrollback is left exactly as you had it and handed back untouched
  when you quit.
- **A transcript that scrolls in place.** `ctrl-u` / `ctrl-d`, `page up` /
  `page down`, `gg` and `G` move through the conversation inside its own pane,
  so the conversation list stays put while you read back. A message arriving
  while you are reading no longer shoves the line you are on up the screen, and
  the statusline says when you are not looking at the live end of a room.
  Searching now scrolls to the result instead of quoting it, across
  conversations — picking a hit from another room opens that room first.
- **`:leave` and `:delete`.** Leaving a room announces it, so the room sees you
  go, and takes it off this machine. Deleting says nothing to anyone and clears
  the conversation, its keys and its search history from here. Neither pretends
  to do more: there is no server to delete a room *from*, so everyone still in
  it keeps their copy and keeps what you wrote — the commands say so rather than
  letting you find out later.
- **The conversation list is somewhere you can go.** `space e` (or `ctrl-e`
  while typing) hands it the keyboard: `j`/`k` move, `⏎` opens what the cursor
  is on and gives the keyboard back, `esc` leaves without opening anything. The
  cursor starts on the conversation you are already in. The statusline says
  `LIST` while it has focus, so a key never disappears into a pane you did not
  mean. The mouse is turned on for as long as the list is focused, the same way
  it is for a floating window — click a row to open it, click the conversation
  to come back — so pointing at things costs your terminal's text selection
  only while you are actually pointing.
- **A date on the transcript.** A rule with the day on it goes in wherever the
  day changes, because a clock alone cannot tell you whether `09:12` was this
  morning or last Thursday.
- **A local index over your history** (`index.db` in each account, SQLite via
  Node's built-in `node:sqlite` — no new dependency). Hypercore remains the
  source of truth and the only thing peers ever see; this is a derived view that
  can be deleted at any time and rebuilds itself. It buys three things a log is
  bad at: full-text search across everything you have ever been told rather than
  the few hundred lines the UI holds in memory, unread counts that survive
  closing the app, and both answered instantly. `space f s` searches every
  conversation and will open the one a hit is in.
- **Nothing on screen moves anything else.** The title bar, the conversation,
  the prompt and the statusline are where they are and stay there. A window
  that takes over the screen is composited over the middle of it with the
  conversation still visible above and below; one anchored to the prompt — the
  command line, the key menu — is laid over the bottom of it.
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
  identity — composited over the app: they take the rows they need out of the
  middle of the screen, centred, with the conversation still visible above and
  below them and drained of colour behind them.
- **Settings**, per account, written as you change them: six terminal themes
  (Tokyo Night storm and night, Catppuccin Mocha, Gruvbox Dark, Rosé Pine, and
  a monochrome one that leaves your terminal's colours alone), timestamp
  format, compact lines, Nerd Font icons, whether the conversation list is
  shown, which-key delay, the auto-download
  limit, and whether public keys are shown in full — for when you are sharing a
  screen.
- **An account switcher.** Accounts are a username and a keypair; the switcher
  creates, restores and switches between them without leaving the app, and a
  switch is a real teardown — the swarm and every core close before a different
  keypair comes up. Nothing is shared between two accounts.
- **Mouse support inside floating windows**: click a row, scroll the wheel,
  click outside to dismiss. Reporting is off everywhere else by default, so the
  terminal keeps its text selection; `mouse: always` opts into the other trade,
  which also makes the wheel scroll the transcript and the conversation list
  clickable. Reports are filtered out of stdin before Ink sees them,
  so a click can never be typed into a message.
- **A rewritten onboarding flow** that explains what an account is here before
  making you one, and will not move past the recovery phrase until you confirm
  you have written it down.
- `:accounts`, `:settings`, `:theme`, `:keys` and `:find`, so every window is
  reachable by typing as well as by chord.
- **A command line.** `:` opens it, the way it does in vim: a window above the
  prompt with the line you are typing, the commands that match it, and what
  each one does. Tab completes the highlighted name and leaves the cursor where
  its argument goes; `Ctrl+P` / `Ctrl+N` walk back through commands you have
  run; enter runs what you typed, or the highlighted command when what you
  typed is not one — `:me` runs `:members` rather than sending "me" to the
  room. Type something that is not a command name and it searches what commands
  *do* instead, so `:palette` finds `:theme`. `Ctrl+K` opens the same window
  from insert mode, and `space f c` from normal.
- **`openchat <account>` logs into an account**, and creates it if this machine
  has never seen it — `openchat work` rather than `openchat --profile work`.
  Which account you are is the one decision that is already made by the time the
  app is on screen: two accounts share nothing, and an account can only be open
  in one process at a time, so it belongs on the command line rather than behind
  a flag. `--profile` still does the same thing. A bare word that is also the
  name of a command is read as somebody reaching for that command —
  `openchat whoami` points at `:whoami` instead of silently making an account
  called whoami — unless an account of that name already exists, in which case it
  is yours and it opens.
- **`openchat --list`**, which says what accounts are on this machine, which one
  the next bare `openchat` would open, and what each one's key and room count is.
  It reads the profile directories and opens nothing.
- **A conversation with nothing in it says so.** An empty pane is the one screen
  in a chat client that looks broken while working perfectly — you joined, you
  are connected, and there is simply nothing to draw. A new room says that an
  invite is the only way in and which chord sends one; a new direct conversation
  says that its key comes from your two keys, so there is nobody who could
  derive it.
- Two more palettes: **Nord**, and **Catppuccin Latte** for anyone working on a
  light terminal — every other theme that ships renders as grey on grey there,
  and "use a dark terminal" is not an answer.

### Changed

- **Accounts live in a database now, not in scattered JSON files.** One SQLite
  file at `~/.openchat/openchat.db` holds every account on the machine, which one
  you are in, and for each of them the rooms it has joined, the people it has
  names for, its conversations and its settings — replacing `current.json` and a
  `config.json` in every profile directory. The point is not tidiness: a
  directory with a key in it and nothing else — made by a typo, or by a command
  that failed halfway — used to be indistinguishable from a real account, so the
  account list filled up with things nobody had meant to create. An account is
  now a row, written when a client actually opens it, and a directory that merely
  exists is not one. Unlike `index.db`, this database is authoritative: it is
  written with a full fsync, and a schema it does not recognise is an error
  rather than a reason to start over.

- **Commands are typed after `:`, not as messages beginning with a slash.**
  A slash prefix gave the message box two jobs, and every line you typed had to
  be inspected to find out which one it was doing: a stray leading slash sent a
  command instead of the sentence you meant, and a message that genuinely
  started with a slash needed an escape hatch to send at all. The message box
  only sends messages now. Everything is `:invite`, `:dm <key>`, `:help` —
  including in the app's own prose, its help output and this file.
- **Nothing openchat says for itself goes into the chat any more.** A command's
  answer, an error, an acknowledgement of a keypress — all of it used to be
  written into the transcript, where it outlived the moment it was about, pushed
  real messages up the screen, and stacked one identical line per press. It is
  written into the prompt's border for a few seconds now and then taken down,
  and the chat pane holds messages and nothing else. Command output was rewritten
  to fit: every answer is one sentence, and anything bigger than a sentence opens
  a window instead — `:profiles` opens the accounts window, and `:help` opens the
  command line, which already lists every command with what it does. Warnings and
  errors stay up nearly three times as long as acknowledgements, because a
  warning you missed is a warning that did not happen.
- **The key menu was redrawn.** Every row used to be a bare letter, two spaces
  and a sentence, padded to a fixed column: a wall of text you had to read left
  to right to find the one character you were going to press. The key is now the
  only thing on the row in the accent colour, because it is the only thing you
  are looking for, and `+` marks the ones that open another menu rather than
  doing something — at the left edge of the label, where they line up with each
  other. Labels are lowercase and the window is sized to its contents rather
  than stretched across the screen; its title says which group you are in.
- **Speakers are laid against the rule down the middle of the transcript**
  rather than against the clock. Left-aligned, every name ended at a different
  column and the rule was a ragged distance from all of them.
- **A window no longer blanks the conversation list.** The screen was one stack
  of full-width rows, so anything laid over it took whole rows — and the list
  down the left went with them, for as long as the window was open. The sidebar,
  the rule and the chat are three columns standing side by side now, and only
  the chat column is handed to whatever is in front. Every window in the app is
  measured against the chat pane rather than the terminal, so none of them reach
  into the list's columns either.
- **The key menu and the command line open at the top of the chat pane.** Both
  were once painted across the middle of the transcript with no frame at all.
  The fix after that was to give them rows of their own, with the conversation
  redrawn one pane shorter to make room — which covered nothing and was still
  wrong, because pressing space shunted everything you were reading upward every
  time you reached for a key. Anchoring them over the bottom of the pane moved
  nothing but sat on the newest messages, which are the ones you care about.
  The transcript is anchored to the bottom of its pane, so the *top* of that pane
  is empty in any conversation short of a full screen: a window there moves
  nothing and usually covers nothing either. Both are centred over the chat pane
  rather than the terminal, so the conversation list is left alone. Nothing you
  open moves anything now — `screenLayout` does not take an argument for what is
  on screen.
- **Every window's key hints moved into its closing border.** A legend given a
  row of its own cost each float one row of the thing you opened it to look at,
  and a border is the right place for a caption. Finders, settings, accounts and
  the key windows are all a line taller inside as a result.
- **Each speaker's block has a coloured rule down its left edge**, in that
  person's own colour, drawn the whole height of the block rather than only on
  the lines that wrapped. Three lines into a paragraph you can still tell whose
  it is without going back up to the name.
- **The title bar and the statusline stopped repeating each other.** Both used to
  name the room and count peers. The title bar is about the pane under it — which
  conversation, what kind, how many people, whether it is reaching anyone — and
  the statusline is about you: which mode, which account, what is unread
  somewhere else, and the states you can be in without having chosen them, like
  being scrolled back. The room name is now a chip in the title bar in the same
  colour the conversation list marks it with.
- **The conversation list groups itself.** Section headings carry a rule to the
  edge of the pane, the conversation you are in takes a solid bar and a highlight
  across the full width, and an empty list lists the three chords that start a
  conversation instead of sitting there empty.
- **The prompt says where what you type is going**, as a caption in its top
  border, and recedes to the quietest colour on the screen in NORMAL mode — where
  the cursor is not where text goes, so it stops pretending to be one.
- **Onboarding is a centred card** of a fixed width rather than a box that fills
  the terminal. It is the one screen in openchat that is almost entirely prose,
  and prose does not get more readable by being given two hundred columns. Its
  claims and the reasons for them line up in two columns, and the recovery phrase
  is laid out to fit whatever width is actually there.
- **The chat pane was redrawn.** The figlet `openchat` across the welcome
  screen is gone — it was a logo drawn by someone who only had one font, it was
  the widest thing on a screen whose whole point is the column next to it, and
  it fell apart every time the pane got narrow. In its place: a wordmark, a
  rule, and the chords worth knowing on your first day, grouped by what you
  actually want. The welcome screen no longer prints your public key in full
  either — it shows enough to recognise and says which key opens the window
  that has the rest.
- **The marker column earns its cell.** Somebody else speaking gets a dot in
  their own colour, you get a caret, and a line that mentions you gets a solid
  bar down the whole left edge of the block rather than one mark on its first
  row — what you want to find when you come back to a room is the block, and a
  block is only visible if it is marked all the way down. Notices, joins and
  renames start where a message body starts, so the pane has one text column
  instead of two.
- The command menu completes fuzzily: `:dl` finds `:download`. It matches
  command names only — matching help text too would turn `:nope` into whichever
  command's description happened to contain those letters, instead of the error
  it should be.
- The message input is openchat's own: readline bindings (`Ctrl+A`/`Ctrl+E`,
  `Ctrl+W`, `Ctrl+U`) and ↑/↓ history, replacing `ink-text-input`. Every key is
  now routed by one handler, which is what makes modal editing possible —
  Ctrl-P switches conversation instead of also typing a `p`.
- The statusline is a lualine-style row: mode, where you are, connection and
  peer count, which account you are, and what is unread elsewhere.

### Removed

- **Restoring an identity from a recovery phrase is gone.** Onboarding no longer
  asks whether you are creating a key or bringing one in — it generates one and
  moves on to your name — and `r restore` has gone from the accounts window along
  with the mnemonic path through `createAccount` and `restoreFromMnemonic` in the
  core. A keypair is now generated on the machine that uses it and is never read
  back from anywhere, so `identity.json` is the only copy of an account openchat
  will ever make or accept. `:backup` still shows the phrase and `c` still copies
  it; nothing in the program reads one.

- **The browser harness.** `web/` built to a self-contained HTML page that ran
  the real protocol, crypto and view-model over a `BroadcastChannel` with
  simulated members, as a way to show openchat working without installing it.
  It is gone, along with `npm run build:web`, `npm run record` and the recorded
  frames it replayed. It was a second front end to keep in step with the first,
  and every change to the interface was a change in two places.

  What it was holding up stays: `src/protocol/` and `src/ui/model/` are still
  free of Node builtins and native modules, enforced by
  `test/unit/portability.test.js`, and the WebCrypto backend still has to open
  what the sodium backend sealed. That was never really about the browser — it
  is what keeps the wire format and the view-model something you can read and
  test on their own.

### Fixed

- **A pasted line put a control character into the field and swallowed the
  enter.** Ink reports a key as "return" only when the chunk it read is exactly
  a carriage return, and a terminal hands over whatever was in its buffer — a
  whole pasted invite, or `ada` and the enter after it when you type quickly.
  Everything else was inserted verbatim. Since pasting is the *normal* way to
  use these fields — a 24-word recovery phrase, an invite string, a
  64-character public key — this was reachable in about a minute: the field
  would take your paste, keep the newline in it, and then not submit. Every
  line of input in the app now goes through one function that separates what
  belongs in the line from the fact that the line ended.
- **A direct message never learned who it was with.** A DM is opened by pasting
  a 64-character public key, so until it is told otherwise it is called
  `@98642e95` — in the conversation list, the title bar and the prompt,
  permanently. The other side announces its nick within seconds of connecting
  and that is the answer to "who is this", but nothing was reading it: a
  conversation that was delivering messages perfectly looked like one that had
  never worked. The name is taken from the transcript now, the way a room's
  member list already was, remembered so it survives a restart, and kept
  separate from a contact name you chose yourself — which nothing arriving over
  the wire may overwrite.
- **A room name that filled the conversation list ran into its own unread
  count.** There is a column of air between them now, whatever the name.
- **A room could be called two different things at once.** The prefix on a
  conversation name was decided in two places — the theme, for the sidebar,
  title bar and statusline, and a hardcoded `#` in every notice. With Nerd Font
  icons switched on the two disagreed: the chrome drew a private-use glyph that
  most terminals render as nothing, while `:new` and `:rooms` went on printing
  a literal `#`. One function decides it now, and the Nerd Font set no longer
  overrides `#` and `@` — they are one cell wide everywhere and already say
  what they mean.
- **Leaving or deleting your last conversation hid the confirmation.** With
  nothing open the pane shows the welcome, which replaced the transcript the
  notice had just been written to. It now shows both.
- **Only the owner adds members.** Everyone holding the invite still walks
  straight in — there is no approval step and nothing to accept — but it is the
  owner's client that writes them into the room. A member who was let in can no
  longer let other people in, so a room's membership stays with whoever created
  it. Like closing, this is enforced by honest clients rather than by the log:
  the alternative is a rule in `apply()`, which Autobase reapplies whenever it
  learns of concurrent writes, and a transfer of ownership reordered ahead of a
  join would silently evict a member who joined legitimately. Losing a real
  member to a race is the worse failure.
- **A room being closed could crash the client that closed it.** An
  announcement arriving during shutdown was answered with an append to a
  closing Autobase, and the rejection was emitted as an `error` event on a room
  nobody was listening to — which throws. Knocking now stops before the log
  goes away, and a late failure with no listener is dropped rather than fatal.
- **A direct message to someone who had not also messaged you went nowhere.**
  A conversation's topic is derived from *both* identities, so the person being
  written to could not be listening on it until they already knew who was
  writing — the message was encrypted, sent, and delivered to an empty topic,
  with no error on either side. Every account now also announces one rendezvous
  derived from its own key alone, which is exactly what a published public key
  should be good for: an address people can reach you at. Whoever knocks is
  already proven, because a swarm connection is authenticated to a keypair
  derived from the same seed as the identity.
- **Opening openchat twice said "File descriptor could not be locked".** True,
  and no help at all. An account's log has a single writer, so its storage takes
  an exclusive lock — that is correct, but the way to find out should not be a
  message about file descriptors. It now says the account is already open in
  another terminal and shows the `--profile` line that opens a second one.
- **A join that could be silently ignored.** A joiner announced its request the
  moment the pairing channel was created, which is before the far end has
  opened its side — and protomux drops anything written before then. Win the
  race and you were admitted in a second; lose it and you sat there forever,
  connected to a member who never heard you ask. The announcement now waits for
  the channel to be open at both ends, repeats while you are still not a
  writer, and DM key exchange, which had the same bug and the same
  consequence — a conversation that connects and silently carries nothing — was
  fixed the same way.
- **`:join` no longer blocks the prompt.** Opening a room is local and takes
  milliseconds; being admitted needs a member to be online and can take as long
  as it takes. Only the first happens at the prompt now — the room opens, you
  can look around it, and the admission lands in the background whenever it
  lands, with no thirty-second deadline turning "nobody is around yet" into an
  error.
- Wrapping no longer eats the leading whitespace that `:rooms` and `:members`
  line their columns up with, or spend a whole blank row on a message that ends
  in a space.
- Names from a transcript loaded off disk. Nick messages were only applied to
  the member list when they arrived live, so everyone who had spoken before the
  session started showed up as a hex key until they said something again.
- Unread counts survive a refresh instead of being cleared whenever the
  conversation list was re-read.

## [0.1.0] — never released

Written 2026-08-31 and superseded before a tag ever existed, so it is kept here
as the record of when this work landed rather than as something anyone can
install. Serverless, end-to-end encrypted chat for the terminal.

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
