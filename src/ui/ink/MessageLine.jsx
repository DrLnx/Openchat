import React from 'react'
import { Box, Text } from 'ink'

import { FileMessage } from './FileMessage.jsx'
import { MARKER } from './theme.js'
import {
  colorForAuthor, displayName, formatBytes, formatTime, formatSystemEvent, formatNickChange
} from '../model/format.js'

/**
 * One entry in the scrollback.
 *
 * The line vocabulary follows Claude Code: your own input echoes back behind a
 * `>`, anything that arrived is introduced by a filled dot, and detail belonging
 * to the line above — command output, an attachment — hangs under an elbow. The
 * left edge stays a single marker column so the log is scannable.
 */
export function MessageLine ({ entry, members, attachments, self }) {
  if (entry.kind === 'notice') return <Notice notice={entry.notice} />

  const message = entry.message

  if (message.type === 'system') {
    return <Detail dim>{formatSystemEvent(message, members)}</Detail>
  }

  if (message.type === 'nick') {
    return <Detail dim>{formatNickChange(message, entry.previousName)}</Detail>
  }

  const isSelf = message.author === self?.publicKey
  const name = displayName(members[message.author], message.author)
  const color = colorForAuthor(message.author)
  const time = formatTime(message.ts)

  // Everything on the header line lives in one <Text>: sibling boxes wrap
  // independently in Ink, which breaks names in half on a narrow terminal.
  const body = message.type === 'file'
    ? <Text color="cyan">{message.name} ({formatBytes(message.size)})</Text>
    : <Text>{message.body}</Text>

  const header = isSelf
    ? (
      <Text dimColor>
        {time} {MARKER.self} {body}
      </Text>
      )
    : (
      <Text>
        <Text dimColor>{time} </Text>
        <Text color={color}>{MARKER.incoming}</Text>
        <Text color={color} bold> {name}</Text>
        <Text>  </Text>{body}
      </Text>
      )

  if (message.type !== 'file') return header

  return (
    <Box flexDirection="column">
      {header}
      <FileMessage message={message} attachment={attachments[message.id]} />
    </Box>
  )
}

/**
 * Command output and errors. Multi-line output (from /help or /members) keeps
 * its own alignment under the elbow rather than being re-flowed.
 */
function Notice ({ notice }) {
  const lines = String(notice.text).split('\n')
  const isError = notice.level === 'error'
  const color = isError ? 'red' : notice.level === 'warn' ? 'yellow' : undefined

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text color={color} dimColor={!color}>
        <Text dimColor>{MARKER.detail}  </Text>
        {isError ? `${MARKER.error} ` : ''}{lines[0]}
      </Text>
      {lines.slice(1).map((line, i) => (
        <Text key={i} color={color} dimColor={!color}>{'     '}{line}</Text>
      ))}
    </Box>
  )
}

function Detail ({ children }) {
  return (
    <Box paddingLeft={2}>
      <Text dimColor>{MARKER.detail}  {children}</Text>
    </Box>
  )
}
