// The prompt, and the one line above it that says what just happened.
//
// It draws and nothing else: the value, the cursor position and the mode all
// arrive as props, and every keypress is routed by App. That split is what
// makes a modal interface possible at all — a component that reads stdin for
// itself will type `p` into your message when you meant Ctrl-P, and by the time
// it has done that there is nothing anyone can do about it.
//
// The box only ever holds a message. Commands go to the command line, which is
// its own window with its own text and its own history — see Cmdline.jsx.

import React from 'react'
import { Box, Text } from 'ink'

import { truncate, width as visibleWidth } from '../model/text.js'

/**
 * The prompt.
 *
 * In INSERT the border takes the mode colour and the block cursor is where the
 * next character lands. In NORMAL the cursor is not where text goes, so it
 * stops pretending to be one: the block disappears, the border recedes to the
 * quietest colour on the screen, and the whole box reads as inactive. That is
 * the entire feedback loop a modal interface needs, and it needs it to be
 * legible from the corner of your eye.
 */
export function InputBar ({ theme, mode, value, cursor, placeholder, busy, width, target, flash }) {
  const insert = mode === 'insert'
  const edge = busy ? theme.subtle : insert ? theme.mode.insert : theme.border
  const glyph = insert ? theme.icons.selected : theme.icons.self

  // Who you are about to say it to, set into the top border — and, when
  // something has just happened, what it was. The title bar says what you are
  // reading; this says where the next thing you type is going, and on a screen
  // where those two can differ — you can be scrolled back, or in the
  // conversation list — it is worth one caption to be sure.
  const caption = flash ? ` ${flashText(theme, flash)} ` : target ? ` ${target} ` : ''
  const fill = Math.max(0, width - 4 - visibleWidth(caption))

  return (
    <Box flexDirection='column' flexShrink={0} width={width}>
      <Text color={flash ? flashColor(theme, flash.level) : edge} wrap='truncate-end'>
        <Text>╭─</Text>
        <Text color={flash ? flashColor(theme, flash.level) : busy ? theme.subtle : theme.dim} bold={Boolean(flash)}>
          {caption}
        </Text>
        <Text color={edge}>{`${'─'.repeat(fill)}─╮`}</Text>
      </Text>

      <Box width={width}>
        <Text color={edge}>{'│ '}</Text>
        <Text color={busy ? theme.subtle : insert ? theme.mode.insert : theme.dim} bold>
          {`${glyph} `}
        </Text>
        <Box width={Math.max(1, width - 6)} overflow='hidden'>
          {value === ''
            ? (
              <Text wrap='truncate-end'>
                <Cursor theme={theme} char=' ' visible={insert && !busy} />
                <Text color={theme.subtle}>{placeholder}</Text>
              </Text>
              )
            : (
              <Text wrap='truncate-end'>
                <Text>{value.slice(0, cursor)}</Text>
                <Cursor theme={theme} char={value[cursor] || ' '} visible={insert && !busy} />
                <Text>{value.slice(cursor + 1)}</Text>
              </Text>
              )}
        </Box>
        <Text color={edge}>{' │'}</Text>
      </Box>

      <Text color={edge}>{`╰${'─'.repeat(Math.max(0, width - 2))}╯`}</Text>
    </Box>
  )
}

/**
 * An acknowledgement, in the border, for a couple of seconds.
 *
 * "copied to the clipboard" is a reply to a keypress, not a thing that happened
 * in the conversation. Putting it in the transcript left it there permanently,
 * pushed real messages up the screen, and stacked one identical line per press.
 * It belongs where your eye already is and nowhere afterwards.
 */
function flashText (theme, flash) {
  const mark = flash.level === 'error'
    ? theme.icons.error
    : flash.level === 'warn' ? theme.icons.warn : theme.icons.ok
  return `${mark} ${truncate(String(flash.text ?? ''), 64)}`
}

function flashColor (theme, level) {
  if (level === 'error') return theme.red
  if (level === 'warn') return theme.yellow
  return theme.green
}

function Cursor ({ theme, char, visible }) {
  if (!visible) return <Text color={theme.subtle}>{char}</Text>
  return <Text backgroundColor={theme.accent} color={theme.on}>{char}</Text>
}
