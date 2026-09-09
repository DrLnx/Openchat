// The command line: `:` in normal mode, and a window to type into.
//
// Commands used to be messages that happened to start with a slash, which gave
// the message box two jobs. Every line you typed had to be inspected to work
// out which one it was doing, a stray leading slash sent a command instead of
// the sentence you meant, and a message that genuinely started with a slash
// needed an escape hatch to send at all. The message box only sends messages
// now, and this is where commands go — the same split vim has had for fifty
// years, for the same reason.
//
// It is a window rather than a takeover of the prompt: what you are typing, the
// commands that match it, and what each one does, in one frame near the top of
// the screen, where vim's own command line lives and where the transcript is not
// using the rows. Like the key menu it is laid over the frame rather than wedged
// into it, so opening it moves nothing. See popupLayout in ui/model/layout.js.

import React from 'react'
import { Text } from 'ink'

import { Float, FloatRow, FloatRule } from './Float.jsx'
import { popupLayout } from '../model/layout.js'
import { segments } from '../model/fuzzy.js'
import { matchPositions, usageOf } from '../model/commands.js'
import { fit, truncate, width as visibleWidth } from '../model/text.js'

/** Completions listed before the window stops growing. */
export const CMDLINE_ROWS = 7

/** How wide the window is drawn, at most. Prose does not want more. */
const CMDLINE_COLUMNS = 76

const FOOTER = [
  { keys: '⏎', label: 'run' },
  { keys: '⇥', label: 'complete' },
  { keys: '↑↓', label: 'move' },
  { keys: 'esc', label: 'cancel' }
]

/** How the window will be laid out, given the room it has. */
export function cmdlineLayout (screen, matches = []) {
  // The line you are typing, the rule under it, and whatever fits of the list —
  // with a row kept back for "nothing matches", so a window that finds nothing
  // is the same shape as one that finds something.
  const rows = 2 + Math.max(1, Math.min(matches.length, CMDLINE_ROWS))
  return popupLayout(screen, { rows, width: CMDLINE_COLUMNS })
}

/**
 * @param {object} props
 * @param {string} props.value    what has been typed, without the leading colon
 * @param {number} props.cursor
 * @param {object[]} props.matches
 * @param {number} props.selected
 */
export function Cmdline ({ theme, screen, value, cursor, matches = [], selected = 0, backdrop }) {
  const layout = cmdlineLayout(screen, matches)

  // The usage column is sized to what is actually on screen rather than to a
  // guess, so the help text lines up in a column of its own instead of running
  // ragged behind names of every length.
  // Never more rows than the window was actually given: a short terminal has
  // room for the line you are typing and little else.
  const visible = matches.slice(0, Math.max(0, Math.min(CMDLINE_ROWS, layout.rows - 2)))
  const gutter = Math.min(28, Math.max(...visible.map((c) => visibleWidth(usageOf(c))), 10) + 2)

  return (
    <Float
      theme={theme}
      layout={layout}
      title='command'
      icon={theme.icons.command}
      count={matches.length ? `${selected + 1}/${matches.length}` : 'none'}
      footer={FOOTER}
      backdrop={backdrop}
    >
      <FloatRow theme={theme} layout={layout}>
        <Text color={theme.mode.command} bold>:</Text>
        <Text>{value.slice(0, cursor)}</Text>
        <Text backgroundColor={theme.accent} color={theme.on}>{value[cursor] || ' '}</Text>
        <Text>{value.slice(cursor + 1)}</Text>
      </FloatRow>

      <FloatRule theme={theme} layout={layout} />

      {visible.map((command, i) => (
        <FloatRow
          key={command.name}
          theme={theme}
          layout={layout}
          background={i === selected ? theme.selection : undefined}
        >
          <Text color={i === selected ? theme.accent : theme.subtle}>
            {i === selected ? `${theme.icons.selected} ` : '  '}
          </Text>
          {segments(usageOf(command), i === selected ? [] : matchPositions(value, usageOf(command)))
            .map((part, j) => (
              <Text
                key={j}
                color={part.match ? theme.accent2 : (i === selected ? theme.fg : theme.dim)}
                bold={part.match || i === selected}
              >
                {part.text}
              </Text>
            ))}
          <Text>{' '.repeat(Math.max(1, gutter - visibleWidth(usageOf(command))))}</Text>
          {/* Padded to the full width rather than cut to it, so the highlight
              on the selected row spans the row instead of stopping wherever
              its help text happened to end. */}
          <Text color={i === selected ? theme.fg : theme.subtle}>
            {fit(command.help, Math.max(8, layout.inner - gutter - 2))}
          </Text>
        </FloatRow>
      ))}

      {matches.length === 0 && (
        <FloatRow theme={theme} layout={layout}>
          <Text color={theme.subtle}>
            {value.trim()
              ? `nothing called "${truncate(value.trim(), 24)}" — try :help`
              : 'type a command, or part of what it does'}
          </Text>
        </FloatRow>
      )}
    </Float>
  )
}
