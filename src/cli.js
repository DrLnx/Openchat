// CLI entry.
//
// There is one command: `openchat`. Everything you do — opening a room,
// inviting people, messaging someone directly, managing contacts, closing or
// handing over a room — happens inside the app, as a slash command.
//
// That is a deliberate choice rather than an omission. A chat client is
// something you sit inside, not something you drive one shell invocation at a
// time, and a second surface would be a second place for behaviour to drift
// out of step. `--profile` is the one flag, because which account you are is a
// property of the session you are starting, not something you do once inside it.

import React from 'react'
import { render } from 'ink'

import { Root } from './ui/ink/Root.jsx'
import { MouseContext, createMouseSource } from './ui/ink/mouse.js'
import { enterFullscreen } from './ui/ink/fullscreen.js'
import { hasIdentity } from './core/identity.js'
import { profileDir, currentProfile, sanitizeProfile } from './core/store.js'
import { helpText } from './ui/model/commands.js'
import { runShutdown } from './core/shutdown.js'

/* global __OPENCHAT_VERSION__ */
// Replaced at build time by scripts/build.js. Running from source without a
// build (the tests do) falls back rather than throwing on the missing global.
const VERSION = typeof __OPENCHAT_VERSION__ === 'string' ? __OPENCHAT_VERSION__ : '0.0.0-dev'

const USAGE = `openchat ${VERSION} — serverless, end-to-end encrypted chat for your terminal

  openchat                     open the app
  openchat --profile <name>    open it as a different account on this machine
  openchat --help              this message
  openchat --version           print the version

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
you; /backup shows it again, and nothing else can reissue it.
`

try {
  await main(process.argv.slice(2))
} catch (err) {
  console.error(`openchat: ${err.message}`)
  if (process.env.OPENCHAT_DEBUG) console.error(err)
  process.exit(1)
}

async function main (argv) {
  const { profile, unknown } = parse(argv)

  if (unknown.length) {
    // Someone typing `openchat room create foo` deserves to be told where that
    // lives now, not just that it is wrong.
    console.error(`openchat: unexpected argument "${unknown[0]}"\n`)
    console.error('openchat is driven from inside the app — open it and use a slash command.')
    console.error(`For "${unknown[0]}", try /${unknown[0]} once the app is open, or /help to see them all.\n`)
    console.log(USAGE)
    process.exit(1)
  }

  if (profile.help) {
    console.log(USAGE)
    return
  }

  if (profile.version) {
    console.log(VERSION)
    return
  }

  return launch(profile.name || (await currentProfile()))
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
  const result = { name: null, help: false, version: false }
  const unknown = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]

    if (arg === '--help' || arg === '-h') result.help = true
    else if (arg === '--version' || arg === '-v') result.version = true
    else if (arg === '--profile' || arg === '-p') result.name = sanitizeProfile(argv[++i])
    else if (arg.startsWith('--profile=')) result.name = sanitizeProfile(arg.slice('--profile='.length))
    else unknown.push(arg)
  }

  return { profile: result, unknown }
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
