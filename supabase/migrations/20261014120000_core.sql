-- Projeto Autonomia: core schema.
-- Limited spots, first-come-first-served (ordem de chegada), waitlist with
-- automatic promotion, drop requests approved by teachers, e-mail outbox.
-- All times are timestamptz; the database displays them in Brasília time.

alter database postgres set timezone to 'America/Sao_Paulo';

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------- types

create type public.person_role as enum ('student', 'teacher', 'admin');

-- confirmed       holds a seat
-- waitlisted      in line for a seat
-- drop_requested  holds a seat, asked to leave; a teacher must approve
-- dropped         left with a teacher's approval
-- removed         taken out by a teacher
-- left_waitlist   left the waitlist on their own
create type public.enrollment_status as enum (
  'confirmed', 'waitlisted', 'drop_requested', 'dropped', 'removed', 'left_waitlist'
);

-- ---------------------------------------------------------------- tables

create table public.settings (
  id boolean primary key default true check (id),
  school_name text not null default 'Projeto Autonomia',
  -- institutional domains, e.g. {escola.sc.gov.br}; empty = not enforced yet
  allowed_domains text[] not null default '{}',
  -- where each field is stamped on the slip template (see functions/_shared/slip.ts)
  slip_layout jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
insert into public.settings default values;

create table public.people (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  full_name text not null check (length(full_name) >= 2),
  role public.person_role not null default 'student',
  grade smallint check (grade between 1 and 3),        -- ano do Ensino Médio
  class_name text,                                     -- turma, e.g. "2º B"
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  description text,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  max_choices smallint not null default 1 check (max_choices >= 1),
  block_same_slot boolean not null default true,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (closes_at > opens_at)
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds (id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  area text,
  description text,
  teacher_names text,
  schedule text,                  -- shown to students, e.g. "Terças, 13h30–15h10"
  slot text,                      -- conflict key; two courses with the same slot can't both be taken
  location text,
  capacity int not null check (capacity >= 0),
  grades smallint[] not null default '{1,2,3}',
  confirmed_count int not null default 0,   -- maintained by trigger
  waitlist_count int not null default 0,    -- maintained by trigger
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index courses_round_idx on public.courses (round_id, sort_order);

create function private.gen_code() returns text
language sql volatile set search_path = '' as $$
  -- 8 chars from an alphabet without look-alikes (no 0/O, 1/I/L)
  select string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 1 + (get_byte(b, i) % 31), 1), '')
  from extensions.gen_random_bytes(8) b, generate_series(0, 7) i
$$;

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default private.gen_code(),
  course_id uuid not null references public.courses (id) on delete cascade,
  round_id uuid not null references public.rounds (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete restrict,  -- deactivate instead
  status public.enrollment_status not null,
  applied_at timestamptz not null default clock_timestamp(),
  confirmed_at timestamptz,
  drop_reason text,
  drop_requested_at timestamptz,
  ended_at timestamptz,
  ended_by uuid references public.people (id) on delete set null,
  end_note text,
  updated_at timestamptz not null default now()
);
create unique index enrollments_one_active
  on public.enrollments (course_id, person_id)
  where status in ('confirmed', 'waitlisted', 'drop_requested');
create index enrollments_course_idx on public.enrollments (course_id, status, applied_at);
create index enrollments_person_idx on public.enrollments (person_id, round_id);

create table public.email_outbox (
  id bigint generated always as identity primary key,
  kind text not null check (kind in (
    'confirmed', 'waitlisted', 'promoted', 'drop_approved', 'drop_rejected', 'removed'
  )),
  enrollment_id uuid not null references public.enrollments (id) on delete cascade,
  created_at timestamptz not null default now(),
  attempts int not null default 0,
  locked_until timestamptz,
  last_error text,
  sent_at timestamptz
);
create index email_outbox_pending_idx on public.email_outbox (id) where sent_at is null;
create index email_outbox_enrollment_idx on public.email_outbox (enrollment_id);

-- ---------------------------------------------------------------- who is calling

create function private.jwt_email() returns text
language sql stable set search_path = '' as $$
  select lower(nullif(auth.jwt() ->> 'email', ''))
$$;

create function private.current_person_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.people p where p.email = private.jwt_email() and p.active
$$;

create function private.my_role() returns public.person_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.people p where p.email = private.jwt_email() and p.active
$$;

create function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_role() in ('teacher', 'admin'), false)
$$;

