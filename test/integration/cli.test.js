// The command-line entry point, run as a real subprocess.
//
// Everything else in this suite drives the Client object directly, which is why
// a first-run bug lived here undetected: every subcommand refused to run on a
// profile that had never been used, telling you to open the UI first. The whole
// CLI was unusable until you had launched the app once. These tests exercise
// `openchat …` the way a person does.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BIN = path.join(root, 'bin/openchat.js')

/** A machine with no openchat state at all. */
async function freshHome (t) {
  const home = await mkdtemp(path.join(tmpdir(), 'openchat-cli-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  return home
}

async function openchat (home, args, { expectFailure = false } = {}) {
  try {
    const { stdout, stderr } = await run(process.execPath, [BIN, ...args], {
      env: { ...process.env, OPENCHAT_HOME: home, OPENCHAT_DIR: '' },
      timeout: 60000
    })
    if (expectFailure) assert.fail(`expected \`openchat ${args.join(' ')}\` to fail`)
    return { stdout, stderr, code: 0 }
  } catch (err) {
    if (!expectFailure) {
      assert.fail(`\`openchat ${args.join(' ')}\` failed: ${err.stderr || err.message}`)
    }
    return { stdout: err.stdout || '', stderr: err.stderr || '', code: err.code }
  }
}

test('--help lists the commands', async (t) => {
  const home = await freshHome(t)
  const { stdout } = await openchat(home, ['--help'])

  for (const command of ['room create', 'room join', 'dm', 'contacts', 'whoami', 'profiles', 'backup']) {
    assert.ok(stdout.includes(command), `--help should mention "${command}"`)
  }
})

test('a command works on a machine that has never run openchat', async (t) => {
  const home = await freshHome(t)

  // This is the case that was broken: the very first thing a person types
  // should not be refused because they have not opened the UI yet.
  const { stdout } = await openchat(home, ['room', 'create', 'design-team'])

  assert.match(stdout, /created #design-team/)
  assert.match(stdout, /openchat1:/, 'prints an invite')
  assert.match(stdout, /Set up profile "default"/, 'says it created an identity')
  assert.match(stdout, /openchat backup/, 'points at the recovery phrase')
})

test('the rest of the commands work off the same fresh profile', async (t) => {
  const home = await freshHome(t)
  await openchat(home, ['room', 'create', 'design-team'])

  const who = await openchat(home, ['whoami'])
  assert.match(who.stdout, /public key: [0-9a-f]{64}/, 'prints a usable key')

  const rooms = await openchat(home, ['rooms'])
  assert.match(rooms.stdout, /design-team/)

  const backup = await openchat(home, ['backup'])
  assert.equal(backup.stdout.trim().split('\n')[2].trim().split(/\s+/).length, 24, '24-word phrase')

  const contacts = await openchat(home, ['contacts'])
  assert.match(contacts.stdout, /no contacts yet/)

  const profiles = await openchat(home, ['profiles'])
  assert.match(profiles.stdout, /default/)
})

test('--profile keeps two accounts apart', async (t) => {
  const home = await freshHome(t)

  await openchat(home, ['--profile', 'work', 'room', 'create', 'standup'])
  await openchat(home, ['--profile', 'personal', 'whoami'])

  const work = await openchat(home, ['--profile', 'work', 'whoami'])
  const personal = await openchat(home, ['--profile', 'personal', 'whoami'])

  const keyOf = (out) => out.match(/public key: ([0-9a-f]{64})/)[1]
  assert.notEqual(keyOf(work.stdout), keyOf(personal.stdout), 'separate identities')

  // A room in one profile is not visible from the other.
  const workRooms = await openchat(home, ['--profile', 'work', 'rooms'])
  const personalRooms = await openchat(home, ['--profile', 'personal', 'rooms'])
  assert.match(workRooms.stdout, /standup/)
  assert.match(personalRooms.stdout, /no rooms yet/)

  const listed = await openchat(home, ['profiles'])
  assert.match(listed.stdout, /work/)
  assert.match(listed.stdout, /personal/)
})

test('contacts can be saved and listed', async (t) => {
  const home = await freshHome(t)
  const key = 'ab'.repeat(32)

  const added = await openchat(home, ['contacts', 'add', key, 'grace'])
  assert.match(added.stdout, /saved grace/)

  const listed = await openchat(home, ['contacts'])
  assert.match(listed.stdout, /grace/)
  assert.match(listed.stdout, new RegExp(key.slice(0, 16)))
})

test('failures exit non-zero and say what went wrong', async (t) => {
  const home = await freshHome(t)

  const unknown = await openchat(home, ['bogus'], { expectFailure: true })
  assert.equal(unknown.code, 1)
  assert.match(unknown.stderr, /unknown command/)

  const badInvite = await openchat(home, ['room', 'join', 'not-an-invite'], { expectFailure: true })
  assert.equal(badInvite.code, 1)
  assert.match(badInvite.stderr, /openchat1:/, 'explains the expected format')

  const noArgs = await openchat(home, ['room', 'create'], { expectFailure: true })
  assert.equal(noArgs.code, 1)
  assert.match(noArgs.stderr, /usage/)
})
