// Copying out of a full-screen terminal app, without a helper binary.
//
// A key is a thing you paste somewhere else, so "look at it" is only half of
// what a window showing one is for. Selecting it with the mouse is not an
// option here: the app owns the alternate screen and, while a float is open,
// mouse reporting, so a drag never reaches the terminal's own selection.
//
// OSC 52 asks the *terminal* to put something on the system clipboard. That is
// the only mechanism that also works over ssh, because there is no clipboard on
// the machine the process is running on — the clipboard is wherever the human
// is, which is the far end of the connection.

const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)

/**
 * Put text on the clipboard of whatever terminal is displaying us.
 *
 * Silent by design: a terminal that refuses OSC 52 (most allow it, some ship
 * with it off) says nothing back, and there is no reply to wait for.
 *
 * @param {string} text
 * @param {NodeJS.WriteStream} [stream]
 */
export function copy (text, stream = process.stdout) {
  const payload = Buffer.from(String(text ?? ''), 'utf8').toString('base64')
  const sequence = `${ESC}]52;c;${payload}${BEL}`

  // tmux eats an escape sequence it does not understand unless it is wrapped in
  // a passthrough, and screen has the same rule with a shorter wrapper.
  const term = process.env.TERM || ''
  const wrapped = process.env.TMUX || term.startsWith('tmux')
    ? `${ESC}Ptmux;${ESC}${sequence}${ESC}\\`
    : term.startsWith('screen')
      ? `${ESC}P${sequence}${ESC}\\`
      : sequence

  try {
    stream.write(wrapped)
    return true
  } catch {
    return false
  }
}
