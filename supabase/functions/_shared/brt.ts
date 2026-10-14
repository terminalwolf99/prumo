// Everything shown to people is in Horário de Brasília.
export const TZ = 'America/Sao_Paulo'

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric',
})
const timeFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

export function brtDate(d: Date | string): string {
  return dateFmt.format(new Date(d))
}

// "19:00:00,342" — milliseconds matter when spots go in order of arrival.
export function brtTimeMs(d: Date | string): string {
  const date = new Date(d)
  const ms = String(date.getUTCMilliseconds()).padStart(3, '0')
  return `${timeFmt.format(date)},${ms}`
}

export function brtStamp(d: Date | string): string {
  return `${brtDate(d)} às ${brtTimeMs(d)}`
}
