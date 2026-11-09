// SSDP responder: answers M-SEARCH for the device types a Sonos controller looks for.
import dgram from 'node:dgram'
import { listIPv4, localIpFor } from '../net/lanAddress.js'

export const SSDP_ADDRESS = '239.255.255.250'
export const SSDP_PORT = 1900
export const ANSWERED_TARGETS = ['upnp:rootdevice', 'urn:schemas-upnp-org:device:ZonePlayer:1', 'urn:schemas-upnp-org:device:MediaRenderer:1']
const ANSWERED = new Set(['ssdp:all', ...ANSWERED_TARGETS])

// -> { st, mx } for an M-SEARCH we answer, otherwise null.
export function parseMSearch(text) {
  if (!/^M-SEARCH/i.test(text)) return null
  const st = /^ST:\s*(.+)$/im.exec(text)?.[1]?.trim()
  if (!st || !ANSWERED.has(st)) return null
  const mx = Math.min(Math.max(Number(/^MX:\s*(\d+)/im.exec(text)?.[1]) || 1, 1), 3)
  return { st, mx }
}

// One datagram per target: ssdp:all expands to the three concrete targets.
export function buildSearchResponses({ st, uuid, location, server, household = 'Sonos_SIM' }) {
  const targets = st === 'ssdp:all' ? ANSWERED_TARGETS : [st]
  return targets.map((target) =>
    [
      'HTTP/1.1 200 OK',
      'CACHE-CONTROL: max-age = 1800',
      'EXT:',
      `LOCATION: ${location}`,
      `SERVER: ${server}`,
      `ST: ${target}`,
      `USN: uuid:${uuid}::${target}`,
      `X-RINCON-HOUSEHOLD: ${household}`,
      'X-RINCON-BOOTSEQ: 1',
      '',
      ''
    ].join('\r\n')
  )
}

// speakers: [{ uuid, port, faults }]. Returns { close() }.
export function startSsdp({ speakers, server, forcedIp = null, log = () => {} }) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true, reusePort: true })
  socket.on('error', (e) => log('SSDP', `error ${e.code || e.message}; multicast discovery unavailable (add the IP manually in the controller)`))
  socket.on('message', (msg, rinfo) => {
    const query = parseMSearch(msg.toString('utf8'))
    if (!query) return
    const ip = localIpFor(rinfo.address, { forced: forcedIp })
    log('SSDP', `M-SEARCH ST=${query.st} from=${rinfo.address}:${rinfo.port}`, { st: query.st, from: rinfo.address }, { routine: true })
    for (const sp of speakers) {
      if (sp.faults.offline) continue
      const location = `http://${ip}:${sp.port}/xml/device_description.xml`
      for (const text of buildSearchResponses({ st: query.st, uuid: sp.uuid, location, server })) {
        setTimeout(() => {
          if (!sp.faults.offline) socket.send(Buffer.from(text), rinfo.port, rinfo.address)
        }, Math.random() * Math.min(query.mx, 1) * 300)
      }
    }
  })
  socket.bind(SSDP_PORT, '0.0.0.0', () => {
    let joined = 0
    for (const i of listIPv4()) {
      try {
        socket.addMembership(SSDP_ADDRESS, i.address)
        joined++
      } catch (e) {
        log('SSDP', `no multicast membership on ${i.address}: ${e.code || e.message}`)
      }
    }
    if (joined === 0) {
      try {
        socket.addMembership(SSDP_ADDRESS)
        joined++
      } catch { /* no multicast at all */ }
    }
    log('SSDP', `listening on ${SSDP_ADDRESS}:${SSDP_PORT} (${joined} interface${joined === 1 ? '' : 's'})`)
  })
  return { close: () => { try { socket.close() } catch { /* already closed */ } } }
}
