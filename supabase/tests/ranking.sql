-- End-to-end checks of the ranking round, in one rolled-back transaction.
--   supabase db query --linked -f supabase/tests/ranking.sql
-- Passing = the last row says "all ranking checks passed".
begin;

-- fixtures as owner --------------------------------------------------------------
insert into public.rounds (id, title, kind, opens_at, closes_at, published, is_test) values
  ('c0000000-0000-0000-0000-0000000000a1', 'Rank', 'ranking', now() - interval '1 hour', now() + interval '1 day', true, false);
-- 1º ano: two days; 2º ano: one day
insert into public.courses (id, round_id, title, group_label, group_order, grades, capacity, sort_order) values
  ('c0000000-0000-0000-0000-0000000000c1', 'c0000000-0000-0000-0000-0000000000a1', 'Historia',   'Terca', 1, '{1}', 0, 1),
  ('c0000000-0000-0000-0000-0000000000c2', 'c0000000-0000-0000-0000-0000000000a1', 'Literatura', 'Terca', 1, '{1}', 0, 2),
  ('c0000000-0000-0000-0000-0000000000c3', 'c0000000-0000-0000-0000-0000000000a1', 'Geografia',  'Terca', 1, '{1}', 0, 3),
  ('c0000000-0000-0000-0000-0000000000d1', 'c0000000-0000-0000-0000-0000000000a1', 'Ingles',     'Quarta', 2, '{1}', 0, 1),
  ('c0000000-0000-0000-0000-0000000000d2', 'c0000000-0000-0000-0000-0000000000a1', 'Artes',      'Quarta', 2, '{1}', 0, 2),
  ('c0000000-0000-0000-0000-0000000000e1', 'c0000000-0000-0000-0000-0000000000a1', 'Matematica', 'Terca', 1, '{2}', 0, 1),
  ('c0000000-0000-0000-0000-0000000000e2', 'c0000000-0000-0000-0000-0000000000a1', 'Fisica',     'Terca', 1, '{2}', 0, 2);

-- Ana (1º) self-registers and submits -------------------------------------------
select set_config('request.jwt.claims', '{"email":"ana.teste@aluno.autonomia.com.br","role":"authenticated"}', true);
set local role authenticated;

do $$ begin
  perform public.register_self('Ana Teste Ranking', 1::smallint, '1º A');
  if (select grade from public.people where email = 'ana.teste@aluno.autonomia.com.br') <> 1 then
    raise exception 'FAIL 1: register_self did not set the student';
  end if;
end $$;

-- incomplete: only two of the three Terça options
do $$ begin
  perform public.submit_ranking('c0000000-0000-0000-0000-0000000000a1',
    '[{"course_id":"c0000000-0000-0000-0000-0000000000c1","rank":1},
      {"course_id":"c0000000-0000-0000-0000-0000000000c2","rank":2},
      {"course_id":"c0000000-0000-0000-0000-0000000000d1","rank":1},
      {"course_id":"c0000000-0000-0000-0000-0000000000d2","rank":2}]'::jsonb);
  raise exception 'FAIL 2: accepted an incomplete day';
exception when others then
  if sqlerrm not like '%incomplete_ranking%' then raise exception 'FAIL 2: %', sqlerrm; end if;
end $$;

-- duplicate rank within Terça
do $$ begin
  perform public.submit_ranking('c0000000-0000-0000-0000-0000000000a1',
    '[{"course_id":"c0000000-0000-0000-0000-0000000000c1","rank":1},
      {"course_id":"c0000000-0000-0000-0000-0000000000c2","rank":1},
      {"course_id":"c0000000-0000-0000-0000-0000000000c3","rank":3},
      {"course_id":"c0000000-0000-0000-0000-0000000000d1","rank":1},
      {"course_id":"c0000000-0000-0000-0000-0000000000d2","rank":2}]'::jsonb);
  raise exception 'FAIL 3: accepted duplicate ranks';
exception when others then
  if sqlerrm not like '%incomplete_ranking%' then raise exception 'FAIL 3: %', sqlerrm; end if;
end $$;

-- a 2º-ano course sneaked in → rejected
do $$ begin
  perform public.submit_ranking('c0000000-0000-0000-0000-0000000000a1',
    '[{"course_id":"c0000000-0000-0000-0000-0000000000e1","rank":1},
      {"course_id":"c0000000-0000-0000-0000-0000000000c1","rank":1},
      {"course_id":"c0000000-0000-0000-0000-0000000000c2","rank":2},
      {"course_id":"c0000000-0000-0000-0000-0000000000c3","rank":3},
      {"course_id":"c0000000-0000-0000-0000-0000000000d1","rank":1},
      {"course_id":"c0000000-0000-0000-0000-0000000000d2","rank":2}]'::jsonb);
  raise exception 'FAIL 4: accepted a course from another year';
