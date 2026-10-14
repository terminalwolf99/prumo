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
  const [domain, setDomain] = useState('')
  const [busy, setBusy] = useState('')
  const [template, setTemplate] = useState(null)
  const [mail, setMail] = useState([])

  const load = useCallback(async () => {
    try {
      const [settings, info, outbox] = await Promise.all([
        must(sb.from('settings').select('*').single()),
        rpc('slip_template_info'),
        must(sb.from('email_outbox')
          .select('id, kind, created_at, sent_at, attempts, last_error, enrollment:enrollments(person:people!enrollments_person_id_fkey(full_name, email), course:courses(title))')
          .order('id', { ascending: false }).limit(40)),
      ])
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

  function addDomain(e) {
    e.preventDefault()
    const d = domain.trim().toLowerCase().replace(/^@/, '')
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) { toast('Domínio inválido. Ex.: escola.sc.gov.br', 'error'); return }
    setDomain('')
    saveSettings({ allowed_domains: [...new Set([...s.allowed_domains, d])] }, `@${d} adicionado.`)
  }

  async function removeDomain(d) {
    const r = await ask({ title: `Remover @${d}?`, body: 'Quem já está na lista continua. Só novos cadastros passam a ser recusados.', confirm: 'Remover', danger: true })
    if (r.ok) saveSettings({ allowed_domains: s.allowed_domains.filter((x) => x !== d) }, `@${d} removido.`)
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
      <p class="muted small">Só e-mails destes domínios podem ser cadastrados. A administração é exceção (pode usar Gmail).</p>
      ${s.allowed_domains.length === 0 && html`<p class="warn">Nenhum domínio definido: por enquanto, qualquer e-mail pode ser cadastrado.</p>`}
      <div class="chips">${s.allowed_domains.map((d) => html`<span class="chip on-chip" key=${d}>@${d}
        ${admin && html`<button class="chip-x" aria-label=${`Remover ${d}`} onClick=${() => removeDomain(d)}>✕</button>`}</span>`)}</div>
      ${admin && html`<form class="row wrap" onSubmit=${addDomain}>
        <input value=${domain} onInput=${(e) => setDomain(e.target.value)} placeholder="escola.sc.gov.br" aria-label="Novo domínio" />
        <button class="btn ghost" disabled=${!domain.trim()}>Adicionar domínio</button>
      </form>`}
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
          <td class="small">${m.sent_at ? html`<span class="mail ok">enviado</span>`
            : m.attempts >= 6 ? html`<span class="mail bad" title=${m.last_error}>falhou</span>`
            : html`<span class="mail wait" title=${m.last_error ?? ''}>${m.last_error ? 'tentando de novo' : 'na fila'}</span>`}
            ${m.last_error && !m.sent_at && html`<div class="muted mono tiny">${m.last_error.slice(0, 120)}</div>`}</td>
        </tr>`)}</tbody>
      </table></div>`}
    </section>
  </div>`
}
