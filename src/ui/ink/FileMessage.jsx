import React from 'react'
import { Box, Text } from 'ink'

import { MARKER } from './theme.js'

const WIDTH = 16

/** A block progress bar driven by real blob-fetch progress, not a timer. */
function Bar ({ progress }) {
  const filled = Math.round(Math.min(Math.max(progress, 0), 1) * WIDTH)
  return (
    <Text>
      <Text color="cyan">{'█'.repeat(filled)}</Text>
      <Text dimColor>{'░'.repeat(WIDTH - filled)}</Text>
      <Text dimColor> {Math.round(progress * 100)}%</Text>
    </Text>
  )
}

/**
 * The state of an attachment, hanging under the message that announced it the
 * way a tool result does in Claude Code. The filename is already on the line
 * above, so this says only what happened to it.
 */
export function FileMessage ({ message, attachment }) {
  const status = attachment?.status

  const detail = status === 'downloading'
    ? <Bar progress={attachment.progress || 0} />
    : status === 'ready'
      ? <Text dimColor>{attachment.path ? `saved to ${attachment.path}` : 'received'}</Text>
      : status === 'failed'
        ? <Text color="red">failed: {attachment.error}</Text>
        : status === 'available'
          ? <Text dimColor>over the auto-download limit — /download {message.id.slice(0, 6)}</Text>
          : <Text dimColor>not downloaded — /download {message.id.slice(0, 6)}</Text>

  return (
    <Box paddingLeft={8}>
      <Text><Text dimColor>{MARKER.detail}  </Text>{detail}</Text>
    </Box>
  )
}
