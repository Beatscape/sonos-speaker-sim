// Console logger with colors plus an optional JSON-lines file.
import fs from 'node:fs'

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
}

const TAG_COLOR = {
  SOAP: COLORS.green,
  QUERY: COLORS.dim,
  STATE: COLORS.magenta,
  VOLUME: COLORS.yellow,
  XFADE: COLORS.blue,
  FETCH: COLORS.green,
  'FETCH-ERR': COLORS.red + COLORS.bold,
  FAULT: COLORS.red,
  RECOVER: COLORS.green + COLORS.bold,
  'SOAP-ERR': COLORS.red,
  SSDP: COLORS.cyan,
  HTTP: COLORS.cyan,
  GAPLESS: COLORS.cyan,
  END: COLORS.yellow,
  AUDIO: COLORS.yellow
}

const stamp = () => new Date().toISOString().slice(11, 23)

// `quiet` hides routine polling lines (queries) from the console; the file keeps everything.
export function createLogger({ file = null, quiet = false, color = Boolean(process.stdout.isTTY), out = console.log } = {}) {
  const stream = file ? fs.createWriteStream(file, { flags: 'a' }) : null
  const paint = (c, text) => (color ? `${c}${text}${COLORS.reset}` : text)
  const log = (tag, msg, data = {}, { routine = false } = {}) => {
    if (stream) stream.write(JSON.stringify({ ts: new Date().toISOString(), tag, msg, ...data }) + '\n')
    if (routine && quiet) return
    out(`${paint(COLORS.dim, stamp())} ${paint(TAG_COLOR[tag] || '', tag.padEnd(9))} ${msg}`)
  }
  log.close = () => stream?.end()
  log.paint = paint
  return log
}

export const noopLogger = Object.assign(() => {}, { close() {}, paint: (_c, t) => t })
export { COLORS }
