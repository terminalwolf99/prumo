export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'content-disposition',
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

// Compares secrets without leaking how many leading characters matched.
export async function sameSecret(a: string | null, b: string | undefined) {
  if (!a || !b) return false
  const enc = new TextEncoder()
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ])
  const x = new Uint8Array(ha)
  const y = new Uint8Array(hb)
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

export function publishableKey(req: Request) {
  const fromClient = req.headers.get('apikey')
  if (fromClient) return fromClient
  try {
    return JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}').default ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  } catch {
    return Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  }
}

// Asks Supabase Auth who owns this access token (verifies it in the process).
export async function verifiedEmail(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: publishableKey(req) },
  })
  if (!res.ok) return null
  const user = await res.json()
  return typeof user?.email === 'string' ? user.email.toLowerCase() : null
}
