-- Removes every demo/test record: all @teste.invalid people, their logins,
-- the demo rounds and anything queued for them. Run before real use:
--   supabase db query --linked -f supabase/dev/reset-demo.sql
begin;
delete from public.rounds
 where id in ('d0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000a2');
delete from public.enrollments
 where person_id in (select id from public.people where email like '%@teste.invalid');
delete from public.people where email like '%@teste.invalid';
delete from auth.users where email like '%@teste.invalid';
commit;
select count(*) as people_left from public.people;
