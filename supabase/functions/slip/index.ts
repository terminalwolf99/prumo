// Download a confirmation slip from the app. Students get their own; staff
// get anyone's, plus a preview with sample data for designing the template.
import { loadEnrollment, loadTemplate, type SlipData, sql } from '../_shared/db.ts'
import { cors, json, verifiedEmail } from '../_shared/http.ts'
import { renderSlip, slipFilename } from '../_shared/slip.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)

  const email = await verifiedEmail(req)
  if (!email) return json({ error: 'unauthorized' }, 401)
  const [me] = await sql<{ id: string; role: string }[]>`
    select id, role::text from public.people where email = ${email} and active`
  if (!me) return json({ error: 'not_registered' }, 403)
  const staff = me.role === 'teacher' || me.role === 'admin'

  const body = await req.json().catch(() => ({}))
  let data: SlipData | null

  if (body.preview) {
    if (!staff) return json({ error: 'forbidden' }, 403)
    const [s] = await sql<{ school_name: string; slip_layout: Record<string, unknown> }[]>`
      select school_name, slip_layout from public.settings`
    const now = new Date().toISOString()
    data = {
      enrollment_id: 'preview', code: 'AB12CD34', status: 'confirmed', applied_at: now, confirmed_at: now,
      end_note: null, waitlist_position: null, full_name: 'Maria Eduarda Albuquerque dos Santos',
      email: '', class_name: '2º B', grade: 2, course_title: 'Astronomia e Física Moderna',
      course_area: 'Ciências da Natureza', schedule: 'Terças, 13h30–15h10', location: 'Laboratório 2',
      teacher_names: 'Prof. Exemplo', round_title: 'Inscrições de exemplo',
      school_name: s.school_name, slip_layout: s.slip_layout,
    }
  } else {
    if (typeof body.enrollment_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.enrollment_id)) {
      return json({ error: 'enrollment_id' }, 400)
    }
    const [own] = await sql<{ person_id: string }[]>`
      select person_id from public.enrollments where id = ${body.enrollment_id}::uuid`
    if (!own || (!staff && own.person_id !== me.id)) return json({ error: 'not_found' }, 404)
    data = await loadEnrollment(body.enrollment_id)
    if (!data) return json({ error: 'not_found' }, 404)
    if (!['confirmed', 'drop_requested'].includes(data.status)) return json({ error: 'no_seat' }, 409)
  }

  const pdf = await renderSlip(data, await loadTemplate())
  return new Response(pdf, {
    headers: {
      ...cors,
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${slipFilename(data)}"`,
      'Cache-Control': 'no-store',
    },
  })
})
