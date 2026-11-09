// /xml/device_description.xml, laid out like a real ZonePlayer: the root device holds
// ZoneGroupTopology; a nested MediaRenderer holds the transport/volume services.
import { escapeXml } from '../http/soap.js'

export const SERVICES = {
  avTransport: { type: 'urn:schemas-upnp-org:service:AVTransport:1', id: 'AVTransport', control: '/MediaRenderer/AVTransport/Control' },
  renderingControl: { type: 'urn:schemas-upnp-org:service:RenderingControl:1', id: 'RenderingControl', control: '/MediaRenderer/RenderingControl/Control' },
  groupRenderingControl: { type: 'urn:schemas-upnp-org:service:GroupRenderingControl:1', id: 'GroupRenderingControl', control: '/MediaRenderer/GroupRenderingControl/Control' },
  zoneGroupTopology: { type: 'urn:schemas-upnp-org:service:ZoneGroupTopology:1', id: 'ZoneGroupTopology', control: '/ZoneGroupTopology/Control' }
}

export const MODEL_NAME = 'Sonos Sim'
export const SOFTWARE_VERSION = '70.3-88200'

const serviceXml = (s) =>
  `<service><serviceType>${s.type}</serviceType><serviceId>urn:upnp-org:serviceId:${s.id}</serviceId>` +
  `<controlURL>${s.control}</controlURL><eventSubURL>${s.control.replace(/Control$/, 'Event')}</eventSubURL>` +
  `<SCPDURL>/xml/${s.id}1.xml</SCPDURL></service>`

export function buildDeviceDescription({ ip, name, uuid }) {
  const { avTransport, renderingControl, groupRenderingControl, zoneGroupTopology } = SERVICES
  return (
    `<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><specVersion><major>1</major><minor>0</minor></specVersion>` +
    `<device><deviceType>urn:schemas-upnp-org:device:ZonePlayer:1</deviceType>` +
    `<friendlyName>${escapeXml(ip)} - ${MODEL_NAME}</friendlyName><manufacturer>Sonos, Inc.</manufacturer>` +
    `<modelNumber>SIM1</modelNumber><modelDescription>Sonos Simulator</modelDescription><modelName>${MODEL_NAME}</modelName>` +
    `<softwareVersion>${SOFTWARE_VERSION}</softwareVersion><UDN>uuid:${uuid}</UDN><roomName>${escapeXml(name)}</roomName>` +
    `<serviceList>${serviceXml(zoneGroupTopology)}</serviceList>` +
    `<deviceList><device><deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>` +
    `<friendlyName>${escapeXml(name)} - ${MODEL_NAME} Media Renderer</friendlyName><manufacturer>Sonos, Inc.</manufacturer>` +
    `<modelName>${MODEL_NAME}</modelName><UDN>uuid:${uuid}_MR</UDN>` +
    `<serviceList>${serviceXml(renderingControl)}${serviceXml(avTransport)}${serviceXml(groupRenderingControl)}</serviceList>` +
    `</device></deviceList></device></root>`
  )
}
