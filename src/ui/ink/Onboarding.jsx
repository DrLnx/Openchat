// First run in an account.
//
// There is nothing to sign up for: an identity is a keypair generated on this
// machine, and a username is a label you put on it. So onboarding is not a
// form — it is the four things somebody genuinely has to understand before the
// first message they send means anything:
//
//   what this is        no server holds your messages or your account
//   who you will be     a display name, changeable, and a key that is not
//   the key itself      generated here, or restored from words you already have
//   the recovery phrase the only copy, and nobody can reissue it
//
// The last step refuses to move on until you say you have written the phrase
// down, because every other part of this is recoverable and that one is not.

import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'

import { createTheme } from './theme.js'

const STEPS = ['what this is', 'your key', 'your name', 'recovery phrase']

/** A tiny arrow-key list. Not worth a dependency. */
function Choose ({ theme, options, onSelect }) {
  const [index, setIndex] = useState(0)

  useInput((input, key) => {
    if (key.upArrow || input === 'k') setIndex((i) => (i - 1 + options.length) % options.length)
    else if (key.downArrow || input === 'j') setIndex((i) => (i + 1) % options.length)
    else if (key.return) onSelect(options[index].value)
  })

  return (
    <Box flexDirection='column' marginTop={1}>
      {options.map((option, i) => (
        <Box key={option.value} flexDirection='column'>
          <Text color={i === index ? theme.accent : theme.dim} bold={i === index}>
            {i === index ? `${theme.icons.selected} ` : '  '}{option.label}
          </Text>
          {option.help
            ? <Text color={i === index ? theme.dim : theme.subtle}>{'    '}{option.help}</Text>
            : null}
        </Box>
      ))}
    </Box>
  )
}

function Frame ({ theme, title, step, children }) {
  const at = STEPS.indexOf(step)

  return (
    <Box flexDirection='column' marginY={1}>
      <Box
        flexDirection='column'
        borderStyle='round'
        borderColor={theme.borderFocus}
        paddingX={2}
        paddingY={1}
      >
        <Text>
          <Text color={theme.accent}>{theme.icons.welcome}</Text>
          <Text bold color={theme.fg}>{` ${title}`}</Text>
        </Text>
        <Box flexDirection='column' marginTop={1}>{children}</Box>
      </Box>

      <Box paddingX={2}>
        <Text color={theme.subtle}>
          {STEPS.map((name, i) => (
            <Text key={name}>
              <Text color={i === at ? theme.accent : i < at ? theme.green : theme.subtle}>
                {i === at ? '●' : i < at ? '●' : '○'}
              </Text>
              <Text color={i === at ? theme.dim : theme.subtle}>{` ${name}${i < STEPS.length - 1 ? '   ' : ''}`}</Text>
            </Text>
          ))}
        </Text>
      </Box>
    </Box>
  )
}

function Field ({ theme, value, placeholder }) {
  return (
    <Box marginTop={1}>
      <Text color={theme.accent} bold>{`${theme.icons.selected} `}</Text>
      <Text>{value}</Text>
      <Text backgroundColor={theme.accent} color={theme.on}>{' '}</Text>
      {value === '' ? <Text color={theme.subtle}>{placeholder}</Text> : null}
    </Box>
  )
}

/** A single-line answer. Owns its own keys, because only one is on screen. */
function Ask ({ theme, value, onChange, onSubmit, placeholder }) {
  useInput((input, key) => {
    if (key.return) return onSubmit(value)
    if (key.backspace || key.delete) return onChange(value.slice(0, -1))
    if (key.ctrl && input === 'u') return onChange('')
    if (key.ctrl || key.meta || key.tab || key.escape) return
    // eslint-disable-next-line no-control-regex
    if (input && !/^[\u0000-\u001f\u007f]+$/.test(input)) onChange(value + input)
  })

  return <Field theme={theme} value={value} placeholder={placeholder} />
}

/**
 * The recovery phrase, and the acknowledgement that it has been written down.
 * Exported because creating a second account later has to show it too, and
 * showing it differently in the two places is how people end up with an
 * identity they cannot recover.
 */
export function RecoveryPhrase ({ theme, phrase, publicKey, profile, onAcknowledge }) {
  const [confirmed, setConfirmed] = useState(false)

  useInput((input, key) => {
    if (input === 'y' || input === 'Y') setConfirmed(true)
    else if (confirmed && key.return) onAcknowledge()
  })

  const words = phrase.split(/\s+/)
  const rows = []
  for (let i = 0; i < words.length; i += 6) rows.push(words.slice(i, i + 6))

  return (
    <Frame theme={theme} title='Write down your recovery phrase' step='recovery phrase'>
      <Text color={theme.dim}>These 24 words are your identity{profile ? ` for "${profile}"` : ''}. Anyone who has</Text>
      <Text color={theme.dim}>them can post as you, and without them a lost machine is a lost</Text>
      <Text color={theme.dim}>account. There is no server that can reset this for you.</Text>

      <Box
        flexDirection='column'
        marginY={1}
        paddingX={2}
        paddingY={1}
        borderStyle='round'
        borderColor={theme.yellow}
      >
        {rows.map((row, i) => (
          <Text key={i} color={theme.yellow}>
            <Text color={theme.subtle}>{String(i * 6 + 1).padStart(2, ' ')}  </Text>
            {row.map((word) => word.padEnd(10)).join('')}
          </Text>
        ))}
      </Box>

      {publicKey
        ? (
          <Box flexDirection='column' marginBottom={1}>
            <Text color={theme.dim}>Your public key — share this and people can message you:</Text>
            <Text color={theme.accent}>{publicKey}</Text>
          </Box>
          )
        : null}

      {confirmed
        ? (
          <Text color={theme.green}>
            {`${theme.icons.ok} `}
            <Text color={theme.dim}>saved — press enter to open openchat</Text>
          </Text>
          )
        : (
          <Text color={theme.dim}>
            Written it down somewhere offline? Press <Text color={theme.accent} bold>y</Text> to confirm.
          </Text>
          )}
    </Frame>
  )
}

