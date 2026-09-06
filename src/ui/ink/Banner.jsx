// What the chat pane shows when there is no conversation in it: the logo, who
// you are, and the four keys that get you somewhere.
//
// It hands back rows rather than a box, for the same reason every other pane
// does — the screen has a fixed height, and a welcome message that does not
// know how tall it is will push the prompt off the bottom of a short terminal.
// The rows are ordered least to most useful from the top, so a pane too short
// for all of them can drop from the front and still be worth reading.

import React from 'react'
import { Text } from 'ink'

import { truncate } from '../model/text.js'

const LOGO = [
  '┌─┐┌─┐┌─┐┌┐┌┌─┐┬ ┬┌─┐┌┬┐',
  '│ │├─┘├┤ ││││  ├─┤├─┤ │ ',
  '└─┘┴  └─┘┘└┘└─┘┴ ┴┴ ┴ ┴ '
]

const HINTS = [
  ['␣ f f', 'find a room or a conversation'],
  ['␣ f d', 'find someone to message'],
  ['␣ r n', 'a new room of your own'],
  ['␣', 'every key, with a menu'],
  ['?', 'the whole keymap']
]

/**
 * @param {object} props
 * @param {number} props.columns   width of the pane
 * @param {boolean} [props.logo]   false for just the facts
 * @returns {React.ReactElement[]}  one element per row
 */
export function welcomeRows ({ theme, self, profile, version, columns, logo = true }) {
  const icons = theme.icons
  const rows = []
  const cut = (text) => truncate(text, Math.max(8, columns - 2))
  const add = (node) => rows.push(<Text key={`w-${rows.length}`} wrap='truncate-end'>{node}</Text>)

  if (logo && columns >= 34) {
    LOGO.forEach((line, i) => add(
      <Text color={i === 0 ? theme.accent : i === 1 ? theme.accent2 : theme.blue} bold>{line}</Text>
    ))
    add(<Text> </Text>)
    add(<Text color={theme.dim}>{cut(`end-to-end encrypted ${icons.sep} no server ${icons.sep} no account${version ? `  v${version}` : ''}`)}</Text>)
    add(<Text> </Text>)
  }

  add(
    <Text color={theme.dim}>
      {'you   '}
      <Text color={theme.accent2}>{self?.nick || 'anonymous'}</Text>
      <Text color={theme.subtle}>{`  ${icons.account} ${profile || 'default'}`}</Text>
    </Text>
  )
  add(
    <Text color={theme.dim}>
      {'key   '}
      <Text color={theme.subtle}>{cut(self?.publicKey || '')}</Text>
    </Text>
  )
  add(<Text> </Text>)
  add(<Text color={theme.subtle}>{cut('this key is your whole account — it is how people reach you')}</Text>)
  add(<Text> </Text>)

  for (const [keys, label] of HINTS) {
    add(
      <Text color={theme.dim}>
        <Text color={theme.accent}>{keys.padEnd(8)}</Text>
        {cut(label)}
      </Text>
    )
  }

  return rows
}
