import { html, useCallback, useEffect, useMemo, useState } from '../lib/deps.js'
import { ACTIVE, friendly, must, rpc, sb, watch } from '../lib/db.js'
import { downloadSlip } from '../lib/slip.js'
import { fmtDate, fmtDay, fmtLong, fmtMs, fmtTime } from '../lib/time.js'
import {
  areaClass, ask, Btn, Countdown, Empty, formatCode, gradesLabel, Modal, SeatMeter, StatusChip, toast, Topbar, useNow,
} from '../lib/ui.js'

function phaseOf(round, now) {
  if (!round) return 'none'
  if (now < new Date(round.opens_at).getTime()) return 'soon'
  if (now < new Date(round.closes_at).getTime()) return 'open'
  return 'closed'
}

// The nearest round that hasn't closed yet; otherwise the latest one.
function pickRound(rounds, now) {
  const live = rounds.filter((r) => new Date(r.closes_at).getTime() > now)
  return live[0] ?? rounds.at(-1) ?? null
}

export function Student({ me }) {
  const [rounds, setRounds] = useState(null)
  const [courses, setCourses] = useState([])
  const [mine, setMine] = useState([])
  const [roundId, setRoundId] = useState(null)
  const [area, setArea] = useState('')
  const [result, setResult] = useState(null)
  const now = useNow(1000)

  const load = useCallback(async () => {
    try {
      const [r, c, m] = await Promise.all([
        must(sb.from('rounds').select('*').eq('published', true).order('opens_at')),
        must(sb.from('courses').select('*').order('sort_order').order('title')),
        rpc('my_enrollments'),
      ])
      setRounds(r); setCourses(c); setMine(m)
    } catch (e) {
      toast(friendly(e), 'error')
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => watch('student', ['courses', 'rounds', 'enrollments'], load), [load])

  const round = (rounds ?? []).find((r) => r.id === roundId) ?? pickRound(rounds ?? [], now)
  const phase = phaseOf(round, now)
  const roundCourses = useMemo(() => courses.filter((c) => c.round_id === round?.id), [courses, round?.id])
  const areas = useMemo(() => [...new Set(roundCourses.map((c) => c.area).filter(Boolean))], [roundCourses])
  const mineHere = mine.filter((m) => m.round_id === round?.id)
  const activeHere = mineHere.filter((m) => ACTIVE.includes(m.status))
  const courseById = useMemo(() => Object.fromEntries(courses.map((c) => [c.id, c])), [courses])

  async function apply(course) {
    try {
      const r = await rpc('apply', { p_course_id: course.id })
      setResult({ ...r, course })
    } catch (e) {
      toast(friendly(e), 'error')
    }
    load()
  }

  if (rounds === null) return html`<${Shell} me=${me}><div class="skeleton"></div><//>`
  if (!round) {
    return html`<${Shell} me=${me}>
      <${Empty} title="Nenhuma rodada de inscrições aberta ainda.">
        Quando a coordenação publicar as disciplinas, elas aparecem aqui.
      <//>
    <//>`
  }

  const ctx = {
    me, round, phase,
    active: activeHere,
    activeCourses: activeHere.map((m) => courseById[m.course_id]).filter(Boolean),
    removed: new Set(mineHere.filter((m) => m.status === 'removed').map((m) => m.course_id)),
  }
  const shown = area ? roundCourses.filter((c) => c.area === area) : roundCourses

  return html`<${Shell} me=${me}>
    ${rounds.length > 1 && html`<nav class="round-tabs" aria-label="Rodadas">
      ${rounds.map((r) => html`<button key=${r.id} class="pill ${r.id === round.id ? 'on' : ''}"
        onClick=${() => setRoundId(r.id)}>${r.title}</button>`)}
    </nav>`}

    <${Hero} round=${round} phase=${phase} now=${now} used=${activeHere.length} />

    ${mine.some((m) => ACTIVE.includes(m.status) || m.round_id === round.id) && html`
      <${MyEnrollments} list=${mine} roundId=${round.id} reload=${load} />`}

    <section class="section">
      <div class="section-head">
        <h2 class="h2">Disciplinas</h2>
        ${areas.length > 1 && html`<div class="filters" role="group" aria-label="Filtrar por área">
          <button class="pill ${!area ? 'on' : ''}" onClick=${() => setArea('')}>Todas</button>
          ${areas.map((a) => html`<button key=${a} class="pill ${area === a ? 'on' : ''} ${areaClass(a)}"
            onClick=${() => setArea(a)}>${shortArea(a)}</button>`)}
        </div>`}
      </div>
      ${shown.length
        ? html`<div class="course-grid">
            ${shown.map((c) => html`<${CourseCard} key=${c.id} course=${c} ctx=${ctx} mine=${mine} onApply=${apply} />`)}
          </div>`
        : html`<${Empty} title="Nenhuma disciplina nesta rodada ainda." />`}
    </section>

    <${ResultModal} result=${result} me=${me} onClose=${() => setResult(null)} />
  <//>`
}

function Shell({ me, children }) {
  return html`<${Topbar} me=${me} /><main class="page">${children}</main>`
}

function shortArea(a) {
  return a.replace(/ e suas Tecnologias| e Sociais Aplicadas/g, '')
}

function Hero({ round, phase, now, used }) {
  const opens = new Date(round.opens_at)
  const closes = new Date(round.closes_at)
  const closingSoon = phase === 'open' && closes.getTime() - now < 24 * 3600 * 1000
  return html`<section class="hero ${phase}">
    <div class="hero-text">
      <p class="eyebrow">${{ soon: 'Inscrições abrem em', open: 'Inscrições abertas', closed: 'Inscrições encerradas' }[phase]}</p>
      <h1 class="hero-title">${round.title}</h1>
      ${round.description && html`<p class="hero-desc">${round.description}</p>`}
      <p class="hero-when">
        ${phase === 'soon' && html`Abre <b>${fmtLong(opens)}, às ${fmtTime(opens)}</b><br />Fecha ${fmtDay(closes)} às ${fmtTime(closes)}`}
        ${phase === 'open' && html`Fecha <b>${fmtLong(closes)}, às ${fmtTime(closes)}</b>`}
        ${phase === 'closed' && html`Encerradas em ${fmtDate(closes)} às ${fmtTime(closes)}`}
        <span class="tz">${' · horário de Brasília'}</span>
      </p>
    </div>
    <div class="hero-side">
      ${phase === 'soon' && html`<${Countdown} to=${opens} now=${now} />
        <p class="hero-tip">A inscrição libera automaticamente no horário de abertura, pelo relógio do servidor.</p>`}
      ${closingSoon && html`<${Countdown} to=${closes} now=${now} /><p class="hero-tip">para o fim das inscrições</p>`}
      <div class="choices" aria-label="Suas escolhas">
        <span class="choices-num">${used}<small>/${round.max_choices}</small></span>
        <span class="choices-label">${round.max_choices === 1 ? 'escolha usada' : 'escolhas usadas'}</span>
      </div>
    </div>
  </section>`
}

function courseAction(course, ctx, mine) {
  const own = mine.find((m) => m.course_id === course.id && ACTIVE.includes(m.status))
  if (own) return { kind: 'mine', own }
  // Say "not for your year" before the race starts, not only once it opens.
  if (course.grades.length < 3 && !course.grades.includes(ctx.me.grade)) {
    return { kind: 'blocked', label: `Só para ${gradesLabel(course.grades)}` }
  }
  if (ctx.removed.has(course.id)) return { kind: 'blocked', label: 'Inscrição cancelada pela coordenação' }
  if (ctx.phase === 'soon') return { kind: 'blocked', label: `Abre às ${fmtTime(ctx.round.opens_at)}` }
  if (ctx.phase === 'closed') return { kind: 'blocked', label: 'Inscrições encerradas' }
  if (ctx.active.length >= ctx.round.max_choices) {
    const n = ctx.round.max_choices
    return { kind: 'blocked', label: `Você já usou ${n === 1 ? 'sua escolha' : `suas ${n} escolhas`}` }
  }
  if (ctx.round.block_same_slot && course.slot) {
    const clash = ctx.activeCourses.find((c) => c.slot === course.slot)
    if (clash) return { kind: 'blocked', label: `Mesmo horário de “${clash.title}”` }
  }
  return { kind: course.confirmed_count >= course.capacity ? 'waitlist' : 'apply' }
}

function CourseCard({ course, ctx, mine, onApply }) {
  const [open, setOpen] = useState(false)
  const action = courseAction(course, ctx, mine)
  const long = (course.description ?? '').length > 180
  return html`<article class="course card ${areaClass(course.area)} ${action.kind === 'mine' ? 'is-mine' : ''}">
    <div class="course-top">
      ${course.area ? html`<span class="area-tag">${shortArea(course.area)}</span>` : html`<span></span>`}
      ${course.schedule && html`<span class="course-when">${course.schedule}</span>`}
    </div>
    <h3 class="course-title">${course.title}</h3>
    <p class="course-meta">
      ${[course.teacher_names, course.location, course.grades.length < 3 ? gradesLabel(course.grades) : null]
        .filter(Boolean).join(' · ')}
    </p>
    ${course.description && html`<p class="course-desc ${long && !open ? 'clamp' : ''}">${course.description}</p>`}
    ${long && html`<button class="link small" onClick=${() => setOpen(!open)}>${open ? 'ver menos' : 'ver mais'}</button>`}
    <${SeatMeter} capacity=${course.capacity} taken=${course.confirmed_count} waiting=${course.waitlist_count} />
    <div class="course-action">
      ${action.kind === 'mine' && html`<${StatusChip} status=${action.own.status} position=${action.own.waitlist_position} />`}
      ${action.kind === 'blocked' && html`<p class="blocked">${action.label}</p>`}
      ${(action.kind === 'apply' || action.kind === 'waitlist') && html`
        <${ApplyButton} full=${action.kind === 'waitlist'} onApply=${() => onApply(course)} />`}
    </div>
  </article>`
}

// Two taps: the first arms the button for 4 s, the second sends.
// A seat can't be undone without a teacher, so no accidental single taps.
function ApplyButton({ full, onApply }) {
  const [armedAt, setArmedAt] = useState(0)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!armedAt) return
    const t = setTimeout(() => setArmedAt(0), 4000)
    return () => clearTimeout(t)
  }, [armedAt])
  async function click() {
    if (busy) return
    if (!armedAt) { setArmedAt(Date.now()); return }
    if (Date.now() - armedAt < 250) return
    setBusy(true)
    try { await onApply() } finally { setBusy(false); setArmedAt(0) }
  }
  const label = busy ? 'Registrando…'
    : armedAt ? (full ? 'Confirmar lista de espera' : 'Confirmar inscrição')
    : full ? 'Entrar na lista de espera' : 'Inscrever-se'
  return html`<button class="btn apply ${full ? 'waitlist' : 'go'} ${armedAt ? 'armed' : ''}"
      onClick=${click} disabled=${busy} aria-live="polite">
    ${busy && html`<span class="spin" aria-hidden="true"></span>`}<span>${label}</span>
  </button>`
}

