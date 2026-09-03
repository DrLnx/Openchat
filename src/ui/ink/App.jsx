// The root Ink app. Wired to the real client from the first render — no mock
// data anywhere, so a networking bug shows up here as a UI bug, which is the
// only way you find them before shipping.
//
// Two decisions shape everything below.
//
// The transcript is written into the terminal's own scrollback via <Static> and
// never repainted, the way Claude Code does it. Your scrollback, your selection
// and your copy-paste all keep working, and a busy room does not cost a full
// repaint per keystroke. Anything that needs to float — a picker, settings, the
// which-key menu — is drawn in the live region above the prompt instead of in
// an alternate screen, so it never takes the conversation away from you.
//
// Every keypress is routed here, once, by one handler. A modal interface has to
// decide what a key *means* before anything acts on it, and the only way to
// guarantee that is for nothing else to be listening.

import React, { useEffect, useReducer, useCallback, useState, useMemo, useRef, useContext } from 'react'
import { Box, Static, useInput, useWindowSize } from 'ink'

import { Banner } from './Banner.jsx'
import { MessageLine } from './MessageLine.jsx'
import { StatusLine } from './StatusLine.jsx'
import { InputBar } from './InputBar.jsx'
import { WhichKey } from './WhichKey.jsx'
import { Picker, Prompt } from './Picker.jsx'
import { SettingsPanel } from './SettingsPanel.jsx'
import { Accounts } from './Accounts.jsx'
import { HelpFloat, IdentityFloat } from './Panels.jsx'
import { createTheme } from './theme.js'
import { MouseContext } from './mouse.js'
import { initialState, reduce, transcript } from '../model/state.js'
import { parseInput, matchCommands, COMMANDS } from '../model/commands.js'
import { createBuffer, applyKey, setValue } from '../model/editor.js'
import { bindingsFor, chordFor, createResolver, describeChord, BINDINGS } from '../model/keymap.js'
import { read as readSettings, write as writeSetting, THEMES } from '../model/settings.js'
import { displayName, shortKey, formatTime } from '../model/format.js'
import { runCommand } from '../../commands/index.js'
import { writeConfig } from '../../core/store.js'
import { listAccounts } from '../../core/accounts.js'

/** Slash commands that open a floating window instead of running an action. */
const UI_COMMANDS = {
  settings: 'float:settings',
  accounts: 'float:accounts',
  keys: 'float:help',
  find: 'picker:conversations'
}

