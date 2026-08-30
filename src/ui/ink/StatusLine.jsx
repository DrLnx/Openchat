import React from 'react'
import { Box, Text } from 'ink'

import { ACCENT } from './theme.js'
import { shortKey } from '../model/format.js'

const STATE_COLOR = { online: 'green', connecting: 'yellow', offline: 'red' }

/**
 * One dim line under the input box. Everything the old sidebar held that you
 * actually need at a glance, without a panel taking a quarter of the terminal.
 */
export function StatusLine ({ room, connection, self, writable }) {
  const peers = connection.peers === 1 ? '1 peer' : `${connection.peers} peers`

  return (
    <Box paddingX={2} justifyContent="space-between">
      <Text dimColor>
        {room
          ? <Text color={ACCENT}>#{room.name}</Text>
          : 'no room'}
        {' · '}
        <Text color={STATE_COLOR[connection.state] || 'gray'}>●</Text>
        {` ${peers} · ${self?.nick || shortKey(self?.publicKey)}`}
        {room && !writable ? <Text color="yellow"> · waiting to be admitted</Text> : ''}
      </Text>
      <Text dimColor>/help for commands · ctrl+c to quit</Text>
    </Box>
  )
}
