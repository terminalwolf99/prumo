import { html, useCallback, useEffect, useMemo, useState } from '../lib/deps.js'
import { friendly, must, rpc, sb, watch } from '../lib/db.js'
import { downloadRankingSlip } from '../lib/slip.js'
import { fmtDate, fmtLong, fmtMs, fmtTime, serverNow } from '../lib/time.js'
import { Btn, Countdown, Empty, Field, formatCode, Modal, toast, Topbar, useNow, Wordmark } from '../lib/ui.js'
import { Student as Seats } from './student.js'

function phaseOf(round, now) {
  if (now < new Date(round.opens_at).getTime()) return 'soon'
  if (now < new Date(round.closes_at).getTime()) return 'open'
  return 'closed'
}

const anoLabel = (g) => `${g}º ano`

// ---------------------------------------------------------------- dispatcher

// A student may face ranking rounds, seat rounds, or both. One of each is the
// common case; we route to the right flow and only show a chooser if needed.
export function StudentHome({ me, reloadMe }) {
  const [rounds, setRounds] = useState(null)
  const [pick, setPick] = useState(null)

  const load = useCallback(async () => {
    try {
      setRounds(await must(sb.from('rounds').select('*').eq('published', true).order('opens_at', { ascending: false })))
    } catch (e) { toast(friendly(e), 'error') }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => watch('student-rounds', ['rounds'], load), [load])

  if (rounds === null) return html`<${Topbar} me=${me} /><main class="page"><div class="skeleton"></div></main>`
  const ranking = rounds.filter((r) => r.kind === 'ranking')
  const seats = rounds.filter((r) => r.kind !== 'ranking')

  const current = pick ?? (ranking.length === 1 && seats.length === 0 ? { kind: 'ranking', id: ranking[0].id }
    : seats.length > 0 && ranking.length === 0 ? { kind: 'seats' } : null)

  if (current?.kind === 'ranking') {
    const round = ranking.find((r) => r.id === current.id)
    if (round) return html`<${Ranking} me=${me} round=${round} reloadMe=${reloadMe} onBack=${ranking.length + seats.length > 1 ? () => setPick(null) : null} />`
  }
  if (current?.kind === 'seats') return html`<${Seats} me=${me} />`

  // chooser (more than one thing to do)
  return html`<${Topbar} me=${me} />
    <main class="page">
      <section class="section">
        <div class="section-head"><h1 class="h2">Inscrições abertas</h1></div>
        ${ranking.length === 0 && seats.length === 0 && html`<${Empty} title="Nenhuma inscrição publicada ainda.">Quando a coordenação publicar, aparece aqui.<//>`}
        <div class="mine-list">
          ${ranking.map((r) => html`<button key=${r.id} class="card round-pick" onClick=${() => setPick({ kind: 'ranking', id: r.id })}>
            <b>${r.title}</b><span class="muted small">${r.description ?? 'Escolha suas disciplinas por ordem de preferência.'}</span>
          </button>`)}
          ${seats.length > 0 && html`<button class="card round-pick" onClick=${() => setPick({ kind: 'seats' })}>
            <b>Disciplinas com vagas</b><span class="muted small">Inscrição por ordem de chegada.</span>
          </button>`}
        </div>
      </section>
    </main>`
}

// ---------------------------------------------------------------- self sign-up

// A signed-in person with no record yet: let them register themselves for an
// open ranking round (name, turma, year).
export function SelfRegister({ email, reloadMe }) {
  const [rounds, setRounds] = useState(null)
  const [name, setName] = useState('')
  const [turma, setTurma] = useState('')
  const [grade, setGrade] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { rpc('open_ranking_rounds').then(setRounds).catch(() => setRounds([])) }, [])

  const years = useMemo(() => {
    const set = new Set()
    for (const r of rounds ?? []) for (const g of r.grades ?? []) set.add(g)
    return set.size ? [...set].sort() : [1, 2]
  }, [rounds])
  useEffect(() => { if (grade === null && years.length === 1) setGrade(years[0]) }, [years, grade])

  if (rounds === null) return html`<div class="boot"><${Wordmark} /></div>`
  if (rounds.length === 0) {
    return html`<main class="center-page"><div class="card narrow">
      <${Wordmark} />
      <h1 class="h2">Nenhuma inscrição aberta</h1>
      <p>Entrou como <b>${email}</b>, mas não há inscrição aberta no momento.</p>
      <p class="muted">Volte quando a coordenação abrir, ou fale com ela.</p>
      <button class="btn ghost" onClick=${() => sb.auth.signOut()}>Sair</button>
    </div></main>`
  }

  async function submit(e) {
    e.preventDefault()
    if (name.trim().length < 3) { setError('Escreva seu nome completo.'); return }
    if (!grade) { setError('Escolha o seu ano.'); return }
    if (turma.trim().length < 1) { setError('Informe a sua turma.'); return }
    setBusy(true); setError('')
    try {
      await rpc('register_self', { p_full_name: name.trim(), p_grade: grade, p_class_name: turma.trim() })
      await reloadMe()
    } catch (err) { setError(friendly(err)); setBusy(false) }
  }

  return html`<main class="center-page">
    <form class="card narrow" onSubmit=${submit}>
      <${Wordmark} />
      <h1 class="h2">Seus dados</h1>
      <p class="muted">Inscrição em <b>${rounds.map((r) => r.title).join(', ')}</b>. Confirme seus dados para continuar.</p>
      <${Field} label="Nome completo" hint="Aparece exatamente assim no comprovante.">
        <input value=${name} onInput=${(e) => setName(e.target.value)} autocomplete="name" required />
      <//>
      <${Field} label="Ano">
        <div class="year-pick">
          ${years.map((g) => html`<button type="button" key=${g} class="pill ${grade === g ? 'on' : ''}" onClick=${() => setGrade(g)}>${anoLabel(g)}</button>`)}
        </div>
      <//>
      <${Field} label="Turma"><input value=${turma} onInput=${(e) => setTurma(e.target.value)} placeholder="Ex.: ${grade ?? 1}º B" /><//>
      ${error && html`<p class="form-error" role="alert">${error}</p>`}
      <${Btn} busy=${busy} type="submit" class="block">Continuar<//>
      <button type="button" class="link small" onClick=${() => sb.auth.signOut()}>Sair</button>
    </form>
  </main>`
}

// ---------------------------------------------------------------- the ranking

export function Ranking({ me, round, reloadMe, onBack }) {
  const [data, setData] = useState(null)
  const [order, setOrder] = useState(null)          // { [group_label]: [course_id, ...] }
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const now = useNow(1000)

  const load = useCallback(async () => {
    try {
      const d = await rpc('ranking_round', { p_round_id: round.id })
      setData(d)
      const byRank = new Map((d.mine?.choices ?? []).map((c) => [c.course_id, c.rank]))
      const next = {}
      for (const g of d.groups) {
        next[g.group_label] = [...g.options]
          .sort((a, b) => (byRank.get(a.course_id) ?? 99) - (byRank.get(b.course_id) ?? 99))
          .map((o) => o.course_id)
      }
      setOrder(next)
    } catch (e) { toast(friendly(e), 'error') }
  }, [round.id])
  useEffect(() => { load() }, [load])

  if (!data || !order) return html`<${Topbar} me=${me} /><main class="page"><div class="skeleton"></div></main>`

  const phase = phaseOf(round, now)
  const opens = new Date(round.opens_at)
  const closes = new Date(round.closes_at)
  const mine = data.mine
  const editable = phase === 'open'
  const titleOf = (gl, cid) => data.groups.find((g) => g.group_label === gl)?.options.find((o) => o.course_id === cid)

  function move(gl, i, dir) {
    setOrder((prev) => {
      const arr = [...prev[gl]]
      const j = i + dir
      if (j < 0 || j >= arr.length) return prev
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
      return { ...prev, [gl]: arr }
    })
  }

  async function submit() {
    setBusy(true)
    try {
      const choices = data.groups.flatMap((g) => order[g.group_label].map((cid, i) => ({ course_id: cid, rank: i + 1 })))
      const r = await rpc('submit_ranking', { p_round_id: round.id, p_choices: choices })
      setDone(r)
      load()
    } catch (e) { toast(friendly(e), 'error') }
    setBusy(false)
  }

  async function changeYear() {
    const g = me.grade === 1 ? 2 : 1
    const r = await import('../lib/ui.js').then((m) => m.ask({
      title: 'Trocar o ano',
      body: `Seu cadastro está como ${anoLabel(me.grade)}. Mudar para ${anoLabel(g)}?`,
      confirm: `Mudar para ${anoLabel(g)}`,
    }))
    if (!r.ok) return
    try {
      await rpc('register_self', { p_full_name: me.full_name, p_grade: g, p_class_name: me.class_name ?? `${g}º` })
      await reloadMe()
    } catch (e) { toast(friendly(e), 'error') }
  }

  return html`<${Topbar} me=${me}>
      ${onBack && html`<button class="btn ghost sm" onClick=${onBack}>Outras inscrições</button>`}
    <//>
    <main class="page rank-page">
      <section class="hero ${phase}">
        <div class="hero-text">
          <p class="eyebrow">${{ soon: 'Inscrições abrem em', open: 'Inscrições abertas', closed: 'Inscrições encerradas' }[phase]}</p>
          <h1 class="hero-title">${round.title}</h1>
          ${round.description && html`<p class="hero-desc">${round.description}</p>`}
          <p class="hero-when">
            ${phase === 'soon' && html`Abre <b>${fmtLong(opens)}, às ${fmtTime(opens)}</b>`}
            ${phase === 'open' && html`Fecha <b>${fmtLong(closes)}, às ${fmtTime(closes)}</b>`}
            ${phase === 'closed' && html`Encerradas em ${fmtDate(closes)} às ${fmtTime(closes)}`}
            <span class="tz"> (horário de Brasília)</span>
          </p>
        </div>
        <div class="hero-side">
          ${phase === 'soon' && html`<${Countdown} to=${opens} now=${now} />`}
          ${phase === 'open' && closes.getTime() - now < 24 * 3600 * 1000 && html`<${Countdown} to=${closes} now=${now} />`}
        </div>
      </section>

      ${data.groups.length === 0
        ? html`<${Empty} title=${`Esta rodada não tem disciplinas para o ${anoLabel(me.grade)}.`}>
            ${me.role === 'student' && html`<button class="link" onClick=${changeYear}>Meu ano está errado — trocar</button>`}
          <//>`
        : html`
          <div class="rank-intro">
            <p>Coloque as opções de cada dia <b>em ordem de preferência</b>: a 1ª é a que você mais quer cursar.
              ${me.role === 'student' && html` <button class="link small" onClick=${changeYear}>Ano: ${anoLabel(me.grade)}</button>`}</p>
            ${mine && html`<p class="muted small">Você já se inscreveu em ${fmtDate(mine.created_at)} às <span class="mono">${fmtMs(mine.created_at)}</span> · código <span class="mono">${formatCode(mine.code)}</span>.
              ${editable ? ' Pode ajustar a ordem até o fechamento.' : ''}</p>`}
          </div>

          <div class="rank-days">
            ${data.groups.map((g) => html`<section key=${g.group_label} class="card rank-day">
              <h2 class="h3">${g.group_label}</h2>
              <ol class="rank-list">
                ${order[g.group_label].map((cid, i) => {
                  const o = titleOf(g.group_label, cid)
                  return html`<li key=${cid} class="rank-item ${i === 0 ? 'first' : ''}">
                    <span class="rank-num">${i + 1}</span>
                    <div class="rank-body">
                      <b>${o?.title}</b>
                      ${(o?.teacher_names || o?.area) && html`<span class="muted small">${[o.teacher_names, o.area].filter(Boolean).join(' · ')}</span>`}
                    </div>
                    ${editable && html`<div class="rank-moves">
                      <button class="icon-btn" aria-label="Subir" disabled=${i === 0} onClick=${() => move(g.group_label, i, -1)}>▲</button>
                      <button class="icon-btn" aria-label="Descer" disabled=${i === order[g.group_label].length - 1} onClick=${() => move(g.group_label, i, 1)}>▼</button>
                    </div>`}
                  </li>`
                })}
              </ol>
            </section>`)}
          </div>

          <div class="rank-actions">
            ${editable
              ? html`<${Btn} busy=${busy} onClick=${submit} class="block big">${mine ? 'Salvar minha ordem' : 'Confirmar inscrição'}<//>`
              : mine
                ? html`<${Btn} kind="ghost" onClick=${() => downloadRankingSlip(mine.submission_id).catch((e) => toast(friendly(e), 'error'))}>Baixar comprovante<//>`
                : html`<p class="muted">${phase === 'soon' ? 'A inscrição abre no horário acima. Deixe esta página aberta.' : 'As inscrições estão encerradas.'}</p>`}
          </div>`}

      <${Modal} open=${!!done} onClose=${() => setDone(null)} title="Inscrição registrada">
        ${done && html`<div class="result ok">
          <div class="result-mark" aria-hidden="true">✓</div>
          <p>Sua ordem de preferência foi registrada. A coordenação organiza as turmas a partir dela.</p>
          <dl class="receipt">
            <div><dt>Registrada em</dt><dd>${fmtDate(done.created_at)} · <span class="mono">${fmtMs(done.created_at)}</span></dd></div>
            <div><dt>Código</dt><dd class="mono">${formatCode(done.code)}</dd></div>
          </dl>
          <p class="muted small">O comprovante em PDF foi enviado para <b>${me.email}</b>.</p>
          <div class="row end">
            <${Btn} kind="ghost" onClick=${() => downloadRankingSlip(done.submission_id).catch((e) => toast(friendly(e), 'error'))}>Baixar comprovante<//>
            <button class="btn primary" onClick=${() => setDone(null)}>Fechar</button>
          </div>
        </div>`}
      <//>
    </main>`
}
