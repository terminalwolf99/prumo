-- End-to-end checks of Prumo's rules, inside one transaction that is rolled
-- back at the end: nothing it creates survives, nothing gets e-mailed.
--   supabase db query --linked -f supabase/tests/flows.sql
-- Passing = the last row says "all checks passed". A broken rule stops the
-- run with "FAIL <n>: …".
begin;

-- fixtures, as the database owner -------------------------------------------
update public.settings set student_domains = '{}', staff_domains = '{}';
insert into public.people (id, email, full_name, role, grade) values
  ('a0000000-0000-0000-0000-0000000000f1', 't.ana@teste.invalid', 'Ana Teste', 'student', 1),
  ('a0000000-0000-0000-0000-0000000000f2', 't.bia@teste.invalid', 'Bia Teste', 'student', 2),
  ('a0000000-0000-0000-0000-0000000000f3', 't.caio@teste.invalid', 'Caio Teste', 'student', 2),
  ('a0000000-0000-0000-0000-0000000000f4', 't.prof@teste.invalid', 'Prof Teste', 'teacher', null),
  ('a0000000-0000-0000-0000-0000000000f5', 'real.aluno@aluno.autonomia.com.br', 'Aluno Real', 'student', 2),
  ('a0000000-0000-0000-0000-0000000000f6', 'real.prof@autonomia.com.br', 'Prof Real', 'teacher', null);
insert into public.rounds (id, title, opens_at, closes_at, max_choices, block_same_slot, published, is_test) values
  ('a0000000-0000-0000-0000-0000000000a1', 'T', now() - interval '1 hour', now() + interval '1 day', 2, true, true, true),
  ('a0000000-0000-0000-0000-0000000000a2', 'R', now() - interval '1 hour', now() + interval '1 day', 2, true, true, false);
insert into public.courses (id, round_id, title, capacity, slot, grades) values
  ('a0000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-0000000000a1', 'T1', 1, 'A', '{1,2,3}'),
  ('a0000000-0000-0000-0000-0000000000c2', 'a0000000-0000-0000-0000-0000000000a1', 'T2', 5, 'A', '{1,2,3}'),
  ('a0000000-0000-0000-0000-0000000000c3', 'a0000000-0000-0000-0000-0000000000a1', 'T3', 5, 'B', '{2,3}'),
  ('a0000000-0000-0000-0000-0000000000c4', 'a0000000-0000-0000-0000-0000000000a2', 'R1', 2, null, '{1,2,3}');

-- students ---------------------------------------------------------------------
select set_config('request.jwt.claims', '{"email":"t.ana@teste.invalid","role":"authenticated"}', true);
set local role authenticated;

do $$ begin
  perform public.apply('a0000000-0000-0000-0000-0000000000c3');
  raise exception 'FAIL 1: a 1st-year student got into a 2nd/3rd-year subject';
exception when others then
  if sqlerrm not like '%grade_not_eligible%' then raise exception 'FAIL 1: %', sqlerrm; end if;
end $$;

do $$ declare r jsonb; begin
  r := public.apply('a0000000-0000-0000-0000-0000000000c1');
  if r ->> 'status' <> 'confirmed' then raise exception 'FAIL 2: first applicant not confirmed: %', r; end if;
  perform set_config('test.ana_t1', r ->> 'enrollment_id', true);
  perform set_config('test.ana_code', r ->> 'code', true);
end $$;

do $$ begin
  perform public.apply('a0000000-0000-0000-0000-0000000000c4');
  raise exception 'FAIL 3: a test student took a seat in a real round';
exception when others then
  if sqlerrm not like '%test_sandbox%' then raise exception 'FAIL 3: %', sqlerrm; end if;
end $$;

reset role;
select set_config('request.jwt.claims', '{"email":"t.bia@teste.invalid","role":"authenticated"}', true);
set local role authenticated;

do $$ declare r jsonb; begin
  r := public.apply('a0000000-0000-0000-0000-0000000000c1');
  if r ->> 'status' <> 'waitlisted' or (r ->> 'position')::int <> 1 then
    raise exception 'FAIL 4: second applicant should be waitlist #1: %', r;
  end if;
end $$;

do $$ begin
  perform public.apply('a0000000-0000-0000-0000-0000000000c2');
  raise exception 'FAIL 5: two subjects in the same time slot';
exception when others then
  if sqlerrm not like '%slot_conflict%' then raise exception 'FAIL 5: %', sqlerrm; end if;
end $$;

do $$ declare r jsonb; begin
  r := public.apply('a0000000-0000-0000-0000-0000000000c3');
  if r ->> 'status' <> 'confirmed' then raise exception 'FAIL 6: %', r; end if;
end $$;

do $$ begin
  perform public.apply('a0000000-0000-0000-0000-0000000000c2');
  raise exception 'FAIL 7: went past the round limit';
exception when others then
  if sqlerrm not like '%limit_reached%' and sqlerrm not like '%slot_conflict%' then raise exception 'FAIL 7: %', sqlerrm; end if;
end $$;

reset role;
select set_config('request.jwt.claims', '{"email":"t.caio@teste.invalid","role":"authenticated"}', true);
set local role authenticated;

do $$ declare r jsonb; begin
  r := public.apply('a0000000-0000-0000-0000-0000000000c1');
  if (r ->> 'position')::int <> 2 then raise exception 'FAIL 8: third applicant should be waitlist #2: %', r; end if;
end $$;

-- real student: never sees or reaches test rounds --------------------------------
reset role;
select set_config('request.jwt.claims', '{"email":"real.aluno@aluno.autonomia.com.br","role":"authenticated"}', true);
set local role authenticated;

