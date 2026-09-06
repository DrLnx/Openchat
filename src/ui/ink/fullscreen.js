// The terminal's alternate screen.
//
// openchat paints a frame the size of the window, so it runs where a full
// screen program belongs: on the alternate buffer, the one `less` and `vim`
// use. Your shell's scrollback is left exactly as it was, and when openchat
// exits the terminal comes back with your prompt where you left it rather than
// with a chat log printed over the top of it.
//
// The trade is real and worth naming: while the app is open, your terminal's
// own scrollbar and mouse selection do not reach the conversation. That is what
// the transcript's own scrolling is for — see the `scroll` bindings in
// ui/model/keymap.js.

const ESC = '\u001b'

/** Switch to the alternate buffer, put the cursor home, and clear it. */
const ENTER = `${ESC}[?1049h${ESC}[H${ESC}[2J`

/** Switch back, which restores whatever was on the screen before. */
const LEAVE = `${ESC}[?1049l`

/**
 * @param {NodeJS.WriteStream} [stdout]
 * @returns {() => void} puts the terminal back; safe to call more than once
 */
export function enterFullscreen (stdout = process.stdout) {
  if (!stdout || !stdout.isTTY) return () => {}

  stdout.write(ENTER)
  let left = false

  const leave = () => {
    if (left) return
    left = true
    stdout.write(LEAVE)
  }

  // The app exits through several doors — /quit calls process.exit, ctrl-c
  // raises SIGINT, a closed terminal raises SIGHUP — and a terminal left on the
  // alternate buffer is one you have to reset by hand. `exit` fires for all of
  // them, so that is where the restore goes.
  process.once('exit', leave)

  return leave
}
