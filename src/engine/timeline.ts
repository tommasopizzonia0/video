// Timing: where scenes sit on the comp timeline, which ones are visible at a given time,
// and when each layer is alive. Pure math, no drawing.

import { progress } from './animate'
import type { Composition, Layer, Scene, Transition } from './types'

export const DEFAULT_FPS = 30
export const DEFAULT_TRANSITION = 0.6

export function transitionDuration(tr: Transition | undefined): number {
  if (!tr || tr.type === 'cut') return 0
  return Math.max(0, tr.duration ?? DEFAULT_TRANSITION)
}

/** Comp start time of every scene. A transition makes a scene start before the previous one ends. */
export function sceneStarts(scenes: Scene[]): number[] {
  const starts: number[] = []
  let t = 0
  scenes.forEach((s, i) => {
    if (i > 0) t -= Math.min(transitionDuration(s.transition), scenes[i - 1].duration, s.duration)
    starts.push(Math.max(0, t))
    t = Math.max(0, t) + s.duration
  })
  return starts
}

export function compDuration(comp: Composition): number {
  if (comp.duration !== undefined) return comp.duration
  const scenes = comp.scenes ?? []
  if (scenes.length) {
    const starts = sceneStarts(scenes)
    return starts[starts.length - 1] + scenes[scenes.length - 1].duration
  }
  let end = 0
  for (const l of comp.layers ?? []) if (l.duration !== undefined) end = Math.max(end, (l.start ?? 0) + l.duration)
  return end || 5
}

export function frameCount(comp: Composition): number {
  return Math.max(1, Math.round(compDuration(comp) * (comp.fps ?? DEFAULT_FPS)))
}

export interface ActiveScene {
  index: number
  scene: Scene
  /** Seconds since this scene started. */
  local: number
  /** While this scene is entering through a transition: its progress 0..1. */
  enter: number | null
}

/** Scenes visible at comp time `t`, bottom first. During a transition there are two. */
export function activeScenes(scenes: Scene[], t: number): ActiveScene[] {
  const starts = sceneStarts(scenes)
  const out: ActiveScene[] = []
  scenes.forEach((scene, index) => {
    const local = t - starts[index]
    const last = index === scenes.length - 1
    if (local < 0 || (local >= scene.duration && !last)) return
    const tr = scene.transition
    const d = index > 0 ? Math.min(transitionDuration(tr), scenes[index - 1].duration, scene.duration) : 0
    const enter = d > 0 && local < d ? progress(local, 0, d, tr?.ease, 'inOutCubic') : null
    out.push({ index, scene, local: Math.min(local, scene.duration), enter })
  })
  // An outgoing scene is only needed while the next one is still transitioning in.
  return out.filter((_, i) => i === out.length - 1 || out[i + 1].enter !== null)
}

/** Start and duration of a layer inside a parent of the given duration. */
export function layerWindow(layer: Layer, parentDuration: number): { start: number; duration: number } {
  const start = layer.start ?? 0
  return { start, duration: layer.duration ?? Math.max(0, parentDuration - start) }
}

export interface PlacedLayer {
  layer: Layer
  /** Comp time when the layer starts and its duration. */
  start: number
  duration: number
}

/** Every layer in the comp with its absolute timing (groups are expanded). */
export function placedLayers(comp: Composition): PlacedLayer[] {
  const out: PlacedLayer[] = []
  const visit = (layers: Layer[], offset: number, parentDuration: number) => {
    for (const layer of layers) {
      if (layer.hidden) continue
      const w = layerWindow(layer, parentDuration)
      out.push({ layer, start: offset + w.start, duration: w.duration })
      if (layer.type === 'group') visit(layer.layers, offset + w.start, w.duration)
    }
  }
  const scenes = comp.scenes ?? []
  const starts = sceneStarts(scenes)
  scenes.forEach((s, i) => visit(s.layers, starts[i], s.duration))
  visit(comp.layers ?? [], 0, compDuration(comp))
  return out
}
