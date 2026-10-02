// Entrance and exit presets. A preset turns a progress value into a set of modifiers
// (offset, scale, opacity, blur, clipping) applied on top of the layer's own transform.

import { progress } from './animate'
import type { Ease, Preset, PresetConfig, PresetName } from './types'

export interface Mod {
  dx: number
  dy: number
  scale: number
  rotation: number
  opacity: number
  blur: number
  /** Clip insets as fractions of the box: left, top, right, bottom. */
  clip: [number, number, number, number] | null
  /** Offset of the content inside the clip, as fractions of the box. */
  innerX: number
  innerY: number
}

export const identityMod = (): Mod => ({
  dx: 0,
  dy: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
  blur: 0,
  clip: null,
  innerX: 0,
  innerY: 0,
})

export const PRESET_NAMES: PresetName[] = [
  'none',
  'fade',
  'fadeUp',
  'fadeDown',
  'fadeLeft',
  'fadeRight',
  'slideUp',
  'slideDown',
  'slideLeft',
  'slideRight',
  'scale',
  'zoom',
  'pop',
  'blur',
  'maskUp',
  'maskDown',
  'maskLeft',
  'maskRight',
  'wipeUp',
  'wipeDown',
  'wipeLeft',
  'wipeRight',
  'rotate',
  'appear',
]

export const ENTER_EASE: Ease = 'smooth'
export const EXIT_EASE: Ease = 'inCubic'
export const ENTER_DURATION = 0.7
export const EXIT_DURATION = 0.45

const defaultEase: Partial<Record<PresetName, Ease>> = { pop: 'spring', appear: 'linear' }
const defaultDuration: Partial<Record<PresetName, number>> = { pop: 0.8, maskUp: 0.8, maskDown: 0.8, appear: 0.01 }

export function presetList(p: Preset | undefined): PresetConfig[] {
  if (!p) return []
  const list = Array.isArray(p) ? p : [p]
  return list.map((x) => (typeof x === 'string' ? { type: x } : x))
}

export interface PresetContext {
  /** Size of the animated box (layer or text unit). */
  boxW: number
  boxH: number
  /** Size of the frame, for offscreen slides and scaling defaults. */
  frameW: number
  frameH: number
  /** True for text units: distances scale with the unit instead of the frame. */
  unit: boolean
}

const dirs = {
  Up: [0, -1],
  Down: [0, 1],
  Left: [-1, 0],
  Right: [1, 0],
} as const

/**
 * Applies one preset at visibility `p` (0 = hidden, 1 = at rest) into `mod`.
 * For exits, movement continues in the named direction instead of reversing.
 */
export function applyPreset(mod: Mod, cfg: PresetConfig, p: number, exit: boolean, ctx: PresetContext): void {
  const name = cfg.type
  const hidden = 1 - p
  const k = Math.min(ctx.frameW, ctx.frameH) / 1080
  const sign = exit ? -1 : 1
  const opacity = (v: number) => {
    mod.opacity *= Math.max(0, Math.min(1, v))
  }
  const dir = (suffix: string) => dirs[suffix as keyof typeof dirs]

  if (name === 'none') return
  if (name === 'fade') return opacity(p)
  if (name === 'appear') return opacity(p > 0 ? 1 : 0)

  if (name.startsWith('fade')) {
    const [x, y] = dir(name.slice(4))
    const dist = cfg.distance ?? (ctx.unit ? (y ? ctx.boxH : ctx.boxW / 2) * 0.5 : 48 * k)
    // Moves in the named direction: "fadeUp" starts below and rises.
    mod.dx -= x * dist * hidden * sign
    mod.dy -= y * dist * hidden * sign
    return opacity(p)
  }
  if (name.startsWith('slide')) {
    const [x, y] = dir(name.slice(5))
    const dist = cfg.distance ?? (ctx.unit ? (y ? ctx.boxH : ctx.boxW) * 1.2 : y ? ctx.frameH : ctx.frameW)
    mod.dx -= x * dist * hidden * sign
    mod.dy -= y * dist * hidden * sign
    return
  }
  if (name.startsWith('mask')) {
    const [x, y] = dir(name.slice(4))
    mod.clip = intersect(mod.clip, [0, 0, 0, 0])
    mod.innerX -= x * hidden * 1.05 * sign
    mod.innerY -= y * hidden * 1.05 * sign
    return
  }
  if (name.startsWith('wipe')) {
    const [x, y] = dir(name.slice(4))
    // Enter: the visible part grows in the named direction. Exit: it retreats the same way.
    const inset: [number, number, number, number] = [0, 0, 0, 0]
    const idx = exit ? (x > 0 ? 0 : x < 0 ? 2 : y > 0 ? 1 : 3) : x > 0 ? 2 : x < 0 ? 0 : y > 0 ? 3 : 1
    inset[idx] = hidden
    mod.clip = intersect(mod.clip, inset)
    return
  }
  switch (name) {
    case 'scale': {
      const from = cfg.scale ?? 0.85
      mod.scale *= from + (1 - from) * p
      return opacity(p)
    }
    case 'zoom': {
      const from = cfg.scale ?? 1.25
      mod.scale *= from + (1 - from) * p
      return opacity(p)
    }
    case 'pop': {
      const from = cfg.scale ?? 0
      mod.scale *= Math.max(0, from + (1 - from) * p)
      return opacity(p * 3)
    }
    case 'blur':
      mod.blur += (cfg.blur ?? 24 * k) * Math.max(0, hidden)
      return opacity(p)
    case 'rotate': {
      const angle = cfg.angle ?? -8
      mod.rotation += angle * hidden * sign
      mod.dy += (cfg.distance ?? (ctx.unit ? ctx.boxH * 0.4 : 40 * k)) * hidden * sign
      return opacity(p)
    }
  }
}

function intersect(
  a: [number, number, number, number] | null,
  b: [number, number, number, number],
): [number, number, number, number] {
  if (!a) return b
  return [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]
}

/**
 * Entrance (`enter`) and exit (`exit`) presets of something visible from 0 to `duration`, evaluated at local time `t`.
 * `enterStart` / `exitEnd` shift the windows, which text uses for staggering.
 */
export function presetMod(
  enter: PresetConfig[],
  exit: PresetConfig[],
  t: number,
  duration: number,
  ctx: PresetContext,
  enterStart = 0,
  exitEnd = duration,
  overrides?: { duration?: number; ease?: Ease },
): Mod {
  const mod = identityMod()
  for (const cfg of enter) {
    const d = overrides?.duration ?? cfg.duration ?? defaultDuration[cfg.type] ?? ENTER_DURATION
    const ease = cfg.ease ?? overrides?.ease ?? defaultEase[cfg.type] ?? ENTER_EASE
    const p = progress(t, enterStart + (cfg.delay ?? 0), d, ease, ENTER_EASE)
    if (p < 1 || cfg.type === 'appear') applyPreset(mod, cfg, p, false, ctx)
  }
  for (const cfg of exit) {
    const d = overrides?.duration ?? cfg.duration ?? defaultDuration[cfg.type] ?? EXIT_DURATION
    const ease = cfg.ease ?? overrides?.ease ?? (cfg.type === 'appear' ? 'linear' : EXIT_EASE)
    const end = exitEnd - (cfg.delay ?? 0)
    const p = 1 - progress(t, end - d, d, ease, EXIT_EASE)
    if (p < 1) applyPreset(mod, cfg, p, true, ctx)
  }
  return mod
}
