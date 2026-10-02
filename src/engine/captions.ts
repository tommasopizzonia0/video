// Captions from word timings: words are grouped into short pages (1 to 4 words, the social style),
// each page shows while it is spoken and the word being said lights up. Pure functions, no drawing.

import type { CaptionWord, CaptionsLayer } from './types'

export interface CaptionPage {
  words: CaptionWord[]
  start: number
  end: number
}

/** A page stays at least this long so it can be read. */
const MIN_PAGE = 0.7
/** Gaps shorter than this are bridged, so captions never blink off for a few frames. */
const BRIDGE = 0.35

const clauseEnd = /[.,!?;:…]["»”’)]*$/

/** Groups words into pages: at most `maxWords` and `maxChars`, breaking after punctuation and at pauses. */
export function captionPages(words: CaptionWord[], maxWords = 3, maxChars = 22): CaptionPage[] {
  const sorted = words.filter((w) => w.text.trim()).slice().sort((a, b) => a.start - b.start)
  const groups: CaptionWord[][] = []
  let cur: CaptionWord[] = []
  let chars = 0
  for (const w of sorted) {
    const prev = cur[cur.length - 1]
    const len = w.text.trim().length
    const full = cur.length >= maxWords || (cur.length > 0 && chars + 1 + len > maxChars)
    const pause = prev && w.start - prev.end > 0.6
    if (cur.length && (full || pause || clauseEnd.test(prev.text.trim()))) {
      groups.push(cur)
      cur = []
      chars = 0
    }
    cur.push({ ...w, text: w.text.trim() })
    chars += (cur.length > 1 ? 1 : 0) + len
  }
  if (cur.length) groups.push(cur)
  const pages = groups.map((g) => ({ words: g, start: g[0].start, end: Math.max(...g.map((w) => w.end)) }))
  pages.forEach((p, i) => {
    const next = pages[i + 1]
    p.end = Math.max(p.end, p.start + MIN_PAGE)
    if (next) {
      if (next.start - p.end < BRIDGE) p.end = next.start
      p.end = Math.min(p.end, next.start)
    }
  })
  return pages
}

/** Index of the page visible at `t`, or -1. */
export function pageAt(pages: CaptionPage[], t: number): number {
  for (let i = 0; i < pages.length; i++) if (t >= pages[i].start && t < pages[i].end) return i
  return -1
}

const srtTime = (s: number) => {
  const ms = Math.max(0, Math.round(s * 1000))
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`
}

function parseSrtTime(s: string): number {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(s)
  if (!m) return NaN
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0').slice(0, 3)) / 1000
}

/**
 * Words from an SRT or WebVTT file. Subtitles have no word timings, so each cue's time is shared out
 * by word length: fine for display, but Whisper word timings are better when the voice matters.
 */
export function wordsFromSrt(text: string): CaptionWord[] {
  const out: CaptionWord[] = []
  for (const block of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((l) => l.trim())
    const ti = lines.findIndex((l) => l.includes('-->'))
    if (ti < 0) continue
    const [a, b] = lines[ti].split('-->')
    const start = parseSrtTime(a)
    const end = parseSrtTime(b)
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    const words = lines.slice(ti + 1).join(' ').replace(/<[^>]+>/g, '').split(/\s+/).filter(Boolean)
    const total = words.reduce((n, w) => n + w.length + 1, 0)
    let t = start
    for (const w of words) {
      const d = ((end - start) * (w.length + 1)) / total
      out.push({ text: w, start: t, end: t + d })
      t += d
    }
  }
  return out
}

/**
 * Words from JSON: a list of { text | word, start, end }, or Whisper / whisper.cpp output
 * ({ segments: [{ words: [...] }] } or { transcription: [{ tokens | words }] }).
 */
export function wordsFromJson(data: unknown): CaptionWord[] {
  const out: CaptionWord[] = []
  const take = (w: unknown) => {
    if (typeof w !== 'object' || w === null) return
    const o = w as Record<string, unknown>
    const text = typeof o.text === 'string' ? o.text : typeof o.word === 'string' ? o.word : null
    const start = Number(o.start ?? (o.offsets as Record<string, number> | undefined)?.from)
    const end = Number(o.end ?? (o.offsets as Record<string, number> | undefined)?.to)
    // whisper.cpp offsets are in milliseconds.
    const scale = o.offsets && o.start === undefined ? 0.001 : 1
    if (text !== null && /^\s*\[.*\]\s*$/.test(text)) return // whisper.cpp control tokens
    if (text !== null && Number.isFinite(start) && Number.isFinite(end)) out.push({ text, start: start * scale, end: end * scale })
  }
  const visit = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach((x) => (typeof x === 'object' && x && ('words' in x || 'tokens' in x) ? visit(x) : take(x)))
    if (typeof v !== 'object' || v === null) return
    const o = v as Record<string, unknown>
    if (Array.isArray(o.words)) return visit(o.words)
    if (Array.isArray(o.segments)) return visit(o.segments)
    if (Array.isArray(o.transcription)) return visit(o.transcription)
    if (Array.isArray(o.tokens)) return visit(o.tokens)
  }
  visit(data)
  // Whisper tokens carry their leading space: when the list uses that convention, a token without
  // one continues the previous word ("Ciao" + "ne" → "Ciaone").
  const spaced = out.filter((w) => /^\s/.test(w.text)).length > out.length / 2
  const merged: CaptionWord[] = []
  for (const w of out) {
    const prev = merged[merged.length - 1]
    if (spaced && prev && !/^\s/.test(w.text)) {
      prev.text += w.text
      prev.end = w.end
    } else merged.push({ ...w })
  }
  return merged.map((w) => ({ ...w, text: w.text.trim() })).filter((w) => w.text)
}

/** SRT text for pages placed at comp time `offset`. */
export function toSrt(cues: { start: number; end: number; text: string }[]): string {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n')
}

/** Page text as displayed (uppercase when the layer asks for it). */
export function pageText(layer: CaptionsLayer, page: CaptionPage): string {
  const t = page.words.map((w) => w.text).join(' ')
  return layer.uppercase ? t.toUpperCase() : t
}
