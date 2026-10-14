import { createClient } from './deps.js'
import { SUPABASE_KEY, SUPABASE_URL } from '../config.js'

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  // The e-mail carries a 6-digit code; detectSessionInUrl also accepts a sign-in
  // link, which is what Supabase sends until the custom e-mail template is enabled.
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
})

export const ACTIVE = ['confirmed', 'waitlisted', 'drop_requested']
export const SEATED = ['confirmed', 'drop_requested']

// Server error codes (raised in SQL) → what people read.
const MESSAGES = {
  not_registered: 'Este e-mail não está cadastrado no Prumo. Fale com a coordenação.',
  only_students: 'Só estudantes podem se inscrever.',
  course_not_found: 'Essa disciplina não está disponível.',
  not_open_yet: 'As inscrições ainda não abriram.',
  closed: 'As inscrições já foram encerradas.',
  grade_not_eligible: 'Essa disciplina não está aberta para o seu ano.',
  already_applied: 'Você já tem inscrição nessa disciplina.',
  removed_by_staff: 'A coordenação cancelou sua inscrição nessa disciplina. Fale com ela para voltar.',
  limit_reached: 'Você já chegou ao limite de escolhas desta rodada.',
  slot_conflict: 'Você já tem uma disciplina nesse mesmo horário.',
  invalid_state: 'Essa ação não vale mais para essa inscrição. A página foi atualizada.',
  reason_required: 'Conte brevemente o motivo.',
  enrollment_not_found: 'Inscrição não encontrada.',
  forbidden: 'Você não tem permissão para isso.',
  course_has_enrollments: 'Essa disciplina já tem inscrições e não pode mudar de rodada.',
  not_a_pdf: 'O arquivo precisa ser um PDF.',
  too_large: 'O PDF passa de 5 MB.',
  no_seat: 'Só há comprovante para vagas confirmadas.',
}

export function friendly(error) {
  const raw = error?.message || String(error ?? '')
  // "student_domain_required|aluno.autonomia.com.br" → names the domain(s) to use
  const dom = /(student|staff)_domain_required\|([^\s"]+)/.exec(raw)
  if (dom) {
    const list = dom[2].split(',').map((d) => `@${d}`).join(' ou ')
    return dom[1] === 'student' ? `Estudantes precisam de um e-mail ${list}.` : `Professores precisam de um e-mail ${list}.`
  }
  for (const [code, text] of Object.entries(MESSAGES)) if (raw.includes(code)) return text
  if (/rate limit|too many|429|security purposes/i.test(raw)) return 'Muitas tentativas seguidas. Espere um minuto e tente de novo.'
  if (/expired|invalid.*(otp|token)|token.*(expired|invalid)/i.test(raw)) return 'Código inválido ou expirado. Confira ou peça um novo.'
  if (/failed to fetch|network|load failed/i.test(raw)) return 'Sem conexão. Verifique a internet e tente de novo.'
  if (/people_email_key|duplicate key/i.test(raw)) return 'Já existe alguém com esse e-mail.'
  if (/enrollments_person_id_fkey/i.test(raw)) return 'Essa pessoa tem inscrições. Desative em vez de excluir.'
  if (/email.*check|people_email_check/i.test(raw)) return 'E-mail inválido.'
  return raw || 'Algo deu errado.'
}

export async function rpc(name, args = {}) {
  const { data, error } = await sb.rpc(name, args)
  if (error) throw error
  return data
}

export async function must(query) {
  const { data, error } = await query
  if (error) throw error
  return data
}

// Reload on any change to the given tables, coalescing bursts (e.g. opening minute).
export function watch(name, tables, reload, delay = 350) {
  let timer
  const soon = () => { clearTimeout(timer); timer = setTimeout(reload, delay) }
  let channel = sb.channel(name)
  for (const t of tables) {
    const [table, filter] = t.split('?')
    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, soon)
  }
  channel.subscribe()
  const onVisible = () => document.visibilityState === 'visible' && soon()
  document.addEventListener('visibilitychange', onVisible)
  const poll = setInterval(() => document.visibilityState === 'visible' && reload(), 60_000)
  return () => {
    clearTimeout(timer)
    clearInterval(poll)
    document.removeEventListener('visibilitychange', onVisible)
    sb.removeChannel(channel)
  }
}
