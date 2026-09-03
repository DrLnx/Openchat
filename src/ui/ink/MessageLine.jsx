import React from 'react'
import { Box, Text } from 'ink'

import { FileMessage } from './FileMessage.jsx'
import {
  displayName, formatBytes, formatTime, formatSystemEvent, formatNickChange
} from '../model/format.js'

/**
 * One entry in the scrollback.
 *
 * The left edge stays a single marker column, so a log you have scrolled back
 * through weeks of is still scannable: a filled dot is somebody speaking, `›`
 * is you, an elbow is detail belonging to the line above, and a bar down the
 * left is a line that mentioned you by name.
 */
export function MessageLine ({ entry, theme, members, attachments, self, settings = {} }) {
  const icons = theme.icons

  if (entry.kind === 'divider') {
    return (
      <Box marginTop={settings.compact ? 0 : 1}>
        <Text color={theme.border}>{'──── '}</Text>
        <Text color={theme.accent} bold>{entry.label}</Text>
        <Text color={theme.border}>{` ${'─'.repeat(Math.max(4, 48 - entry.label.length))}`}</Text>
      </Box>
    )
  }

  if (entry.kind === 'notice') return <Notice notice={entry.notice} theme={theme} />

  const message = entry.message

  if (message.type === 'system') {
    return <Detail theme={theme}>{formatSystemEvent(message, members)}</Detail>
  }

  if (message.type === 'nick') {
    return <Detail theme={theme}>{formatNickChange(message, entry.previousName)}</Detail>
  }

  const isSelf = message.author === self?.publicKey
  const name = displayName(members[message.author], message.author)
  const color = theme.authorColor(message.author)
  const time = timestamp(message.ts, settings.timestamps)
  const mentioned = !isSelf && mentions(message, self)

  // Everything on the header line lives in one <Text>: sibling boxes wrap
  // independently in Ink, which breaks names in half on a narrow terminal.
  const body = message.type === 'file'
    ? <Text color={theme.cyan}>{message.name} <Text color={theme.dim}>({formatBytes(message.size)})</Text></Text>
    : <Text color={mentioned ? theme.fg : undefined}>{message.body}</Text>

  const header = isSelf
    ? (
      <Text>
        <Text color={theme.subtle}>{time}</Text>
        <Text color={theme.mode.insert}>{icons.self} </Text>
        <Text color={theme.dim}>{body}</Text>
      </Text>
      )
    : (
      <Text>
        <Text color={theme.subtle}>{time}</Text>
        <Text color={mentioned ? theme.orange : color}>{mentioned ? icons.edge : icons.incoming}</Text>
        <Text color={color} bold>{` ${name}`}</Text>
        <Text>{'  '}</Text>
        {body}
      </Text>
      )

  if (message.type !== 'file') return header

  return (
    <Box flexDirection='column'>
      {header}
      <FileMessage message={message} attachment={attachments[message.id]} theme={theme} />
    </Box>
  )
}

/**
 * Command output and errors. Multi-line output (from /help or /members) keeps
 * its own alignment under the elbow rather than being re-flowed.
 */
function Notice ({ notice, theme }) {
  const lines = String(notice.text).split('\n')
  const isError = notice.level === 'error'
  const color = isError ? theme.red : notice.level === 'warn' ? theme.yellow : theme.dim
  const mark = isError ? theme.icons.error : notice.level === 'warn' ? theme.icons.warn : ''

  return (
    <Box flexDirection='column' paddingLeft={2}>
      <Text color={color}>
        <Text color={theme.subtle}>{theme.icons.detail}{'  '}</Text>
        {mark ? `${mark} ` : ''}{lines[0]}
      </Text>
      {lines.slice(1).map((line, i) => (
        <Text key={i} color={color}>{'     '}{line}</Text>
      ))}
    </Box>
  )
}

function Detail ({ theme, children }) {
  return (
    <Box paddingLeft={2}>
      <Text color={theme.subtle}>{theme.icons.detail}{'  '}{children}</Text>
    </Box>
  )
}

function timestamp (ts, style = '24h') {
  if (style === 'off') return ''
  if (style === '12h') {
    const d = new Date(ts)
    const hour = d.getHours() % 12 || 12
    const suffix = d.getHours() < 12 ? 'a' : 'p'
    return `${String(hour).padStart(2, ' ')}:${String(d.getMinutes()).padStart(2, '0')}${suffix} `
  }
  return `${formatTime(ts)} `
}

/**
 * Whether a message is talking to you. Deliberately a plain name match rather
 * than anything cleverer: there is no server to resolve a mention, and a false
 * positive costs you a coloured bar while a false negative costs you the
 * message.
 */
function mentions (message, self) {
  if (message.type !== 'text' || !self?.nick) return false
  return new RegExp(`(^|[^\\w])@?${escape(self.nick)}([^\\w]|$)`, 'i').test(message.body)
}

function escape (text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
