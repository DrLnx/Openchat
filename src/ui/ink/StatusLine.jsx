// The statusline: lualine's layout, with the things a chat client actually has
// to keep in front of you.
//
// Left to right — which mode you are in, where you are, whether you are
// connected and to how many peers, and who you are while you are there. On the
// right, what is happening somewhere else and the one key that opens
// everything. One row, and never more: this is the line you read without
// looking at it.

import React from 'react'
import { Box, Text } from 'ink'

import { width } from '../model/text.js'

const MODE_LABEL = { normal: 'NORMAL', insert: 'INSERT', command: 'COMMAND', float: 'MENU' }

export function StatusLine ({
  theme, mode, room, rooms = [], profile, connection, self, writable, mouse, scrolled, columns = 80
}) {
  const icons = theme.icons
  const color = theme.mode[mode] || theme.mode.normal
  const elsewhere = rooms.reduce((sum, r) => sum + (r.key === room?.key ? 0 : (r.unread || 0)), 0)

  // On a narrow terminal the hints on the right are the first thing to go:
  // they are a reminder, and the left-hand side is the part you are reading.
  const left = 10 + width(room?.name || 'no room') + width(self?.nick || 'you') + width(profile || '') + 14
  const hints = columns - left > 24

  const state = connection.state
  const peerColor = state === 'online' ? theme.green : state === 'connecting' ? theme.yellow : theme.red
  const peers = connection.peers === 1 ? '1 peer' : `${connection.peers} peers`

  return (
    <Box width={columns} height={1} flexShrink={0} justifyContent='space-between' overflow='hidden'>
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
        {profile ? <Text color={theme.subtle}>{`@${profile}`}</Text> : ''}

        {room && !writable
          ? <Text color={theme.yellow}>{` ${icons.sep} waiting to be admitted`}</Text>
          : ''}

        {/* Reading back through a room is a state you can forget you are in —
            new messages arrive below the fold and nothing moves. */}
        {scrolled
          ? <Text color={theme.orange}>{` ${icons.sep} scrolled back, G for the newest`}</Text>
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
        {hints
          ? (
            <Text>
              {mouse ? <Text color={theme.subtle}>{`mouse ${icons.sep} `}</Text> : ''}
              <Text color={theme.dim}>
                {mode === 'insert'
                  ? <Text><Text color={theme.accent}>esc</Text> normal </Text>
                  : <Text><Text color={theme.accent}>␣</Text> keys </Text>}
              </Text>
              <Text color={theme.subtle}>{`${icons.sep} `}</Text>
              <Text color={theme.dim}><Text color={theme.accent}>?</Text> help</Text>
            </Text>
            )
          : ''}
      </Box>
    </Box>
  )
}
