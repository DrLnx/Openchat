// Tier 1 — the message buffer: text, cursor, and history, as pure functions.
//
// This exists instead of a text-input dependency for one reason: in a modal
// interface the app has to decide what a keypress means *before* anything can
// insert it. A component that grabs stdin itself will happily type "p" into
// your message when you meant Ctrl-P, and there is no way to take it back from
// the outside. Here the app routes every key, and this decides only what an
// edit does to the buffer.
//
// The bindings are readline's, which is what a terminal user has in their
// fingers whether or not they use vim.

import { typed } from './text.js'

export function createBuffer (value = '') {
  return {
    value,
    cursor: value.length,
    history: [],
    // Where we are while arrowing back through sent lines, and the half-typed
    // line to come back to.
    historyAt: null,
    draft: null
  }
}

const WORD = /[^\s/@#]/

/**
 * @returns {{ buffer: object, submit?: string } | null}
 *   null when the key means nothing here, so the caller can use it for
 *   something else.
 */
export function applyKey (buffer, input, key) {
  const { value, cursor } = buffer

  if (key.return) return commit(buffer, value)

  if (key.leftArrow || (key.ctrl && input === 'b')) return move(buffer, Math.max(0, cursor - 1))
  if (key.rightArrow || (key.ctrl && input === 'f')) return move(buffer, Math.min(value.length, cursor + 1))
  if (key.home || (key.ctrl && input === 'a')) return move(buffer, 0)
  if (key.end || (key.ctrl && input === 'e')) return move(buffer, value.length)

  if (key.upArrow) return recall(buffer, -1)
  if (key.downArrow) return recall(buffer, 1)

  if (key.backspace || (key.ctrl && input === 'h')) {
    if (cursor === 0) return { buffer }
    return edit(buffer, value.slice(0, cursor - 1) + value.slice(cursor), cursor - 1)
  }

  if (key.delete) {
    // Ink reports the Delete key and, on some terminals, backspace as `delete`.
    // Deleting forwards at the end of the line is a no-op either way, so treat
    // a delete with nothing to its right as a backspace rather than doing
    // nothing at all.
    if (cursor < value.length) return edit(buffer, value.slice(0, cursor) + value.slice(cursor + 1), cursor)
    if (cursor > 0) return edit(buffer, value.slice(0, cursor - 1) + value.slice(cursor), cursor - 1)
    return { buffer }
  }

  if (key.ctrl && input === 'w') {
    const at = wordStart(value, cursor)
    return edit(buffer, value.slice(0, at) + value.slice(cursor), at)
  }

  if (key.ctrl && input === 'u') return edit(buffer, value.slice(cursor), 0)

  if (key.ctrl || key.meta || key.tab || key.escape) return null

  // A paste arrives as one chunk; a keypress as one character; a name typed
  // quickly and confirmed arrives as `ada\r`. All three are text going in at
  // the cursor, and the last one is also an enter — see `typed` in text.js for
  // why that cannot be left to Ink.
  if (input && !isControl(input)) {
    const { text, submit } = typed(input)
    const line = value.slice(0, cursor) + text + value.slice(cursor)
    if (submit) return commit(buffer, line)
    return edit(buffer, line, cursor + text.length)
  }

  return null
}

/** Replace the whole line — what a picker does when it completes a command. */
export function setValue (buffer, value, cursor = value.length) {
  return { ...buffer, value, cursor: Math.max(0, Math.min(value.length, cursor)) }
}

function move (buffer, cursor) {
  return { buffer: { ...buffer, cursor } }
}

/** Hand the line over and start a new one, keeping it in the history. */
function commit (buffer, line) {
  return {
    submit: line,
    buffer: {
      ...buffer,
      value: '',
      cursor: 0,
      history: line.trim() ? [...buffer.history, line].slice(-200) : buffer.history,
      historyAt: null,
      draft: null
    }
  }
}

function edit (buffer, value, cursor) {
  return { buffer: { ...buffer, value, cursor, historyAt: null, draft: null } }
}

function recall (buffer, step) {
  const { history } = buffer
  if (history.length === 0) return { buffer }

  if (buffer.historyAt === null) {
    if (step > 0) return { buffer }
    const at = history.length - 1
    return {
      buffer: {
        ...buffer, historyAt: at, draft: buffer.value, value: history[at], cursor: history[at].length
      }
    }
  }

  const next = buffer.historyAt + step

  if (next >= history.length) {
    const draft = buffer.draft ?? ''
    return { buffer: { ...buffer, historyAt: null, draft: null, value: draft, cursor: draft.length } }
  }

  const at = Math.max(0, next)
  return { buffer: { ...buffer, historyAt: at, value: history[at], cursor: history[at].length } }
}

/** True for a lone control byte — an unbound chord we should not type out. */
function isControl (text) {
  // eslint-disable-next-line no-control-regex
  return /^[\u0000-\u001f\u007f]+$/.test(text)
}

function wordStart (value, cursor) {
  let at = cursor
  while (at > 0 && !WORD.test(value[at - 1])) at--
  while (at > 0 && WORD.test(value[at - 1])) at--
  return at
}
