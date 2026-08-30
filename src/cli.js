// CLI entry. Subcommands do one thing and exit; bare `openchat` launches the UI.

import React from 'react'
import { render } from 'ink'

import { App } from './ui/ink/App.jsx'
import { createClient } from './core/client.js'
import { loadIdentity, restoreFromMnemonic, identityPath } from './core/identity.js'
import { configDir, readConfig } from './core/store.js'
import { decodeInvite } from './protocol/invite.js'
import { helpText } from './ui/model/commands.js'

const USAGE = `openchat — serverless, end-to-end encrypted group chat

  openchat                          launch the chat UI (resumes your rooms)
  openchat room create <name>       create a room and print its invite
  openchat room join <invite>       join a room from an invite string
  openchat rooms                    list rooms you have joined
  openchat whoami                   show your identity and public key
  openchat backup                   print the recovery phrase for your identity
  openchat restore <phrase…>        restore an identity from a recovery phrase
  openchat --help                   this message

In the UI:
${helpText().split('\n').map((l) => '  ' + l).join('\n')}
`

const args = process.argv.slice(2)

try {
  await main(args)
} catch (err) {
  console.error(`openchat: ${err.message}`)
  process.exit(1)
}

async function main (argv) {
  const [command, ...rest] = argv

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

    case 'whoami':
      return whoami()

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
  const client = await createClient()
  await client.restore()

  const { waitUntilExit } = render(React.createElement(App, { client }))

  const shutdown = async () => {
    await client.close().catch(() => {})
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)

  await waitUntilExit()
  await shutdown()
  process.exit(0)
}

async function roomCommand (argv) {
  const [action, ...rest] = argv

  if (action === 'create') {
    const name = rest.join(' ').trim()
    if (!name) throw new Error('usage: openchat room create <name>')

    const client = await createClient()
    const room = await client.createRoom(name)

    console.log(`created #${room.name}`)
    console.log(`\n${room.invite}\n`)
    console.log('Share that invite out of band — anyone who has it can read and post.')
    console.log('Run `openchat` to open the room. Someone already in the room must be')
    console.log('online for a new member to be admitted.')

    await client.close()
    return
  }

  if (action === 'join') {
    const invite = rest.join(' ').trim()
    if (!invite) throw new Error('usage: openchat room join <invite>')

    // Fail on a bad invite before doing any network work.
    const decoded = decodeInvite(invite)
    console.log(`joining #${decoded.name}…`)

    const client = await createClient()
    try {
      await client.joinRoom(invite)
      console.log(`joined #${decoded.name} — run \`openchat\` to start chatting`)
    } catch (err) {
      console.error(`could not join: ${err.message}`)
      console.error('A member of the room has to be online to admit you.')
      process.exitCode = 1
    }
    await client.close()
    return
  }

  throw new Error('usage: openchat room <create|join> …')
}

async function listRooms () {
  const config = await readConfig()
  if (config.rooms.length === 0) {
    console.log('no rooms yet — `openchat room create <name>` or `openchat room join <invite>`')
    return
  }
  for (const room of config.rooms) {
    console.log(`${room.key === config.lastRoom ? '▸' : ' '} ${room.name.padEnd(20)} ${room.key.slice(0, 16)}`)
  }
}

async function whoami () {
  const identity = await loadIdentity()
  console.log(`nick:       ${identity.nick}`)
  console.log(`public key: ${identity.publicKeyHex}`)
  console.log(`identity:   ${identityPath(configDir())}`)
}

async function backup () {
  const identity = await loadIdentity()
  console.log('Recovery phrase for your identity — anyone who has it can post as you:\n')
  console.log(`  ${identity.mnemonic}\n`)
  console.log('Store it somewhere safe and offline. Restore with `openchat restore <phrase>`.')
}

async function restore (phrase) {
  if (!phrase.trim()) throw new Error('usage: openchat restore <recovery phrase>')
  const identity = await restoreFromMnemonic(phrase)
  console.log(`restored identity ${identity.publicKeyHex}`)
}
