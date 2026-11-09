import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSoapRequest, buildSoapResponse, buildSoapFault, escapeXml, unescapeXml, hms, parseHms, UpnpError, FAULT } from '../src/http/soap.js'

const AVT = 'urn:schemas-upnp-org:service:AVTransport:1'
const env = (action, inner) => `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:${action} xmlns:u="${AVT}">${inner}</u:${action}></s:Body></s:Envelope>`

test('parses action and unescaped args from SOAPACTION header', () => {
  const body = env('SetAVTransportURI', '<InstanceID>0</InstanceID><CurrentURI>http://h/a.mp3?x=1&amp;y=2</CurrentURI><CurrentURIMetaData>&lt;DIDL-Lite/&gt;</CurrentURIMetaData>')
  const r = parseSoapRequest({ soapaction: `"${AVT}#SetAVTransportURI"` }, body)
  assert.equal(r.action, 'SetAVTransportURI')
  assert.equal(r.serviceType, AVT)
  assert.equal(r.args.CurrentURI, 'http://h/a.mp3?x=1&y=2')
  assert.equal(r.args.CurrentURIMetaData, '<DIDL-Lite/>')
})

test('falls back to the body element when SOAPACTION is missing', () => {
  const r = parseSoapRequest({}, env('Play', '<InstanceID>0</InstanceID><Speed>1</Speed>'))
  assert.equal(r.action, 'Play')
  assert.equal(r.args.Speed, '1')
})

test('self-closing action element yields empty args', () => {
  const r = parseSoapRequest({ soapaction: `"${AVT}#Stop"` }, `<s:Body><u:Stop xmlns:u="${AVT}"/></s:Body>`)
  assert.deepEqual(r.args, {})
})

test('no action at all is an Invalid Action fault', () => {
  assert.throws(() => parseSoapRequest({}, '<x/>'), (e) => e instanceof UpnpError && e.upnpCode === 401)
})

test('response escapes values and wraps in <Action>Response', () => {
  const xml = buildSoapResponse(AVT, 'GetPositionInfo', { TrackURI: 'http://h/?a=1&b=2', RelTime: '0:00:05' })
  assert.match(xml, /<u:GetPositionInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">/)
  assert.match(xml, /<TrackURI>http:\/\/h\/\?a=1&amp;b=2<\/TrackURI>/)
})

test('fault carries UPnPError code and description', () => {
  const xml = buildSoapFault(401, 'Invalid Action')
  assert.match(xml, /<errorCode>401<\/errorCode>/)
  assert.match(xml, /<errorDescription>Invalid Action<\/errorDescription>/)
  assert.deepEqual(FAULT.TRANSITION_NOT_AVAILABLE, [701, 'Transition not available'])
})

test('escape/unescape round trip', () => {
  const s = `<a href="x">&'</a>`
  assert.equal(unescapeXml(escapeXml(s)), s)
})

test('hms formatting and parsing, including edges', () => {
  assert.equal(hms(0), '0:00:00')
  assert.equal(hms(3725.9), '1:02:05')
  assert.equal(hms(-4), '0:00:00')
  assert.equal(parseHms('0:03:07'), 187)
  assert.equal(parseHms('NOT_IMPLEMENTED'), null)
  assert.equal(parseHms('1:2'), null)
})
