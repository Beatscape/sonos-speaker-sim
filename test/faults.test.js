import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PlayerEngine } from '../src/player/engine.js'
import { createFaults, resolveFaultKey } from '../src/faults.js'
import { fakeClock, fakeMedia, flush } from './helpers.js'

async function playing() {
  const clock = fakeClock()
  const engine = new PlayerEngine({ media: fakeMedia(), clock })
  engine.start()
  const faults = createFaults({ engine, clock, offlineSeconds: 60 })
  engine.setUri('http://a')
  engine.play()
  await flush()
  return { clock, engine, faults }
}

test('p pauses by itself, s stops by itself', async () => {
  const { engine, faults } = await playing()
  faults.apply('p')
  assert.equal(engine.transport, 'PAUSED_PLAYBACK')
  faults.apply('s')
  assert.equal(engine.transport, 'STOPPED')
})

test('f freezes and r recovers the clock', async () => {
  const { engine, faults, clock } = await playing()
  faults.apply('f')
  await clock.advance(3000)
  assert.equal(Math.round(engine.position()), 0)
  faults.apply('r')
  await clock.advance(1000)
  assert.equal(Math.round(engine.position()), 1)
})

test('v drops volume to 5', async () => {
  const { engine, faults } = await playing()
  faults.apply('v')
  assert.equal(engine.volume, 5)
})

test('d clears the queued next URI and swallows exactly one SetNext', async () => {
  const { engine, faults } = await playing()
  engine.setNextUri('http://b')
  faults.apply('d')
  assert.equal(engine.nextUri, '')
  assert.equal(faults.consumeDropNext(), true)
  assert.equal(faults.consumeDropNext(), false)
})

test('o goes offline, expires on its own, r recovers early and cuts held sockets', async () => {
  const { faults, clock } = await playing()
  const socket = Object.assign(new EventEmitter(), { destroyed: false, destroy() { this.destroyed = true } })
  faults.apply('o')
  faults.hold(socket)
  assert.equal(faults.offline, true)
  await clock.advance(59_000)
  assert.equal(faults.offline, true)
  await clock.advance(2_000)
  assert.equal(faults.offline, false)
  assert.equal(socket.destroyed, true)
  faults.apply('o')
  faults.apply('r')
  assert.equal(faults.offline, false)
})

test('unknown key is rejected; names resolve to keys', async () => {
  const { faults } = await playing()
  assert.equal(faults.apply('z'), false)
  assert.equal(resolveFaultKey('dropnext'), 'd')
  assert.equal(resolveFaultKey('p'), 'p')
  assert.equal(resolveFaultKey('nope'), null)
})
