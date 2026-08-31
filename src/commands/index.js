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
 * @param {() => void} [ctx.refresh]  re-read conversation state into the UI
 */
export async function runCommand (command, ctx) {
  const { client, notice } = ctx

  switch (command.name) {
    case 'help':
      notice(helpText())
      notice('There is a shell command for most of this too — `openchat --help`.')
      return

    case 'whoami':
      notice(`${client.identity.nick}\n${client.identity.publicKeyHex}`)
      notice('Anyone with that key can open a conversation with you.')
      return

    case 'invite': {
      const room = client.activeRoom
      if (!room) return notice('DMs need no invite — /invite only applies to rooms', 'error')
      if (room.isClosed) notice('this room is closed, so the invite will not admit anyone', 'warn')
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

    case 'new': {
      const room = await client.createRoom(command.arg)
      ctx.refresh?.()
      notice(`opened #${room.name} — you own it. /invite to add people.`)
      return
    }

    case 'dm': {
      const channel = await client.openDm(command.arg)
      ctx.refresh?.()
      notice(`talking to ${channel.name}`)
      notice('no invite was needed — this channel comes from your two keys.')
      return
    }

    case 'switch': {
      const target = findConversation(client, command.arg)
      if (!target) return notice(`nothing open called "${command.arg}"`, 'error')
      client.switchTo(target.id)
      ctx.refresh?.()
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
      await client.sendFile(resolved)
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
      const list = client.conversationList
      if (list.length === 0) return notice('nothing open yet — /new <name> or /dm <key>')
      notice(list
        .map((c) => {
          const marker = c.id === client.activeId ? '▸' : ' '
          const label = c.kind === 'room' ? `#${c.name}` : `@${c.name}`
          const tags = [c.closed && 'closed', c.owned && 'yours'].filter(Boolean).join(', ')
          return `${marker} ${label.padEnd(22)}${tags ? `(${tags})` : ''}`
        })
        .join('\n'))
      return
    }

    case 'members': {
      const room = client.activeRoom
      if (!room) return notice('this is a direct conversation — just the two of you', 'warn')

      const members = room.members
      notice(members.length
        ? members.map((m) => {
          const you = m === client.identity.publicKeyHex ? ' (you)' : ''
          const owner = m === room.owner ? ' · owner' : ''
          const named = client.contacts.find((c) => c.key === m)
          return `${shortKey(m, 16)}${named ? ` ${named.name}` : ''}${you}${owner}`
        }).join('\n')
        : '(just you)')
      return
    }

    case 'contacts': {
      const contacts = client.contacts
      if (contacts.length === 0) {
        return notice('no contacts yet — /add <key> <name>, or grab a key from /members')
      }
      notice(contacts.map((c) => `${(c.name || '—').padEnd(18)} ${shortKey(c.key, 16)}`).join('\n'))
      return
    }

    case 'add': {
      const [key, ...rest] = command.args.length > 1 ? command.args : command.arg.split(/\s+/)
      const contact = await client.addContact(key, rest.join(' ').trim() || null)
      notice(`saved ${contact.name || shortKey(contact.key, 16)} — /dm ${contact.name || shortKey(contact.key)}`)
      return
    }

    case 'close': {
      await client.controlRoom('close')
      ctx.refresh?.()
      notice('room closed — existing members can still talk, but nobody new can join')
      return
    }

    case 'reopen': {
      await client.controlRoom('reopen')
      ctx.refresh?.()
      notice('room reopened — the invite admits people again')
      return
    }

    case 'transfer': {
      const { subject } = await client.controlRoom('transfer', command.arg)
      ctx.refresh?.()
      notice(`${shortKey(subject, 16)} now owns this room`)
      return
    }

    case 'remove': {
      const { subject } = await client.controlRoom('remove', command.arg)
      ctx.refresh?.()
      notice(`removed ${shortKey(subject, 16)} — they cannot rejoin with the invite`)
      notice('/allow them if you change your mind.')
      return
    }

    case 'allow': {
      const { subject } = await client.controlRoom('allow', command.arg)
      ctx.refresh?.()
      notice(`${shortKey(subject, 16)} can join again`)
      return
    }

    case 'quit':
      ctx.quit()
      return

    default:
      notice(`unknown command: /${command.name}`, 'error')
  }
}

/** Match a conversation by name, @name, #name, or id prefix. */
function findConversation (client, query) {
  const wanted = String(query || '').trim().replace(/^[#@]/, '').toLowerCase()
  if (!wanted) return null

  const list = client.conversationList
  return (
    list.find((c) => c.name?.toLowerCase() === wanted) ||
    list.find((c) => c.name?.toLowerCase().startsWith(wanted)) ||
    list.find((c) => c.id.toLowerCase().includes(wanted)) ||
    null
  )
}

function resolvePath (input) {
  const expanded = input.startsWith('~')
    ? path.join(os.homedir(), input.slice(1))
    : input
  return path.resolve(expanded)
}
