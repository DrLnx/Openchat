// What the chat pane shows when there is no conversation in it, and what it
// shows when there is one and nobody has said anything yet.
//
// Both hand back rows rather than a box, for the same reason every other pane
// does — the screen has a fixed height, and a welcome message that does not
// know how tall it is will push the prompt off the bottom of a short terminal.
// The rows are ordered least to most useful from the top, so a pane too short
// for all of them can drop from the front and still be worth reading.
//
// The top of it is the one place in openchat that is allowed to be decoration:
// the first thing you see after setup is an empty app, and an empty app that
// says nothing about itself is indistinguishable from a broken one. So it signs
// its name in block letters, in the two colours the rest of the interface is
// drawn in.
//
// A figlet banner was tried once and taken out again, for two good reasons that
// are worth keeping in mind rather than repeating: it was the widest thing on
// the screen in an app whose whole point is the column to its right, and it
// broke into pieces the moment the pane got narrow. This one answers both. It
// is three rows of half-block glyphs rather than six of ASCII, thirty-seven
// columns rather than seventy, and it is drawn only when the pane has the room
// for it — otherwise the one-line wordmark takes its place and nothing below
// moves. Rows are ordered least to most useful from the top, and a pane too
// short drops from the front, so the logo is also the first thing to go.

import React from 'react'
import { Text } from 'ink'

import { truncate, fit, width as visibleWidth } from '../model/text.js'
import { shortKey, conversationLabel } from '../model/format.js'

/**
 * openchat, three sizes.
 *
 * A logo is the one thing on this screen that is decoration rather than
 * information, so it gets exactly as much room as the terminal can spare and
 * not one column more. `BIG` is the wordmark somebody screenshots; `SMALL` is
 * the same name in three rows of half blocks for a pane that cannot hold it;
 * and below that a single line of text, which is still a wordmark.
 *
 * Each is drawn in two colours split at a fixed column — `open` in one, `chat`
 * in the other — the same split the rest of the interface uses.
 */
const BIG = {
  rows: [
    ' ██████╗ ██████╗ ███████╗███╗   ██╗ ██████╗██╗  ██╗ █████╗ ████████╗',
    '██╔═══██╗██╔══██╗██╔════╝████╗  ██║██╔════╝██║  ██║██╔══██╗╚══██╔══╝',
    '██║   ██║██████╔╝█████╗  ██╔██╗ ██║██║     ███████║███████║   ██║   ',
    '██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║██║     ██╔══██║██╔══██║   ██║   ',
    '╚██████╔╝██║     ███████╗██║ ╚████║╚██████╗██║  ██║██║  ██║   ██║   ',
    ' ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝ ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   '
  ],
  columns: 68,
  split: 35,
  /** Rows the pane needs before this is worth its height. */
  needs: 26
}

const SMALL = {
  rows: [
    '█▀▀█ █▀▀█ █▀▀▀ █▀▀█ █▀▀ █  █ █▀▀█ ▀█▀',
    '█  █ █▄▄█ █▀▀  █  █ █   █▀▀█ █▄▄█  █ ',
    '▀▀▀▀ █    ▀▀▀▀ ▀  ▀ ▀▀▀ ▀  ▀ ▀  ▀  ▀ '
  ],
  columns: 37,
  split: 20,
  needs: 21
}

/** The key column in every list on this screen. */
const KEY_COLUMNS = 7

/**
 * The three things somebody has to do before openchat does anything for them,
 * in the order they have to do them.
 *
 * Not a feature list. Every line is a key you press and what happens when you
 * do, because the failure this screen exists to prevent is somebody sitting in
 * front of a working app with nothing to type into it.
 */
const STEPS = [
  ['␣ r n', 'make a room — you own it, and nothing anywhere lists it'],
  ['␣ r i', 'share its invite out of band: the invite is the room key'],
  ['␣ f d', 'or skip rooms and message anyone by their public key']
]

/** The keys worth knowing on day one, in the order you will want them. */
const KEYS = [
  ['␣', 'every key, in a menu'],
  ['␣ f f', 'find a conversation'],
  ['?', 'the whole keymap'],
  ['␣ f s', 'search what was said'],
  [':', 'a command'],
  ['␣ k', 'your keys']
]

/**
 * @param {object} props
 * @param {number} props.columns   width of the pane
 * @param {number} [props.rows]    height of the pane, which decides the logo
 *                                 and where the block sits in it
 * @param {boolean} [props.logo]   false for just the facts
 * @returns {React.ReactElement[]}  one element per row
 */
