// The statusline: lualine's layout, with the things a chat client actually has
// to keep in front of you.
//
// Left to right — which mode you are in, where you are, whether you are
// connected and to how many peers, and who you are while you are there. On the
// right, what is happening somewhere else and the one key that opens
// everything. It is a single row, because a sidebar in a chat client is a
// quarter of your terminal spent on a list you look at twice an hour.

import React from 'react'
import { Box, Text } from 'ink'

const MODE_LABEL = { normal: 'NORMAL', insert: 'INSERT', command: 'COMMAND', float: 'MENU' }

export function StatusLine ({
  theme, mode, room, rooms = [], profile, connection, self, writable, mouse
}) {
  const icons = theme.icons
  const color = theme.mode[mode] || theme.mode.normal
  const elsewhere = rooms.reduce((sum, r) => sum + (r.key === room?.key ? 0 : (r.unread || 0)), 0)

  const state = connection.state
  const peerColor = state === 'online' ? theme.green : state === 'connecting' ? theme.yellow : theme.red
  const peers = connection.peers === 1 ? '1 peer' : `${connection.peers} peers`

  return (
    <Box width='100%' justifyContent='space-between'>
      <Box>
        <Text backgroundColor={color} color={theme.on} bold>{` ${MODE_LABEL[mode] || 'NORMAL'} `}</Text>

        <Text backgroundColor={theme.float} color={theme.accent} bold>
          {room ? ` ${room.kind === 'dm' ? icons.dm : icons.room}${room.name} ` : ' no room '}
        </Text>
        {room?.closed
          ? <Text backgroundColor={theme.float} color={theme.yellow}>{`${icons.closed} `}</Text>
          : ''}
        {room?.owned
          ? <Text backgroundColor={theme.float} color={theme.yellow}>{`${icons.owner} `}</Text>
          : ''}

        <Text color={peerColor}>{` ${icons.unread}`}</Text>
        <Text color={theme.dim}>{` ${peers}`}</Text>

        <Text color={theme.subtle}>{` ${icons.sep} `}</Text>
        <Text color={theme.accent2}>{self?.nick || 'you'}</Text>
        <Text color={theme.subtle}>{`@${profile}`}</Text>

        {room && !writable
          ? <Text color={theme.yellow}>{` ${icons.sep} waiting to be admitted`}</Text>
          : ''}
      </Box>

      <Box>
        {elsewhere > 0
          ? (
            <Text color={theme.orange} bold>
              {`${elsewhere} unread `}
            </Text>
            )
          : ''}
        {mouse ? <Text color={theme.subtle}>{`mouse ${icons.sep} `}</Text> : ''}
        <Text color={theme.dim}>
          {mode === 'insert'
            ? <Text><Text color={theme.accent}>esc</Text> normal </Text>
            : <Text><Text color={theme.accent}>␣</Text> keys </Text>}
        </Text>
        <Text color={theme.subtle}>{`${icons.sep} `}</Text>
        <Text color={theme.dim}><Text color={theme.accent}>?</Text> help</Text>
      </Box>
    </Box>
  )
}
