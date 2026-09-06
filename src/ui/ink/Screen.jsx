// The whole terminal, composed row by row.
//
// A float has to be drawn *over* the conversation, and Ink has no z-index and
// no absolute positioning — a component is either in the layout or it is not.
// So the screen is assembled the way a compositor would assemble it: the body
// is built as an array of rows and handed to whatever is on top, which keeps
// the rows it does not cover and replaces the ones it does. See Float.jsx.
//
// Everything that floats goes through that one slot — the finders, the command
// menu, the which-key popup — so nothing on this screen can ever change the
// height of anything else. The title bar, the conversation, the prompt and the
// statusline are where they are, and stay there.
//
// That is what makes a float read as a window laid over the app rather than as
// a different screen, and it is why every pane in here hands back rows instead
// of rendering itself — see Chat.jsx and Sidebar.jsx.

import React from 'react'
import { Box, Text } from 'ink'

/**
 * @param {object} props
 * @param {object} props.layout        from ui/model/layout.js screenLayout()
 * @param {React.ReactElement} props.header
 * @param {React.ReactElement[]} props.sidebar  one element per row
 * @param {React.ReactElement[]} props.chat     exactly layout.bodyRows of them
 * @param {(backdrop: React.ReactElement[]) => React.ReactNode} [props.overlay]
 * @param {React.ReactElement} props.input
 * @param {React.ReactElement} props.status
 */
export function Screen ({
  theme, layout, header, sidebar = [], chat = [], overlay, input, status
}) {
  const body = []

  for (let i = 0; i < layout.bodyRows; i++) {
    body.push(
      <Box key={`row-${i}`} height={1} flexShrink={0}>
        {layout.sidebar
          ? (
            <>
              <Box width={layout.sidebarWidth} height={1} flexShrink={0}>
                {sidebar[i] ?? <Text> </Text>}
              </Box>
              <Box width={1} height={1} flexShrink={0}>
                <Text color={overlay ? theme.subtle : theme.border}>│</Text>
              </Box>
            </>
            )
          : null}
        <Box width={layout.chatWidth} height={1} paddingLeft={1} flexShrink={0}>
          {chat[i] ?? <Text> </Text>}
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection='column' width={layout.columns} height={layout.height}>
      {header}
      <Box flexDirection='column' flexShrink={0}>
        {overlay ? overlay(body) : body}
      </Box>
      {input}
      {status}
    </Box>
  )
}
