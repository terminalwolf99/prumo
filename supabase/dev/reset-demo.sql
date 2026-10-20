-- Removes every demo/test record: all @teste.invalid people, their logins,
-- every test round (the demo ones and any a test account made) and anything
-- queued for them. Run before real use:
--   supabase db query --linked -f supabase/dev/reset-demo.sql
begin;
delete from public.rounds where is_test;
delete from public.enrollments
 where person_id in (select id from public.people where email like '%@teste.invalid');
delete from public.people where email like '%@teste.invalid';
delete from auth.users where email like '%@teste.invalid';
commit;
select count(*) as people_left from public.people;