export function App ({ client, profile, version, onSwitchAccount, onCreateAccount }) {
  const [state, dispatch] = useReducer(reduce, initialState({
    publicKey: client.identity.publicKeyHex,
    nick: client.identity.nick
  }))

  const size = useWindowSize()
  // ink-testing-library renders to a stream with no size at all; a float with
  // a NaN height is worse than a float drawn for a conventional 80x24.
  const terminal = useMemo(() => ({
    rows: size.rows || 24,
    columns: size.columns || 80
  }), [size.rows, size.columns])
  const [settings, setSettings] = useState(() => readSettings(client.config))
  const theme = useMemo(() => createTheme(settings), [settings])

  const [mode, setMode] = useState(settings.startInNormalMode ? 'normal' : 'insert')
  const [buffer, setBuffer] = useState(createBuffer)
  const [menu, setMenu] = useState(0)
  const [overlay, setOverlay] = useState(null)
  const [pending, setPending] = useState([])
  const [whichKey, setWhichKey] = useState(false)
  const [accounts, setAccounts] = useState([])
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
    const target = client.activeTarget
    const room = client.activeRoom

    dispatch({
      type: 'room',
      room: target
        ? {
            key: client.activeId,
            name: target.name,
            kind: room ? 'room' : 'dm',
            closed: room ? room.isClosed : false,
            owned: room ? room.isOwner : false
          }
        : null,
      messages: target ? target.messages : []
    })
    dispatch({
      type: 'rooms',
      rooms: client.conversationList.map((c) => ({ key: c.id, ...c, unread: 0 }))
    })

    // In a DM the two participants are known without anyone speaking.
    if (room) dispatch({ type: 'known-members', publicKeys: room.members })
    else if (client.activeChannel) {
      dispatch({
        type: 'known-members',
        publicKeys: [client.activeChannel.peerKey, client.identity.publicKeyHex]
      })
    }

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

    const onMessages = ({ conversationId, messages }) => dispatch({
      type: 'messages',
      roomKey: conversationId,
      messages
    })
    const onConnection = (connection) => dispatch({ type: 'connection', connection })
    const onAttachment = ({ id, ...attachment }) => dispatch({ type: 'attachment', id, attachment })
    const onNotice = ({ text, level }) => notice(text, level)
    const onMember = ({ author }) => dispatch({ type: 'known-members', publicKeys: [author] })

    const onSwitched = () => refresh()

    client.on('messages', onMessages)
    client.on('switched', onSwitched)
    client.on('connection', onConnection)
    client.on('attachment', onAttachment)
    client.on('notice', onNotice)
    client.on('member', onMember)

    return () => {
      client.off('messages', onMessages)
      client.off('switched', onSwitched)
      client.off('connection', onConnection)
      client.off('attachment', onAttachment)
      client.off('notice', onNotice)
      client.off('member', onMember)
    }
  }, [client, refresh, notice])

  // --- settings -----------------------------------------------------------

  const changeSetting = useCallback((key, value) => {
    setSettings((current) => ({ ...current, [key]: value }))

    // Written through immediately, and onto the client's own config object so
    // anything reading it live — the auto-download limit, for one — sees the
    // new value without a restart.
    const next = writeSetting(client.config, key, value)
    client.config.settings = next.settings
    if (key === 'autoDownloadBytes') client.config.autoDownloadBytes = next.autoDownloadBytes
    writeConfig(client.config, client.dir).catch((err) => notice(err.message, 'error'))
  }, [client, notice])

  // --- sending ------------------------------------------------------------

  // Some commands open a window rather than doing something to a room, and a
  // window is not something `commands/index.js` can reach — it has no UI. They
  // are still real slash commands, so that everything reachable by a chord is
  // also reachable by typing, which is what makes the keymap optional rather
  // than mandatory.
  const performRef = useRef(null)

  const submit = useCallback(async (line) => {
    const parsed = parseInput(line)
    if (parsed.kind === 'empty') return
    if (parsed.kind === 'error') return notice(parsed.message, 'error')

    if (parsed.kind === 'command') {
      if (parsed.name === 'theme') {
        if (!THEMES.includes(parsed.arg)) {
          return notice(`themes: ${THEMES.join(', ')}`, 'error')
        }
        return changeSetting('theme', parsed.arg)
      }

      const opens = UI_COMMANDS[parsed.name]
      if (opens) return performRef.current?.(opens)
    }

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
  }, [client, notice, refresh, changeSetting])

  // --- pickers ------------------------------------------------------------

  const conversations = useMemo(() => client.conversationList.map((c) => {
    const unread = state.rooms.find((r) => r.key === c.id)?.unread || 0
    return {
      id: c.id,
      label: `${c.kind === 'dm' ? theme.icons.dm : theme.icons.room}${c.name}`,
      hint: [
        c.id === client.activeId ? 'here' : null,
        unread ? `${unread} unread` : null,
        c.closed ? 'closed' : null,
        c.owned ? 'yours' : null
      ].filter(Boolean).join(' · '),
      detail: c.id,
      color: c.id === client.activeId ? theme.accent : undefined,
      data: c
    }
  }), [client, state.rooms, theme])

  // Everyone you could plausibly want to talk to, from every direction they
  // could have reached you: saved contacts, people you already DM, and whoever
  // is in the room in front of you.
  const people = useMemo(() => {
    const seen = new Map()

    for (const contact of client.contacts) {
      seen.set(contact.key, { key: contact.key, name: contact.name, from: 'contact' })
    }
    for (const c of client.conversationList) {
      if (c.kind !== 'dm' || seen.has(c.peer)) continue
      seen.set(c.peer, { key: c.peer, name: c.name, from: 'open' })
    }
    for (const [key, member] of Object.entries(state.members)) {
      if (key === client.identity.publicKeyHex || seen.has(key)) continue
      seen.set(key, { key, name: member.nick || null, from: 'in this room' })
    }

    return [...seen.values()].map((person) => ({
      id: person.key,
      label: person.name || shortKey(person.key, 16),
      hint: `${shortKey(person.key, 12)}… · ${person.from}`,
      detail: person.key,
      icon: theme.icons.dm,
      data: person
    }))
  }, [client, state.members, theme])

  const members = useMemo(() => Object.entries(state.members).map(([key, member]) => ({
    id: key,
    label: displayName(member, key),
    hint: `${shortKey(key, 16)}…${key === client.identity.publicKeyHex ? ' · you' : ''}`,
    detail: key,
    data: { key }
  })), [state.members, client])

  const messages = useMemo(() => state.messages
    .filter((m) => m.type === 'text' || m.type === 'file')
    .slice(-500)
    .reverse()
    .map((m) => ({
      id: m.id,
      label: m.type === 'file' ? m.name : m.body,
      hint: `${displayName(state.members[m.author], m.author)} · ${formatTime(m.ts)}`,
      detail: m.author,
      data: m
    })), [state.messages, state.members])

  const commandItems = useMemo(() => COMMANDS.map((c) => ({
    id: c.name,
    label: `/${c.name}${c.args ? ' ' + c.args : ''}`,
    hint: c.help,
    data: c
  })), [])

  const keymapItems = useMemo(() => BINDINGS.map((b, i) => ({
    id: `${b.keys}:${i}`,
    label: describeChord(b.keys),
    hint: `${b.desc} · ${b.mode}`,
    detail: b.action,
    detailMatch: 'substring',
    data: b
  })), [])

  const accountItems = useMemo(() => accounts.map((a) => ({
    id: a.profile,
    label: a.profile,
    hint: [a.nick, a.publicKey ? `${shortKey(a.publicKey, 12)}…` : 'not set up', a.current ? 'in use' : null]
      .filter(Boolean).join(' · '),
    detail: a.publicKey || '',
    icon: theme.icons.account,
    color: a.current ? theme.green : undefined,
    data: a
  })), [accounts, theme])

  const loadAccounts = useCallback(async () => {
    try {
      setAccounts(await listAccounts())
    } catch (err) {
      notice(`could not read the accounts on this machine: ${err.message}`, 'error')
    }
  }, [notice])

  // --- actions ------------------------------------------------------------

  const close = useCallback(() => {
    setOverlay(null)
    setPending([])
  }, [])

  const openConversation = useCallback((id) => {
    try {
      client.switchTo(id)
      refresh()
    } catch (err) {
      notice(err.message, 'error')
    }
  }, [client, refresh, notice])

  const perform = useCallback((action) => {
    const [kind, name] = action.split(':')

    switch (kind) {
      case 'mode':
        if (name === 'command') {
          setBuffer((b) => setValue(b, '/'))
          setMode('insert')
        } else {
          setMode(name)
        }
        return

      case 'picker':
        if (name === 'accounts') loadAccounts()
        setOverlay({ kind: 'picker', name })
        return

      case 'float':
        if (name === 'accounts') loadAccounts()
        setOverlay({ kind: 'float', name })
        return

      case 'prompt':
        setOverlay({ kind: 'prompt', name })
        return

      case 'cmd':
        submit(`/${name}`)
        return

      case 'nav': {
        if (name === 'unread') {
          const target = state.rooms.find((r) => (r.unread || 0) > 0)
          if (!target) return notice('nothing unread')
          return openConversation(target.key)
        }
        const moved = client.cycle(name === 'prev' ? -1 : 1)
        if (moved) refresh()
        return
      }

      case 'toggle': {
        if (name === 'timestamps') {
          return changeSetting('timestamps', settings.timestamps === 'off' ? '24h' : 'off')
        }
        if (name === 'compact') return changeSetting('compact', !settings.compact)
        if (name === 'mouse') {
          const next = settings.mouse === 'off' ? 'floats' : settings.mouse === 'floats' ? 'always' : 'off'
          changeSetting('mouse', next)
          return notice(`mouse: ${next}`)
        }
      }
    }
  }, [client, state.rooms, settings, submit, refresh, notice, openConversation, changeSetting, loadAccounts])

  performRef.current = perform

  // --- key routing --------------------------------------------------------

  const resolvers = useMemo(() => ({
    normal: createResolver(bindingsFor('normal')),
    insert: createResolver(bindingsFor('insert'))
  }), [])

  const matches = useMemo(
    () => (overlay ? [] : matchCommands(buffer.value)),
    [overlay, buffer.value]
  )

  useEffect(() => {
    setMenu((current) => (current >= matches.length ? 0 : current))
  }, [matches.length])

  // The which-key popup waits a beat, so a chord you already know does not
  // flash a menu at you on the way past.
  useEffect(() => {
    if (pending.length === 0) {
      setWhichKey(false)
      return
    }
    const timer = setTimeout(() => setWhichKey(true), settings.whichKeyDelayMs)
    return () => clearTimeout(timer)
  }, [pending, settings.whichKeyDelayMs])

  const complete = (command) => {
    if (!command) return
    // A command that takes an argument leaves you mid-line to type it; one that
    // does not is what you asked for, so run it.
    if (command.args) {
      setBuffer((b) => setValue(b, `/${command.name} `))
      setMenu(0)
      return
    }
    setBuffer((b) => setValue(b, ''))
    setMenu(0)
    submit(`/${command.name}`)
  }

  useInput((input, key) => {
    if (exiting) return

    // The completion menu owns the keys that would otherwise move the cursor,
    // because a half-typed `/mem` sent as a chat message is never what anyone
    // meant.
    if (matches.length > 0) {
      if (key.upArrow) return setMenu((i) => (i - 1 + matches.length) % matches.length)
      if (key.downArrow) return setMenu((i) => (i + 1) % matches.length)
      if (key.tab || key.return) return complete(matches[menu])
      if (key.escape) {
        setBuffer((b) => setValue(b, ''))
        return
      }
    }

    const resolver = resolvers[mode] || resolvers.insert
    const result = resolver.feed(chordFor(input, key))

    if (result.type === 'action') {
      setPending([])
      perform(result.binding.action)
      return
    }
    if (result.type === 'pending') {
      setPending(result.keys)
      return
    }
    if (result.type === 'miss') {
      setPending([])
      return
    }

    if (mode !== 'insert') return

    const edit = applyKey(buffer, input, key)
    if (!edit) return
    setBuffer(edit.buffer)
    if (edit.submit !== undefined && edit.submit.trim()) submit(edit.submit)
  }, { isActive: !overlay && !exiting })

  useEffect(() => {
    if (!exiting) return
    const timer = setTimeout(() => process.exit(0), 50)
    return () => clearTimeout(timer)
  }, [exiting])

  // --- transcript ---------------------------------------------------------

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

  // <Static> tracks what it has already printed by *index* (`items.slice(n)`),
  // so its list has to be append-only. The transcript is sorted by time, and a
  // message can arrive with a timestamp that sorts before something already on
  // screen — which would shift every later index and reprint the wrong lines.
  // Keep a committed list that only ever grows at the end, and hand Static that.
  const committed = useRef([])
  const committedKeys = useRef(new Set())

  // Switching conversation cannot un-print what is already in the scrollback —
  // Static has no way to retract a line, and a terminal log should not pretend
  // otherwise. Mark the switch instead and carry on appending, the way moving
  // between directories leaves the previous output above you.
  const conversationId = state.room?.key ?? null
  const shownConversation = useRef(null)

  if (shownConversation.current !== conversationId && conversationId) {
    const previous = shownConversation.current
    shownConversation.current = conversationId
    if (previous) {
      committed.current.push({
        kind: 'divider',
        key: `divider:${previous}:${conversationId}:${committed.current.length}`,
        label: `${state.room.kind === 'dm' ? theme.icons.dm : theme.icons.room}${state.room.name}`
      })
    }
  }

  for (const entry of settled) {
    if (committedKeys.current.has(entry.key)) continue
    committedKeys.current.add(entry.key)
    committed.current.push(entry)
  }

  const renderLine = useCallback((entry) => (
    <MessageLine
      key={entry.key}
      entry={entry}
      theme={theme}
      settings={settings}
      members={state.members}
      attachments={state.attachments}
      self={state.self}
    />
  ), [theme, settings, state.members, state.attachments, state.self])

  const uiMode = overlay ? 'float' : mode

  // `off` means every float behaves as though the terminal had no mouse at all,
  // and `always` keeps reporting on so the statusline and the transcript are
  // clickable too — at the cost of your terminal's own selection and scroll.
  const mouseSource = useContext(MouseContext)
  const mouse = settings.mouse === 'off' ? null : mouseSource

  useEffect(() => {
    if (!mouse || settings.mouse !== 'always') return
    mouse.enable()
    return () => mouse.disable()
  }, [mouse, settings.mouse])

  return (
    <MouseContext.Provider value={mouse}>
      <Box flexDirection='column'>
        <Static items={loaded ? [{ key: '__banner__' }, ...committed.current] : []}>
          {(entry) => entry.key === '__banner__'
            ? (settings.banner
                ? (
                  <Banner
                    key='__banner__'
                    theme={theme}
                    room={state.room}
                    self={state.self}
                    profile={profile}
                    version={version}
                  />
                  )
                : <Box key='__banner__' />)
            : renderLine(entry)}
        </Static>

        {live.length > 0 && !overlay && (
          <Box flexDirection='column'>{live.map(renderLine)}</Box>
        )}

        {overlay && (
          <Overlay
            // Keyed by which float this is, so opening a second one starts it
            // empty. Without this React reuses the instance, and the username
            // you typed into one prompt is still sitting in the next.
            key={`${overlay.kind}:${overlay.name}`}
            overlay={overlay}
            theme={theme}
            terminal={terminal}
            state={state}
            client={client}
            profile={profile}
            settings={settings}
            accounts={accounts}
            accountItems={accountItems}
            items={{ conversations, people, members, messages, commands: commandItems, keymaps: keymapItems }}
            notice={notice}
            submit={submit}
            close={close}
            setBuffer={setBuffer}
            setMode={setMode}
            setOverlay={setOverlay}
            openConversation={openConversation}
            changeSetting={changeSetting}
            onSwitchAccount={onSwitchAccount}
            onCreateAccount={onCreateAccount}
          />
        )}

        {!overlay && whichKey && pending.length > 0 && (
          <WhichKey
            theme={theme}
            terminal={terminal}
            pending={pending}
            candidates={(resolvers[mode] || resolvers.insert).candidates(pending)}
          />
        )}

        <InputBar
          theme={theme}
          mode={uiMode}
          value={buffer.value}
          cursor={buffer.cursor}
          matches={matches}
          selected={menu}
          busy={busy || exiting}
          placeholder={placeholderFor(state.room, mode)}
        />

        <StatusLine
          theme={theme}
          mode={uiMode}
          room={state.room}
          rooms={state.rooms}
          profile={profile}
          connection={state.connection}
          self={state.self}
          mouse={settings.mouse === 'always'}
          writable={client.activeRoom ? client.activeRoom.writable : true}
        />
      </Box>
    </MouseContext.Provider>
  )
}

