// The browser renderer.
//
// Ink draws boxes to a terminal; this draws elements to the DOM. What they
// share is everything above the drawing: the same reducer in ui/model/state.js
// holds the state, the same helpers in ui/model/format.js name and colour
// people, the same parser in ui/model/commands.js reads the input line. So the
// two front ends can look different but cannot *behave* differently — a bug in
// unread counts or member tracking shows up in both.

import b4a from 'b4a'

import { initialState, reduce, transcript, memberList } from '../src/ui/model/state.js'
import { parseInput } from '../src/ui/model/commands.js'
import {
  colorForAuthor, displayName, formatBytes, formatTime, formatSystemEvent, formatNickChange
} from '../src/ui/model/format.js'
import { runWebCommand } from './commands.js'

const MAX_PREVIEW_BYTES = 2048

export class Terminal {
  constructor ({ client, sim, root }) {
    this.client = client
    this.sim = sim
    this.root = root
    this._logSignature = null
    this.state = initialState({
      publicKey: client.identity.publicKeyHex,
      nick: client.identity.nick
    })

    this._build()
    this._subscribe()
    this._refresh()
  }

  // --- DOM ----------------------------------------------------------------

  _build () {
    this.root.innerHTML = `
      <div class="term">
        <div class="term-status">
          <span class="room"></span>
          <span class="conn"><span class="dot"></span><span class="conn-text"></span></span>
        </div>
        <div class="term-welcome">
          <span><span class="star">✻</span> <b>Welcome to openchat</b></span>
          <span>end-to-end encrypted · no server · /help for commands</span>
          <span class="welcome-room"></span>
        </div>
        <div class="term-body">
          <div class="log" role="log" aria-live="polite" aria-label="Chat transcript"></div>
          <aside class="rail">
            <div class="rail-title">Members</div>
            <ul class="members"></ul>
            <div class="rail-title rail-title--room">Room</div>
            <dl class="room-facts"></dl>
          </aside>
        </div>
        <div class="chips"></div>
        <form class="input-row" autocomplete="off">
          <span class="prompt">&gt;</span>
          <input class="input" type="text" placeholder="message, or /help"
                 aria-label="Message or command" enterkeyhint="send" />
          <button class="send" type="submit" aria-label="Send">↵</button>
        </form>
        <input class="file-input" type="file" hidden />
      </div>
    `

    this.$room = this.root.querySelector('.room')
    this.$dot = this.root.querySelector('.dot')
    this.$conn = this.root.querySelector('.conn-text')
    this.$log = this.root.querySelector('.log')
    this.$members = this.root.querySelector('.members')
    this.$facts = this.root.querySelector('.room-facts')
    this.$welcome = this.root.querySelector('.welcome-room')
    this.$chips = this.root.querySelector('.chips')
    this.$form = this.root.querySelector('.input-row')
    this.$input = this.root.querySelector('.input')
    this.$file = this.root.querySelector('.file-input')

    this.$form.addEventListener('submit', (event) => {
      event.preventDefault()
      const line = this.$input.value
      this.$input.value = ''
      this._submit(line)
    })

    this.$file.addEventListener('change', async () => {
      const f = this.$file.files?.[0]
      this.$file.value = ''
      if (!f) return
      try {
        await this.client.sendFile(f)
      } catch (err) {
        this._notice(`could not send that file: ${err.message}`, 'error')
      }
    })

    // Typing a slash on a phone keyboard is a nuisance, so the commands worth
    // trying are one tap away.
    for (const label of ['/help', '/invite', '/members', '/rooms', 'send a file']) {
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = 'chip'
      chip.textContent = label
      chip.addEventListener('click', () => {
        if (label === 'send a file') return this.$file.click()
        this._submit(label)
      })
      this.$chips.append(chip)
    }
  }

  _subscribe () {
    const client = this.client

    client.addEventListener('messages', (event) => {
      const messages = event.detail.messages
      this._dispatch({ type: 'messages', messages })
      for (const message of messages) {
        if (message.author !== client.identity.publicKeyHex) continue
        this.sim?.onHumanMessage(message)
      }
    })

    client.addEventListener('attachment', (event) => {
      const { id, ...attachment } = event.detail
      this._dispatch({ type: 'attachment', id, attachment })
    })

    client.addEventListener('connection', (event) => {
      this._dispatch({ type: 'connection', connection: event.detail })
    })

    client.addEventListener('notice', (event) => {
      this._notice(event.detail.text, event.detail.level)
    })

    client.addEventListener('host', () => {
      this.sim?.setActive(client.isHost)
      this._render()
    })
  }

