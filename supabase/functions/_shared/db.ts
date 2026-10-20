import postgres from 'npm:postgres@3.4.7'

// Direct connection as the database owner; only server code ever uses this.
export const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { max: 3, prepare: false })

export type SlipData = {
  enrollment_id: string
  code: string
  status: string
  applied_at: string
  confirmed_at: string | null
  end_note: string | null
  waitlist_position: number | null
  full_name: string
  email: string
  class_name: string | null
  grade: number | null
  course_title: string
  course_area: string | null
  schedule: string | null
  location: string | null
  teacher_names: string | null
  round_title: string
  is_test: boolean
  school_name: string
  slip_layout: Record<string, unknown>
}

export async function loadEnrollment(id: string): Promise<SlipData | null> {
  const rows = await sql<SlipData[]>`
    select e.id as enrollment_id, e.code, e.status::text, e.applied_at, e.confirmed_at, e.end_note,
           case when e.status = 'waitlisted' then private.waitlist_position(e.id) end as waitlist_position,
           p.full_name, p.email, p.class_name, p.grade,
           c.title as course_title, c.area as course_area, c.schedule, c.location, c.teacher_names,
           r.title as round_title, r.is_test,
           s.school_name, s.slip_layout
      from public.enrollments e
      join public.people p on p.id = e.person_id
      join public.courses c on c.id = e.course_id
      join public.rounds r on r.id = e.round_id
      cross join public.settings s
     where e.id = ${id}`
  return rows[0] ?? null
}

export async function loadTemplate(): Promise<Uint8Array | null> {
  const rows = await sql<{ pdf: Uint8Array }[]>`select pdf from private.slip_template limit 1`
  return rows[0]?.pdf ?? null
}
