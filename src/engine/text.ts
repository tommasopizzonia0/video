// Text layout: wrapping, alignment, accent spans and the char/word/line units used by text animations.

import type { Counter, TextLayer } from './types'

export const DEFAULT_FONT = 'Inter'
export const DEFAULT_SIZE = 64
export const DEFAULT_WEIGHT = 700

export interface Piece {
  text: string
  /** x of the first character, in text box coordinates. */
  x: number
  accent: boolean
}

export interface Unit {
  pieces: Piece[]
  x: number
  w: number
  line: number
}

export interface TextLine {
  x: number
  w: number
  top: number
  baseline: number
}

export interface TextLayout {
  w: number
  h: number
  lineHeight: number
  lines: TextLine[]
  chars: Unit[]
  words: Unit[]
  lineUnits: Unit[]
  fonts: [string, string]
  letterSpacing: number
}

interface Glyph {
  ch: string
  accent: boolean
}

/** Splits "Hello {world}" into glyphs, marking the braced part as accent. Without `enabled`, braces are literal. */
export function parseAccents(text: string, enabled = true): Glyph[] {
  const out: Glyph[] = []
  let accent = false
  for (const ch of text) {
    if (!enabled) out.push({ ch, accent: false })
    else if (ch === '{' && !accent) accent = true
    else if (ch === '}' && accent) accent = false
    else out.push({ ch, accent })
  }
  return out
}

export function fontString(family: string, size: number, weight: number, italic: boolean): string {
  const generic = /mono/i.test(family) ? 'monospace' : /serif/i.test(family) && !/sans/i.test(family) ? 'serif' : 'sans-serif'
  return `${italic ? 'italic ' : ''}${weight} ${size}px "${family}", ${generic}`
}

export function layerFonts(layer: TextLayer): [string, string] {
  const size = layer.size ?? DEFAULT_SIZE
  const family = layer.font ?? DEFAULT_FONT
  const weight = layer.weight ?? DEFAULT_WEIGHT
  const italic = layer.italic ?? false
  const a = layer.accent ?? {}
  return [
    fontString(family, size, weight, italic),
    fontString(a.font ?? family, size, a.weight ?? weight, a.italic ?? italic),
  ]
}

export function formatCounter(c: Counter, value: number): string {
  const decimals = c.decimals ?? 0
  const fixed = Math.abs(value).toFixed(decimals)
  let [int, frac] = fixed.split('.')
  if (c.separator) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, c.separator)
  const decimalMark = c.separator === '.' ? ',' : '.'
  const n = (value < 0 && Number(fixed) !== 0 ? '-' : '') + int + (frac ? decimalMark + frac : '')
  return `${c.prefix ?? ''}${n}${c.suffix ?? ''}`
}

type Measure = (text: string, accent: boolean) => number