create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_role() = 'admin', false)
$$;

-- ---------------------------------------------------------------- triggers

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger settings_touch before update on public.settings
  for each row execute function private.touch_updated_at();
create trigger rounds_touch before update on public.rounds
  for each row execute function private.touch_updated_at();
create trigger enrollments_touch before update on public.enrollments
  for each row execute function private.touch_updated_at();

-- Normalise people and enforce the institutional domain (admins are exempt).
create function private.people_validate() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_domains text[];
begin
  new.email := lower(trim(new.email));
  new.full_name := regexp_replace(trim(new.full_name), '\s+', ' ', 'g');
  new.class_name := nullif(trim(new.class_name), '');
  if new.role <> 'student' then
    new.grade := null;
  end if;
  select s.allowed_domains into v_domains from public.settings s;
  if new.role <> 'admin'
     and cardinality(v_domains) > 0
     and not (split_part(new.email, '@', 2) = any (v_domains)) then
    raise exception 'domain_not_allowed' using errcode = 'P0001', detail = new.email;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger people_validate before insert or update on public.people
  for each row execute function private.people_validate();

-- Seat counters always come from the enrollments table, whatever a client sends.
create function private.courses_counts() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.confirmed_count := 0;
    new.waitlist_count := 0;
    return new;
  end if;
  if new.round_id <> old.round_id
     and exists (select 1 from public.enrollments e where e.course_id = new.id) then
    raise exception 'course_has_enrollments' using errcode = 'P0001';
  end if;
  select count(*) filter (where e.status in ('confirmed', 'drop_requested')),
         count(*) filter (where e.status = 'waitlisted')
    into new.confirmed_count, new.waitlist_count
    from public.enrollments e
   where e.course_id = new.id;
  new.updated_at := now();
  return new;
end $$;

create trigger courses_counts before insert or update on public.courses
  for each row execute function private.courses_counts();

-- Any change to an enrollment re-counts its course (and pushes a realtime update).
create function private.enrollments_touch_course() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.courses set updated_at = now() where id = coalesce(new.course_id, old.course_id);
  return null;
end $$;

create trigger enrollments_touch_course after insert or update or delete on public.enrollments
  for each row execute function private.enrollments_touch_course();

-- ---------------------------------------------------------------- e-mail outbox

create function private.enqueue_email(p_kind text, p_enrollment uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.email_outbox (kind, enrollment_id) values (p_kind, p_enrollment)
$$;

-- Wake the mailer Edge Function. pg_net only sends after the transaction commits,
-- so a rolled-back enrollment never e-mails anyone.
create function private.kick_mailer() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'mailer_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'mailer_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-mailer-secret', v_secret),
    timeout_milliseconds := 10000
  );
end $$;

create function private.outbox_kick() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.kick_mailer();
  return null;
end $$;

create trigger email_outbox_kick after insert on public.email_outbox
  for each statement execute function private.outbox_kick();

-- Claimed by the mailer; each attempt backs off a little longer.
create function private.mailer_claim(p_limit int default 10)
returns table (id bigint, kind text, enrollment_id uuid, attempts int)
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
  returning o.id, o.kind, o.enrollment_id, o.attempts
$$;

-- ---------------------------------------------------------------- waitlist

