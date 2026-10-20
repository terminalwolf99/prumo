import { html, useCallback, useEffect, useState } from '../../lib/deps.js'
import { friendly, must, rpc, sb } from '../../lib/db.js'
import { previewSlip } from '../../lib/slip.js'
import { fmtWhen } from '../../lib/time.js'
import { ask, Btn, Field, toast } from '../../lib/ui.js'

const KIND = {
  confirmed: 'Comprovante', promoted: 'Vaga liberada', waitlisted: 'Lista de espera',
  drop_approved: 'Desistência aprovada', drop_rejected: 'Desistência negada', removed: 'Remoção',
}

export function SettingsTab({ me }) {
  const admin = me.role === 'admin'
  const [s, setS] = useState(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState('')
  const [template, setTemplate] = useState(null)
  const [mail, setMail] = useState([])
  const [status, setStatus] = useState(null)

  const load = useCallback(async () => {
    try {
      const [settings, info, outbox, st] = await Promise.all([
        must(sb.from('settings').select('*').single()),
        rpc('slip_template_info'),
        must(sb.from('email_outbox')
          .select('id, kind, created_at, sent_at, attempts, last_error, enrollment:enrollments(person:people!enrollments_person_id_fkey(full_name, email), course:courses(title))')
          .order('id', { ascending: false }).limit(40)),
        rpc('mail_status'),
      ])
      setStatus(st)
      setS(settings); setName(settings.school_name); setTemplate(info?.[0] ?? null); setMail(outbox)
    } catch (e) { toast(friendly(e), 'error') }
  }, [])
  useEffect(() => { load() }, [load])

  async function saveSettings(patch, done) {
    try {
      await must(sb.from('settings').update(patch).eq('id', true))
      toast(done, 'ok')
    } catch (e) { toast(friendly(e), 'error') }
    load()
  }

  async function upload(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.type !== 'application/pdf') { toast('Escolha um arquivo PDF.', 'error'); return }
    setBusy('upload')
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let bin = ''
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      await rpc('set_slip_template', { p_base64: btoa(bin), p_filename: file.name })
      toast('Modelo enviado. Confira na pré-visualização.', 'ok')
    } catch (err) { toast(friendly(err), 'error') }
    setBusy(''); load()
  }

  async function clearTemplate() {
    const r = await ask({ title: 'Remover modelo?', body: 'Os comprovantes voltam a usar o layout provisório.', confirm: 'Remover', danger: true })
    if (!r.ok) return
    try { await rpc('set_slip_template', { p_base64: null }); toast('Modelo removido.', 'ok') } catch (e) { toast(friendly(e), 'error') }
    load()
  }

  async function preview() {
    setBusy('preview')
    try { await previewSlip() } catch (e) { toast(friendly(e), 'error') }
    setBusy('')
  }

  if (!s) return html`<div class="skeleton"></div>`
  return html`<div class="settings">
    <${MailStatus} status=${status} />
    <section class="card">
      <h2 class="h3">Escola</h2>
      <form class="row end wrap" onSubmit=${(e) => { e.preventDefault(); saveSettings({ school_name: name.trim() }, 'Nome salvo.') }}>
        <${Field} label="Nome que aparece nos e-mails e no comprovante" class="grow">
          <input value=${name} onInput=${(e) => setName(e.target.value)} disabled=${!admin} />
        <//>
        ${admin && html`<button class="btn primary" disabled=${!name.trim() || name === s.school_name}>Salvar</button>`}
      </form>
    </section>

    <section class="card">
      <h2 class="h3">Domínios institucionais</h2>
      <p class="muted small">Cada papel só pode ser cadastrado com e-mail do seu domínio. A administração é exceção.</p>
      <${DomainList} label="Estudantes" field="student_domains" example="aluno.autonomia.com.br" settings=${s} admin=${admin} save=${saveSettings} />
      <${DomainList} label="Professores" field="staff_domains" example="autonomia.com.br" settings=${s} admin=${admin} save=${saveSettings} />
    </section>

    <section class="card">
      <h2 class="h3">Comprovante (PDF)</h2>
      <p class="muted small">Todos recebem o mesmo PDF; o sistema escreve o nome, a disciplina, o horário de inscrição e o código de cada estudante.</p>
      <p>${template
        ? html`Modelo atual: <b>${template.filename ?? 'modelo.pdf'}</b> · ${Math.round(template.size_bytes / 1024)} KB · enviado em ${fmtWhen(template.uploaded_at)}`
        : html`<span class="muted">Usando o layout provisório.</span>`}</p>
      <div class="row wrap">
        <${Btn} kind="ghost" busy=${busy === 'preview'} onClick=${preview}>Pré-visualizar<//>
        <label class="btn ghost ${busy === 'upload' ? 'is-busy' : ''}">
          <input type="file" accept="application/pdf" class="sr-only" onChange=${upload} />Enviar modelo em PDF
        </label>
        ${template && html`<button class="btn ghost danger-text" onClick=${clearTemplate}>Remover modelo</button>`}
      </div>
    </section>

    <section class="card">
      <div class="row between"><h2 class="h3">E-mails recentes</h2><button class="btn ghost sm" onClick=${load}>Atualizar</button></div>
      ${mail.length === 0 ? html`<p class="muted small">Nenhum e-mail ainda.</p>` : html`<div class="table-wrap"><table class="table">
        <thead><tr><th>Quando</th><th>Para</th><th>Tipo</th><th>Situação</th></tr></thead>
        <tbody>${mail.map((m) => html`<tr key=${m.id}>
          <td class="small">${fmtWhen(m.created_at)}</td>
          <td class="small"><b>${m.enrollment?.person?.full_name}</b><div class="muted">${m.enrollment?.course?.title}</div></td>
          <td class="small">${KIND[m.kind] ?? m.kind}</td>
          <td class="small">${m.sent_at && m.last_error?.startsWith('endereço de teste') ? html`<span class="mail off">não enviado (teste)</span>` : m.sent_at ? html`<span class="mail ok">enviado</span>`
            : m.attempts >= 6 ? html`<span class="mail bad" title=${m.last_error}>falhou</span>`
            : html`<span class="mail wait" title=${m.last_error ?? ''}>${m.last_error ? 'tentando de novo' : 'na fila'}</span>`}
            ${m.last_error && !m.sent_at && html`<div class="muted mono tiny">${m.last_error.slice(0, 120)}</div>`}</td>
        </tr>`)}</tbody>
      </table></div>`}
    </section>
  </div>`
}