/** Lays out `text` for `layer`. `measure` returns advance widths including letter spacing after every char. */
export function layoutText(layer: TextLayer, text: string, measure: Measure, ascent: number, descent: number): TextLayout {
  const size = layer.size ?? DEFAULT_SIZE
  const ls = (layer.letterSpacing ?? 0) * size
  const lineHeight = size * (layer.lineHeight ?? 1.15)
  const glyphs = parseAccents(layer.uppercase ? text.toUpperCase() : text, !!layer.accent)

  // Width of a glyph run, measuring same-style stretches together so kerning is kept.
  const runWidth = (gs: Glyph[]): number => {
    let w = 0
    let i = 0
    while (i < gs.length) {
      let j = i
      let s = ''
      while (j < gs.length && gs[j].accent === gs[i].accent) s += gs[j++].ch
      w += measure(s, gs[i].accent)
      i = j
    }
    return w
  }

  // Paragraphs, then greedy word wrapping.
  const paragraphs: Glyph[][] = [[]]
  for (const g of glyphs) {
    if (g.ch === '\n') paragraphs.push([])
    else paragraphs[paragraphs.length - 1].push(g)
  }
  const maxWidth = layer.width
  const lines: Glyph[][] = []
  for (const para of paragraphs) {
    if (!maxWidth) {
      lines.push(para)
      continue
    }
    const tokens: Glyph[][] = []
    for (const g of para) {
      const isSpace = g.ch === ' '
      const last = tokens[tokens.length - 1]
      if (last && (last[0].ch === ' ') === isSpace) last.push(g)
      else tokens.push([g])
    }
    let line: Glyph[] = []
    for (const tok of tokens) {
      const isSpace = tok[0].ch === ' '
      if (!isSpace && line.length && runWidth([...line, ...tok]) - ls > maxWidth) {
        while (line.length && line[line.length - 1].ch === ' ') line.pop()
        lines.push(line)
        line = []
      }
      if (isSpace && !line.length) continue
      line.push(...tok)
    }
    while (line.length && line[line.length - 1].ch === ' ') line.pop()
    lines.push(line)
  }

  // Char positions per line.
  const positioned = lines.map((line) => {
    const xs: number[] = []
    let x = 0
    let i = 0
    while (i < line.length) {
      let j = i
      let s = ''
      while (j < line.length && line[j].accent === line[i].accent) {
        xs.push(x + (j > i ? measure(s, line[i].accent) : 0))
        s += line[j++].ch
      }
      x += measure(s, line[i].accent)
      i = j
    }
    return { line, xs, w: Math.max(0, x - (line.length ? ls : 0)) }
  })
  const contentW = Math.max(0, ...positioned.map((p) => p.w))
  const boxW = maxWidth ?? contentW
  const align = layer.align ?? 'center'

  const out: TextLayout = {
    w: boxW,
    h: lineHeight * Math.max(1, lines.length),
    lineHeight,
    lines: [],
    chars: [],
    words: [],
    lineUnits: [],
    fonts: ['', ''],
    letterSpacing: ls,
  }

  const charW = (p: (typeof positioned)[number], k: number) =>
    (k + 1 < p.line.length ? p.xs[k + 1] : p.w + ls) - p.xs[k] - (k + 1 < p.line.length ? 0 : ls)

  const unitFrom = (p: (typeof positioned)[number], from: number, to: number, offset: number, lineIndex: number): Unit => {
    const pieces: Piece[] = []
    for (let k = from; k < to; k++) {
      const g = p.line[k]
      const last = pieces[pieces.length - 1]
      if (last && last.accent === g.accent) last.text += g.ch
      else pieces.push({ text: g.ch, x: offset + p.xs[k], accent: g.accent })
    }
    const x = offset + p.xs[from]
    const end = offset + p.xs[to - 1] + charW(p, to - 1)
    return { pieces, x, w: end - x, line: lineIndex }
  }

  positioned.forEach((p, li) => {
    const offset = align === 'left' ? 0 : align === 'right' ? boxW - p.w : (boxW - p.w) / 2
    const top = li * lineHeight
    out.lines.push({ x: offset, w: p.w, top, baseline: top + (lineHeight - (ascent + descent)) / 2 + ascent })
    if (!p.line.length) return
    out.lineUnits.push(unitFrom(p, 0, p.line.length, offset, li))
    let k = 0
    while (k < p.line.length) {
      if (p.line[k].ch === ' ') {
        k++
        continue
      }
      let e = k
      while (e < p.line.length && p.line[e].ch !== ' ') e++
      out.words.push(unitFrom(p, k, e, offset, li))
      for (let c = k; c < e; c++) out.chars.push(unitFrom(p, c, c + 1, offset, li))
      k = e
    }
  })
  return out
}

/** Order in which units animate: returns each unit's position in the sequence. */
export function unitOrder(count: number, order: string | undefined): number[] {
  const idx = Array.from({ length: count }, (_, i) => i)
  switch (order) {
    case 'end':
      return idx.map((i) => count - 1 - i)
    case 'center': {
      const mid = (count - 1) / 2
      return idx.map((i) => Math.abs(i - mid))
    }
    case 'edges': {
      const mid = (count - 1) / 2
      return idx.map((i) => mid - Math.abs(i - mid))
    }
    case 'random': {
      // Deterministic shuffle so renders are repeatable.
      let seed = 0x9e3779b9 ^ count
      const rand = () => {
        seed = (seed + 0x6d2b79f5) | 0
        let r = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296
      }
      const perm = idx.slice()
      for (let i = perm.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1))
        ;[perm[i], perm[j]] = [perm[j], perm[i]]
      }
      const pos: number[] = []
      perm.forEach((unit, k) => (pos[unit] = k))
      return pos
    }
    default:
      return idx
  }
}
