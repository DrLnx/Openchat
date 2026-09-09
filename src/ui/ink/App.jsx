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

import { welcomeRows, emptyRows } from './Banner.jsx'
import { Screen } from './Screen.jsx'
import { Header } from './Header.jsx'
import { chatRows, chatWindow, maxScroll, scrollToRow } from './Chat.jsx'
import { sidebarRows } from './Sidebar.jsx'
import { StatusLine } from './StatusLine.jsx'
import { InputBar } from './InputBar.jsx'
import { Cmdline, CMDLINE_ROWS } from './Cmdline.jsx'
import { WhichKey } from './WhichKey.jsx'
import { Picker, Prompt } from './Picker.jsx'
import { SettingsPanel } from './SettingsPanel.jsx'
import { Accounts } from './Accounts.jsx'
import { HelpFloat, IdentityFloat, InviteFloat } from './Panels.jsx'
import { createTheme } from './theme.js'
import { MouseContext, useMouse, useMouseCapture } from './mouse.js'
import { screenLayout, hitSidebar } from '../model/layout.js'
import { initialState, reduce, transcript } from '../model/state.js'
import { parseInput, parseCommand, matchCommands } from '../model/commands.js'
import { createBuffer, applyKey, setValue } from '../model/editor.js'
import { bindingsFor, chordFor, createResolver, describeChord, BINDINGS } from '../model/keymap.js'
import { read as readSettings, write as writeSetting, THEMES } from '../model/settings.js'
import { displayName, shortKey, formatTime, conversationLabel } from '../model/format.js'
import { runCommand } from '../../commands/index.js'
import { writeConfig } from '../../core/store.js'
import { listAccounts } from '../../core/accounts.js'

/** How far ctrl-u, ctrl-d and the wheel move the transcript, in rows. */
const SCROLL_STEP = 3

/**
 * How long a line above the prompt stays before it takes itself off.
 *
 * An acknowledgement is gone almost before you have read it, which is the
 * point of one. A warning or an error is something you have to act on, and one
 * that has already vanished by the time you look up is one that never happened.
 */
const FLASH_MS = { info: 2600, warn: 7000, error: 7000 }

