-- Ranking rounds: a second kind of round. Instead of grabbing one limited seat,
-- a student ranks every subject within each day (Ter/Qua/Qui) from most to least
-- wanted. Registration is self-service with a school e-mail; the school allocates
-- afterward from the list, ordered by who registered first.
--
-- The existing "seats" model (apply/waitlist/drop) is untouched; a round now
-- carries a `kind` and the two worlds don't mix.

-- ---------------------------------------------------------------- shape

alter table public.rounds add column kind text not null default 'seats'
  check (kind in ('seats', 'ranking'));

-- For ranking rounds a course is one option inside a day-group. `grades` (already
-- there) decides which year sees the group. capacity is ignored for ranking.
alter table public.courses add column group_label text;      -- e.g. 'Terça-feira'
alter table public.courses add column group_order int not null default 0;

create table public.ranking_submissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default private.gen_code(),
  round_id uuid not null references public.rounds (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),  -- fixed at first submit: the arrival order
  updated_at timestamptz not null default now(),
  unique (round_id, person_id)
);
create index ranking_submissions_round_idx on public.ranking_submissions (round_id, created_at);
create index ranking_submissions_person_idx on public.ranking_submissions (person_id);

create table public.ranking_choices (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.ranking_submissions (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  group_label text not null,
  rank smallint not null check (rank >= 1),
  unique (submission_id, course_id),
  unique (submission_id, group_label, rank)
);
create index ranking_choices_submission_idx on public.ranking_choices (submission_id);

create trigger ranking_submissions_touch before update on public.ranking_submissions
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------- e-mail outbox for submissions

alter table public.email_outbox alter column enrollment_id drop not null;
alter table public.email_outbox add column submission_id uuid references public.ranking_submissions (id) on delete cascade;
alter table public.email_outbox add constraint email_outbox_target
  check (num_nonnulls(enrollment_id, submission_id) = 1);
alter table public.email_outbox drop constraint email_outbox_kind_check;
alter table public.email_outbox add constraint email_outbox_kind_check check (kind in (
  'confirmed', 'waitlisted', 'promoted', 'drop_approved', 'drop_rejected', 'removed', 'ranking'
));
create index email_outbox_submission_idx on public.email_outbox (submission_id);

create function private.enqueue_submission_email(p_kind text, p_submission uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.email_outbox (kind, submission_id) values (p_kind, p_submission)
$$;

-- mailer_claim gains submission_id (the mailer sends whichever target is set).
drop function if exists private.mailer_claim(int);
create function private.mailer_claim(p_limit int default 10)
returns table (id bigint, kind text, enrollment_id uuid, submission_id uuid, attempts int)
language sql security definer set search_path = '' as $$
  update public.email_outbox o
     set attempts = o.attempts + 1,
         locked_until = now() + make_interval(mins => 1 + o.attempts * o.attempts)
   where o.id in (
     select x.id from public.email_outbox x
      where x.sent_at is null
        and x.attempts < 6
        and (x.locked_until is null or x.locked_until < now())
      order by x.id
      limit p_limit
      for update skip locked)
  returning o.id, o.kind, o.enrollment_id, o.submission_id, o.attempts
$$;

-- ---------------------------------------------------------------- self sign-up

-- Anyone with a school e-mail may create an account (the account is empty until
-- they fill the form). Pre-loaded people (e.g. the Gmail admins) still pass.
create or replace function private.hook_before_user_created(event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(event -> 'user' ->> 'email');
  v_domain text := split_part(lower(event -> 'user' ->> 'email'), '@', 2);
  v_ok boolean;
begin
  select exists (select 1 from public.people p where p.email = v_email and p.active)
      or exists (select 1 from public.settings s
                  where v_domain = any (s.student_domains) or v_domain = any (s.staff_domains))
    into v_ok;
  if v_ok then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'not_registered'));
end $$;

-- The signed-in student creates (or fixes) their own record: student role only,
-- the domain still checked by the people trigger. Never touches an existing
-- teacher/admin.
create function public.register_self(p_full_name text, p_grade smallint, p_class_name text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := private.jwt_email();
  v_existing public.person_role;
begin
  if v_email is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if p_grade is null or p_grade not between 1 and 3 then
    raise exception 'grade_required' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_full_name, ''))) < 3 then
    raise exception 'name_required' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_class_name, ''))) < 1 then
    raise exception 'class_required' using errcode = 'P0001';
  end if;

  select role into v_existing from public.people where email = v_email;
  if found and v_existing <> 'student' then
    return;  -- a teacher/admin signed in; leave their record alone
  end if;

  insert into public.people (email, full_name, role, grade, class_name)
  values (v_email, p_full_name, 'student', p_grade, p_class_name)
  on conflict (email) do update
    set full_name = excluded.full_name, grade = excluded.grade,
        class_name = excluded.class_name, active = true;
end $$;

-- ---------------------------------------------------------------- student reads

