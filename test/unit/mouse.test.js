// Mouse reports arrive on stdin, mixed in with the keys. If anything reading
// stdin does not understand them, they get typed into whatever you were
// writing — so the interesting property here is not "clicks are decoded" but
// "nothing that is not a click reaches the rest of the program".

import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'

import { createMouseSource } from '../../src/ui/ink/mouse.js'

const ESC = String.fromCharCode(27)

function source () {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const mouse = createMouseSource({ stdin, stdout })

  const events = []
  const written = []
  mouse.events.on('mouse', (event) => events.push(event))
  mouse.stdin.on('data', (chunk) => written.push(String(chunk)))

  return { stdin, stdout, mouse, events, text: () => written.join('') }
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

test('a click is decoded and kept out of the key stream', async () => {
  const { stdin, events, text } = source()

  stdin.write(`ab${ESC}[<0;12;5Mcd`)
  await settle()

  assert.equal(events.length, 1)
  assert.deepEqual(
    { type: events[0].type, button: events[0].button, x: events[0].x, y: events[0].y },
    { type: 'press', button: 'left', x: 12, y: 5 }
  )
  assert.equal(text(), 'abcd', 'the keys around it come through untouched')
})

test('the wheel reports a direction', async () => {
  const { stdin, events } = source()

  stdin.write(`${ESC}[<64;1;1M`)
  stdin.write(`${ESC}[<65;1;1M`)
  await settle()

  assert.deepEqual(events.map((e) => [e.type, e.direction]), [['wheel', -1], ['wheel', 1]])
})

test('a release is not mistaken for a press', async () => {
  const { stdin, events } = source()

  stdin.write(`${ESC}[<0;3;9m`)
  await settle()

  assert.equal(events[0].type, 'release')
})

test('a report split across two reads is still one event, and never leaks', async () => {
  const { stdin, events, text } = source()

  // Exactly what happens under load: the terminal's write lands in two chunks.
  stdin.write(`ef${ESC}[<0;3`)
  await settle()
  assert.equal(text(), 'ef', 'the half-report is held back rather than typed')

  stdin.write(';9M gh')
  await settle()

  assert.equal(events.length, 1)
  assert.equal(events[0].x, 3)
  assert.equal(text(), 'ef gh')
})

test('modifiers are reported', async () => {
  const { stdin, events } = source()

  stdin.write(`${ESC}[<20;1;1M`) // 16 (ctrl) + 4 (shift) + button 0
  await settle()

  assert.equal(events[0].ctrl, true)
  assert.equal(events[0].shift, true)
})

test('reporting is off until something asks for it, and goes off again', async () => {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  stdin.isTTY = true
  stdout.isTTY = true

  const out = []
  stdout.on('data', (chunk) => out.push(String(chunk)))

  const mouse = createMouseSource({ stdin, stdout })
  await settle()
  assert.equal(out.length, 0, 'opening the app does not touch the terminal')

  mouse.enable()
  mouse.enable()
  await settle()
  assert.equal(out.length, 1, 'enabling twice writes the sequence once')
  assert.match(out[0], /1006h/, 'and asks for SGR reports')

  // Two things can want the mouse at once — a float, and the `mouse: always`
  // setting — so the first one to let go must not turn it off under the other.
  mouse.disable()
  await settle()
  assert.equal(out.length, 1, 'one holder letting go leaves it on for the other')

  mouse.disable()
  await settle()
  assert.match(out[1], /1006l/, 'the last one out puts the terminal back')
})

test('a stdin that is not a terminal never has reporting turned on', async () => {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const out = []
  stdout.on('data', (chunk) => out.push(String(chunk)))

  const mouse = createMouseSource({ stdin, stdout })
  assert.equal(mouse.supported, false)

  mouse.enable()
  await settle()
  assert.equal(out.length, 0, 'a pipe is not something you can click on')
})