-- Fill free seats from the waitlist, in arrival order.
create function private.promote(p_course uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_capacity int;
  v_held int;
  v_promoted int := 0;
  r record;
begin
  select c.capacity into v_capacity from public.courses c where c.id = p_course for update;
  if not found then
    return 0;
  end if;
  select count(*) into v_held
    from public.enrollments e
   where e.course_id = p_course and e.status in ('confirmed', 'drop_requested');
  for r in
    select e.id from public.enrollments e
     where e.course_id = p_course and e.status = 'waitlisted'
     order by e.applied_at, e.id
     limit greatest(v_capacity - v_held, 0)
  loop
    update public.enrollments
       set status = 'confirmed', confirmed_at = clock_timestamp()
     where id = r.id;
    perform private.enqueue_email('promoted', r.id);
    v_promoted := v_promoted + 1;
  end loop;
  return v_promoted;
end $$;

create function private.courses_capacity_up() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.capacity > old.capacity then
    perform private.promote(new.id);
  end if;
  return null;
end $$;

create trigger courses_capacity_up after update of capacity on public.courses
  for each row execute function private.courses_capacity_up();

create function private.waitlist_position(p_enrollment uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int + 1
    from public.enrollments me
    join public.enrollments o
      on o.course_id = me.course_id
     and o.status = 'waitlisted'
     and (o.applied_at, o.id) < (me.applied_at, me.id)
   where me.id = p_enrollment
$$;

-- ---------------------------------------------------------------- student RPCs

create function public.server_time() returns timestamptz
language sql volatile set search_path = '' as $$
  select clock_timestamp()
$$;

-- The race. Locks the student first (so their own parallel clicks queue up),
-- then the course row: concurrent applicants are served strictly one at a time,
-- and applied_at is taken only after the lock, so it matches the real order.
create function public.apply(p_course_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me public.people;
  v_course public.courses;
  v_round public.rounds;
  v_now timestamptz;
  v_active int;
  v_held int;
  v_status public.enrollment_status;
  v_enr public.enrollments;
begin
  select * into v_me from public.people p
   where p.email = private.jwt_email() and p.active
   for update;
  if not found then
    raise exception 'not_registered' using errcode = 'P0001';
  end if;
  if v_me.role <> 'student' then
    raise exception 'only_students' using errcode = 'P0001';
  end if;

  select * into v_course from public.courses c where c.id = p_course_id for update;
  if not found then
    raise exception 'course_not_found' using errcode = 'P0001';
  end if;
  select * into v_round from public.rounds r where r.id = v_course.round_id;

  v_now := clock_timestamp();
  if not v_round.published then
    raise exception 'course_not_found' using errcode = 'P0001';
  end if;
  if v_now < v_round.opens_at then
    raise exception 'not_open_yet' using errcode = 'P0001';
  end if;
  if v_now >= v_round.closes_at then
    raise exception 'closed' using errcode = 'P0001';
  end if;
  if cardinality(v_course.grades) < 3
     and (v_me.grade is null or not (v_me.grade = any (v_course.grades))) then
    raise exception 'grade_not_eligible' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.enrollments e
              where e.course_id = v_course.id and e.person_id = v_me.id
                and e.status in ('confirmed', 'waitlisted', 'drop_requested')) then
    raise exception 'already_applied' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.enrollments e
              where e.course_id = v_course.id and e.person_id = v_me.id
                and e.status = 'removed') then
    raise exception 'removed_by_staff' using errcode = 'P0001';
  end if;

  select count(*) into v_active from public.enrollments e
   where e.person_id = v_me.id and e.round_id = v_round.id
     and e.status in ('confirmed', 'waitlisted', 'drop_requested');
  if v_active >= v_round.max_choices then
    raise exception 'limit_reached' using errcode = 'P0001';
  end if;

  if v_round.block_same_slot and v_course.slot is not null and exists (
       select 1 from public.enrollments e
         join public.courses c on c.id = e.course_id
        where e.person_id = v_me.id and e.round_id = v_round.id
          and e.status in ('confirmed', 'waitlisted', 'drop_requested')
          and c.slot = v_course.slot) then
    raise exception 'slot_conflict' using errcode = 'P0001';
  end if;

  select count(*) into v_held from public.enrollments e
   where e.course_id = v_course.id and e.status in ('confirmed', 'drop_requested');
  v_status := case when v_held < v_course.capacity then 'confirmed' else 'waitlisted' end;

  insert into public.enrollments (course_id, round_id, person_id, status, applied_at, confirmed_at)
  values (v_course.id, v_round.id, v_me.id, v_status, v_now,
          case when v_status = 'confirmed' then v_now end)
  returning * into v_enr;

  perform private.enqueue_email(v_status::text, v_enr.id);

  return jsonb_build_object(
    'enrollment_id', v_enr.id,
    'code', v_enr.code,
    'status', v_enr.status,
    'applied_at', v_enr.applied_at,
    'position', case when v_status = 'waitlisted' then private.waitlist_position(v_enr.id) end
  );
end $$;

create function public.my_enrollments()
returns table (
  enrollment_id uuid, code text, status public.enrollment_status,
  applied_at timestamptz, confirmed_at timestamptz, drop_reason text, end_note text,
  waitlist_position int,
  course_id uuid, course_title text, course_area text, course_schedule text, teacher_names text,
  round_id uuid, round_title text
)
language sql stable security definer set search_path = '' as $$
  select e.id, e.code, e.status, e.applied_at, e.confirmed_at, e.drop_reason, e.end_note,
         case when e.status = 'waitlisted' then private.waitlist_position(e.id) end,
         c.id, c.title, c.area, c.schedule, c.teacher_names,
         r.id, r.title
    from public.enrollments e
    join public.courses c on c.id = e.course_id
    join public.rounds r on r.id = e.round_id
   where e.person_id = private.current_person_id()
   order by e.applied_at
$$;

create function private.own_enrollment_for_update(p_enrollment uuid) returns public.enrollments
language plpgsql security definer set search_path = '' as $$
declare
  v_enr public.enrollments;
begin
  select e.* into v_enr from public.enrollments e
   where e.id = p_enrollment and e.person_id = private.current_person_id();
  if not found then
    raise exception 'enrollment_not_found' using errcode = 'P0001';
  end if;
  -- lock the course first, same order as apply(), then the enrollment
  perform 1 from public.courses c where c.id = v_enr.course_id for update;
  select e.* into v_enr from public.enrollments e where e.id = p_enrollment for update;
  return v_enr;
end $$;

create function public.request_drop(p_enrollment_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_enr public.enrollments := private.own_enrollment_for_update(p_enrollment_id);
begin
  if v_enr.status <> 'confirmed' then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  update public.enrollments
     set status = 'drop_requested', drop_reason = trim(p_reason), drop_requested_at = clock_timestamp()
   where id = v_enr.id;
end $$;

create function public.cancel_drop_request(p_enrollment_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_enr public.enrollments := private.own_enrollment_for_update(p_enrollment_id);
begin
  if v_enr.status <> 'drop_requested' then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;
  update public.enrollments
     set status = 'confirmed', drop_reason = null, drop_requested_at = null
   where id = v_enr.id;
end $$;

-- Leaving the waitlist takes no seat from anyone, so it needs no approval.
create function public.leave_waitlist(p_enrollment_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_enr public.enrollments := private.own_enrollment_for_update(p_enrollment_id);
begin
  if v_enr.status <> 'waitlisted' then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;
  update public.enrollments
     set status = 'left_waitlist', ended_at = clock_timestamp(), ended_by = v_enr.person_id
   where id = v_enr.id;
end $$;

-- ---------------------------------------------------------------- staff RPCs

create function private.staff_enrollment_for_update(p_enrollment uuid) returns public.enrollments
language plpgsql security definer set search_path = '' as $$
declare
  v_enr public.enrollments;
begin
  if not private.is_staff() then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  select e.* into v_enr from public.enrollments e where e.id = p_enrollment;
  if not found then
    raise exception 'enrollment_not_found' using errcode = 'P0001';
  end if;
  perform 1 from public.courses c where c.id = v_enr.course_id for update;
  select e.* into v_enr from public.enrollments e where e.id = p_enrollment for update;
  return v_enr;
end $$;

create function public.resolve_drop(p_enrollment_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_enr public.enrollments := private.staff_enrollment_for_update(p_enrollment_id);
begin
  if v_enr.status <> 'drop_requested' then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;
  if p_approve then
    update public.enrollments
       set status = 'dropped', ended_at = clock_timestamp(),
           ended_by = private.current_person_id(), end_note = nullif(trim(p_note), '')
     where id = v_enr.id;
    perform private.enqueue_email('drop_approved', v_enr.id);
    perform private.promote(v_enr.course_id);
  else
    update public.enrollments
       set status = 'confirmed', end_note = nullif(trim(p_note), '')
     where id = v_enr.id;
    perform private.enqueue_email('drop_rejected', v_enr.id);
  end if;
end $$;

create function public.remove_enrollment(p_enrollment_id uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_enr public.enrollments := private.staff_enrollment_for_update(p_enrollment_id);
begin
  if v_enr.status not in ('confirmed', 'waitlisted', 'drop_requested') then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;
  update public.enrollments
     set status = 'removed', ended_at = clock_timestamp(),
         ended_by = private.current_person_id(), end_note = nullif(trim(p_note), '')
   where id = v_enr.id;
  perform private.enqueue_email('removed', v_enr.id);
  if v_enr.status in ('confirmed', 'drop_requested') then
    perform private.promote(v_enr.course_id);
  end if;
end $$;

create function public.resend_slip(p_enrollment_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_enr public.enrollments := private.staff_enrollment_for_update(p_enrollment_id);
begin
  if v_enr.status not in ('confirmed', 'drop_requested') then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;
  perform private.enqueue_email('confirmed', v_enr.id);
end $$;

-- Bulk add from a pasted spreadsheet. Each row is checked on its own and the
-- result lists what happened, so one bad line doesn't sink the whole paste.
-- rows: [{email, full_name, grade, class_name}]
create function public.import_people(p_rows jsonb, p_role public.person_role default 'student')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb;
  v_i int := 0;
  v_added int := 0;
  v_updated int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_existing public.person_role;
  v_email text;
begin
  if not private.is_staff() then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if p_role <> 'student' and not private.is_admin() then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    v_email := lower(trim(v_row ->> 'email'));
    begin
      select p.role into v_existing from public.people p where p.email = v_email;
      if found and v_existing <> 'student' and not private.is_admin() then
        raise exception 'forbidden' using errcode = 'P0001';
      end if;
      insert into public.people (email, full_name, role, grade, class_name)
      values (v_email, v_row ->> 'full_name', p_role,
              nullif(v_row ->> 'grade', '')::smallint, v_row ->> 'class_name')
      on conflict (email) do update
        set full_name = excluded.full_name,
            role = excluded.role,
            grade = excluded.grade,
            class_name = excluded.class_name,
            active = true;
      if v_existing is null then v_added := v_added + 1; else v_updated := v_updated + 1; end if;
    exception when others then
      v_errors := v_errors || jsonb_build_object('line', v_i, 'email', v_email, 'error', sqlerrm);
    end;
    v_existing := null;
  end loop;
  return jsonb_build_object('added', v_added, 'updated', v_updated, 'errors', v_errors);
end $$;

-- ---------------------------------------------------------------- auth hook

-- Only people on the list can create an account. Rejected e-mails never get a code.
create function private.hook_before_user_created(event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.people p
              where p.email = lower(event -> 'user' ->> 'email') and p.active) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'not_registered'
  ));
end $$;

-- ---------------------------------------------------------------- row level security

alter table public.settings enable row level security;
alter table public.people enable row level security;
alter table public.rounds enable row level security;
alter table public.courses enable row level security;
alter table public.enrollments enable row level security;
alter table public.email_outbox enable row level security;

create policy settings_read on public.settings for select to authenticated
  using ((select private.current_person_id()) is not null);
create policy settings_admin on public.settings for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy people_read on public.people for select to authenticated
  using (email = (select private.jwt_email()) or (select private.is_staff()));
-- teachers manage students; admins manage everyone
create policy people_insert on public.people for insert to authenticated
  with check ((select private.is_admin()) or ((select private.is_staff()) and role = 'student'));
create policy people_update on public.people for update to authenticated
  using ((select private.is_admin()) or ((select private.is_staff()) and role = 'student'))
  with check ((select private.is_admin()) or ((select private.is_staff()) and role = 'student'));
create policy people_delete on public.people for delete to authenticated
  using ((select private.is_admin()) or ((select private.is_staff()) and role = 'student'));

create policy rounds_read on public.rounds for select to authenticated
  using ((select private.is_staff()) or (published and (select private.current_person_id()) is not null));
create policy rounds_insert on public.rounds for insert to authenticated
  with check ((select private.is_staff()));
create policy rounds_update on public.rounds for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy rounds_delete on public.rounds for delete to authenticated
  using ((select private.is_staff()));

create policy courses_read on public.courses for select to authenticated
  using ((select private.is_staff()) or (
    (select private.current_person_id()) is not null
    and exists (select 1 from public.rounds r where r.id = round_id and r.published)));
create policy courses_insert on public.courses for insert to authenticated
  with check ((select private.is_staff()));
create policy courses_update on public.courses for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy courses_delete on public.courses for delete to authenticated
  using ((select private.is_staff()));

-- Writes go through the RPCs above; nobody writes these tables directly.
create policy enrollments_read on public.enrollments for select to authenticated
  using (person_id = (select private.current_person_id()) or (select private.is_staff()));

create policy email_outbox_read on public.email_outbox for select to authenticated
  using ((select private.is_staff()));

-- ---------------------------------------------------------------- grants

revoke all on all tables in schema public from anon;
grant select on public.settings, public.people, public.rounds, public.courses,
                public.enrollments, public.email_outbox to authenticated;
grant update on public.settings to authenticated;
grant insert, update, delete on public.people, public.rounds, public.courses to authenticated;
revoke insert, update, delete on public.enrollments, public.email_outbox from authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated, supabase_auth_admin;
grant execute on function private.jwt_email(), private.current_person_id(), private.my_role(),
                          private.is_staff(), private.is_admin() to authenticated;
grant execute on function private.hook_before_user_created(jsonb) to supabase_auth_admin;

revoke execute on function public.server_time(), public.apply(uuid), public.my_enrollments(),
                           public.request_drop(uuid, text), public.cancel_drop_request(uuid),
                           public.leave_waitlist(uuid), public.resolve_drop(uuid, boolean, text),
                           public.remove_enrollment(uuid, text), public.resend_slip(uuid),
                           public.import_people(jsonb, public.person_role)
  from public, anon;
grant execute on function public.server_time(), public.apply(uuid), public.my_enrollments(),
                          public.request_drop(uuid, text), public.cancel_drop_request(uuid),
                          public.leave_waitlist(uuid), public.resolve_drop(uuid, boolean, text),
                          public.remove_enrollment(uuid, text), public.resend_slip(uuid),
                          public.import_people(jsonb, public.person_role)
  to authenticated;

-- ---------------------------------------------------------------- realtime

alter publication supabase_realtime add table public.rounds, public.courses, public.enrollments;

-- ---------------------------------------------------------------- retries

-- Anything the instant kick missed (mailer down, SMTP hiccup) is retried each minute.
select cron.schedule(
  'autonomia-mailer-retry',
  '* * * * *',
  $$select private.kick_mailer()
     where exists (select 1 from public.email_outbox
                    where sent_at is null and attempts < 6
                      and (locked_until is null or locked_until < now()))$$
);
