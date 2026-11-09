// One HTTP server per simulated speaker: device description, SOAP control, /sim/*.
import http from 'node:http'
import { SERVICES, buildDeviceDescription } from '../description/deviceDescription.js'
import { FAULT, UpnpError, buildSoapFault, buildSoapResponse, parseSoapRequest } from './soap.js'
import { localIpFor, stripV6Prefix } from '../net/lanAddress.js'
import { handleControl } from '../control/api.js'
import { createAvTransport } from '../services/avTransport.js'
import { createRenderingControl } from '../services/renderingControl.js'
import { createGroupRenderingControl } from '../services/groupRenderingControl.js'
import { createZoneGroupTopology } from '../services/zoneGroupTopology.js'

export const SERVER_HEADER = 'Linux UPnP/1.0 Sonos/70.3-88200 (ZPSIM)'

// speaker: { uuid, name, port, engine, faults }. topology() -> every simulated speaker.
export function createSpeakerServer({ speaker, topology = () => [speaker], log = () => {}, forcedIp = null }) {
  const { engine, faults } = speaker
  const handlers = {
    [SERVICES.avTransport.control]: createAvTransport(engine, { faults }),
    [SERVICES.renderingControl.control]: createRenderingControl(engine),
    [SERVICES.groupRenderingControl.control]: createGroupRenderingControl(engine),
    [SERVICES.zoneGroupTopology.control]: createZoneGroupTopology(speaker, topology)
  }
  const serviceByPath = Object.fromEntries(Object.values(SERVICES).map((s) => [s.control, s]))

  const handleSoap = (req, res, body) => {
    const service = serviceByPath[req.url.split('?')[0]]
    const from = stripV6Prefix(req.socket.remoteAddress)
    const ctx = { ip: localIpFor(req.socket.localAddress, { forced: forcedIp }) }
    const send = (code, xml) => {
      res.writeHead(code, { 'Content-Type': 'text/xml; charset="utf-8"', EXT: '', Server: SERVER_HEADER, 'Content-Length': Buffer.byteLength(xml) })
      res.end(xml)
    }
    let action = '?'
    try {
      const parsed = parseSoapRequest(req.headers, body)
      action = parsed.action
      const handler = handlers[service.control][action]
      if (!handler) throw new UpnpError(FAULT.INVALID_ACTION, `${service.id}.${action} is not supported`)
      const result = handler(parsed.args, ctx)
      const kind = result.kind || 'control'
      log(kind === 'query' ? 'QUERY' : kind === 'volume' ? 'VOLUME' : kind === 'crossfade' ? 'XFADE' : 'SOAP', `[${speaker.name}] ${action} ${result.note || ''} | ${engine.summary()}`, { action, from, state: engine.snapshot() }, { routine: kind === 'query' })
      send(200, buildSoapResponse(service.type, action, result.fields))
    } catch (e) {
      const code = e.upnpCode || 501
      log('SOAP-ERR', `[${speaker.name}] ${action} -> fault ${code} ${e.message} from=${from}`, { action, from, fault: code })
      send(500, buildSoapFault(code, e.description || e.message || 'Action Failed'))
    }
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://sim')
    if (url.pathname.startsWith('/sim')) return handleControl(req, res, url, speaker)
    if (faults.offline) {
      if (faults.offlineMode === 'drop') return req.socket.destroy()
      return faults.hold(req.socket) // no answer: the controller runs into its own timeout
    }
    if (req.method === 'GET' && url.pathname === '/xml/device_description.xml') {
      const ip = localIpFor(req.socket.localAddress, { forced: forcedIp })
      const xml = buildDeviceDescription({ ip, name: speaker.name, uuid: speaker.uuid })
      log('HTTP', `[${speaker.name}] GET ${url.pathname} from=${stripV6Prefix(req.socket.remoteAddress)}`, {}, { routine: true })
      res.writeHead(200, { 'Content-Type': 'text/xml; charset="utf-8"', Server: SERVER_HEADER, 'Content-Length': Buffer.byteLength(xml) })
      return res.end(xml)
    }
    if (req.method === 'POST' && serviceByPath[url.pathname]) {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => handleSoap(req, res, Buffer.concat(chunks).toString('utf8')))
      return
    }
    log('HTTP', `[${speaker.name}] unhandled ${req.method} ${req.url} from=${stripV6Prefix(req.socket.remoteAddress)} -> 404`, { method: req.method, url: req.url })
    res.writeHead(404)
    res.end()
  })
  server.on('clientError', (_e, socket) => socket.destroy())
  return server
}
