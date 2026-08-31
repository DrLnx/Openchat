// First run in a profile. There is no account to sign up for — an identity is a
// keypair you generate locally — so "onboarding" means three things: pick a
// name, generate or restore the key, and make sure the recovery phrase is
// somewhere other than this machine before you rely on it.

import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'

import { ACCENT, MARKER } from './theme.js'

/** A tiny arrow-key list. Not worth a dependency. */
function Choose ({ options, onSelect }) {
  const [index, setIndex] = useState(0)

  useInput((input, key) => {
    if (key.upArrow) setIndex((i) => (i - 1 + options.length) % options.length)
    else if (key.downArrow) setIndex((i) => (i + 1) % options.length)
    else if (key.return) onSelect(options[index].value)
  })

  return (
    <Box flexDirection='column' marginTop={1}>
      {options.map((option, i) => (
        <Text key={option.value} color={i === index ? ACCENT : undefined} dimColor={i !== index}>
          {i === index ? `${MARKER.selected} ` : '  '}{option.label}
        </Text>
      ))}
    </Box>
  )
}

function Frame ({ title, children }) {
  return (
    <Box flexDirection='column' borderStyle='round' borderColor={ACCENT} paddingX={1} marginBottom={1}>
      <Text>
        <Text color={ACCENT}>{MARKER.welcome}</Text> <Text bold>{title}</Text>
      </Text>
      <Box flexDirection='column' marginTop={1}>{children}</Box>
    </Box>
  )
}

/**
 * @param {object} props
 * @param {string} props.profile
 * @param {(result: { mode: 'create'|'restore', nick: string, phrase?: string }) => void} props.onDone
 * @param {{ phrase: string } | null} props.pending  set once an identity exists and its phrase needs showing
 * @param {string | null} props.error
 */
export function Onboarding ({ profile, onDone, pending, error, onAcknowledge }) {
  const [step, setStep] = useState('mode')
  const [mode, setMode] = useState('create')
  const [nick, setNick] = useState('')
  const [phrase, setPhrase] = useState('')

  useInput((input, key) => {
    if (step === 'saved' && key.return) onAcknowledge()
  }, { isActive: step === 'saved' })

  // Once the parent has created the identity, show the recovery phrase.
  if (pending && step !== 'saved') setStep('saved')

  if (step === 'saved') {
    return (
      <Frame title='Save your recovery phrase'>
        <Text dimColor>These 24 words are your identity. Anyone who has them can post as</Text>
        <Text dimColor>you, and without them a lost machine means a lost account. There is</Text>
        <Text dimColor>no server that can reset it for you.</Text>
        <Box marginY={1} paddingX={1} borderStyle='round' borderColor='gray'>
          <Text color={ACCENT}>{pending.phrase}</Text>
        </Box>
        <Text dimColor>Write them down somewhere offline, then press enter to continue.</Text>
      </Frame>
    )
  }

  if (step === 'mode') {
    return (
      <Frame title={`Set up "${profile}"`}>
        <Text dimColor>No sign-up and no server: your account is a keypair on this machine.</Text>
        <Text dimColor>You can run several, one per terminal, with --profile.</Text>
        <Choose
          options={[
            { value: 'create', label: 'Create a new identity' },
            { value: 'restore', label: 'Restore one from a recovery phrase' }
          ]}
          onSelect={(value) => {
            setMode(value)
            setStep(value === 'create' ? 'nick' : 'phrase')
          }}
        />
      </Frame>
    )
  }

  if (step === 'nick') {
    return (
      <Frame title='Pick a display name'>
        <Text dimColor>What people in a room see. You can change it later with /nick.</Text>
        <Box marginTop={1}>
          <Text color={ACCENT}>{'> '}</Text>
          <TextInput
            value={nick}
            onChange={setNick}
            onSubmit={(value) => {
              const name = value.trim()
              if (!name) return
              onDone({ mode: 'create', nick: name })
            }}
            placeholder='ada'
          />
        </Box>
        {error && <Text color='red'>{error}</Text>}
      </Frame>
    )
  }

  return (
    <Frame title='Restore from a recovery phrase'>
      <Text dimColor>Paste the 24 words you saved when you first set this identity up.</Text>
      <Box marginTop={1}>
        <Text color={ACCENT}>{'> '}</Text>
        <TextInput
          value={phrase}
          onChange={setPhrase}
          onSubmit={(value) => onDone({ mode: 'restore', phrase: value.trim(), nick: nick.trim() })}
          placeholder='witch collapse practice feed shame open despair…'
        />
      </Box>
      {error && <Text color='red'>{error}</Text>}
      {mode === 'restore' && !error && (
        <Text dimColor>Restoring replaces whatever identity this profile holds.</Text>
      )}
    </Frame>
  )
}
