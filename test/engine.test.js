import test from 'node:test'
import assert from 'node:assert/strict'
import { PlayerEngine, TRANSITION_MS } from '../src/player/engine.js'
import { fakeClock, fakeMedia, flush, recordingAudio } from './helpers.js'

function setup(mediaOpts) {
  const clock = fakeClock()
  const media = fakeMedia(mediaOpts)
  const audio = recordingAudio()
  const engine = new PlayerEngine({ media, audio, clock })
  engine.start()
  return { clock, media, audio, engine }
}

test('Play without a URI is Transition not available (701)', () => {
  const { engine } = setup()
  assert.throws(() => engine.play(), (e) => e.upnpCode === 701)
})

test('Play goes TRANSITIONING then PLAYING and the position follows the clock', async () => {
  const { engine, clock } = setup({ durations: { 'http://a': 30 } })
  engine.setUri('http://a')
  engine.play()
  assert.equal(engine.transport, 'TRANSITIONING')
  await flush()
  assert.equal(engine.transport, 'PLAYING')
  await clock.advance(5000)
  assert.equal(Math.round(engine.position()), 5)
  assert.equal(engine.duration, 30)
})

test('failed media fetch ends in STOPPED', async () => {
  const { engine } = setup({ fail: new Set(['http://bad']) })
  engine.setUri('http://bad')
  engine.play()
  await flush()
  assert.equal(engine.transport, 'STOPPED')
})

test('pause freezes the position and resume continues from it', async () => {
  const { engine, clock, audio } = setup()
  engine.setUri('http://a')
  engine.play()
  await flush()
  await clock.advance(3000)
  engine.pause()
  await clock.advance(5000)
  assert.equal(engine.transport, 'PAUSED_PLAYBACK')
  assert.equal(Math.round(engine.position()), 3)
  engine.play()
  await clock.advance(2000)
  assert.equal(Math.round(engine.position()), 5)
  assert.ok(audio.calls.some((c) => c[0] === 'pause') && audio.calls.some((c) => c[0] === 'resume'))
})

test('pause while not playing is rejected', () => {
  const { engine } = setup()
  assert.throws(() => engine.pause(), (e) => e.upnpCode === 701)
})

test('seek moves the position, rejects targets past the end, needs a loaded track', async () => {
  const { engine, clock } = setup({ durations: { 'http://a': 20 } })
  engine.setUri('http://a')
  assert.throws(() => engine.seek(5), (e) => e.upnpCode === 701)
  engine.play()
  await flush()
  engine.seek(12)
  await clock.advance(1000)
  assert.equal(Math.round(engine.position()), 13)
  assert.throws(() => engine.seek(21), (e) => e.upnpCode === 711)
})

test('track end with a queued next URI transitions gapless and clears the queue', async () => {
  const { engine, clock } = setup({ durations: { 'http://a': 10, 'http://b': 40 } })
  engine.setUri('http://a')
  engine.play()
  await flush()
  engine.setNextUri('http://b')
  await clock.advance(10_000)
  await flush()
  assert.equal(engine.transport, 'TRANSITIONING')
  assert.equal(engine.uri, 'http://b')
  await clock.advance(TRANSITION_MS)
  assert.equal(engine.transport, 'PLAYING')
  assert.equal(engine.nextUri, '')
  assert.equal(engine.duration, 40)
  assert.ok(engine.position() < 1)
})

test('track end with no next URI stops and reports position 0', async () => {
  const { engine, clock } = setup({ durations: { 'http://a': 5 } })
  let ended = false
  engine.on('ended', () => { ended = true })
  engine.setUri('http://a')
  engine.play()
  await flush()
  await clock.advance(5400)
  assert.equal(engine.transport, 'STOPPED')
  assert.equal(engine.reportedPosition(), 0)
  assert.ok(ended)
})

test('Next without queued URI is 701; with one it advances', async () => {
  const { engine, clock } = setup()
  engine.setUri('http://a')
  engine.play()
  await flush()
  assert.throws(() => engine.next(), (e) => e.upnpCode === 701)
  engine.setNextUri('http://b')
  engine.next()
  await flush()
  await clock.advance(TRANSITION_MS + 10)
  assert.equal(engine.uri, 'http://b')
  assert.equal(engine.transport, 'PLAYING')
})

test('setUri while playing resets position, queue and stops', async () => {
  const { engine, clock } = setup()
  engine.setUri('http://a')
  engine.play()
  await flush()
  engine.setNextUri('http://b')
  await clock.advance(2000)
  engine.setUri('http://c')
  assert.equal(engine.transport, 'STOPPED')
  assert.equal(engine.nextUri, '')
  assert.equal(engine.reportedPosition(), 0)
})

test('a stale load never resurrects playback after Stop', async () => {
  const { engine } = setup()
  engine.setUri('http://a')
  engine.play()
  engine.stop()
  await flush()
  assert.equal(engine.transport, 'STOPPED')
})

test('freeze keeps PLAYING but halts the position until unfreeze', async () => {
  const { engine, clock } = setup()
  engine.setUri('http://a')
  engine.play()
  await flush()
  await clock.advance(2000)
  assert.equal(engine.freeze(), true)
  assert.equal(engine.freeze(), false)
  await clock.advance(5000)
  assert.equal(engine.transport, 'PLAYING')
  assert.equal(Math.round(engine.position()), 2)
  engine.unfreeze()
  await clock.advance(1000)
  assert.equal(Math.round(engine.position()), 3)
})

test('volume is clamped to 0-100 and rounded', () => {
  const { engine } = setup()
  engine.setVolume(150)
  assert.equal(engine.volume, 100)
  engine.setVolume(-3)
  assert.equal(engine.volume, 0)
  engine.setVolume('42.6')
  assert.equal(engine.volume, 43)
  engine.setVolume('abc')
  assert.equal(engine.volume, 0)
})
