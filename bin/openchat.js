#!/usr/bin/env node
// Thin shim. The real entry point is bundled to dist/cli.js so the Ink JSX is
// transpiled ahead of time and a global install has nothing to compile.

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const entry = path.join(root, 'dist/cli.js')

if (!existsSync(entry)) {
  console.error('openchat: build output missing — run `npm run build` first.')
  process.exit(1)
}

await import(entry)
