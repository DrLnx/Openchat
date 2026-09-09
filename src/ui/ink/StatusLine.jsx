// The statusline: lualine's layout, with the things a chat client actually has
// to keep in front of you.
//
// It says where *you* are, and the title bar says what you are looking at. The
// two used to overlap — both named the room, both counted peers — and a line
// you have already read at the top of the screen is a line you stop reading at
// the bottom of it. So the room and the swarm live up there now, and what is
// left down here is the four things that are about this seat rather than about
// the conversation: which mode your keys are in, which account you are, whether
// anything is happening in a room you are not looking at, and the one key that
// opens everything.
//
// One row, and never more: this is the line you read without looking at it.

import React from 'react'
import { Box, Text } from 'ink'

import { width } from '../model/text.js'

const MODE_LABEL = { normal: 'NORMAL', insert: 'INSERT', command: 'COMMAND', float: 'MENU' }

export function StatusLine ({
  theme, mode, room, rooms = [], profile, connection, self, writable, mouse, scrolled, columns = 80,
  listFocused = false
}) {
  const icons = theme.icons
  const color = theme.mode[mode] || theme.mode.normal
  const elsewhere = rooms.reduce((sum, r) => sum + (r.key === room?.key ? 0 : (r.unread || 0)), 0)

  // On a narrow terminal the hints on the right are the first thing to go:
  // they are a reminder, and the left-hand side is the part you are reading.
  const left = 10 + width(self?.nick || 'you') + width(profile || '') + 14
  const hints = columns - left > 24

  // A state you can be in without having chosen it, and that changes what the
  // screen means, gets said in words. Being scrolled back is the one that
  // catches people out: messages arrive below the fold and nothing moves.
  const warnings = [
    room && !writable ? { text: 'waiting to be admitted', color: theme.yellow } : null,
    scrolled ? { text: `scrolled back ${icons.sep} G for the newest`, color: theme.orange } : null
  ].filter(Boolean)

  return (
    <Box width={columns} height={1} flexShrink={0} justifyContent='space-between' overflow='hidden'>
      <Box>
        <Text backgroundColor={listFocused ? theme.accent2 : color} color={theme.on} bold>
          {listFocused ? ' LIST ' : ` ${MODE_LABEL[mode] || 'NORMAL'} `}
        </Text>

        {/* Who you are, and which of your identities is speaking. Two accounts
            on one machine share nothing, so the one thing you must never be
            wrong about is which of them you just typed into. */}
        <Text backgroundColor={theme.float} color={theme.accent2} bold>
          {` ${self?.nick || 'you'}`}
        </Text>
        <Text backgroundColor={theme.float} color={theme.subtle}>
          {profile ? `@${profile} ` : ' '}
        </Text>

        {warnings.map((warning) => (
          <Text key={warning.text} color={warning.color}>
            {` ${icons.warn} ${warning.text}`}
          </Text>
        ))}
      </Box>

      <Box>
        {elsewhere > 0
          ? (
            <Text color={theme.orange} bold>
              {`${icons.unread} ${elsewhere} elsewhere  `}
            </Text>
            )
          : ''}
        {listFocused
          ? (
            <Text color={theme.dim}>
              <Text color={theme.accent}>j k</Text> move <Text color={theme.subtle}>{icons.sep}</Text>{' '}
              <Text color={theme.accent}>⏎</Text> open <Text color={theme.subtle}>{icons.sep}</Text>{' '}
              <Text color={theme.accent}>esc</Text> back
            </Text>
            )
          : hints
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
