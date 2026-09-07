// What the chat pane shows when there is no conversation in it.
//
// It hands back rows rather than a box, for the same reason every other pane
// does — the screen has a fixed height, and a welcome message that does not
// know how tall it is will push the prompt off the bottom of a short terminal.
// The rows are ordered least to most useful from the top, so a pane too short
// for all of them can drop from the front and still be worth reading.
//
// There used to be a block-letter OPENCHAT across the top of it. It is gone.
// Figlet art is a logo drawn by someone who only had one font, it is the widest
// thing on the screen in an app whose whole point is the column to its right,
// and it broke into pieces every time the pane got narrow. What replaces it is
// a wordmark, a rule and a line of prose — which is what the top of a page has
// looked like since long before anyone had a terminal.

import React from 'react'
import { Text } from 'ink'

import { truncate, width as visibleWidth } from '../model/text.js'
import { shortKey } from '../model/format.js'

/** The chords worth knowing on your first day, grouped by what you want. */
const SECTIONS = [
  ['start', [
    ['␣ f d', 'message someone by their public key'],
    ['␣ r n', 'a new room of your own'],
    ['␣ r j', 'join a room from an invite']
  ]],
  ['find', [
    ['␣ f f', 'any room or conversation'],
    ['␣ f s', 'search everything anyone has said'],
    ['␣ k', 'your keys, and the phrase behind them']
  ]]
]

const KEY_COLUMNS = 7

/**
 * @param {object} props
 * @param {number} props.columns   width of the pane
 * @param {boolean} [props.logo]   false for just the facts
 * @returns {React.ReactElement[]}  one element per row
 */
export function welcomeRows ({ theme, self, profile, version, columns, logo = true }) {
  const icons = theme.icons
  const rows = []
  const inner = Math.max(12, columns - 2)
  const cut = (text) => truncate(text, inner)
  const add = (node) => rows.push(<Text key={`w-${rows.length}`} wrap='truncate-end'>{node}</Text>)
  const blank = () => add(<Text> </Text>)

  if (logo) {
    // The wordmark, the version, and a rule under both. Everything is measured
    // rather than padded to a guess, because the rule is the only thing on the
    // screen whose length is decided by what is next to it.
    const stamp = version ? `v${version}` : ''
    const gap = Math.max(1, inner - 'openchat'.length - visibleWidth(stamp))

    // Two words in two colours rather than one word in one. It is the cheapest
    // wordmark there is — no glyph a font might not have, no row of block
    // characters that falls apart when the pane is narrow — and it is the only
    // thing on this screen that is decoration rather than information, so it
    // gets exactly one line and no more.
    add(
      <Text>
        <Text color={theme.accent} bold>open</Text>
        <Text color={theme.accent2} bold>chat</Text>
        <Text>{' '.repeat(gap)}</Text>
        <Text color={theme.subtle}>{stamp}</Text>
      </Text>
    )
    add(<Text color={theme.border}>{'─'.repeat(inner)}</Text>)
    add(
      <Text color={theme.dim}>
        {cut(`end-to-end encrypted ${icons.sep} no server ${icons.sep} no account`)}
      </Text>
    )
    blank()
  }

  // Who you are, in the two lines that answer it: the name a room shows, and
  // the key that name is standing in for. The key is abbreviated on purpose —
  // the whole thing lives one keypress away, in a window, where it can be
  // copied rather than read off a wrapped line. See KeyFloat.jsx.
  add(
    <Text>
      <Text color={theme.subtle}>{'you  '}</Text>
      <Text color={theme.accent2} bold>{self?.nick || 'anonymous'}</Text>
      <Text color={theme.subtle}>{`  ${icons.account} ${profile || 'default'}`}</Text>
    </Text>
  )
  add(
    <Text>
      <Text color={theme.subtle}>{'key  '}</Text>
      <Text color={theme.dim}>{shortKey(self?.publicKey, 16) || '—'}</Text>
      <Text color={theme.subtle}>{self?.publicKey ? `${icons.ellipsis}  ${icons.sep}  ` : '  '}</Text>
      <Text color={theme.accent}>␣ k</Text>
      <Text color={theme.subtle}> for all of it</Text>
    </Text>
  )
  blank()

  for (const [heading, hints] of SECTIONS) {
    add(<Text color={theme.subtle} bold>{heading.toUpperCase()}</Text>)
    for (const [keys, label] of hints) {
      add(
        <Text>
          <Text color={theme.accent}>{`  ${keys.padEnd(KEY_COLUMNS)}`}</Text>
          <Text color={theme.dim}>{cut(label)}</Text>
        </Text>
      )
    }
    blank()
  }

  add(
    <Text color={theme.subtle}>
      <Text color={theme.accent}>␣</Text>
      {' every key, with a menu    '}
      <Text color={theme.accent}>?</Text>
      {' the whole keymap'}
    </Text>
  )

  return rows
}
