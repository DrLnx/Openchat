// Builds the CLI. esbuild bundles our own sources (so JSX is transpiled and
// internal .jsx imports resolve) while leaving everything in node_modules
// external — native addons like sodium-native must be loaded by Node itself,
// not inlined.

import { build, context } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const watch = process.argv.includes('--watch')

const options = {
  entryPoints: [path.join(root, 'src/cli.js')],
  outfile: path.join(root, 'dist/cli.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  jsx: 'automatic',
  jsxImportSource: 'react',
  sourcemap: true,
  logLevel: 'info',
  // Baked in at build time: the bundle has no reliable way to find its own
  // package.json once it is installed globally or into /usr/lib.
  define: { __OPENCHAT_VERSION__: JSON.stringify(version) }
}

if (watch) {
  const ctx = await context(options)
  await ctx.watch()
  console.log('watching for changes…')
} else {
  await build(options)
}