/** Whichever floating window is open. Split out to keep App's render readable. */
function Overlay ({
  overlay, theme, terminal, state, client, profile, settings, accounts, accountItems, items,
  notice, submit, close, setBuffer, setMode, setOverlay, openConversation, changeSetting,
  onSwitchAccount, onCreateAccount
}) {
  const shared = { theme, terminal, onCancel: close }

  if (overlay.kind === 'float') {
    if (overlay.name === 'settings') {
      return (
        <SettingsPanel
          {...shared}
          values={settings}
          profile={profile}
          onChange={changeSetting}
        />
      )
    }

    if (overlay.name === 'help') return <HelpFloat {...shared} />

    if (overlay.name === 'identity') {
      return (
        <IdentityFloat
          {...shared}
          profile={profile}
          identity={{
            nick: client.identity.nick,
            publicKey: client.identity.publicKeyHex,
            mnemonic: client.identity.mnemonic
          }}
        />
      )
    }

    if (overlay.name === 'accounts') {
      return (
        <Accounts
          {...shared}
          accounts={accounts}
          showKeys={settings.showKeys}
          onSwitch={(name) => {
            close()
            onSwitchAccount?.(name)
          }}
          onCreate={() => setOverlay({ kind: 'prompt', name: 'account' })}
          onRestore={() => setOverlay({ kind: 'prompt', name: 'account-restore' })}
        />
      )
    }
  }

  if (overlay.kind === 'prompt') return <Prompts {...{ overlay, theme, terminal, close, submit, setOverlay, onCreateAccount, notice }} />

  // --- pickers ------------------------------------------------------------

  const picker = (props) => <Picker {...shared} {...props} />

  switch (overlay.name) {
    case 'conversations':
      return picker({
        title: 'Conversations',
        icon: theme.icons.search,
        items: items.conversations,
        placeholder: 'rooms and direct messages',
        onSubmit: (item) => {
          close()
          openConversation(item.id)
        }
      })

    case 'rooms':
      return picker({
        title: 'Rooms',
        icon: theme.icons.room,
        items: items.conversations.filter((c) => c.data.kind === 'room'),
        onSubmit: (item) => {
          close()
          openConversation(item.id)
        }
      })

    case 'people':
      return picker({
        title: 'Message someone',
        icon: theme.icons.dm,
        items: items.people,
        placeholder: 'a name, or paste a public key',
        allowFreeText: true,
        footer: [
          { keys: '↑↓', label: 'move' },
          { keys: '⏎', label: 'open a DM' },
          { keys: 'esc', label: 'close' }
        ],
        onSubmit: (item) => {
          close()
          submit(`/dm ${item.data.key}`)
        },
        onEmpty: (query) => {
          close()
          submit(`/dm ${query}`)
        }
      })

    case 'members':
      return picker({
        title: 'Members',
        icon: theme.icons.room,
        items: items.members,
        footer: [
          { keys: '↑↓', label: 'move' },
          { keys: '⏎', label: 'message them' },
          { keys: 'esc', label: 'close' }
        ],
        onSubmit: (item) => {
          close()
          if (item.id === client.identity.publicKeyHex) return notice('that is you')
          submit(`/dm ${item.id}`)
        }
      })

    case 'commands':
      return picker({
        title: 'Commands',
        icon: theme.icons.selected,
        items: items.commands,
        placeholder: 'what do you want to do',
        onSubmit: (item) => {
          close()
          if (item.data.args) {
            setBuffer((b) => setValue(b, `/${item.data.name} `))
            setMode('insert')
            return
          }
          submit(`/${item.data.name}`)
        }
      })

    case 'keymaps':
      return picker({
        title: 'Keymaps',
        icon: theme.icons.key,
        items: items.keymaps,
        onSubmit: () => close()
      })

    case 'accounts':
      return picker({
        title: 'Accounts',
        icon: theme.icons.account,
        items: accountItems,
        placeholder: 'each one is its own keypair',
        onSubmit: (item) => {
          close()
          if (!item.data.current) onSwitchAccount?.(item.data.profile)
        }
      })

    case 'messages':
      return picker({
        title: 'Search this conversation',
        icon: theme.icons.search,
        items: items.messages,
        placeholder: 'what was said',
        footer: [
          { keys: '↑↓', label: 'move' },
          { keys: '⏎', label: 'quote it below' },
          { keys: 'esc', label: 'close' }
        ],
        onSubmit: (item) => {
          close()
          // The transcript is the terminal's own scrollback, so there is
          // nowhere to jump to. Bringing the line back down to where you are
          // reading is the honest version of "go to result".
          notice(`${item.hint}\n${item.label}`)
        }
      })

    default:
      return null
  }
}

