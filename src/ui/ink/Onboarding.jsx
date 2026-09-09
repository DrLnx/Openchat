// First run in an account.
//
// There is nothing to sign up for: an identity is a keypair generated on this
// machine, and a username is a label you put on it. So onboarding is not a
// form — it is the three things somebody genuinely has to understand before the
// first message they send means anything:
//
//   what this is        no server holds your messages or your account
//   who you will be     a display name, changeable, and a key that is not
//   the recovery phrase the only copy, and nobody can reissue it
//
// There is one way through it and no branch in it. The key is always generated
// here, on this machine, and the last step refuses to move on until you say you
// have written the phrase down.
//
// It is drawn as a card of a fixed width, centred, rather than as a box that
// fills the terminal. Prose does not get more readable by being given 200
// columns — it gets less — and this is the one screen in openchat that is
// almost entirely prose. Everything inside is measured against that width, so
// the card is the same shape on a laptop and on a wall-sized terminal.

import React, { useState } from 'react'
import { Box, Text, useInput, useWindowSize } from 'ink'

import { createTheme } from './theme.js'
import { copy } from './clipboard.js'
import { wrap, fit, typed } from '../model/text.js'

const STEPS = ['what this is', 'your name', 'recovery phrase']

/** How wide the card is drawn, and how wide the prose inside it wraps. */
const CARD = 76

/** Where the card sits and how wide it is on this terminal. */
function useCard () {
  const size = useWindowSize()
  const columns = size.columns || 80
  const width = Math.max(40, Math.min(CARD, columns - 4))

  return { width, left: Math.max(0, Math.floor((columns - width) / 2)), inner: width - 6 }
}

function Frame ({ theme, title, step, children }) {
  const at = STEPS.indexOf(step)
  const card = useCard()

  return (
    <Box flexDirection='column' marginY={1} marginLeft={card.left}>
      <Box
        flexDirection='column'
        borderStyle='round'
        borderColor={theme.borderFocus}
        paddingX={2}
        paddingY={1}
        width={card.width}
      >
        <Text wrap='truncate-end'>
          <Text color={theme.accent}>{theme.icons.welcome}</Text>
          <Text bold color={theme.fg}>{` ${title}`}</Text>
        </Text>
        <Box flexDirection='column' marginTop={1}>{children}</Box>
      </Box>

      {/* The four steps, and which one you are on. Onboarding is short enough
          that nobody would get lost in it, but a screen that generates the only
          copy of a key should say how much of it is left before it does. */}
      <Box paddingX={2}>
        <Text wrap='truncate-end'>
          {STEPS.map((name, i) => (
            <Text key={name}>
              <Text color={i === at ? theme.accent : i < at ? theme.green : theme.subtle}>
                {i < at ? theme.icons.ok : i === at ? '●' : '○'}
              </Text>
              <Text color={i === at ? theme.dim : theme.subtle}>{` ${name}${i < STEPS.length - 1 ? '   ' : ''}`}</Text>
            </Text>
          ))}
        </Text>
      </Box>
    </Box>
  )
}

/** A paragraph, wrapped to the card rather than to wherever the terminal ends. */
function Prose ({ theme, children, color }) {
  const card = useCard()
  return (
    <>
      {wrap(String(children), card.inner).map((line, i) => (
        <Text key={i} color={color || theme.dim}>{line}</Text>
      ))}
    </>
  )
}

/**
 * A claim and the reason for it, in two columns.
 *
 * The reasons are the substance of this screen — they are the difference
 * between "no account" as marketing and "no account" as a fact about where
 * your key is — so they line up in a column of their own rather than running
 * on from the claim as one ragged sentence.
 */
