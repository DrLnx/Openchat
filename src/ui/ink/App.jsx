// The root Ink app. Wired to the real client from the first render — no mock
// data anywhere, so a networking bug shows up here as a UI bug, which is the
// only way you find them before shipping.
//
// Two decisions shape everything below.
//
// The app owns the whole terminal. It opens on the alternate screen and paints
// a frame — title bar, conversation list, chat, prompt, statusline — that is
// exactly as tall as the window, and floats are composited over it rather than
// pushed above the prompt. Nothing is written to the scrollback, so nothing
// scrolls away: the transcript scrolls inside its own pane, which is what lets
// the conversation list stay put while you read back through a room.
//
// Every keypress is routed here, once, by one handler. A modal interface has to
// decide what a key *means* before anything acts on it, and the only way to
// guarantee that is for nothing else to be listening.

import React, { useEffect, useReducer, useCallback, useState, useMemo, useRef, useContext } from 'react'
import { useInput, useWindowSize } from 'ink'

import { welcomeRows } from './Banner.jsx'
import { Screen } from './Screen.jsx'
import { Header } from './Header.jsx'
import { chatRows, chatWindow, maxScroll, scrollToRow } from './Chat.jsx'
import { sidebarRows } from './Sidebar.jsx'
import { StatusLine } from './StatusLine.jsx'
import { InputBar, CommandMenu, menuHeight } from './InputBar.jsx'
import { WhichKey, whichKeyHeight } from './WhichKey.jsx'
import { Picker, Prompt } from './Picker.jsx'
import { SettingsPanel } from './SettingsPanel.jsx'
import { Accounts } from './Accounts.jsx'
import { HelpFloat, IdentityFloat } from './Panels.jsx'
import { createTheme } from './theme.js'
import { MouseContext, useMouse, useMouseCapture } from './mouse.js'
import { screenLayout, hitSidebar } from '../model/layout.js'
import { initialState, reduce, transcript } from '../model/state.js'
import { parseInput, matchCommands, COMMANDS } from '../model/commands.js'
import { createBuffer, applyKey, setValue } from '../model/editor.js'
import { bindingsFor, chordFor, createResolver, describeChord, BINDINGS } from '../model/keymap.js'
import { read as readSettings, write as writeSetting, THEMES } from '../model/settings.js'
import { displayName, shortKey, formatTime, conversationLabel } from '../model/format.js'
import { runCommand } from '../../commands/index.js'
import { writeConfig } from '../../core/store.js'
import { listAccounts } from '../../core/accounts.js'

