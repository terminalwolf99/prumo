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

export type RankingDay = { label: string; options: { title: string; rank: number }[] }

export type SubmissionData = {
  submission_id: string
  code: string
  created_at: string
  full_name: string
  email: string
  class_name: string | null
  grade: number | null
  round_title: string
  is_test: boolean
  school_name: string
  days: RankingDay[]
}

export async function loadSubmission(id: string): Promise<SubmissionData | null> {
  const rows = await sql<SubmissionData[]>`
    select sub.id as submission_id, sub.code, sub.created_at,
           p.full_name, p.email, p.class_name, p.grade,
           r.title as round_title, r.is_test, st.school_name,
           coalesce((
             select jsonb_agg(day order by day.ord)
               from (
                 select ch.group_label as label, min(c.group_order) as ord,
                        jsonb_agg(jsonb_build_object('title', c.title, 'rank', ch.rank) order by ch.rank) as options
                   from public.ranking_choices ch
                   join public.courses c on c.id = ch.course_id
                  where ch.submission_id = sub.id
                  group by ch.group_label
               ) day
           ), '[]'::jsonb) as days
      from public.ranking_submissions sub
      join public.people p on p.id = sub.person_id
      join public.rounds r on r.id = sub.round_id
      cross join public.settings st
     where sub.id = ${id}`
  return rows[0] ?? null
}
