// The title bar: one row, always there, saying what you are looking at.
//
// It and the statusline share the job of keeping you oriented, and they divide
// it cleanly rather than both saying everything. This bar is about the pane
// under it — which conversation, what kind of thing it is, how many people are
// in it, whether it is reaching anybody. The statusline is about you — which
// mode, which account, what is happening somewhere else. Neither repeats the
// other, which is what makes both of them readable at a glance instead of two
// bands of text you have learned to skip.
//
// The right-hand end is a serverless chat client's one failure mode that a
// hosted one does not have: everything works, nothing is wrong, and there is
// simply nobody else connected to the swarm yet. That is not an error and it
// should not look like one, but it does have to be visible without being asked
// for. So it is a coloured dot and two words, in the corner, permanently.

import React from 'react'
import { Box, Text } from 'ink'

import { fit, truncate, width } from '../model/text.js'

export function Header ({ theme, room, columns, members = 0, peers = 0, connection = 'offline', muted = false }) {
  const icons = theme.icons
  const dye = (color) => (muted ? theme.subtle : color)

  const peerColor = connection === 'online' ? theme.green : connection === 'connecting' ? theme.yellow : theme.red
  const state = connection === 'online' ? 'connected' : connection
  const right = `${state} ${icons.sep} ${peers === 1 ? '1 peer' : `${peers} peers`}`

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
  // The name sits in a chip — a block of the selection colour, the same one the
  // conversation list marks the room you are in with — so the two agree at a
  // glance about which conversation is open. The bar behind it is the panel
  // colour, which is what stops the title bar and the statusline reading as one
  // frame wrapped around the app.
  const chip = ` ${title} `
  const fixed = 1 + width(chip) + 2 + width(right) + 3
  const gap = Math.max(0, columns - fixed)

  return (
    <Box width={columns} height={1} flexShrink={0}>
      <Text wrap='truncate-end' backgroundColor={muted ? undefined : theme.float}>
        <Text color={dye(theme.accent)}>{icons.edge}</Text>
        <Text
          color={dye(theme.accent)}
          backgroundColor={muted ? undefined : theme.selection}
          bold={!muted}
        >
          {chip}
        </Text>
        <Text>{'  '}</Text>
        <Text color={theme.subtle}>{fit(truncate(detail, gap), gap)}</Text>
        <Text color={dye(peerColor)}>{`${icons.unread} `}</Text>
        <Text color={theme.dim}>{`${right} `}</Text>
      </Text>
    </Box>
  )
}