/** How far ctrl-u, ctrl-d and the wheel move the transcript, in rows. */
const SCROLL_STEP = 3

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
  // How far back through the transcript you have scrolled, in rows, measured
  // from the newest line. Zero means the pane follows the conversation.
  const [scroll, setScroll] = useState(0)
  // A search hit in another conversation cannot be scrolled to until that
  // conversation has actually loaded, so the request outlives the keypress.
  const [revealing, setRevealing] = useState(null)
  // Which pane has the keyboard. The conversation list is a place you can go,
  // not just a thing you look at.
  const [focus, setFocus] = useState('chat')
  const [picked, setPicked] = useState(0)
  // How far a page-up moves: the height of the chat pane, which is not known
  // until it has been laid out. A ref rather than state, so a resize does not
  // rebuild every callback in the app.
  const pageRef = useRef(10)

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
    // Unread counts come from the index, so what was waiting for you when you
    // closed the app is still waiting when you open it.
    const unread = client.unread()
    dispatch({
      type: 'rooms',
      rooms: client.conversationList.map((c) => ({
        key: c.id,
        ...c,
        unread: unread.get(c.id) || 0
      }))
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

  // Searching goes to the index, not to what happens to be in memory: the
  // transcript in front of you is a few hundred lines, and the thing you are
  // looking for is usually not one of them.
  const searchMessages = useCallback((query) => client.search(query, { limit: 200 }).map((row) => ({
    id: row.id,
    label: row.body,
    hint: [
      row.conversationName,
      displayName(state.members[row.author], row.author),
      formatTime(row.ts)
    ].filter(Boolean).join(' · '),
    detail: row.author,
    data: row
  })), [client, state.members])

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
      setScroll(0)
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

      case 'focus': {
        // Toggling: pressing it again puts you back where you were typing.
        const entering = focus !== 'sidebar'
        if (entering) {
          // Start on the conversation you are already in, so the list opens
          // under your hand rather than at the top of a list you have to
          // travel back down.
          const row = hit.current.targets.indexOf(client.activeId)
          if (row >= 0) setPicked(row)
        }
        setFocus(entering ? 'sidebar' : 'chat')
        return
      }

      case 'scroll': {
        if (name === 'end') return setScroll(0)
        if (name === 'home') return setScroll(Number.MAX_SAFE_INTEGER)
        if (name === 'page') return setScroll((s) => s + pageRef.current)
        if (name === 'unpage') return setScroll((s) => Math.max(0, s - pageRef.current))
        if (name === 'up') return setScroll((s) => s + SCROLL_STEP)
        return setScroll((s) => Math.max(0, s - SCROLL_STEP))
      }

      case 'toggle': {
        if (name === 'timestamps') {
          return changeSetting('timestamps', settings.timestamps === 'off' ? '24h' : 'off')
        }
        if (name === 'compact') return changeSetting('compact', !settings.compact)
        if (name === 'sidebar') return changeSetting('sidebar', !settings.sidebar)
        if (name === 'mouse') {
          const next = settings.mouse === 'off' ? 'floats' : settings.mouse === 'floats' ? 'always' : 'off'
          changeSetting('mouse', next)
          return notice(`mouse: ${next}`)
        }
      }
    }
  }, [client, state.rooms, settings, focus, submit, refresh, notice, openConversation, changeSetting, loadAccounts])

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

    // While the conversation list has the keyboard it owns these keys outright,
    // in either mode. A pane you can move around in that still types into the
    // message box is not a pane you have moved into.
    if (focus === 'sidebar') {
      if (key.escape || key.leftArrow || input === 'h' || input === 'q') return setFocus('chat')
      if (key.upArrow || input === 'k' || (key.ctrl && input === 'p')) return moveList(-1)
      if (key.downArrow || input === 'j' || (key.ctrl && input === 'n')) return moveList(1)
      if (key.pageUp) return moveList(-5)
      if (key.pageDown) return moveList(5)
      if (key.return || key.rightArrow || input === 'l') {
        openPicked()
        // Opening one puts you back where you write, which is what you were
        // going there to do.
        return setFocus('chat')
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
    // A keystroke the list did not claim must still not end up in the message.
    if (focus === 'sidebar') return

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

  // --- the screen ---------------------------------------------------------

  const entries = transcript(state)

  // Which keys are still reachable from a half-typed chord. Computed here
  // rather than in the popup, because the screen has to give up the rows the
  // popup is about to take before it decides how tall the chat pane is.
  const candidates = useMemo(
    () => (!overlay && whichKey && pending.length > 0
      ? (resolvers[mode] || resolvers.insert).candidates(pending)
      : []),
    [overlay, whichKey, pending, resolvers, mode]
  )

  // Neither the command menu nor the which-key popup takes a row from the
  // conversation. They are drawn over the bottom of it, anchored to the prompt,
  // because a menu that pushes the transcript up the screen means every slash
  // you type makes the thing you were reading move.
  const menuRows = menuHeight(matches)
  const chordRows = whichKeyHeight(candidates, terminal)

  const layout = useMemo(
    () => screenLayout(terminal, { sidebar: settings.sidebar }),
    [terminal, settings.sidebar]
  )

  // Everything behind a float loses its colour, so the float reads as the thing
  // in front rather than as one more panel competing with the conversation.
  const muted = Boolean(overlay)

  const { rows: transcriptRows, anchors } = useMemo(() => chatRows({
    entries,
    width: layout.chatWidth,
    theme,
    settings,
    members: state.members,
    attachments: state.attachments,
    self: state.self,
    muted
  }), [entries, layout.chatWidth, theme, settings, state.members, state.attachments, state.self, muted])

  // With nothing open there is no transcript to show, so the pane says who you
  // are and how to reach someone — the two things a new terminal cannot guess.
  const welcome = useMemo(() => (state.room
    ? null
    : welcomeRows({
      theme,
      self: state.self,
      profile,
      version,
      columns: layout.chatWidth - 2,
      logo: settings.banner
    })), [state.room, theme, state.self, profile, version, layout.chatWidth, settings.banner])

  // With nothing open the pane introduces itself — but it must not swallow
  // what just happened. Leaving or deleting your last conversation lands you
  // here, and the confirmation for it is a notice, which lives in the
  // transcript. Show both: the welcome, then whatever has been said since.
  const rows = welcome ? [...welcome, ...transcriptRows] : transcriptRows

  // Scrolling is clamped on every render rather than only when you scroll: the
  // transcript grows under you, and the window shrinks when you open the
  // command menu, so a position that was valid a frame ago may not be now.
  const ceiling = maxScroll(rows.length, layout.bodyRows)
  const at = Math.min(scroll, ceiling)

  pageRef.current = Math.max(1, layout.bodyRows - 2)

  // Where a search result lives, so picking one scrolls to it. Read through a
  // ref for the same reason the mouse hit test is: the finder is rebuilt on
  // every keystroke, and this must not be.
  const found = useRef({ anchors, total: rows.length, height: layout.bodyRows })
  found.current = { anchors, total: rows.length, height: layout.bodyRows }

  const revealMessage = useCallback((id) => {
    const { anchors: at, total, height } = found.current
    const row = at.get(id)
    if (row === undefined) return false
    setScroll(scrollToRow(row, total, height))
    return true
  }, [])

  useEffect(() => {
    if (!revealing) return
    if (revealMessage(revealing)) setRevealing(null)
  }, [revealing, revealMessage, rows.length, state.room?.key])

  // Something arriving while you are reading back must not shove the line you
  // are reading up the screen. The scroll position is measured from the end of
  // the transcript, so when the transcript grows, it has to grow with it.
  const printed = useRef(0)
  useEffect(() => {
    const grew = rows.length - printed.current
    printed.current = rows.length
    if (grew > 0) setScroll((current) => (current > 0 ? current + grew : 0))
  }, [rows.length])

  const chat = chatWindow(rows, layout.bodyRows, at)

  const listFocused = focus === 'sidebar' && !overlay && layout.sidebar

  const { rows: sidebar, targets } = useMemo(() => sidebarRows({
    conversations: state.rooms,
    activeId: state.room?.key ?? null,
    columns: layout.sidebarWidth,
    theme,
    muted,
    focused: listFocused,
    selected: picked
  }), [state.rooms, state.room, layout.sidebarWidth, theme, muted, listFocused, picked])

  // Only the rows that open something can be moved to; the headings and the
  // blank line between sections are skipped over rather than landed on.
  const stops = useMemo(
    () => targets.map((id, row) => (id ? row : null)).filter((row) => row !== null),
    [targets]
  )

  // The list can change under the cursor — a room closes, someone starts a
  // conversation — so where it points is checked every render rather than only
  // when you move it.
  useEffect(() => {
    if (stops.length === 0) return
    if (!stops.includes(picked)) setPicked(stops[0])
  }, [stops, picked])

  // Leaving a list that has nothing in it would trap the keyboard there.
  useEffect(() => {
    if (focus === 'sidebar' && (!layout.sidebar || stops.length === 0)) setFocus('chat')
  }, [focus, layout.sidebar, stops.length])

  const moveList = useCallback((step) => {
    setPicked((current) => {
      if (stops.length === 0) return current
      const at = stops.indexOf(current)
      const next = at === -1 ? 0 : (at + step + stops.length) % stops.length
      return stops[next]
    })
  }, [stops])

  const openPicked = useCallback(() => {
    const id = targets[picked]
    if (id) openConversation(id)
  }, [targets, picked, openConversation])

  const uiMode = overlay ? 'float' : mode

  // `off` means every float behaves as though the terminal had no mouse at all,
  // and `always` keeps reporting on so the sidebar and the transcript are
  // clickable too — at the cost of your terminal's own selection.
  const mouseSource = useContext(MouseContext)
  const mouse = settings.mouse === 'off' ? null : mouseSource

  useEffect(() => {
    if (!mouse || settings.mouse !== 'always') return
    mouse.enable()
    return () => mouse.disable()
  }, [mouse, settings.mouse])

  // Held in a ref so the subscription survives a keystroke — this component
  // re-renders on every character typed.
  const hit = useRef({ layout, targets })
  hit.current = { layout, targets }

  const onMouse = useCallback((event) => {
    if (overlay) return // the float on top owns the mouse while it is open

    if (event.type === 'wheel') return setScroll((s) => Math.max(0, s - event.direction * 3))
    if (event.type !== 'press' || event.button !== 'left') return

    const row = hitSidebar(hit.current.layout, event, hit.current.targets.length)
    if (row === null) {
      // A click in the conversation itself is how you get the keyboard back.
      if (focus === 'sidebar') setFocus('chat')
      return
    }

    const id = hit.current.targets[row]
    if (!id) return
    setPicked(row)
    openConversation(id)
  }, [overlay, openConversation, focus])

  // Reporting is normally only on while a float is open, so that the terminal
  // keeps its own text selection. A focused conversation list is the same kind
  // of moment: you asked to point at something, so the mouse is turned on for
  // as long as you are there.
  useMouseCapture(listFocused && settings.mouse !== 'off')
  useMouse(onMouse, (settings.mouse === 'always' || listFocused) && !overlay)

  return (
    <MouseContext.Provider value={mouse}>
      <Screen
        theme={theme}
        layout={layout}
        listFocused={listFocused}
        header={
          <Header
            theme={theme}
            room={state.room}
            columns={layout.columns}
            members={Object.keys(state.members).length}
            peers={state.connection.peers}
            connection={state.connection.state}
            muted={muted}
          />
        }
        sidebar={sidebar}
        chat={chat}
        overlay={overlay
          ? (backdrop) => (
            <Overlay
              // Keyed by which float this is, so opening a second one starts it
              // empty. Without this React reuses the instance, and the username
              // you typed into one prompt is still sitting in the next.
              key={`${overlay.kind}:${overlay.name}`}
              backdrop={backdrop}
              overlay={overlay}
              theme={theme}
              terminal={terminal}
              state={state}
              client={client}
              profile={profile}
              settings={settings}
              accounts={accounts}
              accountItems={accountItems}
              items={{ conversations, people, members, searchMessages, commands: commandItems, keymaps: keymapItems }}
              notice={notice}
              submit={submit}
              close={close}
              setBuffer={setBuffer}
              setMode={setMode}
              setOverlay={setOverlay}
              openConversation={openConversation}
              reveal={setRevealing}
              changeSetting={changeSetting}
              onSwitchAccount={onSwitchAccount}
              onCreateAccount={onCreateAccount}
            />
            )
          : menuRows > 0
            ? anchored(layout, menuRows, (
              <CommandMenu
                theme={theme}
                value={buffer.value}
                matches={matches}
                selected={menu}
                columns={layout.columns}
              />
            ))
            : chordRows > 0
              ? anchored(layout, chordRows, (
                <WhichKey
                  theme={theme}
                  terminal={terminal}
                  pending={pending}
                  candidates={candidates}
                />
              ))
              : null}
        input={
          <InputBar
            theme={theme}
            mode={uiMode}
            value={buffer.value}
            cursor={buffer.cursor}
            busy={busy || exiting}
            width={layout.columns}
            placeholder={placeholderFor(state.room, mode)}
          />
        }
        status={
          <StatusLine
            theme={theme}
            mode={uiMode}
            room={state.room}
            rooms={state.rooms}
            profile={profile}
            connection={state.connection}
            self={state.self}
            columns={layout.columns}
            scrolled={at > 0}
            listFocused={listFocused}
            mouse={settings.mouse === 'always'}
            writable={client.activeRoom ? client.activeRoom.writable : true}
          />
        }
      />
    </MouseContext.Provider>
  )
}

/**
 * Draw something over the bottom of the conversation, keeping the rows above it.
 *
 * The command menu and the which-key popup both belong directly above the
 * prompt and neither should cost the conversation a row, so both are composited
 * the same way a float is — see Screen.jsx.
 */
function anchored (layout, rows, node) {
  return (backdrop) => (
    <>
      {backdrop.slice(0, Math.max(0, layout.bodyRows - rows))}
      {node}
    </>
  )
}

/** Whichever floating window is open. Split out to keep App's render readable. */
function Overlay ({
  overlay, theme, terminal, backdrop, state, client, profile, settings, accounts, accountItems, items,
  notice, submit, close, setBuffer, setMode, setOverlay, openConversation, reveal,
  changeSetting, onSwitchAccount, onCreateAccount
}) {
  const shared = { theme, terminal, backdrop, onCancel: close }

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

  if (overlay.kind === 'prompt') return <Prompts {...{ overlay, theme, terminal, backdrop, close, submit, setOverlay, onCreateAccount, notice }} />

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
        title: 'Search everything',
        icon: theme.icons.search,
        onSearch: items.searchMessages,
        placeholder: 'anything anyone has said to you',
        footer: [
          { keys: '↑↓', label: 'move' },
          { keys: '⏎', label: 'jump to it' },
          { keys: 'esc', label: 'close' }
        ],
        onSubmit: (item) => {
          close()
          // A hit can be in a conversation you are not looking at, so open that
          // first; the jump itself has to wait for it to load.
          const target = item.data?.conversation
          if (target && target !== client.activeId) openConversation(target)
          reveal(item.id)
        }
      })

    default:
      return null
  }
}

/** The one-line questions: a room name, an invite, a new account. */
function Prompts ({ overlay, theme, terminal, backdrop, close, submit, setOverlay, onCreateAccount, notice }) {
  const shared = { theme, terminal, backdrop, onCancel: close }

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
  return `message ${conversationLabel(room.kind, room.name)}, or / for commands`
}
