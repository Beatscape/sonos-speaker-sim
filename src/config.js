// CLI option parsing and speaker identity.
import { parseArgs } from 'node:util'
import crypto from 'node:crypto'

export const DEFAULTS = {
  port: 1400,
  name: 'Sonos Sim',
  count: 1,
  offlineSeconds: 60,
  offlineMode: 'hang'
}

export const OPTIONS = {
  port: { type: 'string', short: 'p' },
  name: { type: 'string', short: 'n' },
  ip: { type: 'string' },
  count: { type: 'string' },
  silent: { type: 'boolean' },
  'fake-duration': { type: 'string' },
  quiet: { type: 'boolean', short: 'q' },
  log: { type: 'string' },
  'no-ssdp': { type: 'boolean' },
  'offline-seconds': { type: 'string' },
  'offline-mode': { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' }
}

const positiveInt = (raw, label, def, max = Infinity) => {
  if (raw === undefined) return def
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`Invalid ${label}: ${raw}`)
  return n
}

export function parseConfig(argv) {
  const { values } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: false })
  const offlineMode = values['offline-mode'] ?? DEFAULTS.offlineMode
  if (!['hang', 'drop'].includes(offlineMode)) throw new Error(`Invalid --offline-mode: ${offlineMode} (hang|drop)`)
  let fakeDuration = null
  if (values['fake-duration'] !== undefined) {
    fakeDuration = Number(values['fake-duration'])
    if (!Number.isFinite(fakeDuration) || fakeDuration <= 0) throw new Error(`Invalid --fake-duration: ${values['fake-duration']}`)
  }
  return {
    port: positiveInt(values.port, '--port', DEFAULTS.port, 65535),
    name: values.name || DEFAULTS.name,
    ip: values.ip || null,
    count: positiveInt(values.count, '--count', DEFAULTS.count, 50),
    silent: Boolean(values.silent),
    fakeDuration,
    quiet: Boolean(values.quiet),
    logFile: values.log || null,
    ssdp: !values['no-ssdp'],
    offlineSeconds: positiveInt(values['offline-seconds'], '--offline-seconds', DEFAULTS.offlineSeconds),
    offlineMode,
    help: Boolean(values.help),
    version: Boolean(values.version)
  }
}

// Sonos-style UDN body: RINCON_<12 hex of a stable hash><5-digit port>.
export const deriveUuid = (name, port) =>
  `RINCON_${crypto.createHash('md5').update(`${name}:${port}`).digest('hex').slice(0, 12).toUpperCase()}${String(port).padStart(5, '0')}`

export const HELP_TEXT = `sonos-sim - fake Sonos speaker for testing controller apps

Usage: sonos-sim [options]

  -p, --port <n>           HTTP port (default 1400; with --count, N consecutive ports)
  -n, --name <text>        room name (default "Sonos Sim")
      --count <n>          simulate n speakers on consecutive ports
      --ip <addr>          advertise this IPv4 instead of auto-detecting
      --silent             no audio output (duration from --fake-duration or file size)
      --fake-duration <s>  force every track to this duration
  -q, --quiet              hide routine polling lines from the console
      --log <file>         append JSON lines to this file
      --no-ssdp            do not answer SSDP (manual IP add only)
      --offline-seconds <n>  length of the offline fault (default 60)
      --offline-mode <m>   hang (no reply, default) | drop (close sockets)
  -h, --help
  -v, --version

Keys: p pause | s stop | f freeze | v volume=5 | d drop next | o offline | r recover | i state | h help | q quit
HTTP: GET|POST /sim/{pause|stop|freeze|volume|dropnext|offline|recover|state}
`