function Points ({ theme, points }) {
  const card = useCard()
  const label = Math.max(...points.map(([title]) => title.length)) + 2
  const room = Math.max(12, card.inner - label - 2)

  return (
    <Box flexDirection='column' marginTop={1}>
      {points.map(([title, body]) => {
        const lines = wrap(body, room)
        return (
          <Box key={title} flexDirection='column'>
            <Text wrap='truncate-end'>
              <Text color={theme.accent}>{`${theme.icons.incoming} `}</Text>
              <Text color={theme.fg} bold>{fit(title, label)}</Text>
              <Text color={theme.dim}>{lines[0]}</Text>
            </Text>
            {lines.slice(1).map((line, i) => (
              <Text key={i} wrap='truncate-end'>
                <Text>{' '.repeat(label + 2)}</Text>
                <Text color={theme.dim}>{line}</Text>
              </Text>
            ))}
          </Box>
        )
      })}
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

/**
 * A single-line answer. Owns its own keys, because only one is on screen.
 *
 * Pasting is the normal way to use this: nobody types twenty-four words by
 * hand. A paste arrives as one chunk with its newline attached, and so does a
 * short answer typed quickly — see `typed` in ui/model/text.js for why that
 * cannot be left to Ink's `key.return`.
 */
function Ask ({ theme, value, onChange, onSubmit, placeholder }) {
  useInput((input, key) => {
    if (key.return) return onSubmit(value)
    if (key.backspace || key.delete) return onChange(value.slice(0, -1))
    if (key.ctrl && input === 'u') return onChange('')
    if (key.ctrl || key.meta || key.tab || key.escape) return
    if (!input) return

    const { text, submit } = typed(input)
    const next = value + text
    if (text) onChange(next)
    if (submit) onSubmit(next)
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
  // What was last put on the clipboard, so the hint can say which — two copy
  // keys and one word saying "copied" is a screen that cannot tell you whether
  // the thing you now hold is safe to paste into a chat window.
  const [copied, setCopied] = useState(null)
  const card = useCard()

  // Deliberately tolerant about what arrives. A terminal hands Ink whatever was
  // in the buffer when it read, so someone typing quickly — or a pty, or a
  // paste — can deliver `y` and the enter after it as one chunk, and this is
  // the last screen in the app that may ever get stuck: behind it is the only
  // copy of a key nobody can reissue.
  //
  // Both things on this screen are worth copying, and they are worth copying to
  // different places, so they get a key each. `c` takes the public key — the
  // one you hand to somebody so they can message you. `C` takes the phrase:
  // twenty-four words is a lot to retype into a password manager by hand, and
  // somebody who cannot get them off this screen quickly is somebody who does
  // not save them at all, which is the one failure this screen exists to
  // prevent. Shift is the guard on it — the phrase is the dangerous one, and a
  // key you can hit by accident should not be the key that puts your identity
  // on the clipboard.
  //
  // Both go out over OSC 52, so they work through ssh and tmux with no helper
  // binary; see clipboard.js.
  useInput((input, key) => {
    if (input.includes('C')) {
      copy(phrase)
      setCopied('all 24 words')
    } else if (input.includes('c') && publicKey) {
      copy(publicKey)
      setCopied('your public key')
    }

    const said = /y/i.test(input)
    const entered = key.return || input.includes('\r') || input.includes('\n')

    if (said) setConfirmed(true)
    if (entered && (confirmed || said)) onAcknowledge()
  })

  // Six to a row, numbered from the left. The numbers are not decoration: the
  // one thing anybody does with this screen is copy it onto paper by hand, and
  // a column of twenty-four words with nothing to count by is a column you lose
  // your place in.
  const words = phrase.split(/\s+/)
  const column = Math.max(...words.map((w) => w.length)) + 2
  const perRow = Math.max(3, Math.min(6, Math.floor((card.inner - 6) / column)))
  const rows = []
  for (let i = 0; i < words.length; i += perRow) rows.push(words.slice(i, i + perRow))

  return (
    <Frame theme={theme} title='Write down your recovery phrase' step='recovery phrase'>
      <Prose theme={theme}>
        {`These ${words.length} words are your identity${profile ? ` for "${profile}"` : ''}. Anyone who has them can post as you, and without them a lost machine is a lost account. There is no server that can reset this for you — press shift-c to copy them into a password manager.`}
      </Prose>

      <Box
        flexDirection='column'
        marginY={1}
        paddingX={2}
        borderStyle='round'
        borderColor={theme.yellow}
        width={card.inner + 2}
      >
        {rows.map((row, i) => (
          <Text key={i} color={theme.yellow} wrap='truncate-end'>
            <Text color={theme.subtle}>{String(i * perRow + 1).padStart(2, ' ')}  </Text>
            {row.map((word) => word.padEnd(column)).join('').trimEnd()}
          </Text>
        ))}
      </Box>

      {publicKey
        ? (
          <Box flexDirection='column' marginBottom={1}>
            <Text color={theme.dim}>Your public key — share this and people can message you:</Text>
            <Text color={theme.accent} wrap='truncate-end'>{publicKey}</Text>
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
          <>
            {/* Two keys, named by what they take rather than by "copy", because
                which of these two ends up on the clipboard is the whole
                question. The tick says which one you have. */}
            <Text color={theme.dim} wrap='truncate-end'>
              <Text color={theme.accent} bold>c</Text>
              {'  your public key   '}
              <Text color={theme.accent} bold>C</Text>
              {'  all 24 words'}
              {copied
                ? <Text color={theme.green}>{`   ${theme.icons.ok} ${copied} copied`}</Text>
                : null}
            </Text>
            <Text color={theme.dim}>
              Saved the words? Press <Text color={theme.accent} bold>y</Text> to confirm.
            </Text>
          </>
          )}
    </Frame>
  )
}

/**
 * @param {object} props
 * @param {string} props.profile
 * @param {(result: { nick: string }) => void} props.onDone
 * @param {{ phrase: string, publicKey?: string } | null} props.pending
 * @param {string | null} props.error
 */
export function Onboarding ({ profile, onDone, pending, error, onAcknowledge, theme: given }) {
  const theme = given || createTheme()
  const [step, setStep] = useState('welcome')
  const [nick, setNick] = useState('')

  useInput((input, key) => {
    if (key.return) setStep('nick')
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
        <Prose theme={theme}>
          Group rooms and direct messages, end-to-end encrypted, over a peer-to-peer network. There is no server in the middle — not one you run, and not one anybody else does.
        </Prose>

        <Points
          theme={theme}
          points={[
            ['no account', 'your identity is a keypair generated on this machine'],
            ['no directory', 'people reach you by your public key, not by a username someone owns'],
            ['no operator', 'nobody can read your rooms, list them, or lock you out'],
            ['no limit', `${profile ? `this one is "${profile}" — ` : ''}as many accounts as you like, each with its own key`]
          ]}
        />

        <Box marginTop={1}>
          <Text color={theme.dim}>Press <Text color={theme.accent} bold>enter</Text> to generate your key.</Text>
        </Box>
      </Frame>
    )
  }

  return (
    <Frame theme={theme} title={`Pick a display name for "${profile}"`} step='your name'>
      <Prose theme={theme}>
        What people in a room see next to what you say. It is not unique and it is not your identity — your key is — so pick anything, and change it later with :nick.
      </Prose>
      <Ask
        theme={theme}
        value={nick}
        onChange={setNick}
        placeholder='ada'
        onSubmit={(value) => {
          const name = value.trim()
          if (!name) return
          onDone({ nick: name })
        }}
      />
      {error ? <Text color={theme.red}>{`${theme.icons.error} ${error}`}</Text> : null}
    </Frame>
  )
}
