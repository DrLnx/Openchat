// The root Ink app. Wired to the real client from the first render — no mock
// data anywhere, so a networking bug shows up here as a UI bug, which is the
// only way you find them before shipping.
//
// The layout follows Claude Code rather than a classic full-screen TUI: the
// transcript is written into the terminal's own scrollback via <Static> and
// never repainted, and only the prompt at the bottom is live. That means your
// scrollback, selection and copy/paste all keep working, and a long room does
// not cost a full repaint on every keystroke.

import React, { useEffect, useReducer, useCallback, useState, useMemo } from 'react'
import { Box, Static } from 'ink'

import { Banner } from './Banner.jsx'
import { MessageLine } from './MessageLine.jsx'
import { StatusLine } from './StatusLine.jsx'
import { InputBar } from './InputBar.jsx'
import { initialState, reduce, transcript } from '../model/state.js'
import { parseInput } from '../model/commands.js'
import { runCommand } from '../../commands/index.js'

export function App ({ client }) {
  const [state, dispatch] = useReducer(reduce, initialState({
    publicKey: client.identity.publicKeyHex,
    nick: client.identity.nick
  }))
  const [busy, setBusy] = useState(false)
  const [exiting, setExiting] = useState(false)
  // <Static> writes an item exactly once, so the banner must wait for the first
  // refresh — printed on the very first render it would permanently claim you
  // are in no room, whatever room you are actually in.
  const [loaded, setLoaded] = useState(false)

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
    setLoaded(true)

    const onMessages = ({ roomKey, messages }) => dispatch({ type: 'messages', roomKey, messages })
    const onConnection = (connection) => dispatch({ type: 'connection', connection })
    const onAttachment = ({ id, ...attachment }) => dispatch({ type: 'attachment', id, attachment })
    const onNotice = ({ text, level }) => notice(text, level)
    const onMember = ({ author }) => dispatch({ type: 'known-members', publicKeys: [author] })

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
          // Let the transcript settle before tearing the render down, so the
          // goodbye is not swallowed mid-frame.
          quit: () => setExiting(true)
        })
      }
    } catch (err) {
      notice(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }, [client, notice, refresh])

  useEffect(() => {
    if (!exiting) return
    const timer = setTimeout(() => process.exit(0), 50)
    return () => clearTimeout(timer)
  }, [exiting])

  const entries = transcript(state)

  // <Static> never re-renders what it has already written, so an entry may only
  // go in once it can no longer change. An attachment mid-download still can,
  // and so can anything after it — holding the tail back keeps the log in order
  // rather than letting later messages overtake a slow transfer.
  const { settled, live } = useMemo(() => {
    const unsettled = entries.findIndex((entry) => (
      entry.kind === 'message' &&
      entry.message.type === 'file' &&
      state.attachments[entry.message.id]?.status === 'downloading'
    ))
    const cut = unsettled === -1 ? entries.length : unsettled
    return { settled: entries.slice(0, cut), live: entries.slice(cut) }
  }, [entries, state.attachments])

  const renderLine = useCallback((entry) => (
    <MessageLine
      key={entry.key}
      entry={entry}
      members={state.members}
      attachments={state.attachments}
      self={state.self}
    />
  ), [state.members, state.attachments, state.self])

  return (
    <Box flexDirection="column">
      <Static items={loaded ? [{ key: '__banner__' }, ...settled] : []}>
        {(entry) => entry.key === '__banner__'
          ? <Banner key="__banner__" room={state.room} self={state.self} />
          : renderLine(entry)}
      </Static>

      {live.length > 0 && (
        <Box flexDirection="column">{live.map(renderLine)}</Box>
      )}

      <InputBar
        onSubmit={submit}
        disabled={busy || exiting}
        placeholder={state.room ? 'message, or / for commands' : '/join <invite> to get started'}
      />

      <StatusLine
        room={state.room}
        connection={state.connection}
        self={state.self}
        writable={client.activeRoom?.writable ?? false}
      />
    </Box>
  )
}
