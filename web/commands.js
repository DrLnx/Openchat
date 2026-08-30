// Executing slash commands in the browser. The parser is shared with the CLI
// (src/ui/model/commands.js); only the effects differ, and they differ only
// where the browser genuinely cannot do what a terminal does.

import { helpText } from '../src/ui/model/commands.js'
import { shortKey } from '../src/ui/model/format.js'

export async function runWebCommand (command, ctx) {
  const { client, notice } = ctx

  switch (command.name) {
    case 'help':
      notice(helpText())
      return

    case 'invite':
      notice(`invite for #${client.activeRoom.name}:`)
      notice(client.invite)
      notice('anyone with this string can read and post — share it out of band.', 'warn')
      return

    case 'join': {
      await client.joinRoom(command.arg)
      ctx.refresh()
      notice(`joined #${client.activeRoom.name}`)
      return
    }

    case 'nick': {
      await client.setNick(command.arg)
      notice(`you are now ${command.arg}`)
      return
    }

    case 'file':
      // There is no filesystem to read a path from, so the path argument is
      // meaningless here — open the picker instead of failing.
      ctx.pickFile()
      notice('choose a file to send…')
      return

    case 'download': {
      const result = await client.download(command.arg)
      notice(result ? 'already downloaded' : 'fetching…')
      return
    }

    case 'rooms':
      notice(client.roomList
        .map((r) => `▸ ${r.name}  ${shortKey(r.key, 12)}`)
        .join('\n'))
      return

    case 'members': {
      const members = ctx.members()
      notice(members.length
        ? members.map((m) => `  ${m.nick || shortKey(m.publicKey)}  ${shortKey(m.publicKey, 16)}`).join('\n')
        : '  (just you)')
      return
    }

    case 'quit':
      notice('this is a browser tab — close it, or run the real CLI to /quit properly.', 'warn')
      return

    default:
      notice(`unknown command: /${command.name}`, 'error')
  }
}
