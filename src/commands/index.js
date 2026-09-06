// Tier 2 — executing the slash commands that `ui/model/commands.js` parses.
//
// Parsing is portable and shared with the browser; execution needs a real
// client, so it lives here. Everything reports back through `notice` rather
// than printing, so the same code path works under Ink and under a plain
// stdout runner.

import path from 'node:path'
import os from 'node:os'

import { helpText } from '../ui/model/commands.js'
import { shortKey, conversationLabel as label } from '../ui/model/format.js'
import { listProfiles, currentProfile } from '../core/store.js'

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

    case 'backup':
      // The only copy. There is no server that can reissue it, so this needs
      // to be reachable from inside the app rather than from a shell command.
      notice('Recovery phrase for this identity:')
      notice(client.identity.mnemonic)
      notice('Anyone who has these words can post as you. Write them down offline.', 'warn')
      return

    case 'profiles': {
      const [names, current] = await Promise.all([listProfiles(), currentProfile()])
      const listed = names.length ? names : [current]
      notice(listed
        .map((name) => `${name === client.profile ? '▸' : ' '} ${name}`)
        .join('\n'))
      notice('Open another one in a second terminal: openchat --profile <name>')
      return
    }

    case 'invite': {
      const room = client.activeRoom
      if (!room) return notice('DMs need no invite — /invite only applies to rooms', 'error')
      if (room.isClosed) notice('this room is closed, so the invite will not admit anyone', 'warn')
      notice(`invite for ${label('room', room.name)}:`)
      notice(room.invite)
      notice('anyone with this string can read and post — share it out of band.', 'warn')
      return
    }

    case 'join': {
      // Joining is two things that take very different amounts of time. Opening
      // the room is local and immediate. Being *admitted* to it needs a member
      // who is already inside to be online to verify your join block, and that
      // can take seconds or hours — it is not something the joiner can hurry
      // along. So only the first half happens at the prompt: the room opens,
      // you can read it and look around, and the admission lands whenever it
      // lands. Blocking the prompt on the second half is what made joining feel
      // like it had failed when it was simply waiting.
      const room = await client.joinRoom(command.arg, { wait: false })
      ctx.refresh?.()

      if (room.writable) {
        notice(`joined ${label('room', room.name)}`)
        return
      }

      notice(`opened ${label('room', room.name)} — waiting to be admitted.`)
      notice("this happens by itself once the room's owner is online. carry on in the meantime.")

      room.waitForWritable(0).then(() => {
        ctx.refresh?.()
        notice(`admitted to ${label('room', room.name)} — anything you send now reaches everyone in it.`)
      }).catch((err) => notice(err.message, 'error'))

      return
    }

    case 'new': {
      const room = await client.createRoom(command.arg)
      ctx.refresh?.()
      notice(`opened ${label('room', room.name)} — you own it. /invite to add people.`)
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
          const text = label(c.kind, c.name)
          const tags = [c.closed && 'closed', c.owned && 'yours'].filter(Boolean).join(', ')
          return `${marker} ${text.padEnd(22)}${tags ? `(${tags})` : ''}`
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

    case 'leave': {
      const target = client.active
      if (!target) return notice('nothing open to leave', 'error')

      const owned = target.kind === 'room' && target.room.isOwner
      const { kind, name, announced } = await client.removeConversation(client.activeId, {
        announce: true
      })
      ctx.refresh?.()

      notice(`left ${label(kind, name)}`)
      if (announced) notice('the room was told you are going.')
      if (kind === 'room') {
        notice('it carries on without you, and keeps what you wrote — nothing in a log can be unsaid.')
      }
      if (owned) {
        notice('you owned it. nobody can admit new members now — /transfer first if that matters.', 'warn')
      }
      return
    }

    case 'delete': {
      const target = client.active
      if (!target) return notice('nothing open to delete', 'error')

      const owned = target.kind === 'room' && target.room.isOwner
      const { kind, name } = await client.removeConversation(client.activeId)
      ctx.refresh?.()

      notice(`deleted ${label(kind, name)} from this machine`)
      notice('its messages, keys and search history are gone from here.')

      if (kind === 'room') {
        // Worth saying plainly rather than letting someone find out later.
        notice('everyone else still has their copy — there is no server to delete it from.', 'warn')
        if (owned) notice('you owned it. /close it first if you want it shut to newcomers.', 'warn')
      }
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