function ResultModal({ result, me, onClose }) {
  const ok = result?.status === 'confirmed'
  return html`<${Modal} open=${!!result} onClose=${onClose} title=${ok ? 'Inscrição confirmada' : 'Inscrição na lista de espera'}>
    ${result && html`<div class="result ${ok ? 'ok' : 'wait'}">
      <div class="result-mark" aria-hidden="true">${ok ? '✓' : result.position}</div>
      <h3 class="result-course">${result.course.title}</h3>
      ${!ok && html`<p>Posição <b>${result.position}º</b>. Se uma vaga abrir, ela vai automaticamente para a próxima pessoa da fila, e você recebe o comprovante por e-mail.</p>`}
      <dl class="receipt">
        <div><dt>Registrada em</dt><dd>${fmtDate(result.applied_at)} · <span class="mono">${fmtMs(result.applied_at)}</span></dd></div>
        <div><dt>Código</dt><dd class="mono">${formatCode(result.code)}</dd></div>
      </dl>
      <p class="muted small">Horário de Brasília. ${ok ? html`O comprovante em PDF foi enviado para <b>${me.email}</b>.` : ''}</p>
      <div class="row end">
        ${ok && html`<${SlipButton} id=${result.enrollment_id} kind="ghost" />`}
        <button class="btn primary" onClick=${onClose}>Fechar</button>
      </div>
    </div>`}
  <//>`
}

