// The audio mix as a flat list of clips on the comp timeline: music and sound effects from
// `audio`, plus the sound of every unmuted video layer. Used by both the browser export and the CLI.

import { compDuration, placedLayers } from './timeline'
import type { Composition } from './types'

export interface MixClip {
  asset: string
  /** Comp time where the clip starts. */
  start: number
  /** Seconds into the source. */
  sourceStart: number
  duration: number
  volume: number
  fadeIn: number
  fadeOut: number
  playbackRate: number
}

export function audioMix(comp: Composition): MixClip[] {
  const total = compDuration(comp)
  const out: MixClip[] = []
  for (const a of comp.audio ?? []) {
    const start = a.start ?? 0
    out.push({
      asset: a.asset,
      start,
      sourceStart: a.sourceStart ?? 0,
      duration: Math.max(0, Math.min(a.duration ?? Infinity, total - start)),
      volume: a.volume ?? 1,
      fadeIn: a.fadeIn ?? 0,
      fadeOut: a.fadeOut ?? 0,
      playbackRate: 1,
    })
  }
  for (const { layer, start, duration } of placedLayers(comp)) {
    if (layer.type !== 'video' || layer.muted || (layer.volume ?? 1) <= 0) continue
    out.push({
      asset: layer.asset,
      start,
      sourceStart: layer.sourceStart ?? 0,
      duration: Math.max(0, Math.min(duration, total - start)),
      volume: layer.volume ?? 1,
      // Tiny fades avoid clicks at cuts.
      fadeIn: 0.02,
      fadeOut: 0.02,
      playbackRate: layer.playbackRate ?? 1,
    })
  }
  return out.filter((c) => c.duration > 0 && c.start < total)
}

/**
 * Schedules the mix on a Web Audio context (a live one for preview, an OfflineAudioContext for export),
 * starting from comp time `from`. Returns the scheduled sources so a preview can stop them.
 */
export function scheduleMix(
  ctx: BaseAudioContext,
  mix: MixClip[],
  buffers: Map<string, AudioBuffer>,
  from = 0,
  destination: AudioNode = ctx.destination,
): AudioScheduledSourceNode[] {
  const now = ctx.currentTime
  const sources: AudioScheduledSourceNode[] = []
  for (const clip of mix) {
    const buffer = buffers.get(clip.asset)
    const end = clip.start + clip.duration
    if (!buffer || end <= from) continue
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.playbackRate.value = clip.playbackRate
    const gain = ctx.createGain()
    src.connect(gain).connect(destination)

    const skip = Math.max(0, from - clip.start)
    const when = now + Math.max(0, clip.start - from)
    const offset = clip.sourceStart + skip * clip.playbackRate
    const remaining = clip.duration - skip
    if (offset >= buffer.duration) continue

    // Volume envelope in context time.
    const g = gain.gain
    const at = (compTime: number) => now + (compTime - from)
    const level = (compTime: number) => {
      const into = compTime - clip.start
      const left = end - compTime
      let v = clip.volume
      if (clip.fadeIn > 0) v *= Math.min(1, Math.max(0, into / clip.fadeIn))
      if (clip.fadeOut > 0) v *= Math.min(1, Math.max(0, left / clip.fadeOut))
      return v
    }
    const startTime = Math.max(from, clip.start)
    g.setValueAtTime(level(startTime), at(startTime))
    if (clip.fadeIn > 0 && startTime < clip.start + clip.fadeIn) g.linearRampToValueAtTime(clip.volume, at(clip.start + clip.fadeIn))
    if (clip.fadeOut > 0) {
      const fadeStart = Math.max(startTime, end - clip.fadeOut)
      g.setValueAtTime(level(fadeStart), at(fadeStart))
      g.linearRampToValueAtTime(0, at(end))
    }
    src.start(when, offset, remaining * clip.playbackRate)
    sources.push(src)
  }
  return sources
}
