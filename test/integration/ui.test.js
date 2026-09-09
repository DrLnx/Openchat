// The Ink UI, rendered against a real client on a local testnet — no mocked
// data. The plan was explicit about this: if the UI only ever sees fixtures,
// the bugs that matter (a message that arrives but never paints, a member list
// that does not update) survive all the way to a user's terminal.
//
// The app paints the whole terminal, so `screen()` below is the whole terminal:
// title bar, conversation list, chat, prompt, statusline, in that order.

import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { render } from 'ink-testing-library'

import { App } from '../../src/ui/ink/App.jsx'
import { Client } from '../../src/core/client.js'
import { createTestDht, TEST_HOST, waitFor, pressUntil, runCommand, sleep } from '../helpers.js'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

async function startClient (bootstrap) {
  const dir = await mkdtemp(path.join(tmpdir(), 'openchat-ui-'))
  const client = new Client({ dir, bootstrap, host: TEST_HOST })
  await client.ready()
  return client
}

/**
 * Type a line and press enter. The newline has to be a separate write with a
 * tick in between: a chunk arriving in one write is a paste, not a line
 * followed by a keypress, so "text\r" in a single write never submits.
 */
async function type (app, line) {
  app.stdin.write(line)
  await sleep(60)
  app.stdin.write('\r')
  await sleep(60)
}

const ESC = String.fromCharCode(27)

/** Run a command through the command line, the way a user does. */
async function command (app, line) {
  return runCommand(app, line, screen)
}

/** Close whatever floating window is open. */
async function escape (app) {
  app.stdin.write(String.fromCharCode(27))
  await sleep(80)
}

