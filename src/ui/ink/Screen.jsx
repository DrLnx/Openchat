// The whole terminal, composed column by column and row by row.
//
// A window has to be drawn *over* the conversation, and Ink has no z-index and
// no absolute positioning — a component is either in the layout or it is not.
// So the screen is assembled the way a compositor would assemble it: the chat
// pane is built as an array of rows and handed to whatever is on top, which
// keeps the rows it does not cover and replaces the ones it does. See Float.jsx.
//
// What is handed over is the *chat column*, not the whole row. The conversation
// list is beside the chat, not behind it: the two are separate columns standing
// side by side, so a window laid over one leaves the other alone. When they
// were one stack of full-width rows, every window blanked the conversation list
// for as long as it was open — which is not what being in front of something
// means.
//
// Everything that floats goes through that one slot, so nothing on this screen
// can ever change the height of anything else. The title bar, the conversation,
// the prompt and the statusline are where they are, and stay there.
//
// That is what makes a window read as laid over the app rather than as a
// different screen, and it is why every pane in here hands back rows instead of
// rendering itself — see Chat.jsx and Sidebar.jsx.

import React from 'react'
import { Box, Text } from 'ink'

/**
 * @param {object} props
 * @param {object} props.layout        from ui/model/layout.js screenLayout()
 * @param {React.ReactElement} props.header
 * @param {React.ReactElement[]} props.sidebar  one element per row
 * @param {React.ReactElement[]} props.chat     exactly layout.bodyRows of them
 * @param {(chat: React.ReactElement[]) => React.ReactNode} [props.overlay]
 *        given the chat rows, returns what the chat column should hold instead
 * @param {boolean} [props.listFocused]  the conversation list has the keyboard
 * @param {React.ReactElement} props.input
 * @param {React.ReactElement} props.status
 */
export function Screen ({
  theme, layout, header, sidebar = [], chat = [], overlay, input, status, listFocused = false
}) {
  const rows = Array.from({ length: layout.bodyRows }, (_, i) => i)
  const edge = overlay ? theme.subtle : listFocused ? theme.borderFocus : theme.border

  // Wrapped and keyed here rather than wherever they were built, so a window
  // laid over them hands back a list React can tell apart either way.
  const pane = rows.map((i) => (
    <Box key={`c-${i}`} height={1} flexShrink={0}>{chat[i] ?? <Text> </Text>}</Box>
  ))

  return (
    <Box flexDirection='column' width={layout.columns} height={layout.height}>
      {header}

      <Box flexShrink={0}>
        {layout.sidebar
          ? (
            <>
              <Box flexDirection='column' width={layout.sidebarWidth} flexShrink={0}>
                {rows.map((i) => (
                  <Box key={`s-${i}`} height={1} flexShrink={0}>{sidebar[i] ?? <Text> </Text>}</Box>
                ))}
              </Box>
              <Box flexDirection='column' width={1} flexShrink={0}>
                {rows.map((i) => (
                  <Text key={`d-${i}`} color={edge}>│</Text>
                ))}
              </Box>
            </>
            )
          : null}

        <Box flexDirection='column' width={layout.chatWidth} paddingLeft={1} flexShrink={0}>
          {overlay ? overlay(pane) : pane}
        </Box>
      </Box>

      {input}
      {status}
    </Box>
  )
}
