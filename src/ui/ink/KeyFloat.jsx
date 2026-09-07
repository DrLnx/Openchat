// The window every key, invite and recovery phrase is shown in.
//
// None of this used to have a window. `/whoami`, `/invite` and `/backup` all
// printed into the conversation, and that was wrong in three separate ways.
//
// It was wrong for reading: a 64-character key wrapped across the message
// column, indented under a speaker's name, in a pane the next message scrolls.
// It was wrong for using: the one thing you do with a key is paste it
// somewhere, and a string that has been wrapped and re-indented is not a string
// you can get back out. And it was wrong for keeping: a recovery phrase in the
// transcript is a recovery phrase in whatever the transcript is later shown to,
// including a screen share you started an hour after you typed the command.
//
// So a key goes in a window. It is laid out in a box wide enough to hold it
// whole, secrets stay masked until you ask for them, `c` puts the value on the
// system clipboard, and closing the window takes all of it off the screen with
// nothing left in the log.

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { Text, useInput } from 'ink'

import { Float, FloatRow, FloatRule, FloatFill } from './Float.jsx'
import { floatLayout } from '../model/layout.js'
import { useMouse, useMouseCapture } from './mouse.js'
import { copy } from './clipboard.js'
import { wrap, width as visibleWidth, truncate } from '../model/text.js'

/** How wide the label column is for a field that is a fact rather than a key. */
const PLAIN_LABEL = 15

/**
 * @typedef {object} KeyField
 * @property {string} label
 * @property {string} value
 * @property {string} [note]     one dim line under the value
 * @property {string} [tag]      right-hand caption on the label row
 * @property {'safe'|'danger'} [tone]  colours the tag
 * @property {boolean} [secret]  masked until the phrase is revealed
 * @property {boolean} [plain]   shown as bare text rather than in a box
 * @property {string} [copyAs]   what a copy of it is called in the notice
 */

/**
 * @param {object} props
 * @param {KeyField[]} props.fields
 * @param {string} props.title
 * @param {string} [props.subtitle]      the fixed row above the rule
 * @param {boolean} [props.revealed]     start with secrets shown
 * @param {(what: string) => void} [props.onCopy]  told what was copied
 */
