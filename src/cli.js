// CLI entry.
//
// Everything you *do* — opening a room, inviting people, messaging someone
// directly, managing contacts, closing or handing over a room — happens inside
// the app, as a slash command. A chat client is something you sit inside, not
// something you drive one shell invocation at a time, and a second surface
// would be a second place for behaviour to drift out of step.
//
// Which account you are is the exception, and it has to be, because it is the
// one decision that is already made by the time the app is on screen. Two
// accounts on this machine share nothing — separate keys, separate rooms,
// separate storage — and an account can only be open in one process at a time,
// so "which one" is a property of the terminal you are starting, not something
// you do once you are inside it.
//
// So it is the first argument: `openchat work` logs into the account called
// work, and creates it if this machine has never seen it. `--profile` still
// does the same thing, for anyone with it in a script.

import React from 'react'
import { render } from 'ink'

import { Root } from './ui/ink/Root.jsx'
import { MouseContext, createMouseSource } from './ui/ink/mouse.js'
import { enterFullscreen } from './ui/ink/fullscreen.js'
import { hasIdentity } from './core/identity.js'
import { profileDir, currentProfile, sanitizeProfile } from './core/store.js'
import { listAccounts, resolveAccountArg } from './core/accounts.js'
import { helpText } from './ui/model/commands.js'
import { shortKey } from './ui/model/format.js'
import { runShutdown } from './core/shutdown.js'

/* global __OPENCHAT_VERSION__ */
// Replaced at build time by scripts/build.js. Running from source without a
// build (the tests do) falls back rather than throwing on the missing global.
const VERSION = typeof __OPENCHAT_VERSION__ === 'string' ? __OPENCHAT_VERSION__ : '0.0.0-dev'

const USAGE = `openchat ${VERSION} — serverless, end-to-end encrypted chat for your terminal

  openchat                     open the account you used last
  openchat <account>           open that account, and create it if it is new
  openchat --list              the accounts on this machine
  openchat --profile <name>    the same as \`openchat <account>\`
  openchat --help              this message
  openchat --version           print the version

An account is a keypair in a directory and nothing else — there is nobody to
register one with. Two of them share no rooms, no contacts and no settings, so
\`openchat work\` and \`openchat personal\` are two different people as far as
anyone else on the network is concerned.

Everything else happens inside the app:

${helpText().split('\n').map((l) => '  ' + l).join('\n')}

openchat takes over the terminal while it is open and gives it back untouched
on the way out. The interface is keyboard-first and modal, with LazyVim's
bindings: esc and i move between normal and insert mode, space is the leader
key and shows a menu of everything you can press from there, and ? shows the
whole keymap. Every window it opens has a slash command too, so none of that
is required.

On first run openchat generates a keypair for you — there is no account to
sign up for and no server to sign up to. Save the recovery phrase it shows
you; :backup shows it again, and nothing else can reissue it.
`

try {
  await main(process.argv.slice(2))
} catch (err) {
  console.error(`openchat: ${err.message}`)
  if (process.env.OPENCHAT_DEBUG) console.error(err)
  process.exit(1)
}

async function main (argv) {
  const { flags, positional } = parse(argv)

  if (flags.help) {
    console.log(USAGE)
    return
  }

  if (flags.version) {
    console.log(VERSION)
    return
  }

  if (flags.list) return list()

  const named = await resolveAccountArg(positional)
  if (named === null) return misuse(positional)

  return launch(flags.name || named || (await currentProfile()))
}

/** Somebody typed a subcommand. Say where that went, rather than "unknown". */
function misuse (positional) {
  const first = positional[0] ?? ''

  console.error(`openchat: "${positional.join(' ')}" is not an account or a flag\n`)
  console.error('openchat is driven from inside the app — open it and use a slash command.')
  console.error(`For "${first}", try :${first} once the app is open, or :help to see them all.\n`)
  console.log(USAGE)
  process.exit(1)
}

