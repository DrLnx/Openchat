// Tier 1 — portable. Command parsing.
//
// Commands are typed into a command line of their own, opened with `:` the way
// vim's is, rather than by prefixing a message with a slash. That is not a
// cosmetic change: with a slash prefix, the message box has two jobs and every
// line you type has to be inspected to find out which one it is doing. A stray
// leading slash sent a command instead of a message, and a message that
// genuinely started with a slash needed an escape hatch to send at all.
//
// So the message box only ever sends messages now, and `:` opens somewhere to
// type a command. Parsing is separated from execution so it can be tested
// without a terminal, a network, or a room.

import { rank } from './fuzzy.js'

export const COMMANDS = [
  { name: 'dm', args: '<key|name>', help: 'message someone directly — no invite needed' },
  { name: 'join', args: '<invite>', help: 'join a room from an invite string' },
  { name: 'new', args: '<name>', help: 'open a new room you own' },
  { name: 'switch', args: '<name>', help: 'jump to another room or conversation' },
  { name: 'invite', args: '', help: 'show this room\'s invite, in a window you can copy from' },
  { name: 'nick', args: '<name>', help: 'set your display name' },
  { name: 'file', args: '<path>', help: 'send a file' },
  { name: 'download', args: '<id>', help: 'fetch an attachment you skipped' },
  { name: 'rooms', args: '', help: 'find something you have open' },
  { name: 'members', args: '', help: 'list the members of this room' },
  { name: 'contacts', args: '', help: 'list the people you have saved' },
  { name: 'add', args: '<key> [name]', help: 'save someone as a contact' },
  { name: 'whoami', args: '', help: 'your keys, in a window — the one people reach you on' },
  { name: 'backup', args: '', help: 'your recovery phrase — the only way back to this identity' },
  { name: 'profiles', args: '', help: 'list the accounts on this machine' },
  { name: 'accounts', args: '', help: 'switch account, or make another one' },
  { name: 'settings', args: '', help: 'open settings' },
  { name: 'theme', args: '<name>', help: 'change the palette' },
  { name: 'keys', args: '', help: 'show the keymap' },
  { name: 'find', args: '', help: 'fuzzy-find a room or conversation' },
  { name: 'leave', args: '', help: 'leave this conversation — the room carries on without you' },
  { name: 'delete', args: '', help: 'remove this conversation from this machine, history and all' },
  { name: 'close', args: '', help: 'close this room to new members (owner only)' },
  { name: 'reopen', args: '', help: 'let people join again (owner only)' },
  { name: 'transfer', args: '<key|name>', help: 'hand the room to someone else (owner only)' },
  { name: 'remove', args: '<key|name>', help: 'remove a member and keep them out (owner only)' },
  { name: 'allow', args: '<key|name>', help: 'let a removed member back in (owner only)' },
  { name: 'help', args: '', help: 'show this list' },
  { name: 'quit', args: '', help: 'close openchat' }
]

const BY_NAME = new Map(COMMANDS.map((c) => [c.name, c]))

// Commands that take everything after the name as one argument — a path or an
// invite must not be split on spaces.
const RAW_ARG = new Set(['join', 'file', 'nick', 'download', 'dm', 'switch', 'new', 'transfer', 'remove', 'allow'])

/**
 * A line from the message box. It is a message, whatever is in it.
 *
 * @param {string} input
 * @returns {{ kind: 'text', body: string } | { kind: 'empty' }}
 */
export function parseInput (input) {
  const line = input.trim()
  if (line === '') return { kind: 'empty' }
  return { kind: 'text', body: line }
}

/**
 * A line from the command line: a name, then whatever it takes.
 *
 * A leading `:` is tolerated because that is what is on screen while you type
 * one, and somebody who types it twice out of habit means the same thing.
 *
 * @param {string} input
 * @returns {{ kind: 'command', name: string, arg: string, args: string[] }
 *          | { kind: 'error', message: string }
 *          | { kind: 'empty' }}
 */
export function parseCommand (input) {
  const line = String(input ?? '').trim().replace(/^:+/, '').trim()
  if (line === '') return { kind: 'empty' }

  const spaceAt = line.indexOf(' ')
  const name = (spaceAt === -1 ? line : line.slice(0, spaceAt)).toLowerCase()
  const rest = spaceAt === -1 ? '' : line.slice(spaceAt + 1).trim()

  const command = BY_NAME.get(name)
  if (!command) {
    return { kind: 'error', message: `unknown command: ${name} — :help lists them all` }
  }

  if (command.args && rest === '') {
    return { kind: 'error', message: `${name} needs an argument: :${name} ${command.args}` }
  }

  return {
    kind: 'command',
    name,
    arg: rest,
    args: RAW_ARG.has(name) || rest === '' ? (rest === '' ? [] : [rest]) : rest.split(/\s+/)
  }
}

/**
 * Commands matching what has been typed into the command line so far.
 *
 * Matching is fuzzy over the *name* — `dl` finds `download` — with an exact
 * prefix first of all: typing `n` must offer `new` before anything that merely
 * contains an n.
 *
 * What a command *does* is searched only when nothing is called what you typed.
 * It is a fallback, not a second ranking: `inv` is the start of `invite`, and
 * the words "invite" and "no invite needed" appear in half the help lines, so
 * mixing the two would put `dm` and `join` under `:inv` for no reason anybody
 * could see. Type something that is not a command name and you get to search
 * by meaning instead.
 *
 * Once there is a space the name is settled and you are typing an argument, so
 * the list shows just that command and gets out of the way.
 */
export function matchCommands (partial) {
  const query = String(partial ?? '').replace(/^:+/, '')
  if (query === '') return COMMANDS

  const spaceAt = query.indexOf(' ')
  if (spaceAt !== -1) {
    const named = BY_NAME.get(query.slice(0, spaceAt).toLowerCase())
    return named ? [named] : []
  }

  const lower = query.toLowerCase()
  const prefix = COMMANDS.filter((c) => c.name.startsWith(lower))
  const fuzzy = rank(COMMANDS, query, { key: (c) => c.name })
    .map((match) => match.item)
    .filter((c) => !prefix.includes(c))

  const byName = [...prefix, ...fuzzy]
  if (byName.length > 0) return byName

  return COMMANDS.filter((c) => c.help.toLowerCase().includes(lower))
}

/** Where the query matched a command's name, for highlighting the menu. */
export function matchPositions (partial, name) {
  const query = String(partial ?? '').replace(/^:+/, '')
  if (!query) return []
  const match = rank([name], query)[0]
  return match ? match.positions : []
}

/** Names matching a partial input, for tab completion. */
export function completions (partial) {
  return matchCommands(partial).map((c) => `:${c.name}`)
}

/** How a command reads on screen: `:dm <key|name>`. */
export function usageOf (command) {
  return `:${command.name}${command.args ? ' ' + command.args : ''}`
}

export function helpText () {
  const width = Math.max(...COMMANDS.map((c) => c.name.length + c.args.length + 2))
  return COMMANDS.map((c) => `${usageOf(c).padEnd(width + 1)} ${c.help}`).join('\n')
}
