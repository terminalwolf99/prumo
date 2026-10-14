import { html, useEffect, useRef, useState } from '../lib/deps.js'
import { friendly, sb } from '../lib/db.js'
import { Btn, Field, SchoolLogo, Wordmark } from '../lib/ui.js'

const RESEND_AFTER = 60

export function Login() {
  const [step, setStep] = useState('email')
  const [email, setEmail] = useState(() => { try { return localStorage.getItem('autonomia:email') ?? '' } catch { return '' } })
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [wait, setWait] = useState(0)
  const codeRef = useRef()

  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait(wait - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  useEffect(() => { if (step === 'code') codeRef.current?.focus() }, [step])

  async function sendCode(e) {
    e?.preventDefault()
    const clean = email.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) { setError('Confira o e-mail.'); return }
    setBusy(true); setError('')
    const { error } = await sb.auth.signInWithOtp({ email: clean, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } })
    setBusy(false)
    if (error) { setError(friendly(error)); return }
    try { localStorage.setItem('autonomia:email', clean) } catch {}
    setEmail(clean); setCode(''); setStep('code'); setWait(RESEND_AFTER)
  }

  async function verify(token) {
    setBusy(true); setError('')
    const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' })
    setBusy(false)
    if (error) { setError(friendly(error)); setCode(''); codeRef.current?.focus() }
  }

  function onCode(e) {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 6)
    setCode(digits)
    if (digits.length === 6 && !busy) verify(digits)
  }

  return html`<main class="login">
    <section class="login-hero">
      <${SchoolLogo} class="login-school" />
      <div class="login-platform">
        <${Wordmark} large />
        <p class="lede">Inscrições nos aprofundamentos do Ensino Médio.</p>
        <p class="muted">As vagas de cada disciplina são limitadas e preenchidas por ordem de inscrição.
          O comprovante chega por e-mail, em PDF. Horários de Brasília.</p>
      </div>
    </section>

    <section class="login-card card">
      ${step === 'email' ? html`
        <form onSubmit=${sendCode}>
          <h2 class="h2">Entrar</h2>
          <p class="muted">Você recebe um código de 6 dígitos no seu e-mail institucional.</p>
          <${Field} label="E-mail institucional">
            <input type="email" autocomplete="email" inputmode="email" required autofocus
              value=${email} onInput=${(e) => setEmail(e.target.value)} placeholder="seu.email@escola" />
          <//>
          ${error && html`<p class="form-error" role="alert">${error}</p>`}
          <${Btn} busy=${busy} type="submit" class="block">Enviar código<//>
        </form>` : html`
        <form onSubmit=${(e) => { e.preventDefault(); code.length === 6 && verify(code) }}>
          <h2 class="h2">Confira seu e-mail</h2>
          <p class="muted">Enviamos um código para <b>${email}</b>. Ele vale por 10 minutos. Olhe também no spam.
            Se o e-mail trouxer um link em vez do código, é só tocar nele.</p>
          <${Field} label="Código de 6 dígitos">
            <input ref=${codeRef} class="otp" inputmode="numeric" autocomplete="one-time-code"
              pattern="[0-9]*" maxlength="6" value=${code} onInput=${onCode} aria-describedby="otp-help" />
          <//>
          ${error && html`<p class="form-error" role="alert">${error}</p>`}
          <${Btn} busy=${busy} type="submit" class="block" disabled=${code.length !== 6}>Entrar<//>
          <div class="row between small-gap" id="otp-help">
            <button type="button" class="link" onClick=${() => { setStep('email'); setError('') }}>Trocar e-mail</button>
            <button type="button" class="link" disabled=${wait > 0 || busy} onClick=${sendCode}>
              ${wait > 0 ? `Reenviar em ${wait}s` : 'Reenviar código'}
            </button>
          </div>
        </form>`}
    </section>
  </main>`
}
