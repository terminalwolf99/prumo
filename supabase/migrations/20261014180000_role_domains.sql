-- Students and teachers have different institutional domains:
--   students  nome.sobrenome@aluno.autonomia.com.br
--   teachers  ...@autonomia.com
-- Admins are exempt. Only checked when an e-mail or role is set, so later
-- domain changes never block editing someone's name.
alter table public.settings rename column allowed_domains to student_domains;
alter table public.settings add column staff_domains text[] not null default '{}';
update public.settings set student_domains = '{aluno.autonomia.com.br}', staff_domains = '{autonomia.com}';

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
  select s.student_domains, s.staff_domains into v_student, v_staff from public.settings s;
  v_domain := split_part(new.email, '@', 2);
  -- the domains ride along in the message so the app can show them
  if new.role = 'student' and cardinality(v_student) > 0 and not (v_domain = any (v_student)) then
    raise exception 'student_domain_required|%', array_to_string(v_student, ',') using errcode = 'P0001';
  end if;
  if new.role = 'teacher' and cardinality(v_staff) > 0 and not (v_domain = any (v_staff)) then
    raise exception 'staff_domain_required|%', array_to_string(v_staff, ',') using errcode = 'P0001';
  end if;
  return new;
end $$;
