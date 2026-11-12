-- open_ranking_rounds also reports which years the round offers, so the
-- self-registration form can show the right "1º ano / 2º ano" buttons before
-- the student has a record.
drop function if exists public.open_ranking_rounds();
create function public.open_ranking_rounds()
returns table (id uuid, title text, description text, opens_at timestamptz, closes_at timestamptz,
               is_test boolean, grades smallint[])
language sql stable security definer set search_path = '' as $$
  select r.id, r.title, r.description, r.opens_at, r.closes_at, r.is_test,
         coalesce((select array_agg(distinct g order by g)
                     from public.courses c, unnest(c.grades) g
                    where c.round_id = r.id), '{}')::smallint[] as grades
    from public.rounds r
   where r.kind = 'ranking' and r.published
     and r.closes_at > clock_timestamp()
     and (r.is_test = coalesce(private.jwt_email() like '%@teste.invalid', false))
   order by r.opens_at
$$;
grant execute on function public.open_ranking_rounds() to authenticated;
