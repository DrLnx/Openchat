import React from 'react'
import { Box, Text } from 'ink'

import { formatBytes } from '../model/format.js'

const WIDTH = 20

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

export function FileMessage ({ message, attachment }) {
  const size = formatBytes(message.size)
  const status = attachment?.status

  return (
    <Box flexDirection="column">
      <Text>
        <Text color="cyan">📎 {message.name}</Text>
        <Text dimColor> ({size})</Text>
      </Text>

      {status === 'downloading' && (
        <Box paddingLeft={3}><Bar progress={attachment.progress || 0} /></Box>
      )}

      {status === 'ready' && (
        <Box paddingLeft={3}><Text color="green">saved to {attachment.path}</Text></Box>
      )}

      {status === 'failed' && (
        <Box paddingLeft={3}><Text color="red">failed: {attachment.error}</Text></Box>
      )}

      {(!status || status === 'available') && (
        <Box paddingLeft={3}>
          <Text dimColor>too large to fetch automatically — /download {message.id.slice(0, 6)}</Text>
        </Box>
      )}
    </Box>
  )
}
