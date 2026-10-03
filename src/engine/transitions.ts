// Velocity-matched scene transitions. The old scene accelerates out, the cut lands mid-motion and the
// new scene keeps travelling the same way while it decelerates: the two halves read as one move, so
// the eye's momentum survives the cut. Only one scene is visible on any frame (never a dissolve).

import { getEase } from './easing'
import type { Transition } from './types'

export interface Pose {
  alpha: number
  dx: number
  dy: number
  scale: number
  /** Blur in comp px. */
  blur: number
  /** Directional smear: copies spread over this vector (comp px), for whips. */
  smear?: [number, number]
}

export interface TransitionFrame {
  a: Pose | null
  b: Pose | null
  /** A flat color drawn on top (flash). */
  overlay?: { color: string; alpha: number }
}

const clamp = (v: number) => Math.max(0, Math.min(1, v))
const inQuart = getEase('inQuart')
const outQuart = getEase('outQuart')
const inCubic = getEase('inCubic')
const outCubic = getEase('outCubic')
const outExpo = getEase('outExpo')
const inQuad = getEase('inQuad')
const outQuad = getEase('outQuad')

function vector(tr: Transition): [number, number] {
  const dir = tr.direction ?? 'left'
  return [dir === 'left' ? -1 : dir === 'right' ? 1 : 0, dir === 'up' ? -1 : dir === 'down' ? 1 : 0]
}

/**
 * Where each scene sits at transition progress `p` (0..1) for the velocity-matched types.
 * Returns null for the classic types, which the renderer draws itself.
 */
export function shapedTransition(tr: Transition, p: number, W: number, H: number): TransitionFrame | null {
  const [vx, vy] = vector(tr)
  const k = Math.min(W, H) / 1080
  const still = (alpha = 1): Pose => ({ alpha, dx: 0, dy: 0, scale: 1, blur: 0 })
  switch (tr.type) {
    case 'curve': {
      // Cut the curve: partial travel (~12% of the frame), mirrored quartic eases, cut at peak speed.
      const d = tr.distance ?? 0.12 * (vx ? W : H)
      const blur = tr.blur ?? 0
      const split = 0.45
      if (p < split) {
        const u = p / split
        const m = inQuart(u)
        // The fade dies right at the cut, while the scene is still streaking.
        return { a: { alpha: 1 - u ** 1.5, dx: vx * d * m, dy: vy * d * m, scale: 1, blur: blur * u * u }, b: null }
      }
      const v = (p - split) / (1 - split)
      const m = 1 - outQuart(v)
      // The new scene ignites mid-path at 35% opacity instead of popping from 0.
      return { a: null, b: { alpha: 0.35 + 0.65 * clamp(v / 0.4), dx: -vx * d * m, dy: -vy * d * m, scale: 1, blur: blur * (1 - v) ** 2 } }
    }
    case 'zoomThrough':
    case 'zoomBack': {
      // Same sign of scale change on both sides: through = everything grows, back = everything shrinks.
      const through = tr.type === 'zoomThrough'
      const blur = tr.blur ?? 12 * k
      const split = 0.3
      if (p < split) {
        const u = p / split
        const e = inCubic(u)
        return { a: { alpha: 1 - 0.85 * u, dx: 0, dy: 0, scale: 1 + (through ? 0.2 : -0.2) * e, blur: blur * e }, b: null }
      }
      const v = outExpo((p - split) / (1 - split))
      const from = through ? 0.75 : 1.25
      return { a: null, b: { alpha: 0.15 + 0.85 * v, dx: 0, dy: 0, scale: from + (1 - from) * v, blur: blur * (1 - v) } }
    }
    case 'flash': {
      // A hard cut hidden in a flash of light that peaks on the cut frame.
      const color = tr.color ?? '#ffffff'
      const alpha = p < 0.5 ? inQuad(clamp((p - 0.15) / 0.35)) : 1 - outQuad((p - 0.5) / 0.5)
      return p < 0.5 ? { a: still(), b: null, overlay: { color, alpha } } : { a: null, b: still(), overlay: { color, alpha } }
    }
    case 'whip': {
      // A fast pan: the frame flies well past a screen with a directional smear, the new one lands.
      const span = (vx ? W : H) * 1.15
      const blur = tr.blur ?? 6 * k
      if (p < 0.5) {
        const u = p / 0.5
        const m = inCubic(u)
        const speed = 3 * u * u
        return { a: { alpha: 1, dx: vx * span * m, dy: vy * span * m, scale: 1, blur: blur * u, smear: [vx * span * 0.12 * speed, vy * span * 0.12 * speed] }, b: null }
      }
      const v = (p - 0.5) / 0.5
      const m = 1 - outCubic(v)
      const speed = 3 * (1 - v) ** 2
      return { a: null, b: { alpha: 1, dx: -vx * span * m, dy: -vy * span * m, scale: 1, blur: blur * (1 - v), smear: [vx * span * 0.12 * speed, vy * span * 0.12 * speed] } }
    }
    default:
      return null
  }
}