export function welcomeRows ({
  theme, self, profile, version, columns, rows: height = Infinity, logo = true
}) {
  const icons = theme.icons
  const inner = Math.max(12, columns - 2)

  // A pane this short cannot have everything, and what it gives up first is the
  // labelling rather than the content: `START HERE` above three numbered lines
  // is a heading over something that is already obviously a list.
  const tight = Number.isFinite(height) && height < 20

  // Every row is measured as it is built rather than guessed at afterwards.
  // Centring is the whole layout of this screen, and a row whose width is a
  // guess is a row that centres the block one column out.
  const block = []
  const add = (node, width) => block.push({ node, width })
  const blank = () => add(<Text> </Text>, 0)

  if (logo) {
    const art = [BIG, SMALL].find((a) => inner >= a.columns && height >= a.needs)

    if (art) {
      for (const line of art.rows) {
        add(
          <Text>
            <Text color={theme.accent} bold>{line.slice(0, art.split)}</Text>
            <Text color={theme.accent2} bold>{line.slice(art.split)}</Text>
          </Text>,
          art.columns
        )
      }
    } else {
      add(
        <Text>
          <Text color={theme.accent} bold>open</Text>
          <Text color={theme.accent2} bold>chat</Text>
        </Text>,
        8
      )
    }

    blank()

    // What openchat is, in one line, and what build of it this is. Three claims
    // and a version number is the whole of what a title screen owes anyone.
    const claims = `end-to-end encrypted ${icons.sep} no server ${icons.sep} no account`
    const stamp = version ? ` ${icons.sep} v${version}` : ''
    add(
      <Text color={theme.dim}>
        {truncate(claims, inner)}
        <Text color={theme.subtle}>{stamp}</Text>
      </Text>,
      Math.min(inner, visibleWidth(claims) + visibleWidth(stamp))
    )
    blank()
  }

  // Who you are, in the same chrome every window in the app wears: the name a
  // room shows set into the top border, the account it belongs to at the other
  // end of it, and the key that name stands for on the one row inside. It is
  // the answer to "who will people see, and how do they reach me", and putting
  // it in a frame says it is a fact about you rather than another key to press.
  const name = truncate(self?.nick || 'anonymous', 20)
  const account = `${icons.account} ${profile || 'default'}`.trim()
  const rule = (n) => '─'.repeat(Math.max(0, n))

  const key = self?.publicKey ? `${shortKey(self.publicKey, 24)}${icons.ellipsis}` : '—'
  const hint = 'your keys, and the phrase behind them'

  // Wide enough for whichever of its three lines is longest, and no wider. A
  // frame with a rule running half its length past the end of what is in it
  // reads as a box somebody forgot to fill.
  const card = Math.min(inner, Math.max(
    24,
    visibleWidth(name) + visibleWidth(account) + 8,
    visibleWidth(key) + 4,
    visibleWidth(hint) + 10
  ))

  add(
    <Text>
      <Text color={theme.border}>{'╭─ '}</Text>
      <Text color={theme.accent2} bold>{name}</Text>
      <Text color={theme.border}>
        {` ${rule(card - 8 - visibleWidth(name) - visibleWidth(account))} `}
      </Text>
      <Text color={theme.subtle}>{account}</Text>
      <Text color={theme.border}>{' ─╮'}</Text>
    </Text>,
    card
  )

  add(
    <Text>
      <Text color={theme.border}>{'│ '}</Text>
      <Text color={theme.dim}>{fit(key, card - 4)}</Text>
      <Text color={theme.border}>{' │'}</Text>
    </Text>,
    card
  )

  add(
    <Text>
      <Text color={theme.border}>{'╰─ '}</Text>
      <Text color={theme.accent} bold>␣ k</Text>
      <Text color={theme.dim}>{` ${hint} `}</Text>
      <Text color={theme.border}>{`${rule(card - 10 - visibleWidth(hint))}─╯`}</Text>
    </Text>,
    card
  )
  blank()

  // --- what to do first ---------------------------------------------------

  if (!tight) add(<Text color={theme.subtle} bold>START HERE</Text>, 10)

  const stepLabel = Math.max(...STEPS.map(([, label]) => visibleWidth(label)))
  STEPS.forEach(([keys, label], i) => {
    add(
      <Text>
        <Text color={theme.accent2}>{`${i + 1}  `}</Text>
        <Text color={theme.accent}>{fit(keys, KEY_COLUMNS)}</Text>
        <Text color={theme.dim}>{truncate(label, Math.max(8, inner - KEY_COLUMNS - 3))}</Text>
      </Text>,
      3 + KEY_COLUMNS + Math.min(stepLabel, Math.max(8, inner - KEY_COLUMNS - 3))
    )
  })
  blank()

  // --- and how to find everything else -------------------------------------

  if (!tight) add(<Text color={theme.subtle} bold>KEYS</Text>, 4)

  const keyLabel = Math.max(...KEYS.map(([, label]) => visibleWidth(label)))
  const cell = KEY_COLUMNS + keyLabel
  // Two columns where there is room for two, one where there is not. Six keys
  // down the middle of a wide screen is a column of text with nothing beside
  // it; six keys across a narrow one is a wrapped mess.
  const perRow = inner >= cell * 2 + 3 ? 2 : 1

  for (let i = 0; i < KEYS.length; i += perRow) {
    const pair = KEYS.slice(i, i + perRow)
    add(
      <Text>
        {pair.map(([keys, label], j) => (
          <Text key={keys}>
            {j > 0 ? <Text>{'   '}</Text> : ''}
            <Text color={theme.accent} bold>{fit(keys, KEY_COLUMNS)}</Text>
            <Text color={theme.dim}>{fit(label, keyLabel)}</Text>
          </Text>
        ))}
      </Text>,
      pair.length * cell + (pair.length - 1) * 3
    )
  }
  blank()

  // The one thing about openchat that surprises people, said once, here, rather
  // than discovered when a message appears to go nowhere. There is no server
  // holding anything for you — that is the point of it and also the catch.
  const note = 'you both have to be online — nothing is held anywhere in between'
  add(
    <Text color={theme.subtle}>
      {`${icons.lock} `}{truncate(note, Math.max(8, inner - 2))}
    </Text>,
    2 + Math.min(visibleWidth(note), Math.max(8, inner - 2))
  )

  // --- centred, in both directions -----------------------------------------
  //
  // The block is centred as a *block*: one indent applied to every row, so the
  // card, the numbers and the key columns keep the edges they were laid out
  // against. Centring each row on its own would leave nothing lining up with
  // anything.
  const widest = block.reduce((n, row) => Math.max(n, row.width), 0)
  const indent = ' '.repeat(Math.max(0, Math.floor((inner - widest) / 2)))

  const rows = block.map((row, i) => (
    <Text key={`w-${i}`} wrap='truncate-end'>{indent}{row.node}</Text>
  ))

  return centreVertically(rows, height)
}

