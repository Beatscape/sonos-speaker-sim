// Pick the local IPv4 address a given peer can reach us on.
import os from 'node:os'

export const listIPv4 = (interfaces = os.networkInterfaces()) => {
  const out = []
  for (const list of Object.values(interfaces)) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i)
  }
  return out
}

export const stripV6Prefix = (addr) => String(addr || '').replace(/^::ffff:/, '')

const ipToInt = (ip) => ip.split('.').reduce((acc, n) => ((acc << 8) | Number(n)) >>> 0, 0)

// Address on the same subnet as `remote`; otherwise the first LAN address; else loopback.
export const localIpFor = (remote, { forced = null, interfaces = os.networkInterfaces() } = {}) => {
  if (forced) return forced
  const list = listIPv4(interfaces)
  const r = stripV6Prefix(remote)
  if (/^\d+\.\d+\.\d+\.\d+$/.test(r)) {
    for (const i of list) {
      const mask = ipToInt(i.netmask)
      if ((ipToInt(i.address) & mask) === (ipToInt(r) & mask)) return i.address
    }
    if (r.startsWith('127.')) return '127.0.0.1'
  }
  return list[0]?.address || '127.0.0.1'
}
