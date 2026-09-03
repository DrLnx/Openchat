// The which-key popup: half a chord typed, and here is everything it could
// still become.
//
// It is the single feature that makes a modal interface learnable rather than
// something you have to be taught. Nobody memorises `<leader>fd`; they press
// space, read the menu, and after a week their fingers know it without them.

import React from 'react'
import { Box, Text } from 'ink'

import { describeChord, groupFor } from '../model/keymap.js'

const COLUMN = 28

export function WhichKey ({ theme, terminal, pending, candidates }) {
  if (candidates.length === 0) return null

  const width = Math.max(40, Math.min(terminal.columns - 4, 96))
  const inner = width - 4
  const columns = Math.max(1, Math.floor(inner / COLUMN))

  // One entry per next key. Several bindings can share a prefix — `<leader>ff`
  // and `<leader>fd` both sit under `f` — and what you want to see there is the
  // group, not the first of its children.
  const seen = new Map()
  for (const candidate of candidates) {
    if (seen.has(candidate.next)) continue
    const group = groupFor([...pending, candidate.next])
    seen.set(candidate.next, {
      key: candidate.next,
      label: group ? group.desc : candidate.desc,
      group: Boolean(group) || candidate.sequence.length > pending.length + 1
    })
  }

  const chord = describeChord(pending.join('')) || '\u2423'
  const entries = [...seen.values()]
  const rows = []
  for (let i = 0; i < entries.length; i += columns) rows.push(entries.slice(i, i + columns))

  return (
    <Box flexDirection='column' width={width} marginLeft={1} flexShrink={0}>
      <Text color={theme.borderFocus}>
        <Text>{'\u256d\u2500 '}</Text>
        <Text color={theme.accent} bold>{chord}</Text>
        <Text>{` ${'\u2500'.repeat(Math.max(0, width - 6 - [...chord].length))}\u2500\u256e`}</Text>
      </Text>

      {rows.map((row, i) => (
        <Box key={i} width={width}>
          <Text color={theme.borderFocus}>{'│ '}</Text>
          <Box width={inner} overflow='hidden'>
            <Text wrap='truncate-end'>
              {row.map((entry) => (
                <Text key={entry.key}>
                  <Text color={theme.accent} bold>{label(entry.key)}</Text>
                  <Text color={theme.subtle}>{' → '}</Text>
                  <Text color={entry.group ? theme.accent2 : theme.dim}>
                    {pad(entry.label, COLUMN - 4 - label(entry.key).length)}
                  </Text>
                </Text>
              ))}
            </Text>
          </Box>
          <Text color={theme.borderFocus}>{' │'}</Text>
        </Box>
      ))}

      <Text color={theme.borderFocus}>{`╰${'─'.repeat(width - 2)}╯`}</Text>
    </Box>
  )
}

function label (key) {
  if (key === '<space>') return '␣'
  return key.replace(/^<|>$/g, '')
}

function pad (text, width) {
  const value = String(text)
  return value.length >= width ? value.slice(0, Math.max(1, width - 1)) + ' ' : value.padEnd(width)
}
