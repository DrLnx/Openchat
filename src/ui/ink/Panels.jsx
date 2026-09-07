// The floating windows that show you something rather than ask you something:
// the keymap, your own identity, and a room's invite.
//
// The keymap is a scrollable frame of lines, so there is one place where "a
// float you read" behaves consistently — j/k and the wheel scroll, escape
// closes, and nothing you press can change anything.
//
// Anything key-shaped is a different window with different rules, because a key
// is not something you read, it is something you take away with you. That one
// lives in KeyFloat.jsx.

import React, { useState, useMemo, useCallback, useRef } from 'react'
import { Text, useInput } from 'ink'

import { Float, FloatRow, FloatRule, FloatFill } from './Float.jsx'
import { KeyFloat } from './KeyFloat.jsx'
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
 * Who you are: the key people reach you on, the account it belongs to, and —
 * only when you ask for it — the phrase that is the only way back to it.
 */
export function IdentityFloat ({ theme, terminal, identity, profile, revealed, onCancel, onCopy, backdrop }) {
  const fields = useMemo(() => [
    {
      label: 'Display name',
      value: `${identity.nick || 'anonymous'}   — what a room shows instead of your key`,
      plain: true
    },
    {
      label: 'Public key',
      value: identity.publicKey,
      copyAs: 'your public key',
      tag: 'safe to share',
      tone: 'safe',
      note: 'this is your whole account — anyone who has it can reach you.'
    },
    {
      label: 'Account',
      value: `${profile || 'default'}   — openchat --profile ${profile || 'default'}`,
      plain: true
    },
    {
      label: 'Recovery phrase',
      value: identity.mnemonic || '',
      copyAs: 'your recovery phrase',
      secret: true,
      tag: 'never share',
      tone: 'danger',
      note: 'anyone who has these words can post as you. write them down offline.'
    }
  ], [identity, profile])

  return (
    <KeyFloat
      theme={theme}
      terminal={terminal}
      title='Your keys'
      icon={theme.icons.key}
      subtitle='no server holds any of this — it is a keypair in a file on this machine'
      fields={fields}
      revealed={revealed}
      onCopy={onCopy}
      onCancel={onCancel}
      backdrop={backdrop}
    />
  )
}

/**
 * The string that admits the next member of a room.
 *
 * It is one field rather than several because it is one secret: the room key
 * and the key that decrypts the room, in a string short enough to send someone
 * and long enough that nobody types it twice.
 */
export function InviteFloat ({ theme, terminal, room, onCancel, onCopy, backdrop }) {
  const fields = useMemo(() => [
    {
      label: 'Invite string',
      value: room.invite,
      copyAs: `the invite to #${room.name}`,
      secret: true,
      tag: room.closed ? 'admits nobody — the room is closed' : 'anyone who has it can read and post',
      tone: 'danger',
      note: 'share it out of band. it is the room key and its encryption key.'
    }
  ], [room])

  return (
    <KeyFloat
      theme={theme}
      terminal={terminal}
      title={`Invite to #${room.name}`}
      icon={theme.icons.key}
      subtitle={room.closed
        ? 'the room is closed, so this admits nobody until you /reopen it'
        : 'there is no server to revoke this — treat it like a password'}
      fields={fields}
      revealed
      onCopy={onCopy}
      onCancel={onCancel}
      backdrop={backdrop}
    />
  )
}