  async _submit (line) {
    const parsed = parseInput(line)
    if (parsed.kind === 'empty') return
    if (parsed.kind === 'error') return this._notice(parsed.message, 'error')

    try {
      if (parsed.kind === 'text') {
        await this.client.sendText(parsed.body)
      } else {
        await runWebCommand(parsed, {
          client: this.client,
          notice: (text, level) => this._notice(text, level),
          members: () => memberList(this.state),
          pickFile: () => this.$file.click(),
          refresh: () => this._refresh()
        })
      }
    } catch (err) {
      this._notice(err.message, 'error')
    }
  }

  _refresh () {
    const room = this.client.activeRoom
    this._dispatch({ type: 'room', room, messages: this.client.messages })
    this._dispatch({ type: 'rooms', rooms: this.client.roomList.map((r) => ({ ...r, unread: 0 })) })
  }

  _notice (text, level = 'info') {
    this._dispatch({ type: 'notice', text, level })
  }

  _dispatch (action) {
    this.state = reduce(this.state, action)
    this._render()
  }

  // --- rendering ----------------------------------------------------------

  _render () {
    const state = this.state
    const room = state.room

    this.$room.textContent = room ? `#${room.name}` : 'no room'
    if (this.$welcome) {
      const me = state.self?.nick || ''
      this.$welcome.textContent = room ? `room: #${room.name}   you: ${me}` : 'no room yet'
    }

    const peers = state.connection.peers
    const tabs = peers === 1 ? '1 other tab' : `${peers} other tabs`
    this.$dot.dataset.state = state.connection.state
    this.$conn.textContent = `${tabs} · ${this.client.isHost ? 'simulated members here' : 'members run in the first tab'}`

    this._renderLog(state)
    this._renderMembers(state)
    this._renderFacts()
  }

  _renderLog (state) {
    const entries = transcript(state)

    // Rebuilding the log throws away anything the reader had selected, so only
    // do it when something in the transcript actually changed. Presence updates
    // and connection blips arrive constantly and touch none of this.
    const signature = entries.map((entry) => (
      entry.kind === 'notice'
        ? entry.key
        : `${entry.key}:${state.attachments[entry.message.id]?.status || ''}:` +
          `${state.attachments[entry.message.id]?.progress || ''}:` +
          `${state.members[entry.message.author]?.nick || ''}`
    )).join('|')

    if (signature === this._logSignature) return
    this._logSignature = signature

    const nearBottom = this.$log.scrollHeight - this.$log.scrollTop - this.$log.clientHeight < 80
    this.$log.replaceChildren(...entries.map((entry) => this._line(entry, state)))
    // Only auto-scroll if the reader was already at the bottom; yanking them
    // away from something they scrolled back to read is worse than a missed line.
    if (nearBottom) this.$log.scrollTop = this.$log.scrollHeight
  }

  _line (entry, state) {
    const el = document.createElement('div')

    if (entry.kind === 'notice') {
      el.className = `line notice notice--${entry.notice.level}`
      el.textContent = (entry.notice.level === 'error' ? '⎿  ✗ ' : '⎿  ') + entry.notice.text
      return el
    }

    const message = entry.message
    el.className = 'line'

    if (message.type === 'system') {
      el.classList.add('meta')
      el.textContent = `⎿  ${formatSystemEvent(message, state.members)}`
      return el
    }

    if (message.type === 'nick') {
      el.classList.add('meta')
      el.textContent = `⎿  ${formatNickChange(message, entry.previousName)}`
      return el
    }

    const isSelf = message.author === state.self?.publicKey

    const time = document.createElement('span')
    time.className = 'time'
    time.textContent = formatTime(message.ts)
    el.append(time)

    if (isSelf) {
      // Your own messages echo back behind a caret, as they do in the CLI.
      el.classList.add('line--self')
      const marker = document.createElement('span')
      marker.className = 'marker'
      marker.textContent = '>'
      el.append(marker)
    } else {
      const color = `var(--author-${colorForAuthor(message.author)})`

      const marker = document.createElement('span')
      marker.className = 'marker'
      marker.style.color = color
      marker.textContent = ' '

      const who = document.createElement('span')
      who.className = 'who'
      who.style.color = color
      who.textContent = displayName(state.members[message.author], message.author)

      el.append(marker, who)
    }

    if (message.type === 'text') {
      const body = document.createElement('span')
      body.className = 'body'
      body.textContent = message.body
      el.append(body)
      return el
    }

    if (message.type === 'file') {
      el.classList.add('line--file')
      const name = document.createElement('span')
      name.className = 'file-name'
      name.textContent = `${message.name} (${formatBytes(message.size)})`
      el.append(name)
      el.append(this._attachment(message, state.attachments[message.id]))
    }

    return el
  }

