# Prumo · Escola Autonomia

Prumo is the web app Escola Autonomia (Florianópolis/SC) uses for Ensino Médio students to sign up for advanced subjects
(aprofundamentos): limited spots, multi-disciplinary, e-mail confirmation,
first come first served. All times are Horário de Brasília.

- **Students** sign in with their institutional e-mail and a 6-digit code,
  watch a countdown synced to the server clock, and claim a spot. Each
  confirmed spot e-mails them the same PDF slip with their name stamped on it.
- **Teachers** manage rounds (opening/closing time, max choices per student),
  subjects (spots, schedule, eligible years), the student allowlist (one by one
  or pasted from a spreadsheet), rosters in arrival order to the millisecond,
  and drop requests.
- **Admins** also manage the team, the institutional domains and the slip template.

## How it works

| Piece | Where |
| --- | --- |
| Database, rules, the race | `supabase/migrations/` (Postgres on Supabase, São Paulo region) |
| E-mail + PDF | `supabase/functions/mailer` (outbox → SMTP), `supabase/functions/slip` (download) |
| Web app | `web/` (static files, Preact + htm from a CDN, no build step) |

**First come, first served.** `apply()` locks the student's row, then the
subject's row, and only then reads the clock. Concurrent clicks on one subject
are served strictly one at a time; whoever got the lock first is earlier in
`applied_at`. Tested with 30 simultaneous students on a 10-spot subject:
exactly 10 confirmed and 20 waitlisted, in arrival order.

**Full subjects** put students on a waitlist. When a spot frees up (a teacher
approves a drop request, removes someone, or adds spots), the next person in
line gets it automatically, with an e-mail and their slip. Students can leave a
waitlist on their own; giving up a confirmed spot needs a teacher's approval.

**Who can sign in.** Only e-mails in `public.people`. A Supabase Auth hook
rejects everyone else before any e-mail is sent.

## Still to do before real use

1. **Institutional domains (done).** Students `@aluno.autonomia.com.br`,
   teachers `@autonomia.com.br`; editable in Ajustes → Domínios institucionais.
2. **Sender.** Supabase blocks SMTP ports 25/587 for functions, so use 465.
   - Gmail: turn on 2-step verification, create an app password.
   - Fill `supabase/functions/.env` (gitignored) and run
     `supabase secrets set --env-file supabase/functions/.env`.
     `SMTP_*` is the main sender (the school's, once IT provides it) and
     `SMTP_FALLBACK_*` is tried when it fails.
   - For login codes, set the same account in `[auth.email.smtp]` in
     `supabase/config.toml`, uncomment the two `[auth.email.template.*]`
     blocks, raise `email_sent`, and run `supabase config push`.
     Until then Supabase sends sign-in links (only to the project's team), and
     the app accepts those too.
3. **Hosting: GitHub Pages.** `.github/workflows/pages.yml` publishes `web/`
   on every push to `main` (repo Settings → Pages → Source: GitHub Actions).
   Then add the site URL to `site_url` and `additional_redirect_urls` in
   `config.toml`, set the `APP_URL` function secret, and `supabase config push`.
4. **Keep-alive.** `.github/workflows/keepalive.yml` pings the database daily
   so the free project doesn't pause. GitHub turns scheduled workflows off
   after 60 days without commits; re-enable it from the Actions tab.
5. **Slip design.** Upload the final PDF in Ajustes → Comprovante. Field
   positions live in `settings.slip_layout` (see `functions/_shared/slip.ts`).

## Testing without e-mail

`web/dev.js` and `supabase/dev/demo.sql` (both gitignored) hold demo accounts.
On localhost the login screen shows "Contas de teste" buttons that sign in
without a code. Remove all demo data before real use:

```bash
supabase db query --linked -f supabase/dev/reset-demo.sql
```

## Local preview

```bash
python3 -m http.server 5500 --directory web
```

Then open http://localhost:5500. The app talks to the real Supabase project.

## Deploying backend changes

```bash
supabase db push --linked
supabase functions deploy mailer slip --project-ref qvusibdisuvwsfflyazq --use-api
```
