import { sb } from './db.js'
import { SUPABASE_KEY, SUPABASE_URL } from '../config.js'

async function fetchSlip(body) {
  const { data } = await sb.auth.getSession()
  const res = await fetch(`${SUPABASE_URL}/functions/v1/slip`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${data.session?.access_token}`,
      apikey: SUPABASE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    throw new Error(j.error || `HTTP ${res.status}`)
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'comprovante.pdf'
  return { blob: await res.blob(), name }
}

export async function downloadSlip(enrollmentId) {
  const { blob, name } = await fetchSlip({ enrollment_id: enrollmentId })
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

// Opens the tab during the click so pop-up blockers allow it, then fills it.
export async function previewSlip() {
  const tab = window.open('', '_blank')
  try {
    const { blob } = await fetchSlip({ preview: true })
    const url = URL.createObjectURL(blob)
    if (tab) tab.location = url
    else window.location.href = url
  } catch (e) {
    tab?.close()
    throw e
  }
}
