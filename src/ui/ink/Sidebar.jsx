// The conversation list down the left.
//
// It is the one piece of chrome that is always on screen, so it earns its
// columns by answering the two questions you actually have between messages:
// what else is going on, and where am I. Rooms first, then the people you talk
// to directly, each with its unread count — and nothing else, because a
// sidebar that grows features is a sidebar that grows columns.
//
// Three states share this pane and all three have to be legible at a glance,
// which is what the two marker columns on the left are for. A rule under a
// section heading groups the list; a solid bar marks the conversation you are
// *in*; a caret marks the row the cursor is on while the list has the keyboard.
// The last two are different things — where you are and where you are about to
// go — and a list that draws them the same way is a list you get lost in.
//
// Like the chat pane it hands back one element per screen row, so a click can
// be turned back into a conversation by ui/model/layout.js.

import React from 'react'
import { Text } from 'ink'

import { fit, truncate, width } from '../model/text.js'

/**
 * @param {object} props
 * @param {boolean} [props.focused]   the pane has the keyboard
 * @param {number} [props.selected]   which row the cursor is on, when focused
 * @param {{ id: string, name: string, kind: string, unread: number,
 *           closed?: boolean, owned?: boolean }[]} props.conversations
 * @param {string|null} props.activeId
 * @param {number} props.columns
 * @returns {{ rows: React.ReactElement[], targets: (string|null)[] }}
 *          one row each, and what a click on that row should open
 */
export function sidebarRows ({
  conversations, activeId, columns, theme, muted = false, focused = false, selected = -1
}) {
  const dye = (color) => (muted ? theme.subtle : color)
  const icons = theme.icons
  // Every row is padded to the full width of the pane, so the highlight on the
  // conversation you are in spans it rather than stopping at the name.
  const inner = columns

  const rows = []
  const targets = []

  const rooms = conversations.filter((c) => c.kind !== 'dm')
  const direct = conversations.filter((c) => c.kind === 'dm')

  // A heading with a rule running off it to the right edge. The rule is what
  // makes two lists read as two lists rather than as one list with a word in
  // the middle of it, and it costs nothing but the columns nothing else wanted.
  const section = (label) => {
    if (rows.length > 0) {
      rows.push(<Text key={`gap-${rows.length}`}> </Text>)
      targets.push(null)
    }
    const rule = Math.max(0, inner - 3 - label.length)
    rows.push(
      <Text key={`s-${label}`} wrap='truncate-end'>
        <Text>{' '}</Text>
        <Text color={dye(theme.dim)} bold={!muted}>{label}</Text>
        <Text color={theme.subtle}>{` ${'─'.repeat(rule)}`}</Text>
      </Text>
    )
    targets.push(null)
  }

  const item = (conversation) => {
    const active = conversation.id === activeId
    // Two different things, and they look different: `active` is the
    // conversation you are in, `cursor` is the row you are about to open.
    const cursor = focused && rows.length === selected
    const unread = conversation.unread || 0
    const badge = unread > 0 ? (unread > 99 ? '99+' : String(unread)) : ''
    const flag = conversation.closed ? icons.closed : conversation.owned ? icons.owner : ''

    // The name is cut to whatever the badge and the flag leave behind, so a
    // long room name can never push the count off the edge of the pane — and
    // there is always a column of air between the two, or a name that happens
    // to fill the pane exactly runs straight into its own unread count.
    const room = inner - 2 - (badge ? width(badge) + 2 : 0) - (flag ? width(flag) + 2 : 0)
    const label = truncate(`${conversation.kind === 'dm' ? icons.dm : icons.room}${conversation.name}`, Math.max(3, room))

    rows.push(
      <Text
        key={`c-${conversation.id}`}
        wrap='truncate-end'
        backgroundColor={!muted && (cursor || active) ? theme.selection : undefined}
      >
        <Text color={cursor ? dye(theme.accent2) : active ? dye(theme.accent) : theme.subtle}>
          {/* The cursor takes the caret while the list has the keyboard, so the
              conversation you are *in* steps aside to the solid bar rather
              than competing with the one you are about to open. */}
          {cursor ? `${icons.selected} ` : active ? `${icons.edge} ` : '  '}
        </Text>
        <Text
          color={cursor ? dye(theme.fg) : active ? dye(theme.accent) : unread ? dye(theme.fg) : dye(theme.dim)}
          bold={(active || cursor) && !muted}
        >
          {fit(label, Math.max(3, room))}
        </Text>
        {flag ? <Text color={dye(theme.yellow)}>{`${flag} `}</Text> : ''}
        {badge ? <Text color={dye(theme.orange)} bold={!muted}>{`${badge} `}</Text> : ''}
      </Text>
    )
    targets.push(conversation.id)
  }

  if (rooms.length) {
    section('ROOMS')
    rooms.forEach(item)
  }
  if (direct.length) {
    section('DIRECT')
    direct.forEach(item)
  }

  // An empty list is the first thing a new account sees, so it says what to
  // press rather than sitting there being empty. Three chords, which between
  // them are every way there is to start a conversation.
  if (rows.length === 0) {
    rows.push(<Text key='e-head' wrap='truncate-end'><Text> </Text><Text color={dye(theme.dim)} bold={!muted}>NOTHING YET</Text></Text>)
    targets.push(null)
    rows.push(<Text key='e-gap'> </Text>)
    targets.push(null)

    for (const [keys, label] of [['␣ r n', 'new room'], ['␣ f d', 'message'], ['␣ r j', 'join']]) {
      rows.push(
        <Text key={`e-${rows.length}`} wrap='truncate-end'>
          <Text color={dye(theme.accent)}>{` ${keys}`}</Text>
          <Text color={theme.subtle}>{`  ${truncate(label, Math.max(1, inner - 9))}`}</Text>
        </Text>
      )
      targets.push(null)
    }
  }

  return { rows, targets }
}
