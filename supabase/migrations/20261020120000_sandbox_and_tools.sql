-- 1. Test sandbox. Test accounts (@teste.invalid) share an easy password, so
--    they may only touch test data: test rounds, their subjects, test people.
--    Real students never see test rounds and test students never take real seats.
-- 2. verify_slip(): public check of a slip's code (the QR on the PDF).
-- 3. Mailer state, so the retry job stops calling every minute while no
--    sender is configured; mail_status() for the settings screen.
-- 4. staff_enroll(): a teacher signs a student up by hand (exceptions).
-- 5. duplicate_round(): copy a round and its subjects for the next term.

-- ---------------------------------------------------------------- 1. sandbox

alter table public.rounds add column is_test boolean not null default false;
update public.rounds set is_test = true
 where id in ('d0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000a2');

create function private.is_test_account() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(private.jwt_email() like '%@teste.invalid', false)
$$;
grant execute on function private.is_test_account() to authenticated;

-- rounds a test account creates are test rounds
create function private.rounds_mark_test() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.is_test_account() then
    new.is_test := true;
  end if;
  return new;
end $$;
create trigger rounds_mark_test before insert or update on public.rounds
  for each row execute function private.rounds_mark_test();

drop policy rounds_read on public.rounds;
drop policy rounds_insert on public.rounds;
drop policy rounds_update on public.rounds;
drop policy rounds_delete on public.rounds;
create policy rounds_read on public.rounds for select to authenticated
  using ((select private.is_staff()) or (
    published and (select private.current_person_id()) is not null
    and (not is_test or (select private.is_test_account()))));
create policy rounds_insert on public.rounds for insert to authenticated
  with check ((select private.is_staff()) and (is_test or not (select private.is_test_account())));
create policy rounds_update on public.rounds for update to authenticated
  using ((select private.is_staff()) and (is_test or not (select private.is_test_account())))
  with check ((select private.is_staff()) and (is_test or not (select private.is_test_account())));
create policy rounds_delete on public.rounds for delete to authenticated
  using ((select private.is_staff()) and (is_test or not (select private.is_test_account())));

create function private.round_is_test(p_round uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select r.is_test from public.rounds r where r.id = p_round), false)
$$;
grant execute on function private.round_is_test(uuid) to authenticated;

drop policy courses_read on public.courses;
drop policy courses_insert on public.courses;
drop policy courses_update on public.courses;
drop policy courses_delete on public.courses;
create policy courses_read on public.courses for select to authenticated
  using ((select private.is_staff()) or (
    (select private.current_person_id()) is not null
    and exists (select 1 from public.rounds r where r.id = round_id and r.published
                and (not r.is_test or (select private.is_test_account())))));
create policy courses_insert on public.courses for insert to authenticated
  with check ((select private.is_staff()) and (not (select private.is_test_account()) or private.round_is_test(round_id)));
create policy courses_update on public.courses for update to authenticated
  using ((select private.is_staff()) and (not (select private.is_test_account()) or private.round_is_test(round_id)))
  with check ((select private.is_staff()) and (not (select private.is_test_account()) or private.round_is_test(round_id)));
create policy courses_delete on public.courses for delete to authenticated
  using ((select private.is_staff()) and (not (select private.is_test_account()) or private.round_is_test(round_id)));

drop policy people_insert on public.people;
drop policy people_update on public.people;
drop policy people_delete on public.people;
create policy people_insert on public.people for insert to authenticated
  with check (((select private.is_admin()) or ((select private.is_staff()) and role = 'student'))
              and (not (select private.is_test_account()) or email like '%@teste.invalid'));
create policy people_update on public.people for update to authenticated
  using (((select private.is_admin()) or ((select private.is_staff()) and role = 'student'))
         and (not (select private.is_test_account()) or email like '%@teste.invalid'))
  with check (((select private.is_admin()) or ((select private.is_staff()) and role = 'student'))
              and (not (select private.is_test_account()) or email like '%@teste.invalid'));
create policy people_delete on public.people for delete to authenticated
  using (((select private.is_admin()) or ((select private.is_staff()) and role = 'student'))
         and (not (select private.is_test_account()) or email like '%@teste.invalid'));

drop policy settings_admin on public.settings;
create policy settings_admin on public.settings for update to authenticated
  using ((select private.is_admin()) and not (select private.is_test_account()))
  with check ((select private.is_admin()) and not (select private.is_test_account()));

-- Test accounts add @teste.invalid people, so the domain rules don't apply to them.
create or replace function private.people_validate() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_student text[];
  v_staff text[];
  v_domain text;
