# Prumo · Escola Autonomia

Prumo is the web app Escola Autonomia (Florianópolis/SC) uses for Ensino Médio
students to sign up for advanced subjects (aprofundamentos): limited spots,
multi-disciplinary, first come first served, with an e-mailed PDF slip.
All times are Horário de Brasília.

Live: https://terminalwolf99.github.io/prumo/

- **Students** sign in with their institutional e-mail and a 6-digit code,
  watch a countdown synced to the server clock, and claim a spot. Each
  confirmed spot e-mails them the same PDF slip with their details stamped on
  it, including a QR code anyone can scan to check the slip is real.
- **Teachers** manage rounds, subjects and the student list (one by one or
  pasted from a spreadsheet); see rosters in arrival order to the millisecond;
  approve drop requests; enroll students by hand; export spreadsheets; see who
  hasn't signed up yet; preview the student screen ("Ver como estudante").
  The in-app **Ajuda** tab is the teachers' guide.
- **Admins** also manage the team, the institutional domains and the slip template.

## How it works

| Piece | Where |
| --- | --- |
| Database, rules, the race | `supabase/migrations/` (Postgres on Supabase, São Paulo region) |
| E-mail + PDF | `supabase/functions/mailer` (outbox → SMTP), `supabase/functions/slip` (download) |
| Web app | `web/` (static files, Preact + htm from a CDN, no build step) |
| Hosting | GitHub Pages via `.github/workflows/pages.yml` |
| Keep-alive | `.github/workflows/keepalive.yml` pings the database daily |
| Tests | `supabase/tests/flows.sql` (23 end-to-end checks, rolled back) |

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
rejects everyone else before any e-mail is sent. Students need
`@aluno.autonomia.com.br`, teachers `@autonomia.com.br` (admins are exempt).

**Slip verification.** Every slip carries an 8-character code and a QR to
`#/verificar/<code>`, a public page that says whether the enrollment is real
and still valid. The code is unguessable (31⁸ combinations).

## Test mode

Six demo accounts (`@teste.invalid`: four students, a teacher, an admin) let
people try everything without e-mail. On localhost the login screen signs them
in with one click; on the live site, after typing the test password once
("Tenho uma senha de teste"). The password is only in gitignored `web/dev.js`.

Test accounts live in a **sandbox** enforced by the database: they only see and
change test rounds (`rounds.is_test`) and `@teste.invalid` people; they can't
touch settings or the slip template; real students never see test rounds and
test students never take real seats. Mail to test addresses is never sent.

Before real students use Prumo: set `TEST_MODE = false` in
`web/test-accounts.js`, push, and run
`supabase db query --linked -f supabase/dev/reset-demo.sql`.

## Still to do

1. **E-mail sender.** Run `scripts/configurar-email.ps1` (asks for a Gmail
   app password, optionally the school's SMTP; nothing is saved to disk). It
   sets the slip sender, switches login to 6-digit codes and sends a test
   e-mail. Until then Supabase only e-mails the project's own team, so other
   people can't get a login code.
2. **Slip design** (optional). The built-in design is final-quality; a custom
   PDF can be uploaded in Ajustes → Comprovante, with field positions in
   `settings.slip_layout` (see `functions/_shared/slip.ts`).
3. **Custom domain** (optional). Ask the school's IT for a CNAME such as
   `prumo.autonomia.com.br → terminalwolf99.github.io`, then set it in the repo's
   Pages settings and update `site_url` in `config.toml` + the `APP_URL` secret.
   Don't add a CNAME file before the DNS exists, or the site goes dark.
4. **Hand over** the Supabase organization and the GitHub repo to the school.

## Commands

```bash
# local preview (the app talks to the real Supabase project)
python3 -m http.server 5500 --directory web

# backend changes
supabase db push --linked
supabase functions deploy mailer slip --project-ref qvusibdisuvwsfflyazq --use-api

# check every rule end to end (changes nothing)
supabase db query --linked -f supabase/tests/flows.sql
```

`scripts/make-icons.ps1` redraws the app icons; GitHub Pages republishes `web/`
on every push to `main`.
