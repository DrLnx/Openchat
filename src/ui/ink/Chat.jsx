// The conversation itself, painted into a pane of a known size.
//
// Every entry becomes a whole number of rows, and the pane hands back an array
// of them. That is the difference between this and a component that just
// renders: a fixed-height screen has to know how tall the transcript is before
// it draws it, so it can scroll to the bottom, so a click can be mapped to a
// line, and so nothing pushes the prompt off the screen. Ink's own wrapping
// gives you none of those, so the wrapping happens here.
//
// Consecutive lines from one person are grouped under a single header, the way
// every chat client worth using does it — a name repeated down the left margin
// is noise, and the whole point of a pane this size is that you can read it.
//
// What replaces the repeated name is a thin rule down the margin. A block of
// wrapped text with nothing to its left floats in the middle of the pane and
// gives the eye nothing to come back to at the start of each line; a single
// character does, and costs one column.
//
// Three things share the marker column, and between them they are everything
// the eye needs before it starts reading a line: a dot in the speaker's own
// colour, a caret when the speaker is you, and a solid bar when the line is
// talking to you. Everything else in a row — the clock, the name, the body — is
// text you have to actually read.
//
// A rule with the date on it goes in wherever the day changes. It is the only
// thing in the pane that is not a message, and it is there because a clock
// alone cannot tell you whether "09:12" was this morning or last Thursday.

import React from 'react'
import { Text } from 'ink'

import { wrap, fit, truncate } from '../model/text.js'
import {
  displayName, formatBytes, formatTime, formatDay, sameDay,
  formatSystemEvent, formatNickChange
} from '../model/format.js'

/** Columns for the clock, the marker, the name and the margin rule. */
const TIME_COLUMNS = 6
const MARK_COLUMNS = 2
const NAME_COLUMNS = 10
const RULE_COLUMNS = 2

/** Below this much room for the text, names go on their own line instead. */
const NARROW_BODY = 24

/** Messages from one person this close together share a header. */
const GROUP_WINDOW_MS = 5 * 60 * 1000

/** How many rows of progress bar an attachment gets. */
const BAR_COLUMNS = 16

/**
 * How many columns a message body actually gets in a pane this wide.
 *
 * Exported because it is the one number the pane and anything reasoning about
 * the pane have to agree on, and two copies of it would drift.
 */
export function bodyColumns (width, settings = {}) {
  const usable = Math.max(8, width - 2)
  const timeColumns = settings.timestamps === 'off' ? 0 : TIME_COLUMNS
  const gutter = timeColumns + MARK_COLUMNS + NAME_COLUMNS + RULE_COLUMNS
  return usable - gutter < NARROW_BODY ? Math.max(8, usable - 2) : usable - gutter
}

/**
 * The transcript as rows, oldest first.
 *
 * @param {object} props
 * @param {object[]} props.entries      from ui/model/state.js transcript()
 * @param {number} props.width          columns the pane owns
 * @param {boolean} [props.muted]       drawn behind a float, so drained of colour
 * @returns {{ rows: React.ReactElement[], anchors: Map<string, number> }}
 *          one element per screen row, and the row each entry starts on — which
 *          is what lets a search result be scrolled to rather than described
 */
