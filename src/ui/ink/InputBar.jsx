import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'

import { ACCENT, MARKER } from './theme.js'
import { matchCommands } from '../model/commands.js'

/**
 * The prompt: a rounded box with a caret, and a command menu that opens under
 * it as soon as you type a slash.
 *
 * Enter is overloaded on purpose. With the menu open it completes the highlighted
 * command instead of sending — running a half-typed `/mem` as a chat message is
 * never what anyone meant.
 */
export function InputBar ({ onSubmit, disabled, placeholder }) {
  const [value, setValue] = useState('')
  const [selected, setSelected] = useState(0)
  const [dismissed, setDismissed] = useState(false)

  const matches = dismissed ? [] : matchCommands(value)
  const open = matches.length > 0

  // Keep the highlight in range as the list narrows under you.
  useEffect(() => {
    if (selected >= matches.length) setSelected(0)
  }, [matches.length, selected])

  useInput((input, key) => {
    if (!open) {
      if (key.escape) setDismissed(true)
      return
    }

    if (key.upArrow) {
      setSelected((i) => (i - 1 + matches.length) % matches.length)
    } else if (key.downArrow) {
      setSelected((i) => (i + 1) % matches.length)
    } else if (key.tab) {
      complete(matches[selected])
    } else if (key.escape) {
      setDismissed(true)
    }
  })

  const complete = (command) => {
    if (!command) return
    // A command that takes an argument leaves you mid-line to type it; one that
    // does not is what you asked for, so run it.
    if (command.args) {
      setValue(`/${command.name} `)
      setSelected(0)
    } else {
      send(`/${command.name}`)
    }
  }

  const send = (line) => {
    setValue('')
    setSelected(0)
    setDismissed(false)
    onSubmit(line)
  }

  const submit = (line) => {
    if (open) return complete(matches[selected])
    send(line)
  }

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor={disabled ? 'gray' : ACCENT} paddingX={1}>
        <Text color={disabled ? 'gray' : ACCENT}>{'> '}</Text>
        <TextInput
          value={value}
          onChange={(next) => {
            setValue(next)
            setDismissed(false)
          }}
          onSubmit={submit}
          placeholder={placeholder}
          showCursor={!disabled}
        />
      </Box>

      {open && (
        <Box flexDirection="column" paddingX={2}>
          {matches.map((command, i) => (
            <Text key={command.name} color={i === selected ? ACCENT : undefined} dimColor={i !== selected}>
              {i === selected ? `${MARKER.selected} ` : '  '}
              {`/${command.name}${command.args ? ' ' + command.args : ''}`.padEnd(18)}
              {command.help}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  )
}
