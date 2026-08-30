// Tier 2 — executing the slash commands that `ui/model/commands.js` parses.
//
// Parsing is portable and shared with the browser; execution needs a real
// client, so it lives here. Everything reports back through `notice` rather
// than printing, so the same code path works under Ink and under a plain
// stdout runner.

import path from 'node:path'
import os from 'node:os'

import { helpText } from '../ui/model/commands.js'
import { shortKey } from '../ui/model/format.js'

/**
 * @param {{ name: string, arg: string, args: string[] }} command
 * @param {object} ctx
 * @param {import('../core/client.js').Client} ctx.client
 * @param {(text: string, level?: string) => void} ctx.notice
 * @param {() => void} ctx.quit
 * @param {() => void} [ctx.refresh]  re-read room state into the UI
 */
export async function runCommand (command, ctx) {
  const { client, notice } = ctx

  switch (command.name) {
    case 'help':
      notice(helpText())
      return

    case 'invite': {
      const room = client.activeRoom
      if (!room) return notice('no room open — create one first', 'error')
      notice(`invite for #${room.name}:`)
      notice(room.invite)
      notice('anyone with this string can read and post — share it out of band.', 'warn')
      return
    }

    case 'join': {
      notice('joining…')
      const room = await client.joinRoom(command.arg)
      ctx.refresh?.()
      notice(`joined #${room.name}`)
      return
    }

    case 'nick': {
      const name = await client.setNick(command.arg)
      notice(`you are now ${name}`)
      return
    }

    case 'file': {
      const resolved = resolvePath(command.arg)
      notice(`sending ${path.basename(resolved)}…`)
      const message = await client.sendFile(resolved)
      notice(`sent ${message.name}`)
      return
    }

    case 'download': {
      const result = await client.download(command.arg)
      notice(result.verified
        ? `saved to ${result.path}`
        : `saved to ${result.path} — but the checksum did not match what was sent`,
      result.verified ? 'info' : 'error')
      return
    }

    case 'rooms': {
      const rooms = client.roomList
      if (rooms.length === 0) return notice('you have not joined any rooms yet')
      notice(rooms
        .map((r) => `${r.key === client.activeKey ? '▸' : ' '} ${r.name || shortKey(r.key)}  ${shortKey(r.key, 12)}`)
        .join('\n'))
      return
    }

    case 'members': {
      const room = client.activeRoom
      if (!room) return notice('no room open', 'error')
      const members = room.members
      notice(members.length
        ? members.map((m) => `  ${shortKey(m, 16)}${m === client.identity.publicKeyHex ? ' (you)' : ''}`).join('\n')
        : '  (just you)')
      return
    }

    case 'quit':
      ctx.quit()
      return

    default:
      notice(`unknown command: /${command.name}`, 'error')
  }
}

function resolvePath (input) {
  const expanded = input.startsWith('~')
    ? path.join(os.homedir(), input.slice(1))
    : input
  return path.resolve(expanded)
}
