// CLI entry. Subcommands do one thing and exit; bare `openchat` launches the UI.

import React from 'react'
import { render } from 'ink'

import { Root } from './ui/ink/Root.jsx'
import { Client } from './core/client.js'
import { loadIdentity, restoreFromMnemonic, identityPath, hasIdentity } from './core/identity.js'
import {
  profileDir, currentProfile, setCurrentProfile, listProfiles,
  readConfig, sanitizeProfile, DEFAULT_PROFILE
} from './core/store.js'
import { decodeInvite } from './protocol/invite.js'
import { helpText } from './ui/model/commands.js'

const USAGE = `openchat — serverless, end-to-end encrypted group chat

  openchat                          launch the chat UI (resumes your rooms)
  openchat room create <name>       create a room and print its invite
  openchat room join <invite>       join a room from an invite string
  openchat rooms                    list rooms you have joined
  openchat dm <key|contact>         open a direct conversation
  openchat contacts                 list saved contacts
  openchat contacts add <key> <name>  save someone under a name
  openchat whoami                   show your identity and public key
  openchat profiles                 list the accounts on this machine
  openchat login [name]             switch to a profile, creating it if needed
  openchat logout                   go back to the default profile
  openchat backup                   print the recovery phrase for your identity
  openchat restore <phrase…>        restore an identity from a recovery phrase
  openchat --help                   this message

Options:
  --profile <name>                  act as a different account for this command
                                    (or set OPENCHAT_PROFILE)

In the UI:
${helpText().split('\n').map((l) => '  ' + l).join('\n')}
`

const argv = process.argv.slice(2)
const { profile: profileFlag, args } = takeProfileFlag(argv)

try {
  await main(args)
} catch (err) {
  console.error(`openchat: ${err.message}`)
  process.exit(1)
}

/** `--profile x` / `--profile=x` can appear anywhere; strip it before parsing. */
function takeProfileFlag (input) {
  const rest = []
  let profile = null

  for (let i = 0; i < input.length; i++) {
    const arg = input[i]
    if (arg === '--profile' || arg === '-p') {
      profile = input[++i] ?? null
    } else if (arg.startsWith('--profile=')) {
      profile = arg.slice('--profile='.length)
    } else {
      rest.push(arg)
    }
  }

  return { profile: profile ? sanitizeProfile(profile) : null, args: rest }
}

async function activeProfile () {
  return profileFlag || (await currentProfile())
}

async function activeDir () {
  return profileDir(await activeProfile())
}

async function main (input) {
  const [command, ...rest] = input

  switch (command) {
    case undefined:
      return launchUI()

    case '--help':
    case '-h':
    case 'help':
      console.log(USAGE)
      return

    case 'room':
      return roomCommand(rest)

    case 'rooms':
      return listRooms()

    case 'dm':
      return dmCommand(rest.join(' ').trim())

    case 'contacts':
      return contactsCommand(rest)

    case 'whoami':
      return whoami()

    case 'profiles':
      return showProfiles()

    case 'login':
      return login(rest[0])

    case 'logout':
      return logout()

    case 'backup':
      return backup()

    case 'restore':
      return restore(rest.join(' '))

    default:
      console.error(`openchat: unknown command "${command}"\n`)
      console.log(USAGE)
      process.exit(1)
  }
}

async function launchUI () {
  const profile = await activeProfile()
  const dir = profileDir(profile)

  // The UI handles first-run setup itself, so an unconfigured profile is not an
  // error — Root shows onboarding and hands over to the app once it is done.
  const { waitUntilExit } = render(
    React.createElement(Root, { profile, dir, needsOnboarding: !(await hasIdentity(dir)) })
  )

  await waitUntilExit()
  process.exit(0)
}

/** Everything below runs one command against an already-configured profile. */
async function withClient (fn) {
  const profile = await activeProfile()
  const dir = profileDir(profile)

  if (!(await hasIdentity(dir))) {
    throw new Error(`profile "${profile}" has no identity yet — run \`openchat\` to set it up`)
  }

  const client = new Client({ dir, profile })
  await client.ready()
  try {
    return await fn(client)
  } finally {
    await client.close().catch(() => {})
  }
}

async function roomCommand (input) {
  const [action, ...rest] = input

  if (action === 'create') {
    const name = rest.join(' ').trim()
    if (!name) throw new Error('usage: openchat room create <name>')

    return withClient(async (client) => {
      const room = await client.createRoom(name)
      console.log(`created #${room.name}`)
      console.log(`\n${room.invite}\n`)
      console.log('Share that invite out of band — anyone who has it can read and post.')
      console.log('Run `openchat` to open the room. Someone already in the room must be')
      console.log('online for a new member to be admitted.')
    })
  }

  if (action === 'join') {
    const invite = rest.join(' ').trim()
    if (!invite) throw new Error('usage: openchat room join <invite>')

    // Fail on a bad invite before doing any network work.
    const decoded = decodeInvite(invite)
    console.log(`joining #${decoded.name}…`)

    return withClient(async (client) => {
      try {
        await client.joinRoom(invite)
        console.log(`joined #${decoded.name} — run \`openchat\` to start chatting`)
      } catch (err) {
        console.error(`could not join: ${err.message}`)
        console.error('A member of the room has to be online to admit you.')
        process.exitCode = 1
      }
    })
  }

  throw new Error('usage: openchat room <create|join> …')
}

