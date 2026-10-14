import { html, useCallback, useEffect, useState } from '../../lib/deps.js'
import { sb, watch } from '../../lib/db.js'
import { Topbar } from '../../lib/ui.js'
import { Student } from '../student.js'
import { DropsTab } from './drops.js'
import { PeopleTab } from './people.js'
import { RoundsTab } from './rounds.js'
import { SettingsTab } from './settings.js'

const TABS = [
  { id: 'rodadas', label: 'Rodadas' },
  { id: 'desistencias', label: 'Desistências' },
  { id: 'estudantes', label: 'Estudantes' },
  { id: 'equipe', label: 'Equipe', admin: true },
  { id: 'ajustes', label: 'Ajustes' },
]

function useHashTab() {
  const read = () => location.hash.replace(/^#\/?/, '').split('/')[0] || 'rodadas'
  const [tab, setTab] = useState(read)
  useEffect(() => {
    const on = () => setTab(read())
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return [tab, (t) => { location.hash = `#/${t}` }]
}

export function Staff({ me }) {
  const [tab, go] = useHashTab()
  const [drops, setDrops] = useState(0)
  const tabs = TABS.filter((t) => !t.admin || me.role === 'admin')
  const current = tabs.find((t) => t.id === tab)?.id ?? 'rodadas'

  const countDrops = useCallback(async () => {
    const { count } = await sb.from('enrollments').select('id', { count: 'exact', head: true }).eq('status', 'drop_requested')
    setDrops(count ?? 0)
  }, [])
  useEffect(() => { countDrops() }, [countDrops])
  useEffect(() => watch('staff-drops', ['enrollments'], countDrops, 800), [countDrops])

  // "Ver como estudante": the real student screen, for a chosen year, read-only.
  const [asGrade, setAsGrade] = useState(0)
  if (asGrade) {
    return html`<${Student} me=${{ ...me, role: 'student', grade: asGrade, class_name: null }}
      bar=${html`<${PreviewBar} grade=${asGrade} setGrade=${setAsGrade} onExit=${() => setAsGrade(0)} />`} />`
  }

  return html`<${Topbar} me=${me}>
      <nav class="tabs" aria-label="Painel">
        ${tabs.map((t) => html`<a key=${t.id} href=${`#/${t.id}`} class="tab ${current === t.id ? 'on' : ''}"
          aria-current=${current === t.id ? 'page' : null}>
          ${t.label}${t.id === 'desistencias' && drops > 0 && html`<span class="badge">${drops}</span>`}
        </a>`)}
      </nav>
      <button class="btn ghost sm view-as" onClick=${() => setAsGrade(2)}>Ver como estudante</button>
    <//>
    <main class="page wide">
      ${current === 'rodadas' && html`<${RoundsTab} me=${me} />`}
      ${current === 'desistencias' && html`<${DropsTab} />`}
      ${current === 'estudantes' && html`<${PeopleTab} me=${me} kind="students" />`}
      ${current === 'equipe' && html`<${PeopleTab} me=${me} kind="team" />`}
      ${current === 'ajustes' && html`<${SettingsTab} me=${me} go=${go} />`}
    </main>`
}

function PreviewBar({ grade, setGrade, onExit }) {
  return html`<header class="topbar preview-bar">
    <span class="preview-tag">Prévia</span>
    <label class="preview-text">Vendo como estudante do
      <select value=${grade} onChange=${(e) => setGrade(Number(e.target.value))}>
        <option value="1">1º ano</option><option value="2">2º ano</option><option value="3">3º ano</option>
      </select>
    </label>
    <span class="preview-note">nada é registrado</span>
    <button class="btn primary sm" onClick=${onExit}>Voltar ao painel</button>
  </header>`
}
