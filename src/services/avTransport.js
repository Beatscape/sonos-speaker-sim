// AVTransport actions mapped onto the player engine.
import { FAULT, UpnpError, hms, parseHms } from '../http/soap.js'

const short = (u) => {
  const s = String(u || '').replace(/^https?:\/\//, '')
  return s.length > 64 ? `${s.slice(0, 24)}...${s.slice(-36)}` : s || '(none)'
}

export function createAvTransport(engine, { faults }) {
  const ctl = (note = '') => ({ fields: {}, note, kind: 'control' })
  return {
    SetAVTransportURI: (a) => {
      const uri = a.CurrentURI ?? ''
      if (/^x-rincon:/i.test(uri)) return ctl(`join ${uri} (acknowledged, grouping is not simulated)`)
      if (uri && !/^https?:\/\//i.test(uri)) throw new UpnpError(FAULT.ILLEGAL_MIME, `Unsupported URI scheme: ${uri.slice(0, 40)}`)
      engine.setUri(uri, a.CurrentURIMetaData ?? '')
      return ctl(`uri=${short(uri)}`)
    },
    SetNextAVTransportURI: (a) => {
      const uri = a.NextURI ?? ''
      if (uri && !/^https?:\/\//i.test(uri)) throw new UpnpError(FAULT.ILLEGAL_MIME, `Unsupported URI scheme: ${uri.slice(0, 40)}`)
      if (faults?.consumeDropNext()) return ctl(`next DROPPED by fault: ${short(uri)}`)
      engine.setNextUri(uri, a.NextURIMetaData ?? '')
      const left = engine.duration ? ` remaining=${(engine.duration - engine.position()).toFixed(1)}s` : ''
      return ctl(`next=${short(uri)}${left}`)
    },
    Play: () => (engine.play(), ctl()),
    Pause: () => (engine.pause(), ctl()),
    Stop: () => (engine.stop('Stop'), ctl()),
    Next: () => (engine.next('Next'), ctl()),
    Previous: () => (engine.previous(), ctl()),
    Seek: (a) => {
      const unit = String(a.Unit || '').toUpperCase()
      if (unit === 'TRACK_NR') return engine.seek(0), ctl('TRACK_NR -> 0')
      if (unit !== 'REL_TIME') throw new UpnpError(FAULT.SEEK_MODE_NOT_SUPPORTED)
      if (a.Target === undefined) throw new UpnpError(FAULT.INVALID_ARGS, 'Missing Target')
      const t = parseHms(a.Target)
      if (t === null) throw new UpnpError(FAULT.ILLEGAL_SEEK_TARGET)
      engine.seek(t)
      return ctl(`REL_TIME ${a.Target}`)
    },
    GetPositionInfo: () => {
      const rel = hms(engine.reportedPosition())
      const dur = engine.track ? hms(engine.duration) : '0:00:00'
      return {
        fields: {
          Track: engine.uri ? 1 : 0,
          TrackDuration: dur,
          TrackMetaData: engine.meta || 'NOT_IMPLEMENTED',
          TrackURI: engine.uri,
          RelTime: rel,
          AbsTime: rel,
          RelCount: 2147483647,
          AbsCount: 2147483647
        },
        note: `RelTime=${rel} TrackDuration=${dur}`,
        kind: 'query'
      }
    },
    GetTransportInfo: () => ({
      fields: { CurrentTransportState: engine.transport, CurrentTransportStatus: 'OK', CurrentSpeed: '1' },
      note: engine.transport + (engine.frozen ? ' (FROZEN)' : ''),
      kind: 'query'
    }),
    GetMediaInfo: () => ({
      fields: {
        NrTracks: engine.uri ? 1 : 0,
        MediaDuration: engine.track ? hms(engine.duration) : '0:00:00',
        CurrentURI: engine.uri,
        CurrentURIMetaData: engine.meta,
        NextURI: engine.nextUri,
        NextURIMetaData: engine.nextMeta,
        PlayMedium: 'NETWORK',
        RecordMedium: 'NOT_IMPLEMENTED',
        WriteStatus: 'NOT_IMPLEMENTED'
      },
      note: `next=${short(engine.nextUri)}`,
      kind: 'query'
    }),
    GetTransportSettings: () => ({ fields: { PlayMode: 'NORMAL', RecQualityMode: 'NOT_IMPLEMENTED' }, note: '', kind: 'query' }),
    GetDeviceCapabilities: () => ({
      fields: { PlayMedia: 'NETWORK', RecMedia: 'NOT_IMPLEMENTED', RecQualityModes: 'NOT_IMPLEMENTED' },
      note: '',
      kind: 'query'
    }),
    GetCurrentTransportActions: () => ({ fields: { Actions: 'Play,Pause,Stop,Seek,Next' }, note: '', kind: 'query' }),
    SetCrossfadeMode: (a) => {
      engine.crossfade = String(a.CrossfadeMode).trim() === '1'
      return { fields: {}, note: `CrossfadeMode=${engine.crossfade ? 1 : 0} (${engine.crossfade ? 'ON' : 'OFF'})`, kind: 'crossfade' }
    },
    GetCrossfadeMode: () => ({ fields: { CrossfadeMode: engine.crossfade ? 1 : 0 }, note: `-> ${engine.crossfade ? 1 : 0}`, kind: 'query' }),
    BecomeCoordinatorOfStandaloneGroup: () => ({
      fields: { DelegatedGroupCoordinatorID: '', NewGroupID: '' },
      note: 'ack',
      kind: 'control'
    })
  }
}
