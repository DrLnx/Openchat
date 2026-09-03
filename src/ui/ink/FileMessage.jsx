import React from 'react'
import { Box, Text } from 'ink'

const WIDTH = 18

/** A block progress bar driven by real blob-fetch progress, not a timer. */
function Bar ({ theme, progress }) {
  const filled = Math.round(Math.min(Math.max(progress, 0), 1) * WIDTH)
  return (
    <Text>
      <Text color={theme.accent}>{'█'.repeat(filled)}</Text>
      <Text color={theme.subtle}>{'░'.repeat(WIDTH - filled)}</Text>
      <Text color={theme.dim}> {Math.round(progress * 100)}%</Text>
    </Text>
  )
}

/**
 * The state of an attachment, hanging under the message that announced it the
 * way a tool result does in Claude Code. The filename is already on the line
 * above, so this says only what happened to it.
 */
export function FileMessage ({ message, attachment, theme }) {
  return (
    <Box paddingLeft={8}>
      <Text>
        <Text color={theme.subtle}>{theme.icons.detail}{'  '}</Text>
        {detailFor(message, attachment, theme)}
      </Text>
    </Box>
  )
}

/** What happened to this attachment, in one short phrase. */
function detailFor (message, attachment, theme) {
  const status = attachment?.status

  if (status === 'downloading') return <Bar theme={theme} progress={attachment.progress || 0} />

  if (status === 'ready') {
    // A file you sent was never "saved" anywhere — you already had it.
    if (attachment.sent) return <Text color={theme.dim}>sent</Text>
    return (
      <Text color={theme.dim}>
        <Text color={theme.green}>{theme.icons.ok} </Text>
        {attachment.path ? `saved to ${attachment.path}` : 'received'}
      </Text>
    )
  }

  if (status === 'failed') {
    return <Text color={theme.red}>{theme.icons.error} failed: {attachment.error}</Text>
  }

  if (status === 'available') {
    return (
      <Text color={theme.dim}>
        over the auto-download limit — <Text color={theme.accent}>/download {message.id.slice(0, 6)}</Text>
      </Text>
    )
  }

  return (
    <Text color={theme.dim}>
      not downloaded — <Text color={theme.accent}>/download {message.id.slice(0, 6)}</Text>
    </Text>
  )
}
