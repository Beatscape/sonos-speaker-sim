// Deterministic clock: timers only fire when `advance` moves time forward.
export function fakeClock(start = 1_000_000) {
  let now = start
  let seq = 0
  const timers = new Map()
  const add = (fn, ms, every) => {
    const id = ++seq
    timers.set(id, { fn, at: now + ms, every })
    return id
  }
  return {
    now: () => now,
    setTimeout: (fn, ms) => add(fn, ms, null),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, ms) => add(fn, ms, ms),
    clearInterval: (id) => timers.delete(id),
    async advance(ms) {
      const target = now + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        const [id, t] = due
        now = t.at
        if (t.every) t.at += t.every
        else timers.delete(id)
        t.fn()
        await flush()
      }
      now = target
    }
  }
}

export const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

// Media stub: every URI resolves to a track of `durations[uri]` (default 10s); URIs in `fail` reject.
export function fakeMedia({ durations = {}, fail = new Set() } = {}) {
  const loads = []
  return {
    loads,
    load(uri) {
      loads.push(uri)
      if (fail.has(uri)) return Promise.reject(new Error('HTTP 404'))
      return Promise.resolve({ duration: durations[uri] ?? 10, file: undefined })
    }
  }
}

export function recordingAudio() {
  const calls = []
  return { calls, start: (...a) => calls.push(['start', ...a]), pause: () => calls.push(['pause']), resume: () => calls.push(['resume']), stop: () => calls.push(['stop']) }
}
