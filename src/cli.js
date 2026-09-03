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

The interface is keyboard-first and modal, with LazyVim's bindings: esc and i
move between normal and insert mode, space is the leader key and shows a menu
of everything you can press from there, and ? shows the whole keymap. Every
window it opens has a slash command too, so none of that is required.

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

  // Mouse reports arrive on stdin in band with the keys, so they are filtered
  // out of the stream before Ink is handed it — otherwise a click would type
  // an escape sequence into whatever you were writing. Reporting itself stays
  // off until a floating window turns it on; see ui/ink/mouse.js.
  const mouse = process.stdin.isTTY ? createMouseSource() : null

  // A profile with no identity is not an error — Root shows the setup wizard
  // and hands over to the app once it is done.
  const { waitUntilExit } = render(
    React.createElement(
      MouseContext.Provider,
      { value: mouse },
      React.createElement(Root, {
        profile,
        dir,
        version: VERSION,
        needsOnboarding: !(await hasIdentity(dir))
      })
    ),
    mouse ? { stdin: mouse.stdin } : undefined
  )

  await waitUntilExit()
  mouse?.destroy()
  await runShutdown()
  process.exit(0)
}
