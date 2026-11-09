// Local audio via the first available command-line player.
// Pause kills the player and resume restarts it at the paused position: a process
// held with SIGSTOP for minutes can lose its CoreAudio session and exit silently.
// ffplay seeks natively; for afplay an MP3 is cut at the matching byte offset (MP3
// frames resync on their own), which is close enough for testing. Other formats
// without a seeking player stay silent until the next track.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'

const PLAYERS = [
  { cmd: 'afplay', args: (file, _from, vol) => ['-v', String(vol / 100), file], seeks: false },
  { cmd: 'ffplay', args: (file, from, vol) => ['-nodisp', '-autoexit', '-loglevel', 'quiet', '-volume', String(vol), '-ss', String(from), file], seeks: true }
]

// Byte offset of second `fromSec` in a file of `size` bytes lasting `duration` s.
export function byteOffsetFor(size, fromSec, duration) {
  if (!(duration > 0) || !(fromSec > 0)) return 0
  return Math.min(size, Math.floor((size * fromSec) / duration))
}

export function createAudioOutput({ silent = false, log = () => {} } = {}) {
  const noop = { start() {}, pause() {}, resume() {}, stop() {}, name: 'silent' }
  if (silent) return noop
  const player = PLAYERS.find((p) => spawnSync('which', [p.cmd]).status === 0)
  if (!player) {
    log('AUDIO', 'no audio player found (afplay/ffplay); running silent')
    return noop
  }
  let proc = null
  let cur = null // { file, from, volume, duration, startedAt, pausedAt }
  let sliceFile = null

  const kill = () => {
    try { proc?.kill('SIGKILL') } catch { /* already exited */ }
    proc = null
  }
  const cleanSlice = () => {
    if (sliceFile) fs.rm(sliceFile, { force: true }, () => {})
    sliceFile = null
  }
  const playableFrom = (file, fromSec, duration) => {
    if (fromSec <= 0.5 || player.seeks) return file
    if (!/\.mp3$/i.test(file) || !(duration > 0)) return null
    const buf = fs.readFileSync(file)
    cleanSlice()
    sliceFile = `${file}.from${Math.round(fromSec)}.mp3`
    fs.writeFileSync(sliceFile, buf.subarray(byteOffsetFor(buf.length, fromSec, duration)))
    return sliceFile
  }

  const out = {
    name: player.cmd,
    start(file, fromSec = 0, volume = 30, duration = 0) {
      kill()
      cur = null
      if (!file) return
      cur = { file, from: fromSec, volume, duration, startedAt: Date.now(), pausedAt: null }
      const target = playableFrom(file, fromSec, duration)
      if (!target) {
        log('AUDIO', `${player.cmd} cannot start at ${fromSec.toFixed(1)}s for this format: silent until the next track`)
        return
      }
      const p = spawn(player.cmd, player.args(target, fromSec, volume), { stdio: 'ignore' })
      p.on('error', (e) => log('AUDIO', `${player.cmd} failed: ${e.code || e.message}; use --silent`))
      p.on('exit', () => { if (proc === p) proc = null })
      proc = p
    },
    pause() {
      if (!cur || cur.pausedAt) return
      cur.pausedAt = Date.now()
      kill()
    },
    resume() {
      if (!cur?.pausedAt) return
      const at = cur.from + (cur.pausedAt - cur.startedAt) / 1000
      out.start(cur.file, at, cur.volume, cur.duration)
    },
    stop() {
      kill()
      cleanSlice()
      cur = null
    }
  }
  return out
}
