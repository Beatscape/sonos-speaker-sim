// RenderingControl: per-speaker volume and mute.
export function createRenderingControl(engine) {
  return {
    GetVolume: () => ({ fields: { CurrentVolume: engine.volume }, note: `-> ${engine.volume}`, kind: 'query' }),
    SetVolume: (a) => {
      engine.setVolume(a.DesiredVolume, 'SetVolume')
      return { fields: {}, note: `DesiredVolume=${a.DesiredVolume}`, kind: 'volume' }
    },
    GetMute: () => ({ fields: { CurrentMute: engine.mute ? 1 : 0 }, note: '', kind: 'query' }),
    SetMute: (a) => {
      engine.mute = String(a.DesiredMute).trim() === '1'
      return { fields: {}, note: `DesiredMute=${a.DesiredMute}`, kind: 'volume' }
    }
  }
}
