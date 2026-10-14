import { html, render, useEffect, useState } from './lib/deps.js'
import { rpc, sb } from './lib/db.js'
import { syncClock } from './lib/time.js'
import { Asker, Toasts, Wordmark } from './lib/ui.js'
import { Login } from './views/login.js'
import { Student } from './views/student.js'
import { Staff } from './views/staff/index.js'

function NotAllowed({ email }) {
  return html`<main class="center-page">
    <div class="card narrow">
      <${Wordmark} />
      <h1 class="h2">Acesso não liberado</h1>
      <p><b>${email}</b> não está (ou não está mais) na lista do Projeto Autonomia.</p>
      <p class="muted">Se isso for um engano, fale com a coordenação.</p>
      <button class="btn primary" onClick=${() => sb.auth.signOut()}>Entrar com outro e-mail</button>
    </div>
  </main>`
}

function App() {
  const [session, setSession] = useState(undefined)
  const [me, setMe] = useState(undefined)

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = sb.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const email = session?.user?.email?.toLowerCase()
  useEffect(() => {
    if (!email) { setMe(undefined); return }
    setMe(undefined)
    syncClock(() => rpc('server_time')).catch(() => {})
    sb.from('people').select('*').eq('email', email).maybeSingle()
      .then(({ data }) => setMe(data?.active ? data : null))
  }, [email])

  let page
  if (session === undefined || (session && me === undefined)) {
    page = html`<div class="boot"><${Wordmark} /></div>`
  } else if (!session) {
    page = html`<${Login} />`
  } else if (!me) {
    page = html`<${NotAllowed} email=${email} />`
  } else if (me.role === 'student') {
    page = html`<${Student} me=${me} />`
  } else {
    page = html`<${Staff} me=${me} />`
  }
  return html`${page}<${Toasts} /><${Asker} />`
}

render(html`<${App} />`, document.getElementById('app'))
