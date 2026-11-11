// Download a confirmation slip from the app. Students get their own; staff
// get anyone's, plus a preview with sample data for designing the template.
import { loadEnrollment, loadSubmission, loadTemplate, type SlipData, type SubmissionData, sql } from '../_shared/db.ts'
import { cors, json, verifiedEmail } from '../_shared/http.ts'
import { rankingFilename, renderRankingSlip, renderSlip, slipFilename } from '../_shared/slip.ts'

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
  const APP = Deno.env.get('APP_URL') ?? 'https://terminalwolf99.github.io/prumo/'

  // ---- ranking receipts (a different document) ----
  if (body.preview_ranking) {
    if (!staff) return json({ error: 'forbidden' }, 403)
    const [s] = await sql<{ school_name: string }[]>`select school_name from public.settings`
    const sample: SubmissionData = {
      submission_id: 'preview', code: 'AB12CD34', created_at: new Date().toISOString(),
      full_name: 'Maria Eduarda Albuquerque dos Santos', email: '', class_name: '1º A', grade: 1,
      round_title: 'Inscrições de exemplo', is_test: false, school_name: s.school_name,
      days: [
        { label: 'Terça-feira', options: [{ title: 'Geografia', rank: 1 }, { title: 'Literatura', rank: 2 }, { title: 'História', rank: 3 }] },
        { label: 'Quarta-feira', options: [{ title: 'Artes', rank: 1 }, { title: 'Inglês', rank: 2 }, { title: 'Física', rank: 3 }] },
        { label: 'Quinta-feira', options: [{ title: 'Biologia', rank: 1 }, { title: 'Matemática', rank: 2 }, { title: 'Química', rank: 3 }] },
      ],
    }
    const pdf = await renderRankingSlip(sample, APP)
    return new Response(pdf, { headers: { ...cors, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${rankingFilename(sample)}"`, 'Cache-Control': 'no-store' } })
  }
  if (typeof body.submission_id === 'string') {
    if (!/^[0-9a-f-]{36}$/i.test(body.submission_id)) return json({ error: 'submission_id' }, 400)
    const [own] = await sql<{ person_id: string }[]>`select person_id from public.ranking_submissions where id = ${body.submission_id}::uuid`
    if (!own || (!staff && own.person_id !== me.id)) return json({ error: 'not_found' }, 404)
    const d = await loadSubmission(body.submission_id)
    if (!d) return json({ error: 'not_found' }, 404)
    const pdf = await renderRankingSlip(d, APP)
    return new Response(pdf, { headers: { ...cors, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${rankingFilename(d)}"`, 'Cache-Control': 'no-store' } })
  }

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
      teacher_names: 'Prof. Exemplo', round_title: 'Inscrições de exemplo', is_test: false,
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

  const pdf = await renderSlip(data, await loadTemplate(), Deno.env.get('APP_URL') ?? 'https://terminalwolf99.github.io/prumo/')
  return new Response(pdf, {
    headers: {
      ...cors,
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${slipFilename(data)}"`,
      'Cache-Control': 'no-store',
    },
  })
})
