import { html, useCallback, useEffect, useMemo, useState } from '../../lib/deps.js'
import { friendly, must, rpc, sb, SEATED, watch } from '../../lib/db.js'
import { downloadSlip } from '../../lib/slip.js'
import { fmtDate, fmtDay, fmtMs, fmtTime, fmtWhen, fromLocalInput, serverNow, toLocalInput } from '../../lib/time.js'
import {
  areaClass, AREAS, ask, Btn, Empty, Field, formatCode, gradesLabel, Modal, SeatMeter, StatusChip, toast, useNow,
} from '../../lib/ui.js'

export function roundState(r, now = serverNow()) {
  if (!r.published) return ['Rascunho', 'off']
  if (now < new Date(r.opens_at).getTime()) return ['Agendada', 'wait']
  if (now < new Date(r.closes_at).getTime()) return ['Aberta', 'ok']
  return ['Encerrada', 'off']
}

export function RoundsTab() {
  const [rounds, setRounds] = useState(null)
  const [courses, setCourses] = useState([])
  const [selected, setSelected] = useState(null)
  const [editRound, setEditRound] = useState(null)
  const [editCourse, setEditCourse] = useState(null)
  const [roster, setRoster] = useState(null)
  const now = useNow(1000)

  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([
        must(sb.from('rounds').select('*').order('opens_at', { ascending: false })),
        must(sb.from('courses').select('*').order('sort_order').order('title')),
      ])
      setRounds(r); setCourses(c)
    } catch (e) { toast(friendly(e), 'error') }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => watch('staff-rounds', ['rounds', 'courses'], load), [load])

  const round = rounds?.find((r) => r.id === selected) ?? rounds?.[0]
  const list = useMemo(() => courses.filter((c) => c.round_id === round?.id), [courses, round?.id])

  if (rounds === null) return html`<div class="skeleton"></div>`

  return html`<div class="rounds-layout">
    <aside class="round-list">
      <div class="section-head">
        <h2 class="h3">Rodadas</h2>
        <button class="btn primary sm" onClick=${() => setEditRound({})}>Nova rodada</button>
      </div>
      ${rounds.length === 0 && html`<p class="muted small">Crie a primeira rodada de inscrições: um período com data e hora de abertura e de fechamento.</p>`}
      ${rounds.map((r) => {
        const [label, kind] = roundState(r, now)
        return html`<button key=${r.id} class="round-item ${r.id === round?.id ? 'on' : ''}" onClick=${() => setSelected(r.id)}>
          <span class="chip ${kind}">${label}</span>
          <b>${r.title}</b>
          <span class="muted small">${fmtDay(r.opens_at)} ${fmtTime(r.opens_at)} → ${fmtDay(r.closes_at)} ${fmtTime(r.closes_at)}</span>
        </button>`
      })}
    </aside>

    <section class="round-detail">
      ${round ? html`<${RoundHeader} round=${round} courses=${list} now=${now} onEdit=${() => setEditRound(round)} reload=${load} />
        <div class="section-head">
          <h2 class="h3">Disciplinas <span class="muted">(${list.length})</span></h2>
          <button class="btn primary sm" onClick=${() => setEditCourse({ round_id: round.id, sort_order: list.length })}>Nova disciplina</button>
        </div>
        ${list.length === 0
          ? html`<${Empty} title="Nenhuma disciplina nesta rodada.">Adicione as disciplinas com o número de vagas de cada uma.<//>`
          : html`<div class="table-wrap"><table class="table">
              <thead><tr><th>Disciplina</th><th>Horário</th><th>Vagas</th><th>Espera</th><th></th></tr></thead>
              <tbody>${list.map((c) => html`<tr key=${c.id}>
                <td><span class="dot-area ${areaClass(c.area)}"></span><b>${c.title}</b>
                  <div class="muted small">${[c.teacher_names, c.grades.length < 3 ? gradesLabel(c.grades) : null].filter(Boolean).join(' · ')}</div></td>
                <td class="small">${c.schedule ?? '—'}${c.slot && html`<div class="muted mono small">${c.slot}</div>`}</td>
                <td class="seat-cell"><${SeatMeter} compact capacity=${c.capacity} taken=${c.confirmed_count} waiting=${c.waitlist_count} />
                  <span class="mono small">${c.confirmed_count}/${c.capacity}</span></td>
                <td class="mono">${c.waitlist_count || '—'}</td>
                <td class="actions">
                  <button class="btn ghost sm" onClick=${() => setRoster(c)}>Lista</button>
                  <button class="btn ghost sm" onClick=${() => setEditCourse(c)}>Editar</button>
                </td>
              </tr>`)}</tbody>
            </table></div>`}
      ` : html`<${Empty} title="Nenhuma rodada ainda." />`}
    </section>

    <${Modal} open=${!!editRound} onClose=${() => setEditRound(null)} title=${editRound?.id ? 'Editar rodada' : 'Nova rodada'}>
      ${editRound && html`<${RoundForm} round=${editRound} hasCourses=${courses.some((c) => c.round_id === editRound.id)}
        onDone=${(saved) => { setEditRound(null); if (saved) setSelected(saved.id); load() }} />`}
    <//>
    <${Modal} open=${!!editCourse} onClose=${() => setEditCourse(null)} title=${editCourse?.id ? 'Editar disciplina' : 'Nova disciplina'}>
      ${editCourse && html`<${CourseForm} course=${editCourse} rounds=${rounds} onDone=${() => { setEditCourse(null); load() }} />`}
    <//>
    <${Modal} open=${!!roster} wide onClose=${() => setRoster(null)} title=${roster?.title ?? ''}>
      ${roster && html`<${Roster} course=${courses.find((c) => c.id === roster.id) ?? roster} round=${round} />`}
    <//>
  </div>`
}