/**
 * Sit the block in the middle of the pane rather than on the floor of it.
 *
 * The transcript is anchored to the bottom of its pane, which is right for a
 * conversation and wrong for this: with nothing open, the app was a logo and a
 * card jammed against the prompt under half a screen of nothing. Returning
 * exactly as many rows as the pane has puts the block in the middle of it and
 * leaves the anchoring alone.
 */
function centreVertically (rows, height) {
  if (!Number.isFinite(height) || rows.length >= height) return rows

  const above = Math.floor((height - rows.length) / 2)
  const spacer = (where, count) => Array.from(
    { length: count },
    (_, i) => <Text key={`${where}-${i}`}> </Text>
  )

  return [
    ...spacer('above', above),
    ...rows,
    ...spacer('below', height - rows.length - above)
  ]
}

/**
 * A conversation that is open and has nothing in it.
 *
 * An empty pane is the one screen in a chat client that can look broken while
 * working perfectly: you joined the room, you are connected, and there is
 * simply nothing to draw. So it says so, and says what the next keypress is —
 * which for a room you just made is inviting somebody, and for a direct
 * message is the fact that nobody but the two of you can ever read it.
 *
 * @returns {React.ReactElement[]}  one element per row
 */
export function emptyRows ({ theme, room, columns, owned = false }) {
  const icons = theme.icons
  const rows = []
  const inner = Math.max(12, columns - 2)
  const add = (node) => rows.push(<Text key={`e-${rows.length}`} wrap='truncate-end'>{node}</Text>)
  const blank = () => add(<Text> </Text>)

  const label = conversationLabel(room.kind, room.name)
  const dm = room.kind === 'dm'

  add(
    <Text>
      <Text color={theme.accent} bold>{truncate(label, inner)}</Text>
    </Text>
  )
  add(<Text color={theme.border}>{'─'.repeat(Math.min(inner, Math.max(8, visibleWidth(label) + 8)))}</Text>)
  blank()

  add(
    <Text color={theme.dim}>
      {truncate(
        dm
          ? 'The start of a direct conversation. Its key comes from your two keys, so nobody else can derive it — not a server, because there is not one.'
          : owned
            ? 'You made this room and nobody else is in it yet. An invite is the only way in.'
            : 'Nothing has been said here yet.',
        inner
      )}
    </Text>
  )
  blank()

  for (const [keys, hint] of dm
    ? [['⏎', 'say something — it is delivered the moment they are online']]
    : [
        ['␣ r i', 'invite someone — the string is the room key, so share it carefully'],
        ['␣ r m', 'see who is already in it'],
        ['⏎', 'say the first thing']
      ]) {
    add(
      <Text>
        <Text color={theme.accent}>{`  ${keys.padEnd(KEY_COLUMNS)}`}</Text>
        <Text color={theme.subtle}>{truncate(hint, Math.max(4, inner - KEY_COLUMNS - 2))}</Text>
      </Text>
    )
  }

  blank()
  add(<Text color={theme.subtle}>{`${icons.lock} everything in here is encrypted before it leaves this machine`}</Text>)

  return rows
}
