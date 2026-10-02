// Easing curves: named curves, cubic-bezier and physical springs, all as functions 0..1 → value.

import type { Ease } from './types'

export type EaseFn = (u: number) => number

const c1 = 1.70158
const c3 = c1 + 1
const c4 = (2 * Math.PI) / 3

function outBounce(x: number): number {
  const n1 = 7.5625
  const d1 = 2.75
  if (x < 1 / d1) return n1 * x * x
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375
  return n1 * (x -= 2.625 / d1) * x + 0.984375
}

const base: Record<string, EaseFn> = {
  linear: (x) => x,
  inSine: (x) => 1 - Math.cos((x * Math.PI) / 2),
  outSine: (x) => Math.sin((x * Math.PI) / 2),
  inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
  inQuad: (x) => x * x,
  outQuad: (x) => 1 - (1 - x) * (1 - x),
  inOutQuad: (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2),
  inCubic: (x) => x ** 3,
  outCubic: (x) => 1 - (1 - x) ** 3,
  inOutCubic: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
  inQuart: (x) => x ** 4,
  outQuart: (x) => 1 - (1 - x) ** 4,
  inOutQuart: (x) => (x < 0.5 ? 8 * x ** 4 : 1 - (-2 * x + 2) ** 4 / 2),
  inQuint: (x) => x ** 5,
  outQuint: (x) => 1 - (1 - x) ** 5,
  inOutQuint: (x) => (x < 0.5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2),
  inExpo: (x) => (x === 0 ? 0 : 2 ** (10 * x - 10)),
  outExpo: (x) => (x === 1 ? 1 : 1 - 2 ** (-10 * x)),
  inOutExpo: (x) =>
    x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2,
  inCirc: (x) => 1 - Math.sqrt(1 - x * x),
  outCirc: (x) => Math.sqrt(1 - (x - 1) ** 2),
  inOutCirc: (x) =>
    x < 0.5 ? (1 - Math.sqrt(1 - (2 * x) ** 2)) / 2 : (Math.sqrt(1 - (-2 * x + 2) ** 2) + 1) / 2,
  inBack: (x) => c3 * x ** 3 - c1 * x * x,
  outBack: (x) => 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2,
  inOutBack: (x) => {
    const c2 = c1 * 1.525
    return x < 0.5
      ? ((2 * x) ** 2 * ((c2 + 1) * 2 * x - c2)) / 2
      : ((2 * x - 2) ** 2 * ((c2 + 1) * (x * 2 - 2) + c2) + 2) / 2
  },
  outElastic: (x) => (x === 0 ? 0 : x === 1 ? 1 : 2 ** (-10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1),
  outBounce,
}

/** Named cubic-bezier curves that read as "designed" motion. */
const beziers: Record<string, [number, number, number, number]> = {
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
  /** Long, soft landing: the default for entrances. */
  smooth: [0.22, 1, 0.36, 1],
  /** Fast start, firm stop. */
  snappy: [0.2, 0.9, 0.1, 1],
  /** Symmetric and calm, for camera moves. */
  glide: [0.65, 0, 0.35, 1],
  /** Anticipation: pulls back slightly before moving. */
  anticipate: [0.7, -0.4, 0.4, 1.4],
}

export const EASE_NAMES = [...Object.keys(base), ...Object.keys(beziers), 'spring', 'bouncy', 'gentle']

export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EaseFn {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  return (x) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x
      if (Math.abs(err) < 1e-6) return sampleY(t)
      const d = slopeX(t)
      if (Math.abs(d) < 1e-6) break
      t -= err / d
    }
    let lo = 0
    let hi = 1
    t = x
    for (let i = 0; i < 40; i++) {
      const v = sampleX(t)
      if (Math.abs(v - x) < 1e-7) break
      if (v < x) lo = t
      else hi = t
      t = (lo + hi) / 2
    }
    return sampleY(t)
  }
}

/**
 * A damped spring from 0 to 1, stretched so it settles exactly at u = 1.
 * Low damping overshoots and wobbles; damping near 2*sqrt(stiffness*mass) lands without overshoot.
 */
export function spring(stiffness = 170, damping = 18, mass = 1): EaseFn {
  const w0 = Math.sqrt(stiffness / mass)
  const zeta = damping / (2 * Math.sqrt(stiffness * mass))
  const pos = (t: number): number => {
    if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta)
      return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t))
    }
    if (zeta === 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t)
    const s = Math.sqrt(zeta * zeta - 1)
    const r1 = -w0 * (zeta - s)
    const r2 = -w0 * (zeta + s)
    const a = r2 / (r2 - r1)
    return 1 - (a * Math.exp(r1 * t) + (1 - a) * Math.exp(r2 * t))
  }
  // Settling time: the last moment the spring is more than 0.1% away from rest.
  let settle = 0
  const step = 1 / 240
  for (let t = 0; t < 20; t += step) if (Math.abs(pos(t) - 1) > 0.001) settle = t + step
  settle = Math.max(settle, step)
  return (u) => (u <= 0 ? 0 : u >= 1 ? 1 : pos(u * settle))
}

const springPresets: Record<string, EaseFn> = {
  spring: spring(170, 18),
  bouncy: spring(200, 12),
  gentle: spring(120, 20),
}

const cache = new Map<string, EaseFn>()

/** Resolves an easing spec. Unknown names fall back to `fallback` (validation reports them). */
export function getEase(ease: Ease | undefined, fallback: Ease = 'inOutCubic'): EaseFn {
  if (ease === undefined) return getEase(fallback, 'linear')
  if (Array.isArray(ease)) return cubicBezier(ease[0], ease[1], ease[2], ease[3])
  if (typeof ease === 'object') {
    const key = JSON.stringify(ease)
    let fn = cache.get(key)
    if (!fn) {
      fn = spring(ease.spring.stiffness, ease.spring.damping, ease.spring.mass)
      cache.set(key, fn)
    }
    return fn
  }
  if (base[ease]) return base[ease]
  if (beziers[ease]) {
    let fn = cache.get(ease)
    if (!fn) {
      fn = cubicBezier(...beziers[ease])
      cache.set(ease, fn)
    }
    return fn
  }
  if (springPresets[ease]) return springPresets[ease]
  const m = /^cubic-bezier\(([^)]+)\)$/.exec(ease.trim())
  if (m) {
    const n = m[1].split(',').map(Number)
    if (n.length === 4 && n.every(Number.isFinite)) return cubicBezier(n[0], n[1], n[2], n[3])
  }
  return fallback === ease ? base.linear : getEase(fallback, 'linear')
}

export function isKnownEase(ease: unknown): boolean {
  if (Array.isArray(ease)) return ease.length === 4 && ease.every((n) => typeof n === 'number')
  if (ease && typeof ease === 'object') return 'spring' in ease
  if (typeof ease !== 'string') return false
  return ease in base || ease in beziers || ease in springPresets || /^cubic-bezier\(([^)]+)\)$/.test(ease.trim())
}
