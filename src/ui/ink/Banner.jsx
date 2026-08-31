import React from 'react'
import { Box, Text } from 'ink'

import { ACCENT, MARKER } from './theme.js'
import { shortKey } from '../model/format.js'

/**
 * Printed once at startup, then scrolls away with everything else. It carries
 * the two things worth knowing before you type: which room you are in, and who
 * you are in it.
 */
export function Banner ({ room, self, profile }) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={ACCENT}
      paddingX={1}
      marginBottom={1}
    >
      <Text>
        <Text color={ACCENT}>{MARKER.welcome}</Text> <Text bold>Welcome to openchat</Text>
      </Text>
      <Text> </Text>
      <Text dimColor>  end-to-end encrypted · no server · /help for commands</Text>
      <Text> </Text>
      <Text dimColor>
        {'  here: '}
        {room
          ? <Text color={ACCENT}>{room.kind === 'dm' ? '@' : '#'}{room.name}</Text>
          : 'nothing open — /new <name> or /dm <key>'}
      </Text>
      <Text dimColor>
        {'  you:  '}{self?.nick || shortKey(self?.publicKey)}
        {profile && profile !== 'default' ? ` · profile ${profile}` : ''}
      </Text>
      <Text dimColor>
        {'  key:  '}{self?.publicKey || ''}
      </Text>
      <Text dimColor>{'        give someone that key and they can message you'}</Text>
    </Box>
  )
}
