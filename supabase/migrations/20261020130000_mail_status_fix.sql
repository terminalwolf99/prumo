-- Mail closed for fake test addresses is not "sent".
create or replace function public.mail_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when private.is_staff() then jsonb_build_object(
    'configured', (select m.configured from private.mailer_state m),
    'checked_at', (select m.checked_at from private.mailer_state m),
    'pending', (select count(*) from public.email_outbox o where o.sent_at is null and o.attempts < 6),
    'failed', (select count(*) from public.email_outbox o where o.sent_at is null and o.attempts >= 6),
    'sent_24h', (select count(*) from public.email_outbox o
                  where o.sent_at > now() - interval '1 day'
                    and coalesce(o.last_error, '') not like 'endereço de teste%'))
  end
$$;
