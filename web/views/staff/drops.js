import { html, useCallback, useEffect, useState } from '../../lib/deps.js'
import { friendly, must, rpc, sb, watch } from '../../lib/db.js'
import { fmtWhen } from '../../lib/time.js'
import { ask, Empty, toast } from '../../lib/ui.js'

export function DropsTab() {
  const [rows, setRows] = useState(null)
  const load = useCallback(async () => {
    try {
      setRows(await must(sb.from('enrollments')
        .select('id, applied_at, drop_reason, drop_requested_at, person:people!enrollments_person_id_fkey(full_name, email, class_name), course:courses(title, waitlist_count), round:rounds(title)')
        .eq('status', 'drop_requested').order('drop_requested_at')))
    } catch (e) { toast(friendly(e), 'error') }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => watch('staff-drops-list', ['enrollments'], load), [load])

  async function resolve(r, approve) {
    const a = await ask({
      title: approve ? 'Aprovar desistência' : 'Negar desistência',
      body: approve
        ? `${r.person.full_name} sai de “${r.course.title}”.${r.course.waitlist_count ? ' A vaga vai para a próxima pessoa da lista de espera.' : ''}`
        : `${r.person.full_name} continua com a vaga em “${r.course.title}”.`,
      input: { label: 'Observação para o estudante (opcional)' },
      confirm: approve ? 'Aprovar' : 'Negar', danger: approve,
    })
    if (!a.ok) return
    try {
      await rpc('resolve_drop', { p_enrollment_id: r.id, p_approve: approve, p_note: a.value || null })
      toast(approve ? 'Desistência aprovada.' : 'Desistência negada.', 'ok')
    } catch (e) { toast(friendly(e), 'error') }
    load()
  }

  if (!rows) return html`<div class="skeleton"></div>`
  return html`<section>
    <div class="section-head"><h1 class="h2">Pedidos de desistência</h1></div>
    <p class="muted">Enquanto o pedido está aqui, o estudante continua com a vaga. Aprovar libera a vaga para a lista de espera, e o estudante recebe um e-mail.</p>
    ${rows.length === 0 && html`<${Empty} title="Nenhum pedido pendente." />`}
    <div class="drop-list">
      ${rows.map((r) => html`<article key=${r.id} class="card drop">
        <div>
          <b>${r.person.full_name}</b> <span class="muted small">${[r.person.class_name, r.person.email].filter(Boolean).join(' · ')}</span>
          <p><span class="muted">${r.round.title} ·</span> <b>${r.course.title}</b></p>
          <blockquote>${r.drop_reason}</blockquote>
          <p class="muted small">Pedido em ${fmtWhen(r.drop_requested_at)} · inscrito desde ${fmtWhen(r.applied_at)}</p>
        </div>
        <div class="row">
          <button class="btn ghost" onClick=${() => resolve(r, false)}>Negar</button>
          <button class="btn primary" onClick=${() => resolve(r, true)}>Aprovar</button>
        </div>
      </article>`)}
    </div>
  </section>`
}
