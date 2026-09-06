// Tier 1 — portable. Slash-command parsing.
//
// Parsing is separated from execution so both front ends share it: the Ink app
// and the browser harness parse identically, and the parser can be tested
// without a terminal, a network, or a room.

import { rank } from './fuzzy.js'

export const COMMANDS = [
  { name: 'dm', args: '<key|name>', help: 'message someone directly — no invite needed' },
  { name: 'join', args: '<invite>', help: 'join a room from an invite string' },
  { name: 'new', args: '<name>', help: 'open a new room you own' },
  { name: 'switch', args: '<name>', help: 'jump to another room or conversation' },
  { name: 'invite', args: '', help: 'print an invite for the current room' },
  { name: 'nick', args: '<name>', help: 'set your display name' },
  { name: 'file', args: '<path>', help: 'send a file' },
  { name: 'download', args: '<id>', help: 'fetch an attachment you skipped' },
  { name: 'rooms', args: '', help: 'list everything you have open' },
  { name: 'members', args: '', help: 'list the members of this room' },
  { name: 'contacts', args: '', help: 'list the people you have saved' },
  { name: 'add', args: '<key> [name]', help: 'save someone as a contact' },
  { name: 'whoami', args: '', help: 'show your public key, so others can reach you' },
  { name: 'backup', args: '', help: 'show your recovery phrase — the only way back to this identity' },
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
 * @param {string} input a raw line from the input bar
 * @returns {{ kind: 'text', body: string }
 *          | { kind: 'command', name: string, arg: string, args: string[] }
 *          | { kind: 'error', message: string }
 *          | { kind: 'empty' }}
 */
export function parseInput (input) {
  const line = input.trim()
  if (line === '') return { kind: 'empty' }
  if (!line.startsWith('/')) return { kind: 'text', body: input.trim() }

  // "//foo" escapes to a literal message starting with a slash.
  if (line.startsWith('//')) return { kind: 'text', body: line.slice(1) }

  const spaceAt = line.indexOf(' ')
  const name = (spaceAt === -1 ? line.slice(1) : line.slice(1, spaceAt)).toLowerCase()
  const rest = spaceAt === -1 ? '' : line.slice(spaceAt + 1).trim()

  const command = BY_NAME.get(name)
  if (!command) {
    return { kind: 'error', message: `unknown command: /${name} — try /help` }
  }

  if (command.args && rest === '') {
    return { kind: 'error', message: `/${name} needs an argument: /${name} ${command.args}` }
  }

  return {
    kind: 'command',
    name,
    arg: rest,
    args: RAW_ARG.has(name) || rest === '' ? (rest === '' ? [] : [rest]) : rest.split(/\s+/)
  }
}

/**
 * Commands matching what has been typed so far, for the completion menu.
 * Returns the command objects, so the menu can show each one's help text.
 *
 * Matching is fuzzy over the *name* — `/dl` finds `/download` — and
 * deliberately not over the help text. Enter completes whatever the menu has
 * highlighted, so a menu that matched prose would turn `/nope` into some
 * command whose description happens to contain those letters, instead of the
 * error it should be. Searching what a command *does* is the command palette's
 * job, where nothing is completed on your behalf.
 *
 * Once there is a space the command name is settled and you are typing an
 * argument, so the menu gets out of the way.
 */
export function matchCommands (partial) {
  if (!partial.startsWith('/') || partial.includes(' ')) return []
  const query = partial.slice(1)
  if (query === '') return COMMANDS

  // An exact prefix always wins its own list: typing `/n` must offer `/new`
  // before it offers anything that merely contains an n.
  const prefix = COMMANDS.filter((c) => c.name.startsWith(query.toLowerCase()))
  const fuzzy = rank(COMMANDS, query, { key: (c) => c.name })
    .map((match) => match.item)
    .filter((c) => !prefix.includes(c))

  return [...prefix, ...fuzzy]
}

/** Where the query matched a command's name, for highlighting the menu. */
export function matchPositions (partial, name) {
  const query = partial.replace(/^\//, '')
  if (!query) return []
  const match = rank([name], query)[0]
  return match ? match.positions : []
}

/** Names matching a partial input, for tab completion. */
export function completions (partial) {
  return matchCommands(partial).map((c) => `/${c.name}`)
}

export function helpText () {
  const width = Math.max(...COMMANDS.map((c) => c.name.length + c.args.length + 2))
  return COMMANDS.map((c) => {
    const usage = `/${c.name}${c.args ? ' ' + c.args : ''}`
    return `${usage.padEnd(width + 1)} ${c.help}`
  }).join('\n')
}
