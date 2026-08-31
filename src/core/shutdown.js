// Tier 2 — leaving cleanly.
//
// Two things make an unclean exit worse than a crash. A Hypercore left open can
// leave its storage locked, so the next start complains rather than working.
// And Ink puts the terminal in raw mode with the cursor hidden — die without
// restoring it and the user is left with an invisible cursor and no echo,
// wondering what broke their shell.

const SHOW_CURSOR = `${String.fromCharCode(27)}[?25h`
const EXIT_GRACE_MS = 3000

let installed = false
const handlers = new Set()

/**
 * Register something to close on the way out. Returns a function that
 * unregisters it, so a short-lived client does not leak into the shutdown set.
 */
export function onShutdown (handler) {
  handlers.add(handler)
  install()
  return () => handlers.delete(handler)
}

/** Run every registered handler once, tolerating failures in any of them. */
export async function runShutdown () {
  const pending = [...handlers]
  handlers.clear()

  await Promise.all(pending.map(async (handler) => {
    try {
      await handler()
    } catch {
      // Nothing useful to do while exiting, and one stuck core must not stop
      // the rest from closing.
    }
  }))
}

export function restoreTerminal () {
  try {
    if (process.stdout.isTTY) process.stdout.write(SHOW_CURSOR)
    if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(false)
  } catch {
    /* the stream is already gone */
  }
}

function reportCrash (problem) {
  restoreTerminal()
  console.error(`\nopenchat hit an unexpected error and stopped:\n  ${problem?.message || problem}`)
  if (process.env.OPENCHAT_DEBUG) console.error(problem)
  else console.error('\nRun with OPENCHAT_DEBUG=1 for the full stack trace.')
  process.exit(1)
}

function install () {
  if (installed) return
  installed = true

  let exiting = false

  const leave = async (code) => {
    if (exiting) {
      // A second ctrl+c means "I am not waiting for you".
      restoreTerminal()
      process.exit(code)
    }
    exiting = true

    // Closing cores talks to disk and to peers, either of which can hang. Give
    // it a moment, then go anyway rather than trapping someone in their shell.
    const timer = setTimeout(() => {
      restoreTerminal()
      process.exit(code)
    }, EXIT_GRACE_MS)
    timer.unref?.()

    await runShutdown()
    restoreTerminal()
    process.exit(code)
  }

  process.on('SIGINT', () => { leave(0) })
  process.on('SIGTERM', () => { leave(0) })

  process.on('uncaughtException', reportCrash)
  process.on('unhandledRejection', reportCrash)
}
