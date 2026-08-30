// Builds the browser harness into a single self-contained HTML file.
//
// It has to be one file: the artifact host's CSP only allows scripts from a
// short list of CDNs, so a <script src="./bundle.js"> of our own would be
// blocked silently. Everything gets inlined instead.

import { build } from 'esbuild'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(root, 'web/openchat-demo.html')

const result = await build({
  entryPoints: [path.join(root, 'web/main.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  write: false,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' }
})

const bundle = result.outputFiles[0].text
const template = await readFile(path.join(root, 'web/index.html'), 'utf8')

let transcript = '{"frames":[]}'
try {
  transcript = await readFile(path.join(root, 'web/demo/transcript.json'), 'utf8')
} catch {
  console.warn('no recording found — run `npm run record` first')
}

const html = template
  // A literal "</script>" inside JSON would close the tag early.
  .replace('__TRANSCRIPT__', () => transcript.replace(/<\//g, '<\\/'))
  .replace('__BUNDLE__', () => bundle)

await mkdir(path.dirname(OUT), { recursive: true })
await writeFile(OUT, html)

const kb = (Buffer.byteLength(html) / 1024).toFixed(0)
console.log(`web harness -> ${path.relative(root, OUT)} (${kb}kb)`)
