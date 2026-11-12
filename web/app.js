import { html, render, useCallback, useEffect, useState } from './lib/deps.js'
import { rpc, sb } from './lib/db.js'
import { syncClock } from './lib/time.js'
import { Asker, Toasts, Wordmark } from './lib/ui.js'
import { Login } from './views/login.js'
import { Staff } from './views/staff/index.js'
import { Verify } from './views/verify.js'
import { SelfRegister, StudentHome } from './views/ranking.js'

// #/verificar/<code> is public: it works with or without a login.
function useVerifyRoute() {
  const read = () => /^#\/verificar\/?([^/?]*)/.exec(location.hash)
  const [m, setM] = useState(read)
  useEffect(() => {
    const on = () => setM(read())
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return m ? decodeURIComponent(m[1] ?? '') : null
}

function App() {
  const [session, setSession] = useState(undefined)
  const [me, setMe] = useState(undefined)
  const verifyCode = useVerifyRoute()

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = sb.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const email = session?.user?.email?.toLowerCase()
  const loadMe = useCallback(async () => {
    if (!email) { setMe(undefined); return }
    const { data } = await sb.from('people').select('*').eq('email', email).maybeSingle()
    setMe(data?.active ? data : null)
  }, [email])
  useEffect(() => {
    if (!email) { setMe(undefined); return }
    setMe(undefined)
    syncClock(() => rpc('server_time')).catch(() => {})
    loadMe()
  }, [email, loadMe])

  let page
  if (verifyCode !== null) {
    page = html`<${Verify} initial=${verifyCode} />`
  } else if (session === undefined || (session && me === undefined)) {
    page = html`<div class="boot"><${Wordmark} /></div>`
  } else if (!session) {
    page = html`<${Login} />`
  } else if (!me) {
    page = html`<${SelfRegister} email=${email} reloadMe=${loadMe} />`
  } else if (me.role === 'student') {
    page = html`<${StudentHome} me=${me} reloadMe=${loadMe} />`
  } else {
    page = html`<${Staff} me=${me} />`
  }
  return html`${page}<${Toasts} /><${Asker} />`
}

render(html`<${App} />`, document.getElementById('app'))