exception when others then
  if sqlerrm not like '%incomplete_ranking%' then raise exception 'FAIL 4: %', sqlerrm; end if;
end $$;

-- valid full ranking
do $$ declare r jsonb; begin
  r := public.submit_ranking('c0000000-0000-0000-0000-0000000000a1',
    '[{"course_id":"c0000000-0000-0000-0000-0000000000c1","rank":1},
      {"course_id":"c0000000-0000-0000-0000-0000000000c2","rank":2},
      {"course_id":"c0000000-0000-0000-0000-0000000000c3","rank":3},
      {"course_id":"c0000000-0000-0000-0000-0000000000d1","rank":1},
      {"course_id":"c0000000-0000-0000-0000-0000000000d2","rank":2}]'::jsonb);
  if length(r ->> 'code') < 6 then raise exception 'FAIL 5: no code: %', r; end if;
  perform set_config('test.ana_code', r ->> 'code', true);
  perform set_config('test.ana_at', r ->> 'created_at', true);
end $$;

do $$ declare m jsonb; begin
  m := public.my_ranking('c0000000-0000-0000-0000-0000000000a1');
  if jsonb_array_length(m -> 'choices') <> 5 then raise exception 'FAIL 6: my_ranking choices: %', m; end if;
end $$;

-- re-submit keeps the first created_at (place in line is fixed)
do $$ declare r jsonb; begin
  perform pg_sleep(0.01);
  r := public.submit_ranking('c0000000-0000-0000-0000-0000000000a1',
    '[{"course_id":"c0000000-0000-0000-0000-0000000000c3","rank":1},
      {"course_id":"c0000000-0000-0000-0000-0000000000c2","rank":2},
      {"course_id":"c0000000-0000-0000-0000-0000000000c1","rank":3},
      {"course_id":"c0000000-0000-0000-0000-0000000000d2","rank":1},
      {"course_id":"c0000000-0000-0000-0000-0000000000d1","rank":2}]'::jsonb);
  if (r ->> 'created_at') <> current_setting('test.ana_at') then raise exception 'FAIL 7: created_at moved on re-submit'; end if;
end $$;

-- Bia (1º) registers and submits later → she is after Ana in the list ------------
reset role;
select set_config('request.jwt.claims', '{"email":"bia.teste@aluno.autonomia.com.br","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  perform public.register_self('Bia Teste Ranking', 1::smallint, '1º B');
  perform pg_sleep(0.01);
  perform public.submit_ranking('c0000000-0000-0000-0000-0000000000a1',
    '[{"course_id":"c0000000-0000-0000-0000-0000000000c1","rank":1},
      {"course_id":"c0000000-0000-0000-0000-0000000000c2","rank":2},
      {"course_id":"c0000000-0000-0000-0000-0000000000c3","rank":3},
      {"course_id":"c0000000-0000-0000-0000-0000000000d1","rank":1},
      {"course_id":"c0000000-0000-0000-0000-0000000000d2","rank":2}]'::jsonb);
end $$;

-- staff list is ordered by arrival and carries the choices -----------------------
reset role;
insert into public.people (email, full_name, role) values ('real.prof@autonomia.com.br', 'Prof Real', 'teacher');
select set_config('request.jwt.claims', '{"email":"real.prof@autonomia.com.br","role":"authenticated"}', true);
set local role authenticated;
do $$ declare l jsonb; begin
  l := public.ranking_list('c0000000-0000-0000-0000-0000000000a1');
  if jsonb_array_length(l) <> 2 then raise exception 'FAIL 8: list size: %', l; end if;
  if (l -> 0 ->> 'full_name') <> 'Ana Teste Ranking' then raise exception 'FAIL 9: wrong arrival order: %', l; end if;
  if jsonb_array_length(l -> 0 -> 'choices') <> 5 then raise exception 'FAIL 10: choices missing in list: %', l; end if;
end $$;

-- anyone can verify a ranking slip by its code -----------------------------------
reset role;
set local role anon;
do $$ declare v jsonb; begin
  v := public.verify_slip(current_setting('test.ana_code'));
  if v ->> 'type' <> 'ranking' or v ->> 'full_name' <> 'Ana Teste Ranking' then raise exception 'FAIL 11: verify_slip: %', v; end if;
  if jsonb_array_length(v -> 'choices') <> 5 then raise exception 'FAIL 12: verify_slip choices: %', v; end if;
end $$;

-- the receipt e-mail was queued against the submission, not an enrollment --------
reset role;
do $$ begin
  if not exists (select 1 from public.email_outbox o
                  join public.ranking_submissions s on s.id = o.submission_id
                  join public.people p on p.id = s.person_id
                 where p.email = 'ana.teste@aluno.autonomia.com.br' and o.kind = 'ranking' and o.enrollment_id is null) then
    raise exception 'FAIL 13: no ranking receipt queued';
  end if;
end $$;

select 'all ranking checks passed' as result;
rollback;
