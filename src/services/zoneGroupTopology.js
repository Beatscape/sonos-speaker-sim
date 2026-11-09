// ZoneGroupTopology.GetZoneGroupState: every simulated speaker is reported as its own
// single-member group whose coordinator is itself.
import { escapeXml } from '../http/soap.js'

export function buildZoneGroupState(speakers, ip) {
  const groups = speakers
    .map(
      (sp) =>
        `<ZoneGroup Coordinator="${sp.uuid}" ID="${sp.uuid}:1">` +
        `<ZoneGroupMember UUID="${sp.uuid}" Location="http://${ip}:${sp.port}/xml/device_description.xml" ` +
        `ZoneName="${escapeXml(sp.name)}" Icon="x-rincon-roomicon:living" Configuration="1" SoftwareVersion="70.3-88200" ` +
        `SWGen="2" BootSeq="1" WirelessMode="1" WifiEnabled="1" EthLink="1" Orientation="0" IdleState="1"/></ZoneGroup>`
    )
    .join('')
  return `<ZoneGroups>${groups}</ZoneGroups>`
}

// `topology()` returns [{ uuid, name, port }] for every simulated speaker.
export function createZoneGroupTopology(self, topology) {
  return {
    GetZoneGroupState: (_args, ctx) => ({
      fields: {
        ZoneGroupState: buildZoneGroupState(topology(), ctx.ip),
        ZoneGroupName: self.name,
        ZoneGroupID: `${self.uuid}:1`,
        ZonePlayerUUIDsInGroup: self.uuid
      },
      note: `${topology().length} zone(s), coordinator=${self.uuid}`,
      kind: 'query'
    })
  }
}
