// The prompt, and the menu of commands that matches what you have typed.
//
// It draws and nothing else: the value, the cursor position and the mode all
// arrive as props, and every keypress is routed by App. That split is what
// makes a modal interface possible at all — a component that reads stdin for
// itself will type `p` into your message when you meant Ctrl-P, and by the time
// it has done that there is nothing anyone can do about it.
//
// The menu is a separate export because it is not laid out here: it is drawn
// *over* the conversation, anchored to the bottom of it, rather than wedged
// between the conversation and the prompt. Wedging it there made the whole
// transcript jump down the screen every time you typed a slash.

import React from 'react'
import { Box, Text } from 'ink'

import { segments } from '../model/fuzzy.js'
import { matchPositions } from '../model/commands.js'

/**
 * @param {object} props
 * @param {'normal'|'insert'|'command'} props.mode
 * @param {string} props.value
 * @param {number} props.cursor
 * @param {{ name: string, args: string, help: string }[]} props.matches
 * @param {number} props.selected
 */
/** Most completions the menu lists before it says "and n more". */
export const MENU_ROWS = 8

/** How many rows the menu will take, so the screen can hand it exactly those. */
export function menuHeight (matches = []) {
  if (matches.length === 0) return 0
  return Math.min(matches.length, MENU_ROWS) + (matches.length > MENU_ROWS ? 1 : 0)
}

/** The completions, as rows, to be drawn over the bottom of the conversation. */
export function CommandMenu ({ theme, value, matches = [], selected = 0, columns }) {
  const usage = (command) => `/${command.name}${command.args ? ' ' + command.args : ''}`
  const gutter = Math.min(26, Math.max(...matches.map((c) => usage(c).length + 2), 12))

  return (
    <Box flexDirection='column' width={columns} flexShrink={0}>
      {matches.slice(0, MENU_ROWS).map((command, i) => (
        <Text
          key={command.name}
          wrap='truncate-end'
          backgroundColor={i === selected ? theme.selection : undefined}
        >
          <Text color={i === selected ? theme.accent : theme.subtle}>
            {i === selected ? ` ${theme.icons.selected} ` : '   '}
          </Text>
          {segments(usage(command), i === selected ? [] : matchPositions(value, usage(command)))
            .map((part, j) => (
              <Text key={j} color={part.match ? theme.accent2 : (i === selected ? theme.fg : theme.dim)} bold={part.match}>
                {part.text}
              </Text>
            ))}
          <Text>{' '.repeat(Math.max(1, gutter - usage(command).length))}</Text>
          <Text color={i === selected ? theme.fg : theme.subtle}>{command.help}</Text>
        </Text>
      ))}
      {matches.length > MENU_ROWS && (
        <Text color={theme.subtle} wrap='truncate-end'>
          {`   ${theme.icons.ellipsis} ${matches.length - MENU_ROWS} more`}
        </Text>
      )}
    </Box>
  )
}

export function InputBar ({
  theme, mode, value, cursor, placeholder, busy, width
}) {
  const insert = mode === 'insert' || mode === 'command'
  const edge = busy ? theme.subtle : insert ? theme.mode.insert : theme.mode.normal

  return (
    <Box flexDirection='column' flexShrink={0}>
      <Box borderStyle='round' borderColor={edge} paddingX={1} width={width}>
        <Text color={edge} bold>{insert ? `${theme.icons.selected} ` : ':: '}</Text>
        {value === ''
          ? (
            <Text>
              <Cursor theme={theme} char=' ' visible={insert && !busy} />
              <Text color={theme.subtle}>{placeholder}</Text>
            </Text>
            )
          : (
            <Text>
              <Text>{value.slice(0, cursor)}</Text>
              <Cursor theme={theme} char={value[cursor] || ' '} visible={insert && !busy} />
              <Text>{value.slice(cursor + 1)}</Text>
            </Text>
            )}
      </Box>
    </Box>
  )
}

// In NORMAL mode the cursor is not where text goes, so it stops pretending to
// be: the block disappears and the border turns blue, which is the whole
// feedback loop a modal interface needs.
function Cursor ({ theme, char, visible }) {
  if (!visible) return <Text color={theme.subtle}>{char}</Text>
  return <Text backgroundColor={theme.accent} color={theme.on}>{char}</Text>
}
