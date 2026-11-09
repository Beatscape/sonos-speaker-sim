# Protocol notes

All control requests are `POST` with `SOAPACTION: "<serviceType>#<Action>"` and a SOAP 1.1 envelope. Unknown actions return HTTP 500 with a UPnP fault.

| Service | Control URL |
| --- | --- |
| AVTransport | `/MediaRenderer/AVTransport/Control` |
| RenderingControl | `/MediaRenderer/RenderingControl/Control` |
| GroupRenderingControl | `/MediaRenderer/GroupRenderingControl/Control` |
| ZoneGroupTopology | `/ZoneGroupTopology/Control` |

Device description: `GET /xml/device_description.xml`.

## Supported actions

AVTransport: `SetAVTransportURI`, `SetNextAVTransportURI`, `Play`, `Pause`, `Stop`, `Next`, `Previous`, `Seek` (`REL_TIME`, `TRACK_NR`), `GetPositionInfo`, `GetTransportInfo`, `GetMediaInfo`, `GetTransportSettings`, `GetDeviceCapabilities`, `GetCurrentTransportActions`, `SetCrossfadeMode`, `GetCrossfadeMode`, `BecomeCoordinatorOfStandaloneGroup` (ack only).

RenderingControl: `GetVolume`, `SetVolume`, `GetMute`, `SetMute`.

GroupRenderingControl: `GetGroupVolume`, `SetGroupVolume`, `SnapshotGroupVolume`, `GetGroupMute`, `SetGroupMute`, `SetRelativeGroupVolume`.

ZoneGroupTopology: `GetZoneGroupState`.

## Faults returned

| Code | Meaning | When |
| --- | --- | --- |
| 401 | Invalid Action | unknown action |
| 402 | Invalid Args | `Seek` without `Target` |
| 501 | Action Failed | unexpected error |
| 701 | Transition not available | `Play` with no URI, `Pause` when not playing, `Seek` with no loaded track, `Next` with no queue |
| 710 | Seek mode not supported | `Seek` unit other than `REL_TIME`/`TRACK_NR` |
| 711 | Illegal seek target | `Seek` beyond the duration or malformed time |
| 714 | Illegal MIME-Type | URI that is not `http(s)://` or `x-rincon:` |

```xml
<s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail>
<UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>401</errorCode><errorDescription>Invalid Action</errorDescription></UPnPError>
</detail></s:Fault>
```

## Sample responses

`GetTransportInfo`

```xml
<u:GetTransportInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><CurrentTransportState>PLAYING</CurrentTransportState><CurrentTransportStatus>OK</CurrentTransportStatus><CurrentSpeed>1</CurrentSpeed></u:GetTransportInfoResponse>
```

States: `PLAYING`, `PAUSED_PLAYBACK`, `STOPPED`, `TRANSITIONING` (while a stream is being fetched and for ~300 ms between gapless tracks).

`GetPositionInfo`: `Track`, `TrackDuration`, `TrackMetaData` (the DIDL-Lite you sent, XML-escaped, or `NOT_IMPLEMENTED`), `TrackURI`, `RelTime`, `AbsTime`, `RelCount`, `AbsCount`. Times are `H:MM:SS`. `TrackDuration` is `0:00:00` until the stream has been fetched; position reads `0:00:00` when stopped.

`GetZoneGroupState`: `ZoneGroupState` holds XML-escaped `<ZoneGroups><ZoneGroup Coordinator=... ID=...><ZoneGroupMember UUID=... Location=... ZoneName=.../>...`, one single-member group per simulated speaker.

## Playback model

- `SetAVTransportURI` stops playback, resets position to 0, clears the queued next URI and starts fetching the stream (so a bad URL is logged immediately).
- `Play` fetches (cached) then plays; position advances with the clock.
- At end of track: queued next URI present -> `TRANSITIONING` for 300 ms, then `PLAYING` the new track with the queue emptied. Otherwise `STOPPED`.
- `x-rincon:<uuid>` URIs (group join) are acknowledged without changing state.

## SSDP

Answers `M-SEARCH` for `ssdp:all`, `upnp:rootdevice`, `urn:schemas-upnp-org:device:ZonePlayer:1`, `urn:schemas-upnp-org:device:MediaRenderer:1` with a unicast `HTTP/1.1 200 OK` carrying `LOCATION`, `SERVER: Linux UPnP/1.0 Sonos/... (ZPSIM)`, `ST`, `USN: uuid:RINCON_<id>::<ST>`. `ssdp:all` yields one datagram per concrete target. Does not send `NOTIFY` advertisements.
