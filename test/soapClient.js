// Minimal SOAP client used only by the tests.
export async function buildSoapEnvelopeForTest(url, service, action, inner) {
  const body = `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:${action} xmlns:u="${service}">${inner}</u:${action}></s:Body></s:Envelope>`
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPACTION: `"${service}#${action}"` }, body })
  return { status: res.status, text: await res.text() }
}
