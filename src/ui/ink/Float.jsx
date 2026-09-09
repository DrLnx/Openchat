// The chrome every window in openchat shares: a titled frame with its legend
// set into the closing border, laid over the chat pane — centred for the
// finders and the key windows, at the top for the command line, and in the
// bottom-right corner for the key menu.
//
// It is drawn by hand rather than with a bordered <Box> for one reason that
// matters and one that does not. The one that matters: the app has to know the
// exact screen row of every line inside the frame so a mouse click can be
// mapped back to it, and that is only true if the frame's height is decided
// here rather than by a layout pass. The one that does not: a title and a
// counter set into the top border is what Telescope looks like, and no border
// style gives you that.
//
// Both borders carry text. The title and the count go in the top; the key hints
// go in the bottom. That is not decoration — a legend given a row of its own
// costs every window in the app one row of the thing you opened it to look at,
// and a border is exactly the right place for a caption.
//
// Everything here is emitted one element per screen row, and a window *is* an
// array of rows rather than a box containing them. Ink cannot layer one
// component over another, so the screen hands the chat pane over as rows and a
// window hands the same number back: its own where it covers, the pane's where
// it does not. Nothing behind it moves — a window that shifts the page is worse
// than one that covers part of it — and because what it replaces is the chat
// pane rather than the whole row, the conversation list beside it stays drawn.
//
// A row can be shared. Every frame row is drawn by FrameLine, which owns the
// columns to the *left* of the frame as well as the frame itself: normally they
// are blank, and for a corner window (cornerLayout) they hold the chat row that
// was there, clipped where the frame begins. That is what lets the key menu sit
// in the bottom-right corner — over the newest messages, which are the ones you
// are reading — without taking them off the screen.

import React from 'react'
import { Box, Text } from 'ink'

import { width as visibleWidth } from '../model/text.js'

/**
 * A titled frame, as an array of rows.
 *
 * @param {object} props
 * @param {object} props.theme
 * @param {object} props.layout   width and column, from ui/model/layout.js
 * @param {string} props.title
 * @param {string} [props.icon]
 * @param {string} [props.count]  set into the top border on the right
 * @param {{ keys: string, label: string }[]} [props.footer]  into the bottom
 * @param {React.ReactNode} props.children  the content rows
 * @returns {React.ReactElement[]}  exactly layout.height of them
 */
function frameRows ({ theme, layout, title, icon, count, footer = [], focused = true, children, under = [] }) {
  const edge = focused ? theme.borderFocus : theme.border
  const { width } = layout

  // Both borders are measured rather than guessed: the title, the icon, the
  // counter and every hint vary in width, and a rule one character out turns
  // the whole frame into a wrapped mess. Lay out everything that is not the
  // rule, then make the rule whatever is left over.
  const head = `${icon ? `${icon} ` : ''}${title}`
  const tail = count ? visibleWidth(count) + 2 : 0
  const fill = Math.max(0, width - 6 - visibleWidth(head) - tail)

  const top = (
    <FrameLine key='frame-top' layout={layout} under={under[0]}>
      <Text color={edge} wrap='truncate-end'>
        <Text>╭─ </Text>
        <Text color={theme.accent2} bold>{head}</Text>
        <Text>{` ${rule(fill)}`}</Text>
        {count ? <Text>{' '}<Text color={theme.dim}>{count}</Text>{' '}</Text> : null}
        <Text>─╮</Text>
      </Text>
    </FrameLine>
  )

  // The rows a window covers are handed to it in `under`, one per frame row,
  // and passed down so each row can keep the conversation beside it. Nothing
  // arrives for a window that replaces what it covers, and every FrameLine
  // below then draws blank columns to its left the way it always did.
  const content = React.Children.toArray(children)
  const body = under.length
    ? content.map((row, i) => React.cloneElement(row, { under: under[i + 1] }))
    : content

  return [
    top,
    ...body,
    legend({ theme, layout, footer, edge, under: under[under.length - 1] })
  ]
}

/**
 * One row of a window, and whatever is still showing to the left of it.
 *
 * Every row of every frame goes through here, so there is one answer to "where
 * does this row start" — which is the same reason layout.js exists. A window
 * that replaces the rows it covers gets blank columns on its left; a corner
 * window (see cornerLayout) gets the chat row that was there, clipped to the
 * columns it has left. Clipping is Ink's, not ours: the row is already a
 * `wrap='truncate-end'` Text, so a line that runs under the frame is cut with
 * an ellipsis at the boundary rather than disappearing.
 */