function RoundHeader({ round, courses, now, onEdit, reload }) {
  const [label, kind] = roundState(round, now)
  const seats = courses.reduce((a, c) => a + c.capacity, 0)
  const taken = courses.reduce((a, c) => a + c.confirmed_count, 0)
  const waiting = courses.reduce((a, c) => a + c.waitlist_count, 0)
  const [busy, setBusy] = useState(false)

  async function togglePublish() {
    if (!round.published && new Date(round.opens_at).getTime() <= serverNow()) {
      const r = await ask({
        title: 'Publicar agora?',
        body: 'O horário de abertura já passou, então as inscrições abrem no instante em que você publicar.',
        confirm: 'Publicar e abrir',
      })
      if (!r.ok) return
    }
    setBusy(true)
    try {
      await must(sb.from('rounds').update({ published: !round.published }).eq('id', round.id))
      toast(round.published ? 'Rodada escondida dos estudantes.' : 'Rodada publicada.', 'ok')
    } catch (e) { toast(friendly(e), 'error') }
    setBusy(false); reload()
  }

  async function remove() {
    const r = await ask({
      title: 'Excluir rodada',
      body: `Isso apaga “${round.title}”, suas ${courses.length} disciplinas e todas as inscrições dela. Não dá para desfazer.`,
      confirm: 'Excluir tudo', danger: true,
    })
    if (!r.ok) return
    try { await must(sb.from('rounds').delete().eq('id', round.id)); toast('Rodada excluída.', 'ok') } catch (e) { toast(friendly(e), 'error') }
    reload()
  }

  return html`<div class="round-head card">
    <div class="round-head-main">
      <span class="chip ${kind}">${label}</span>
      <h1 class="h2">${round.title}</h1>
      <p class="muted">
        Abre <b>${fmtWhen(round.opens_at)}</b> · fecha <b>${fmtWhen(round.closes_at)}</b> <span class="small">(Brasília)</span><br />
        Até ${round.max_choices} ${round.max_choices === 1 ? 'escolha' : 'escolhas'} por estudante${round.block_same_slot ? ' · sem choque de horário' : ''}
      </p>
    </div>
    <div class="stats">
      <div><b>${taken}<small>/${seats}</small></b><span>vagas ocupadas</span></div>
      <div><b>${waiting}</b><span>na espera</span></div>
    </div>
    <div class="row wrap">
      <${Btn} kind=${round.published ? 'ghost' : 'primary'} busy=${busy} onClick=${togglePublish}>
        ${round.published ? 'Despublicar' : 'Publicar para estudantes'}
      <//>
      <button class="btn ghost" onClick=${onEdit}>Editar</button>
      <button class="btn ghost danger-text" onClick=${remove}>Excluir</button>
    </div>
  </div>`
}

