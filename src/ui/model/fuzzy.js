// Tier 1 — portable fuzzy matching, the engine behind every picker.
//
// Scoring follows fzf's shape rather than a plain substring test: a query is a
// subsequence of the target, and what separates a good match from a bad one is
// *where* the characters landed. "dsg" should rank #design above #wds-logging
// even though both contain the letters in order, because in the first the
// match starts on a word boundary and runs almost consecutively.
//
// No rendering here — a match returns the positions it matched, and each
// renderer decides how to highlight them.

const MATCH = 16
const BOUNDARY = 10
const CAMEL = 8
const CONSECUTIVE = 8
const GAP_START = -5
const GAP_EXTEND = -1
const FIRST_CHAR_MULTIPLIER = 2

// Past this the quadratic pass is not worth it, and nothing we search — room
// names, nicks, keys, command help — is anywhere near it.
const MAX_TARGET = 256

const SEPARATOR = /[\s\-_./\\:@#[\]()]/

/**
 * Score one query against one target.
 *
 * Smart case, the way every editor does it: an all-lowercase query is case
 * insensitive, a query with any capital in it is not.
 *
 * @param {string} query
 * @param {string} target
 * @returns {{ score: number, positions: number[] } | null} null when the query
 *   is not a subsequence of the target at all
 */
export function score (query, target) {
  const q = String(query ?? '')
  const t = String(target ?? '')

  if (q === '') return { score: 0, positions: [] }
  if (t === '') return null

  const sensitive = q !== q.toLowerCase()
  const needle = sensitive ? q : q.toLowerCase()
  const hay = sensitive ? t : t.toLowerCase()

  if (hay.length > MAX_TARGET) return greedy(needle, hay, t)

  const n = needle.length
  const m = hay.length
  if (n > m) return null

  // best[i][j]: the best score for placing query[i] exactly at target[j].
  // from[i][j]: which j the previous query character sat at, so the winning
  // path can be walked back into a list of highlight positions.
  const best = new Float64Array(n * m).fill(-Infinity)
  const from = new Int32Array(n * m).fill(-1)
  const bonuses = new Float64Array(m)
  for (let j = 0; j < m; j++) bonuses[j] = bonusAt(t, hay, j)

  for (let i = 0; i < n; i++) {
    // Running best over every column to the left, so the inner loop stays
    // linear instead of rescanning the row for each candidate.
    let leftBest = -Infinity
    let leftAt = -1
    let leftJ = -1

    for (let j = 0; j < m; j++) {
      if (i > 0 && j > 0) {
        const previous = best[(i - 1) * m + (j - 1)]
        if (previous > -Infinity) {
          // Score of jumping here from column j-1, before this column's own
          // gap penalty is applied below.
          const candidate = previous
          if (candidate > leftBest + GAP_EXTEND) {
            leftBest = candidate
            leftAt = j - 1
            leftJ = j - 1
          } else {
            leftBest += GAP_EXTEND
          }
        } else if (leftBest > -Infinity) {
          leftBest += GAP_EXTEND
        }
      }

      if (needle[i] !== hay[j]) continue

      const base = MATCH + bonuses[j]
      const at = i * m + j

      if (i === 0) {
        // Where a match *starts* says the most about whether it is the one you
        // meant, so the first character's boundary bonus counts double — that
        // is what puts "design" above "wds-logging" for the query "dsg". A
        // match further into the string is worth slightly less again, which
        // breaks ties towards a prefix.
        best[at] = base + bonuses[j] * (FIRST_CHAR_MULTIPLIER - 1) + j * GAP_EXTEND
        from[at] = -1
        continue
      }

      const adjacent = best[(i - 1) * m + (j - 1)]
      let value = -Infinity
      let parent = -1

      if (j > 0 && adjacent > -Infinity) {
        value = adjacent + base + CONSECUTIVE
        parent = j - 1
      }

      if (leftBest > -Infinity && leftAt !== j - 1) {
        const gapped = leftBest + base + GAP_START
        if (gapped > value) {
          value = gapped
          parent = leftJ
        }
      }

      if (value === -Infinity) continue
      best[at] = value
      from[at] = parent
    }
  }

  let total = -Infinity
  let end = -1
  for (let j = 0; j < m; j++) {
    const value = best[(n - 1) * m + j]
    if (value > total) {
      total = value
      end = j
    }
  }

  if (end === -1) return null

  const positions = new Array(n)
  let j = end
  for (let i = n - 1; i >= 0; i--) {
    positions[i] = j
    j = from[i * m + j]
  }

  return { score: total, positions }
}

/** Last-resort match for absurdly long targets: left-to-right, no scoring. */
function greedy (needle, hay, original) {
  const positions = []
  let j = 0
  for (let i = 0; i < needle.length; i++) {
    j = hay.indexOf(needle[i], j)
    if (j === -1) return null
    positions.push(j)
    j++
  }
  return { score: MATCH * needle.length - positions[0], positions }
}

function bonusAt (original, lowered, j) {
  if (j === 0) return BOUNDARY
  const previous = original[j - 1]
  const current = original[j]
  if (SEPARATOR.test(previous)) return BOUNDARY
  if (isLower(previous) && isUpper(current)) return CAMEL
  if (!isDigit(previous) && isDigit(current)) return CAMEL
  return 0
}

function isLower (ch) {
  return ch !== ch.toUpperCase() && ch === ch.toLowerCase()
}

function isUpper (ch) {
  return ch !== ch.toLowerCase() && ch === ch.toUpperCase()
}

function isDigit (ch) {
  return ch >= '0' && ch <= '9'
}

/**
 * Rank a list. Every item is scored against one or more haystacks; the best
 * field wins, and the field that won is reported so the renderer knows which
 * string the highlight positions belong to.
 *
 * A field can say how it wants to be matched. That matters more than it
 * sounds: a public key is 64 hex characters, and *any* short query is a
 * subsequence of one, so fuzzy-matching keys would make every picker return
 * every row. Keys are matched as a prefix — which is how people actually search
 * for one, by pasting the front of it — and secondary labels as a substring.
 *
 * @param {any[]} items
 * @param {string} query
 * @param {object} [options]
 * @param {(item: any) => Field | Field[]} [options.key] what to match against
 * @param {number} [options.limit]
 * @returns {{ item: any, score: number, positions: number[], field: number }[]}
 *
 * @typedef {string | { text: string, match?: 'fuzzy'|'prefix'|'substring' }} Field
 */
export function rank (items, query, { key = String, limit = Infinity } = {}) {
  const q = String(query ?? '').trim()
  const list = []

  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    const fields = toFields(key(item))

    if (q === '') {
      list.push({ item, score: 0, positions: [], field: 0, index })
      continue
    }

    let bestField = -1
    let bestScore = -Infinity
    let bestPositions = null

    for (let f = 0; f < fields.length; f++) {
      const result = matchField(q, fields[f])
      if (!result) continue
      // Later fields are secondary — a hit on the name beats a hit on the key.
      const adjusted = result.score - f * 6
      if (adjusted > bestScore) {
        bestScore = adjusted
        bestField = f
        bestPositions = result.positions
      }
    }

    if (bestField === -1) continue
    list.push({ item, score: bestScore, positions: bestPositions, field: bestField, index })
  }

  if (q !== '') list.sort((a, b) => b.score - a.score || a.index - b.index)

  return (limit === Infinity ? list : list.slice(0, limit))
    .map(({ index, ...rest }) => rest)
}

