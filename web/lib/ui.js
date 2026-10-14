import { html, useEffect, useRef, useState } from './deps.js'
import { serverNow, splitMs } from './time.js'
import { sb } from './db.js'

// ---------------------------------------------------------------- toasts

let toastSeq = 0
let toastList = []
const toastSubs = new Set()
const emitToasts = () => toastSubs.forEach((fn) => fn(toastList))

export function toast(text, kind = 'info') {
  const id = ++toastSeq
  toastList = [...toastList, { id, text, kind }]
  emitToasts()
  setTimeout(() => {
    toastList = toastList.filter((t) => t.id !== id)
    emitToasts()
  }, kind === 'error' ? 6500 : 3800)
}

export function Toasts() {
  const [list, setList] = useState(toastList)
  useEffect(() => {
    toastSubs.add(setList)
    return () => toastSubs.delete(setList)
  }, [])
  return html`<div class="toasts" role="status" aria-live="polite">
    ${list.map((t) => html`<div key=${t.id} class="toast ${t.kind}">${t.text}</div>`)}
  </div>`
}

// ---------------------------------------------------------------- clock

// Re-renders on each server-clock second, so every open tab flips at the same instant.
export function useNow(step = 1000) {
  const [now, setNow] = useState(serverNow())
  useEffect(() => {
    let id
    const tick = () => {
      setNow(serverNow())
      id = setTimeout(tick, step - (serverNow() % step) + 5)
    }
    tick()
    return () => clearTimeout(id)
  }, [step])
  return now
}

export function Countdown({ to, now }) {
  const p = splitMs(new Date(to).getTime() - now)
  const pad = (n) => String(n).padStart(2, '0')
  const units = [['d', p.d === 1 ? 'dia' : 'dias'], ['h', 'horas'], ['m', 'min'], ['s', 'seg']]
    .filter(([k]) => k !== 'd' || p.d > 0)
  const spoken = `${p.d ? `${p.d} dias, ` : ''}${p.h} horas, ${p.m} minutos e ${p.s} segundos`
  return html`<div class="countdown" role="timer" aria-label=${spoken}>
    ${units.map(([k, label]) => html`<div class="cd-unit" key=${k}>
      <span class="cd-num">${pad(p[k])}</span><span class="cd-label">${label}</span>
    </div>`)}
  </div>`
}

// ---------------------------------------------------------------- modal + ask()

export function Modal({ open, onClose, title, wide, children }) {
  const ref = useRef()
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return html`<dialog ref=${ref} class="modal ${wide ? 'wide' : ''}"
      onCancel=${(e) => { e.preventDefault(); onClose?.() }}
      onClick=${(e) => e.target === ref.current && onClose?.()}>
    ${open && html`<div class="modal-inner">
      <header class="modal-head">
        <h2>${title}</h2>
        <button class="icon-btn" aria-label="Fechar" onClick=${onClose}>✕</button>
      </header>
      <div class="modal-body">${children}</div>
    </div>`}
  </dialog>`
}

let askCurrent = null
const askSubs = new Set()

// await ask({ title, body, confirm, danger, input: { label, placeholder, required } }) → { ok, value }
export function ask(options) {
  return new Promise((resolve) => {
    askCurrent = { ...options, resolve }
    askSubs.forEach((fn) => fn(askCurrent))
  })
}

export function Asker() {
  const [state, setState] = useState(null)
  const [value, setValue] = useState('')
  useEffect(() => {
    const fn = (s) => { setState(s); setValue('') }
    askSubs.add(fn)
    return () => askSubs.delete(fn)
  }, [])
  const done = (ok) => {
    const s = state
    if (!s) return
    setState(null)
    askCurrent = null
    s.resolve({ ok, value: value.trim() })
  }
  const blocked = state?.input?.required && value.trim().length < 3
  return html`<${Modal} open=${!!state} onClose=${() => done(false)} title=${state?.title ?? ''}>
    ${state && html`<div class="ask">
      ${state.body && html`<p class="ask-body">${state.body}</p>`}
      ${state.input && html`<${Field} label=${state.input.label}>
        <textarea rows="3" value=${value} placeholder=${state.input.placeholder ?? ''}
          onInput=${(e) => setValue(e.target.value)}></textarea>
      <//>`}
      <div class="row end">
        <button class="btn ghost" onClick=${() => done(false)}>${state.cancel ?? 'Voltar'}</button>
        <button class="btn ${state.danger ? 'danger' : 'primary'}" disabled=${blocked} onClick=${() => done(true)}>
          ${state.confirm ?? 'Confirmar'}
        </button>
      </div>
    </div>`}
  <//>`
}

