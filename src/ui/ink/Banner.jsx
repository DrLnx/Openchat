import React from 'react'
import { Box, Text } from 'ink'

import { ACCENT, MARKER } from './theme.js'
import { shortKey } from '../model/format.js'

/**
 * Printed once at startup, then scrolls away with everything else. It carries
 * the two things worth knowing before you type: which room you are in, and who
 * you are in it.
 */
export function Banner ({ room, self }) {
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
        {'  room: '}
        {room ? <Text color={ACCENT}>#{room.name}</Text> : 'none yet — /join <invite>'}
      </Text>
      <Text dimColor>
        {'  you:  '}{self?.nick || shortKey(self?.publicKey)}
        {self?.publicKey ? ` (${shortKey(self.publicKey)})` : ''}
      </Text>
    </Box>
  )
}