export function chatRows ({
  entries, width, theme, settings = {}, members = {}, attachments = {}, self, muted = false
}) {
  const icons = theme.icons
  const dye = (color) => (muted ? theme.subtle : color)

  const usable = Math.max(8, width - 2)
  const timeColumns = settings.timestamps === 'off' ? 0 : TIME_COLUMNS
  const gutter = timeColumns + MARK_COLUMNS + NAME_COLUMNS + RULE_COLUMNS
  const narrow = usable - gutter < NARROW_BODY
  const columns = bodyColumns(width, settings)

  const rows = []
  const anchors = new Map()
  const add = (node) => rows.push(node)
  const blank = () => add(<Text> </Text>)

  let lastAuthor = null
  let lastTs = 0
  let lastDay = null

  // Detail lines — notices, joins, renames — start where a message body starts,
  // so the pane has one text column rather than two. The mark that says what
  // kind of line it is goes in the two columns before it.
  const indent = narrow ? 0 : gutter - 2
  const detail = (lines, color, mark) => addDetail(rows, lines, color, theme, indent, mark)

  for (const entry of entries) {
    // Whatever else it is, it happened on a day, and the day is worth saying
    // once when it changes rather than never.
    if (lastDay !== null && !sameDay(lastDay, entry.ts)) {
      lastAuthor = null
      rows.push(dayRule(entry.ts, usable, theme, muted, rows.length))
    }
    lastDay = entry.ts

    if (entry.kind === 'notice') {
      lastAuthor = null
      detail(
        wrapDetail(String(entry.notice.text), usable, indent),
        noticeColor(entry.notice, theme, muted),
        noticeMark(entry.notice, theme)
      )
      continue
    }

    const message = entry.message

    if (message.type === 'system') {
      lastAuthor = null
      detail(wrapDetail(formatSystemEvent(message, members), usable, indent), dye(theme.subtle), icons.sep)
      continue
    }

    if (message.type === 'nick') {
      lastAuthor = null
      detail(wrapDetail(formatNickChange(message, entry.previousName), usable, indent), dye(theme.subtle), icons.sep)
      continue
    }

    const isSelf = message.author === self?.publicKey
    const name = displayName(members[message.author], message.author)
    const author = dye(theme.authorColor(message.author))
    const mentioned = !isSelf && mentions(message, self)

    // A run of messages from one person is one block: header once, then the
    // lines under it. Anything else in between — a notice, someone else
    // speaking — ends the run.
    const grouped = message.author === lastAuthor && message.ts - lastTs < GROUP_WINDOW_MS
    if (!grouped && rows.length > 0 && !settings.compact) blank()

    anchors.set(message.id, rows.length)

    const text = message.type === 'file'
      ? `${message.name} (${formatBytes(message.size)})`
      : message.body

    // Your own words are not less important than everyone else's, so they are
    // not dimmer than everyone else's. What marks them is the green caret and
    // your name in the margin, which is where the eye looks to tell who spoke,
    // not the body it then has to read.
    const bodyColor = message.type === 'file'
      ? dye(theme.cyan)
      : mentioned ? dye(theme.fg) : undefined

    const lines = wrap(text, columns)

    if (narrow) {
      if (!grouped) {
        add(
          <Text key={`h:${entry.key}`} wrap='truncate-end'>
            {timeColumns ? <Text color={dye(theme.subtle)}>{stamp(message.ts, settings.timestamps)}</Text> : ''}
            <Text color={isSelf ? dye(theme.mode.insert) : author}>
              {isSelf ? icons.self : icons.incoming}
            </Text>
            <Text color={isSelf ? dye(theme.mode.insert) : author} bold={!muted}>{` ${isSelf ? 'you' : name}`}</Text>
          </Text>
        )
      }
      lines.forEach((line, i) => {
        add(
          <Text key={`b:${entry.key}:${rows.length}`} wrap='truncate-end'>
            <Text color={mentioned ? dye(theme.orange) : theme.subtle}>
              {mentioned ? `${icons.edge} ` : i === 0 ? '  ' : `${icons.bar} `}
            </Text>
            <Text color={bodyColor}>{line}</Text>
          </Text>
        )
      })
    } else {
      lines.forEach((line, i) => {
        // Three kinds of row, and they have to be told apart at a glance:
        // the first line of a new speaker's block, which gets the whole header;
        // the first line of the *next* message from that same speaker, which
        // gets its clock but no name; and a line that is merely the previous
        // one wrapping, which gets nothing. Without the middle case a run of
        // separate messages reads as one long paragraph.
        const head = i === 0 && !grouped
        const stamped = i === 0

        add(
          <Text key={`m:${entry.key}:${rows.length}`} wrap='truncate-end'>
            {timeColumns
              ? (
                <Text color={dye(theme.subtle)}>
                  {stamped ? stamp(message.ts, settings.timestamps) : ' '.repeat(timeColumns)}
                </Text>
                )
              : ''}
            <Text color={isSelf ? dye(theme.mode.insert) : author}>
              {head ? `${isSelf ? icons.self : icons.incoming} ` : '  '}
            </Text>
            <Text color={isSelf ? dye(theme.mode.insert) : author} bold={head && !muted}>
              {fit(head ? (isSelf ? 'you' : name) : '', NAME_COLUMNS)}
            </Text>
            {/* A line that says your name gets a solid bar down its whole
                left edge rather than one mark on its first row: what you want
                to find when you come back to a room is the block, and a block
                is only visible if it is marked all the way down. */}
            <Text color={mentioned ? dye(theme.orange) : theme.subtle}>
              {mentioned ? `${icons.edge} ` : head ? '  ' : `${icons.bar} `}
            </Text>
            <Text color={bodyColor}>{line}</Text>
          </Text>
        )
      })
    }

    if (message.type === 'file') {
      detail([attachmentLine(message, attachments[message.id], theme, muted, usable)], dye(theme.dim), icons.detail)
    }

    lastAuthor = message.author
    lastTs = message.ts
  }

  return { rows, anchors }
}

/**
 * The window into the transcript: exactly `height` rows, oldest at the top.
 *
 * A transcript shorter than the pane sits on the bottom of it rather than the
 * top, so the newest line is always in the same place — directly above the
 * prompt — however little there is above it.
 *
 * @param {number} scroll  rows scrolled up from the bottom; 0 follows the end
 */
export function chatWindow (rows, height, scroll = 0) {
  const start = Math.max(0, rows.length - height - Math.max(0, scroll))
  const visible = rows.slice(start, start + height)
  const padding = Math.max(0, height - visible.length)

  return [
    ...Array.from({ length: padding }, (_, i) => <Text key={`pad-${i}`}> </Text>),
    ...visible
  ]
}

