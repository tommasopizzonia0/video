// Color parsing and interpolation. Mixing happens in linear light, which avoids the muddy
// midpoints of naive sRGB blending.

export type RGBA = [number, number, number, number]

const named: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  orange: '#ffa500',
  purple: '#800080',
  gray: '#808080',
  grey: '#808080',
  transparent: '#00000000',
}

const cache = new Map<string, RGBA | null>()

/** Parses #rgb, #rgba, #rrggbb, #rrggbbaa, rgb(), rgba(), hsl(), hsla() and a few names. Channels 0..255, alpha 0..1. */
export function parseColor(input: string): RGBA | null {
  const key = input.trim().toLowerCase()
  if (cache.has(key)) return cache.get(key)!
  const result = parse(named[key] ?? key)
  cache.set(key, result)
  return result
}

function parse(s: string): RGBA | null {
  if (s.startsWith('#')) {
    const hex = s.slice(1)
    if (!/^[0-9a-f]+$/.test(hex)) return null
    if (hex.length === 3 || hex.length === 4) {
      const [r, g, b, a = 'f'] = hex.split('')
      return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16), parseInt(a + a, 16) / 255]
    }
    if (hex.length === 6 || hex.length === 8) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
        hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      ]
    }
    return null
  }
  const m = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(s)
  if (!m) return null
  const parts = m[2].split(/[\s,/]+/).filter(Boolean)
  if (parts.length < 3) return null
  const num = (p: string, scale: number) => (p.endsWith('%') ? (parseFloat(p) / 100) * scale : parseFloat(p))
  const alpha = parts[3] !== undefined ? num(parts[3], 1) : 1
  if (m[1].startsWith('rgb')) {
    const rgb = parts.slice(0, 3).map((p) => num(p, 255))
    if (![...rgb, alpha].every(Number.isFinite)) return null
    return [rgb[0], rgb[1], rgb[2], alpha]
  }
  const h = parseFloat(parts[0])
  const sat = num(parts[1], 1) / (parts[1].endsWith('%') ? 1 : 100)
  const light = num(parts[2], 1) / (parts[2].endsWith('%') ? 1 : 100)
  if (![h, sat, light, alpha].every(Number.isFinite)) return null
  const k = (n: number) => (n + h / 30) % 12
  const a = sat * Math.min(light, 1 - light)
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [f(0) * 255, f(8) * 255, f(4) * 255, alpha]
}

const toLinear = (c: number) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const toSrgb = (v: number) => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055
  return Math.round(Math.max(0, Math.min(1, c)) * 255)
}

export function mixColors(a: string, b: string, u: number): string {
  const ca = parseColor(a)
  const cb = parseColor(b)
  if (!ca || !cb) return u < 0.5 ? a : b
  const alpha = ca[3] + (cb[3] - ca[3]) * u
  // Premultiplied mixing so fading from "transparent" doesn't pass through black.
  const ch = (i: number) => {
    const va = toLinear(ca[i]) * ca[3]
    const vb = toLinear(cb[i]) * cb[3]
    const v = va + (vb - va) * u
    return alpha > 0 ? toSrgb(v / alpha) : 0
  }
  return formatColor([ch(0), ch(1), ch(2), alpha])
}

export function formatColor([r, g, b, a]: RGBA): string {
  const alpha = Math.max(0, Math.min(1, a))
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${+alpha.toFixed(4)})`
}

export function withAlpha(color: string, alpha: number): string {
  const c = parseColor(color)
  return c ? formatColor([c[0], c[1], c[2], c[3] * alpha]) : color
}
