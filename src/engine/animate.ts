// Evaluates animatable values (constants, keyframes, tweens) at a point in time.

import { mixColors } from './color'
import { getEase } from './easing'
import type { Anim, Ease, Keyframe, Tween } from './types'

/** Default easing between keyframes. */
export const KEYFRAME_EASE: Ease = 'inOutCubic'

export function isKeyframes<T>(v: Anim<T> | undefined): v is Keyframe<T>[] {
  return Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && v[0] !== null && 't' in v[0]
}

export function isTween<T>(v: Anim<T> | undefined): v is Tween<T> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'from' in v && 'to' in v
}

function lerp<T>(a: T, b: T, u: number): T {
  if (typeof a === 'number' && typeof b === 'number') return (a + (b - a) * u) as T
  if (typeof a === 'string' && typeof b === 'string') return mixColors(a, b, u) as T
  return (u < 1 ? a : b) as T
}

/** Value of `v` at `t` seconds from the layer start. */
export function valueAt<T>(v: Anim<T> | undefined, t: number, fallback: T): T {
  if (v === undefined || v === null) return fallback
  if (isKeyframes(v)) {
    if (t <= v[0].t) return v[0].v
    for (let i = 1; i < v.length; i++) {
      const k = v[i]
      if (t < k.t) {
        const prev = v[i - 1]
        const span = k.t - prev.t
        const u = span > 0 ? (t - prev.t) / span : 1
        return lerp(prev.v, k.v, getEase(k.ease, KEYFRAME_EASE)(u))
      }
    }
    return v[v.length - 1].v
  }
  if (isTween(v)) {
    const at = v.at ?? 0
    const u = v.duration > 0 ? Math.max(0, Math.min(1, (t - at) / v.duration)) : t >= at ? 1 : 0
    return lerp(v.from, v.to, getEase(v.ease, KEYFRAME_EASE)(u))
  }
  return v as T
}

export const num = (v: Anim<number> | undefined, t: number, fallback: number) => valueAt(v, t, fallback)

/** Progress 0..1 of an eased segment starting at `start` and lasting `duration`. Springs may overshoot past 1. */
export function progress(t: number, start: number, duration: number, ease: Ease | undefined, fallback: Ease): number {
  if (duration <= 0) return t >= start ? 1 : 0
  const u = (t - start) / duration
  if (u <= 0) return 0
  if (u >= 1) return 1
  return getEase(ease, fallback)(u)
}
