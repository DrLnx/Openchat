import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'

import { completions } from '../model/commands.js'

export function InputBar ({ onSubmit, disabled, placeholder }) {
  const [value, setValue] = useState('')
  const [hint, setHint] = useState([])

  useInput((input, key) => {
    if (!key.tab) return
    const matches = completions(value)
    if (matches.length === 1) {
      setValue(matches[0] + ' ')
      setHint([])
    } else {
      setHint(matches)
    }
  })

  const submit = (line) => {
    setValue('')
    setHint([])
    onSubmit(line)
  }

  return (
    <Box flexDirection="column">
      {hint.length > 0 && (
        <Box paddingX={1}><Text dimColor>{hint.join('  ')}</Text></Box>
      )}
      <Box paddingX={1} borderStyle="round" borderColor={disabled ? 'gray' : 'cyan'}>
        <Text color={disabled ? 'gray' : 'cyan'}>{'> '}</Text>
        <TextInput
          value={value}
          onChange={(next) => {
            setValue(next)
            if (hint.length) setHint([])
          }}
          onSubmit={submit}
          placeholder={placeholder}
          showCursor={!disabled}
        />
      </Box>
    </Box>
  )
}
