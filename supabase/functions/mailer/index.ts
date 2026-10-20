// Sends whatever is waiting in public.email_outbox. Woken by the database
// (pg_net, right after a commit, plus a once-a-minute retry sweep) with a
// shared secret; never called by browsers.
import nodemailer from 'npm:nodemailer@10.0.12'
import { Buffer } from 'node:buffer'
import { loadEnrollment, loadTemplate, sql } from '../_shared/db.ts'
import { compose, type Kind, WITH_SLIP } from '../_shared/emails.ts'
import { json, sameSecret } from '../_shared/http.ts'
import { renderSlip, slipFilename } from '../_shared/slip.ts'

type Sender = { from: string; transport: ReturnType<typeof nodemailer.createTransport> }

// SMTP_* is the main sender (the school's); SMTP_FALLBACK_* is tried when it fails (Gmail).
// Supabase blocks outgoing ports 25 and 587, so use 465 (implicit TLS).
function sender(prefix: string): Sender | null {
  const host = Deno.env.get(`${prefix}_HOST`)
  const user = Deno.env.get(`${prefix}_USER`)
  const pass = Deno.env.get(`${prefix}_PASS`)
  if (!host || !user || !pass) return null
  const port = Number(Deno.env.get(`${prefix}_PORT`) ?? 465)
  return {
    from: Deno.env.get(`${prefix}_FROM`) ?? user,
    // one pooled connection: sends go out one after another on the same login,
    // which is what Gmail tolerates (it throttles many parallel logins)
    transport: nodemailer.createTransport({
      host, port, secure: port === 465, auth: { user, pass }, pool: true, maxConnections: 1,
      connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
    }),
  }
}

const senders = [sender('SMTP'), sender('SMTP_FALLBACK')].filter((s): s is Sender => s !== null)
const APP_URL = Deno.env.get('APP_URL') ?? 'http://localhost:5500'

async function send(message: Record<string, unknown>) {
  let lastError: unknown
  for (const s of senders) {
    try {
      await s.transport.sendMail({ ...message, from: s.from })
      return
    } catch (e) {
      lastError = e
      console.error(`send via ${s.from} failed:`, e instanceof Error ? e.message : e)
    }
  }
  throw lastError
}

type Job = { id: number; kind: Kind; enrollment_id: string; attempts: number }

// Only one drain at a time across all invocations (a burst of sign-ups wakes the
// mailer once per commit); the others return at once and the running drain,
// which loops until the queue is empty, picks their rows up.
const DRAIN_LOCK = 764212

// The lock lives in an open transaction (safe behind a connection pooler too);
// the drain itself runs on other connections and ends the transaction when done.
async function drainOnce(): Promise<boolean> {
  let ran = false
  await sql.begin(async (tx) => {
    const [{ ok }] = await tx`select pg_try_advisory_xact_lock(${DRAIN_LOCK}) as ok`
    if (!ok) return
    await drain()
    ran = true
  })
  return ran
}

// After letting go of the lock, look once more: a row may have landed right
// as the last drain finished, while its own wake-up found the lock taken.
async function drainAll() {
  if (!(await drainOnce())) return
  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from public.email_outbox
     where sent_at is null and attempts < 6 and (locked_until is null or locked_until < now())`
  if (n > 0) await drainOnce()
}

async function drain() {
  const deadline = Date.now() + 100_000
  let template: Uint8Array | null | undefined
  while (Date.now() < deadline) {
    const jobs = await sql<Job[]>`select * from private.mailer_claim(5)`
    if (!jobs.length) return
    for (const job of jobs) {
      try {
        const d = await loadEnrollment(job.enrollment_id)
        if (!d) {
          await sql`update public.email_outbox set sent_at = now(), last_error = 'enrollment gone' where id = ${job.id}`
          continue
        }
        const { subject, html, text } = compose(job.kind, d, APP_URL)
        const attachments = []
        if (WITH_SLIP.includes(job.kind)) {
          if (template === undefined) template = await loadTemplate()
          const pdf = await renderSlip(d, template, APP_URL)
          attachments.push({ filename: slipFilename(d), content: Buffer.from(pdf), contentType: 'application/pdf' })
        }
        await send({ to: { name: d.full_name, address: d.email }, subject, html, text, attachments })
        await sql`update public.email_outbox set sent_at = now(), last_error = null where id = ${job.id}`
      } catch (e) {
        const message = (e instanceof Error ? e.message : String(e)).slice(0, 500)
        await sql`update public.email_outbox set last_error = ${message} where id = ${job.id}`
      }
    }
  }
}

// Fake test people (@teste.invalid) never get mail: their rows are closed
// straight away, so turning the sender on later sends nothing to them.
async function closeTestAddresses() {
  await sql`
    update public.email_outbox o
       set sent_at = now(), last_error = 'endereço de teste: não enviado'
      from public.enrollments e
      join public.people p on p.id = e.person_id
     where o.enrollment_id = e.id and o.sent_at is null and p.email like '%.invalid'`
}

async function recordState() {
  await sql`
    insert into private.mailer_state (configured, checked_at) values (${senders.length > 0}, now())
    on conflict (id) do update set configured = excluded.configured, checked_at = excluded.checked_at`
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  if (!(await sameSecret(req.headers.get('x-mailer-secret'), Deno.env.get('MAILER_SECRET')))) {
    return json({ error: 'unauthorized' }, 401)
  }
  await recordState()
  await closeTestAddresses()

  // {"test_to": "..."}: the setup script checks the sender with one real e-mail.
  const body = await req.json().catch(() => ({}))
  if (typeof body.test_to === 'string') {
    if (!senders.length) return json({ ok: false, error: 'smtp_not_configured' }, 503)
    try {
      await send({
        to: body.test_to,
        subject: 'Prumo: teste de envio',
        text: 'Se esta mensagem chegou, o Prumo já consegue enviar códigos de acesso e comprovantes.',
      })
      return json({ ok: true })
    } catch (e) {
      return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 502)
    }
  }

  // Without a sender, leave the queue untouched so nothing burns its retries.
  if (!senders.length) return json({ skipped: 'smtp_not_configured' }, 503)
  EdgeRuntime.waitUntil(drainAll().catch((e) => console.error('drain failed:', e)))
  return json({ ok: true }, 202)
})
