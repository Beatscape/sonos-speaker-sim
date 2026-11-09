// Fault injection for one speaker. Keys are shared by the keyboard and /sim/* HTTP API.
export const FAULT_KEYS = {
  p: 'pause',
  s: 'stop',
  f: 'freeze',
  v: 'volume',
  d: 'dropnext',
  o: 'offline',
  r: 'recover'
}
const NAME_TO_KEY = Object.fromEntries(Object.entries(FAULT_KEYS).map(([k, n]) => [n, k]))
export const resolveFaultKey = (nameOrKey) => (FAULT_KEYS[nameOrKey] ? nameOrKey : NAME_TO_KEY[nameOrKey] || null)

export function createFaults({ engine, clock = engine.clock, log = () => {}, offlineSeconds = 60, offlineMode = 'hang' }) {
  let offlineTimer = null
  const held = new Set()
  const faults = {
    offline: false,
    dropNext: false,
    offlineMode,

    // SetNextAVTransportURI calls this: true means "swallow this one".
    consumeDropNext() {
      if (!faults.dropNext) return false
      faults.dropNext = false
      log('FAULT', 'dropNext: next-URI accepted by the speaker but discarded')
      return true
    },

    // Offline requests are not answered (hang) or are cut (drop); remember the sockets.
    hold(socket) {
      held.add(socket)
      socket.on('close', () => held.delete(socket))
    },

    goOffline(seconds = offlineSeconds) {
      faults.offline = true
      clock.clearTimeout(offlineTimer)
      offlineTimer = clock.setTimeout(() => faults.recover('offline period over'), seconds * 1000)
      offlineTimer?.unref?.()
      log('FAULT', `OFFLINE for ${seconds}s: HTTP ${faults.offlineMode === 'drop' ? 'connections dropped' : 'requests unanswered'}, SSDP silent`, { fault: 'offline', seconds })
    },

    recover(why = 'recover') {
      clock.clearTimeout(offlineTimer)
      offlineTimer = null
      engine.unfreeze()
      faults.offline = false
      faults.dropNext = false
      for (const s of held) s.destroy()
      held.clear()
      log('RECOVER', `faults cleared (${why}) | ${engine.summary()}`, { why })
    },

    // Returns false for an unknown key.
    apply(key) {
      switch (key) {
        case 'p':
          engine.forcePause()
          log('FAULT', 'paused by itself (PAUSED_PLAYBACK)')
          return true
        case 's':
          engine.stop('fault: stopped by itself')
          log('FAULT', 'stopped by itself (STOPPED)')
          return true
        case 'f':
          if (engine.freeze()) log('FAULT', `FREEZE: still reports ${engine.transport} but RelTime is stuck`)
          else log('FAULT', 'already frozen (r to recover)')
          return true
        case 'v':
          engine.setVolume(5, 'fault: volume dropped')
          return true
        case 'd': {
          const had = engine.dropNextUri()
          faults.dropNext = true
          log('FAULT', `dropNext: queued next URI ${had ? 'cleared' : '(none queued)'}; the next SetNextAVTransportURI is discarded once`)
          return true
        }
        case 'o':
          faults.goOffline()
          return true
        case 'r':
          faults.recover('r')
          return true
        default:
          return false
      }
    },

    active() {
      return [engine.frozen && 'frozen', faults.offline && 'offline', faults.dropNext && 'dropNext'].filter(Boolean)
    }
  }
  return faults
}