/** Every account on this machine, and how to open one. */
async function list () {
  const accounts = await listAccounts()
  const width = Math.max(...accounts.map((a) => a.profile.length), 7)

  console.log('accounts on this machine\n')
  for (const account of accounts) {
    const key = account.publicKey ? `${shortKey(account.publicKey, 16)}…` : 'not set up yet'
    const rooms = account.ready ? `${account.rooms} ${account.rooms === 1 ? 'room' : 'rooms'}` : ''
    console.log((
      `${account.current ? '▸' : ' '} ${account.profile.padEnd(width)}  ` +
      `${(account.nick || '—').padEnd(14)}  ${key.padEnd(18)}  ${rooms}`
    ).trimEnd())
  }
  console.log('\nopenchat <account> opens one. A name this machine has not seen is a new account.')
}

/**
 * Which DHT to talk to. The public one, unless you point it somewhere else.
 *
 * `OPENCHAT_BOOTSTRAP=host:port,...` points it at your own DHT instead — a
 * bootstrap node on a LAN, say, for a swarm that never touches the public one.
 * `OPENCHAT_HOST` binds the DHT to one address.
 *
 * Worth knowing before you reach for it: a bootstrap bound to loopback does not
 * work between two processes. Hyperswarm still tries to holepunch, and two
 * peers that both live at 127.0.0.1 never complete it — they connect and then
 * nothing crosses. Two accounts on one machine talk to each other fine on a
 * real DHT; it is only the all-loopback case that silently fails.
 */
function network () {
  const raw = process.env.OPENCHAT_BOOTSTRAP
  if (!raw) return { bootstrap: undefined, host: process.env.OPENCHAT_HOST }

  const bootstrap = raw.split(',').map((entry) => {
    const at = entry.lastIndexOf(':')
    if (at === -1) throw new Error(`OPENCHAT_BOOTSTRAP wants host:port, got "${entry}"`)
    const port = Number(entry.slice(at + 1))
    if (!Number.isInteger(port)) throw new Error(`OPENCHAT_BOOTSTRAP has no port in "${entry}"`)
    return { host: entry.slice(0, at).trim(), port }
  })

  return { bootstrap, host: process.env.OPENCHAT_HOST }
}

function parse (argv) {
  const flags = { name: null, help: false, version: false, list: false }
  const positional = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]

    if (arg === '--help' || arg === '-h') flags.help = true
    else if (arg === '--version' || arg === '-v') flags.version = true
    else if (arg === '--list' || arg === '-l') flags.list = true
    else if (arg === '--profile' || arg === '-p') flags.name = sanitizeProfile(argv[++i])
    else if (arg.startsWith('--profile=')) flags.name = sanitizeProfile(arg.slice('--profile='.length))
    else positional.push(arg)
  }

  return { flags, positional }
}

async function launch (profileName) {
  const profile = sanitizeProfile(profileName)
  const dir = profileDir(profile)
  const { bootstrap, host } = network()

  // Mouse reports arrive on stdin in band with the keys, so they are filtered
  // out of the stream before Ink is handed it — otherwise a click would type
  // an escape sequence into whatever you were writing. Reporting itself stays
  // off until a floating window turns it on; see ui/ink/mouse.js.
  const mouse = process.stdin.isTTY ? createMouseSource() : null

  // openchat is a screen rather than a stream of output: it takes the terminal
  // over while it runs and hands it back exactly as it found it.
  const leaveFullscreen = enterFullscreen()

  // A profile with no identity is not an error — Root shows the setup wizard
  // and hands over to the app once it is done.
  const { waitUntilExit } = render(
    React.createElement(
      MouseContext.Provider,
      { value: mouse },
      React.createElement(Root, {
        profile,
        dir,
        bootstrap,
        host,
        version: VERSION,
        needsOnboarding: !(await hasIdentity(dir))
      })
    ),
    mouse ? { stdin: mouse.stdin } : undefined
  )

  await waitUntilExit()
  mouse?.destroy()
  await runShutdown()
  leaveFullscreen()
  process.exit(0)
}
