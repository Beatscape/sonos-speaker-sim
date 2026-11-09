import test from 'node:test'
import assert from 'node:assert/strict'
import { parseConfig, deriveUuid } from '../src/config.js'
import { localIpFor } from '../src/net/lanAddress.js'
import { buildDeviceDescription } from '../src/description/deviceDescription.js'
import { buildZoneGroupState } from '../src/services/zoneGroupTopology.js'
import { createMedia, estimateDuration } from '../src/player/media.js'

test('config defaults and flags', () => {
  const c = parseConfig([])
  assert.equal(c.port, 1400)
  assert.equal(c.count, 1)
  assert.equal(c.silent, false)
  const d = parseConfig(['--port', '1500', '--name', 'Tienda', '--silent', '--fake-duration', '30', '--count', '3', '--no-ssdp'])
  assert.deepEqual([d.port, d.name, d.silent, d.fakeDuration, d.count, d.ssdp], [1500, 'Tienda', true, 30, 3, false])
})

test('config rejects bad values', () => {
  assert.throws(() => parseConfig(['--port', '70000']))
  assert.throws(() => parseConfig(['--port', 'abc']))
  assert.throws(() => parseConfig(['--fake-duration', '-1']))
  assert.throws(() => parseConfig(['--offline-mode', 'x']))
})

test('uuid is stable, Sonos-shaped, and differs per port', () => {
  assert.equal(deriveUuid('A', 1400), deriveUuid('A', 1400))
  assert.match(deriveUuid('A', 1400), /^RINCON_[0-9A-F]{12}01400$/)
  assert.notEqual(deriveUuid('A', 1400), deriveUuid('A', 1401))
})

test('lan address: forced wins, same-subnet match, fallback', () => {
  const ifaces = { en0: [{ family: 'IPv4', internal: false, address: '192.168.1.20', netmask: '255.255.255.0' }], en1: [{ family: 'IPv4', internal: false, address: '10.0.0.5', netmask: '255.255.255.0' }] }
  assert.equal(localIpFor('1.1.1.1', { forced: '9.9.9.9', interfaces: ifaces }), '9.9.9.9')
  assert.equal(localIpFor('10.0.0.77', { interfaces: ifaces }), '10.0.0.5')
  assert.equal(localIpFor('::ffff:192.168.1.50', { interfaces: ifaces }), '192.168.1.20')
  assert.equal(localIpFor('172.16.0.1', { interfaces: ifaces }), '192.168.1.20')
  assert.equal(localIpFor('127.0.0.1', { interfaces: {} }), '127.0.0.1')
})

test('device description identifies a Sonos renderer with the real control URLs', () => {
  const xml = buildDeviceDescription({ ip: '1.2.3.4', name: 'Room & Co', uuid: 'RINCON_X01400' })
  assert.match(xml, /<manufacturer>Sonos, Inc\.<\/manufacturer>/)
  assert.match(xml, /<roomName>Room &amp; Co<\/roomName>/)
  assert.match(xml, /<UDN>uuid:RINCON_X01400<\/UDN>/)
  for (const p of ['/MediaRenderer/AVTransport/Control', '/MediaRenderer/RenderingControl/Control', '/MediaRenderer/GroupRenderingControl/Control', '/ZoneGroupTopology/Control']) {
    assert.ok(xml.includes(`<controlURL>${p}</controlURL>`), p)
  }
})

test('zone group state lists each speaker as its own coordinated group', () => {
  const xml = buildZoneGroupState([{ uuid: 'A', name: 'One', port: 1400 }, { uuid: 'B', name: 'Two', port: 1401 }], '1.2.3.4')
  assert.equal((xml.match(/<ZoneGroup /g) || []).length, 2)
  assert.match(xml, /Coordinator="B"/)
  assert.match(xml, /Location="http:\/\/1\.2\.3\.4:1401\/xml\/device_description\.xml"/)
})

test('media: silent mode estimates duration from size; fake-duration overrides; HTTP errors are logged loudly', async () => {
  const logs = []
  const ok = { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(32000) }
  const media = createMedia({ silent: true, fetchImpl: async () => ok, log: (tag, msg) => logs.push([tag, msg]) })
  assert.equal((await media.load('http://h/a.mp3')).duration, estimateDuration(32000))
  const forced = createMedia({ silent: true, fakeDuration: 7, fetchImpl: async () => ok })
  assert.equal((await forced.load('http://h/a.mp3')).duration, 7)
  const bad = createMedia({ silent: true, fetchImpl: async () => ({ ok: false, status: 403 }), log: (tag, msg) => logs.push([tag, msg]) })
  await assert.rejects(bad.load('http://h/x.mp3'))
  assert.ok(logs.some(([t, m]) => t === 'FETCH-ERR' && m.includes('403')))
  const down = createMedia({ silent: true, fetchImpl: async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }) }, log: (tag, msg) => logs.push([tag, msg]) })
  await assert.rejects(down.load('http://h/y.mp3'))
  assert.ok(logs.some(([t, m]) => t === 'FETCH-ERR' && m.includes('ECONNREFUSED')))
})