begin
  new.email := lower(trim(new.email));
  new.full_name := regexp_replace(trim(new.full_name), '\s+', ' ', 'g');
  new.class_name := nullif(trim(new.class_name), '');
  if new.role <> 'student' then
    new.grade := null;
  end if;
  new.updated_at := now();

  if tg_op = 'UPDATE' and new.email = old.email and new.role = old.role then
    return new;
  end if;
  if private.is_test_account() and new.email like '%@teste.invalid' then
    return new;
  end if;
  select s.student_domains, s.staff_domains into v_student, v_staff from public.settings s;
  v_domain := split_part(new.email, '@', 2);
  if new.role = 'student' and cardinality(v_student) > 0 and not (v_domain = any (v_student)) then
    raise exception 'student_domain_required|%', array_to_string(v_student, ',') using errcode = 'P0001';
  end if;
  if new.role = 'teacher' and cardinality(v_staff) > 0 and not (v_domain = any (v_staff)) then
    raise exception 'staff_domain_required|%', array_to_string(v_staff, ',') using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function public.import_people(p_rows jsonb, p_role public.person_role default 'student')
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
      if private.is_test_account() and v_email not like '%@teste.invalid' then
        raise exception 'test_sandbox' using errcode = 'P0001';
      end if;
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

create or replace function public.set_slip_template(p_base64 text, p_filename text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_pdf bytea;
begin
  if not private.is_staff() then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if private.is_test_account() then
    raise exception 'test_sandbox' using errcode = 'P0001';
  end if;
  if p_base64 is null then
    delete from private.slip_template;
    return;
  end if;
  v_pdf := decode(p_base64, 'base64');
  if substring(v_pdf from 1 for 5) <> '\x255044462d'::bytea then
    raise exception 'not_a_pdf' using errcode = 'P0001';
  end if;
  if length(v_pdf) > 5 * 1024 * 1024 then
    raise exception 'too_large' using errcode = 'P0001';
  end if;
  insert into private.slip_template (pdf, filename, uploaded_by)
  values (v_pdf, p_filename, private.current_person_id())
  on conflict (id) do update
    set pdf = excluded.pdf, filename = excluded.filename,
        uploaded_at = now(), uploaded_by = excluded.uploaded_by;
end $$;

-- staff actions on an enrollment: test accounts only on test rounds
create or replace function private.staff_enrollment_for_update(p_enrollment uuid) returns public.enrollments
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
  if private.is_test_account() and not private.round_is_test(v_enr.round_id) then
    raise exception 'test_sandbox' using errcode = 'P0001';
  end if;
  perform 1 from public.courses c where c.id = v_enr.course_id for update;
  select e.* into v_enr from public.enrollments e where e.id = p_enrollment for update;
  return v_enr;
end $$;

-- apply(): real students never reach test rounds; test students never take real seats
create or replace function public.apply(p_course_id uuid) returns jsonb
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

  if not v_round.published or (v_round.is_test and v_me.email not like '%@teste.invalid') then
    raise exception 'course_not_found' using errcode = 'P0001';
  end if;
  if not v_round.is_test and v_me.email like '%@teste.invalid' then
    raise exception 'test_sandbox' using errcode = 'P0001';
  end if;

  v_now := clock_timestamp();
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

-- ---------------------------------------------------------------- 2. verify_slip

-- The code is the slip's secret (31^8 combinations); anyone holding the slip
-- can check it is real. Returns null for an unknown code.
create function public.verify_slip(p_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', e.status, 'full_name', p.full_name, 'class_name', p.class_name,
    'course', c.title, 'schedule', c.schedule, 'round', r.title,
    'applied_at', e.applied_at, 'confirmed_at', e.confirmed_at, 'is_test', r.is_test,
    'school', s.school_name)
  from public.enrollments e
  join public.people p on p.id = e.person_id
  join public.courses c on c.id = e.course_id
  join public.rounds r on r.id = e.round_id
  cross join public.settings s
  where e.code = upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g'))
$$;
revoke execute on function public.verify_slip(text) from public;
grant execute on function public.verify_slip(text) to anon, authenticated;

-- ---------------------------------------------------------------- 3. mailer state

create table private.mailer_state (
  id boolean primary key default true check (id),
  configured boolean not null,
  checked_at timestamptz not null default now()
);

create function public.mail_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when private.is_staff() then jsonb_build_object(
    'configured', (select m.configured from private.mailer_state m),
    'checked_at', (select m.checked_at from private.mailer_state m),
    'pending', (select count(*) from public.email_outbox o where o.sent_at is null and o.attempts < 6),
    'failed', (select count(*) from public.email_outbox o where o.sent_at is null and o.attempts >= 6),
    'sent_24h', (select count(*) from public.email_outbox o where o.sent_at > now() - interval '1 day'))
  end
$$;
revoke execute on function public.mail_status() from public, anon;
grant execute on function public.mail_status() to authenticated;

-- Retry sweep: every minute while a sender works; hourly while none is set up.
select cron.schedule(
  'autonomia-mailer-retry',
  '* * * * *',
  $$select private.kick_mailer()
     where exists (select 1 from public.email_outbox
                    where sent_at is null and attempts < 6
                      and (locked_until is null or locked_until < now()))
       and coalesce((select m.configured or m.checked_at < now() - interval '1 hour'
                       from private.mailer_state m), true)$$
);

-- ---------------------------------------------------------------- 4. staff_enroll

-- A teacher signs a student up by hand: no opening hours, limits or time-slot
-- checks. p_force gives a seat even when the subject is full.
create function public.staff_enroll(p_course_id uuid, p_person_id uuid, p_force boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_course public.courses;
  v_person public.people;
  v_round public.rounds;
  v_held int;
  v_status public.enrollment_status;
  v_enr public.enrollments;
  v_now timestamptz;
begin
  if not private.is_staff() then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  select * into v_person from public.people p where p.id = p_person_id and p.active for update;
  if not found or v_person.role <> 'student' then
    raise exception 'only_students' using errcode = 'P0001';
  end if;
  select * into v_course from public.courses c where c.id = p_course_id for update;
  if not found then
    raise exception 'course_not_found' using errcode = 'P0001';
  end if;
  select * into v_round from public.rounds r where r.id = v_course.round_id;
  if private.is_test_account() and not v_round.is_test then
    raise exception 'test_sandbox' using errcode = 'P0001';
  end if;
  if v_round.is_test <> (v_person.email like '%@teste.invalid') then
    raise exception 'test_sandbox' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.enrollments e
              where e.course_id = v_course.id and e.person_id = v_person.id
                and e.status in ('confirmed', 'waitlisted', 'drop_requested')) then
    raise exception 'already_applied' using errcode = 'P0001';
  end if;

  select count(*) into v_held from public.enrollments e
   where e.course_id = v_course.id and e.status in ('confirmed', 'drop_requested');
  v_status := case when v_held < v_course.capacity or p_force then 'confirmed' else 'waitlisted' end;
  v_now := clock_timestamp();

  insert into public.enrollments (course_id, round_id, person_id, status, applied_at, confirmed_at, end_note)
  values (v_course.id, v_round.id, v_person.id, v_status, v_now,
          case when v_status = 'confirmed' then v_now end, 'Inscrição feita pela coordenação.')
  returning * into v_enr;
  perform private.enqueue_email(v_status::text, v_enr.id);

  return jsonb_build_object('status', v_enr.status, 'code', v_enr.code,
    'position', case when v_status = 'waitlisted' then private.waitlist_position(v_enr.id) end);
end $$;
revoke execute on function public.staff_enroll(uuid, uuid, boolean) from public, anon;
grant execute on function public.staff_enroll(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- 5. duplicate_round

-- Copies a round and its subjects, unpublished, so next term starts from this one.
create function public.duplicate_round(p_round_id uuid, p_title text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_src public.rounds;
  v_new uuid;
begin
  if not private.is_staff() then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  select * into v_src from public.rounds r where r.id = p_round_id;
  if not found then
    raise exception 'course_not_found' using errcode = 'P0001';
  end if;
  if private.is_test_account() and not v_src.is_test then
    raise exception 'test_sandbox' using errcode = 'P0001';
  end if;
  insert into public.rounds (title, description, opens_at, closes_at, max_choices, block_same_slot, published, is_test)
  values (coalesce(nullif(trim(p_title), ''), v_src.title || ' (cópia)'), v_src.description,
          v_src.opens_at, v_src.closes_at, v_src.max_choices, v_src.block_same_slot, false, v_src.is_test)
  returning id into v_new;
  insert into public.courses (round_id, title, area, description, teacher_names, schedule, slot, location, capacity, grades, sort_order)
  select v_new, c.title, c.area, c.description, c.teacher_names, c.schedule, c.slot, c.location, c.capacity, c.grades, c.sort_order
    from public.courses c where c.round_id = p_round_id;
  return v_new;
end $$;
revoke execute on function public.duplicate_round(uuid, text) from public, anon;
grant execute on function public.duplicate_round(uuid, text) to authenticated;
