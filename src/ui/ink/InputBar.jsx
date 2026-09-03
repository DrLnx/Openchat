// The prompt, and the command menu that opens under it.
//
// It draws and nothing else: the value, the cursor position and the mode all
// arrive as props, and every keypress is routed by App. That split is what
// makes a modal interface possible at all — a component that reads stdin for
// itself will type `p` into your message when you meant Ctrl-P, and by the time
// it has done that there is nothing anyone can do about it.

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
export function InputBar ({
  theme, mode, value, cursor, placeholder, matches = [], selected = 0, busy, width
}) {
  const insert = mode === 'insert' || mode === 'command'
  const edge = busy ? theme.subtle : insert ? theme.mode.insert : theme.mode.normal
  const usage = (command) => `/${command.name}${command.args ? ' ' + command.args : ''}`
  const gutter = Math.min(
    26,
    Math.max(...matches.map((c) => usage(c).length + 2), 12)
  )

  return (
    <Box flexDirection='column'>
      {matches.length > 0 && (
        <Box flexDirection='column' marginLeft={1} marginBottom={0}>
          {matches.slice(0, 8).map((command, i) => (
            <Text key={command.name} backgroundColor={i === selected ? theme.selection : undefined}>
              <Text color={i === selected ? theme.accent : theme.subtle}>
                {i === selected ? `${theme.icons.selected} ` : '  '}
              </Text>
              {segments(usage(command), i === selected ? [] : matchPositions(value, usage(command)))
                .map((part, j) => (
                  <Text key={j} color={part.match ? theme.accent2 : (i === selected ? theme.fg : theme.dim)} bold={part.match}>
                    {part.text}
                  </Text>
                ))}
              <Text>{' '.repeat(Math.max(1, gutter - usage(command).length))}</Text>
              <Text color={i === selected ? theme.dim : theme.subtle}>{command.help}</Text>
            </Text>
          ))}
          {matches.length > 8 && (
            <Text color={theme.subtle}>{`  ${theme.icons.ellipsis} ${matches.length - 8} more`}</Text>
          )}
        </Box>
      )}

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