// ---------------------------------------------------------------- small pieces

export function Btn({ busy, kind = 'primary', children, class: cls = '', ...rest }) {
  return html`<button ...${rest} class="btn ${kind} ${cls}" disabled=${busy || rest.disabled}>
    ${busy && html`<span class="spin" aria-hidden="true"></span>`}<span>${children}</span>
  </button>`
}

export function Field({ label, hint, children, class: cls = '' }) {
  return html`<label class="field ${cls}">
    <span class="field-label">${label}</span>
    ${children}
    ${hint && html`<span class="field-hint">${hint}</span>`}
  </label>`
}

export function Wordmark({ small }) {
  return html`<span class="wordmark ${small ? 'small' : ''}">autonomia<span class="dot">.</span></span>`
}

export function Topbar({ me, children }) {
  const roleLabel = { admin: 'Administração', teacher: 'Professor(a)', student: me.class_name || (me.grade ? `${me.grade}º ano` : 'Estudante') }[me.role]
  return html`<header class="topbar">
    <a class="brand" href="#/"><${Wordmark} small /></a>
    <div class="topbar-mid">${children}</div>
    <div class="who">
      <div class="who-text"><b>${me.full_name.split(' ')[0]}</b><span>${roleLabel}</span></div>
      <button class="btn ghost sm" onClick=${() => sb.auth.signOut()}>Sair</button>
    </div>
  </header>`
}

const STATUS = {
  confirmed: ['Vaga confirmada', 'ok'],
  waitlisted: ['Lista de espera', 'wait'],
  drop_requested: ['Desistência em análise', 'pending'],
  dropped: ['Desistência aprovada', 'off'],
  removed: ['Removida pela coordenação', 'off'],
  left_waitlist: ['Saiu da lista de espera', 'off'],
}

export function StatusChip({ status, position }) {
  const [label, kind] = STATUS[status] ?? [status, 'off']
  return html`<span class="chip ${kind}">${label}${status === 'waitlisted' && position ? html` · <b>${position}º</b>` : null}</span>`
}

export function SeatMeter({ capacity, taken, waiting, compact }) {
  const free = Math.max(capacity - taken, 0)
  const state = free === 0 ? 'full' : free <= Math.max(2, Math.ceil(capacity * 0.15)) ? 'low' : ''
  const label = free > 0
    ? `${free} ${free === 1 ? 'vaga livre' : 'vagas livres'} de ${capacity}`
    : `Esgotado${waiting ? ` · ${waiting} na lista de espera` : ''}`
  return html`<div class="seats ${state} ${compact ? 'compact' : ''}">
    ${!compact && capacity > 0 && capacity <= 60
      ? html`<div class="seat-dots" aria-hidden="true">
          ${Array.from({ length: capacity }, (_, i) => html`<i class=${i < taken ? 'on' : ''}></i>`)}
        </div>`
      : html`<div class="seat-bar" aria-hidden="true">
          <i style=${`width:${capacity ? Math.min(100, (taken / capacity) * 100) : 100}%`}></i>
        </div>`}
    <div class="seat-label">${label}</div>
  </div>`
}

export const AREAS = [
  'Linguagens e suas Tecnologias',
  'Matemática e suas Tecnologias',
  'Ciências da Natureza e suas Tecnologias',
  'Ciências Humanas e Sociais Aplicadas',
  'Formação Técnica e Profissional',
]

export function areaClass(area = '') {
  const a = (area ?? '').toLowerCase()
  if (a.includes('lingua')) return 'a-ling'
  if (a.includes('matem')) return 'a-mat'
  if (a.includes('natur')) return 'a-nat'
  if (a.includes('human') || a.includes('soci')) return 'a-hum'
  if (a.includes('técn') || a.includes('tecn') || a.includes('prof')) return 'a-tec'
  return 'a-gen'
}

export function gradesLabel(grades) {
  const g = [...grades].sort()
  if (g.length === 1) return `${g[0]}º ano`
  return `${g.slice(0, -1).map((x) => `${x}º`).join(', ')} e ${g.at(-1)}º ano`
}

export function formatCode(code = '') {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code
}

export function Empty({ title, children }) {
  return html`<div class="empty"><b>${title}</b>${children && html`<p>${children}</p>`}</div>`
}