  _attachment (message, attachment) {
    const wrap = document.createElement('div')
    wrap.className = 'attach'

    const status = attachment?.status

    if (status === 'downloading') {
      const bar = document.createElement('div')
      bar.className = 'bar'
      const fill = document.createElement('div')
      fill.className = 'bar-fill'
      fill.style.width = `${Math.round((attachment.progress || 0) * 100)}%`
      bar.append(fill)
      wrap.append(bar)
      return wrap
    }

    if (status === 'failed') {
      const err = document.createElement('div')
      err.className = 'attach-error'
      err.textContent = attachment.error || 'transfer failed'
      wrap.append(err)
      return wrap
    }

    if (status === 'available') {
      const hint = document.createElement('div')
      hint.className = 'attach-hint'
      hint.textContent = `over the auto-download limit — /download ${message.id.slice(0, 6)}`
      wrap.append(hint)
      return wrap
    }

    const bytes = this.client.blobFor(message.id)
    if (!bytes) {
      const hint = document.createElement('div')
      hint.className = 'attach-hint'
      hint.textContent = `not downloaded — /download ${message.id.slice(0, 6)}`
      wrap.append(hint)
      return wrap
    }

    wrap.append(this._preview(message, bytes))
    return wrap
  }

  /**
   * Show what we can, in place. The artifact sandbox blocks a page from
   * starting a download, so offering a save button here would be a button that
   * does nothing — images and text render inline instead, and anything else
   * shows the checksum that proves the bytes arrived intact.
   */
  _preview (message, bytes) {
    if (message.mime.startsWith('image/')) {
      const img = document.createElement('img')
      img.className = 'attach-image'
      img.alt = message.name
      img.src = URL.createObjectURL(new Blob([bytes], { type: message.mime }))
      return img
    }

    if (message.mime.startsWith('text/') || message.mime === 'application/json') {
      const pre = document.createElement('pre')
      pre.className = 'attach-text'
      const slice = bytes.subarray(0, MAX_PREVIEW_BYTES)
      pre.textContent = new TextDecoder().decode(slice) +
        (bytes.byteLength > MAX_PREVIEW_BYTES ? '\n…' : '')
      return pre
    }

    const note = document.createElement('div')
    note.className = 'attach-hint'
    note.textContent = `received intact · sha256 ${message.sha256.slice(0, 16)}…`
    return note
  }

  _renderMembers (state) {
    const members = memberList(state)
    this.$members.replaceChildren(...members.map((member) => {
      const li = document.createElement('li')
      const dot = document.createElement('span')
      dot.className = 'mdot'
      dot.dataset.status = member.status || 'online'

      const name = document.createElement('span')
      name.style.color = `var(--author-${colorForAuthor(member.publicKey)})`
      name.textContent = displayName(member, member.publicKey)

      li.append(dot, name)
      if (member.publicKey === state.self?.publicKey) {
        const you = document.createElement('span')
        you.className = 'you'
        you.textContent = 'you'
        li.append(you)
      }
      if (member.status === 'typing') {
        const typing = document.createElement('span')
        typing.className = 'you'
        typing.textContent = 'typing…'
        li.append(typing)
      }
      return li
    }))

    if (members.length === 0) {
      const li = document.createElement('li')
      li.className = 'empty'
      li.textContent = 'just you'
      this.$members.append(li)
    }
  }

  _renderFacts () {
    const room = this.client.room
    if (!room) return

    const facts = [
      ['room key', b4a.toString(room.roomKey, 'hex')],
      ['discovery topic', room.topicHex],
      ['encryption key', '—————— never leaves this browser ——————']
    ]

    this.$facts.replaceChildren(...facts.flatMap(([label, value]) => {
      const dt = document.createElement('dt')
      dt.textContent = label
      const dd = document.createElement('dd')
      dd.textContent = value.length > 40 ? `${value.slice(0, 16)}…${value.slice(-8)}` : value
      dd.title = value
      return [dt, dd]
    }))
  }

  focus () {
    this.$input.focus()
  }
}
