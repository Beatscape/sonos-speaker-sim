// Entry point: wires config, speakers, SSDP, keyboard controls.
import fs from 'node:fs'
import readline from 'node:readline'
import { parseConfig, deriveUuid, HELP_TEXT } from './config.js'
import { createLogger } from './log.js'
import { listIPv4 } from './net/lanAddress.js'
import { createMedia } from './player/media.js'
import { createAudioOutput } from './player/audioOutput.js'
import { PlayerEngine } from './player/engine.js'
import { createFaults, FAULT_KEYS } from './faults.js'
import { createSpeakerServer, SERVER_HEADER } from './http/server.js'
import { startSsdp } from './discovery/ssdp.js'

const KEY_HELP = 'keys: p pause | s stop | f freeze | v volume=5 | d drop next | o offline | r recover | i state | h help | q quit'

export async function main(argv) {
  const config = parseConfig(argv)
  if (config.help) return console.log(HELP_TEXT)
  if (config.version) {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    return console.log(pkg.version)
  }

  const log = createLogger({ file: config.logFile, quiet: config.quiet })
  const media = createMedia({ silent: config.silent, fakeDuration: config.fakeDuration, log })
  const audio = createAudioOutput({ silent: config.silent, log })

  const speakers = []
  for (let i = 0; i < config.count; i++) {
    const port = config.port + i
    const name = config.count > 1 ? `${config.name} ${i + 1}` : config.name
    const speaker = { uuid: deriveUuid(name, port), name, port }
    // Only the first speaker plays through the local audio output.
    speaker.engine = new PlayerEngine({ media, audio: i === 0 ? audio : undefined, log: (tag, msg, data) => log(tag, `[${name}] ${msg}`, data) })
    speaker.faults = createFaults({ engine: speaker.engine, log: (tag, msg, data) => log(tag, `[${name}] ${msg}`, data), offlineSeconds: config.offlineSeconds, offlineMode: config.offlineMode })
    speaker.engine.start()
    speakers.push(speaker)
  }

  const servers = []
  for (const sp of speakers) {
    const server = createSpeakerServer({ speaker: sp, topology: () => speakers, log, forcedIp: config.ip })
    await new Promise((resolve, reject) => {
      server.once('error', (e) => reject(new Error(`cannot listen on port ${sp.port}: ${e.code || e.message}`)))
      server.listen(sp.port, '0.0.0.0', resolve)
    })
    servers.push(server)
  }

  const ips = listIPv4().map((i) => i.address)
  const shownIp = config.ip || ips[0] || '127.0.0.1'
  console.log(log.paint('\x1b[1m', `sonos-sim: ${speakers.length} speaker(s)${config.silent ? ' [silent]' : ''}`))
  for (const sp of speakers) console.log(`  ${sp.name}  uuid=${sp.uuid}  http://${shownIp}:${sp.port}/xml/device_description.xml`)
  console.log(`LAN IPs: ${ips.join(', ') || '(none)'}${config.logFile ? `   log: ${config.logFile}` : ''}`)
  console.log(KEY_HELP)
  console.log('HTTP: GET|POST http://<ip>:<port>/sim/{' + Object.values(FAULT_KEYS).join('|') + '|state}')

  const ssdp = config.ssdp ? startSsdp({ speakers, server: SERVER_HEADER, forcedIp: config.ip, log }) : null

  let closing = false
  const shutdown = () => {
    if (closing) return
    closing = true
    log('STATE', 'shutting down')
    ssdp?.close()
    for (const sp of speakers) sp.engine.dispose()
    media.clear()
    for (const s of servers) { s.closeAllConnections?.(); s.close() }
    log.close()
    setTimeout(() => process.exit(0), 150)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  // Faults from the keyboard hit every simulated speaker.
  const onKey = (ch) => {
    const k = ch.toLowerCase()
    if (k === 'q') return shutdown()
    if (k === 'h') return console.log(KEY_HELP)
    if (k === 'i') return speakers.forEach((sp) => console.log(`${sp.name}: ${sp.engine.summary()}`))
    if (!FAULT_KEYS[k]) return
    speakers.forEach((sp) => sp.faults.apply(k))
  }
  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin)
    process.stdin.setRawMode(true)
    process.stdin.on('keypress', (str, key) => {
      if (key?.ctrl && key.name === 'c') return shutdown()
      if (str) onKey(str)
    })
  } else {
    process.stdin.on('data', (d) => { for (const ch of String(d)) if (ch.trim()) onKey(ch) })
  }
}
