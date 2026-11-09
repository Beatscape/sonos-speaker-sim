// Fetches the stream URL a controller hands us (this is what proves the controller's
// media server is reachable from the LAN) and works out the track duration.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const short = (u) => {
  const s = String(u).replace(/^https?:\/\//, '')
  return s.length > 64 ? `${s.slice(0, 24)}...${s.slice(-36)}` : s
}

// Duration of a media file via afinfo (macOS) or ffprobe; null when neither is available.
export function probeDuration(file) {
  const a = spawnSync('afinfo', [file], { encoding: 'utf8' })
  const m = a.status === 0 ? /estimated duration:\s*([\d.]+)/i.exec(a.stdout) : null
  if (m) return Number(m[1])
  const f = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' })
  const n = f.status === 0 ? Number(f.stdout.trim()) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

export const estimateDuration = (bytes, kbps = 128) => Math.max(1, (bytes * 8) / (kbps * 1000))

// silent: nothing is written to disk and duration comes from --fake-duration or file size.
export function createMedia({ silent = false, fakeDuration = null, log = () => {}, fetchImpl = fetch, probe = probeDuration, timeoutMs = 30000 } = {}) {
  const cache = new Map()
  const files = new Set()

  async function fetchTrack(uri) {
    const t0 = Date.now()
    let res
    try {
      res = await fetchImpl(uri, { signal: AbortSignal.timeout(timeoutMs) })
    } catch (e) {
      const cause = e?.cause?.code || e?.cause?.message || e.message
      log('FETCH-ERR', `COULD NOT FETCH ${short(uri)} -> ${cause} (is the controller's media server reachable from this machine?)`, { uri, error: String(cause) })
      throw e
    }
    if (!res.ok) {
      log('FETCH-ERR', `HTTP ${res.status} fetching ${short(uri)}`, { uri, status: res.status })
      throw new Error(`HTTP ${res.status}`)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    let file
    let duration = null
    if (!silent) {
      const ext = (path.extname(new URL(uri).pathname) || '.bin').slice(0, 6)
      file = path.join(os.tmpdir(), `sonos-sim-${process.pid}-${crypto.createHash('md5').update(uri).digest('hex').slice(0, 10)}${ext}`)
      fs.writeFileSync(file, buf)
      files.add(file)
      duration = probe(file)
    }
    if (fakeDuration !== null) duration = fakeDuration
    if (duration === null) duration = silent ? estimateDuration(buf.length) : 180
    log('FETCH', `HTTP ${res.status} ${buf.length} bytes in ${Date.now() - t0}ms, duration=${duration.toFixed(1)}s ${short(uri)}`, { uri, status: res.status, bytes: buf.length, duration })
    return { file, duration, bytes: buf.length }
  }

  return {
    load(uri) {
      if (!cache.has(uri)) {
        const p = fetchTrack(uri)
        p.catch(() => cache.delete(uri))
        cache.set(uri, p)
        while (cache.size > 4) cache.delete(cache.keys().next().value)
      }
      return cache.get(uri)
    },
    clear() {
      cache.clear()
      for (const f of files) {
        try { fs.unlinkSync(f) } catch { /* already gone */ }
      }
      files.clear()
    }
  }
}
