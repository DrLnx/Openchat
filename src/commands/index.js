// Tier 2 — executing the commands that `ui/model/commands.js` parses.
//
// Parsing is portable; execution needs a real client, so it lives here.
// Everything reports back through `notice` rather than printing, so the same
// code path works under Ink and under a plain stdout runner.
//
// Under Ink a notice is one line above the prompt for a couple of seconds and
// then gone — nothing openchat says for itself goes into the transcript. So an
// answer here is one sentence, and anything bigger than a sentence is not
// written at all: it opens a window. A list of members, of accounts, of
// commands, or anything key-shaped is intercepted before it reaches this file
// and shown somewhere you can read it, scroll it and copy out of it.
//
// What is left below for those commands is the same answer as prose, for a
// runner that has no windows to open. See UI_COMMANDS in ui/ink/App.jsx.

import path from 'node:path'
import os from 'node:os'

import { helpText } from '../ui/model/commands.js'
import { shortKey, conversationLabel as label } from '../ui/model/format.js'
import { listProfiles, currentProfile } from '../core/store.js'

/**
 * @param {{ name: string, arg: string, args: string[] }} command
 * @param {object} ctx
 * @param {import('../core/client.js').Client} ctx.client
 * @param {(text: string, level?: string) => void} ctx.notice  one line, transient
 * @param {() => void} ctx.quit
 * @param {() => void} [ctx.refresh]  re-read conversation state into the UI
 */
export async function runCommand (command, ctx) {
  const { client, notice } = ctx

  switch (command.name) {
    case 'help':
      notice(helpText())
      return

    case 'whoami':
      notice(`${client.identity.nick} — ${client.identity.publicKeyHex}`)
      return

    case 'backup':
      // The only copy. There is no server that can reissue it, so this needs
      // to be reachable from inside the app rather than from a shell command.
      notice(client.identity.mnemonic, 'warn')
      return

    case 'profiles': {
      const [names, current] = await Promise.all([listProfiles(), currentProfile()])
      const listed = names.length ? names : [current]
      notice(listed.map((name) => (name === client.profile ? `▸ ${name}` : name)).join('  '))
      return
    }

    case 'invite': {
      const room = client.activeRoom
      if (!room) return notice('DMs need no invite — :invite only applies to rooms', 'error')
      if (room.isClosed) notice('this room is closed — the invite will admit nobody', 'warn')
      notice(room.invite, 'warn')
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

      notice(`opened ${label('room', room.name)} — waiting for a member to admit you`)

      room.waitForWritable(0).then(() => {
        ctx.refresh?.()
        notice(`admitted to ${label('room', room.name)} — you can post now`)
      }).catch((err) => notice(err.message, 'error'))

      return
    }

    case 'new': {
      const room = await client.createRoom(command.arg)
      ctx.refresh?.()
      notice(`opened ${label('room', room.name)} — yours. :invite to add people`)
      return
    }

    case 'dm': {
      const channel = await client.openDm(command.arg)
      ctx.refresh?.()
      notice(`talking to ${channel.name} — no invite needed, the channel is your two keys`)
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
      // The rename itself lands in the transcript as a message the room can
      // see, so this is only the acknowledgement of the keypress.
      const name = await client.setNick(command.arg)
      notice(`you are now ${name}`)
      return
    }

    case 'file': {
      // The attachment appears in the transcript with its own progress line the
      // moment it is announced, so this is only about the seconds before that.
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
      if (list.length === 0) return notice('nothing open yet — :new <name> or :dm <key>')
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
        return notice('no contacts yet — :add <key> <name>, or grab a key from :members')
      }
      notice(contacts.map((c) => `${(c.name || '—').padEnd(18)} ${shortKey(c.key, 16)}`).join('\n'))
      return
    }

    case 'add': {
      const [key, ...rest] = command.args.length > 1 ? command.args : command.arg.split(/\s+/)
      const contact = await client.addContact(key, rest.join(' ').trim() || null)
      notice(`saved ${contact.name || shortKey(contact.key, 16)} — :dm ${contact.name || shortKey(contact.key)}`)
      return
    }

    case 'leave': {
      const target = client.active
      if (!target) return notice('nothing open to leave', 'error')

      const owned = target.kind === 'room' && target.room.isOwner
      const { kind, name } = await client.removeConversation(client.activeId, { announce: true })
      ctx.refresh?.()

      // Owning it is the one thing worth interrupting for: nobody can be
      // admitted once you are gone, and it cannot be undone from here.
      if (owned) {
        return notice(`left ${label(kind, name)} — you owned it, so nobody new can join now`, 'warn')
      }
      notice(`left ${label(kind, name)} — it carries on without you, and keeps what you wrote`)
      return
    }

    case 'delete': {
      const target = client.active
      if (!target) return notice('nothing open to delete', 'error')

      const { kind, name } = await client.removeConversation(client.activeId)
      ctx.refresh?.()

      // Worth saying plainly rather than letting someone find out later: there
      // is no server to delete a room *from*, only this machine.
      if (kind === 'room') {
        return notice(`deleted ${label(kind, name)} here — everyone else still has their copy`, 'warn')
      }
      notice(`deleted ${label(kind, name)} — its messages, keys and search history are gone from here`)
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
      notice(`removed ${shortKey(subject, 16)} — they cannot rejoin. :allow undoes it`)
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
