import React from 'react'
import { Box, Text } from 'ink'

import { FileMessage } from './FileMessage.jsx'
import { colorForAuthor, displayName, formatTime, formatSystemEvent, formatNickChange } from '../model/format.js'

const NOTICE_COLOR = { error: 'red', warn: 'yellow', info: 'gray' }

function Line ({ entry, members, attachments, self }) {
  if (entry.kind === 'notice') {
    return (
      <Text color={NOTICE_COLOR[entry.notice.level] || 'gray'}>
        {entry.notice.level === 'error' ? '✗ ' : '· '}{entry.notice.text}
      </Text>
    )
  }

  const message = entry.message

  if (message.type === 'system') {
    return <Text dimColor>· {formatSystemEvent(message, members)}</Text>
  }

  if (message.type === 'nick') {
    return <Text dimColor>· {formatNickChange(message, entry.previousName)}</Text>
  }

  const isSelf = message.author === self?.publicKey
  const name = displayName(members[message.author], message.author)
  const color = colorForAuthor(message.author)

  // The timestamp, name and body live in one <Text>, not in sibling boxes.
  // Ink wraps each box independently, so in a narrow terminal siblings get
  // broken mid-word — "19:22bo" with the rest of the name on the next line.
  // Nesting inside a single Text makes the whole line wrap as one flow.
  const header = (
    <Text>
      <Text dimColor>{formatTime(message.ts)} </Text>
      <Text color={color} bold={isSelf}>{name}</Text>
      {message.type === 'text' && <Text> {message.body}</Text>}
    </Text>
  )

  if (message.type !== 'file') return header

  return (
    <Box flexDirection="column">
      {header}
      <Box paddingLeft={6}>
        <FileMessage message={message} attachment={attachments[message.id]} />
      </Box>
    </Box>
  )
}

/**
 * The scrollback. Ink redraws the whole frame, so rendering thousands of lines
 * would cost a full repaint per keystroke — only the tail that fits is drawn.
 */
export function ChatPane ({ entries, members, attachments, self, rows }) {
  const visible = entries.slice(-Math.max(rows, 1))

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {visible.length === 0 && (
        <Text dimColor>
          No messages yet. /invite prints a link to share, /help lists commands.
        </Text>
      )}
      {visible.map((entry) => (
        <Line
          key={entry.key}
          entry={entry}
          members={members}
          attachments={attachments}
          self={self}
        />
      ))}
    </Box>
  )
}