function RoundForm({ round, onDone }) {
  const [f, setF] = useState(() => ({
    title: round.title ?? '',
    description: round.description ?? '',
    opens: toLocalInput(round.opens_at),
    closes: toLocalInput(round.closes_at),
    max_choices: round.max_choices ?? 1,
    block_same_slot: round.block_same_slot ?? true,
    published: round.published ?? false,
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setF((prev) => ({ ...prev, [k]: v }))
  }

  async function save(e) {
    e.preventDefault()
    if (!f.title.trim() || !f.opens || !f.closes) { setError('Preencha título, abertura e fechamento.'); return }
    const opens_at = fromLocalInput(f.opens)
    const closes_at = fromLocalInput(f.closes)
    if (new Date(closes_at) <= new Date(opens_at)) { setError('O fechamento precisa ser depois da abertura.'); return }
    const row = {
      title: f.title.trim(), description: f.description.trim() || null, opens_at, closes_at,
      max_choices: Math.max(1, Number(f.max_choices) || 1), block_same_slot: f.block_same_slot, published: f.published,
    }
    setBusy(true); setError('')
    try {
      const saved = round.id
        ? await must(sb.from('rounds').update(row).eq('id', round.id).select().single())
        : await must(sb.from('rounds').insert(row).select().single())
      toast('Rodada salva.', 'ok')
      onDone(saved)
    } catch (err) { setError(friendly(err)) }
    setBusy(false)
  }

  const opensPast = f.opens && new Date(fromLocalInput(f.opens)).getTime() <= serverNow()
  return html`<form class="form" onSubmit=${save}>
    <${Field} label="Título"><input value=${f.title} onInput=${set('title')} placeholder="Aprofundamentos · 1º semestre 2027" required /><//>
    <${Field} label="Descrição (opcional)"><textarea rows="2" value=${f.description} onInput=${set('description')}></textarea><//>
    <div class="grid2">
      <${Field} label="Abre em" hint="Horário de Brasília"><input type="datetime-local" value=${f.opens} onInput=${set('opens')} required /><//>
      <${Field} label="Fecha em" hint="Horário de Brasília"><input type="datetime-local" value=${f.closes} onInput=${set('closes')} required /><//>
    </div>
    <${Field} label="Escolhas por estudante" hint="Inclui vagas confirmadas e lugares na lista de espera.">
      <input type="number" min="1" max="20" value=${f.max_choices} onInput=${set('max_choices')} />
    <//>
    <label class="check"><input type="checkbox" checked=${f.block_same_slot} onChange=${set('block_same_slot')} />
      <span>Impedir duas disciplinas com o mesmo código de horário</span></label>
    <label class="check"><input type="checkbox" checked=${f.published} onChange=${set('published')} />
      <span>Publicada (estudantes veem a rodada e a contagem regressiva)</span></label>
    ${f.published && opensPast && html`<p class="warn">A abertura já passou: publicada assim, as inscrições ficam abertas imediatamente.</p>`}
    ${error && html`<p class="form-error" role="alert">${error}</p>`}
    <div class="row end"><button type="button" class="btn ghost" onClick=${() => onDone(null)}>Cancelar</button>
      <${Btn} busy=${busy} type="submit">Salvar<//></div>
  </form>`
}

function CourseForm({ course, rounds, onDone }) {
  const [f, setF] = useState(() => ({
    round_id: course.round_id, title: course.title ?? '', area: course.area ?? '', teacher_names: course.teacher_names ?? '',
    schedule: course.schedule ?? '', slot: course.slot ?? '', location: course.location ?? '',
    capacity: course.capacity ?? 30, grades: course.grades ?? [1, 2, 3], description: course.description ?? '',
    sort_order: course.sort_order ?? 0,
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => {
    const v = e.target.value
    setF((prev) => ({ ...prev, [k]: v }))
  }
  const toggleGrade = (g) => setF((prev) => ({
    ...prev, grades: prev.grades.includes(g) ? prev.grades.filter((x) => x !== g) : [...prev.grades, g].sort(),
  }))

  async function save(e) {
    e.preventDefault()
    if (!f.title.trim()) { setError('Dê um nome para a disciplina.'); return }
    if (!f.grades.length) { setError('Marque pelo menos um ano.'); return }
    const row = {
      round_id: f.round_id, title: f.title.trim(), area: f.area.trim() || null, teacher_names: f.teacher_names.trim() || null,
      schedule: f.schedule.trim() || null, slot: f.slot.trim().toUpperCase() || null, location: f.location.trim() || null,
      capacity: Math.max(0, Number(f.capacity) || 0), grades: f.grades, description: f.description.trim() || null,
      sort_order: Number(f.sort_order) || 0,
    }
    setBusy(true); setError('')
    try {
      if (course.id) await must(sb.from('courses').update(row).eq('id', course.id))
      else await must(sb.from('courses').insert(row))
      toast('Disciplina salva.', 'ok')
      onDone()
    } catch (err) { setError(friendly(err)) }
    setBusy(false)
  }

  async function remove() {
    const total = course.confirmed_count + course.waitlist_count
    const r = await ask({
      title: 'Excluir disciplina',
      body: total ? `“${course.title}” tem ${total} inscrições ativas, que serão apagadas sem aviso por e-mail. Não dá para desfazer.` : `Excluir “${course.title}”?`,
      confirm: 'Excluir', danger: true,
    })
    if (!r.ok) return
    try { await must(sb.from('courses').delete().eq('id', course.id)); toast('Disciplina excluída.', 'ok'); onDone() } catch (err) { setError(friendly(err)) }
  }

  const shrinking = course.id && Number(f.capacity) < course.confirmed_count
  return html`<form class="form" onSubmit=${save}>
    <${Field} label="Nome da disciplina"><input value=${f.title} onInput=${set('title')} required /><//>
    <div class="grid2">
      <${Field} label="Área">
        <input list="areas" value=${f.area} onInput=${set('area')} placeholder="Escolha ou digite" />
        <datalist id="areas">${AREAS.map((a) => html`<option value=${a} />`)}</datalist>
      <//>
      <${Field} label="Professor(es)"><input value=${f.teacher_names} onInput=${set('teacher_names')} /><//>
    </div>
    <div class="grid2">
      <${Field} label="Horário" hint="Como aparece para os estudantes"><input value=${f.schedule} onInput=${set('schedule')} placeholder="Terças, 13h30–15h10" /><//>
      <${Field} label="Código de horário" hint="Disciplinas com o mesmo código não podem ser escolhidas juntas">
        <input class="mono" value=${f.slot} onInput=${set('slot')} placeholder="TER-T1" />
      <//>
    </div>
    <div class="grid2">
      <${Field} label="Vagas"><input type="number" min="0" value=${f.capacity} onInput=${set('capacity')} required /><//>
      <${Field} label="Local (opcional)"><input value=${f.location} onInput=${set('location')} /><//>
    </div>
    ${shrinking && html`<p class="warn">Já há ${course.confirmed_count} vagas ocupadas. Ninguém perde a vaga, mas ninguém novo entra até sobrar lugar.</p>`}
    ${course.id && Number(f.capacity) > course.capacity && course.waitlist_count > 0 && html`
      <p class="note">Ao salvar, as novas vagas vão para a lista de espera, na ordem de chegada, com e-mail e comprovante.</p>`}
    <fieldset class="field"><legend class="field-label">Aberta para</legend>
      <div class="row">${[1, 2, 3].map((g) => html`<label class="check inline"><input type="checkbox" checked=${f.grades.includes(g)} onChange=${() => toggleGrade(g)} /><span>${g}º ano</span></label>`)}</div>
    </fieldset>
    <${Field} label="Descrição"><textarea rows="4" value=${f.description} onInput=${set('description')}></textarea><//>
    <div class="grid2">
      <${Field} label="Rodada">
        <select value=${f.round_id} onChange=${set('round_id')}>${rounds.map((r) => html`<option value=${r.id}>${r.title}</option>`)}</select>
      <//>
      <${Field} label="Ordem na lista"><input type="number" value=${f.sort_order} onInput=${set('sort_order')} /><//>
    </div>
    ${error && html`<p class="form-error" role="alert">${error}</p>`}
    <div class="row between">
      ${course.id ? html`<button type="button" class="btn ghost danger-text" onClick=${remove}>Excluir</button>` : html`<span></span>`}
      <div class="row"><button type="button" class="btn ghost" onClick=${onDone}>Cancelar</button><${Btn} busy=${busy} type="submit">Salvar<//></div>
    </div>
  </form>`
}

// ---------------------------------------------------------------- roster

function mailState(outbox = []) {
  const last = [...outbox].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
  if (!last) return null
  if (last.sent_at) return ['enviado', 'ok', `E-mail enviado ${fmtWhen(last.sent_at)}`]
  if (last.attempts >= 6) return ['falhou', 'bad', last.last_error ?? '']
  if (last.last_error) return ['tentando', 'wait', last.last_error]
  return ['na fila', 'wait', 'Aguardando envio']
}

function csv(rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  return '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n')
}

function Roster({ course, round }) {
  const [rows, setRows] = useState(null)
  const load = useCallback(async () => {
    try {
      setRows(await must(sb.from('enrollments')
        .select('id, code, status, applied_at, confirmed_at, drop_reason, drop_requested_at, end_note, ended_at, person:people!enrollments_person_id_fkey(full_name, email, grade, class_name), email_outbox(kind, created_at, sent_at, attempts, last_error)')
        .eq('course_id', course.id).order('applied_at').order('id')))
    } catch (e) { toast(friendly(e), 'error') }
  }, [course.id])
  useEffect(() => { load() }, [load])
  useEffect(() => watch(`roster-${course.id}`, [`enrollments?course_id=eq.${course.id}`], load), [load, course.id])

  if (!rows) return html`<div class="skeleton"></div>`
  const seated = rows.filter((r) => SEATED.includes(r.status))
  const waiting = rows.filter((r) => r.status === 'waitlisted')
  const ended = rows.filter((r) => !SEATED.includes(r.status) && r.status !== 'waitlisted')

  async function run(fn, args, done) {
    try { await rpc(fn, args); toast(done, 'ok') } catch (e) { toast(friendly(e), 'error') }
    load()
  }
  async function remove(r) {
    const a = await ask({
      title: `Remover ${r.person.full_name}?`,
      body: SEATED.includes(r.status) ? 'A vaga vai para a próxima pessoa da lista de espera, se houver. O estudante recebe um e-mail.' : 'O estudante sai da lista de espera e recebe um e-mail.',
      input: { label: 'Motivo (vai no e-mail, opcional)' }, confirm: 'Remover', danger: true,
    })
    if (a.ok) run('remove_enrollment', { p_enrollment_id: r.id, p_note: a.value || null }, 'Inscrição removida.')
  }
  async function resolve(r, approve) {
    const a = await ask({
      title: approve ? 'Aprovar desistência' : 'Negar desistência',
      body: approve ? `${r.person.full_name} sai da disciplina e a vaga vai para a lista de espera.` : `${r.person.full_name} continua com a vaga.`,
      input: { label: 'Observação para o estudante (opcional)' }, confirm: approve ? 'Aprovar' : 'Negar', danger: approve,
    })
    if (a.ok) run('resolve_drop', { p_enrollment_id: r.id, p_approve: approve, p_note: a.value || null }, approve ? 'Desistência aprovada.' : 'Desistência negada.')
  }
  function exportCsv() {
    const data = [['Posição', 'Situação', 'Nome', 'E-mail', 'Ano', 'Turma', 'Data', 'Hora (Brasília)', 'Código']]
    ;[...seated, ...waiting, ...ended].forEach((r, i) => data.push([
      i + 1, { confirmed: 'Confirmada', drop_requested: 'Desistência pendente', waitlisted: 'Espera', dropped: 'Desistiu', removed: 'Removida', left_waitlist: 'Saiu da espera' }[r.status],
      r.person.full_name, r.person.email, r.person.grade ?? '', r.person.class_name ?? '', fmtDate(r.applied_at), fmtMs(r.applied_at), formatCode(r.code),
    ]))
    const url = URL.createObjectURL(new Blob([csv(data)], { type: 'text/csv;charset=utf-8' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: `${course.title} - inscritos.csv` })
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  const Row = (r, i) => {
    const mail = mailState(r.email_outbox)
    return html`<tr key=${r.id} class=${r.status}>
      <td class="mono">${i + 1}</td>
      <td><b>${r.person.full_name}</b><div class="muted small">${[r.person.class_name, r.person.email].filter(Boolean).join(' · ')}</div>
        ${r.status === 'drop_requested' && html`<div class="note small">Pediu desistência: “${r.drop_reason}”</div>`}
        ${r.end_note && html`<div class="muted small">Obs.: ${r.end_note}</div>`}</td>
      <td class="small">${fmtDay(r.applied_at)} <span class="mono">${fmtMs(r.applied_at)}</span>
        ${r.confirmed_at && new Date(r.confirmed_at) - new Date(r.applied_at) > 1000 && html`<div class="muted">vaga em ${fmtDay(r.confirmed_at)} ${fmtTime(r.confirmed_at)}</div>`}</td>
      <td><${StatusChip} status=${r.status} />${mail && html`<div class="mail ${mail[1]}" title=${mail[2]}>✉ ${mail[0]}</div>`}</td>
      <td class="actions">
        ${r.status === 'drop_requested' && html`
          <button class="btn primary sm" onClick=${() => resolve(r, true)}>Aprovar</button>
          <button class="btn ghost sm" onClick=${() => resolve(r, false)}>Negar</button>`}
        ${SEATED.includes(r.status) && html`
          <button class="btn ghost sm" title="Baixar comprovante" onClick=${() => downloadSlip(r.id).catch((e) => toast(friendly(e), 'error'))}>PDF</button>
          <button class="btn ghost sm" title="Reenviar comprovante por e-mail" onClick=${() => run('resend_slip', { p_enrollment_id: r.id }, 'Comprovante reenviado.')}>Reenviar</button>`}
        ${(SEATED.includes(r.status) || r.status === 'waitlisted') && html`
          <button class="btn ghost sm danger-text" onClick=${() => remove(r)}>Remover</button>`}
      </td>
    </tr>`
  }

  return html`<div class="roster">
    <div class="row between wrap">
      <p class="muted">${[course.schedule, course.teacher_names, 'ordem de chegada, ao milissegundo (Brasília)'].filter(Boolean).join(' · ')}</p>
      <button class="btn ghost sm" onClick=${exportCsv} disabled=${!rows.length}>Exportar planilha</button>
    </div>
    <${SeatMeter} capacity=${course.capacity} taken=${course.confirmed_count} waiting=${course.waitlist_count} />
    ${rows.length === 0 && html`<${Empty} title="Ninguém inscrito ainda." />`}
    ${seated.length > 0 && html`<h3 class="h4">Com vaga (${seated.length}/${course.capacity})</h3>
      <div class="table-wrap"><table class="table"><tbody>${seated.map(Row)}</tbody></table></div>`}
    ${waiting.length > 0 && html`<h3 class="h4">Lista de espera (${waiting.length})</h3>
      <div class="table-wrap"><table class="table"><tbody>${waiting.map(Row)}</tbody></table></div>`}
    ${ended.length > 0 && html`<details><summary class="h4">Saíram (${ended.length})</summary>
      <div class="table-wrap"><table class="table"><tbody>${ended.map(Row)}</tbody></table></div></details>`}
  </div>`
}
