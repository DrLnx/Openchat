// Module-loader hook so `node --test` can import the Ink components straight
// from source. The shipped CLI is bundled by esbuild ahead of time; this is the
// same transform, applied on the fly, so tests exercise the real files rather
// than a build artifact.

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { transform } from 'esbuild'

export async function load (url, context, nextLoad) {
  if (!url.endsWith('.jsx')) return nextLoad(url, context)

  const source = await readFile(fileURLToPath(url), 'utf8')
  const { code } = await transform(source, {
    loader: 'jsx',
    jsx: 'automatic',
    jsxImportSource: 'react',
    format: 'esm',
    target: 'node22',
    sourcefile: fileURLToPath(url)
  })

  return { format: 'module', source: code, shortCircuit: true }
}
