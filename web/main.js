// Entry point for the browser harness.

import { loadIdentity } from './identity.js'
import { BrowserClient } from './client.js'
import { SimulatedMembers } from './sim.js'
import { Terminal } from './render.js'

async function boot () {
  const mount = document.querySelector('#terminal')
  const identity = await loadIdentity()

  const client = new BrowserClient({ identity })
  await client.ready()

  const sim = await new SimulatedMembers(client).ready()
  const terminal = new Terminal({ client, sim, root: mount })

  sim.setActive(client.isHost)

  wireInvitePanel(client)

  // Announce ourselves so other tabs list us as a member.
  await client.setNick(identity.nick)
  await client.sendPresence('online')

  window.addEventListener('beforeunload', () => client.transport?.close())

  // Focus only on a pointer device; on a phone this would throw the keyboard up
  // over the transcript before the reader has seen anything.
  if (window.matchMedia('(hover: hover)').matches) terminal.focus()
}

function wireInvitePanel (client) {
  const field = document.querySelector('#invite-string')
  const copy = document.querySelector('#invite-copy')
  const open = document.querySelector('#invite-open')

  const invite = client.invite
  field.textContent = invite

  copy?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(invite)
      flash(copy, 'Copied')
    } catch {
      // Clipboard access can be refused; select the text so it can be copied
      // by hand rather than leaving the button apparently broken.
      selectText(field)
      flash(copy, 'Select and copy')
    }
  })

  open?.addEventListener('click', () => {
    window.open(window.location.href, '_blank', 'noopener')
  })
}

function flash (button, message) {
  const original = button.dataset.label || button.textContent
  button.dataset.label = original
  button.textContent = message
  setTimeout(() => { button.textContent = original }, 1600)
}

function selectText (node) {
  const range = document.createRange()
  range.selectNodeContents(node)
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
}

boot().catch((err) => {
  const mount = document.querySelector('#terminal')
  mount.innerHTML = `<div class="boot-error">
    <strong>The demo could not start.</strong>
    <p>${escapeHtml(err.message)}</p>
  </div>`
})

function escapeHtml (value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}
