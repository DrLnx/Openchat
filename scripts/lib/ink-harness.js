// Drives the real Ink UI with a stdout/stdin pair we control, so a script can
// type into the app and read back exactly what a terminal would show.
//
// ink-testing-library does the same thing but hard-codes 100 columns; these
// demos need a narrower terminal to stay readable when replayed elsewhere.

import { render as inkRender } from 'ink'
import { EventEmitter } from 'node:events'

export const DEFAULT_COLUMNS = 72

class HarnessStdout extends EventEmitter {
  constructor (columns) {
    super()
    this.columns = columns
    this.lastFrame = ''
  }

  write = (frame) => { this.lastFrame = frame }
}

class HarnessStdin extends EventEmitter {
  isTTY = true
  data = null

  // Ink drains stdin with `while ((chunk = stdin.read()) !== null)`, so this
  // has to hand the keystroke over exactly once.
  read = () => {
    const pending = this.data
    this.data = null
    return pending ?? null
  }

  write = (data) => {
    this.data = data
    this.emit('readable')
    this.emit('data', data)
  }

  setEncoding () {}
  setRawMode () {}
  resume () {}
  pause () {}
  ref () {}
  unref () {}
}

/**
 * @param {React.ReactElement} node
 * @param {{ columns?: number }} [opts]
 */
export function renderApp (node, { columns = DEFAULT_COLUMNS } = {}) {
  const stdout = new HarnessStdout(columns)
  const stdin = new HarnessStdin()

  // debug:true makes Ink write the full static output plus the live region on
  // every frame, which is what lets `lastFrame` show the whole terminal even
  // though the transcript lives in <Static>.
  const instance = inkRender(node, {
    stdout,
    stdin,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false
  })

  return {
    stdout,
    stdin,
    unmount: () => instance.unmount(),
    lastFrame: () => stdout.lastFrame,

    async type (line) {
      stdin.write(line)
      await sleep(80)
      stdin.write('\r')
      await sleep(120)
    },

    async press (sequence) {
      stdin.write(sequence)
      await sleep(120)
    }
  }
}

export const KEY = {
  down: `${String.fromCharCode(27)}[B`,
  up: `${String.fromCharCode(27)}[A`,
  enter: '\r',
  shiftTab: `${String.fromCharCode(27)}[Z`
}

export function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function stripAnsi (value) {
  const esc = String.fromCharCode(27)
  return String(value || '').replace(new RegExp(`${esc}\\[[0-9;?]*[A-Za-z]`, 'g'), '')
}