function DomainList({ label, field, example, settings, admin, save }) {
  const [value, setValue] = useState('')
  const list = settings[field]

  function add(e) {
    e.preventDefault()
    const d = value.trim().toLowerCase().replace(/^.*@/, '')
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) { toast(`Domínio inválido. Ex.: ${example}`, 'error'); return }
    setValue('')
    save({ [field]: [...new Set([...list, d])] }, `@${d} adicionado.`)
  }

  async function remove(d) {
    const r = await ask({ title: `Remover @${d}?`, body: 'Quem já está cadastrado continua. Só novos cadastros passam a ser recusados.', confirm: 'Remover', danger: true })
    if (r.ok) save({ [field]: list.filter((x) => x !== d) }, `@${d} removido.`)
  }

  return html`<div class="domain-list">
    <p class="field-label">${label}</p>
    ${list.length === 0 && html`<p class="warn">Nenhum domínio: qualquer e-mail é aceito para ${label.toLowerCase()}.</p>`}
    <div class="chips">${list.map((d) => html`<span class="chip on-chip" key=${d}>@${d}
      ${admin && html`<button class="chip-x" aria-label=${`Remover ${d}`} onClick=${() => remove(d)}>✕</button>`}</span>`)}</div>
    ${admin && html`<form class="row wrap" onSubmit=${add}>
      <input value=${value} onInput=${(e) => setValue(e.target.value)} placeholder=${example} aria-label=${`Novo domínio para ${label.toLowerCase()}`} />
      <button class="btn ghost" disabled=${!value.trim()}>Adicionar</button>
    </form>`}
  </div>`
}

// Whether e-mails can actually go out (the mailer reports this on every run).
function MailStatus({ status }) {
  if (!status) return null
  const ready = status.configured === true
  return html`<section class="card mail-status ${ready ? 'ok' : 'off'}">
    <div class="row between wrap">
      <h2 class="h3">Envio de e-mails: ${ready ? 'funcionando' : 'não configurado'}</h2>
      <span class="chip ${ready ? 'ok' : 'pending'}">${status.pending} na fila · ${status.sent_24h} enviados em 24 h${status.failed ? ` · ${status.failed} falharam` : ''}</span>
    </div>
    ${ready
      ? html`<p class="muted small">Códigos de acesso e comprovantes estão saindo normalmente.</p>`
      : html`<p class="small">Sem um remetente, estudantes não recebem o código para entrar nem o comprovante.
          A configuração leva uns 5 minutos: no computador do projeto, rode <code>scripts/configurar-email.ps1</code> (veja o README).
          O que estiver na fila sai assim que o envio funcionar.</p>`}
  </section>`
}
