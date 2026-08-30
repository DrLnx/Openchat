import React from 'react'
import { Box, Text } from 'ink'

import { FileMessage } from './FileMessage.jsx'
import { colorForAuthor, displayName, formatTime, formatSystemEvent } from '../model/format.js'

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
    const previous = displayName(members[message.author], message.author)
    return <Text dimColor>· {previous} is now known as {message.nick}</Text>
  }

  const isSelf = message.author === self?.publicKey
  const name = displayName(members[message.author], message.author)
  const color = colorForAuthor(message.author)

  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>{formatTime(message.ts)} </Text>
        <Text color={color} bold={isSelf}>{name}</Text>
        <Text dimColor> </Text>
        {message.type === 'text' && <Text>{message.body}</Text>}
      </Box>
      {message.type === 'file' && (
        <Box paddingLeft={6}>
          <FileMessage message={message} attachment={attachments[message.id]} />
        </Box>
      )}
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
