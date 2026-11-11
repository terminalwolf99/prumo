import { brtStamp } from './brt.ts'
import type { SlipData, SubmissionData } from './db.ts'
import { formatCode } from './slip.ts'

export type Kind = 'confirmed' | 'waitlisted' | 'promoted' | 'drop_approved' | 'drop_rejected' | 'removed'

export const WITH_SLIP: Kind[] = ['confirmed', 'promoted']

const SHELL = (schoolName: string, first: string, body: string, appUrl: string) =>
  `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4efe6;font-family:Arial,Helvetica,sans-serif;color:#17212a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#003582;padding:22px 28px;color:#ffffff;font-size:12px;letter-spacing:.12em;font-weight:bold">PRUMO · ${esc(schoolName.toUpperCase())}</td></tr>
<tr><td style="padding:28px 28px 8px;font-size:16px;line-height:1.55">
<p style="margin:0 0 14px">Olá, ${esc(first)}!</p>
${body}
</td></tr>
<tr><td style="padding:4px 28px 28px"><a href="${esc(appUrl)}" style="display:inline-block;background:#003582;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:bold;font-size:15px">Abrir o Prumo</a></td></tr>
<tr><td style="padding:16px 28px;background:#faf7f1;color:#5f6f7a;font-size:12px">Mensagem automática do Prumo · ${esc(schoolName)} · Florianópolis/SC</td></tr>
</table></td></tr></table></body></html>`

// Receipt e-mail for a ranking submission: confirms the order and attaches the PDF.
export function composeRanking(d: SubmissionData, appUrl: string) {
  const first = d.full_name.split(' ')[0]
  const when = brtStamp(d.created_at)
  const days = d.days
    .map((day) =>
      `<p style="margin:0 0 6px"><b>${esc(day.label)}</b><br>${
        day.options.map((o) => `${o.rank}. ${esc(o.title)}`).join('<br>')
      }</p>`
    )
    .join('\n')
  const body = [
    `<p style="margin:0 0 14px">Sua inscrição em <b>${esc(d.round_title)}</b> foi registrada em ${when} (horário de Brasília). Código <b>${formatCode(d.code)}</b>.</p>`,
    `<p style="margin:0 0 10px">Sua ordem de preferência:</p>`,
    days,
    `<p style="margin:14px 0 0">O comprovante em PDF está em anexo.</p>`,
  ].join('\n')
  const text = `Olá, ${first}!\n\nSua inscrição em ${d.round_title} foi registrada em ${when} (horário de Brasília). Código ${formatCode(d.code)}.\n\n` +
    d.days.map((day) => `${day.label}:\n${day.options.map((o) => `  ${o.rank}. ${o.title}`).join('\n')}`).join('\n\n') +
    `\n\nO comprovante em PDF está em anexo.\n${appUrl}\n`
  return { subject: `Inscrição registrada: ${d.round_title}`, html: SHELL(d.school_name, first, body, appUrl), text }
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

export function compose(kind: Kind, d: SlipData, appUrl: string) {
  const first = d.full_name.split(' ')[0]
  const course = d.course_title
  const when = brtStamp(d.applied_at)
  const code = formatCode(d.code)
  let subject: string
  let lines: string[]

  switch (kind) {
    case 'confirmed':
      subject = `Vaga confirmada: ${course}`
      lines = [
        `Sua vaga em <b>${esc(course)}</b> está garantida.`,
        `Inscrição registrada em ${when} (horário de Brasília). Código <b>${code}</b>.`,
        'O comprovante está em anexo, em PDF.',
      ]
      break
    case 'promoted':
      subject = `Vaga confirmada (lista de espera): ${course}`
      lines = [
        `Abriu uma vaga em <b>${esc(course)}</b> e ela foi atribuída a você, pela ordem da lista de espera.`,
        `Sua inscrição original foi registrada em ${when}. Código <b>${code}</b>.`,
        'O comprovante está em anexo, em PDF.',
      ]
      break
    case 'waitlisted':
      subject = `Lista de espera: ${course}`
      lines = [
        `As vagas de <b>${esc(course)}</b> já tinham acabado, então você entrou na lista de espera` +
          (d.waitlist_position ? `, na posição <b>${d.waitlist_position}</b>.` : '.'),
        'Se uma vaga abrir, ela vai automaticamente para a próxima pessoa da fila, e você recebe o comprovante por e-mail.',
        `Inscrição registrada em ${when} (horário de Brasília).`,
      ]
      break
    case 'drop_approved':
      subject = `Desistência aprovada: ${course}`
      lines = [
        `Seu pedido de desistência de <b>${esc(course)}</b> foi aprovado, e a vaga foi liberada.`,
        ...(d.end_note ? [`Observação: ${esc(d.end_note)}`] : []),
      ]
      break
    case 'drop_rejected':
      subject = `Desistência não aprovada: ${course}`
      lines = [
        `Seu pedido de desistência de <b>${esc(course)}</b> não foi aprovado. Sua vaga continua garantida.`,
        ...(d.end_note ? [`Observação: ${esc(d.end_note)}`] : []),
      ]
      break
    case 'removed':
      subject = `Inscrição cancelada: ${course}`
      lines = [
        `Sua inscrição em <b>${esc(course)}</b> foi cancelada pela coordenação.`,
        ...(d.end_note ? [`Motivo: ${esc(d.end_note)}`] : []),
        'Em caso de dúvida, fale com a coordenação.',
      ]
      break
  }

  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4efe6;font-family:Arial,Helvetica,sans-serif;color:#17212a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#003582;padding:22px 28px;color:#ffffff;font-size:12px;letter-spacing:.12em;font-weight:bold">PRUMO · ${esc(d.school_name.toUpperCase())}</td></tr>
<tr><td style="padding:28px 28px 8px;font-size:16px;line-height:1.55">
<p style="margin:0 0 14px">Olá, ${esc(first)}!</p>
${lines.map((l) => `<p style="margin:0 0 14px">${l}</p>`).join('\n')}
</td></tr>
<tr><td style="padding:4px 28px 28px"><a href="${esc(appUrl)}" style="display:inline-block;background:#003582;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:bold;font-size:15px">Ver minhas inscrições</a></td></tr>
<tr><td style="padding:16px 28px;background:#faf7f1;color:#5f6f7a;font-size:12px">Mensagem automática do Prumo · ${esc(d.school_name)} · Florianópolis/SC</td></tr>
</table></td></tr></table></body></html>`

  const text = `Olá, ${first}!\n\n${lines.map((l) => l.replace(/<[^>]+>/g, '')).join('\n\n')}\n\n${appUrl}\n`
  return { subject, html, text }
}
