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

  // Test accounts (test phase only, see test-accounts.js). On localhost the
  // password comes from the gitignored dev.js; elsewhere it is typed once and
  // remembered on that device, so it never sits in the public code.
  const [demo, setDemo] = useState(null)
  const [testKey, setTestKey] = useState('')
  const [unlocking, setUnlocking] = useState(false)
  useEffect(() => {
    (async () => {
      const { TEST_MODE, DEMO_ACCOUNTS } = await import('../test-accounts.js')
      if (!TEST_MODE) return
      let password = ''
      if (['localhost', '127.0.0.1'].includes(location.hostname)) {
        password = (await import('../dev.js').catch(() => ({}))).DEMO_PASSWORD ?? ''
      }
      if (!password) { try { password = localStorage.getItem('prumo:test-key') ?? '' } catch {} }
      setDemo({ accounts: DEMO_ACCOUNTS, password })
    })().catch(() => {})
  }, [])

  async function demoLogin(account) {
    setBusy(true); setError('')
    const { error } = await sb.auth.signInWithPassword({ email: account, password: demo.password })
    setBusy(false)
    if (!error) return
    if (/invalid login credentials/i.test(error.message)) {
      try { localStorage.removeItem('prumo:test-key') } catch {}
      setDemo({ ...demo, password: '' })
      setError('Senha de teste incorreta.')
    } else {
      setError(friendly(error))
    }
  }

  // A wrong key shows up on the first button press, which forgets it again.
  function unlock(e) {
    e.preventDefault()
    const key = testKey.trim()
    if (!key) return
    try { localStorage.setItem('prumo:test-key', key) } catch {}
    setDemo({ ...demo, password: key })
    setTestKey('')
  }

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
      </div>
    </section>

    <section class="login-card card">
      ${step === 'email' ? html`
        <form onSubmit=${sendCode}>
          <h2 class="h2">Entrar</h2>
          <p class="muted">Você recebe um código de 6 dígitos no seu e-mail institucional.</p>
          <${Field} label="E-mail institucional">
            <input type="email" autocomplete="email" inputmode="email" required autofocus
              value=${email} onInput=${(e) => setEmail(e.target.value)} placeholder="nome.sobrenome@aluno.autonomia.com.br" />
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
      ${demo && html`<div class="demo-box">
        <p class="field-label">Contas de teste</p>
        ${demo.password ? html`
          <p class="muted small">Fase de testes: entram sem e-mail.</p>
          <div class="demo-grid">
            ${demo.accounts.map((a) => html`<button type="button" class="btn ghost sm" disabled=${busy}
              onClick=${() => demoLogin(a.email)}>${a.label}</button>`)}
          </div>` : unlocking ? html`
          <form class="row" onSubmit=${unlock}>
            <input type="password" autocomplete="off" value=${testKey} onInput=${(e) => setTestKey(e.target.value)}
              placeholder="Senha de teste" aria-label="Senha de teste" />
            <button class="btn ghost" type="submit" disabled=${!testKey.trim()}>Liberar</button>
          </form>` : html`
          <button type="button" class="link small" onClick=${() => setUnlocking(true)}>Tenho uma senha de teste</button>`}
      </div>`}
    </section>
  </main>`
}
