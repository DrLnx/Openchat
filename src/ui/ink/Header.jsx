// The title bar: one row, always there, saying what you are looking at.
//
// The statusline at the bottom says who and where you are; this says what the
// pane below it contains — the conversation's name, what kind of thing it is,
// how many people are in it — so neither has to say both.
//
// On the right it says whether any of that is reaching anyone. A serverless
// chat client has one failure mode a hosted one does not: everything works,
// nothing is wrong, and there is simply nobody else connected to the swarm yet.
// That is not an error and it should not look like one, but it does have to be
// visible without being asked for.

import React from 'react'
import { Box, Text } from 'ink'

import { fit, truncate, width } from '../model/text.js'

export function Header ({ theme, room, columns, members = 0, peers = 0, connection = 'offline', muted = false }) {
  const icons = theme.icons
  const dye = (color) => (muted ? theme.subtle : color)

  const peerColor = connection === 'online' ? theme.green : connection === 'connecting' ? theme.yellow : theme.red
  const state = connection === 'online' ? 'connected' : connection
  const right = `${state} ${icons.sep} ${peers === 1 ? '1 peer' : `${peers} peers`} `

  const title = room
    ? `${room.kind === 'dm' ? icons.dm : icons.room}${room.name}`
    : 'nothing open'

  const detail = room
    ? [
        room.kind === 'dm' ? 'direct message' : members === 1 ? '1 member' : `${members} members`,
        room.closed ? 'closed to newcomers' : null,
        room.owned ? 'yours' : null
      ].filter(Boolean).join(` ${icons.sep} `)
    : 'press ␣ f f to open a conversation'

  // Everything is measured before it is drawn: the bar is exactly one row, and
  // a title one column too long would make it two.
  //
  // The bar starts with a solid edge in the accent colour. It is two cells of
  // decoration and it earns them: the title bar and the statusline are the same
  // shade of not-quite-background, and this is what stops the eye reading them
  // as one thing wrapped around the app.
  const fixed = 2 + width(title) + 2 + width(right) + 3
  const gap = Math.max(0, columns - fixed)

  return (
    <Box width={columns} height={1} flexShrink={0}>
      <Text wrap='truncate-end' backgroundColor={muted ? undefined : theme.float}>
        <Text color={dye(theme.accent)}>{`${icons.edge} `}</Text>
        <Text color={dye(theme.accent)} bold={!muted}>{title}</Text>
        <Text>{'  '}</Text>
        <Text color={theme.subtle}>{fit(truncate(detail, gap), gap)}</Text>
        <Text color={dye(peerColor)}>{`${icons.unread} `}</Text>
        <Text color={theme.dim}>{right}</Text>
      </Text>
    </Box>
  )
}
