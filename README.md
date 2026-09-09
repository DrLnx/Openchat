<div align="center">

# openchat

### End-to-end encrypted chat that lives in your terminal

Rooms · Direct messages · Attachments · Multiple identities<br>
No server. No account. No directory anyone can look you up in.

<sub>An open-source project by **[N3XT Agency](https://n3xt-agency.com)**</sub>

<br>

[![Website](https://img.shields.io/badge/Website-n3xt--agency.com-1D9470?style=for-the-badge&logoColor=white)](https://n3xt-agency.com)
[![Contact](https://img.shields.io/badge/Contact-contact@n3xt--agency.com-1D9470?style=for-the-badge&logoColor=white)](mailto:contact@n3xt-agency.com)

<br>

[![Node.js](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Holepunch](https://img.shields.io/badge/stack-holepunch-1D9470)](https://docs.pears.com/)
[![Ink](https://img.shields.io/badge/ui-ink%20%2B%20react-61DAFB?logo=react&logoColor=white)](https://github.com/vadimdemedes/ink)
[![CI](https://img.shields.io/badge/CI-lint%20%C2%B7%20tests-1D9470)](https://github.com/n3xtpy/Openchat/actions/workflows/ci.yml)
[![standard](https://img.shields.io/badge/code%20style-standard-F3DF49)](https://standardjs.com)
[![License](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

![Encryption](https://img.shields.io/badge/Encryption-AES--256--GCM_%C2%B7_Ed25519-1D9470?style=flat-square)
![Transport](https://img.shields.io/badge/Transport-P2P_DHT-1D9470?style=flat-square)
![Servers](https://img.shields.io/badge/Servers-None-1D9470?style=flat-square)
![Tests](https://img.shields.io/badge/Tests-178-1D9470?style=flat-square)

<br>

**[Overview](#overview)** ·
**[Install](#install)** ·
**[Interface](#the-interface)** ·
**[Accounts](#accounts)** ·
**[Security](#security-model)** ·
**[Architecture](#architecture)**

<br>

</div>

<br>

---

## Overview

openchat is a terminal chat client with **no server anywhere in it** — not one you
run, not one we run, not one you have to trust. Members find each other on a
distributed hash table, hole-punch a direct connection, and replicate an encrypted
append-only log between themselves.

An account is a keypair on your machine. There is nothing to sign up for, no
directory to be listed in, and nobody who can enumerate users, read a room, or lock
you out — because there is nobody in the middle at all.

<table>
<tr><td><b>Identity</b></td><td>An Ed25519 keypair on your machine, backed up by 24 words</td></tr>
<tr><td><b>Discovery</b></td><td>Hyperswarm DHT — no bootstrap server of ours, no account server</td></tr>
<tr><td><b>Encryption</b></td><td>AES-256-GCM bodies, Ed25519 signatures, verified before decrypt</td></tr>
<tr><td><b>Rooms</b></td><td>An Autobase of per-member logs; offline members replay what they missed</td></tr>
<tr><td><b>DMs</b></td><td>Derived from two public keys — no invite, and the topic itself is secret</td></tr>
<tr><td><b>Interface</b></td><td>A full-screen, keyboard-first modal TUI: conversation list, chat, floating windows</td></tr>
<tr><td><b>Requirements</b></td><td>Node.js 22 or newer. Nothing else.</td></tr>
</table>

<br>

| | Feature | In one line |
| :---: | --- | --- |
| 🔐 | **[End-to-end encryption](#security-model)** | Every message signed and sealed; the room key never touches the network |
| 🛰️ | **[Serverless transport](#architecture)** | Peers find each other on a DHT and replicate directly, with nothing in between |
| ⌨️ | **[Modal, keyboard-first UI](#the-interface)** | LazyVim's bindings, and a key menu so none of them need memorising |
| 🔎 | **[Fuzzy finders](#finders)** | Rooms, people, members, commands, keymaps, accounts and message search |
| 👤 | **[Multiple accounts](#accounts)** | A username and a keypair each, sharing nothing — switched without leaving the app |
| 💬 | **[Rooms and DMs](#rooms-and-direct-messages)** | Invite-based group rooms, and direct messages that need no invite at all |
| 📎 | **[Attachments](#attachments)** | Metadata in the log, bytes on demand, checksum verified on arrival |
| 🎨 | **[Themes and settings](#settings)** | Eight real terminal palettes, stored per account, applied as you change them |
| 🖱️ | **[Mouse where it helps](#mouse)** | Clickable floats and conversation list; off elsewhere so selection still works |

<br>

---

## Install

**Node.js 22 or newer**, and nothing else. openchat is built from source — there
is no package to install yet.

```bash
git clone https://github.com/n3xtpy/Openchat.git
cd Openchat
npm install
npm run build
npm link          # optional: puts `openchat` on your PATH
```

Without `npm link`, run it as `node bin/openchat.js` wherever the docs below say
`openchat`.

<br>

---

## Quick start

```bash
openchat            # the account you used last
openchat work       # an account called work, created if it is new
```

That is nearly the whole command line. openchat is an app you sit inside, not
something you drive one shell invocation at a time — rooms, invites, direct
messages, contacts and everything else happen in the app. The one thing the shell
decides is **which account you are**, because an account can only be open in one
process at a time, so it is the first argument.

On first run it sets up an account, which here means **generating a keypair**. There
is nothing to choose: a key is generated on the machine that uses it, and openchat
has no way to bring one in from anywhere else. It then shows you a recovery phrase —
`c` copies your public key, `shift-c` copies all 24 words — and `:backup` is the only
other place you will ever see them.

Write them down. They are the seed your identity is derived from, and there is no
server that can reset anything for you. Be equally clear about what they are *not*:
openchat never reads a phrase back, so losing this machine loses this account.

Then you land here — who you are, what to do first, and the keys that get you
there, sitting in the middle of the pane:

```
 ██████╗ ██████╗ ███████╗███╗   ██╗ ██████╗██╗  ██╗ █████╗ ████████╗
██╔═══██╗██╔══██╗██╔════╝████╗  ██║██╔════╝██║  ██║██╔══██╗╚══██╔══╝
██║   ██║██████╔╝█████╗  ██╔██╗ ██║██║     ███████║███████║   ██║
██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║██║     ██╔══██║██╔══██║   ██║
╚██████╔╝██║     ███████╗██║ ╚████║╚██████╗██║  ██║██║  ██║   ██║
 ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝ ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝

end-to-end encrypted · no server · no account · v1.0.0-alpha.1

╭─ ada ─────────────────────────── ◆ default ─╮
│ 22f071ec5f9f80f4739edd56…                   │
╰─ ␣ k your keys, and the phrase behind them ─╯

START HERE
1  ␣ r n  make a room — you own it, and nothing anywhere lists it
2  ␣ r i  share its invite out of band: the invite is the room key
3  ␣ f d  or skip rooms and message anyone by their public key

KEYS
␣      every key, in a menu   ␣ f f  find a conversation
?      the whole keymap       ␣ f s  search what was said
:      a command              ␣ k    your keys

· you both have to be online — nothing is held anywhere in between
```

The whole block is centred as a block — one indent for every row, so the card, the
numbers and the two key columns keep the edges they were laid out against. The name
comes in three sizes and takes the largest the terminal can hold: these block
letters, the same word in three rows of half blocks, and below that a single line of
text. The card wears the same chrome as every window in the app, because that is
what it is — a fact about you, in a frame.

Then, inside:

```
:new design-team         open a room you own
:invite                  its invite string, in a window — share this out of band
:join openchat1:AUEp…    join a room someone invited you to
:dm 03d35f4c5d0f36a0…    message someone directly, using only their key
:help                    everything else
```

`:` opens the command line, the way it does in vim — the message box only ever
sends messages, so nothing you type into it can be mistaken for an instruction. Or
press **space** and read the menu. `esc` and `i` move between normal and insert mode,
and nothing is reachable *only* by chord: every window has a command too.

> **Send invites out of band** — a call, a QR code, a channel you already trust. An
> invite is not a link, it is the key to the room: anyone holding it is a member.
> One of you also has to be online while the other joins, because admitting a member
> is something an existing member does and there is no server to do it for you.

<br>

---

## The interface

Two ideas, taken from the two terminal programs this is meant to sit next to.

<table>
<tr>
<td width="50%" valign="top">

#### A screen, not a stream of output

openchat takes the whole terminal — the alternate buffer, the one `vim` uses — and
paints a frame the size of your window: title bar, conversation list, chat, prompt,
statusline. Your shell's scrollback is left exactly as you had it, and you get it
back untouched when you quit.

Nothing scrolls away. The transcript scrolls inside its own pane (`ctrl-u` /
`ctrl-d`, `G` for the newest), so the conversation list stays put while you read
back through a room.

</td>
<td width="50%" valign="top">

#### From LazyVim: modal keys, and a menu that teaches them

`esc` and `i` move between NORMAL and INSERT, space is the leader, and half a chord
opens a **key menu** listing everything it could still become. Nothing has to be
memorised in advance — you press space, read, and after a week your fingers know it
without you. It opens in the bottom-right corner, next to the prompt, and the
conversation keeps the columns to the left of it.

</td>
</tr>
</table>

A floating window is composited over that frame rather than pushed above the
prompt: it takes the rows it needs out of the middle of the screen, and the
conversation stays visible above and below it.

```
▌ #design   3 members · yours                          ● connected · 3 peers
 ROOMS ─────────── │                   · bob joined
▌ #design        ★ │
  #ops             │ 20:06     ● bob   │ got the invite — this is over the
 DIRECT ────────── │                   │ DHT, no server anywhere
  @grace         2 │
                   │ 20:06       › you │ that is the idea. offline members
                   │      ╭─ ⌕ Conversations ─────────────────────── 1/4 ─╮
                   │      │ ⌕  dsg                                        │
                   │      ├───────────────────────────────────────────────┤
                   │      │ ❯ #design                        here · yours │
                   │      │   @grace                             2 unread │
                   │      ╰─ ↑↓ move · ⏎ open · esc close ───────────────╯
                   │
╭─ #design ────────────────────────────────────────────────────────────────╮
│ ❯  message #design                                                       │
╰──────────────────────────────────────────────────────────────────────────╯
 INSERT  ada@work                            ● 2 elsewhere  esc normal · ? help
```

The title bar says what you are looking at and whether it is reaching anyone; the
statusline says who and where *you* are. Neither repeats the other. Each speaker's
block carries a rule down its left edge in that person's own colour, so you can tell
whose paragraph you are three lines into without going back to the name; a line that
says your name gets a solid bar instead. Speakers are laid against that rule rather
than against the clock, so the names and the rule each have a straight edge and the
eye has two lines to read between rather than a ragged column.

**Nothing openchat says for itself goes into the chat.** A command's answer, an
error, an acknowledgement — "copied the invite to the clipboard" — is written into
the prompt's own border for a few seconds and then taken down. The transcript is what
happened in the conversation; a reply to something you pressed is not that, and
leaving one there forever, three deep if you pressed the key three times, is how a log
stops being worth reading. Anything bigger than a line opens a window instead: a list
of members, of accounts, of commands, or anything key-shaped.

The conversation list hides itself below 64 columns, and `space u e` turns it off at
any width.

**Nothing you open moves anything, and it mostly covers nothing either.** Every
window is laid over the frame rather than wedged into it, so the title bar, the
conversation, the prompt and the statusline are in the same place whatever is on
screen.

The **key menu** stands in the bottom-right corner, on top of the prompt — where
which-key stands in LazyVim, and where your eye already is when you are halfway
through a chord. That corner is also the expensive one, because the transcript is
anchored to the bottom and those are the newest messages, so the menu does not take
their rows. It stands *beside* them: every line it reaches keeps the columns to the
left of the frame, cut with an ellipsis only where it would actually run underneath.
For the same reason it grows taller before it grows wider — a row it covers keeps its
conversation, a column it takes does not:

```
 ROOMS ─────────── │                                ╭─ keys ───────────────────╮
▌ #design        ★ │                                │ ,  switch conversation   │
  #ops             │                                │ ?  help                  │
 DIRECT ────────── │                                │ ␣  find conversation     │
  @grace         2 │                                │ a  accounts              │
                   │                                │ e  conversation list     │
                   │                                │ k  your keys             │
                   │                                │ s  settings              │
                   │ 20:06     ● bob   │ got the in…│ y  your public key       │
                   │                   │ DHT, no se…│ f  +find                 │
                   │                   │            │ q  +quit                 │
                   │ 20:06       › you │ that is th…│ r  +room                 │
                   │                   │ when they …╰─ esc cancel ─────────────╯
╭─ #design ────────────────────────────────────────────────────────────────────╮
│ ›  i to write  ·  ␣ for the key menu  ·  : for a command                     │
╰──────────────────────────────────────────────────────────────────────────────╯
```

The key is the only thing on a row in the accent colour, because it is the only
thing you are looking for; `+` marks the ones that open another menu rather than
doing something, at the left edge of the label where they line up with each other.

`:` opens the same kind of window at the *top* of the chat pane, where vim's own
command line lives and where the transcript is not using the rows — a line to type
into, with the commands that match it underneath:

```
╭─ ▸ command ──────────────────────────────────────────────────────── 1/29 ─╮
│ :inv                                                                      │
├───────────────────────────────────────────────────────────────────────────┤
│ ❯ :invite         show this room's invite, in a window you can copy from  │
╰─ ⏎ run · ⇥ complete · ↑↓ move · esc cancel ───────────────────────────────╯
```

A floating window — a finder, settings, a key — is different: it is composited over
the middle of the frame, with the conversation still visible above and below it.

<br>

### Storage

Your messages live in Hypercore logs — that is the database, and it is what lets
openchat work with no server. Around them are two SQLite files (Node's built-in
`node:sqlite`, no extra dependency), and the difference between them matters.

`openchat.db`, one per machine, is **authoritative**. It is the list of accounts
you have, which one you are in, and for each of them the rooms it has joined, the
people it has names for and its settings. Nothing in it can be recomputed from
anywhere — the room keys in it are how you get back into a room — so it is written
with a full fsync and a schema it does not recognise is an error rather than an
excuse to start over. An account is a row in it: a directory that merely exists is
not an account, which is what stops a machine collecting profiles nobody meant to
make.

`index.db`, one per account, is **derived and disposable**: delete it and it
rebuilds on the next run, and nothing in it is ever sent to a peer. It exists for
the three things a log is bad at — searching everything you have ever been told,
remembering how far you had read, and doing both without walking the log.

```
~/.openchat/
  openchat.db     accounts, rooms, contacts, settings, the account in use
  profiles/<account>/
    identity.json your keypair — the only irreplaceable file here
    store/        Hypercore logs: the source of truth
    index.db      SQLite index: search and unread, rebuildable
```

<br>

### Joining a room

An invite is the whole credential: paste it into `:join` and you are in. There is no
approval step and nobody to ask — any member who is already online verifies your
signed join block and admits you, usually in a second or two.

The room opens immediately and you can look around it straight away. Being admitted
is the part that needs somebody else to be online, so it happens in the background
and the statusline says `waiting to be admitted` until it lands. Nothing is blocked
while you wait, and there is no deadline: if nobody is around right now, you are
admitted whenever one of them next appears.

<br>

### Leaving a room

`:leave` announces that you are going and removes the room from this machine.
`:delete` removes it silently, along with its local history and search index.

Neither reaches anyone else's copy, and openchat does not pretend otherwise:
there is no server to delete a room *from*. Every member holds the log, so the
people still in it keep the room and keep what you wrote. Leaving is leaving,
not erasure.

If you own a room and want it shut to newcomers, `:close` it before you go —
once you leave, nobody can admit anyone.

<br>

### Two accounts at once

An account can only be open in one place at a time — its log has a single writer,
so its storage takes an exclusive lock. Running `openchat` in two terminals is
therefore two *accounts*, not two windows onto one:

```bash
openchat work      # one terminal
openchat personal  # another
```

They share nothing: separate keypairs, separate storage, separate index. To
message one from the other, run `:whoami` in one and `:dm <that key>` in the
other — and only in one of them. The person you write to does not have to do
anything for your message to arrive.

<br>

### Finders

One fuzzy picker behind every `space f` binding: conversations, rooms, people, room
members, commands, keymaps, accounts, and the messages in front of you.

The matched characters light up, so you can see *why* something matched. Scoring
follows fzf's shape rather than a substring test — `dsg` puts `#design` above
`#wds-logging`, because a match that starts on a word boundary and runs almost
consecutively is the one you meant.

Public keys are matched as a **prefix**, not fuzzily. Every short query is a
subsequence of 64 hex characters, so fuzzy-matching keys would make every picker
return every row; pasting the front of a key still finds it.

<br>

### Keys

Space is the leader, and this is the whole of it — every binding openchat has.
`?` opens the same list in a window, and `space f k` searches it.

**Modes**

| | |
| --- | --- |
| `i`, `a` | write a message (INSERT) |
| `esc` | back to NORMAL |
| `space` | the key menu: everything you can press from here |
| `:` | the command line |
| `?` | the whole keymap, in a window |

**Finding**

| | |
| --- | --- |
| `space space`, `space f f` | find a room or conversation |
| `space ,` | switch conversation |
| `space f d` | find a person to message |
| `space f r` | find a room |
| `space f m` | find a member of this room |
| `space f c` | commands |
| `space f k` | keymaps |
| `space f a` | accounts |
| `space f s`, `/` | search everything anyone has said |

**Rooms and people**

| | |
| --- | --- |
| `space r n` | new room |
| `space r j` | join with an invite |
| `space r i` | invite someone to this room |
| `space r m` | list the members |
| `space k` | your keys, and the phrase behind them |
| `space y` | your public key |

**Moving around**

| | |
| --- | --- |
| `shift+tab`, `]b` / `[b`, `L` / `H` | next / previous conversation |
| `gd` | newest unread |
| `space e`, `ctrl-e` | the conversation list: `j`/`k` move, `⏎` opens, `esc` returns |
| `ctrl-u` / `ctrl-d`, `page up` / `page down` | read back through the conversation |
| `gg` / `G` | jump to the start / to the newest |

**Windows and toggles**

| | |
| --- | --- |
| `space s` | settings |
| `space a` | accounts |
| `space ?` | help |
| `space u t` / `space u c` | toggle timestamps / compact lines |
| `space u m` | toggle mouse capture |
| `space u e` | toggle the conversation list |
| `space q q`, `ZZ` | quit |
| `Ctrl+P` `Ctrl+K` `Ctrl+G` `Ctrl+O` | finder, command line, settings, accounts — from either mode |

The last row is the point of the ctrl chords: insert mode is the default, so anything
worth reaching mid-sentence has one and you never have to leave the message you are
writing to switch room.

While typing, the bindings are readline's: `Ctrl+A`/`Ctrl+E` for the ends of the
line, `Ctrl+W` to delete a word, `Ctrl+U` to clear it, and ↑/↓ through what you have
already sent. The command line has the same bindings, its own history on `Ctrl+P` /
`Ctrl+N`, and filters fuzzily as you type — `:dl` finds `:download`, Tab completes
the highlighted one and leaves the cursor where its argument goes. Type something
that is not a command name and it searches what commands *do* instead, so `:palette`
finds `:theme`.

<br>

### Settings

`space s`, or `:settings`. Stored **per account**, written as you change them, and
applied immediately.

| | |
| --- | --- |
| **Appearance** | Theme, timestamp format, compact lines, Nerd Font icons, startup banner |
| **Keys** | Start in normal mode, mouse behaviour, which-key delay |
| **Privacy** | Auto-download limit, full or abbreviated public keys, presence, bell |

Eight palettes ship, all of them real terminal themes rather than inventions: Tokyo
Night (storm and night), Catppuccin Mocha, Catppuccin Latte for a light terminal,
Gruvbox Dark, Rosé Pine, Nord, and a monochrome one that leaves your terminal's own
colours alone. `:theme <name>` switches without opening anything.

Showing public keys abbreviated is the setting worth knowing about: it is there for
when you are sharing a screen.

<br>

### Mouse

Clicks, wheel scrolling and click-outside-to-dismiss work inside every floating
window. A float knows its own position on screen to the row, which is what makes a
click land on the line you saw under the pointer.

Outside them, mouse reporting is **off by default, on purpose**. While a terminal is
reporting the mouse it stops letting you select text, and selecting a message to copy
it is worth more than clicking one. So reporting is switched on when a float opens
and handed straight back when it closes.

`mouse: always` in settings takes the other trade: the wheel scrolls the transcript
and clicking a room in the conversation list opens it.

The reports are filtered out of stdin before Ink ever sees them, so a click can
never end up typed into your message.

<br>

---

## Accounts

An account is a **username and a keypair**. There is no directory to register in and
nobody to register with: the username is a label on a directory of your own keys, and
the key is who you actually are on the wire.

Each account has its own storage, rooms, contacts and settings, and **nothing is
shared between two of them** — which is the entire point of having a second one.

```
╭─◆ Accounts ─────────────────────────────────────────────── 2 ─╮
│ each one is its own keypair — nothing is shared between them  │
├───────────────────────────────────────────────────────────────┤
│ ❯ ● work      ada      03d35f4c5d0f…                   in use │
│   · alias     nobody   9f21ab77c410…                  2 rooms │
│ ⏎ switch · n new · esc close                                  │
╰───────────────────────────────────────────────────────────────╯
```

`space a` or `:accounts` opens it.

- **⏎ switches.** The swarm and every core close, and a different keypair comes up in
  their place. It is a real teardown, not a change of label.
- **n makes a new one** — a username, a display name, and a fresh key. It shows you
  the recovery phrase and will not move on until you say you have written it down.

There is no way in. openchat generates a keypair on the machine that uses it and
never reads one back, so an account here has never existed anywhere else and cannot
be carried onto a second machine.

You can also run two at once, one per terminal:

```bash
openchat work        # terminal one
openchat personal    # terminal two
```

A name this machine has not seen is a new account: openchat walks you through
generating its key rather than complaining that it does not exist. `openchat --list`
shows what is already here, and `--profile <name>` is the same thing as the bare
argument for anyone who has it in a script. `OPENCHAT_PROFILE` does that job from the
environment, so a terminal can be pinned to an account by exporting it once.

`:whoami` in one gives you its public key; `:dm <key>` in the other opens a
conversation.

<br>

---

## Rooms and direct messages

### Finding people

There is no global user directory, because there is no server to hold one. You reach
someone because you have their **public key**, and there are three ways to get one:

- **A room you share.** `space f m` or `:members` lists everyone's key, and you can
  DM any of them. In practice this is how most conversations start.
- **A contact you saved.** `:add <key> <name>`, then `:dm <name>` from then on.
- **A key they gave you.** `:whoami` prints yours; hand it over however you like.

Nobody can enumerate users, and nobody can cold-message you without your key.

<br>

### Direct messages

A DM needs no invite at all. Both identities are Ed25519 keys, which convert to
X25519, so each side runs Diffie-Hellman against the other's *public* key and
independently derives the same secret. Nothing is transmitted and nothing is
negotiated:

```
:dm 03d35f4c5d0f36a0…          # or a contact name, once you have saved one
```

From that shared secret openchat derives the discovery topic **and** the encryption
key. Deriving the topic from a secret is the interesting part: a third party watching
the DHT cannot compute it, so they cannot tell the conversation exists, let alone
read it. Contrast a room, whose topic is public by design.

Structurally a DM is not an Autobase. With two participants there is nothing to
linearize across an unknown writer set — each side appends to its own outbox core,
both read both, and `protocol/order.js` merges them. Same ordering rule as rooms, so
both people always see the same conversation.

<br>

### Rooms you own

The person who opens a room owns it. Ownership is established by the log itself: the
creator's own membership record is the first one written, so it needs no separate
ceremony, and every member independently agrees who the owner is.

```
:close              stop new members joining (existing ones keep talking)
:reopen             let the invite work again
:transfer <who>     hand the room over — you lose control immediately
:remove <who>       remove a member; their history stays
:allow <who>        undo a removal
```

Removal is **recorded in the room's log**, not just acted on once. That matters
because a removed member still holds the invite: without the record they would simply
ask to join again and any honest client would relay them back in.

Only the owner can do these, and that is checked by *every* member's client when
applying the block, not just by the owner's.

> One honest caveat: `:close` is enforced by members' clients refusing to relay a
> newcomer's join. A member running a modified client could still let someone in,
> exactly as they could hand out the invite again. It is not a cryptographic seal.
> `:remove` **is** enforced by the log.

<br>

### Attachments

`:file <path>` sends one. Metadata goes into the log; the bytes live in a Hyperblobs
core and are fetched on demand, with a real progress bar driven by the transfer
rather than a timer. Files under the auto-download limit (5 MB by default, a setting)
arrive by themselves; larger ones wait for `:download <id>`.

The sender's sha256 is verified after every fetch, and incoming filenames are
sanitised before they touch your download directory.

<br>

---

## Commands

```
openchat                     open the account you used last
openchat <account>           open that account, and create it if it is new
openchat --list              the accounts on this machine
openchat --profile <name>    the same as `openchat <account>`
openchat --help              this message
openchat --version           print the version
```

That is the entire shell surface — it picks an account and nothing else. Everything
else is a command inside the app, typed after `:`.

A bare word that is also the name of a command is taken as somebody reaching for the
command, not as an account: `openchat whoami` points you at `:whoami` rather than
quietly making an account called whoami. An account that already exists always wins,
so if you do have one called that, it opens.

<table>
<tr>
<td width="50%" valign="top">

**Talking**

```
:dm <key|name>      message someone directly
:new <name>         open a new room you own
:join <invite>      join a room from an invite
:invite             this room's invite, in a window
:switch <name>      jump to a conversation
:rooms              find something you have open
:members            list the members of this room
:file <path>        send a file
:download <id>      fetch an attachment you skipped
```

**People**

```
:contacts           list the people you have saved
:add <key> [name]   save someone as a contact
:nick <name>        set your display name
:whoami             your keys, in a window
```

</td>
<td width="50%" valign="top">

**Interface**

```
:find               fuzzy-find a conversation
:settings           open settings
:theme <name>       change the palette
:keys               show the keymap
:help               list every command
:quit               leave and exit
```

**Accounts**

```
:accounts           switch, or make another one
:profiles           list the accounts here
:backup             your recovery phrase, in a window
```

**Owner only**

```
:close  :reopen     close or reopen this room
:transfer <who>     hand the room over
:remove <who>       remove a member
:allow <who>        let them back in
```

</td>
</tr>
</table>

Several rooms and DMs stay open at once. **Shift+Tab** moves between them without
leaving the message you are writing, `space f f` finds one by name, and the
statusline shows how many messages are waiting elsewhere.

<br>

---

## Security model

**The discovery topic and the encryption key are separate, and only one of them is
public.** This split is the whole design, so it is worth being precise about:

- The **topic** is `sha256("openchat:topic:v1" || roomKey)`. It is announced to the
  DHT, which means anyone can look it up, find the swarm, and open a connection to
  your room. That is expected and fine.
- The **encryption key** is 32 random bytes generated when the room is created. It
  encrypts every Hypercore in the room and every message envelope. It is never
  announced, never derived from anything public, and never sent over the network.

A stranger who discovers your room on the DHT can connect and will read nothing.
There is a test for exactly this — `test/integration/room.test.js`, *"a peer without
the encryption key cannot read the room"*.

**An invite carries both.** That is what makes it work, and what makes it dangerous:
an invite string is not a link, it is the key to the room. Treat it like a password.
Anyone who sees it — in a screenshot, a pasted log, a group chat you forgot was
public — is a member.

**Identity** is an Ed25519 keypair derived from a 32-byte seed stored at
`~/.openchat/profiles/<name>/identity.json` with `0600` permissions. Only the seed is
saved; the keypair is re-derived on load, which is why `:backup` can hand you the seed
as a BIP39 phrase. That phrase **is** your identity — anyone with it can post as you.
openchat itself never reads one back: there is no restore, so `identity.json` is the
only copy of an account this program will ever make or accept.

**Every message is signed and encrypted.** The envelope
([`src/protocol/envelope.js`](src/protocol/envelope.js)) is:

```
magic(3) | version(1) | author(32) | iv(12) | len(4) | ciphertext(len) | signature(64)
```

AES-256-GCM for the body, Ed25519 over the header and ciphertext. Signing the
ciphertext rather than the plaintext lets a receiver throw out a forged frame before
spending anything decrypting it. On the way in, the signature is checked **and** the
decrypted message's author field is checked against the key that signed it, so a
member cannot post under someone else's name.

The author's public key is deliberately in the clear. Room membership is already
known to everyone holding the invite, and it is what makes verify-before-decrypt
possible — but it does mean someone observing the transport sees which keys are
talking, without learning what they said.

<br>

### Known limitations

These are deliberate, and stated plainly because a security tool that hides its edges
is worse than one that has them.

| | |
| --- | --- |
| **Anyone with the invite becomes a writer** | There is no admin approval on join. A leaked invite is a leaked room — `:remove` keeps someone out afterwards, but it does not un-leak the invite. Admin-gated membership is the next security milestone. |
| **Someone must be online to admit a newcomer** | Joining needs an existing writer to receive the request and append it. If every member is offline, a new member waits. |
| **No forward secrecy** | One long-lived key encrypts everything in a room or a DM. Someone who obtains it can read that conversation's whole history. |
| **`:close` is client-enforced** | See [Rooms you own](#rooms-you-own). `:remove` is enforced by the log; `:close` is not. |
| **A DM partner can write freely into their own outbox** | That is the point, but it means the only spam control in a DM is not giving out your key. |
| **`Room._refresh()` re-reads the whole range** | Fine for a few thousand messages, and the first thing to make incremental if a room outgrows it. |
| **Both people must be online at once** | There is no store-and-forward, because there is nowhere for a message to wait. A message written while the other side is offline sits in the sender's outbox and lands the next time the two of you overlap. |
| **A lost machine is a lost account** | openchat generates a keypair where it is used and never reads one back — there is no restore. The recovery phrase is the seed written down, but nothing in this program will turn it back into an identity, so `identity.json` is the only copy of an account that exists. |
| **Public DHT connectivity is not exercised in CI** | Tests run against a local DHT testnet. Real internet discovery and NAT traversal should be verified on real machines before trusting it. |

<br>

---

## Architecture

Source is split into two tiers, and the split is **enforced by a test** rather than
by convention.

| Tier | Location | Contents |
| --- | --- | --- |
| **Shared** | `src/protocol/`<br>`src/ui/model/` | Message schema and codecs, the encrypted envelope, causal ordering, invite encode/decode, command parsing, the chat state reducer — and the interface's own logic: the fuzzy matcher, the keymap and its chord resolver, the message buffer, the settings schema, the float geometry. No Node built-ins, no native modules. |
| **Runtime** | `src/core/`<br>`src/ui/ink/` | Corestore, Hypercore, Autobase, Hyperswarm, Hyperblobs, sodium-native, and the Ink components. |

Two tests hold this together:

- **`test/unit/portability.test.js`** fails if anything in the shared tier imports a
  Node built-in, a native module, or anything from the runtime tier. It is what
  keeps the wire format and the view-model readable, testable and reviewable
  without a DHT, a swarm or a terminal in the way.
- **`test/unit/vectors.test.js`** runs both crypto backends — sodium + `node:crypto`
  on one side, WebCrypto + `@noble` on the other — and asserts they produce
  byte-identical frames and can each decrypt what the other sealed.

<br>

<table>
<tr>
<td width="50%" valign="top">

#### Rooms are an Autobase

A room is an Autobase of per-member writer cores, linearized into a Hyperbee of
sealed envelopes (`src/core/room.js`). Many writers, one causally ordered transcript,
and an offline member replays what they missed on reconnect.

</td>
<td width="50%" valign="top">

#### Joining needs a handshake

Corestore replicates cores *by key*, so an existing member has no way to discover a
newcomer's core — a join request appended optimistically is invisible to everyone.
Instead a joiner broadcasts a signed JOIN block over a Protomux channel multiplexed
onto the same connection (`src/core/pairing.js`), and any writer verifies and appends
it.

</td>
</tr>
<tr>
<td width="50%" valign="top">

#### One ordering rule

Lamport clock, then wall clock, then author key, then id
(`src/protocol/order.js`). Every message set goes through it and nothing else
sorts a transcript, so two members cannot end up seeing different ones.

</td>
<td width="50%" valign="top">

#### One keypress handler

A modal interface has to decide what a key *means* before anything acts on it, so
nothing but `src/ui/ink/App.jsx` reads stdin — which is why the message buffer
(`src/ui/model/editor.js`) is a pure reducer rather than a text-input widget. A widget
that grabs stdin types `p` into your message when you meant Ctrl-P, and nothing
outside it can take that back.

</td>
</tr>
<tr>
<td width="50%" valign="top">

#### Floats know their own position

Terminals report a click as an absolute row and column, and no layout engine hands a
component its coordinates. `src/ui/model/layout.js` computes them up from the bottom
of the screen, and the renderer and the hit test read that one function — the only
way a click and the row under the pointer can be guaranteed to agree.

</td>
<td width="50%" valign="top">

#### Accounts are read, not opened

`src/core/accounts.js` reads the profile directories directly rather than opening
each one's hypercore store, so listing your accounts does not cost a disk full of
cores being opened and closed.

</td>
</tr>
</table>

<br>

---

## Development

```bash
npm install
npm run build        # bundle to dist/
npm run dev          # rebuild on change
npm run check        # lint + the full test suite
npm run shot         # screenshots of the real UI, into shots/
```

`npm run shot` drives two real clients on a local DHT, renders the real Ink app
into a harness, and paints the ANSI frames it produces in a headless browser —
so a screenshot that looks wrong is the interface looking wrong, not a mockup
drifting from it. Pass a filter to take only some of them: `npm run shot -- keys`.

### Trying it without a second machine

```bash
npm run demo
```

A guided tour on one machine with no network: two real accounts, two real clients,
the real Ink UI, and a local DHT. It opens a room, joins it from the second account,
sends a DM derived from nothing but a public key, switches between conversations,
closes the room and watches a valid invite get refused, transfers ownership, and
sends a file. Every frame it prints came out of the actual app.

### Testing

```bash
npm test
```

**165 tests, no network needed.** Unit tests cover the codecs, invites, ordering
determinism under shuffled input, the crypto vectors, the portability lint, the fuzzy
matcher, the keymap and chord resolver, the message buffer, float and dock geometry,
and the mouse parser. Integration tests run two or three real clients against a local
`hyperdht` testnet and cover two-peer chat, join-by-invite, an offline member
replaying what it missed, the encryption boundary, attachment transfer, room
ownership, account switching, and the Ink UI rendered against live peers.

The tests pin the DHT to `127.0.0.1`. Sandboxed containers often have an outward
interface with an address the host cannot reach itself on, and hyperdht will announce
it and then fail to connect; binding to loopback keeps the local testnet
self-consistent.

<br>

---

<div align="center">

Built on the Holepunch stack —
[Hyperswarm](https://github.com/holepunchto/hyperswarm) ·
[Hypercore](https://github.com/holepunchto/hypercore) ·
[Autobase](https://github.com/holepunchto/autobase) ·
[Hyperblobs](https://github.com/holepunchto/hyperblobs) ·
[Ink](https://github.com/vadimdemedes/ink)

<br>

[![Report an issue](https://img.shields.io/badge/Report_an_issue-GitHub-24292F?style=for-the-badge&logo=github&logoColor=white)](https://github.com/n3xtpy/Openchat/issues)
[![Get in touch](https://img.shields.io/badge/Get_in_touch-contact@n3xt--agency.com-1D9470?style=for-the-badge&logoColor=white)](mailto:contact@n3xt-agency.com)

<br>

**N3XT Agency**<br>
[n3xt-agency.com](https://n3xt-agency.com) · [contact@n3xt-agency.com](mailto:contact@n3xt-agency.com)

<sub>openchat is open source under the [MIT License](LICENSE).<br>
Encryption is only as good as the invites you hand out — read the [security model](#security-model) before you rely on it.</sub>

</div>
