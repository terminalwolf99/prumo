// Everything is shown in Horário de Brasília, whatever the device's own zone is,
// and countdowns run on the server's clock, not the phone's.
export const TZ = 'America/Sao_Paulo'

const fmt = (opts) => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, ...opts })
const DATE = fmt({ day: '2-digit', month: '2-digit', year: 'numeric' })
const DAY = fmt({ day: '2-digit', month: '2-digit' })
const TIME = fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const TIME_S = fmt({ hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
const LONG = fmt({ weekday: 'long', day: 'numeric', month: 'long' })
const PARTS = fmt({
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

export const fmtDate = (d) => DATE.format(new Date(d))
export const fmtDay = (d) => DAY.format(new Date(d))
export const fmtTime = (d) => TIME.format(new Date(d))
export const fmtLong = (d) => LONG.format(new Date(d))
export const fmtWhen = (d) => `${fmtDate(d)} às ${fmtTime(d)}`

// "19:00:00,342": arrival order is decided to the millisecond.
export function fmtMs(d) {
  const date = new Date(d)
  return `${TIME_S.format(date)},${String(date.getUTCMilliseconds()).padStart(3, '0')}`
}

function wall(date) {
  const p = {}
  for (const { type, value } of PARTS.formatToParts(date)) p[type] = value
  return p
}

// <input type="datetime-local"> holds Brasília wall time.
export function toLocalInput(d) {
  if (!d) return ''
  const p = wall(new Date(d))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

export function fromLocalInput(value) {
  if (!value) return null
  const asUtc = new Date(`${value}:00Z`)
  const p = wall(asUtc)
  const wallMs = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  return new Date(asUtc.getTime() - (wallMs - asUtc.getTime())).toISOString()
}

let offset = 0
export const serverNow = () => Date.now() + offset

// Take the fastest of a few round trips; good to a few tens of milliseconds.
export async function syncClock(fetchServerTime) {
  let best = null
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now()
    const server = new Date(await fetchServerTime()).getTime()
    const t1 = Date.now()
    if (!best || t1 - t0 < best.rtt) best = { rtt: t1 - t0, off: server - (t0 + t1) / 2 }
  }
  offset = best.off
  return best
}

export function splitMs(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 }
}