/** The last rendered frame, with ANSI styling stripped. */
function screen (app) {
  // eslint-disable-next-line no-control-regex
  return (app.lastFrame() || '').replace(/\u001B\[[0-9;]*m/g, '')
}

test('the UI renders a live room and paints messages as they arrive', async (t) => {
  const testnet = await createTestDht()
  const alice = await startClient(testnet.bootstrap)
  const bob = await startClient(testnet.bootstrap)

  t.after(async () => {
    await alice.close()
    await bob.close()
    await testnet.destroy()
  })

  const room = await alice.createRoom('design')
  const app = render(React.createElement(App, { client: alice }))
  t.after(() => app.unmount())

  await waitFor(async () => screen(app).includes('#design'), { message: 'the room to appear' })

  const initial = screen(app)
  assert.match(initial, /#design/, 'the title bar and the status line name the room')
  assert.match(initial, /ROOMS/, 'the conversation list is on screen')
  assert.match(initial, /member/, 'the title bar says how many people are in it')
  assert.match(initial, /esc normal/, 'the statusline says how to get out of insert mode')

  // The app paints a frame the height of the terminal, so the prompt and the
  // statusline are always the last two things on it — that is the property the
  // whole layout hangs off, and the one a stray row would break.
  const lines = initial.split('\n')
  assert.match(lines[lines.length - 1], /INSERT/, 'the statusline is the last row')
  assert.match(lines[lines.length - 2], /╰/, 'with the prompt directly above it')

  // Bob joins for real, over the swarm, and says something.
  await bob.joinRoom(room.invite)
  await bob.sendText('is this thing on?')

  await waitFor(async () => screen(app).includes('is this thing on?'), {
    message: "bob's message to paint in alice's UI"
  })

  const withMessage = screen(app)
  assert.match(withMessage, /\d\d:\d\d/, 'messages are timestamped')
  assert.match(withMessage, /is this thing on\?/, 'the message itself is painted')
})

test('the message box sends messages; the command line runs commands', async (t) => {
  const testnet = await createTestDht()
  const alice = await startClient(testnet.bootstrap)

  t.after(async () => {
    await alice.close()
    await testnet.destroy()
  })

  await alice.createRoom('solo')
  const app = render(React.createElement(App, { client: alice }))
  t.after(() => app.unmount())

  await waitFor(async () => screen(app).includes('#solo'), { message: 'the UI to start' })

  await type(app, 'hello world')
  await waitFor(async () => screen(app).includes('hello world'), { message: 'the sent message' })
  // A caret and your name in the margin, then the rule down the left of the
  // block, then what you said.
  assert.match(screen(app), /› you\s+│ hello world/, 'your own message echoes behind a caret')

  // A line that starts with a slash is a line, not a command. Commands have
  // somewhere of their own to be typed, so the message box never has to guess.
  await type(app, '/invite')
  await waitFor(async () => screen(app).includes('/invite'), { message: 'the slash to be sent' })
  assert.ok(!screen(app).includes('openchat1:'), 'and it did not run anything')

  // An invite is a secret and a thing you paste somewhere else, so it opens in
  // a window rather than scrolling past in the conversation.
  await command(app, 'invite')
  await waitFor(async () => screen(app).includes('openchat1:'), { message: 'the invite window' })
  assert.match(screen(app), /share it out of band/i, 'the warning is shown with the invite')
  assert.match(screen(app), /c copy/, 'and it can be taken away rather than read off the screen')

  await escape(app)
  await waitFor(async () => !screen(app).includes('openchat1:'), {
    message: 'the invite to leave the screen with the window'
  })

  await command(app, 'nick ada')
  await waitFor(async () => screen(app).includes('you are now ada'), { message: 'the nick change' })

  await command(app, 'nope')
  await waitFor(async () => screen(app).includes('unknown command'), { message: 'the error notice' })
  assert.match(screen(app), /✗ unknown command/, 'errors are marked')
})

test('the app can do the things that used to need a shell command', async (t) => {
  const testnet = await createTestDht()
  const alice = await startClient(testnet.bootstrap)

  t.after(async () => {
    await alice.close()
    await testnet.destroy()
  })

  await alice.restore()
  const app = render(React.createElement(App, { client: alice, profile: 'work' }))
  t.after(() => app.unmount())

  await waitFor(async () => screen(app).includes('end-to-end encrypted'), { message: 'the app to start' })

  // A room is created in here, not from a shell command.
  await command(app, 'new design-team')
  await waitFor(async () => screen(app).includes('#design-team'), { message: 'the new room' })
  assert.match(screen(app), /yours/, 'says the room is yours')

  await command(app, 'invite')
  await waitFor(async () => screen(app).includes('openchat1:'), { message: 'the invite' })
  await escape(app)

  // The recovery phrase has to be reachable without leaving the app, since
  // there is no longer a shell command that shows it. Asking for it is asking
  // to see it, so it arrives already revealed.
  await command(app, 'backup')
  await waitFor(async () => screen(app).includes('Recovery phrase'), { message: 'the phrase' })
  const words = alice.identity.mnemonic.split(' ')
  assert.ok(screen(app).includes(words[0]), 'the real phrase is shown')
  assert.match(screen(app), /post as you/, 'warns what it is worth')
  await escape(app)

  // The same window, opened at the other end: your key, whole and unwrapped,
  // which is the only form of it worth having.
  await command(app, 'whoami')
  await waitFor(async () => screen(app).includes(alice.identity.publicKeyHex), {
    message: 'your key'
  })
  assert.ok(
    screen(app).split('\n').some((line) => line.includes(alice.identity.publicKeyHex)),
    'on one line, so it can be copied out of the terminal as well as with c'
  )
  await escape(app)

  // A list opens a window rather than being written anywhere: nothing openchat
  // says for itself goes into the transcript, so anything bigger than a line
  // has to go somewhere you can read and scroll it.
  await command(app, 'profiles')
  await waitFor(async () => screen(app).includes('each one is its own keypair'), {
    message: 'the accounts window'
  })
  assert.match(screen(app), /work/, 'with the account you are in listed')
})

test('opening a menu moves nothing on the screen', async (t) => {
  const testnet = await createTestDht()
  const alice = await startClient(testnet.bootstrap)

  t.after(async () => {
    await alice.close()
    await testnet.destroy()
  })

  await alice.createRoom('busy')
  const app = render(React.createElement(App, { client: alice }))
  t.after(() => app.unmount())

  await waitFor(async () => screen(app).includes('#busy'), { message: 'the UI to start' })

  // Enough to fill the pane, so there is something to move.
  const said = []
  for (let i = 0; i < 8; i++) {
    said.push(`line number ${i} of the conversation`)
    await alice.sendText(said[i])
  }
  await waitFor(async () => screen(app).includes(said[7]), { message: 'the transcript' })

  // This is the property the whole layout hangs off. Both windows are laid
  // *over* the frame rather than wedged into it: they were once painted across
  // the middle of the transcript, and then given rows of their own with the
  // conversation redrawn shorter to make room — which covered nothing and still
  // shunted everything you were reading upward every time you reached for a
  // key. Nothing you open may move what is already on screen.
  const before = screen(app).split('\n')

  // Something only that window ever puts on screen — "keys" and "command" both
  // appear in the statusline and the prompt's own hint text.
  for (const [keys, opened] of [[[ESC, ' '], 'switch conversation'], [[':'], 'join a room from an invite']]) {
    for (const key of keys) {
      app.stdin.write(key)
      await sleep(150)
    }
    await waitFor(async () => screen(app).includes(opened), { message: `the ${opened} window` })

    const after = screen(app).split('\n')
    assert.equal(after.length, before.length, `${opened} did not change the height of anything`)

    // Every row above the window is untouched, to the character.
    const covered = after.findIndex((line, i) => line !== before[i])
    assert.ok(covered > 0, `${opened} left the top of the screen alone`)
    for (let i = 0; i < covered; i++) {
      assert.equal(after[i], before[i], `row ${i} is where it was under ${opened}`)
    }

    // And the prompt and the statusline are exactly where they always are. The
    // statusline says a different mode, which is the point of it; the row it is
    // on, and the prompt's own closing border above it, do not move.
    assert.match(after[after.length - 1], /NORMAL|INSERT|COMMAND/, 'the statusline is still last')
    assert.equal(after[after.length - 2], before[before.length - 2], 'with the prompt above it')

    app.stdin.write(ESC)
    await waitFor(async () => !screen(app).includes(opened), { message: `${opened} to close` })
  }
})

test('the key menu stands in the corner without taking the conversation with it', async (t) => {
  const testnet = await createTestDht()
  const alice = await startClient(testnet.bootstrap)

  t.after(async () => {
    await alice.close()
    await testnet.destroy()
  })

  await alice.createRoom('busy')
  const app = render(React.createElement(App, { client: alice }))
  t.after(() => app.unmount())

  await waitFor(async () => screen(app).includes('#busy'), { message: 'the UI to start' })

  const said = []
  for (let i = 0; i < 8; i++) {
    said.push(`line ${i} said`)
    await alice.sendText(said[i])
  }
  await waitFor(async () => screen(app).includes(said[7]), { message: 'the transcript' })

  const before = screen(app).split('\n')
  const spoken = (lines) => lines.filter((line) => /line \d said/.test(line)).length

  app.stdin.write(ESC)
  await sleep(150)
  app.stdin.write(' ')
  await waitFor(async () => screen(app).includes('+find'), { message: 'the key menu' })

  const after = screen(app).split('\n')

  // The menu is in the corner the prompt is in: its closing border is the last
  // row of the body, and it starts in the right-hand half of the pane.
  const closing = after.findIndex((line) => line.includes('esc cancel'))
  assert.ok(closing > 0, 'the menu is open')
  assert.ok(
    after[closing + 1].includes('╭'),
    'and it stands directly on the prompt, which is the row under it'
  )
  assert.ok(
    after[closing].indexOf('╰') > after[closing].length / 2,
    'the frame is against the right of the screen'
  )

  // And the rows it covers are the newest messages, which is exactly why it
  // does not take them: it stands beside the conversation rather than on it.
  assert.equal(
    spoken(after),
    spoken(before),
    'every line of the conversation is still on screen with the menu open'
  )
  assert.match(
    after[closing],
    /line 7 said/,
    'including the newest one, which shares its row with the menu'
  )

  app.stdin.write(ESC)
  await waitFor(async () => !screen(app).includes('+find'), { message: 'the menu to close' })
})

test('the command line lists what matches and runs what you pick', async (t) => {
  const testnet = await createTestDht()
  const alice = await startClient(testnet.bootstrap)

  t.after(async () => {
    await alice.close()
    await testnet.destroy()
  })

  await alice.createRoom('menu')
  const app = render(React.createElement(App, { client: alice }))
  t.after(() => app.unmount())

  await waitFor(async () => screen(app).includes('#menu'), { message: 'the UI to start' })

  await pressUntil(app, ESC, async () => screen(app).includes('NORMAL'), { message: 'normal mode' })

  // Everything, with its help, until you narrow it.
  app.stdin.write(':')
  await waitFor(async () => screen(app).includes('join a room from an invite string'), {
    message: 'the command line'
  })
  assert.match(screen(app), /show this room's invite/, 'every command is listed')
  assert.match(screen(app), /:dm <key\|name>/, 'with what each one takes')

  app.stdin.write('me')
  await waitFor(
    async () => {
      const frame = app.lastFrame() || ''
      return frame.includes('list the members of this room') && !frame.includes('join a room from an invite')
    },
    { message: 'the list to narrow to members' }
  )

  // Enter runs the highlighted command. Nothing is sent to the room.
  app.stdin.write('\r')
  await waitFor(async () => screen(app).includes('(you)'), { message: 'members to run' })
  assert.ok(!screen(app).includes('unknown command'), 'the partial command was never sent')
  assert.ok(!screen(app).includes('me\n'), 'and never reached the transcript')
})

test('a command can be looked up by what it does, not just what it is called', async (t) => {
  const testnet = await createTestDht()
  const alice = await startClient(testnet.bootstrap)

  t.after(async () => {
    await alice.close()
    await testnet.destroy()
  })

  await alice.createRoom('lookup')
  const app = render(React.createElement(App, { client: alice }))
  t.after(() => app.unmount())

  await waitFor(async () => screen(app).includes('#lookup'), { message: 'the UI to start' })
  await pressUntil(app, ESC, async () => screen(app).includes('NORMAL'), { message: 'normal mode' })

  app.stdin.write(':')
  await waitFor(async () => screen(app).includes('esc cancel'), { message: 'the command line' })

  // Nothing is called "palette", so the help text is searched instead.
  app.stdin.write('palette')
  await waitFor(async () => screen(app).includes('change the palette'), {
    message: 'the command that does that'
  })
  assert.match(screen(app), /:theme/, 'and it is named')

  // A prefix of a real name never falls back to prose: `inv` is the start of
  // `invite`, and half the help lines contain the word.
  app.stdin.write(String.fromCharCode(27))
  await waitFor(async () => !screen(app).includes('esc cancel'), { message: 'it to close' })
})

test('a sent file renders as an attachment, not as raw metadata', async (t) => {
  const testnet = await createTestDht()
  const alice = await startClient(testnet.bootstrap)

  t.after(async () => {
    await alice.close()
    await testnet.destroy()
  })

  await alice.createRoom('files')
  const app = render(React.createElement(App, { client: alice }))
  t.after(() => app.unmount())

  await waitFor(async () => screen(app).includes('#files'), { message: 'the UI to start' })

  const dir = await mkdtemp(path.join(tmpdir(), 'openchat-ui-file-'))
  const file = path.join(dir, 'agenda.md')
  await writeFile(file, '# agenda\n\n- ship it\n')

  await command(app, `file ${file}`)
  // Waiting for the name alone would be satisfied by the "sending agenda.md…"
  // notice, which is printed before the message it is about exists. What this
  // test is here for is the line the attachment itself renders as.
  await waitFor(async () => /agenda\.md \(\d+B\)/.test(screen(app)), {
    message: 'the attachment line'
  })

  const frame = screen(app)
  assert.match(frame, /agenda\.md \(\d+B\)/, 'the attachment shows its name and size')
  assert.match(frame, /⎿/, 'its state hangs under the message that announced it')
  assert.ok(!frame.includes('blobCoreKey'), 'raw metadata is not leaked into the transcript')
})

test('joining opens the room at once and waits to be admitted in the background', async (t) => {
  // The complaint this covers: `:join` used to block the prompt for up to
  // thirty seconds while it waited for a member to admit you, which looks
  // exactly like a join that has failed. Opening the room is local and
  // immediate; being admitted is not, and is not something the joiner can
  // hurry along, so it must not hold the interface hostage.
  const testnet = await createTestDht()
  const owner = await startClient(testnet.bootstrap)
  const joiner = await startClient(testnet.bootstrap)

  t.after(async () => {
    await owner.close().catch(() => {})
    await joiner.close()
    await testnet.destroy()
  })

  const room = await owner.createRoom('closed-shop')
  const invite = room.invite

  // Nobody is home, so admission cannot happen — which is the case that used
  // to hang.
  await owner.close()

  const app = render(React.createElement(App, { client: joiner, profile: 'work' }))
  t.after(() => app.unmount())

  await waitFor(async () => screen(app).includes('nothing open'), { message: 'the app to start' })

  const started = Date.now()
  await command(app, `join ${invite}`)

  await waitFor(async () => screen(app).includes('waiting to be admitted'), {
    message: 'the room to open and say what it is waiting for'
  })

  const elapsed = Date.now() - started
  assert.ok(elapsed < 10000, `the prompt came back in ${elapsed}ms rather than blocking`)

  const frame = screen(app)
  assert.match(frame, /#closed-shop/, 'the room is open and named in the title bar')
  assert.match(frame, /waiting for a member to admit you/, 'and says who it is waiting for')
})

test('the UI comes up with no rooms and says what to do', async (t) => {
  const testnet = await createTestDht()
  const alice = await startClient(testnet.bootstrap)

  t.after(async () => {
    await alice.close()
    await testnet.destroy()
  })

  await alice.restore()
  const app = render(React.createElement(App, { client: alice }))
  t.after(() => app.unmount())

  await sleep(200)
  const frame = screen(app)
  assert.match(frame, /end-to-end encrypted/, 'the empty pane still introduces itself')
  assert.match(frame, /nothing open/, 'the title bar says there is nothing open')
  assert.match(frame, /message someone/, 'tells you how to reach someone')
  assert.match(frame, /NOTHING YET/, 'and so does the empty conversation list')
  assert.match(frame, /␣ r n/, 'which says what to press rather than sitting there empty')

  // Your key is what people reach you on, so the pane says you have one and
  // where it lives — but it does not print it. A 64-character key on the
  // welcome screen is a key on the screen of everyone you ever show this app
  // to, and the one thing you do with it is paste it, which you cannot do with
  // something that has been wrapped across a pane.
  assert.ok(frame.includes(alice.identity.publicKeyHex.slice(0, 16)), 'enough of the key to recognise it')
  assert.ok(!frame.includes(alice.identity.publicKeyHex), 'but not the whole thing, unasked')
  assert.match(
    frame,
    /␣ k your keys, and the phrase behind them/,
    'and says which key opens the window that has it, in the card that holds it'
  )

  // The three things to do first, in the order they have to be done. An empty
  // app with nothing to type into it is the failure this pane exists to
  // prevent, so it says what to press rather than what openchat is.
  assert.match(frame, /make a room/, 'the first thing to do')
  assert.match(frame, /the invite is the room key/, 'what to do with it')
  assert.match(frame, /you both have to be online/, 'and the catch, said once, up front')
})

test('leaving a room tells the room, and takes it off this machine', async (t) => {
  const testnet = await createTestDht()
  const alice = await startClient(testnet.bootstrap)
  const bob = await startClient(testnet.bootstrap)

  t.after(async () => {
    await alice.close()
    await bob.close()
    await testnet.destroy()
  })

  await alice.setNick('alice')
  const room = await alice.createRoom('design')
  await bob.joinRoom(room.invite)
  await alice.sendText('something worth keeping')

  const app = render(React.createElement(App, { client: alice, profile: 'work' }))
  t.after(() => app.unmount())
  await waitFor(async () => screen(app).includes('#design'), { message: 'the room to open' })

  await command(app, 'leave')
  await waitFor(async () => screen(app).includes('left #design'), { message: 'the room to be left' })

  assert.equal(alice.conversations.size, 0, 'it is gone from her machine')
  assert.equal(
    alice.config.rooms.some((r) => r.key === room.keyHex),
    false,
    'and will not come back on the next run'
  )
  assert.match(screen(app), /nobody new can join/, 'and says what leaving a room you own costs')

  // Bob is still in it, and sees that she went.
  assert.ok(bob.conversations.has(room.keyHex), "bob's room is untouched")
  await waitFor(
    async () => bob.conversations.get(room.keyHex).room.messages.some((m) => m.type === 'system' && m.event === 'leave'),
    { message: 'bob to see her leave', timeout: 30000 }
  )

  // Leaving is not erasure: what she wrote is still his.
  assert.ok(
    bob.conversations.get(room.keyHex).room.messages.some((m) => m.body === 'something worth keeping'),
    'her messages stay in the room she left'
  )
})

test('deleting a conversation clears its history and its index here', async (t) => {
  const testnet = await createTestDht()
  const alice = await startClient(testnet.bootstrap)

  t.after(async () => {
    await alice.close()
    await testnet.destroy()
  })

  const room = await alice.createRoom('ops')
  await alice.sendText('a searchable sentence about deployments')
  await sleep(300)

  assert.ok(alice.index.count(room.keyHex) > 0, 'it was indexed')
  assert.ok(alice.search('deployments').length > 0, 'and findable')

  const app = render(React.createElement(App, { client: alice, profile: 'work' }))
  t.after(() => app.unmount())
  await waitFor(async () => screen(app).includes('#ops'), { message: 'the room to open' })

  await command(app, 'delete')
  await waitFor(async () => screen(app).includes('deleted #ops'), { message: 'the room to be deleted' })

  assert.equal(alice.conversations.size, 0)
  assert.equal(alice.index.count(room.keyHex), 0, 'the index forgot it too')
  assert.equal(alice.search('deployments').length, 0, 'so it is no longer findable')
  assert.match(screen(app), /everyone else still has their copy/, 'and is honest about what it cannot do')
})