-- The open ranking rounds a signed-in person may register for, even before they
-- have a record (so the app can offer the form). Minimal fields only.
create function public.open_ranking_rounds()
returns table (id uuid, title text, description text, opens_at timestamptz, closes_at timestamptz, is_test boolean)
language sql stable security definer set search_path = '' as $$
  select r.id, r.title, r.description, r.opens_at, r.closes_at, r.is_test
    from public.rounds r
   where r.kind = 'ranking' and r.published
     and r.closes_at > clock_timestamp()
     and (r.is_test = coalesce(private.jwt_email() like '%@teste.invalid', false))
   order by r.opens_at
$$;

-- A ranking round laid out for the caller's year: the day-groups with their
-- options, plus the caller's current submission if any.
create function public.ranking_round(p_round_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_round public.rounds;
  v_me public.people;
  v_now timestamptz := clock_timestamp();
  v_groups jsonb;
  v_mine jsonb;
begin
  select * into v_me from public.people where email = private.jwt_email() and active;
  if not found then
    raise exception 'not_registered' using errcode = 'P0001';
  end if;
  select * into v_round from public.rounds where id = p_round_id and kind = 'ranking' and published;
  if not found or (v_round.is_test <> (v_me.email like '%@teste.invalid')) then
    raise exception 'course_not_found' using errcode = 'P0001';
  end if;

  select jsonb_agg(g order by g.group_order, g.group_label) into v_groups
  from (
    select c.group_label, min(c.group_order) as group_order,
           jsonb_agg(jsonb_build_object(
             'course_id', c.id, 'title', c.title, 'area', c.area,
             'teacher_names', c.teacher_names, 'description', c.description
           ) order by c.sort_order, c.title) as options
      from public.courses c
     where c.round_id = p_round_id and v_me.grade = any (c.grades)
     group by c.group_label
  ) g;

  select jsonb_build_object(
           'submission_id', s.id, 'code', s.code, 'created_at', s.created_at,
           'choices', coalesce((select jsonb_agg(jsonb_build_object('course_id', ch.course_id, 'rank', ch.rank))
                                  from public.ranking_choices ch where ch.submission_id = s.id), '[]'::jsonb))
    into v_mine
    from public.ranking_submissions s
   where s.round_id = p_round_id and s.person_id = v_me.id;

  return jsonb_build_object(
    'round', jsonb_build_object('id', v_round.id, 'title', v_round.title, 'description', v_round.description,
                                'opens_at', v_round.opens_at, 'closes_at', v_round.closes_at,
                                'is_test', v_round.is_test, 'now', v_now),
    'grade', v_me.grade,
    'groups', coalesce(v_groups, '[]'::jsonb),
    'mine', v_mine
  );
end $$;

-- ---------------------------------------------------------------- submit

-- The full ranking: p_choices = [{course_id, rank}, ...] covering every option in
-- every day-group of the caller's year, with ranks 1..N distinct inside each day.
-- Re-submitting replaces the choices but keeps the first created_at (arrival order).
create function public.submit_ranking(p_round_id uuid, p_choices jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_round public.rounds;
  v_me public.people;
  v_now timestamptz := clock_timestamp();
  v_sub public.ranking_submissions;
  r record;
  v_bad int;
begin
  select * into v_me from public.people where email = private.jwt_email() and active for update;
  if not found or v_me.role <> 'student' then
    raise exception 'only_students' using errcode = 'P0001';
  end if;
  select * into v_round from public.rounds where id = p_round_id and kind = 'ranking' for update;
  if not found or not v_round.published then
    raise exception 'course_not_found' using errcode = 'P0001';
  end if;
  if v_round.is_test <> (v_me.email like '%@teste.invalid') then
    raise exception 'test_sandbox' using errcode = 'P0001';
  end if;
  if v_now < v_round.opens_at then raise exception 'not_open_yet' using errcode = 'P0001'; end if;
  if v_now >= v_round.closes_at then raise exception 'closed' using errcode = 'P0001'; end if;

  -- normalise input into a temp set of (course_id, rank), only real courses of this
  -- round that the caller's year can see
  drop table if exists _in;
  create temp table _in on commit drop as
  select (e ->> 'course_id')::uuid as course_id, (e ->> 'rank')::smallint as rank
    from jsonb_array_elements(coalesce(p_choices, '[]'::jsonb)) e;

  if exists (select 1 from _in where course_id is null or rank is null or rank < 1) then
    raise exception 'incomplete_ranking' using errcode = 'P0001';
  end if;
  -- every chosen course must belong to this round and the caller's year
  if exists (
    select 1 from _in i
     left join public.courses c on c.id = i.course_id and c.round_id = p_round_id and v_me.grade = any (c.grades)
     where c.id is null) then
    raise exception 'incomplete_ranking' using errcode = 'P0001';
  end if;

  -- must cover every eligible course exactly once, and ranks must be 1..N per group
  select count(*) into v_bad from (
    select c.group_label,
           count(*) as options,
           count(i.course_id) as picked,
           count(distinct i.rank) as distinct_ranks,
           max(i.rank) as max_rank
      from public.courses c
      left join _in i on i.course_id = c.id
     where c.round_id = p_round_id and v_me.grade = any (c.grades)
     group by c.group_label
  ) t
  where t.options <> t.picked or t.distinct_ranks <> t.options or t.max_rank <> t.options;
  if v_bad > 0 then
    raise exception 'incomplete_ranking' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.courses c where c.round_id = p_round_id and v_me.grade = any (c.grades)) then
    raise exception 'grade_not_eligible' using errcode = 'P0001';
  end if;

  insert into public.ranking_submissions (round_id, person_id, created_at)
  values (p_round_id, v_me.id, v_now)
  on conflict (round_id, person_id) do update set updated_at = now()
  returning * into v_sub;

  delete from public.ranking_choices where submission_id = v_sub.id;
  insert into public.ranking_choices (submission_id, course_id, group_label, rank)
  select v_sub.id, i.course_id, c.group_label, i.rank
    from _in i join public.courses c on c.id = i.course_id;

  perform private.enqueue_submission_email('ranking', v_sub.id);
  drop table _in;

  return jsonb_build_object('submission_id', v_sub.id, 'code', v_sub.code, 'created_at', v_sub.created_at);
end $$;

create function public.my_ranking(p_round_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('submission_id', s.id, 'code', s.code, 'created_at', s.created_at,
           'choices', coalesce((select jsonb_agg(jsonb_build_object('course_id', ch.course_id, 'rank', ch.rank, 'group_label', ch.group_label))
                                  from public.ranking_choices ch where ch.submission_id = s.id), '[]'::jsonb))
    from public.ranking_submissions s
   where s.round_id = p_round_id and s.person_id = private.current_person_id()
$$;

-- ---------------------------------------------------------------- staff list

-- The ordered list of registrants with every ranked choice, newest-arrival last.
create function public.ranking_list(p_round_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_staff() then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if private.is_test_account() and not private.round_is_test(p_round_id) then
    raise exception 'test_sandbox' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(row order by row.created_at, row.submission_id)
    from (
      select s.id as submission_id, s.code, s.created_at,
             p.full_name, p.email, p.grade, p.class_name,
             (select jsonb_agg(jsonb_build_object('group_label', ch.group_label, 'rank', ch.rank, 'title', c.title)
                       order by ch.group_label, ch.rank)
                from public.ranking_choices ch join public.courses c on c.id = ch.course_id
               where ch.submission_id = s.id) as choices
        from public.ranking_submissions s
        join public.people p on p.id = s.person_id
       where s.round_id = p_round_id
    ) row
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- verify_slip (now covers both)

create or replace function public.verify_slip(p_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with code as (select upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g')) as c)
  select jsonb_build_object(
    'type', 'seat', 'status', e.status, 'full_name', p.full_name, 'class_name', p.class_name,
    'course', c.title, 'schedule', c.schedule, 'round', r.title,
    'applied_at', e.applied_at, 'confirmed_at', e.confirmed_at, 'is_test', r.is_test, 'school', s.school_name)
  from public.enrollments e
  join public.people p on p.id = e.person_id
  join public.courses c on c.id = e.course_id
  join public.rounds r on r.id = e.round_id
  cross join public.settings s, code
  where e.code = code.c
  union all
  select jsonb_build_object(
    'type', 'ranking', 'status', 'submitted', 'full_name', p.full_name, 'class_name', p.class_name,
    'round', r.title, 'applied_at', sub.created_at, 'is_test', r.is_test, 'school', s.school_name,
    'choices', (select jsonb_agg(jsonb_build_object('group_label', ch.group_label, 'rank', ch.rank, 'title', co.title)
                         order by ch.group_label, ch.rank)
                  from public.ranking_choices ch join public.courses co on co.id = ch.course_id
                 where ch.submission_id = sub.id))
  from public.ranking_submissions sub
  join public.people p on p.id = sub.person_id
  join public.rounds r on r.id = sub.round_id
  cross join public.settings s, code
  where sub.code = code.c
  limit 1
$$;

-- ---------------------------------------------------------------- row level security

alter table public.ranking_submissions enable row level security;
alter table public.ranking_choices enable row level security;

create policy ranking_sub_read on public.ranking_submissions for select to authenticated
  using (person_id = (select private.current_person_id()) or (select private.is_staff()));
create policy ranking_choices_read on public.ranking_choices for select to authenticated
  using (exists (select 1 from public.ranking_submissions s
                  where s.id = submission_id
                    and (s.person_id = (select private.current_person_id()) or (select private.is_staff()))));

grant select on public.ranking_submissions, public.ranking_choices to authenticated;
-- writes go through the RPCs only
revoke insert, update, delete on public.ranking_submissions, public.ranking_choices from authenticated;

grant execute on function public.register_self(text, smallint, text),
                          public.open_ranking_rounds(),
                          public.ranking_round(uuid),
                          public.submit_ranking(uuid, jsonb),
                          public.my_ranking(uuid),
                          public.ranking_list(uuid)
  to authenticated;

alter publication supabase_realtime add table public.ranking_submissions;
