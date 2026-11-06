// Cutting on the music: scene lengths in beats and sounds on a beat, resolved to seconds from the
// beat times of `npm run beats`. Runs before rendering; the rest of the engine sees plain seconds.

import { transitionDuration } from './timeline'
import type { Composition } from './types'

/** Beat `i` of `beats`, continuing the grid at the average spacing past the last one. */
export function beatAt(beats: number[], i: number): number {
  if (i < beats.length) return beats[Math.max(0, i)]
  const n = beats.length
  const period = n > 1 ? (beats[n - 1] - beats[0]) / (n - 1) : 0.5
  return beats[n - 1] + (i - n + 1) * period
}

/** Index of the beat closest to `t`. */
export function nearestBeat(beats: number[], t: number): number {
  let best = 0
  for (let i = 1; i < beats.length; i++) if (Math.abs(beats[i] - t) < Math.abs(beats[best] - t)) best = i
  return best
}

/**
 * The comp with every scene `beats` and audio `beat` turned into seconds. `beats` are times in the
 * music file; `comp.beats.offset` is the comp time where the music file starts.
 *
 * A scene of `beats: n` lasts so that the next cut lands n beats after its own cut. The cut of a
 * scene is the middle of its transition (where the new picture takes over), its start when it has none.
 */
export function applyBeatGrid(comp: Composition, fileBeats: number[]): Composition {
  if (!fileBeats.length) return comp
  const offset = comp.beats?.offset ?? 0
  const beats = fileBeats.map((b) => b + offset)
  const out: Composition = { ...comp }
  const scenes = (comp.scenes ?? []).map((s) => ({ ...s }))
  if (scenes.some((s) => s.beats !== undefined)) {
    const half = (i: number) => (i > 0 ? transitionDuration(scenes[i].transition) / 2 : 0)
    let start = 0
    let cut = 0
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i]
      const next = scenes[i + 1]
      if (s.beats !== undefined) {
        const endCut = beatAt(beats, nearestBeat(beats, cut) + s.beats)
        // The next scene starts half its transition before the beat and overlaps this one by all of it.
        const end = next ? endCut + half(i + 1) : endCut
        s.duration = Math.max(0.05, end - start)
      }
      if (next) {
        start = start + s.duration - transitionDuration(next.transition)
        cut = start + half(i + 1)
      }
    }
    out.scenes = scenes
  }
  if (comp.audio?.some((a) => a.beat !== undefined)) {
    out.audio = comp.audio.map((a) => (a.beat === undefined ? a : { ...a, start: beatAt(beats, a.beat), scene: undefined }))
  }
  return out
}

/** Where each scene's cut falls (comp seconds), for the timing check. */
export function sceneCuts(comp: Composition): number[] {
  const scenes = comp.scenes ?? []
  const cuts: number[] = []
  let start = 0
  for (let i = 1; i < scenes.length; i++) {
    const d = transitionDuration(scenes[i].transition)
    start += scenes[i - 1].duration - d
    cuts.push(start + d / 2)
  }
  return cuts
}
