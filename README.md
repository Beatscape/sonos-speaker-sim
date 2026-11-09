# sonos-speaker-sim

A fake Sonos speaker for testing any UPnP/Sonos controller app (mobile, desktop, scripts) without hardware.

It answers SSDP discovery, serves a Sonos-style device description, implements the SOAP services a controller uses to play audio, keeps a real-clock playback model, and lets you inject the failures that make real speakers annoying: self-pausing, frozen playback, volume resets, dropped next-track queues and going offline.

> Not affiliated with or endorsed by Sonos, Inc. "Sonos" is a trademark of Sonos, Inc. This project reimplements publicly observable UPnP behavior for testing purposes only.

## Features

- SSDP responder (`ssdp:all`, `upnp:rootdevice`, `ZonePlayer:1`, `MediaRenderer:1`) on every IPv4 interface
- Device description with manufacturer `Sonos, Inc.` and the usual control URLs
- AVTransport, RenderingControl, GroupRenderingControl, ZoneGroupTopology (see [docs/protocol.md](docs/protocol.md))
- Real-clock playback: position advances while `PLAYING`, queued next URI is promoted gapless when the track ends, otherwise `STOPPED`
- Fetches every stream URL it is given and logs failures loudly, which proves your media server is reachable from the LAN
- Optional local audio (`afplay` on macOS, `ffplay` elsewhere) or `--silent`
- Fault injection from the keyboard and over HTTP
- `--count N` simulates several speakers
- Zero runtime dependencies, Node >= 20

## Install and run

```sh
npx sonos-speaker-sim --name "Kitchen"
# or from a clone
node bin/sonos-sim.js --name "Kitchen"
```

On start it prints the descriptor URL, for example `http://192.168.1.20:1400/xml/device_description.xml`. Your controller should discover the speaker through SSDP, through a subnet scan of port 1400, or by adding the printed IP manually.

## CLI flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `-p, --port <n>` | `1400` | HTTP port (with `--count`, consecutive ports) |
| `-n, --name <text>` | `Sonos Sim` | Room name (`ZoneName`, `roomName`) |
| `--count <n>` | `1` | Simulate n speakers, names get a numeric suffix |
| `--ip <addr>` | auto | Advertise this IPv4 (VPNs, multiple NICs) |
| `--silent` | off | No audio output. Duration = `--fake-duration`, else file size at 128 kbps |
| `--fake-duration <s>` | none | Force every track to this duration |
| `-q, --quiet` | off | Hide routine polling lines from the console |
| `--log <file>` | none | Append JSON lines (every action, state change, fault) |
| `--no-ssdp` | off | Do not answer multicast |
| `--offline-seconds <n>` | `60` | Length of the offline fault |
| `--offline-mode hang\|drop` | `hang` | Offline: never answer (client timeouts) or close sockets (resets) |

Without `--fake-duration` and not `--silent`, duration is probed with `afinfo` (macOS) or `ffprobe`, falling back to 180 s.

## Fault injection

Keys act on every simulated speaker. The same faults are available per speaker over HTTP.

| Key | HTTP | Effect | A good controller should... |
| --- | --- | --- | --- |
| `p` | `/sim/pause` | Transport becomes `PAUSED_PLAYBACK` on its own | notice and resume |
| `s` | `/sim/stop` | Transport becomes `STOPPED` | notice and redispatch the current/next track |
| `f` | `/sim/freeze` | Still reports `PLAYING`, `RelTime` stuck | detect the stall and restart playback |
| `v` | `/sim/volume` | Volume drops to 5 | detect and restore (or report) the change |
| `d` | `/sim/dropnext` | Queued next URI cleared; the next `SetNextAVTransportURI` is swallowed once | re-queue the next track |
| `o` | `/sim/offline[?seconds=N]` | HTTP unanswered (or reset) and SSDP silent for N s | back off, fall back to another output, reconnect |
| `r` | `/sim/recover` | Clear freeze, offline and dropNext | continue normally |
| `i` | `/sim/state` | Print / return state | |

Other keys: `h` help, `q` quit.

## HTTP control API

`GET` or `POST` to `http://<ip>:<port>/sim/<name>`. Always available, even while "offline". Returns JSON:

```json
{"applied":"pause","transport":"PAUSED_PLAYBACK","frozen":false,"uri":"http://...","nextUri":"","position":12.3,"duration":180,"volume":30,"crossfade":false,"faults":[]}
```

Scripting example:

```sh
SIM=http://192.168.1.20:1400
curl -s $SIM/sim/pause            # speaker pauses itself
sleep 20
curl -s $SIM/sim/state | jq .transport   # did the controller resume it?
curl -s "$SIM/sim/offline?seconds=90"
```

## Troubleshooting

- Same Wi-Fi/LAN as the controller. Guest networks and "AP/client isolation" block device-to-device traffic: the controller will not see the simulator at all.
- Discovery fails but manual IP works: multicast is filtered by the router/AP. Use the manual IP, or `--no-ssdp` to rule SSDP out.
- macOS: allow incoming connections for `node` in the firewall prompt, and grant "Local Network" access to the terminal app.
- Port 1400 busy (real Sonos on the same host, another sim): use `--port`.
- Several network interfaces: pass `--ip` with the address your controller can reach.
- `FETCH-ERR` in the log: the simulator could not download the stream URL. Check the controller's media server address, firewall, and HTTP status.
- Audio does not seek with `afplay`: seeking moves the simulated clock only; use `ffplay` or `--silent`.

## Limitations

Grouping (`x-rincon:`) is acknowledged but not simulated; with `--count N` each speaker reports itself as its own group. No event subscriptions (`SUBSCRIBE`), no SCPD documents, no HTTPS.

## Tests

```sh
npm test
```

Unit tests use an injected clock; the HTTP tests run over loopback only.

## License

MIT, see [LICENSE](LICENSE).
