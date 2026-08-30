// Tier 1 — portable. Slash-command parsing.
//
// Parsing is separated from execution so both front ends share it: the Ink app
// and the browser harness parse identically, and the parser can be tested
// without a terminal, a network, or a room.

export const COMMANDS = [
  { name: 'join', args: '<invite>', help: 'join a room from an invite string' },
  { name: 'invite', args: '', help: 'print an invite for the current room' },
  { name: 'nick', args: '<name>', help: 'set your display name' },
  { name: 'file', args: '<path>', help: 'send a file to the room' },
  { name: 'download', args: '<id>', help: 'fetch an attachment you skipped' },
  { name: 'rooms', args: '', help: 'list the rooms you have joined' },
  { name: 'members', args: '', help: 'list the members of this room' },
  { name: 'help', args: '', help: 'show this list' },
  { name: 'quit', args: '', help: 'leave and exit' }
]

const BY_NAME = new Map(COMMANDS.map((c) => [c.name, c]))

// Commands that take everything after the name as one argument — a path or an
// invite must not be split on spaces.
const RAW_ARG = new Set(['join', 'file', 'nick', 'download'])

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
 * Once there is a space the command name is settled and the user is typing an
 * argument, so the menu gets out of the way.
 */
export function matchCommands (partial) {
  if (!partial.startsWith('/') || partial.includes(' ')) return []
  const prefix = partial.slice(1).toLowerCase()
  return COMMANDS.filter((c) => c.name.startsWith(prefix))
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
