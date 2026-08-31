import React from 'react'
import { Box, Text } from 'ink'

import { ACCENT } from './theme.js'
import { shortKey } from '../model/format.js'

const STATE_COLOR = { online: 'green', connecting: 'yellow', offline: 'red' }

/**
 * One dim line under the input box. Everything the old sidebar held that you
 * actually need at a glance, without a panel taking a quarter of the terminal.
 */
export function StatusLine ({ room, rooms = [], profile, connection, self, writable }) {
  const peers = connection.peers === 1 ? '1 peer' : `${connection.peers} peers`
  const elsewhere = rooms.reduce((sum, r) => sum + (r.key === room?.key ? 0 : (r.unread || 0)), 0)
  const others = rooms.length - (room ? 1 : 0)

  return (
    <Box paddingX={2} justifyContent='space-between'>
      <Text dimColor>
        {room
          ? <Text color={ACCENT}>{room.kind === 'dm' ? '@' : '#'}{room.name}</Text>
          : 'nothing open'}
        {room?.closed ? <Text color='yellow'> closed</Text> : ''}
        {' · '}
        <Text color={STATE_COLOR[connection.state] || 'gray'}>●</Text>
        {` ${peers} · ${self?.nick || shortKey(self?.publicKey)}`}
        {profile && profile !== 'default' ? <Text color={ACCENT}> · {profile}</Text> : ''}
        {room && !writable ? <Text color='yellow'> · waiting to be admitted</Text> : ''}
      </Text>
      <Text dimColor>
        {elsewhere > 0
          ? <Text color={ACCENT}>{elsewhere} unread · </Text>
          : ''}
        {others > 0 ? 'shift+tab · ' : ''}/help · ctrl+c
      </Text>
    </Box>
  )
}
