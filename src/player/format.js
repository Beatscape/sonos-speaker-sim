export const hmsOrDash = (sec) => {
  const s = Math.max(0, Math.floor(Number(sec) || 0))
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
