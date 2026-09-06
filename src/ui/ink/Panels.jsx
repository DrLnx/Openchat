// The floating windows that show you something rather than ask you something:
// the keymap, and your own identity.
//
// Both are the same scrollable frame with different lines in it, so there is
// one place where "a float you read" behaves consistently — j/k and the wheel
// scroll, escape closes, and nothing you press can change anything.

import React, { useState, useMemo, useCallback, useRef } from 'react'
import { Text, useInput } from 'ink'

import { Float, FloatRow, FloatRule, FloatFill } from './Float.jsx'
import { floatLayout } from '../model/layout.js'
import { useMouse, useMouseCapture } from './mouse.js'
import { BINDINGS, describeChord } from '../model/keymap.js'

/**
 * @param {object} props
 * @param {{ text: string, color?: string, bold?: boolean, indent?: number }[]} props.lines
 * @param {string} [props.subtitle]  the fixed row above the rule
 */
export function InfoFloat ({
  theme, terminal, title, icon, subtitle, lines, footer, onCancel, onKey, width = 76, backdrop
}) {
  const [offset, setOffset] = useState(0)

  const layout = useMemo(
    () => floatLayout(terminal, { items: lines.length, maxRows: 24, width }),
    [terminal, lines.length, width]
  )

  const scroll = useCallback((step) => {
    const max = Math.max(0, lines.length - layout.listRows)
    setOffset((current) => Math.max(0, Math.min(current + step, max)))
  }, [lines.length, layout.listRows])

  useInput((input, key) => {
    if (key.escape || input === 'q' || (key.ctrl && input === 'c')) return onCancel()
    if (key.downArrow || input === 'j') return scroll(1)
    if (key.upArrow || input === 'k') return scroll(-1)
    if (key.pageDown || (key.ctrl && input === 'd')) return scroll(layout.listRows)
    if (key.pageUp || (key.ctrl && input === 'u')) return scroll(-layout.listRows)
    onKey?.(input, key)
  })

  useMouseCapture(true)

  const geometry = useRef(layout)
  geometry.current = layout

  const onMouse = useCallback((event) => {
    if (event.type === 'wheel') return scroll(event.direction * 3)
    if (event.type !== 'press' || event.button !== 'left') return
    const box = geometry.current
    if (event.y < box.top || event.y > box.top + box.height) onCancel()
  }, [scroll, onCancel])

  useMouse(onMouse)

  const visible = lines.slice(offset, offset + layout.listRows)
  const more = lines.length > layout.listRows

  return (
    <Float
      theme={theme}
      layout={layout}
      title={title}
      icon={icon}
      count={more ? `${offset + 1}-${offset + visible.length}/${lines.length}` : undefined}
      footer={footer || [{ keys: '↑↓', label: 'scroll' }, { keys: 'esc', label: 'close' }]}
      backdrop={backdrop}
    >
      <FloatRow theme={theme} layout={layout}>
        <Text color={theme.dim}>{subtitle}</Text>
      </FloatRow>

      <FloatRule theme={theme} layout={layout} />

      {visible.map((line, i) => (
        <FloatRow key={`${offset + i}`} theme={theme} layout={layout}>
          <Text color={line.color || theme.dim} bold={line.bold}>
            {' '.repeat(line.indent || 0)}{line.text}
          </Text>
        </FloatRow>
      ))}

      <FloatFill theme={theme} layout={layout} rows={layout.listRows - visible.length} />
    </Float>
  )
}

/** Every binding, grouped the way the keymap file groups them. */
export function HelpFloat ({ theme, terminal, onCancel, backdrop }) {
  const lines = useMemo(() => {
    const out = []
    const width = Math.max(...BINDINGS.map((b) => describeChord(b.keys).length)) + 2

    const push = (heading, filter) => {
      out.push({ text: heading.toUpperCase(), color: theme.accent2, bold: true })
      for (const binding of BINDINGS.filter(filter)) {
        out.push({
          text: `${describeChord(binding.keys).padEnd(width)}${binding.desc}`,
          color: theme.dim,
          indent: 1
        })
      }
      out.push({ text: '' })
    }

    push('normal mode', (b) => b.mode === 'normal')
    push('anywhere', (b) => b.mode === 'both' || b.mode === 'insert')

    out.push({ text: 'WHILE TYPING', color: theme.accent2, bold: true })
    for (const [keys, desc] of [
      ['⏎', 'send'],
      ['↑ ↓', 'previous messages you sent'],
      ['C-a / C-e', 'start / end of line'],
      ['C-w', 'delete the word behind the cursor'],
      ['C-u', 'clear the line'],
      ['/', 'start a slash command — the menu completes it'],
      ['//', 'send a message that really does start with a slash']
    ]) {
      out.push({ text: `${keys.padEnd(width)}${desc}`, color: theme.dim, indent: 1 })
    }

    return out
  }, [theme])

  return (
    <InfoFloat
      theme={theme}
      terminal={terminal}
      title='Keymap'
      icon={theme.icons.search}
      subtitle='space is the leader key · every binding is also a slash command'
      lines={lines}
      onCancel={onCancel}
      backdrop={backdrop}
    />
  )
}

/**
 * Who you are: the key people reach you on, and — only when you ask for it —
 * the phrase that is the only way back to this identity.
 */
export function IdentityFloat ({ theme, terminal, identity, profile, onCancel, backdrop }) {
  const [revealed, setRevealed] = useState(false)

  const lines = useMemo(() => {
    const out = [
      { text: 'DISPLAY NAME', color: theme.accent2, bold: true },
      { text: identity.nick, color: theme.fg, indent: 1 },
      { text: '' },
      { text: 'PUBLIC KEY', color: theme.accent2, bold: true },
      { text: identity.publicKey, color: theme.accent, indent: 1 },
      { text: 'share this and anyone can start a conversation with you.', indent: 1 },
      { text: '' },
      { text: 'ACCOUNT', color: theme.accent2, bold: true },
      { text: `${profile} — openchat --profile ${profile}`, indent: 1 },
      { text: '' },
      { text: 'RECOVERY PHRASE', color: theme.accent2, bold: true }
    ]

    if (revealed) {
      out.push({ text: identity.mnemonic, color: theme.yellow, indent: 1 })
      out.push({ text: 'anyone who has these words can post as you.', color: theme.red, indent: 1 })
    } else {
      out.push({ text: 'hidden — press r to show it.', indent: 1 })
      out.push({ text: 'check nobody is behind you and nothing is recording first.', indent: 1 })
    }

    return out
  }, [theme, identity, profile, revealed])

  return (
    <InfoFloat
      theme={theme}
      terminal={terminal}
      title='Your identity'
      icon={theme.icons.key}
      subtitle='no server holds any of this — it is a keypair in a file on this machine'
      lines={lines}
      footer={[
        { keys: 'r', label: revealed ? 'hide phrase' : 'reveal phrase' },
        { keys: 'esc', label: 'close' }
      ]}
      onKey={(input) => {
        if (input === 'r') setRevealed((current) => !current)
      }}
      onCancel={onCancel}
      backdrop={backdrop}
    />
  )
}
