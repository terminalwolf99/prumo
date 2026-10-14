import { html, useCallback, useEffect, useMemo, useState } from '../../lib/deps.js'
import { ACTIVE, friendly, must, rpc, sb } from '../../lib/db.js'
import { ask, Btn, Empty, Field, Modal, toast } from '../../lib/ui.js'

const ROLE = { student: 'Estudante', teacher: 'Professor(a)', admin: 'Administração' }
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export function PeopleTab({ me, kind }) {
  const students = kind === 'students'
  const [people, setPeople] = useState(null)
  const [counts, setCounts] = useState({})
  const [q, setQ] = useState('')
  const [grade, setGrade] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [edit, setEdit] = useState(null)
  const [importing, setImporting] = useState(false)

  const load = useCallback(async () => {
    try {
      let query = sb.from('people').select('*').order('full_name')
      query = students ? query.eq('role', 'student') : query.neq('role', 'student')
      const [p, e] = await Promise.all([
        must(query),
        must(sb.from('enrollments').select('person_id').in('status', ACTIVE)),
      ])
      const c = {}
      for (const row of e) c[row.person_id] = (c[row.person_id] ?? 0) + 1
      setPeople(p); setCounts(c)
    } catch (err) { toast(friendly(err), 'error') }
  }, [students])
  useEffect(() => { load() }, [load])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    return (people ?? []).filter((p) =>
      (showInactive || p.active) &&
      (!grade || String(p.grade) === grade) &&
      (!needle || `${p.full_name} ${p.email} ${p.class_name ?? ''}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(needle)))
  }, [people, q, grade, showInactive])

  async function toggleActive(p) {
    try {
      await must(sb.from('people').update({ active: !p.active }).eq('id', p.id))
      toast(p.active ? `Acesso de ${p.full_name} desativado.` : `Acesso de ${p.full_name} reativado.`, 'ok')
    } catch (e) { toast(friendly(e), 'error') }
    load()
  }

  async function remove(p) {
    const r = await ask({ title: 'Excluir', body: `Excluir ${p.full_name} (${p.email}) da lista?`, confirm: 'Excluir', danger: true })
    if (!r.ok) return
    try { await must(sb.from('people').delete().eq('id', p.id)); toast('Pessoa excluída da lista.', 'ok') } catch (e) { toast(friendly(e), 'error') }
    load()
  }

  if (!people) return html`<div class="skeleton"></div>`
  const activeCount = people.filter((p) => p.active).length
  const canEdit = (p) => me.role === 'admin' || p.role === 'student'

  return html`<section>
    <div class="section-head">
      <h1 class="h2">${students ? 'Estudantes' : 'Equipe'} <span class="muted">(${activeCount})</span></h1>
      <div class="row">
        ${students && html`<button class="btn ghost" onClick=${() => setImporting(true)}>Colar lista</button>`}
        <button class="btn primary" onClick=${() => setEdit({ role: students ? 'student' : 'teacher' })}>Adicionar</button>
      </div>
    </div>
    <p class="muted small">${students
      ? 'Só quem está nesta lista consegue entrar. Cada estudante entra com o próprio e-mail institucional e um código enviado na hora.'
      : 'Professores gerenciam rodadas, disciplinas, estudantes e desistências. A administração também gerencia a equipe e os ajustes.'}</p>

    <div class="toolbar">
      <input type="search" placeholder="Buscar nome, e-mail ou turma" value=${q} onInput=${(e) => setQ(e.target.value)} aria-label="Buscar" />
      ${students && html`<select value=${grade} onChange=${(e) => setGrade(e.target.value)} aria-label="Ano">
        <option value="">Todos os anos</option><option value="1">1º ano</option><option value="2">2º ano</option><option value="3">3º ano</option>
      </select>`}
      <label class="check inline"><input type="checkbox" checked=${showInactive} onChange=${(e) => setShowInactive(e.target.checked)} /><span>Mostrar desativados</span></label>
    </div>

    ${shown.length === 0
      ? html`<${Empty} title=${people.length ? 'Ninguém encontrado.' : students ? 'Nenhum estudante cadastrado.' : 'Ninguém na equipe ainda.'}>
          ${!people.length && students && 'Use “Colar lista” para trazer a turma inteira de uma planilha.'}<//>`
      : html`<div class="table-wrap"><table class="table">
          <thead><tr><th>Nome</th><th>E-mail</th>${students ? html`<th>Ano</th><th>Turma</th><th>Inscrições</th>` : html`<th>Papel</th>`}<th></th></tr></thead>
          <tbody>${shown.map((p) => html`<tr key=${p.id} class=${p.active ? '' : 'inactive'}>
            <td><b>${p.full_name}</b>${!p.active && html` <span class="chip off">desativado</span>`}</td>
            <td class="small">${p.email}</td>
            ${students ? html`<td>${p.grade ? `${p.grade}º` : '—'}</td><td>${p.class_name ?? '—'}</td><td class="mono">${counts[p.id] ?? 0}</td>`
                       : html`<td>${ROLE[p.role]}</td>`}
            <td class="actions">${canEdit(p) && p.id !== me.id && html`
              <button class="btn ghost sm" onClick=${() => setEdit(p)}>Editar</button>
              <button class="btn ghost sm" onClick=${() => toggleActive(p)}>${p.active ? 'Desativar' : 'Reativar'}</button>
              ${!counts[p.id] && html`<button class="btn ghost sm danger-text" onClick=${() => remove(p)}>Excluir</button>`}`}</td>
          </tr>`)}</tbody>
        </table></div>`}

    <${Modal} open=${!!edit} onClose=${() => setEdit(null)} title=${edit?.id ? 'Editar' : students ? 'Adicionar estudante' : 'Adicionar à equipe'}>
      ${edit && html`<${PersonForm} person=${edit} me=${me} onDone=${() => { setEdit(null); load() }} />`}
    <//>
    <${Modal} open=${importing} wide onClose=${() => setImporting(false)} title="Colar lista de estudantes">
      ${importing && html`<${ImportForm} onDone=${() => { setImporting(false); load() }} />`}
    <//>
  </section>`
}

function PersonForm({ person, me, onDone }) {
  const [f, setF] = useState(() => ({
    full_name: person.full_name ?? '', email: person.email ?? '', role: person.role ?? 'student',
    grade: person.grade ? String(person.grade) : '', class_name: person.class_name ?? '',
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => {
    const v = e.target.value
    setF((prev) => ({ ...prev, [k]: v }))
  }
  const student = f.role === 'student'

  async function save(e) {
    e.preventDefault()
    const email = f.email.trim().toLowerCase()
    if (!EMAIL.test(email)) { setError('Confira o e-mail.'); return }
    if (f.full_name.trim().length < 2) { setError('Escreva o nome completo.'); return }
    const row = {
      full_name: f.full_name, email, role: f.role,
      grade: student && f.grade ? Number(f.grade) : null, class_name: student ? f.class_name : null,
    }
    setBusy(true); setError('')
    try {
      if (person.id) await must(sb.from('people').update(row).eq('id', person.id))
      else await must(sb.from('people').insert(row))
      toast('Salvo.', 'ok'); onDone()
    } catch (err) { setError(friendly(err)) }
    setBusy(false)
  }

  return html`<form class="form" onSubmit=${save}>
    <${Field} label="Nome completo" hint="Aparece no comprovante exatamente assim."><input value=${f.full_name} onInput=${set('full_name')} required /><//>
    <${Field} label="E-mail institucional"><input type="email" value=${f.email} onInput=${set('email')} required /><//>
    ${person.role !== 'student' && me.role === 'admin' && html`<${Field} label="Papel">
      <select value=${f.role} onChange=${set('role')}><option value="teacher">Professor(a)</option><option value="admin">Administração</option></select>
    <//>`}
    ${student && html`<div class="grid2">
      <${Field} label="Ano"><select value=${f.grade} onChange=${set('grade')}><option value="">—</option><option value="1">1º ano</option><option value="2">2º ano</option><option value="3">3º ano</option></select><//>
      <${Field} label="Turma"><input value=${f.class_name} onInput=${set('class_name')} placeholder="2º B" /><//>
    </div>`}
    ${error && html`<p class="form-error" role="alert">${error}</p>`}
    <div class="row end"><button type="button" class="btn ghost" onClick=${onDone}>Cancelar</button><${Btn} busy=${busy} type="submit">Salvar<//></div>
  </form>`
}

// Reads lines pasted from a spreadsheet (tab, ; or , separated), in any column order:
// the cell with "@" is the e-mail, "2", "2º" or "2º ano" is the year, the longest
// remaining cell is the name and a short one is the class.
export function parseRoster(text) {
  const rows = []
  let first = true
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    const sep = line.includes('\t') ? '\t' : line.includes(';') ? ';' : ','
    const cells = line.split(sep).map((c) => c.trim()).filter(Boolean)
    const header = first && !cells.some((c) => c.includes('@'))
    first = false
    if (header) continue
    const row = { line: i + 1, email: '', full_name: '', grade: '', class_name: '' }
    const rest = []
    for (const c of cells) {
      if (!row.email && c.includes('@')) row.email = c.toLowerCase()
      else if (!row.grade && /^[1-3]\s*(º|°|o|ª)?\s*(ano)?$/i.test(c)) row.grade = c[0]
      else rest.push(c)
    }
    rest.sort((a, b) => b.length - a.length)
    row.full_name = rest.shift() ?? ''
    row.class_name = rest[0] ?? ''
    if (!row.grade) row.grade = /^([1-3])/.exec(row.class_name)?.[1] ?? ''
    row.problem = !row.email ? 'sem e-mail' : !EMAIL.test(row.email) ? 'e-mail inválido' : row.full_name.length < 2 ? 'sem nome' : ''
    rows.push(row)
  }
  return rows
}

function ImportForm({ onDone }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState(null)
  const rows = useMemo(() => parseRoster(text), [text])
  const good = rows.filter((r) => !r.problem)

  async function run() {
    setBusy(true)
    try {
      const res = await rpc('import_people', {
        p_rows: good.map(({ email, full_name, grade, class_name }) => ({ email, full_name, grade, class_name })),
        p_role: 'student',
      })
      setReport(res)
      if (!res.errors.length) toast(`${res.added} adicionados, ${res.updated} atualizados.`, 'ok')
    } catch (e) { toast(friendly(e), 'error') }
    setBusy(false)
  }

  if (report) {
    return html`<div class="form">
      <p><b>${report.added}</b> adicionados · <b>${report.updated}</b> atualizados${report.errors.length ? html` · <b class="danger-text">${report.errors.length}</b> com problema` : ''}</p>
      ${report.errors.length > 0 && html`<ul class="errors">${report.errors.map((e) => html`<li>${e.email}: ${friendly({ message: e.error })}</li>`)}</ul>`}
      <div class="row end"><button class="btn primary" onClick=${onDone}>Concluir</button></div>
    </div>`
  }

  return html`<div class="form">
    <p class="muted">Copie as colunas da planilha da secretaria e cole aqui: nome, e-mail, ano e turma, em qualquer ordem. Quem já está na lista é atualizado.</p>
    <textarea class="mono paste" rows="8" value=${text} onInput=${(e) => setText(e.target.value)}
      placeholder=${'Ana Beatriz Souza\tana.souza@escola\t2\t2º B\nBruno Lima; bruno.lima@escola; 1; 1º A'}></textarea>
    ${rows.length > 0 && html`<div class="table-wrap preview"><table class="table">
      <thead><tr><th>Nome</th><th>E-mail</th><th>Ano</th><th>Turma</th><th></th></tr></thead>
      <tbody>${rows.slice(0, 200).map((r) => html`<tr key=${r.line} class=${r.problem ? 'bad' : ''}>
        <td>${r.full_name}</td><td class="small">${r.email}</td><td>${r.grade ? `${r.grade}º` : '—'}</td><td>${r.class_name || '—'}</td>
        <td class="small danger-text">${r.problem}</td></tr>`)}</tbody>
    </table></div>`}
    <div class="row between">
      <span class="muted small">${rows.length ? `${good.length} prontos${rows.length - good.length ? `, ${rows.length - good.length} com problema` : ''}` : ''}</span>
      <${Btn} busy=${busy} disabled=${!good.length} onClick=${run}>Importar ${good.length || ''}<//>
    </div>
  </div>`
}
