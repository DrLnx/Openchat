// The key menu: half a chord typed, and here is everything it could still
// become.
//
// It is the single feature that makes a modal interface learnable rather than
// something you have to be taught. Nobody memorises `<leader>fd`; they press
// space, read the menu, and after a week their fingers know it without them.
//
// It stands in the bottom-right corner of the chat pane, on top of the prompt,
// which is where which-key has always stood and where your eye already is when
// you are halfway through a chord. Three earlier versions got the position
// wrong: one was painted across the middle of the transcript; one was given
// rows of its own with the transcript redrawn shorter, which kept every line on
// screen and still shunted the whole conversation upward every time you reached
// for a key; and one sat against the top of the pane, out of the way but also
// nowhere near what you were doing.
//
// The corner is the right place and it is also the expensive one, because the
// transcript is anchored to the bottom — the rows down there are the newest
// messages. So this window does not take them. It is laid out by cornerLayout,
// which marks it `beside`, and Float keeps each covered chat row in the columns
// to the left of the frame. A conversation is left-aligned text in a wide pane,
// so what you are reading stays where it is and stays readable.
//
// That is also why the menu grows *upwards* before it grows sideways: a taller
// window costs rows that keep their conversation anyway, and a wider one eats
// into the columns that conversation is written in.
//
// The rows are plain: a key, a gap, and what it does, in one tight column.
// Groups are marked `+` the way which-key has always marked them — at the left
// edge of the label, where they line up with each other, rather than as a mark
// off at the end of a padded column with nothing to line up against.

import React from 'react'
import { Text } from 'ink'

import { Float, FloatRow } from './Float.jsx'
import { cornerLayout, gridFor, FRAME_ROWS } from '../model/layout.js'
import { groupFor } from '../model/keymap.js'
import { fit, width as visibleWidth } from '../model/text.js'

/** The key and the gap after it. */
const KEY_COLUMNS = 3

/** Padding: the cap, and the column of air before the next entry. */
const PADDING = KEY_COLUMNS + 2

/** Longest label the menu will lay a column out for. */
const MAX_LABEL = 24

// The shortest the menu is allowed to be before it starts taking columns, on a
// terminal too short to give it the whole body. Columns are the expensive
// direction here — see the note at the top — so this is a floor, not a target.
const MIN_ROWS = 5

/**
 * One entry per next key, in the order they should be read.
 *
 * Several bindings can share a prefix — `<leader>ff` and `<leader>fd` both sit
 * under `f` — and what belongs on that row is the group, not whichever of its
 * children happened to be declared first.
 */
export function keyEntries (candidates = [], pending = []) {
  const seen = new Map()

  for (const candidate of candidates) {
    if (seen.has(candidate.next)) continue
    const group = groupFor([...pending, candidate.next])
    const isGroup = Boolean(group) || candidate.sequence.length > pending.length + 1

    seen.set(candidate.next, {
      key: candidate.next,
      label: (group ? group.desc : candidate.desc).toLowerCase(),
      group: isGroup
    })
  }

  // What happens when you press it, then what opens another menu — each
  // alphabetical. A flat list sorted by keycap reads as noise; this way the
  // things that do something are together and above the things that do not.
  return [...seen.values()].sort((a, b) => (
    Number(a.group) - Number(b.group) || label(a.key).localeCompare(label(b.key))
  ))
}

/**
 * How the window will be laid out, given the room it has.
 *
 * The column is sized to the longest label rather than to a constant, so a menu
 * of short labels is a small panel in the corner instead of a band stretched
 * across the screen with nothing in the right half of it — and every column it
 * does not ask for is a column of conversation still being read.
 */
export function whichKeyLayout (screen, entries) {
  const longest = entries.reduce((n, e) => Math.max(n, visibleWidth(text(e))), 0)
  // Not `column`: that is the window's own offset inside the chat pane, and a
  // layout with two different things called the same thing is a layout that
  // draws itself in the wrong place.
  const columnWidth = Math.min(MAX_LABEL, Math.max(8, longest)) + PADDING

  // It may have the whole height of the chat pane before it takes a second
  // column, because a row it covers keeps its conversation beside it and a
  // column it takes does not.
  const grid = gridFor(entries.length, {
    width: screen.chatWidth - 1,
    columnWidth,
    preferredRows: Math.max(MIN_ROWS, screen.bodyRows - FRAME_ROWS)
  })

  return {
    ...cornerLayout(screen, { rows: grid.rows, width: grid.width }),
    columns: grid.columns,
    columnWidth
  }
}

export function WhichKey ({ theme, screen, pending, candidates, backdrop }) {
  if (candidates.length === 0) return null

  const entries = keyEntries(candidates, pending)
  const layout = whichKeyLayout(screen, entries)

  const rows = []
  for (let i = 0; i < entries.length; i += layout.columns) {
    rows.push(entries.slice(i, i + layout.columns))
  }

  // What you are looking at a list of: the group you are inside, or simply the
  // keys. The chord itself used to be set into the corner as well and it was
  // noise — you know what you just pressed, and the title already says where it
  // took you.
  const group = groupFor(pending)

  return (
    <Float
      theme={theme}
      layout={layout}
      title={group ? group.desc : 'keys'}
      footer={[{ keys: 'esc', label: 'cancel' }]}
      backdrop={backdrop}
    >
      {rows.slice(0, layout.rows).map((row, i) => (
        <FloatRow key={i} theme={theme} layout={layout}>
          {row.map((entry) => (
            <Entry key={entry.key} theme={theme} entry={entry} width={layout.columnWidth} />
          ))}
        </FloatRow>
      ))}
    </Float>
  )
}

/**
 * One key and what it does.
 *
 * The key is the only thing on the row in the accent colour, because it is the
 * only thing you are looking for; the label is there to be read once, while you
 * are learning it, and never again.
 */
function Entry ({ theme, entry, width }) {
  return (
    <Text>
      <Text color={theme.accent} bold>{fit(label(entry.key), KEY_COLUMNS)}</Text>
      <Text color={entry.group ? theme.accent2 : theme.dim}>
        {fit(text(entry), width - PADDING)}
      </Text>
      <Text>{'  '}</Text>
    </Text>
  )
}

/** A group says so at the front of its label, where every other one says it. */
function text (entry) {
  return entry.group ? `+${entry.label}` : entry.label
}

function label (key) {
  if (key === '<space>') return '␣'
  return key.replace(/^<|>$/g, '')
}