/**
 * @param {object} props
 * @param {string} props.profile
 * @param {(result: { mode: 'create'|'restore', nick: string, phrase?: string }) => void} props.onDone
 * @param {{ phrase: string, publicKey?: string } | null} props.pending
 * @param {string | null} props.error
 */
export function Onboarding ({ profile, onDone, pending, error, onAcknowledge, theme: given }) {
  const theme = given || createTheme()
  const [step, setStep] = useState('welcome')
  const [nick, setNick] = useState('')
  const [phrase, setPhrase] = useState('')

  useInput((input, key) => {
    if (key.return) setStep('mode')
  }, { isActive: step === 'welcome' })

  if (pending) {
    return (
      <RecoveryPhrase
        theme={theme}
        phrase={pending.phrase}
        publicKey={pending.publicKey}
        profile={profile}
        onAcknowledge={onAcknowledge}
      />
    )
  }

  if (step === 'welcome') {
    return (
      <Frame theme={theme} title='openchat' step='what this is'>
        <Text color={theme.dim}>Group rooms and direct messages, end-to-end encrypted, over a</Text>
        <Text color={theme.dim}>peer-to-peer network. There is no server in the middle — not one</Text>
        <Text color={theme.dim}>you run, and not one anybody else does.</Text>

        <Box flexDirection='column' marginTop={1}>
          {[
            ['no account', 'your identity is a keypair generated on this machine'],
            ['no directory', 'people reach you by your public key, not by a username someone owns'],
            ['no operator', 'nobody can read your rooms, list them, or lock you out'],
            ['as many as you like', `${profile ? `this one is "${profile}" — ` : ''}separate accounts, separate keys`]
          ].map(([title, body]) => (
            <Text key={title}>
              <Text color={theme.accent}>{`  ${theme.icons.incoming} `}</Text>
              <Text color={theme.fg} bold>{title}</Text>
              <Text color={theme.dim}>{`  ${body}`}</Text>
            </Text>
          ))}
        </Box>

        <Box marginTop={1}>
          <Text color={theme.dim}>Press <Text color={theme.accent} bold>enter</Text> to set up your key.</Text>
        </Box>
      </Frame>
    )
  }

  if (step === 'mode') {
    return (
      <Frame theme={theme} title={`Set up "${profile}"`} step='your key'>
        <Text color={theme.dim}>Two ways in. Both end with a keypair in this profile directory and</Text>
        <Text color={theme.dim}>nothing anywhere else.</Text>
        <Choose
          theme={theme}
          options={[
            {
              value: 'create',
              label: 'Create a new identity',
              help: 'a fresh keypair — nobody has ever seen this key before'
            },
            {
              value: 'restore',
              label: 'Restore one from a recovery phrase',
              help: 'the same identity you already use on another machine'
            }
          ]}
          onSelect={(value) => setStep(value === 'create' ? 'nick' : 'phrase')}
        />
      </Frame>
    )
  }

  if (step === 'nick') {
    return (
      <Frame theme={theme} title='Pick a display name' step='your name'>
        <Text color={theme.dim}>What people in a room see next to what you say. It is not unique</Text>
        <Text color={theme.dim}>and it is not your identity — your key is — so pick anything, and</Text>
        <Text color={theme.dim}>change it later with /nick.</Text>
        <Ask
          theme={theme}
          value={nick}
          onChange={setNick}
          placeholder='ada'
          onSubmit={(value) => {
            const name = value.trim()
            if (!name) return
            onDone({ mode: 'create', nick: name })
          }}
        />
        {error ? <Text color={theme.red}>{`${theme.icons.error} ${error}`}</Text> : null}
      </Frame>
    )
  }

  return (
    <Frame theme={theme} title='Restore from a recovery phrase' step='your key'>
      <Text color={theme.dim}>Paste the 24 words you saved when you first set this identity up.</Text>
      <Text color={theme.dim}>They rebuild the same key, so you keep the same name on every</Text>
      <Text color={theme.dim}>message you have ever sent.</Text>
      <Ask
        theme={theme}
        value={phrase}
        onChange={setPhrase}
        placeholder='witch collapse practice feed shame open despair…'
        onSubmit={(value) => onDone({ mode: 'restore', phrase: value.trim(), nick: nick.trim() })}
      />
      {error ? <Text color={theme.red}>{`${theme.icons.error} ${error}`}</Text> : null}
      {!error
        ? <Text color={theme.subtle}>Restoring replaces whatever identity this account holds.</Text>
        : null}
    </Frame>
  )
}
