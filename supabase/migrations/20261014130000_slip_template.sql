-- The designed slip PDF ("the same single PDF for everyone"); the mailer stamps
-- each student's name and details onto it. Empty until the design is uploaded,
-- in which case a built-in placeholder layout is used.
create table private.slip_template (
  id boolean primary key default true check (id),
  pdf bytea not null,
  filename text,
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid references public.people (id) on delete set null
);

create function public.set_slip_template(p_base64 text, p_filename text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_pdf bytea;
begin
  if not private.is_staff() then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if p_base64 is null then
    delete from private.slip_template;
    return;
  end if;
  v_pdf := decode(p_base64, 'base64');
  if substring(v_pdf from 1 for 5) <> '\x255044462d'::bytea then  -- "%PDF-"
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

create function public.slip_template_info()
returns table (filename text, uploaded_at timestamptz, size_bytes int)
language sql stable security definer set search_path = '' as $$
  select t.filename, t.uploaded_at, length(t.pdf)
    from private.slip_template t
   where private.is_staff()
$$;

revoke execute on function public.set_slip_template(text, text), public.slip_template_info() from public, anon;
grant execute on function public.set_slip_template(text, text), public.slip_template_info() to authenticated;