// Commands that open a window instead of writing into the conversation.
//
// Everything key-shaped is here. A public key, an invite and a recovery phrase
// are things you copy, not things you read, and the transcript is the worst
// place in the app to put one: it wraps them, it indents them under a speaker,
// it scrolls them away, and it keeps them on screen long after you have
// finished with them. See KeyFloat.jsx.
//
// The lists went the same way for a smaller reason — a room's member list is a
// column of public keys, and a finder is a better thing to do with a list than
// a paragraph of output is.
const UI_COMMANDS = {
  // `:help` is the command line itself: it already lists every command with
  // what it does, which is what a help command is for.
  help: 'cmdline',
  profiles: 'float:accounts',
  settings: 'float:settings',
  accounts: 'float:accounts',
  keys: 'float:help',
  whoami: 'float:identity',
  backup: 'float:backup',
  invite: 'float:invite',
  members: 'picker:members',
  contacts: 'picker:people',
  rooms: 'picker:conversations',
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
  // The command line: null when closed, otherwise its own editor buffer —
  // its own text, its own cursor, and its own history, kept apart from the
  // message you may be halfway through writing.
  const [cmdline, setCmdline] = useState(null)
  const [cmdIndex, setCmdIndex] = useState(0)
  const [flashed, setFlashed] = useState(null)
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

  // Everything openchat has to say for itself is said in one place: one line
  // above the prompt, for a couple of seconds, and then taken back down.
  //
  // It used to go into the transcript. That was wrong in every direction: it is
  // not part of the conversation, it outlived the moment it was about, it
  // pushed real messages up the screen, and pressing a key three times left
  // three identical lines interleaved with what people had actually said. The
  // transcript is the conversation. This is the program talking, and the
  // program talks above the prompt.
  //
  // Anything too big for a line — a list of commands, of members, of accounts,
  // a key — opens a window instead. Nothing is truncated into meaninglessness
  // and nothing is left lying in the log.
  const flash = useCallback((text, level = 'info') => {
    setFlashed({ text, level, at: Date.now() })
  }, [])

  const notice = flash

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
    // A conversation renamed itself — someone said what they are called. The
    // name is in three places on this screen and a message arriving redraws
    // none of them.
    client.on('conversations', onSwitched)
    client.on('connection', onConnection)
    client.on('attachment', onAttachment)
    client.on('notice', onNotice)
    client.on('member', onMember)

    return () => {
      client.off('messages', onMessages)
      client.off('switched', onSwitched)
      client.off('conversations', onSwitched)
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
  // are still real commands, so that everything reachable by a chord is also
  // reachable by typing, which is what makes the keymap optional rather than
  // mandatory.
  const performRef = useRef(null)

  /** Send what is in the message box. It is a message, whatever is in it. */
  const submit = useCallback(async (line) => {
    const parsed = parseInput(line)
    if (parsed.kind === 'empty') return

    setBusy(true)
    try {
      await client.sendText(parsed.body)
    } catch (err) {
      notice(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }, [client, notice])

  /** Run a line from the command line. Takes `:dm ada` or `dm ada` alike. */
  const run = useCallback(async (line) => {
    const parsed = parseCommand(line)
    if (parsed.kind === 'empty') return
    if (parsed.kind === 'error') return notice(parsed.message, 'error')

    if (parsed.name === 'theme') {
      if (!THEMES.includes(parsed.arg)) {
        return notice(`themes: ${THEMES.join(', ')}`, 'error')
      }
      return changeSetting('theme', parsed.arg)
    }

    const opens = UI_COMMANDS[parsed.name]
    if (opens) return performRef.current?.(opens)

    setBusy(true)
    try {
      await runCommand(parsed, {
        client,
        notice,
        refresh,
        // Let the transcript settle before tearing the render down, so the
        // goodbye is not swallowed mid-frame.
        quit: () => setExiting(true)
      })
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

  // The member list is the one place a room's public keys are all on screen at
  // once, so it says which one is yours and which one owns the room — the two
  // facts you cannot work out from a hex string.
  const owner = client.activeRoom?.owner ?? null
  const members = useMemo(() => Object.entries(state.members).map(([key, member]) => ({
    id: key,
    label: displayName(member, key),
    hint: [
      `${shortKey(key, 16)}…`,
      key === client.identity.publicKeyHex ? '(you)' : null,
      key === owner ? 'owner' : null
    ].filter(Boolean).join(' · '),
    detail: key,
    data: { key }
  })), [state.members, client, owner])

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
        setMode(name)
        return

      case 'cmdline':
        openCmdline()
        return

      case 'picker':
        if (name === 'accounts') loadAccounts()
        setOverlay({ kind: 'picker', name })
        return

      case 'float':
        if (name === 'accounts') loadAccounts()
        // The one window that needs something to exist before it can open.
        if (name === 'invite' && !client.activeRoom) {
          return notice('DMs need no invite — /invite only applies to rooms', 'error')
        }
        // `/backup` is the identity window with the phrase already showing:
        // asking for it *is* asking to see it.
        if (name === 'backup') return setOverlay({ kind: 'float', name: 'identity', revealed: true })
        setOverlay({ kind: 'float', name })
        return

      case 'prompt':
        setOverlay({ kind: 'prompt', name })
        return

      case 'cmd':
        run(name)
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
    () => (cmdline ? matchCommands(cmdline.value) : []),
    [cmdline]
  )

  useEffect(() => {
    setCmdIndex((current) => (current >= matches.length ? 0 : current))
  }, [matches.length])

  // A flash is a moment, not a state. It goes away on its own, and anything
  // that happens afterwards replaces it rather than queueing behind it.
  useEffect(() => {
    if (!flashed) return
    const timer = setTimeout(() => setFlashed(null), FLASH_MS[flashed.level] ?? FLASH_MS.info)
    return () => clearTimeout(timer)
  }, [flashed])

  // The key menu waits a beat, so a chord you already know does not flash a
  // menu at you on the way past.
  useEffect(() => {
    if (pending.length === 0) {
      setWhichKey(false)
      return
    }
    const timer = setTimeout(() => setWhichKey(true), settings.whichKeyDelayMs)
    return () => clearTimeout(timer)
  }, [pending, settings.whichKeyDelayMs])

  const openCmdline = useCallback((value = '') => {
    setCmdline(createBuffer(value))
    setCmdIndex(0)
    setPending([])
  }, [])

  const closeCmdline = useCallback(() => {
    setCmdline(null)
    setCmdIndex(0)
  }, [])

  /** Tab: take the highlighted name, and leave the cursor where the args go. */
  const complete = useCallback((command) => {
    if (!command) return
    setCmdline((b) => setValue(b, command.args ? `${command.name} ` : command.name))
    setCmdIndex(0)
  }, [])

  // Every key the command line takes, in one place, the way every other key in
  // this app is handled — see the note at the top of this file.
  const onCmdlineKey = useCallback((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) return closeCmdline()

    if (key.tab) return complete(matches[cmdIndex])
    if (key.upArrow || (key.ctrl && input === 'k')) {
      return setCmdIndex((i) => (matches.length ? (i - 1 + matches.length) % matches.length : 0))
    }
    if (key.downArrow || (key.ctrl && input === 'j')) {
      return setCmdIndex((i) => (matches.length ? (i + 1) % matches.length : 0))
    }
    if (key.pageUp) return setCmdIndex(0)
    if (key.pageDown) return setCmdIndex(Math.max(0, Math.min(matches.length, CMDLINE_ROWS) - 1))

    // Ctrl-P and Ctrl-N walk back through commands you have run, the way the
    // arrows do in the message box. The arrows are spoken for here.
    const recall = key.ctrl && (input === 'p' || input === 'n')
    const edit = applyKey(cmdline, recall ? '' : input, recall
      ? { upArrow: input === 'p', downArrow: input === 'n' }
      : key)
    if (!edit) return

    if (edit.submit !== undefined) {
      const typed = edit.submit.trim()

      // A complete command runs as typed — that is the only way `:dm <key>`
      // reaches anything, since the argument is not something the list knows.
      if (parseCommand(typed).kind === 'command') {
        closeCmdline()
        return run(typed)
      }

      // Otherwise the highlighted row is what you meant: `me` is not a command
      // but `members` is the only thing under it, and sending "me" to the room
      // is never what anybody wanted. One that still needs an argument stays
      // open with the name filled in, because there is nothing to run yet.
      const picked = matches[cmdIndex]
      if (picked) {
        if (picked.args) return complete(picked)
        closeCmdline()
        return run(picked.name)
      }

      // Nothing typed and nothing to pick: close. Anything else is reported.
      closeCmdline()
      if (typed) run(typed)
      return
    }

    setCmdline(edit.buffer)
    setCmdIndex(0)
  }, [cmdline, matches, cmdIndex, complete, closeCmdline, run])

  useInput((input, key) => {
    if (exiting) return

    // The command line owns the keyboard outright while it is open. It is a
    // separate line of text with its own cursor and its own history, and a key
    // that reached the message box from here would type into a message nobody
    // can see.
    if (cmdline) return onCmdlineKey(input, key)

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
  // rather than in the menu, because whether there are any is what decides
  // which window the screen is handed, and only one may be open at a time.
  const candidates = useMemo(
    () => (!overlay && whichKey && pending.length > 0
      ? (resolvers[mode] || resolvers.insert).candidates(pending)
      : []),
    [overlay, whichKey, pending, resolvers, mode]
  )

  // Every window in this app is laid over the frame rather than wedged into it,
  // so the screen is measured once and does not depend on what is open. The
  // title bar, the conversation, the prompt and the statusline are in the same
  // place whatever you press — which is the property that makes reaching for a
  // key feel like nothing at all rather than like the page moving under you.
  const layout = useMemo(
    () => screenLayout(terminal, { sidebar: settings.sidebar }),
    [terminal, settings.sidebar]
  )

  // Only one of them is ever open: the command line belongs to a command you
  // are typing and the key menu to a chord you are halfway through, and you
  // cannot be doing both.
  const showChord = !cmdline && candidates.length > 0

  // Everything behind a float loses its colour, so the float reads as the thing
  // in front rather than as one more panel competing with the conversation.
  // Only a window you are *in* drains the colour from what is behind it. The
  // key menu is a hint you glanced at on the way to pressing something, and
  // grey-washing the entire app for it made openchat look switched off every
  // time a chord was half-typed.
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
      rows: layout.bodyRows,
      logo: settings.banner
    })), [state.room, theme, state.self, profile, version, layout.chatWidth, layout.bodyRows, settings.banner])

  // A conversation with nothing in it yet is a blank pane that looks like a
  // failure and is not one. It gets the same treatment as the welcome: a few
  // rows saying where you are and what the next keypress is.
  const opening = useMemo(() => (state.room && state.messages.length === 0
    ? emptyRows({
      theme,
      room: state.room,
      owned: Boolean(state.room.owned),
      columns: layout.chatWidth - 2
    })
    : null), [state.room, state.messages.length, theme, layout.chatWidth])

  // With nothing open the pane introduces itself — but it must not swallow
  // what just happened. Leaving or deleting your last conversation lands you
  // here, and the confirmation for it is a notice, which lives in the
  // transcript. Show both: the intro, then whatever has been said since.
  const intro = welcome || opening
  const rows = intro ? [...intro, ...transcriptRows] : transcriptRows

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

  const uiMode = overlay ? 'float' : cmdline ? 'command' : mode

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
              screen={layout}
              state={state}
              client={client}
              profile={profile}
              settings={settings}
              accounts={accounts}
              accountItems={accountItems}
              items={{ conversations, people, members, searchMessages, keymaps: keymapItems }}
              notice={notice}
              flash={flash}
              run={run}
              close={close}
              setOverlay={setOverlay}
              openConversation={openConversation}
              reveal={setRevealing}
              changeSetting={changeSetting}
              onSwitchAccount={onSwitchAccount}
              onCreateAccount={onCreateAccount}
            />
            )
          : cmdline
            ? (backdrop) => (
              <Cmdline
                theme={theme}
                screen={layout}
                value={cmdline.value}
                cursor={cmdline.cursor}
                matches={matches}
                selected={cmdIndex}
                backdrop={backdrop}
              />
              )
            : showChord
              ? (backdrop) => (
                <WhichKey
                  theme={theme}
                  screen={layout}
                  pending={pending}
                  candidates={candidates}
                  backdrop={backdrop}
                />
                )
              : null}
        input={
          <InputBar
            theme={theme}
            mode={uiMode}
            value={buffer.value}
            cursor={buffer.cursor}
            busy={busy || exiting}
            width={layout.columns}
            target={state.room ? conversationLabel(state.room.kind, state.room.name) : null}
            placeholder={placeholderFor(state.room, uiMode)}
            flash={flashed}
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

/** Whichever floating window is open. Split out to keep App's render readable. */
function Overlay ({
  overlay, theme, screen, backdrop, state, client, profile, settings, accounts, accountItems, items,
  notice, flash, run, close, setOverlay, openConversation, reveal,
  changeSetting, onSwitchAccount, onCreateAccount
}) {
  const shared = { theme, screen, backdrop, onCancel: close }

  // Copying happens inside a window, but the confirmation belongs outside it:
  // the window is about to be closed, and "did that work" is a question you ask
  // after it has gone. It is an answer to a keypress rather than something that
  // happened in the room, so it flashes above the prompt and then goes — see
  // the note on `flash` in App.
  const onCopy = (what) => flash(`copied ${what}`)

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
          revealed={Boolean(overlay.revealed)}
          onCopy={onCopy}
          identity={{
            nick: client.identity.nick,
            publicKey: client.identity.publicKeyHex,
            mnemonic: client.identity.mnemonic
          }}
        />
      )
    }

    if (overlay.name === 'invite') {
      const room = client.activeRoom
      if (!room) return null
      return (
        <InviteFloat
          {...shared}
          onCopy={onCopy}
          room={{ name: room.name, invite: room.invite, closed: room.isClosed }}
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
        />
      )
    }
  }

  if (overlay.kind === 'prompt') return <Prompts {...{ overlay, theme, screen, backdrop, close, run, setOverlay, onCreateAccount, notice }} />

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
          run(`dm ${item.data.key}`)
        },
        onEmpty: (query) => {
          close()
          run(`dm ${query}`)
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
          run(`dm ${item.id}`)
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
function Prompts ({ overlay, theme, screen, backdrop, close, run, setOverlay, onCreateAccount, notice }) {
  const shared = { theme, screen, backdrop, onCancel: close }

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
            run(`new ${name}`)
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
            run(`join ${invite}`)
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

    default:
      notice(`nothing to prompt for: ${overlay.name}`, 'error')
      return null
  }
}

function placeholderFor (room, mode) {
  if (mode === 'command') return 'the command line has the keyboard'
  if (mode === 'normal') return 'i to write  ·  ␣ for the key menu  ·  : for a command'
  if (!room) return '␣ f d to message someone  ·  ␣ r n for a new room'
  return `message ${conversationLabel(room.kind, room.name)}`
}
