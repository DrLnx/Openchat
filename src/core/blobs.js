// Tier 2 — attachments.
//
// A file never travels inside a message. The sender writes it into a Hyperblobs
// core they own and sends metadata only; receivers fetch the bytes from that
// core on demand. That keeps the chat log small, lets a 2GB video sit in a room
// nobody downloads, and means a member who joins later can still pull an old
// attachment as long as someone who has it is online.
//
// The blobs core is encrypted with the room key like everything else, so the
// bytes are unreadable to a peer who has the topic but not the invite.

import { EventEmitter } from 'node:events'
import { createReadStream, createWriteStream } from 'node:fs'
import { stat, mkdir } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import Hyperblobs from 'hyperblobs'
import b4a from 'b4a'

import { DEFAULT_AUTO_DOWNLOAD_BYTES } from '../protocol/constants.js'

// Extension -> mime, for the handful worth naming. Everything else is opaque
// bytes and the receiver can figure it out.
const MIME_BY_EXT = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.log': 'text/plain',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg'
}

export function mimeFor (filename) {
  return MIME_BY_EXT[path.extname(filename).toLowerCase()] || 'application/octet-stream'
}

export class Blobs extends EventEmitter {
  /**
   * @param {object} opts
   * @param {import('corestore')} opts.store  the room's namespaced store
   * @param {Uint8Array} opts.encryptionKey
   * @param {string} opts.downloadDir         where fetched files land
   * @param {number} [opts.autoDownloadBytes]
   */
  constructor ({ store, encryptionKey, downloadDir, autoDownloadBytes = DEFAULT_AUTO_DOWNLOAD_BYTES }) {
    super()
    this.store = store
    this.encryptionKey = encryptionKey
    this.downloadDir = downloadDir
    this.autoDownloadBytes = autoDownloadBytes

    this._local = null
    this._remote = new Map() // core key hex -> Hyperblobs
  }

  /** Our own blobs core — created lazily, since most sessions send no files. */
  async local () {
    if (!this._local) {
      const core = this.store.get({ name: 'blobs', encryptionKey: this.encryptionKey })
      await core.ready()
      this._local = new Hyperblobs(core)
    }
    return this._local
  }

  async localKey () {
    const blobs = await this.local()
    return blobs.core.key
  }

  /**
   * Read a file from disk into our blobs core.
   * @returns {Promise<object>} the metadata to put in a `file` message
   */
  async put (filePath) {
    const info = await stat(filePath)
    if (!info.isFile()) throw new Error(`not a file: ${filePath}`)

    const blobs = await this.local()
    const name = path.basename(filePath)

    // Hash and store in one pass over the file, so a large attachment is never
    // held in memory in its entirety.
    const hash = createHash('sha256')
    const writeStream = blobs.createWriteStream()
    const source = createReadStream(filePath)
    source.on('data', (chunk) => hash.update(chunk))

    await pipeline(source, writeStream)

    return {
      name,
      size: info.size,
      mime: mimeFor(name),
      sha256: hash.digest('hex'),
      blobCoreKey: b4a.toString(blobs.core.key, 'hex'),
      blobId: writeStream.id
    }
  }

  /** True if a file this size should be fetched without being asked. */
  shouldAutoDownload (size) {
    return size <= this.autoDownloadBytes
  }

  async _blobsFor (coreKeyHex) {
    let blobs = this._remote.get(coreKeyHex)
    if (blobs) return blobs

    const localKey = this._local && b4a.toString(this._local.core.key, 'hex')
    if (localKey === coreKeyHex) return this._local

    const core = this.store.get({
      key: b4a.from(coreKeyHex, 'hex'),
      encryptionKey: this.encryptionKey
    })
    await core.ready()
    blobs = new Hyperblobs(core)
    this._remote.set(coreKeyHex, blobs)
    return blobs
  }

  /**
   * Fetch an attachment and write it to the download directory.
   *
   * Progress is reported per block as it arrives — the numbers the UI's bar is
   * drawn from are real fetch progress, not a timer.
   *
   * @param {object} message a `file` message
   * @returns {Promise<{ path: string, sha256: string, verified: boolean }>}
   */
  async get (message, { signal } = {}) {
    const blobs = await this._blobsFor(message.blobCoreKey)
    await mkdir(this.downloadDir, { recursive: true })

    const target = await uniquePath(path.join(this.downloadDir, safeName(message.name)))
    const hash = createHash('sha256')

    let received = 0
    const total = message.size || message.blobId.byteLength

    this.emit('progress', { id: message.id, received: 0, total, progress: 0 })

    const source = blobs.createReadStream(message.blobId)
    source.on('data', (chunk) => {
      hash.update(chunk)
      received += chunk.byteLength
      this.emit('progress', {
        id: message.id,
        received,
        total,
        progress: total ? Math.min(received / total, 1) : 0
      })
    })

    if (signal) signal.addEventListener('abort', () => source.destroy(new Error('cancelled')), { once: true })

    await pipeline(source, createWriteStream(target))

    // The sender's claimed hash is worth checking: it is the one thing that
    // proves the bytes we reassembled are the bytes they sent.
    const digest = hash.digest('hex')
    const verified = digest === message.sha256

    this.emit('done', { id: message.id, path: target, verified })
    return { path: target, sha256: digest, verified }
  }

  async close () {
    if (this._local) await this._local.core.close()
    for (const blobs of this._remote.values()) await blobs.core.close()
    this._remote.clear()
  }
}

function safeName (name) {
  // A filename arrives from another member; never let it escape the download
  // directory or hide as a dotfile.
  const base = path.basename(name).replace(/[/\\]/g, '_')
  return base.startsWith('.') ? `_${base}` : base || 'attachment'
}

async function uniquePath (candidate) {
  const { dir, name, ext } = path.parse(candidate)
  let attempt = candidate
  let n = 1
  while (await exists(attempt)) attempt = path.join(dir, `${name} (${n++})${ext}`)
  return attempt
}

async function exists (p) {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}
