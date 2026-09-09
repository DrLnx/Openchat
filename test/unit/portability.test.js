// Tier 1 is the part of openchat you can read, test and reason about without a
// DHT, a swarm or a terminal: the wire format, the ordering rule, the
// view-model, the keymap. That property only holds while it stays free of Node
// builtins, native modules and anything from the runtime tier, and one absent
// `import fs` is easy to lose track of. So it is a test rather than a
// convention, and the failure says exactly which import broke it.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// Pure-JS packages with no native code and no Node builtins behind them.
const ALLOWED_PACKAGES = new Set([
  'b4a',
  'compact-encoding',
  '@noble/ed25519',
  '@noble/hashes'
])

const TIER_ONE_DIRS = ['src/protocol', 'src/ui/model']

async function jsFiles (dir) {
  const out = []
  let entries
  try {
    entries = await readdir(path.join(root, dir), { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') return out
    throw err
  }
  for (const entry of entries) {
    const rel = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await jsFiles(rel)))
    else if (/\.jsx?$/.test(entry.name)) out.push(rel)
  }
  return out
}

test('tier-1 modules import nothing from the runtime tier', async () => {
  const offenders = []

  for (const dir of TIER_ONE_DIRS) {
    for (const rel of await jsFiles(dir)) {
      const source = await readFile(path.join(root, rel), 'utf8')
      for (const specifier of importsOf(source)) {
        if (specifier.startsWith('.')) {
          if (specifier.includes('/core/')) offenders.push(`${rel} -> ${specifier} (tier 2)`)
          continue
        }
        if (specifier.startsWith('node:')) {
          offenders.push(`${rel} -> ${specifier} (node builtin)`)
          continue
        }
        const pkg = packageName(specifier)
        if (!ALLOWED_PACKAGES.has(pkg)) offenders.push(`${rel} -> ${specifier} (not a portable package)`)
      }
    }
  }

  assert.deepEqual(offenders, [], `tier-1 portability broken:\n  ${offenders.join('\n  ')}`)
})

test('tier-1 directories actually contain the modules we think they do', async () => {
  // Guards against the test above passing vacuously if a directory is renamed.
  const found = (await Promise.all(TIER_ONE_DIRS.map(jsFiles))).flat()
  assert.ok(found.length >= 5, `expected tier-1 sources, found ${found.length}`)
  assert.ok(found.some((f) => f.endsWith('envelope.js')))
  assert.ok(found.some((f) => f.endsWith('commands.js')))
})

function importsOf (source) {
  const specifiers = []
  const re = /(?:^|\n)\s*import\s[^'"]*['"]([^'"]+)['"]|(?:^|\n)\s*export\s+[^'"]*from\s*['"]([^'"]+)['"]/g
  let match
  while ((match = re.exec(source)) !== null) specifiers.push(match[1] || match[2])
  return specifiers
}

function packageName (specifier) {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}
