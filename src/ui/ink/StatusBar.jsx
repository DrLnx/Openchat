import React from 'react'
import { Box, Text } from 'ink'

import { shortKey } from '../model/format.js'

const STATE_COLOR = { online: 'green', connecting: 'yellow', offline: 'red' }

export function StatusBar ({ room, connection, self, writable }) {
  const color = STATE_COLOR[connection.state] || 'gray'
  const peers = connection.peers === 1 ? '1 peer' : `${connection.peers} peers`

  return (
    <Box justifyContent="space-between" paddingX={1} borderStyle="round" borderColor="gray">
      <Box>
        <Text bold>{room ? `#${room.name || shortKey(room.key)}` : 'no room'}</Text>
        {room && !writable && <Text color="yellow"> · waiting to be admitted</Text>}
      </Box>
      <Box>
        <Text color={color}>● </Text>
        <Text dimColor>{peers} · </Text>
        <Text dimColor>{self?.nick || shortKey(self?.publicKey)}</Text>
      </Box>
    </Box>
  )
}
