// Integration over loopback with ephemeral ports: no external network.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { PlayerEngine } from '../src/player/engine.js'
import { createFaults } from '../src/faults.js'
import { createMedia } from '../src/player/media.js'
import { createSpeakerServer } from '../src/http/server.js'
import { buildSoapEnvelopeForTest } from './soapClient.js'

const AVT = 'urn:schemas-upnp-org:service:AVTransport:1'
const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)))

async function boot() {
  // 16000 bytes at 128 kbps = 1 second of "audio"; with fakeDuration 30 the track is 30s.
  const mediaServer = http.createServer((req, res) => {
    if (req.url.startsWith('/missing')) { res.writeHead(404); return res.end() }
    res.end(Buffer.alloc(16000))
  })
  const mediaPort = await listen(mediaServer)
  const media = createMedia({ silent: true, fakeDuration: 30 })
  const engine = new PlayerEngine({ media })
  const speaker = { uuid: 'RINCON_TEST01400', name: 'Test Room', port: 0, engine }
  speaker.faults = createFaults({ engine })
  const server = createSpeakerServer({ speaker, forcedIp: '127.0.0.1' })
  const port = await listen(server)
  speaker.port = port
  const base = `http://127.0.0.1:${port}`
  const soap = (path, service, action, inner = '') => buildSoapEnvelopeForTest(base + path, service, action, inner)
  const close = () => { engine.dispose(); server.closeAllConnections(); server.close(); mediaServer.close() }
  return { base, mediaPort, engine, speaker, soap, close }
}

test('description, topology, transport, volume and faults over HTTP', async (t) => {
  const s = await boot()
  t.after(s.close)

  const desc = await (await fetch(`${s.base}/xml/device_description.xml`)).text()
  assert.match(desc, /Sonos, Inc\./)

  const zgt = await s.soap('/ZoneGroupTopology/Control', 'urn:schemas-upnp-org:service:ZoneGroupTopology:1', 'GetZoneGroupState')
  assert.equal(zgt.status, 200)
  assert.match(zgt.text, /&lt;ZoneGroup Coordinator=&quot;RINCON_TEST01400&quot;/)

  const uri = `http://127.0.0.1:${s.mediaPort}/a.mp3?x=1&amp;y=2`
  await s.soap('/MediaRenderer/AVTransport/Control', AVT, 'SetAVTransportURI', `<InstanceID>0</InstanceID><CurrentURI>${uri}</CurrentURI><CurrentURIMetaData></CurrentURIMetaData>`)
  await s.soap('/MediaRenderer/AVTransport/Control', AVT, 'Play', '<InstanceID>0</InstanceID><Speed>1</Speed>')
  await new Promise((r) => setTimeout(r, 100))
  const ti = await s.soap('/MediaRenderer/AVTransport/Control', AVT, 'GetTransportInfo', '<InstanceID>0</InstanceID>')
  assert.match(ti.text, /<CurrentTransportState>PLAYING<\/CurrentTransportState>/)
  const pi = await s.soap('/MediaRenderer/AVTransport/Control', AVT, 'GetPositionInfo', '<InstanceID>0</InstanceID>')
  assert.match(pi.text, /<TrackDuration>0:00:30<\/TrackDuration>/)
  assert.match(pi.text, /<TrackURI>http:\/\/127\.0\.0\.1:\d+\/a\.mp3\?x=1&amp;y=2<\/TrackURI>/)

  await s.soap('/MediaRenderer/RenderingControl/Control', 'urn:schemas-upnp-org:service:RenderingControl:1', 'SetVolume', '<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>61</DesiredVolume>')
  const gv = await s.soap('/MediaRenderer/GroupRenderingControl/Control', 'urn:schemas-upnp-org:service:GroupRenderingControl:1', 'GetGroupVolume', '<InstanceID>0</InstanceID>')
  assert.match(gv.text, /<CurrentVolume>61<\/CurrentVolume>/)

  await s.soap('/MediaRenderer/AVTransport/Control', AVT, 'SetCrossfadeMode', '<InstanceID>0</InstanceID><CrossfadeMode>1</CrossfadeMode>')
  const cf = await s.soap('/MediaRenderer/AVTransport/Control', AVT, 'GetCrossfadeMode', '<InstanceID>0</InstanceID>')
  assert.match(cf.text, /<CrossfadeMode>1<\/CrossfadeMode>/)

  const st = await (await fetch(`${s.base}/sim/pause`, { method: 'POST' })).json()
  assert.equal(st.transport, 'PAUSED_PLAYBACK')
  assert.equal((await (await fetch(`${s.base}/sim/volume`)).json()).volume, 5)
  const unknown = await fetch(`${s.base}/sim/bogus`)
  assert.equal(unknown.status, 404)
})

test('unknown action and unsupported URI scheme return UPnP faults', async (t) => {
  const s = await boot()
  t.after(s.close)
  const bogus = await s.soap('/MediaRenderer/AVTransport/Control', AVT, 'Bogus')
  assert.equal(bogus.status, 500)
  assert.match(bogus.text, /<errorCode>401<\/errorCode>/)
  const play = await s.soap('/MediaRenderer/AVTransport/Control', AVT, 'Play', '<InstanceID>0</InstanceID><Speed>1</Speed>')
  assert.match(play.text, /<errorCode>701<\/errorCode>/)
  const bad = await s.soap('/MediaRenderer/AVTransport/Control', AVT, 'SetAVTransportURI', '<InstanceID>0</InstanceID><CurrentURI>file:///etc/passwd</CurrentURI><CurrentURIMetaData></CurrentURIMetaData>')
  assert.match(bad.text, /<errorCode>714<\/errorCode>/)
  const seek = await s.soap('/MediaRenderer/AVTransport/Control', AVT, 'Seek', '<InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>0:00:05</Target>')
  assert.match(seek.text, /<errorCode>701<\/errorCode>/)
})

test('a media URL that returns 404 leaves the transport STOPPED', async (t) => {
  const s = await boot()
  t.after(s.close)
  await s.soap('/MediaRenderer/AVTransport/Control', AVT, 'SetAVTransportURI', `<InstanceID>0</InstanceID><CurrentURI>http://127.0.0.1:${s.mediaPort}/missing.mp3</CurrentURI><CurrentURIMetaData></CurrentURIMetaData>`)
  await s.soap('/MediaRenderer/AVTransport/Control', AVT, 'Play', '<InstanceID>0</InstanceID><Speed>1</Speed>')
  await new Promise((r) => setTimeout(r, 100))
  assert.equal(s.engine.transport, 'STOPPED')
})

test('offline fault leaves SOAP unanswered but /sim reachable; recover restores service', async (t) => {
  const s = await boot()
  t.after(s.close)
  await fetch(`${s.base}/sim/offline?seconds=30`)
  await assert.rejects(fetch(`${s.base}/xml/device_description.xml`, { signal: AbortSignal.timeout(300) }))
  assert.equal((await fetch(`${s.base}/sim/state`)).status, 200)
  await fetch(`${s.base}/sim/recover`)
  assert.equal((await fetch(`${s.base}/xml/device_description.xml`)).status, 200)
})

test('offline drop mode resets the connection', async (t) => {
  const s = await boot()
  t.after(s.close)
  s.speaker.faults.offlineMode = 'drop'
  s.speaker.faults.goOffline(30)
  await assert.rejects(fetch(`${s.base}/xml/device_description.xml`, { signal: AbortSignal.timeout(1000) }))
  s.speaker.faults.recover()
})