async function listRooms () {
  const config = await readConfig(await activeDir())
  if (config.rooms.length === 0) {
    console.log('no rooms yet — `openchat room create <name>` or `openchat room join <invite>`')
    return
  }
  for (const room of config.rooms) {
    console.log(`${room.key === config.lastRoom ? '▸' : ' '} ${room.name.padEnd(20)} ${room.key.slice(0, 16)}`)
  }
}

async function dmCommand (peer) {
  if (!peer) throw new Error('usage: openchat dm <public key or contact name>')

  return withClient(async (client) => {
    const channel = await client.openDm(peer)
    console.log(`conversation with ${channel.name} is ready — run \`openchat\` to open it`)
    console.log('No invite was needed: the channel is derived from your two keys.')
  })
}

async function contactsCommand (input) {
  const [action, ...rest] = input
  const dir = await activeDir()

  if (!action || action === 'list') {
    const config = await readConfig(dir)
    if (config.contacts.length === 0) {
      console.log('no contacts yet — `openchat contacts add <key> <name>`')
      return
    }
    for (const contact of config.contacts) {
      console.log(`${(contact.name || '—').padEnd(20)} ${contact.key.slice(0, 16)}`)
    }
    return
  }

  if (action === 'add') {
    const [key, ...name] = rest
    if (!key) throw new Error('usage: openchat contacts add <public key> [name]')
    return withClient(async (client) => {
      const contact = await client.addContact(key, name.join(' ').trim() || null)
      console.log(`saved ${contact.name || contact.key.slice(0, 16)}`)
    })
  }

  if (action === 'remove') {
    const query = rest.join(' ').trim()
    return withClient(async (client) => {
      const key = await client.removeContact(query)
      console.log(`removed ${key.slice(0, 16)}`)
    })
  }

  throw new Error('usage: openchat contacts [list|add|remove] …')
}

async function whoami () {
  const profile = await activeProfile()
  const dir = profileDir(profile)

  if (!(await hasIdentity(dir))) {
    console.log(`profile:    ${profile} (not set up yet — run \`openchat\`)`)
    return
  }

  const identity = await loadIdentity({ dir })
  console.log(`profile:    ${profile}`)
  console.log(`nick:       ${identity.nick}`)
  console.log(`public key: ${identity.publicKeyHex}`)
  console.log(`identity:   ${identityPath(dir)}`)
  console.log('\nGive someone that public key and they can message you directly.')
}

async function showProfiles () {
  const profiles = await listProfiles()
  const current = await currentProfile()

  if (profiles.length === 0) {
    console.log(`no profiles yet — run \`openchat\` to set up "${DEFAULT_PROFILE}"`)
    return
  }

  for (const name of profiles) {
    const dir = profileDir(name)
    const identity = (await hasIdentity(dir)) ? await loadIdentity({ dir }) : null
    const marker = name === current ? '▸' : ' '
    const who = identity ? `${identity.nick} · ${identity.publicKeyHex.slice(0, 16)}` : 'not set up'
    console.log(`${marker} ${name.padEnd(16)} ${who}`)
  }

  console.log('\nUse a different one for a command with --profile <name>, or switch with `openchat login <name>`.')
}

async function login (name) {
  if (!name) {
    // No name given: show what is available rather than guessing.
    await showProfiles()
    console.log('\nusage: openchat login <name>')
    return
  }

  const profile = sanitizeProfile(name)
  await setCurrentProfile(profile)

  const dir = profileDir(profile)
  if (await hasIdentity(dir)) {
    const identity = await loadIdentity({ dir })
    console.log(`switched to "${profile}" (${identity.nick} · ${identity.publicKeyHex.slice(0, 16)})`)
  } else {
    console.log(`switched to "${profile}" — run \`openchat\` to set it up`)
  }
}

async function logout () {
  await setCurrentProfile(DEFAULT_PROFILE)
  console.log(`switched back to "${DEFAULT_PROFILE}" — nothing was deleted`)
}

async function backup () {
  const dir = await activeDir()
  if (!(await hasIdentity(dir))) throw new Error('this profile has no identity yet')

  const identity = await loadIdentity({ dir })
  console.log('Recovery phrase for your identity — anyone who has it can post as you:\n')
  console.log(`  ${identity.mnemonic}\n`)
  console.log('Store it somewhere safe and offline. Restore with `openchat restore <phrase>`.')
}

async function restore (phrase) {
  if (!phrase.trim()) throw new Error('usage: openchat restore <recovery phrase>')
  const identity = await restoreFromMnemonic(phrase, { dir: await activeDir() })
  console.log(`restored identity ${identity.publicKeyHex}`)
}
