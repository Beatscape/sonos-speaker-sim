// Playback state machine with a real (or injected) clock.
//
// Position advances only while PLAYING and not frozen. When a track ends, a queued
// next URI is promoted after a short TRANSITIONING phase (gapless); otherwise the
// transport goes STOPPED, like a speaker with an empty queue.
import { EventEmitter } from 'node:events'
import { FAULT, UpnpError } from '../http/soap.js'
import { hmsOrDash } from './format.js'

export const realClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h)
}

const nullAudio = { start() {}, pause() {}, resume() {}, stop() {} }
export const TRANSITION_MS = 300
export const TICK_MS = 200

export class PlayerEngine extends EventEmitter {
  // media: { load(uri) -> Promise<{ duration, file? }> }
  constructor({ media, audio = nullAudio, clock = realClock, log = () => {} }) {
    super()
    this.media = media
    this.audio = audio
    this.clock = clock
    this.log = log
    this.transport = 'STOPPED' // PLAYING | PAUSED_PLAYBACK | STOPPED | TRANSITIONING
    this.uri = ''
    this.meta = ''
    this.nextUri = ''
    this.nextMeta = ''
    this.track = null
    this.duration = 0
    this.posBase = 0
    this.t0 = null // clock ms since the position started advancing; null = halted
    this.volume = 30
    this.mute = false
    this.crossfade = false
    this.frozen = false
    this.gen = 0 // bumps on every command that invalidates pending async work
    this.ticker = null
  }

  start() {
    if (!this.ticker) this.ticker = this.clock.setInterval(() => this.tick(), TICK_MS)
    this.ticker?.unref?.()
  }

  dispose() {
    if (this.ticker) this.clock.clearInterval(this.ticker)
    this.ticker = null
    this.gen++
    this.audio.stop()
  }

  position() {
    return this.posBase + (this.t0 === null ? 0 : (this.clock.now() - this.t0) / 1000)
  }

  // What GetPositionInfo reports: 0 when STOPPED.
  reportedPosition() {
    return this.transport === 'STOPPED' ? 0 : this.position()
  }

  snapshot() {
    return {
      transport: this.transport,
      frozen: this.frozen,
      uri: this.uri,
      nextUri: this.nextUri,
      position: Math.round(this.reportedPosition() * 10) / 10,
      duration: this.duration,
      volume: this.volume,
      crossfade: this.crossfade
    }
  }

  summary() {
    const s = this.snapshot()
    return `state=${s.transport}${s.frozen ? '(FROZEN)' : ''} pos=${hmsOrDash(s.position)}/${hmsOrDash(s.duration)} vol=${s.volume} xfade=${s.crossfade ? 'on' : 'off'} next=${s.nextUri ? 'set' : 'none'}`
  }