/** The furthest back you can scroll: 0 when the whole transcript fits. */
export function maxScroll (total, height) {
  return Math.max(0, total - height)
}

/**
 * The scroll position that puts row `index` in the middle of the pane.
 *
 * @returns {number} clamped to what the transcript actually allows
 */
export function scrollToRow (index, total, height) {
  const start = Math.max(0, index - Math.floor(height / 2))
  return Math.max(0, Math.min(maxScroll(total, height), total - height - start))
}

function addDetail (rows, lines, color, theme, indent = 2, mark = theme.icons.detail) {
  lines.forEach((line, i) => {
    rows.push(
      <Text key={`d:${rows.length}`} wrap='truncate-end'>
        <Text>{' '.repeat(indent)}</Text>
        {/* The mark is drawn once and continued by a rule, the same way a
            wrapped message is: the eye needs the left edge of the block to be
            in one place, not to move when a line runs on. */}
        <Text color={i === 0 ? color : theme.subtle}>{i === 0 ? `${mark} ` : `${theme.icons.bar} `}</Text>
        {typeof line === 'string' ? <Text color={color}>{line}</Text> : line}
      </Text>
    )
  })
}

/** The rule that says the day changed here. */
function dayRule (ts, usable, theme, muted, key) {
  const label = formatDay(ts)
  const room = Math.max(0, usable - label.length - 4)
  const left = Math.floor(room / 2)

  return (
    <Text key={`day:${key}`} wrap='truncate-end'>
      <Text color={theme.subtle}>{`${'\u2500'.repeat(left)}  `}</Text>
      <Text color={muted ? theme.subtle : theme.dim}>{label}</Text>
      <Text color={theme.subtle}>{`  ${'\u2500'.repeat(Math.max(0, room - left))}`}</Text>
    </Text>
  )
}

function wrapDetail (text, usable, indent = 2) {
  const columns = Math.max(8, usable - indent - 2)
  // Command output arrives pre-formatted — /help lines things up in columns —
  // so its own newlines are kept and only over-long lines are wrapped.
  const out = []
  for (const line of String(text ?? '').split('\n')) {
    for (const wrapped of wrap(line, columns)) out.push(wrapped)
  }
  return out
}

function noticeMark (notice, theme) {
  if (notice.level === 'error') return theme.icons.error
  if (notice.level === 'warn') return theme.icons.warn
  return theme.icons.detail
}

function noticeColor (notice, theme, muted) {
  if (muted) return theme.subtle
  if (notice.level === 'error') return theme.red
  if (notice.level === 'warn') return theme.yellow
  return theme.dim
}

/** One row saying what happened to an attachment. */
function attachmentLine (message, attachment, theme, muted, usable) {
  const dye = (color) => (muted ? theme.subtle : color)
  const status = attachment?.status

  if (status === 'downloading') {
    const progress = Math.min(Math.max(attachment.progress || 0, 0), 1)
    const filled = Math.round(progress * BAR_COLUMNS)
    return (
      <Text>
        <Text color={dye(theme.accent)}>{'█'.repeat(filled)}</Text>
        <Text color={theme.subtle}>{'░'.repeat(BAR_COLUMNS - filled)}</Text>
        <Text color={dye(theme.dim)}> {Math.round(progress * 100)}%</Text>
      </Text>
    )
  }

  if (status === 'ready') {
    if (attachment.sent) return <Text color={dye(theme.dim)}>sent</Text>
    return (
      <Text color={dye(theme.dim)}>
        <Text color={dye(theme.green)}>{theme.icons.ok} </Text>
        {truncate(attachment.path ? `saved to ${attachment.path}` : 'received', Math.max(8, usable - 12))}
      </Text>
    )
  }

  if (status === 'failed') {
    return <Text color={dye(theme.red)}>{theme.icons.error} failed: {truncate(attachment.error || '', Math.max(8, usable - 20))}</Text>
  }

  return (
    <Text color={dye(theme.dim)}>
      {status === 'available' ? 'over the auto-download limit — ' : 'not downloaded — '}
      <Text color={dye(theme.accent)}>/download {message.id.slice(0, 6)}</Text>
    </Text>
  )
}

function stamp (ts, style = '24h') {
  if (style === 'off') return ''
  if (style === '12h') {
    const d = new Date(ts)
    const hour = d.getHours() % 12 || 12
    const suffix = d.getHours() < 12 ? 'a' : 'p'
    return fit(`${hour}:${String(d.getMinutes()).padStart(2, '0')}${suffix}`, TIME_COLUMNS)
  }
  return fit(formatTime(ts), TIME_COLUMNS)
}

/**
 * Whether a message is talking to you. Deliberately a plain name match rather
 * than anything cleverer: there is no server to resolve a mention, and a false
 * positive costs you a coloured bar while a false negative costs you the
 * message.
 */
function mentions (message, self) {
  if (message.type !== 'text' || !self?.nick) return false
  return new RegExp(`(^|[^\\w])@?${escape(self.nick)}([^\\w]|$)`, 'i').test(message.body)
}

function escape (text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
