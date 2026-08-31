// The command-line entry point, run as a real subprocess.
//
// There is one command. openchat is driven from inside the app, so what the
// shell surface has to get right is small and mostly about not stranding
// anyone: open the app, pick an account, say what version this is, and point
// someone who typed a subcommand at where that lives now.

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

  assert.match(stdout, /openchat\s+open the app/, 'the one command is documented')
  assert.match(stdout, /--profile <name>/, 'so is the one flag')
  assert.match(stdout, /Everything else happens inside the app/)

  // The in-app commands are the product surface, so --help has to list them.
  for (const command of ['/dm', '/new', '/join', '/invite', '/backup', '/members']) {
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
  for (const args of [['room', 'create', 'demo'], ['whoami'], ['dm', 'ab'.repeat(32)]]) {
    const { stderr, stdout, code } = await openchat(home, args, { expectFailure: true })
    assert.equal(code, 1, `\`openchat ${args.join(' ')}\` should exit non-zero`)
    assert.match(stderr, /driven from inside the app/)
    assert.match(stderr, new RegExp(`/${args[0]}`), 'names the slash command to try')
    assert.match(stdout, /open the app/, 'and prints the usage')
  }
})

test('nothing is written to disk just by asking for help', async (t) => {
  const home = await freshHome(t)

  await openchat(home, ['--help'])
  await openchat(home, ['--version'])

  // Generating a keypair is a side effect worth not having until someone
  // actually opens the app.
  await assert.rejects(
    () => readFile(path.join(home, 'profiles', 'default', 'identity.json')),
    /ENOENT/,
    'no identity should exist yet'
  )
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