  #setTransport(next, why = '') {
    if (this.transport === next) return
    const from = this.transport
    this.transport = next
    this.log('STATE', `${from} -> ${next}${why ? ` (${why})` : ''}`, { from, to: next, why })
    this.emit('transport', next, from, why)
  }

  #halt() {
    this.posBase = this.position()
    this.t0 = null
  }

  #beginAt(sec) {
    this.posBase = sec
    this.t0 = this.frozen ? null : this.clock.now()
    this.audio.start(this.track?.file, sec, this.volume, this.duration)
    if (this.frozen) this.audio.pause()
    this.#setTransport('PLAYING')
  }

  setUri(uri, meta = '') {
    this.gen++
    this.#halt()
    this.audio.stop()
    this.posBase = 0
    this.uri = uri
    this.meta = meta
    this.nextUri = ''
    this.nextMeta = ''
    this.track = null
    this.duration = 0
    this.#setTransport('STOPPED', 'SetAVTransportURI')
    // Prefetch so a failing media server shows up immediately in the log.
    if (uri) this.media.load(uri).catch(() => {})
  }

  setNextUri(uri, meta = '') {
    this.nextUri = uri
    this.nextMeta = meta
    if (uri) this.media.load(uri).catch(() => {})
  }

  dropNextUri() {
    const had = this.nextUri
    this.nextUri = ''
    this.nextMeta = ''
    return had
  }

  play() {
    if (!this.uri) throw new UpnpError(FAULT.TRANSITION_NOT_AVAILABLE)
    if (this.transport === 'PLAYING' || this.transport === 'TRANSITIONING') return
    if (this.transport === 'PAUSED_PLAYBACK' && this.track) {
      this.t0 = this.frozen ? null : this.clock.now()
      if (!this.frozen) this.audio.resume()
      this.#setTransport('PLAYING', 'resume')
      return
    }
    const gen = ++this.gen
    this.#setTransport('TRANSITIONING', 'Play')
    this.media.load(this.uri).then(
      (track) => {
        if (gen !== this.gen) return
        this.track = track
        this.duration = track.duration
        this.#beginAt(this.posBase)
      },
      () => {
        if (gen !== this.gen) return
        this.t0 = null
        this.#setTransport('STOPPED', 'media fetch failed')
      }
    )
  }

  pause() {
    if (this.transport !== 'PLAYING') throw new UpnpError(FAULT.TRANSITION_NOT_AVAILABLE)
    this.#halt()
    this.audio.pause()
    this.#setTransport('PAUSED_PLAYBACK', 'Pause')
  }

  stop(why = 'Stop') {
    this.gen++
    this.#halt()
    this.posBase = 0
    this.audio.stop()
    this.#setTransport('STOPPED', why)
  }

  next(why = 'Next') {
    if (!this.nextUri) throw new UpnpError(FAULT.TRANSITION_NOT_AVAILABLE)
    this.#advance(why)
  }

  previous() {
    if (!this.uri) throw new UpnpError(FAULT.TRANSITION_NOT_AVAILABLE)
    this.seek(0, { force: true })
  }

  seek(sec, { force = false } = {}) {
    if (!this.uri || (!this.track && !force)) throw new UpnpError(FAULT.TRANSITION_NOT_AVAILABLE)
    if (this.track && sec > this.duration) throw new UpnpError(FAULT.ILLEGAL_SEEK_TARGET)
    const playing = this.transport === 'PLAYING'
    this.posBase = sec
    this.t0 = playing && !this.frozen ? this.clock.now() : null
    if (playing) {
      this.audio.start(this.track?.file, sec, this.volume, this.duration)
      if (this.frozen) this.audio.pause()
    }
  }

  setVolume(value, why = '') {
    const n = Math.round(Math.min(100, Math.max(0, Number(value) || 0)))
    if (n !== this.volume) {
      this.log('VOLUME', `${this.volume} -> ${n}${why ? ` (${why})` : ''}`, { from: this.volume, to: n, why })
      this.emit('volume', n, this.volume)
    }
    this.volume = n
  }

  // ---- fault hooks -------------------------------------------------------
  forcePause() {
    if (this.transport === 'PLAYING') {
      this.#halt()
      this.audio.pause()
    }
    this.#setTransport('PAUSED_PLAYBACK', 'fault: paused by itself')
  }

  freeze() {
    if (this.frozen) return false
    this.frozen = true
    this.#halt()
    this.audio.pause()
    return true
  }

  unfreeze() {
    if (!this.frozen) return
    this.frozen = false
    if (this.transport === 'PLAYING') {
      this.t0 = this.clock.now()
      this.audio.resume()
    }
  }

  // ---- internals ---------------------------------------------------------
  tick() {
    if (this.transport !== 'PLAYING' || this.t0 === null || this.duration <= 0) return
    if (this.position() < this.duration) return
    if (this.nextUri) return this.#advance('track ended, next URI queued')
    this.log('END', 'track ended without a queued next URI -> STOPPED')
    this.stop('track ended')
    this.emit('ended')
  }

  #advance(why) {
    const uri = this.nextUri
    this.gen++
    const gen = this.gen
    this.#halt()
    this.audio.stop()
    this.uri = uri
    this.meta = this.nextMeta
    this.nextUri = ''
    this.nextMeta = ''
    this.posBase = 0
    this.track = null
    this.#setTransport('TRANSITIONING', why)
    this.media.load(uri).then(
      (track) => {
        this.clock.setTimeout(() => {
          if (gen !== this.gen) return
          this.track = track
          this.duration = track.duration
          this.#beginAt(0)
          this.log('GAPLESS', 'now playing the queued track; next URI is empty (controller should queue another)', { uri })
          this.emit('gapless', uri)
        }, TRANSITION_MS)
      },
      () => {
        if (gen !== this.gen) return
        this.#setTransport('STOPPED', 'media fetch of next track failed')
      }
    )
  }
}
