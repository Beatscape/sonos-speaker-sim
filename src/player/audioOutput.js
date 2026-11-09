// Local audio via the first available command-line player. Pause/resume use
// SIGSTOP/SIGCONT. Only ffplay can start at an offset; with afplay a seek moves the
// simulated clock but audio keeps its own position (documented limitation).
import { spawn, spawnSync } from 'node:child_process'

const PLAYERS = [
  { cmd: 'afplay', args: (file, _from, vol) => ['-v', String(vol / 100), file], seeks: false },
  { cmd: 'ffplay', args: (file, from, vol) => ['-nodisp', '-autoexit', '-loglevel', 'quiet', '-volume', String(vol), '-ss', String(from), file], seeks: true }
]

export function createAudioOutput({ silent = false, log = () => {} } = {}) {
  const noop = { start() {}, pause() {}, resume() {}, stop() {}, name: 'silent' }
  if (silent) return noop
  const player = PLAYERS.find((p) => spawnSync('which', [p.cmd]).status === 0)
  if (!player) {
    log('AUDIO', 'no audio player found (afplay/ffplay); running silent')
    return noop
  }
  let proc = null
  const signal = (sig) => {
    try { proc?.kill(sig) } catch { /* already exited */ }
  }
  return {
    name: player.cmd,
    start(file, fromSec = 0, volume = 30) {
      this.stop()
      if (!file) return
      if (fromSec > 0.5 && !player.seeks) {
        log('AUDIO', `${player.cmd} cannot seek: audio restarts silent until the next track (clock still simulated)`)
        return
      }
      const p = spawn(player.cmd, player.args(file, fromSec, volume), { stdio: 'ignore' })
      p.on('error', (e) => log('AUDIO', `${player.cmd} failed: ${e.code || e.message}; use --silent`))
      p.on('exit', () => { if (proc === p) proc = null })
      proc = p
    },
    pause: () => signal('SIGSTOP'),
    resume: () => signal('SIGCONT'),
    stop() {
      signal('SIGKILL')
      proc = null
    }
  }
}
