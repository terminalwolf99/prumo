// The confirmation slip. Every student gets the same document; only the
// stamped fields change (name, subject, arrival time, code, QR). With an
// uploaded template (private.slip_template) the fields are stamped where
// settings.slip_layout says; otherwise the built-in design below is drawn.
import { degrees, PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from 'npm:pdf-lib@1.17.1'
import qrcode from 'npm:qrcode-generator@2.0.4'
import { brtDate, brtStamp, brtTimeMs } from './brt.ts'
import type { SlipData } from './db.ts'
import { LOGO_PNG_BASE64, LOGO_SIZE } from './logo.ts'

type FieldKey = 'name' | 'class' | 'course' | 'round' | 'schedule' | 'code' | 'applied_at' | 'qr'
type FieldStyle = {
  x: number; y: number; page?: number
  size?: number; minSize?: number; maxWidth?: number
  align?: 'left' | 'center' | 'right'
  color?: string; bold?: boolean
}
type Layout = { fields?: Partial<Record<FieldKey, FieldStyle>> }

const INK = rgb(0.09, 0.13, 0.16)
const MUTED = rgb(0.4, 0.45, 0.5)
const BRAND = rgb(0, 0.208, 0.51) // school navy #003582
const CARD = rgb(0.945, 0.953, 0.976)
const RULE = rgb(0.82, 0.85, 0.9)
const OK = rgb(0.118, 0.49, 0.322)
const OK_SOFT = rgb(0.86, 0.94, 0.89)

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

// QR with the standard 4-module quiet zone; (x, y) is its lower-left corner.
function drawQr(page: PDFPage, text: string, x: number, y: number, size: number) {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const n = qr.getModuleCount()
  const cell = size / (n + 8)
  page.drawRectangle({ x, y, width: size, height: size, color: rgb(1, 1, 1) })
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue
      page.drawRectangle({ x: x + (c + 4) * cell, y: y + size - (r + 5) * cell, width: cell + 0.05, height: cell + 0.05, color: INK })
    }
  }
}

export function formatCode(code: string) {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code
}

export function verifyUrl(appUrl: string, code: string) {
  return `${appUrl.replace(/#.*$/, '').replace(/\/?$/, '/')}#/verificar/${formatCode(code)}`
}

