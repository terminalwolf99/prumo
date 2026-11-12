import { html, useCallback, useEffect, useMemo, useState } from '../../lib/deps.js'
import { friendly, must, rpc, sb, watch } from '../../lib/db.js'
import { fmtDate, fmtMs, fmtWhen, serverNow } from '../../lib/time.js'
import { ask, Btn, Empty, Field, formatCode, Modal, toast } from '../../lib/ui.js'
import { roundState } from './rounds.js'

const WEEKDAYS = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira']
const dayOrder = (label) => (WEEKDAYS.indexOf(label) >= 0 ? WEEKDAYS.indexOf(label) + 1 : 9)
const anoLabel = (g) => `${g}º ano`

function saveCsv(name, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const body = '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// The 1º/2º structure from the school's spec, as a one-click starting point.
const TEMPLATE = [
  [1, 'Terça-feira', ['História', 'Literatura', 'Geografia']],
  [1, 'Quarta-feira', ['Inglês', 'Artes', 'Física']],
  [1, 'Quinta-feira', ['Química', 'Matemática', 'Biologia']],
  [2, 'Terça-feira', ['Matemática', 'Física']],
  [2, 'Quarta-feira', ['Inglês', 'Artes']],
  [2, 'Quinta-feira', ['História', 'Literatura']],
]

export function RankingDetail({ round, courses, now, reload, onEditRound, onDuplicated }) {
  const [editOption, setEditOption] = useState(null)
  const [showList, setShowList] = useState(false)
  const [count, setCount] = useState(null)

  const countSubs = useCallback(async () => {
    const { count: n } = await sb.from('ranking_submissions').select('id', { count: 'exact', head: true }).eq('round_id', round.id)
    setCount(n ?? 0)
  }, [round.id])
  useEffect(() => { countSubs() }, [countSubs])
  useEffect(() => watch(`rank-count-${round.id}`, [`ranking_submissions?round_id=eq.${round.id}`], countSubs, 800), [countSubs, round.id])

  const years = useMemo(() => {
    const set = new Set()
    for (const c of courses) for (const g of c.grades) set.add(g)
    return [...set].sort()
  }, [courses])

  async function useTemplate() {
    const r = await ask({ title: 'Usar o modelo 1º/2º', body: 'Cria as disciplinas de terça, quarta e quinta para o 1º e o 2º ano, como na folha da escola. Você ajusta depois.', confirm: 'Criar' })
    if (!r.ok) return
    const rows = []
    for (const [grade, day, subjects] of TEMPLATE) {
      subjects.forEach((title, i) => rows.push({
        round_id: round.id, title, group_label: day, group_order: dayOrder(day),
        grades: [grade], capacity: 0, sort_order: i + 1,
      }))
    }
    try { await must(sb.from('courses').insert(rows)); toast('Modelo criado.', 'ok') } catch (e) { toast(friendly(e), 'error') }
    reload()
  }

  async function removeOption(c) {
    const r = await ask({ title: 'Excluir opção', body: `Remover “${c.title}” de ${c.group_label} (${anoLabel(c.grades[0])})?`, confirm: 'Excluir', danger: true })
    if (!r.ok) return
    try { await must(sb.from('courses').delete().eq('id', c.id)); toast('Opção removida.', 'ok') } catch (e) { toast(friendly(e), 'error') }
    reload()
  }

  const sorted = [...courses].sort((a, b) =>
    (a.grades[0] - b.grades[0]) || (a.group_order - b.group_order) || (a.sort_order - b.sort_order) || a.title.localeCompare(b.title))

  return html`<div class="ranking-admin">
    <${RankingHeader} round=${round} now=${now} count=${count} onEditRound=${onEditRound} onDuplicated=${onDuplicated} reload=${reload} onList=${() => setShowList(true)} />

    <div class="section-head">
      <h2 class="h3">Disciplinas por dia <span class="muted">(${courses.length})</span></h2>
      <div class="row">
        ${courses.length === 0 && html`<button class="btn ghost sm" onClick=${useTemplate}>Usar modelo 1º/2º</button>`}
        <button class="btn primary sm" onClick=${() => setEditOption({ round_id: round.id, grades: [years[0] ?? 1] })}>Nova opção</button>
      </div>
    </div>

    ${courses.length === 0
      ? html`<${Empty} title="Nenhuma disciplina ainda.">Use o modelo 1º/2º para começar, ou adicione cada opção.<//>`
      : years.map((g) => html`<div key=${g} class="rank-year">
          <h3 class="h4">${anoLabel(g)}</h3>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Dia</th><th>Disciplina</th><th></th></tr></thead>
            <tbody>${sorted.filter((c) => c.grades.includes(g)).map((c) => html`<tr key=${c.id}>
              <td class="small">${c.group_label ?? '—'}</td>
              <td><b>${c.title}</b>${c.teacher_names && html`<div class="muted small">${c.teacher_names}</div>`}</td>
              <td class="actions">
                <button class="btn ghost sm" onClick=${() => setEditOption(c)}>Editar</button>
                <button class="btn ghost sm danger-text" onClick=${() => removeOption(c)}>Excluir</button>
              </td>
            </tr>`)}</tbody>
          </table></div>
        </div>`)}

    <${Modal} open=${!!editOption} onClose=${() => setEditOption(null)} title=${editOption?.id ? 'Editar opção' : 'Nova opção'}>
      ${editOption && html`<${OptionForm} course=${editOption} onDone=${() => { setEditOption(null); reload() }} />`}
    <//>
    <${Modal} open=${showList} wide onClose=${() => setShowList(false)} title=${`Inscritos · ${round.title}`}>
      ${showList && html`<${RankingListView} round=${round} />`}
    <//>
  </div>`
}

function RankingHeader({ round, now, count, onEditRound, onDuplicated, reload, onList }) {
  const [label, kind] = roundState(round, now)
  const [busy, setBusy] = useState(false)

  async function togglePublish() {
    if (!round.published && new Date(round.opens_at).getTime() <= serverNow()) {
      const r = await ask({ title: 'Publicar agora?', body: 'O horário de abertura já passou, então as inscrições abrem assim que você publicar.', confirm: 'Publicar e abrir' })
      if (!r.ok) return
    }
    setBusy(true)
    try {
      await must(sb.from('rounds').update({ published: !round.published }).eq('id', round.id))
      toast(round.published ? 'Rodada escondida dos estudantes.' : 'Rodada publicada.', 'ok')
    } catch (e) { toast(friendly(e), 'error') }
    setBusy(false); reload()
  }

  async function duplicate() {
    const r = await ask({ title: 'Duplicar rodada', body: 'Cria uma cópia em rascunho, com as mesmas disciplinas e nenhuma inscrição.', input: { label: 'Nome da nova rodada', placeholder: `${round.title} (cópia)` }, confirm: 'Duplicar' })
    if (!r.ok) return
    try {
      const id = await rpc('duplicate_round', { p_round_id: round.id, p_title: r.value || null })
      toast('Cópia criada como rascunho.', 'ok'); onDuplicated(id)
    } catch (e) { toast(friendly(e), 'error') }
  }

  async function remove() {
    const r = await ask({ title: 'Excluir rodada', body: `Isso apaga “${round.title}”, suas disciplinas e todas as inscrições. Não dá para desfazer.`, confirm: 'Excluir tudo', danger: true })
    if (!r.ok) return
    try { await must(sb.from('rounds').delete().eq('id', round.id)); toast('Rodada excluída.', 'ok') } catch (e) { toast(friendly(e), 'error') }
    reload()
  }

  return html`<div class="round-head card">
    <div class="round-head-main">
      <span class="row small-gap"><span class="chip ${kind}">${label}</span><span class="chip brandy">por preferência</span>${round.is_test && html`<span class="chip test">rodada de teste</span>`}</span>
      <h1 class="h2">${round.title}</h1>
      <p class="muted">Abre <b>${fmtWhen(round.opens_at)}</b> · fecha <b>${fmtWhen(round.closes_at)}</b> <span class="small">(Brasília)</span></p>
    </div>
    <div class="stats"><div><b>${count ?? '—'}</b><span>inscritos</span></div></div>
    <div class="row wrap">
      <${Btn} kind=${round.published ? 'ghost' : 'primary'} busy=${busy} onClick=${togglePublish}>${round.published ? 'Despublicar' : 'Publicar para estudantes'}<//>
      <button class="btn ghost" onClick=${onList}>Ver inscritos</button>
      <button class="btn ghost" onClick=${onEditRound}>Editar</button>
      <button class="btn ghost" onClick=${duplicate}>Duplicar</button>
      <button class="btn ghost danger-text" onClick=${remove}>Excluir</button>
    </div>
  </div>`
}

function OptionForm({ course, onDone }) {
  const [f, setF] = useState(() => ({
    title: course.title ?? '', grade: String(course.grades?.[0] ?? 1),
    group_label: course.group_label ?? 'Terça-feira', teacher_names: course.teacher_names ?? '',
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => { const v = e.target.value; setF((p) => ({ ...p, [k]: v })) }

  async function save(e) {
    e.preventDefault()
    if (!f.title.trim()) { setError('Dê um nome para a disciplina.'); return }
    if (!f.group_label.trim()) { setError('Informe o dia.'); return }
    const row = {
      round_id: course.round_id, title: f.title.trim(), teacher_names: f.teacher_names.trim() || null,
      group_label: f.group_label.trim(), group_order: dayOrder(f.group_label.trim()),
      grades: [Number(f.grade)], capacity: 0,
    }
    setBusy(true); setError('')
    try {
      if (course.id) await must(sb.from('courses').update(row).eq('id', course.id))
      else {
        const { count } = await sb.from('courses').select('id', { count: 'exact', head: true })
          .eq('round_id', course.round_id).eq('group_label', row.group_label).contains('grades', [Number(f.grade)])
        await must(sb.from('courses').insert({ ...row, sort_order: (count ?? 0) + 1 }))
      }
      toast('Opção salva.', 'ok'); onDone()
    } catch (err) { setError(friendly(err)) }
    setBusy(false)
  }

  return html`<form class="form" onSubmit=${save}>
    <${Field} label="Disciplina"><input value=${f.title} onInput=${set('title')} required /><//>
    <div class="grid2">
      <${Field} label="Ano"><select value=${f.grade} onChange=${set('grade')}><option value="1">1º ano</option><option value="2">2º ano</option><option value="3">3º ano</option></select><//>
      <${Field} label="Dia">
        <input list="weekdays" value=${f.group_label} onInput=${set('group_label')} />
        <datalist id="weekdays">${WEEKDAYS.map((d) => html`<option value=${d} />`)}</datalist>
      <//>
    </div>
    <${Field} label="Professor(a) (opcional)"><input value=${f.teacher_names} onInput=${set('teacher_names')} /><//>
    <p class="muted small">Cada opção vale para um ano e um dia. Disciplinas que aparecem nos dois anos são criadas uma vez por ano.</p>
    ${error && html`<p class="form-error" role="alert">${error}</p>`}
    <div class="row end"><button type="button" class="btn ghost" onClick=${onDone}>Cancelar</button><${Btn} busy=${busy} type="submit">Salvar<//></div>
  </form>`
}

function RankingListView({ round }) {
  const [rows, setRows] = useState(null)
  const load = useCallback(async () => {
    try { setRows(await rpc('ranking_list', { p_round_id: round.id })) } catch (e) { toast(friendly(e), 'error') }
  }, [round.id])
  useEffect(() => { load() }, [load])
  useEffect(() => watch(`rank-list-${round.id}`, [`ranking_submissions?round_id=eq.${round.id}`], load, 800), [load, round.id])

  const days = useMemo(() => {
    const set = new Set()
    for (const r of rows ?? []) for (const ch of r.choices ?? []) set.add(ch.group_label)
    return [...set].sort((a, b) => dayOrder(a) - dayOrder(b) || a.localeCompare(b))
  }, [rows])

  if (!rows) return html`<div class="skeleton"></div>`

  const ordered = (choices, day) => (choices ?? []).filter((c) => c.group_label === day).sort((a, b) => a.rank - b.rank)

  function exportCsv() {
    const header = ['Posição', 'Nome', 'E-mail', 'Ano', 'Turma', 'Data', 'Hora (Brasília)', 'Código', ...days]
    const data = [header]
    rows.forEach((r, i) => data.push([
      i + 1, r.full_name, r.email, r.grade ? `${r.grade}º` : '', r.class_name ?? '',
      fmtDate(r.created_at), fmtMs(r.created_at), formatCode(r.code),
      ...days.map((d) => ordered(r.choices, d).map((c) => `${c.rank}. ${c.title}`).join(' | ')),
    ]))
    saveCsv(`${round.title} - inscritos.csv`, data)
  }

  return html`<div class="rank-list-view">
    <div class="row between wrap">
      <p class="muted">${rows.length} ${rows.length === 1 ? 'inscrito' : 'inscritos'} · ordem de chegada, ao milissegundo (Brasília)</p>
      <button class="btn ghost sm" onClick=${exportCsv} disabled=${!rows.length}>Exportar planilha</button>
    </div>
    ${rows.length === 0
      ? html`<${Empty} title="Ninguém inscrito ainda." />`
      : html`<div class="table-wrap"><table class="table">
          <thead><tr><th>#</th><th>Estudante</th><th>Chegada</th>${days.map((d) => html`<th key=${d}>${d}</th>`)}</tr></thead>
          <tbody>${rows.map((r, i) => html`<tr key=${r.submission_id}>
            <td class="mono">${i + 1}</td>
            <td><b>${r.full_name}</b><div class="muted small">${[r.class_name, r.email].filter(Boolean).join(' · ')}</div></td>
            <td class="small">${fmtDate(r.created_at)}<div class="muted mono">${fmtMs(r.created_at)}</div></td>
            ${days.map((d) => html`<td class="small rank-cell" key=${d}>
              <ol>${ordered(r.choices, d).map((c) => html`<li key=${c.rank} class=${c.rank === 1 ? 'first' : ''}>${c.title}</li>`)}</ol>
            </td>`)}
          </tr>`)}</tbody>
        </table></div>`}
  </div>`
}
