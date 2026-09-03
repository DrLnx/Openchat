// Printed once at startup and then left in the scrollback, the way a dashboard
// greets you when an editor opens with no file.
//
// It answers the three questions a new terminal raises — where am I, who am I,
// and what do I press — and then gets out of the way for good.

import React from 'react'
import { Box, Text } from 'ink'

const LOGO = [
  '┌─┐┌─┐┌─┐┌┐┌┌─┐┬ ┬┌─┐┌┬┐',
  '│ │├─┘├┤ ││││  ├─┤├─┤ │ ',
  '└─┘┴  └─┘┘└┘└─┘┴ ┴┴ ┴ ┴ '
]

export function Banner ({ theme, room, self, profile, version, hint = true }) {
  const icons = theme.icons

  return (
    <Box
      flexDirection='column'
      borderStyle='round'
      borderColor={theme.border}
      paddingX={2}
      paddingY={1}
      marginBottom={1}
    >
      {LOGO.map((line, i) => (
        <Text key={i} color={i === 0 ? theme.accent : i === 1 ? theme.accent2 : theme.blue} bold>
          {line}
          {i === 1 ? <Text color={theme.dim} bold={false}>{`   end-to-end encrypted ${icons.sep} no server ${icons.sep} no account`}</Text> : ''}
          {i === 2 && version ? <Text color={theme.subtle} bold={false}>{`   v${version}`}</Text> : ''}
        </Text>
      ))}

      <Box marginTop={1} flexDirection='column'>
        <Text color={theme.dim}>
          {'here  '}
          {room
            ? <Text color={theme.accent}>{room.kind === 'dm' ? icons.dm : icons.room}{room.name}</Text>
            : <Text color={theme.yellow}>nothing open yet</Text>}
        </Text>
        <Text color={theme.dim}>
          {'you   '}
          <Text color={theme.accent2}>{self?.nick || 'anonymous'}</Text>
          <Text color={theme.subtle}>{`  ${icons.account} ${profile}`}</Text>
        </Text>
        <Text color={theme.dim}>
          {'key   '}
          <Text color={theme.subtle}>{self?.publicKey || ''}</Text>
        </Text>
      </Box>

      {hint && (
        <Box marginTop={1} flexDirection='column'>
          {[
            ['␣', 'every key, with a menu'],
            ['␣ f f', 'find a room or a conversation'],
            ['␣ f d', 'find someone to message'],
            ['/', 'slash commands, fuzzy-completed'],
            ['?', 'the whole keymap']
          ].map(([keys, label]) => (
            <Text key={keys} color={theme.dim}>
              <Text color={theme.accent}>{keys.padEnd(8)}</Text>
              {label}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  )
}