/** The one-line questions: a room name, an invite, a new account. */
function Prompts ({ overlay, theme, terminal, close, submit, setOverlay, onCreateAccount, notice }) {
  const shared = { theme, terminal, onCancel: close }

  switch (overlay.name) {
    case 'new':
      return (
        <Prompt
          {...shared}
          title='New room'
          icon={theme.icons.room}
          placeholder='a short name — design, ops, book-club'
          help='You will own it. Nobody can join until you hand out an invite.'
          onSubmit={(name) => {
            close()
            submit(`/new ${name}`)
          }}
        />
      )

    case 'join':
      return (
        <Prompt
          {...shared}
          title='Join a room'
          icon={theme.icons.room}
          placeholder='paste the invite string'
          help='An invite carries the room key and its encryption key. Treat it like a password.'
          onSubmit={(invite) => {
            close()
            submit(`/join ${invite}`)
          }}
        />
      )

    case 'account':
      return (
        <Prompt
          {...shared}
          title='New account'
          icon={theme.icons.account}
          placeholder='a username for it — work, personal, alias'
          help='A fresh keypair, kept apart from every other account on this machine.'
          onSubmit={(name) => setOverlay({ kind: 'prompt', name: 'account-nick', account: name })}
        />
      )

    case 'account-nick':
      return (
        <Prompt
          {...shared}
          title={`Display name for "${overlay.account}"`}
          icon={theme.icons.account}
          placeholder='what people in a room will see'
          help='Not tied to the username. You can change it later with /nick.'
          onSubmit={(nick) => {
            close()
            onCreateAccount?.({ profile: overlay.account, nick })
          }}
        />
      )

    case 'account-restore':
      return (
        <Prompt
          {...shared}
          title='Restore an account'
          icon={theme.icons.key}
          placeholder='the 24 words you saved'
          help='This brings an identity from another machine onto this one, key and all.'
          onSubmit={(mnemonic) => {
            close()
            onCreateAccount?.({ profile: null, mnemonic })
          }}
        />
      )

    default:
      notice(`nothing to prompt for: ${overlay.name}`, 'error')
      return null
  }
}

function placeholderFor (room, mode) {
  if (mode === 'normal') return 'press i to write, space for the menu'
  if (!room) return 'space f d to message someone, space r n for a new room'
  return `message ${room.kind === 'dm' ? '@' : '#'}${room.name}, or / for commands`
}
