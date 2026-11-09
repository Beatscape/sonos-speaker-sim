import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMSearch, buildSearchResponses, ANSWERED_TARGETS } from '../src/discovery/ssdp.js'

const search = (st) => ['M-SEARCH * HTTP/1.1', 'HOST: 239.255.255.250:1900', 'MAN: "ssdp:discover"', 'MX: 2', `ST: ${st}`, '', ''].join('\r\n')

test('answers the four search targets', () => {
  for (const st of ['ssdp:all', 'upnp:rootdevice', 'urn:schemas-upnp-org:device:ZonePlayer:1', 'urn:schemas-upnp-org:device:MediaRenderer:1']) {
    assert.equal(parseMSearch(search(st))?.st, st)
  }
})

test('ignores other targets, non M-SEARCH and NOTIFY', () => {
  assert.equal(parseMSearch(search('urn:schemas-upnp-org:device:MediaServer:1')), null)
  assert.equal(parseMSearch('NOTIFY * HTTP/1.1\r\nST: ssdp:all\r\n\r\n'), null)
})

test('MX is clamped to 1..3', () => {
  assert.equal(parseMSearch(search('ssdp:all').replace('MX: 2', 'MX: 99')).mx, 3)
  assert.equal(parseMSearch(search('ssdp:all').replace('MX: 2', 'MX: 0')).mx, 1)
})

test('response has LOCATION, SERVER with Sonos, ST and USN, CRLF terminated', () => {
  const [text] = buildSearchResponses({ st: 'urn:schemas-upnp-org:device:ZonePlayer:1', uuid: 'RINCON_X01400', location: 'http://1.2.3.4:1400/xml/device_description.xml', server: 'Linux UPnP/1.0 Sonos/70 (ZPSIM)' })
  assert.match(text, /^HTTP\/1\.1 200 OK\r\n/)
  assert.match(text, /\r\nLOCATION: http:\/\/1\.2\.3\.4:1400\/xml\/device_description\.xml\r\n/)
  assert.match(text, /\r\nSERVER: .*Sonos.*\r\n/)
  assert.match(text, /\r\nUSN: uuid:RINCON_X01400::urn:schemas-upnp-org:device:ZonePlayer:1\r\n/)
  assert.ok(text.endsWith('\r\n\r\n'))
})

test('ssdp:all expands to every concrete target', () => {
  const out = buildSearchResponses({ st: 'ssdp:all', uuid: 'U', location: 'http://x', server: 'Sonos' })
  assert.equal(out.length, ANSWERED_TARGETS.length)
})