function FrameLine ({ layout, under, children }) {
  return (
    <Box flexShrink={0}>
      {layout.column > 0
        ? (
          <Box width={layout.column} flexShrink={0} overflow='hidden'>
            {under ?? <Text> </Text>}
          </Box>
          )
        : null}
      <Box width={layout.width} flexShrink={0}>{children}</Box>
    </Box>
  )
}

/**
 * The closing border, with the keys you can press written along it.
 *
 * Laid out from the right so the corner is always in the same column: the hints
 * are dropped one at a time from the end of the list when they do not all fit,
 * rather than the whole line being cut mid-word.
 */
function legend ({ theme, layout, footer, edge, under }) {
  const { width } = layout
  const room = width - 6

  const shown = []
  let used = 0
  for (const hint of footer) {
    const cost = visibleWidth(hint.keys) + 1 + visibleWidth(hint.label) + (shown.length ? 3 : 0)
    if (used + cost > room) break
    shown.push(hint)
    used += cost
  }

  return (
    <FrameLine key='frame-bottom' layout={layout} under={under}>
      {shown.length === 0
        ? <Text color={edge}>{`╰${rule(width - 2)}╯`}</Text>
        : (
          <Text color={edge} wrap='truncate-end'>
            <Text>╰─ </Text>
            {shown.map((hint, i) => (
              <Text key={hint.keys}>
                {i > 0 ? <Text color={theme.subtle}>{` ${theme.icons.sep} `}</Text> : ''}
                <Text color={theme.accent}>{hint.keys}</Text>
                <Text color={theme.dim}>{` ${hint.label}`}</Text>
              </Text>
            ))}
            <Text>{` ${rule(Math.max(0, room - used))}─╯`}</Text>
          </Text>
          )}
    </FrameLine>
  )
}

/**
 * A window laid over the chat pane, with the rows it does not cover kept.
 *
 * @param {object} props
 * @param {object} props.layout    from ui/model/layout.js
 * @param {React.ReactNode} props.children  exactly layout.height - 2 rows
 * @param {React.ReactElement[]} [props.backdrop]  the chat rows behind it
 * @returns {React.ReactElement[]}  as many rows as the backdrop had
 */
export function Float ({ theme, layout, title, icon, count, footer = [], focused = true, backdrop = [], children }) {
  // A window that stands beside what it covers (cornerLayout) is handed those
  // rows rather than dropping them, and draws each one in the columns left of
  // its own frame. Everything else covers what it covers.
  const under = layout.beside
    ? backdrop.slice(layout.above, layout.above + layout.height)
    : []

  const rows = frameRows({ theme, layout, title, icon, count, footer, focused, children, under })

  // Nothing to cover — a window rendered on its own is just a frame.
  if (backdrop.length === 0) return rows

  return [
    ...backdrop.slice(0, layout.above),
    ...rows,
    ...backdrop.slice(layout.above + layout.height)
  ]
}

/**
 * One content row inside a frame, with the side borders drawn for you.
 *
 * `under` is handed down by Float and is never passed in by hand: it is the
 * chat row this one is standing beside, and only a corner window has one.
 */
export function FloatRow ({ theme, layout, children, focused = true, background, under }) {
  const edge = focused ? theme.borderFocus : theme.border

  return (
    <FrameLine layout={layout} under={under}>
      <Text color={edge}>│</Text>
      <Box width={layout.width - 2} paddingX={1} overflow='hidden'>
        <Text wrap='truncate-end' backgroundColor={background}>{children}</Text>
      </Box>
      <Text color={edge}>│</Text>
    </FrameLine>
  )
}

/** The horizontal rule that separates the prompt from the results. */
export function FloatRule ({ theme, layout, focused = true, under }) {
  const edge = focused ? theme.borderFocus : theme.border
  return (
    <FrameLine layout={layout} under={under}>
      <Text color={edge}>{`├${rule(layout.width - 2)}┤`}</Text>
    </FrameLine>
  )
}

/**
 * Filler rows, so a short list still leaves the frame its declared height.
 *
 * An array rather than a fragment: a window is counted in rows, and a fragment
 * of six rows counts as one.
 */
export function FloatFill ({ theme, layout, rows, focused = true }) {
  if (rows <= 0) return []
  return Array.from({ length: rows }, (_, i) => (
    <FloatRow key={`fill-${i}`} theme={theme} layout={layout} focused={focused}>{' '}</FloatRow>
  ))
}

function rule (n) {
  return '─'.repeat(Math.max(0, n))
}