export function KeyFloat ({
  theme, terminal, title, icon, subtitle, fields = [], onCancel, onCopy,
  revealed: initiallyRevealed = false, width = 78, backdrop
}) {
  const [revealed, setRevealed] = useState(initiallyRevealed)
  // Opening this window already revealed means you came here for the secret —
  // `/backup` and nothing else — so that is the field the cursor starts on and
  // the field the window scrolls to.
  const [focus, setFocus] = useState(
    () => (initiallyRevealed ? Math.max(0, fields.findIndex((field) => field.secret)) : 0)
  )
  const [offset, setOffset] = useState(0)

  // Only the fields you can actually do something with take the cursor. A
  // display name is on this screen for context, not to be copied.
  const stops = useMemo(
    () => fields.map((field, i) => (field.plain ? null : i)).filter((i) => i !== null),
    [fields]
  )
  const at = stops.includes(focus) ? focus : (stops[0] ?? -1)

  const secrets = fields.some((field) => field.secret)

  // A trailing blank row, so the last note never sits directly on the footer.
  const { rows, spans } = useMemo(() => {
    const built = fieldRows({ fields, theme, revealed, focus: at, inner: width - 4 })
    return { rows: [...built.rows, <Text key='tail'> </Text>], spans: built.spans }
  }, [fields, theme, revealed, at, width])

  const layout = useMemo(
    () => floatLayout(terminal, { items: rows.length, maxRows: 26, width }),
    [terminal, rows.length, width]
  )

  const scroll = useCallback((step) => {
    const max = Math.max(0, rows.length - layout.listRows)
    setOffset((current) => Math.max(0, Math.min(current + step, max)))
  }, [rows.length, layout.listRows])

  const move = useCallback((step) => {
    if (stops.length === 0) return
    const index = stops.indexOf(at)
    setFocus(stops[(index + step + stops.length) % stops.length])
  }, [stops, at])

  // A field taller than what is left of the window is not a field you can read.
  // Whenever the cursor lands on one, the window scrolls by as little as it
  // takes to put the whole of it on screen — the label, the value and the line
  // saying what it is worth are one thing, and half of them is worse than none.
  const span = spans[at]
  useEffect(() => {
    if (!span) return
    setOffset((current) => {
      const last = current + layout.listRows
      if (span.end > last) return Math.max(0, span.end - layout.listRows)
      if (span.start < current) return span.start
      return current
    })
  }, [span?.start, span?.end, layout.listRows])

  const take = useCallback(() => {
    const field = fields[at]
    if (!field) return
    copy(field.value)
    onCopy?.(field.copyAs || field.label.toLowerCase())
  }, [fields, at, onCopy])

  useInput((input, key) => {
    if (key.escape || input === 'q' || (key.ctrl && input === 'c')) return onCancel()
    if (input === 'r' && secrets) return setRevealed((current) => !current)
    if (input === 'c' || key.return) return take()
    if (key.tab) return move(key.shift ? -1 : 1)
    if (key.downArrow || input === 'j') return move(1)
    if (key.upArrow || input === 'k') return move(-1)
    if (key.pageDown || (key.ctrl && input === 'd')) return scroll(layout.listRows)
    if (key.pageUp || (key.ctrl && input === 'u')) return scroll(-layout.listRows)
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

  const visible = rows.slice(offset, offset + layout.listRows)

  const footer = [
    { keys: 'c', label: 'copy' },
    stops.length > 1 ? { keys: '⇥', label: 'next' } : null,
    secrets ? { keys: 'r', label: revealed ? 'hide' : 'reveal' } : null,
    { keys: 'esc', label: 'close' }
  ].filter(Boolean)

  return (
    <Float
      theme={theme}
      layout={layout}
      title={title}
      icon={icon}
      count={rows.length > layout.listRows ? `${offset + 1}-${offset + visible.length}/${rows.length}` : undefined}
      footer={footer}
      backdrop={backdrop}
    >
      <FloatRow theme={theme} layout={layout}>
        <Text color={theme.dim}>{truncate(subtitle || '', width - 4)}</Text>
      </FloatRow>

      <FloatRule theme={theme} layout={layout} />

      {visible.map((row, i) => (
        <FloatRow key={`k-${offset + i}`} theme={theme} layout={layout}>{row}</FloatRow>
      ))}

      <FloatFill theme={theme} layout={layout} rows={layout.listRows - visible.length} />
    </Float>
  )
}

/**
 * Every field as screen rows.
 *
 * Exported for the same reason the chat pane's row builder is: the float has to
 * know how tall it will be before it is drawn, and a component that decides
 * that while rendering cannot tell it.
 *
 * @returns {{ rows: React.ReactElement[], spans: {start: number, end: number}[] }}
 *          one node per row, none of them wrapping, and the rows each field
 *          occupies — which is what lets the window scroll a field into view
 *          rather than a line
 */
export function fieldRows ({ fields, theme, revealed, focus, inner }) {
  const rows = []
  const spans = []
  const blank = () => rows.push(<Text> </Text>)

  fields.forEach((field, index) => {
    if (rows.length) blank()
    const start = rows.length
    spans.push({ start, end: start })

    const active = index === focus
    const hidden = field.secret && !revealed
    const tagColor = field.tone === 'danger' ? theme.red : field.tone === 'safe' ? theme.green : theme.subtle

    // The label row carries the field's name on the left and what the field is
    // worth to someone else on the right — the one thing you have to know
    // before you paste it anywhere.
    const tag = field.tag || ''
    const head = `${active ? '❯ ' : '  '}${field.label}`
    const gap = Math.max(1, inner - visibleWidth(head) - visibleWidth(tag))

    // A field with nothing to copy is one row: a label and the thing itself.
    // Giving it the same three-row treatment as a key would say the two are
    // the same kind of fact, and they are not — one of them is why this window
    // exists and the other is context for reading it.
    if (field.plain) {
      rows.push(
        <Text>
          <Text color={theme.dim}>{'  ' + field.label.padEnd(PLAIN_LABEL)}</Text>
          <Text color={theme.fg}>{truncate(field.value, Math.max(4, inner - 2 - PLAIN_LABEL))}</Text>
        </Text>
      )
      if (field.note) {
        rows.push(
          <Text>
            <Text>{' '.repeat(2 + PLAIN_LABEL)}</Text>
            <Text color={theme.subtle}>{truncate(field.note, Math.max(4, inner - 2 - PLAIN_LABEL))}</Text>
          </Text>
        )
      }
      spans[index].end = rows.length
      return
    }

    rows.push(
      <Text>
        <Text color={active ? theme.accent : theme.subtle}>{active ? '❯ ' : '  '}</Text>
        <Text color={active ? theme.accent2 : theme.dim} bold>{field.label}</Text>
        <Text>{' '.repeat(gap)}</Text>
        <Text color={tagColor}>{tag}</Text>
      </Text>
    )

    {
      const box = inner - 2
      const body = box - 4
      const shown = hidden ? mask(field.value) : String(field.value ?? '')
      const edge = active ? theme.borderFocus : theme.border

      rows.push(<Text color={edge}>{`  ╭${'─'.repeat(box - 2)}╮`}</Text>)

      for (const line of lay(shown, body)) {
        rows.push(
          <Text>
            <Text color={edge}>{'  │ '}</Text>
            <Text color={hidden ? theme.subtle : field.secret ? theme.yellow : theme.accent}>
              {line.padEnd(body)}
            </Text>
            <Text color={edge}>{' │'}</Text>
          </Text>
        )
      }

      rows.push(<Text color={edge}>{`  ╰${'─'.repeat(box - 2)}╯`}</Text>)
    }

    if (field.note) {
      rows.push(
        <Text>
          <Text>{'  '}</Text>
          {/* The tag on the label row is what carries the warning; the note
              is the explanation under it. Colouring both red gives the eye two
              alarms for one fact and leaves nothing to look at first. */}
          <Text color={theme.subtle}>{truncate(field.note, inner - 2)}</Text>
        </Text>
      )
    }

    spans[index].end = rows.length
  })

  return { rows, spans }
}

/**
 * A value across as many lines as it takes.
 *
 * Which way it breaks depends on what it is, and the difference matters. A key
 * or an invite is one token: it is broken at exactly the column, with nothing
 * inserted and nothing moved, because the value on this screen has to *be* the
 * value — something copied off it by eye, or by the terminal's own selection,
 * must still be the string it says it is. Deliberately not grouped into
 * readable chunks either, for the same reason: grouping puts spaces inside it.
 *
 * A recovery phrase is the opposite. It is already words, so it is already not
 * one token, and the whole point of it is that a human reads it off the screen
 * and writes it on paper. Breaking `password` into `pas` and `sword` across two
 * lines is how somebody loses an account.
 */
function lay (value, columns) {
  const source = String(value ?? '')
  return /\s/.test(source) ? wrap(source, columns) : chunk(source, columns)
}

function chunk (value, columns) {
  const source = String(value ?? '')
  if (source === '') return ['']

  const out = []
  let line = ''
  for (const ch of source) {
    if (visibleWidth(line + ch) > columns) {
      out.push(line)
      line = ''
    }
    line += ch
  }
  if (line) out.push(line)
  return out
}

/** A secret's shape without its content: as many dots as it has characters. */
function mask (value) {
  return String(value ?? '').replace(/\S/g, '•')
}
