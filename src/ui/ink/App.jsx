// The root Ink app. Wired to the real client from the first render — no mock
// data anywhere, so a networking bug shows up here as a UI bug, which is the
// only way you find them before shipping.

import React, { useEffect, useReducer, useCallback, useState } from 'react'
import { Box, Text, useApp, useStdout } from 'ink'

import { StatusBar } from './StatusBar.jsx'
import { ChatPane } from './ChatPane.jsx'
import { Sidebar } from './Sidebar.jsx'
import { InputBar } from './InputBar.jsx'
import { initialState, reduce, transcript, memberList } from '../model/state.js'
import { parseInput } from '../model/commands.js'
import { runCommand } from '../../commands/index.js'

export function App ({ client }) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [state, dispatch] = useReducer(reduce, initialState({
    publicKey: client.identity.publicKeyHex,
    nick: client.identity.nick
  }))
  const [busy, setBusy] = useState(false)

  const notice = useCallback((text, level = 'info') => {
    dispatch({ type: 'notice', text, level })
  }, [])

  // Pull whatever the client already knows into the view. Called on mount and
  // after any command that changes which room is active.
  const refresh = useCallback(() => {
    const room = client.activeRoom
    dispatch({
      type: 'room',
      room: room ? { key: room.keyHex, name: room.name } : null,
      messages: room ? room.messages : []
    })
    dispatch({ type: 'rooms', rooms: client.roomList.map((r) => ({ ...r, unread: 0 })) })
    if (room) dispatch({ type: 'known-members', publicKeys: room.members })
    dispatch({
      type: 'connection',
      connection: {
        state: client.swarm.peerCount > 0 ? 'online' : 'connecting',
        peers: client.swarm.peerCount
      }
    })
  }, [client])

  useEffect(() => {
    refresh()

    const onMessages = ({ roomKey, messages }) => dispatch({ type: 'messages', roomKey, messages })
    const onConnection = (connection) => dispatch({ type: 'connection', connection })
    const onAttachment = ({ id, ...attachment }) => dispatch({ type: 'attachment', id, attachment })
    const onNotice = ({ text, level }) => notice(text, level)
    const onMember = ({ author }) => dispatch({
      type: 'known-members',
      publicKeys: [author]
    })

    client.on('messages', onMessages)
    client.on('connection', onConnection)
    client.on('attachment', onAttachment)
    client.on('notice', onNotice)
    client.on('member', onMember)

    return () => {
      client.off('messages', onMessages)
      client.off('connection', onConnection)
      client.off('attachment', onAttachment)
      client.off('notice', onNotice)
      client.off('member', onMember)
    }
  }, [client, refresh, notice])

  const submit = useCallback(async (line) => {
    const parsed = parseInput(line)
    if (parsed.kind === 'empty') return
    if (parsed.kind === 'error') return notice(parsed.message, 'error')

    setBusy(true)
    try {
      if (parsed.kind === 'text') {
        await client.sendText(parsed.body)
      } else {
        await runCommand(parsed, {
          client,
          notice,
          refresh,
          quit: () => exit()
        })
      }
    } catch (err) {
      notice(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }, [client, notice, refresh, exit])

  const rows = (stdout?.rows || 24) - 8
  const entries = transcript(state)

  return (
    <Box flexDirection="column">
      <StatusBar
        room={state.room}
        connection={state.connection}
        self={state.self}
        writable={client.activeRoom?.writable ?? false}
      />

      <Box>
        <ChatPane
          entries={entries}
          members={state.members}
          attachments={state.attachments}
          self={state.self}
          rows={rows}
        />
        <Sidebar
          rooms={state.rooms}
          activeKey={state.room?.key}
          members={memberList(state)}
          self={state.self}
        />
      </Box>

      <InputBar
        onSubmit={submit}
        disabled={busy}
        placeholder={state.room ? 'message, or /help' : '/join <invite> to get started'}
      />

      <Box paddingX={1}>
        <Text dimColor>ctrl+c to quit · tab completes commands</Text>
      </Box>
    </Box>
  )
}
