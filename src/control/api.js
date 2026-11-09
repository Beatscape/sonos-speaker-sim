// /sim/* control endpoints (GET or POST), handy for scripting fault scenarios.
import { FAULT_KEYS, resolveFaultKey } from '../faults.js'

const sendJson = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

export function handleControl(req, res, url, { engine, faults }) {
  const name = url.pathname.replace(/^\/sim\/?/, '')
  if (name === '' || name === 'state' || name === 'i') {
    return sendJson(res, 200, { ...engine.snapshot(), faults: faults.active() })
  }
  const key = resolveFaultKey(name)
  if (!key) return sendJson(res, 404, { error: `unknown fault "${name}"`, faults: Object.values(FAULT_KEYS) })
  const seconds = Number(url.searchParams.get('seconds') ?? url.searchParams.get('sec'))
  if (key === 'o' && seconds > 0) faults.goOffline(seconds)
  else faults.apply(key)
  sendJson(res, 200, { applied: FAULT_KEYS[key], ...engine.snapshot(), faults: faults.active() })
}