function SlipButton({ id, kind = 'ghost', label = 'Baixar comprovante' }) {
  const [busy, setBusy] = useState(false)
  async function go() {
    setBusy(true)
    try { await downloadSlip(id) } catch (e) { toast(friendly(e), 'error') }
    setBusy(false)
  }
  return html`<${Btn} kind=${kind} busy=${busy} onClick=${go}>${label}<//>`
}

function MyEnrollments({ list, roundId, reload }) {
  const [showOld, setShowOld] = useState(false)
  const current = list.filter((m) => ACTIVE.includes(m.status))
  const past = list.filter((m) => !ACTIVE.includes(m.status))

  async function act(fn, args, done) {
    try { await rpc(fn, args); toast(done, 'ok') } catch (e) { toast(friendly(e), 'error') }
    reload()
  }

  async function requestDrop(m) {
    const r = await ask({
      title: 'Pedir desistência',
      body: `A vaga em “${m.course_title}” continua sua até a coordenação aprovar. Depois de aprovada, ela vai para a próxima pessoa da lista de espera e não dá para desfazer.`,
      input: { label: 'Motivo', placeholder: 'Ex.: conflito com o estágio', required: true },
      confirm: 'Enviar pedido', danger: true,
    })
    if (r.ok) act('request_drop', { p_enrollment_id: m.enrollment_id, p_reason: r.value }, 'Pedido enviado para a coordenação.')
  }

  async function leave(m) {
    const r = await ask({
      title: 'Sair da lista de espera',
      body: `Você perde sua posição em “${m.course_title}”. Se quiser voltar depois, entra no fim da fila.`,
      confirm: 'Sair da lista', danger: true,
    })
    if (r.ok) act('leave_waitlist', { p_enrollment_id: m.enrollment_id }, 'Você saiu da lista de espera.')
  }

  return html`<section class="section">
    <div class="section-head"><h2 class="h2">Minhas inscrições</h2></div>
    ${current.length === 0 && html`<p class="muted">Você ainda não tem inscrições ativas.</p>`}
    <div class="mine-list">
      ${current.map((m) => html`<article key=${m.enrollment_id} class="mine card ${m.status}">
        <div class="mine-main">
          <${StatusChip} status=${m.status} position=${m.waitlist_position} />
          <h3>${m.course_title}</h3>
          <p class="muted small">${[m.round_id !== roundId ? m.round_title : null, m.course_schedule].filter(Boolean).join(' · ')}</p>
          <p class="mine-stamp">
            Registrada em ${fmtDate(m.applied_at)} · <span class="mono">${fmtMs(m.applied_at)}</span>${' · '}código <span class="mono">${formatCode(m.code)}</span>
          </p>
          ${m.status === 'drop_requested' && html`<p class="note">Seu motivo: “${m.drop_reason}”. Aguardando a coordenação.</p>`}
        </div>
        <div class="mine-actions">
          ${(m.status === 'confirmed' || m.status === 'drop_requested') && html`<${SlipButton} id=${m.enrollment_id} />`}
          ${m.status === 'confirmed' && html`<button class="btn ghost danger-text" onClick=${() => requestDrop(m)}>Pedir desistência</button>`}
          ${m.status === 'drop_requested' && html`<button class="btn ghost" onClick=${() => act('cancel_drop_request', { p_enrollment_id: m.enrollment_id }, 'Pedido cancelado. Sua vaga continua garantida.')}>Cancelar pedido</button>`}
          ${m.status === 'waitlisted' && html`<button class="btn ghost danger-text" onClick=${() => leave(m)}>Sair da lista</button>`}
        </div>
      </article>`)}
    </div>
    ${past.length > 0 && html`<button class="link small" onClick=${() => setShowOld(!showOld)}>
      ${showOld ? 'Esconder histórico' : `Ver histórico (${past.length})`}
    </button>`}
    ${showOld && html`<ul class="history">
      ${past.map((m) => html`<li key=${m.enrollment_id}>
        <${StatusChip} status=${m.status} /> <b>${m.course_title}</b>
        <span class="muted small"> · ${m.round_title}${m.end_note ? ` · ${m.end_note}` : ''}</span>
      </li>`)}
    </ul>`}
  </section>`
}
