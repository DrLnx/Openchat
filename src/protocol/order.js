// Tier 1 — portable. The one ordering rule the whole app agrees on.
//
// Autobase does the hard part in the CLI: it linearizes the writers' DAG into a
// causally consistent sequence. What it cannot do is decide how concurrent
// messages — ones neither of which saw the other — should be *displayed*, and
// that answer has to match everywhere or two members reading the same room see
// different transcripts.
//
// So every message set goes through `linearize()` before rendering: Lamport
// clock ascending, then wall-clock, then author key, then id. The last two are
// arbitrary but total and stable, which is the whole point — given the same set
// of messages, every client produces the same list, in any arrival order.

/**
 * Total order over messages. Returns <0, 0, or >0.
 */
export function compareMessages (a, b) {
  if (a.clock !== b.clock) return a.clock - b.clock
  if (a.ts !== b.ts) return a.ts - b.ts
  if (a.author !== b.author) return a.author < b.author ? -1 : 1
  if (a.id !== b.id) return a.id < b.id ? -1 : 1
  return 0
}

/**
 * Deduplicate by message id and sort into the canonical display order.
 * Pure: never mutates the input.
 */
export function linearize (messages) {
  const seen = new Map()
  for (const m of messages) {
    if (!seen.has(m.id)) seen.set(m.id, m)
  }
  return [...seen.values()].sort(compareMessages)
}

/**
 * The Lamport clock to stamp on the next locally-authored message: one past the
 * highest clock this client has observed. Concurrent authors can land on the
 * same value, which is exactly what the tiebreak in `compareMessages` is for.
 */
export function nextClock (messages) {
  let max = 0
  for (const m of messages) {
    if (m.clock > max) max = m.clock
  }
  return max + 1
}

/**
 * Merge newly arrived messages into an already-ordered list.
 * Returns a new array; `existing` is left alone.
 */
export function merge (existing, incoming) {
  const additions = Array.isArray(incoming) ? incoming : [incoming]
  return linearize([...existing, ...additions])
}
