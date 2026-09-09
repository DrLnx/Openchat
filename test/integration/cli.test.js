// The command-line entry point, run as a real subprocess.
//
// openchat is driven from inside the app, so what the shell surface has to get
// right is small and mostly about not stranding anyone: pick an account, list
// the accounts, say what version this is, and point someone who typed a
// subcommand at where that lives now.
//
// The account argument is the part with a real decision in it — `openchat work`
// and `openchat whoami` are the same shape and mean different things — so it is
// tested here through the binary and in test/integration/profiles.js through
// the function that decides.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BIN = path.join(root, 'bin/openchat.js')

/**
 * Run something against a given OPENCHAT_HOME, in this process.
 *
 * The subprocess is the thing under test everywhere else in this file, but
 * setting an account *up* through it would mean driving onboarding through a
 * pty. The core functions are the same ones the binary calls.
 */
async function withHome (home, fn) {
  const previousHome = process.env.OPENCHAT_HOME
  const previousDir = process.env.OPENCHAT_DIR
  process.env.OPENCHAT_HOME = home
  delete process.env.OPENCHAT_DIR
  try {
    return await fn()
  } finally {
    if (previousHome === undefined) delete process.env.OPENCHAT_HOME
    else process.env.OPENCHAT_HOME = previousHome
    if (previousDir !== undefined) process.env.OPENCHAT_DIR = previousDir
  }
}

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
      timeout: 30000
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

test('--help explains that the app is where things happen', async (t) => {
  const home = await freshHome(t)
  const { stdout } = await openchat(home, ['--help'])

  assert.match(stdout, /openchat <account>/, 'the way you pick an account is documented')
  assert.match(stdout, /--profile <name>/, 'so is the flag that predates it')
  assert.match(stdout, /--list/)
  assert.match(stdout, /Everything else happens inside the app/)

  // The in-app commands are the product surface, so --help has to list them.
  for (const command of [':dm', ':new', ':join', ':invite', ':backup', ':members']) {
    assert.ok(stdout.includes(command), `--help should list ${command}`)
  }
})

test('--version matches the package', async (t) => {
  const home = await freshHome(t)
  const { stdout } = await openchat(home, ['--version'])
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))

  assert.equal(stdout.trim(), version)
})

test('a subcommand points at where that lives now instead of just failing', async (t) => {
  const home = await freshHome(t)

  // These used to be subcommands. Someone with the old habit, or an old README
  // in a tab, should be told where the thing went — not just "unknown".
  //
  // `whoami` is the interesting one: a single bare word is how you name an
  // account now, so the only thing keeping this from silently creating an
  // account called "whoami" is that it is also the name of a command.
  for (const args of [['room', 'create', 'demo'], ['whoami'], ['dm', 'ab'.repeat(32)]]) {
    const { stderr, stdout, code } = await openchat(home, args, { expectFailure: true })
    assert.equal(code, 1, `\`openchat ${args.join(' ')}\` should exit non-zero`)
    assert.match(stderr, /driven from inside the app/)
    assert.match(stderr, new RegExp(`:${args[0]}`), 'names the command to try')
    assert.match(stdout, /openchat <account>/, 'and prints the usage')
  }
})

test('--list says which accounts are on this machine and how to open one', async (t) => {
  const home = await freshHome(t)

  // Nothing set up yet still has something to say: the account the next bare
  // `openchat` would open.
  const fresh = await openchat(home, ['--list'])
  assert.match(fresh.stdout, /accounts on this machine/)
  assert.match(fresh.stdout, /default/)
  assert.match(fresh.stdout, /not set up yet/, 'and that it has no keypair behind it')

  // An account is a row in the account database, not a directory somebody made.
  // That distinction is the whole point of the database: a directory with a key
  // dropped in it by hand — or by a command that failed halfway — used to be
  // indistinguishable from an account you had actually set up, which is how a
  // machine ends up listing three of them nobody meant to create.
  await withHome(home, async () => {
    const { createAccount } = await import('../../src/core/accounts.js')
    await createAccount({ profile: 'work', nick: 'ada' })
  })

  const { stdout } = await openchat(home, ['--list'])
  assert.match(stdout, /work/)
  assert.match(stdout, /ada/)
  assert.match(stdout, /openchat <account> opens one/, 'and says what to do with the list')
})

test('listing accounts does not open one', async (t) => {
  const home = await freshHome(t)
  await openchat(home, ['--list'])

  await assert.rejects(
    () => readFile(path.join(home, 'profiles', 'default', 'identity.json')),
    /ENOENT/,
    'reading the list must not generate a keypair'
  )
})

test('nothing is written to disk just by asking a question', async (t) => {
  const home = await freshHome(t)

  await openchat(home, ['--help'])
  await openchat(home, ['--version'])
  await openchat(home, ['--list'])

  // Generating a keypair is a side effect worth not having until someone
  // actually opens the app.
  await assert.rejects(
    () => readFile(path.join(home, 'profiles', 'default', 'identity.json')),
    /ENOENT/,
    'no identity should exist yet'
  )

  // Nor is the account database, which reads as empty when it is not there.
  // Asking what accounts exist is not the same as making somewhere to put one,
  // and a database left behind by `--help` is a file somebody later has to
  // wonder about.
  for (const leftover of ['openchat.db', 'openchat.db-wal', 'openchat.db-shm']) {
    await assert.rejects(
      () => readFile(path.join(home, leftover)),
      /ENOENT/,
      `${leftover} should not exist yet`
    )
  }
})

test('an unreadable profile name cannot escape the profiles directory', async (t) => {
  const home = await freshHome(t)

  // --profile is the only thing the shell surface takes that reaches the
  // filesystem, so it is the only place a traversal could start.
  const { code } = await openchat(home, ['--profile', '../../etc', '--version'])
  assert.equal(code, 0)

  await assert.rejects(
    () => readFile(path.join(home, '..', 'etc', 'identity.json')),
    'nothing may be created outside the openchat home'
  )
})
