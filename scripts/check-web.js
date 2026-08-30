// Drives the built harness in a real browser: boots it, types into it, opens a
// second tab and checks a message crosses between them. Run after
// `npm run build:web`.
//
//   node scripts/check-web.js [--shot out.png]

import { chromium } from 'playwright'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const url = pathToFileURL(path.join(root, 'web/openchat-demo.html')).href

const shotIndex = process.argv.indexOf('--shot')
const shotPath = shotIndex === -1 ? null : process.argv[shotIndex + 1]

const failures = []
const check = (ok, label) => {
  console.log(`${ok ? '  ok' : 'FAIL'}  ${label}`)
  if (!ok) failures.push(label)
}

// The container ships a pinned Chromium that may not match this playwright
// build's expected revision, so point at it explicitly rather than letting
// playwright look for a download it was told not to make.
const EXECUTABLE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const browser = await chromium.launch(
  existsSync(EXECUTABLE) ? { executablePath: EXECUTABLE } : {}
)
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })

const errors = []
const failedRequests = []
const page = await context.newPage()
page.on('pageerror', (err) => errors.push(err.message))
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
page.on('requestfailed', (req) => failedRequests.push(req.url()))

await page.goto(url)
await page.waitForSelector('.term', { timeout: 15000 })

// The simulated members introduce themselves; that only happens if envelopes
// sealed by their keys were decrypted and verified by the client.
await page.waitForFunction(
  () => document.querySelectorAll('.log .line').length >= 3,
  null,
  { timeout: 15000 }
)
check(true, 'boots and receives messages from the simulated members')

const memberNames = await page.$$eval('.members li', (els) => els.map((e) => e.textContent))
check(memberNames.some((n) => n.includes('ada')), 'member list picks up nicks from the transcript')
check(memberNames.some((n) => n.includes('you')), 'you appear in your own member list')

const invite = await page.textContent('#invite-string')
check(/^openchat1:/.test(invite.trim()), 'a real invite string is rendered')

// Send a message and get a reply — the full round trip through seal/open.
await page.fill('.input', 'does this actually work?')
await page.press('.input', 'Enter')
await page.waitForFunction(
  () => [...document.querySelectorAll('.log .line')].some((l) => l.textContent.includes('does this actually work?')),
  null,
  { timeout: 10000 }
)
check(true, 'a typed message is sealed, sent and rendered')

const before = await page.$$eval('.log .line', (els) => els.length)
await page.waitForFunction(
  (n) => document.querySelectorAll('.log .line').length > n,
  before,
  { timeout: 15000 }
)
check(true, 'a simulated member replies')

// Slash commands.
await page.fill('.input', '/help')
await page.press('.input', 'Enter')
await page.waitForFunction(
  () => document.body.textContent.includes('join a room from an invite string'),
  null,
  { timeout: 8000 }
)
check(true, '/help runs through the shared parser')

await page.fill('.input', '/nope')
await page.press('.input', 'Enter')
await page.waitForFunction(
  () => document.body.textContent.includes('unknown command'),
  null,
  { timeout: 8000 }
)
check(true, 'an unknown command reports an error')

// Second tab: a genuinely separate client sharing the room key.
const second = await context.newPage()
second.on('pageerror', (err) => errors.push(`tab2: ${err.message}`))
await second.goto(url)
await second.waitForSelector('.term')
await second.waitForFunction(
  () => document.querySelectorAll('.log .line').length > 0,
  null,
  { timeout: 15000 }
)
check(true, 'a second tab back-fills the room history')

await second.fill('.input', 'hello from the other tab')
await second.press('.input', 'Enter')
await page.waitForFunction(
  () => [...document.querySelectorAll('.log .line')].some((l) => l.textContent.includes('hello from the other tab')),
  null,
  { timeout: 15000 }
)
check(true, 'a message crosses between two real clients')

// The recorded CLI transcript.
const replay = await page.textContent('#replay-pre')
check(replay.includes('#design'), 'the recorded CLI frames are embedded')
await page.click('#replay-next')
const after = await page.textContent('#replay-pre')
check(after !== replay, 'stepping through the recording works')

// No horizontal overflow at phone width.
const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth)
check(overflow <= 1, `page does not scroll sideways at 390px (overflow ${overflow}px)`)

if (shotPath) {
  await page.screenshot({ path: shotPath, fullPage: true })
  console.log(`\nscreenshot -> ${shotPath}`)
}

// This sandbox has no egress, so the Google Fonts stylesheet cannot load here.
// That host is on the artifact CSP allowlist and the page declares real fallback
// stacks either way, so only a failure of something else is a problem.
const ownFailures = failedRequests.filter((u) => !u.includes('fonts.googleapis.com') && !u.includes('fonts.gstatic.com'))
const realErrors = errors.filter((e) => !e.includes('ERR_CONNECTION_RESET') && !e.includes('Failed to load resource'))

check(ownFailures.length === 0, `no failed requests of our own${ownFailures.length ? ': ' + ownFailures.join(' | ') : ''}`)
check(realErrors.length === 0, `no console or page errors${realErrors.length ? ': ' + realErrors.join(' | ') : ''}`)
if (failedRequests.length) console.log(`  (note: ${failedRequests.length} font request(s) blocked by this sandbox)`)

await browser.close()

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed')
process.exit(failures.length ? 1 : 0)