do $$ begin
  if exists (select 1 from public.rounds where is_test) then raise exception 'FAIL 9: a real student can see test rounds'; end if;
  if exists (select 1 from public.courses where round_id = 'a0000000-0000-0000-0000-0000000000a1') then
    raise exception 'FAIL 9b: a real student can see test subjects';
  end if;
end $$;

do $$ begin
  perform public.apply('a0000000-0000-0000-0000-0000000000c1');
  raise exception 'FAIL 10: a real student applied to a test subject';
exception when others then
  if sqlerrm not like '%course_not_found%' then raise exception 'FAIL 10: %', sqlerrm; end if;
end $$;

do $$ declare r jsonb; begin
  r := public.apply('a0000000-0000-0000-0000-0000000000c4');
  if r ->> 'status' <> 'confirmed' then raise exception 'FAIL 11: %', r; end if;
  perform set_config('test.real_r1', r ->> 'enrollment_id', true);
end $$;

-- drop request → teacher approves → waitlist moves up ---------------------------
reset role;
select set_config('request.jwt.claims', '{"email":"t.ana@teste.invalid","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  perform public.request_drop(current_setting('test.ana_t1')::uuid, 'teste de desistência');
end $$;

reset role;
select set_config('request.jwt.claims', '{"email":"t.prof@teste.invalid","role":"authenticated"}', true);
set local role authenticated;

do $$ begin
  perform public.resolve_drop(current_setting('test.ana_t1')::uuid, true, null);
  if (select status from public.enrollments e join public.people p on p.id = e.person_id
       where p.email = 't.bia@teste.invalid' and e.course_id = 'a0000000-0000-0000-0000-0000000000c1') <> 'confirmed' then
    raise exception 'FAIL 12: the first on the waitlist was not promoted';
  end if;
end $$;

-- the test teacher stays inside the sandbox -------------------------------------
do $$ begin
  insert into public.people (email, full_name, role) values ('intruso@aluno.autonomia.com.br', 'Intruso', 'student');
  raise exception 'FAIL 13: a test account added a real e-mail';
exception when others then
  if sqlerrm not like '%row-level security%' then raise exception 'FAIL 13: %', sqlerrm; end if;
end $$;

do $$ begin
  insert into public.people (email, full_name, role, grade) values ('t.nova@teste.invalid', 'Nova Teste', 'student', 3);
end $$;

do $$ declare n int; begin
  update public.settings set school_name = 'hackeado';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 14: a test account changed the settings'; end if;
  update public.rounds set title = 'hackeado' where id = 'a0000000-0000-0000-0000-0000000000a2';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 15: a test account edited a real round'; end if;
end $$;

do $$ begin
  perform public.remove_enrollment(current_setting('test.real_r1')::uuid, null);
  raise exception 'FAIL 16: a test account removed a real enrollment';
exception when others then
  if sqlerrm not like '%test_sandbox%' then raise exception 'FAIL 16: %', sqlerrm; end if;
end $$;

do $$ begin
  perform public.set_slip_template('JVBERi0=', 'x.pdf');
  raise exception 'FAIL 17: a test account replaced the slip template';
exception when others then
  if sqlerrm not like '%test_sandbox%' then raise exception 'FAIL 17: %', sqlerrm; end if;
end $$;

-- a real teacher: more seats promote the waitlist; hand enrollment; duplicate -----
reset role;
select set_config('request.jwt.claims', '{"email":"real.prof@autonomia.com.br","role":"authenticated"}', true);
set local role authenticated;

do $$ begin
  update public.courses set capacity = 2 where id = 'a0000000-0000-0000-0000-0000000000c1';
  if (select status from public.enrollments e join public.people p on p.id = e.person_id
       where p.email = 't.caio@teste.invalid' and e.course_id = 'a0000000-0000-0000-0000-0000000000c1') <> 'confirmed' then
    raise exception 'FAIL 18: raising the capacity did not promote the waitlist';
  end if;
end $$;

do $$ begin
  perform public.staff_enroll('a0000000-0000-0000-0000-0000000000c4', 'a0000000-0000-0000-0000-0000000000f5', false);
  raise exception 'FAIL 19: enrolled the same student twice';
exception when others then
  if sqlerrm not like '%already_applied%' then raise exception 'FAIL 19: %', sqlerrm; end if;
end $$;

do $$ declare n uuid; c int; begin
  n := public.duplicate_round('a0000000-0000-0000-0000-0000000000a2', 'R copy');
  select count(*) into c from public.courses where round_id = n;
  if c <> 1 or (select published from public.rounds where id = n) then raise exception 'FAIL 20: duplicate_round'; end if;
end $$;

-- anyone can verify a slip by its code -------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
do $$ declare v jsonb; begin
  v := public.verify_slip(current_setting('test.ana_code'));
  if v ->> 'full_name' <> 'Ana Teste' then raise exception 'FAIL 21: verify_slip: %', v; end if;
  if public.verify_slip('ZZZZZZZZ') is not null then raise exception 'FAIL 22: verify_slip accepted a fake code'; end if;
end $$;

-- counters always match the enrollments ------------------------------------------
reset role;
do $$ begin
  if exists (
    select 1 from public.courses c
      left join lateral (
        select count(*) filter (where e.status in ('confirmed', 'drop_requested')) as seated,
               count(*) filter (where e.status = 'waitlisted') as waiting
          from public.enrollments e where e.course_id = c.id) x on true
     where c.id::text like 'a0000000-%'
       and (c.confirmed_count <> x.seated or c.waitlist_count <> x.waiting)) then
    raise exception 'FAIL 23: seat counters drifted from the enrollments';
  end if;
end $$;

select 'all checks passed' as result;
rollback;
