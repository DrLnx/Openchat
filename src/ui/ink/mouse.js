// Mouse support, and the one piece of terminal plumbing this app does by hand.
//
// Two things make this trickier than "listen for clicks":
//
// 1. Mouse reporting is a terminal mode, and while it is on the terminal stops
//    scrolling its own scrollback and stops letting you select text with the
//    mouse. That is a bad trade for a chat log you want to copy out of, so by
//    default reporting is only on while a floating window is open — click
//    anywhere in a picker, and the moment it closes your terminal behaves like
//    a terminal again. `mouse: always` in settings opts into the other trade.
//
// 2. The reports arrive on stdin, in band with the keys. Anything that reads
//    stdin without understanding them — a text input, say — types the escape
//    sequence into your message. So the raw stream is filtered *before* Ink
//    ever sees it, and Ink is handed the clean one.

import { PassThrough } from 'node:stream'
import { EventEmitter } from 'node:events'
import { createContext, useContext, useEffect } from 'react'

const ESC = '\u001b'
const ENABLE = `${ESC}[?1000h${ESC}[?1006h`
const DISABLE = `${ESC}[?1006l${ESC}[?1000l`

// ESC [ < button ; column ; row (M press | m release)
// eslint-disable-next-line no-control-regex
const SGR = /\u001b\[<(\d+);(\d+);(\d+)([Mm])/

/**
 * Wrap a real stdin so mouse reports come out on the side.
 *
 * @param {object} [io]
 * @param {NodeJS.ReadStream} [io.stdin]
 * @param {NodeJS.WriteStream} [io.stdout]
 * @returns {{ stdin: NodeJS.ReadStream, events: EventEmitter,
 *             enable(): void, disable(): void, destroy(): void, supported: boolean }}
 */
export function createMouseSource ({ stdin = process.stdin, stdout = process.stdout } = {}) {
  const events = new EventEmitter()
  const filtered = new PassThrough()
  const supported = Boolean(stdin.isTTY && stdout.isTTY)

  // Ink asks stdin for rather more than a stream: raw mode, TTY-ness, and the
  // ref/unref pair it uses to let the process exit. Forward all of it.
  Object.defineProperty(filtered, 'isTTY', { get: () => stdin.isTTY })
  filtered.setRawMode = (mode) => stdin.isTTY && stdin.setRawMode(mode)
  filtered.ref = () => stdin.ref?.()
  filtered.unref = () => stdin.unref?.()

  let carry = ''
  // Reference counted, because two things can want reporting on at once: a
  // float that turns it on while it is open, and the `mouse: always` setting.
  // A plain boolean would let the float's cleanup turn off reporting the
  // setting had asked for.
  let holders = 0

  const onData = (chunk) => {
    // A report can be split across two reads. Hold back a trailing partial
    // escape rather than passing half of it through as text.
    let text = carry + chunk.toString('utf8')
    carry = ''

    let out = ''
    for (;;) {
      const match = SGR.exec(text)
      if (!match) break
      out += text.slice(0, match.index)
      text = text.slice(match.index + match[0].length)
      emit(events, match)
    }

    const partial = text.lastIndexOf(`${ESC}[<`)
    if (partial !== -1 && !/[Mm]/.test(text.slice(partial))) {
      carry = text.slice(partial)
      text = text.slice(0, partial)
    }

    out += text
    if (out) filtered.write(out)
  }

  stdin.on('data', onData)

  return {
    stdin: filtered,
    events,
    supported,

    enable () {
      if (!supported) return
      holders++
      if (holders === 1) stdout.write(ENABLE)
    },

    disable () {
      if (holders === 0) return
      holders--
      if (holders === 0) stdout.write(DISABLE)
    },

    destroy () {
      holders = Math.min(holders, 1)
      this.disable()
      stdin.off('data', onData)
      filtered.end()
    }
  }
}

function emit (events, match) {
  const code = Number(match[1])
  const x = Number(match[2])
  const y = Number(match[3])
  const pressed = match[4] === 'M'

  const wheel = (code & 64) !== 0
  const motion = (code & 32) !== 0
  const button = code & 3

  events.emit('mouse', {
    type: wheel ? 'wheel' : motion ? 'move' : pressed ? 'press' : 'release',
    // Wheel up reports as button 0 with the wheel bit set, wheel down as 1.
    direction: wheel ? (button === 0 ? -1 : 1) : 0,
    button: wheel ? null : ['left', 'middle', 'right'][button] ?? null,
    x,
    y,
    shift: (code & 4) !== 0,
    meta: (code & 8) !== 0,
    ctrl: (code & 16) !== 0
  })
}

/**
 * The source, handed down the tree. Null in tests and anywhere stdin is not a
 * terminal, which is exactly when every component should behave as if the
 * mouse does not exist.
 */
export const MouseContext = createContext(null)

/**
 * Subscribe to mouse events. Rows and columns are 1-based screen coordinates,
 * which is what the terminal reports and what the float geometry works in.
 *
 * @param {(event: object) => void} handler
 * @param {boolean} [active]
 */
export function useMouse (handler, active = true) {
  const source = useContext(MouseContext)

  useEffect(() => {
    if (!source || !active) return
    source.events.on('mouse', handler)
    return () => source.events.off('mouse', handler)
  }, [source, handler, active])

  return source
}

/**
 * Turn reporting on for as long as this component is mounted — what a floating
 * window does, so the rest of the time the terminal is left alone.
 */
export function useMouseCapture (active) {
  const source = useContext(MouseContext)

  useEffect(() => {
    if (!source || !active) return
    source.enable()
    return () => source.disable()
  }, [source, active])
}