function toFields (value) {
  const list = Array.isArray(value) ? value : [value]
  return list.map((field) => (
    field && typeof field === 'object'
      ? { text: String(field.text ?? ''), match: field.match || 'fuzzy' }
      : { text: String(field ?? ''), match: 'fuzzy' }
  ))
}

/** One field, matched the way that field asked to be matched. */
function matchField (query, field) {
  if (field.match === 'fuzzy') return score(query, field.text)

  const haystack = query === query.toLowerCase() ? field.text.toLowerCase() : field.text
  const at = field.match === 'prefix'
    ? (haystack.startsWith(query) ? 0 : -1)
    : haystack.indexOf(query)

  if (at === -1) return null

  const positions = []
  for (let i = 0; i < query.length; i++) positions.push(at + i)
  return { score: MATCH * query.length + (at === 0 ? BOUNDARY : 0) - at, positions }
}

/**
 * Split a string into runs of matched and unmatched text, ready to hand to a
 * renderer that wants to colour the matched characters.
 *
 * @returns {{ text: string, match: boolean }[]}
 */
export function segments (text, positions = []) {
  const source = String(text ?? '')
  if (positions.length === 0) return source ? [{ text: source, match: false }] : []

  const hit = new Set(positions)
  const out = []
  let run = ''
  let runMatch = hit.has(0)

  for (let i = 0; i < source.length; i++) {
    const match = hit.has(i)
    if (match !== runMatch) {
      if (run) out.push({ text: run, match: runMatch })
      run = ''
      runMatch = match
    }
    run += source[i]
  }
  if (run) out.push({ text: run, match: runMatch })
  return out
}
