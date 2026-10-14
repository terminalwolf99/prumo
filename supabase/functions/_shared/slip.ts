// The confirmation slip. Every student gets the same PDF; only the stamped
// fields change. With an uploaded template (private.slip_template) the fields
// are stamped where settings.slip_layout says; without one, a built-in
// placeholder design is drawn so the pipeline works before the final design exists.
import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from 'npm:pdf-lib@1.17.1'
import { brtDate, brtTimeMs } from './brt.ts'
import type { SlipData } from './db.ts'

type FieldKey = 'name' | 'class' | 'course' | 'round' | 'schedule' | 'code' | 'applied_at'
type FieldStyle = {
  x: number; y: number; page?: number
  size?: number; minSize?: number; maxWidth?: number
  align?: 'left' | 'center' | 'right'
  color?: string; bold?: boolean
}
type Layout = { fields?: Partial<Record<FieldKey, FieldStyle>> }

const INK = rgb(0.09, 0.13, 0.16)
const MUTED = rgb(0.38, 0.44, 0.48)
const SEA = rgb(0.02, 0.33, 0.38)
const SAND = rgb(0.96, 0.93, 0.87)

function hex(c?: string) {
  if (!c || !/^#?[0-9a-f]{6}$/i.test(c)) return INK
  const n = parseInt(c.replace('#', ''), 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

// Standard PDF fonts only cover Latin-1 (fine for Portuguese); swap anything else.
function safe(font: PDFFont, text: string) {
  const ok = new Set(font.getCharacterSet())
  return [...text.normalize('NFC')].map((ch) => (ok.has(ch.codePointAt(0)!) ? ch : '?')).join('')
}

// Shrink the text until it fits the box; long names stay on one line.
function fit(font: PDFFont, text: string, size: number, maxWidth: number, minSize = 9) {
  let s = size
  while (s > minSize && font.widthOfTextAtSize(text, s) > maxWidth) s -= 0.5
  return s
}

function stamp(page: PDFPage, font: PDFFont, text: string, f: FieldStyle) {
  const t = safe(font, text)
  const maxWidth = f.maxWidth ?? page.getWidth() - 2 * 40
  const size = fit(font, t, f.size ?? 14, maxWidth, f.minSize)
  const w = font.widthOfTextAtSize(t, size)
  const x = f.align === 'center' ? f.x - w / 2 : f.align === 'right' ? f.x - w : f.x
  page.drawText(t, { x, y: f.y, size, font, color: hex(f.color) })
}

function fieldValues(d: SlipData): Record<FieldKey, string> {
  return {
    name: d.full_name,
    class: d.class_name ?? (d.grade ? `${d.grade}º ano` : ''),
    course: d.course_title,
    round: d.round_title,
    schedule: d.schedule ?? '',
    code: formatCode(d.code),
    applied_at: `${brtDate(d.applied_at)} às ${brtTimeMs(d.applied_at)}`,
  }
}

export function formatCode(code: string) {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code
}

async function fromTemplate(template: Uint8Array, layout: Layout, d: SlipData) {
  const doc = await PDFDocument.load(template)
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const first = doc.getPage(0)
  const fields = layout.fields && Object.keys(layout.fields).length
    ? layout.fields
    : { name: { x: first.getWidth() / 2, y: first.getHeight() / 2, size: 28, align: 'center', bold: true } as FieldStyle }
  const values = fieldValues(d)
  for (const [key, style] of Object.entries(fields) as [FieldKey, FieldStyle][]) {
    const value = values[key]
    if (!value || !style) continue
    const page = doc.getPage(Math.min(style.page ?? 0, doc.getPageCount() - 1))
    stamp(page, style.bold ? bold : regular, value, style)
  }
  return doc
}

// Placeholder design, A4 portrait, until the real template is uploaded.
async function builtIn(d: SlipData) {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595.28, 841.89])
  const W = page.getWidth()
  const H = page.getHeight()
  const M = 56
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const v = fieldValues(d)
  const text = (t: string, x: number, y: number, size: number, font = regular, color = INK) =>
    page.drawText(safe(font, t), { x, y, size, font, color })

  page.drawRectangle({ x: 0, y: H - 150, width: W, height: 150, color: SEA })
  text(safe(bold, d.school_name.toUpperCase()), M, H - 70, 11, bold, rgb(1, 1, 1))
  text('Comprovante de inscrição', M, H - 104, 26, bold, rgb(1, 1, 1))
  text(d.round_title, M, H - 128, 12, regular, rgb(0.82, 0.92, 0.93))

  let y = H - 210
  text('ESTUDANTE', M, y, 9, bold, MUTED)
  y -= 34
  page.drawText(safe(bold, v.name), { x: M, y, size: fit(bold, safe(bold, v.name), 30, W - 2 * M, 14), font: bold, color: INK })
  if (v.class) { y -= 22; text(v.class, M, y, 13, regular, MUTED) }

  y -= 48
  page.drawRectangle({ x: M - 16, y: y - 132, width: W - 2 * M + 32, height: 160, color: SAND })
  text('DISCIPLINA', M, y, 9, bold, MUTED)
  y -= 30
  page.drawText(safe(bold, v.course), { x: M, y, size: fit(bold, safe(bold, v.course), 22, W - 2 * M, 12), font: bold, color: SEA })
  const rows: [string, string | null][] = [
    ['Área', d.course_area], ['Professor(a)', d.teacher_names], ['Horário', d.schedule], ['Local', d.location],
  ]
  for (const [label, value] of rows) {
    if (!value) continue
    y -= 22
    text(label, M, y, 11, bold, INK)
    text(value, M + 100, y, 11)
  }

  y = Math.min(y, H - 520) - 60
  text('INSCRIÇÃO REGISTRADA EM', M, y, 9, bold, MUTED)
  text('CÓDIGO', W / 2 + 20, y, 9, bold, MUTED)
  y -= 24
  text(brtDate(d.applied_at), M, y, 16, bold)
  text(v.code, W / 2 + 20, y, 16, bold)
  y -= 20
  text(`${brtTimeMs(d.applied_at)} · horário de Brasília`, M, y, 11, regular, MUTED)

  if (d.confirmed_at && new Date(d.confirmed_at).getTime() - new Date(d.applied_at).getTime() > 1000) {
    y -= 30
    text(`Vaga liberada da lista de espera em ${brtDate(d.confirmed_at)} às ${brtTimeMs(d.confirmed_at)}.`, M, y, 11, regular, INK)
  }

  page.drawLine({ start: { x: M, y: 90 }, end: { x: W - M, y: 90 }, thickness: 0.6, color: MUTED })
  text('Vaga confirmada por ordem de chegada. Guarde este comprovante.', M, 70, 10, regular, MUTED)
  text(`${d.school_name} · Florianópolis/SC`, M, 54, 10, regular, MUTED)
  return doc
}

export async function renderSlip(d: SlipData, template: Uint8Array | null): Promise<Uint8Array> {
  const doc = template ? await fromTemplate(template, (d.slip_layout ?? {}) as Layout, d) : await builtIn(d)
  doc.setTitle(`Comprovante ${formatCode(d.code)} — ${d.course_title}`)
  doc.setAuthor(d.school_name)
  doc.setCreationDate(new Date())
  return await doc.save()
}

export function slipFilename(d: SlipData) {
  const slug = d.course_title.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40)
  return `comprovante-${slug || 'inscricao'}-${d.code}.pdf`
}
