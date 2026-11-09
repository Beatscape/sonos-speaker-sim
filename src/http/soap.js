// SOAP envelope parsing/building and UPnP faults.

export const escapeXml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

export const unescapeXml = (s) =>
  String(s ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

// UPnP error codes this simulator emits.
export const FAULT = {
  INVALID_ACTION: [401, 'Invalid Action'],
  INVALID_ARGS: [402, 'Invalid Args'],
  ACTION_FAILED: [501, 'Action Failed'],
  TRANSITION_NOT_AVAILABLE: [701, 'Transition not available'],
  SEEK_MODE_NOT_SUPPORTED: [710, 'Seek mode not supported'],
  ILLEGAL_SEEK_TARGET: [711, 'Illegal seek target'],
  ILLEGAL_MIME: [714, 'Illegal MIME-Type']
}

export class UpnpError extends Error {
  constructor([code, description], detail) {
    super(detail || description)
    this.upnpCode = code
    this.description = description
  }
}

// -> { serviceType, action, args } ; args values are XML-unescaped once.
export function parseSoapRequest(headers, body) {
  const header = String(headers?.soapaction ?? headers?.SOAPACTION ?? '').replace(/"/g, '').trim()
  let serviceType = null
  let action = null
  if (header.includes('#')) [serviceType, action] = header.split('#')
  const text = String(body || '')
  if (!action) {
    const m = /<(?:[A-Za-z0-9_-]+:)?([A-Za-z]+)\s+xmlns:[A-Za-z0-9_-]+="(urn:schemas-upnp-org:service:[^"]+)"/.exec(text)
    if (m) [, action, serviceType] = m
  }
  if (!action) throw new UpnpError(FAULT.INVALID_ACTION, 'Missing SOAP action')
  const elem = new RegExp(`<(?:[A-Za-z0-9_-]+:)?${action}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</(?:[A-Za-z0-9_-]+:)?${action}>)`).exec(text)
  const args = {}
  for (const m of (elem?.[1] || '').matchAll(/<([A-Za-z][A-Za-z0-9_]*)>([\s\S]*?)<\/\1>/g)) args[m[1]] = unescapeXml(m[2])
  return { serviceType, action, args }
}

const NS_ENV = 'xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"'

// `fields` is an ordered plain object; values are escaped here.
export function buildSoapResponse(serviceType, action, fields = {}) {
  const inner = Object.entries(fields)
    .map(([k, v]) => `<${k}>${escapeXml(v)}</${k}>`)
    .join('')
  return `<?xml version="1.0" encoding="utf-8"?><s:Envelope ${NS_ENV}><s:Body><u:${action}Response xmlns:u="${serviceType}">${inner}</u:${action}Response></s:Body></s:Envelope>`
}

export function buildSoapFault(code, description) {
  return `<?xml version="1.0" encoding="utf-8"?><s:Envelope ${NS_ENV}><s:Body><s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail><UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>${code}</errorCode><errorDescription>${escapeXml(description)}</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>`
}

export const hms = (sec) => {
  const s = Math.max(0, Math.floor(Number(sec) || 0))
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export const parseHms = (value) => {
  const p = String(value ?? '').trim().split(':').map(Number)
  if (p.length !== 3 || p.some((n) => !Number.isFinite(n) || n < 0)) return null
  return p[0] * 3600 + p[1] * 60 + p[2]
}
