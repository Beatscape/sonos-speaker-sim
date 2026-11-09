// GroupRenderingControl: group volume. A simulated group has exactly one member, so
// group volume and speaker volume are the same value.
export function createGroupRenderingControl(engine) {
  return {
    GetGroupVolume: () => ({ fields: { CurrentVolume: engine.volume }, note: `-> ${engine.volume}`, kind: 'query' }),
    SetGroupVolume: (a) => {
      engine.setVolume(a.DesiredVolume, 'SetGroupVolume')
      return { fields: {}, note: `DesiredVolume=${a.DesiredVolume}`, kind: 'volume' }
    },
    SnapshotGroupVolume: () => ({ fields: {}, note: 'ack', kind: 'volume' }),
    GetGroupMute: () => ({ fields: { CurrentMute: engine.mute ? 1 : 0 }, note: '', kind: 'query' }),
    SetGroupMute: (a) => {
      engine.mute = String(a.DesiredMute).trim() === '1'
      return { fields: {}, note: `DesiredMute=${a.DesiredMute}`, kind: 'volume' }
    },
    SetRelativeGroupVolume: (a) => {
      engine.setVolume(engine.volume + Number(a.Adjustment || 0), 'SetRelativeGroupVolume')
      return { fields: { NewVolume: engine.volume }, note: `Adjustment=${a.Adjustment}`, kind: 'volume' }
    }
  }
}
