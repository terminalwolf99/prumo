// Public page behind the QR on every slip: #/verificar/ABCD-1234.
// No login: the code itself is the proof of holding the slip.
import { html, useEffect, useState } from '../lib/deps.js'
import { friendly, rpc } from '../lib/db.js'
import { fmtDate, fmtMs } from '../lib/time.js'
import { Btn, Field, formatCode, SchoolLogo, Wordmark } from '../lib/ui.js'

const VERDICT = {
  confirmed: ['ok', 'Comprovante válido', 'A vaga está confirmada.'],
  drop_requested: ['ok', 'Comprovante válido', 'A vaga está confirmada; há um pedido de desistência em análise.'],
  waitlisted: ['wait', 'Inscrição na lista de espera', 'Ainda não há vaga confirmada para esta inscrição.'],
  dropped: ['bad', 'Inscrição encerrada', 'A desistência foi aprovada; este comprovante não vale mais.'],
  removed: ['bad', 'Inscrição cancelada', 'A coordenação cancelou esta inscrição; este comprovante não vale mais.'],
  left_waitlist: ['bad', 'Inscrição encerrada', 'A pessoa saiu da lista de espera.'],
}

export function Verify({ initial }) {
  const [code, setCode] = useState(initial ? formatCode(initial.replace(/[^0-9a-z]/gi, '').toUpperCase()) : '')
  const [result, setResult] = useState(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function check(value) {
    const clean = value.replace(/[^0-9a-z]/gi, '').toUpperCase()
    if (clean.length !== 8) { setError('O código tem 8 letras e números, como AB12-CD34.'); return }
    setBusy(true); setError('')
    try { setResult(await rpc('verify_slip', { p_code: clean })) } catch (e) { setError(friendly(e)) }
    setBusy(false)
  }

  useEffect(() => {
    if (!initial) return
    setCode(formatCode(initial.replace(/[^0-9a-z]/gi, '').toUpperCase()))
    check(initial)
  }, [initial])

  const [kind, title, line] = result ? VERDICT[result.status] ?? ['bad', 'Inscrição', ''] : []
  return html`<main class="center-page verify">
    <div class="verify-col">
      <div class="verify-brand"><${SchoolLogo} small /><${Wordmark} small /></div>
      <section class="card verify-card">
        <h1 class="h2">Verificar comprovante</h1>
        <form class="row" onSubmit=${(e) => { e.preventDefault(); check(code) }}>
          <input class="mono verify-input" value=${code} maxlength="9" autocapitalize="characters" spellcheck="false"
            placeholder="AB12-CD34" aria-label="Código do comprovante" onInput=${(e) => setCode(e.target.value.toUpperCase())} />
          <${Btn} busy=${busy} type="submit">Verificar<//>
        </form>
        ${error && html`<p class="form-error" role="alert">${error}</p>`}
        ${result === null && html`<div class="verdict bad" role="status">
          <div class="verdict-mark" aria-hidden="true">✕</div>
          <div><b>Código não encontrado</b><p>Nenhuma inscrição tem esse código. Confira se foi digitado certo.</p></div>
        </div>`}
        ${result && html`<div class="verdict ${result.is_test ? 'bad' : kind}" role="status">
          <div class="verdict-mark" aria-hidden="true">${kind === 'ok' && !result.is_test ? '✓' : kind === 'wait' ? '…' : '!'}</div>
          <div>
            <b>${result.is_test ? 'Inscrição de teste (não vale como comprovante)' : title}</b>
            <p>${line}</p>
          </div>
        </div>
        <dl class="receipt">
          <div><dt>Estudante</dt><dd>${result.full_name}${result.class_name ? ` · ${result.class_name}` : ''}</dd></div>
          <div><dt>Disciplina</dt><dd>${result.course}</dd></div>
          ${result.schedule && html`<div><dt>Horário</dt><dd>${result.schedule}</dd></div>`}
          <div><dt>Rodada</dt><dd>${result.round}</dd></div>
          <div><dt>Registrada em</dt><dd>${fmtDate(result.applied_at)} · <span class="mono">${fmtMs(result.applied_at)}</span></dd></div>
        </dl>
        <p class="muted small">${result.school} · horário de Brasília</p>`}
      </section>
      <a class="link small" href="#/">Ir para o Prumo</a>
    </div>
  </main>`
}