function fieldValues(d: SlipData): Record<Exclude<FieldKey, 'qr'>, string> {
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

async function fromTemplate(template: Uint8Array, layout: Layout, d: SlipData, appUrl: string) {
  const doc = await PDFDocument.load(template)
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const first = doc.getPage(0)
  const fields = layout.fields && Object.keys(layout.fields).length
    ? layout.fields
    : { name: { x: first.getWidth() / 2, y: first.getHeight() / 2, size: 28, align: 'center', bold: true } as FieldStyle }
  const values = fieldValues(d)
  for (const [key, style] of Object.entries(fields) as [FieldKey, FieldStyle][]) {
    if (!style) continue
    const page = doc.getPage(Math.min(style.page ?? 0, doc.getPageCount() - 1))
    if (key === 'qr') {
      drawQr(page, verifyUrl(appUrl, d.code), style.x, style.y, style.size ?? 96)
      continue
    }
    const value = values[key]
    if (value) stamp(page, style.bold ? bold : regular, value, style)
  }
  return doc
}

// The default design, A4 portrait.
async function builtIn(d: SlipData, appUrl: string) {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595.28, 841.89])
  const W = page.getWidth()
  const H = page.getHeight()
  const M = 56
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const mono = await doc.embedFont(StandardFonts.CourierBold)
  const logo = await doc.embedPng(Uint8Array.from(atob(LOGO_PNG_BASE64), (c) => c.charCodeAt(0)))
  const v = fieldValues(d)
  const text = (t: string, x: number, y: number, size: number, font = regular, color = INK) =>
    page.drawText(safe(font, t), { x, y, size, font, color })
  const right = (t: string, xr: number, y: number, size: number, font = regular, color = INK) => {
    const s = safe(font, t)
    page.drawText(s, { x: xr - font.widthOfTextAtSize(s, size), y, size, font, color })
  }

  if (d.is_test) {
    page.drawText('TESTE', { x: 120, y: 300, size: 150, font: bold, color: rgb(0.85, 0.2, 0.2), opacity: 0.07, rotate: degrees(35) })
  }

  // header: school logo, document name, round
  const lw = 172
  const lh = lw * LOGO_SIZE.height / LOGO_SIZE.width
  page.drawImage(logo, { x: M, y: H - 52 - lh, width: lw, height: lh })
  right('COMPROVANTE DE INSCRIÇÃO', W - M, H - 72, 9.5, bold, BRAND)
  const roundSize = fit(regular, safe(regular, d.round_title), 11, 250, 8)
  right(d.round_title, W - M, H - 90, roundSize, regular, MUTED)
  page.drawLine({ start: { x: M, y: H - 124 }, end: { x: W - M, y: H - 124 }, thickness: 1.2, color: BRAND })

  // status pill
  const promoted = d.confirmed_at && new Date(d.confirmed_at).getTime() - new Date(d.applied_at).getTime() > 1000
  const pill = d.is_test ? 'INSCRIÇÃO DE TESTE' : promoted ? 'VAGA CONFIRMADA · DA LISTA DE ESPERA' : 'VAGA CONFIRMADA'
  const pw = bold.widthOfTextAtSize(pill, 9) + 24
  page.drawRectangle({ x: M, y: H - 172, width: pw, height: 22, color: d.is_test ? rgb(0.99, 0.9, 0.88) : OK_SOFT })
  text(pill, M + 12, H - 164, 9, bold, d.is_test ? rgb(0.75, 0.2, 0.15) : OK)

  // student
  text('ESTUDANTE', M, H - 210, 8.5, bold, MUTED)
  const name = safe(bold, v.name)
  page.drawText(name, { x: M, y: H - 244, size: fit(bold, name, 30, W - 2 * M, 14), font: bold, color: INK })
  if (v.class) text(v.class, M, H - 266, 12, regular, MUTED)

  // subject card
  const rows: [string, string | null][] = [
    ['Área', d.course_area], ['Professor(a)', d.teacher_names], ['Horário', d.schedule], ['Local', d.location],
  ]
  const shown = rows.filter(([, value]) => value)
  const cardTop = H - 300
  const cardH = 92 + shown.length * 20
  page.drawRectangle({ x: M, y: cardTop - cardH, width: W - 2 * M, height: cardH, color: CARD })
  page.drawRectangle({ x: M, y: cardTop - cardH, width: 4, height: cardH, color: BRAND })
  text('DISCIPLINA', M + 22, cardTop - 26, 8.5, bold, MUTED)
  const course = safe(bold, v.course)
  page.drawText(course, { x: M + 22, y: cardTop - 56, size: fit(bold, course, 22, W - 2 * M - 44, 12), font: bold, color: BRAND })
  let y = cardTop - 84
  for (const [label, value] of shown) {
    text(label, M + 22, y, 10.5, bold, INK)
    const val = safe(regular, value!)
    page.drawText(val, { x: M + 122, y, size: fit(regular, val, 10.5, W - 2 * M - 144, 8), font: regular, color: INK })
    y -= 20
  }

  // arrival time + code (left), verification QR (right)
  const qrSize = 124
  const qrX = W - M - qrSize
  // sits a steady gap under the subject card, never into the footer
  const baseY = Math.max(96, cardTop - cardH - 230)
  text('INSCRIÇÃO REGISTRADA EM', M, baseY + 150, 8.5, bold, MUTED)
  text(brtDate(d.applied_at), M, baseY + 124, 20, bold, INK)
  text(`às ${brtTimeMs(d.applied_at)} · horário de Brasília`, M, baseY + 104, 11, regular, MUTED)
  if (promoted) text(`Vaga liberada da lista de espera em ${brtStamp(d.confirmed_at!)}.`, M, baseY + 84, 9.5, regular, INK)
  text('CÓDIGO', M, baseY + 50, 8.5, bold, MUTED)
  text(v.code, M, baseY + 22, 24, mono, INK)

  drawQr(page, verifyUrl(appUrl, d.code), qrX, baseY + 20, qrSize)
  const site = appUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const cx = qrX + qrSize / 2
  const cap1 = 'Confira a autenticidade'
  page.drawText(cap1, { x: cx - regular.widthOfTextAtSize(cap1, 8.5) / 2, y: baseY + 8, size: 8.5, font: regular, color: MUTED })
  const cap2 = safe(regular, site)
  const cap2Size = fit(regular, cap2, 8, qrSize + 40, 6)
  page.drawText(cap2, { x: cx - regular.widthOfTextAtSize(cap2, cap2Size) / 2, y: baseY - 4, size: cap2Size, font: regular, color: MUTED })

  // footer
  page.drawLine({ start: { x: M, y: 74 }, end: { x: W - M, y: 74 }, thickness: 0.6, color: RULE })
  text(`Prumo · ${d.school_name} · Florianópolis/SC`, M, 56, 9, regular, MUTED)
  right(`Emitido em ${brtStamp(new Date()).replace(/,\d{3}$/, '')}`, W - M, 56, 9, regular, MUTED)
  return doc
}

export async function renderSlip(d: SlipData, template: Uint8Array | null, appUrl: string): Promise<Uint8Array> {
  const doc = template ? await fromTemplate(template, (d.slip_layout ?? {}) as Layout, d, appUrl) : await builtIn(d, appUrl)
  doc.setTitle(`Comprovante ${formatCode(d.code)} · ${d.course_title}`)
  doc.setAuthor(d.school_name)
  doc.setCreator('Prumo')
  doc.setCreationDate(new Date())
  return await doc.save()
}

export function slipFilename(d: SlipData) {
  const slug = d.course_title.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40)
  return `comprovante-${slug || 'inscricao'}-${d.code}.pdf`
}
