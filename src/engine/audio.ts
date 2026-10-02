// The audio mix as a flat list of clips on the comp timeline: music, voice and sound effects from
// `audio`, plus the sound of every unmuted video layer. The same mix plays in the preview, the
// browser export and the CLI, so what you hear while editing is what gets rendered.

import { valueAt } from './animate'
import { SFX_LENGTH, synthSfx } from './sfx'
import { compDuration, placedLayers, sceneStarts } from './timeline'
import type { Anim, Composition, DuckSettings, SfxName } from './types'

export interface MixClip {
  /** Buffer key: the asset id, or "sfx:<name>:<length>" for a synthesized effect. */
  key: string
  asset?: string
  sfx?: { name: SfxName; length: number }
  role: 'music' | 'voice' | 'sfx' | 'video'
  /** Comp time where the clip starts. */
  start: number
  /** Seconds into the source. */
  sourceStart: number
  duration: number
  /** Gain; keyframe times are seconds from the clip's own start (before any trimming). */
  volume: Anim<number>
  /** Comp time the volume keyframes count from. */
  volumeOrigin: number
  fadeIn: number
  fadeOut: number
  playbackRate: number
  /** On music clips when a voice should duck them. */
  duck?: DuckSettings
}

/** Rate of the gain curves: 100 points per second is smooth for fades and ducking. */
const CURVE_RATE = 100

export const sfxKey = (name: SfxName, length: number) => `sfx:${name}:${length.toFixed(3)}`

/** Comp time of a scene's start, by id or index. */
function sceneOffset(comp: Composition, ref: string | number): number {
  const scenes = comp.scenes ?? []
  const index = typeof ref === 'number' ? ref : scenes.findIndex((s) => s.id === ref)
  if (index < 0 || index >= scenes.length) return 0
  return sceneStarts(scenes)[index]
}

export function audioMix(comp: Composition): MixClip[] {
  const total = compDuration(comp)
  const out: MixClip[] = []
  for (const a of comp.audio ?? []) {
    const at = (a.scene !== undefined ? sceneOffset(comp, a.scene) : 0) + (a.start ?? 0)
    if (a.sfx) {
      const length = a.sfx === 'whoosh' || a.sfx === 'riser' ? (a.duration ?? SFX_LENGTH[a.sfx]) : SFX_LENGTH[a.sfx]
      // The clip is placed so its peak lands on `start`; whatever falls before 0 is trimmed.
      const peak = synthPeak(a.sfx, length)
      const start = at - peak
      const skip = Math.max(0, -start)
      out.push({
        key: sfxKey(a.sfx, length),
        sfx: { name: a.sfx, length },
        role: a.role ?? 'sfx',
        start: Math.max(0, start),
        sourceStart: skip,
        duration: Math.max(0, Math.min(length - skip, total - Math.max(0, start))),
        volume: a.volume ?? 1,
        volumeOrigin: start,
        fadeIn: a.fadeIn ?? 0,
        fadeOut: a.fadeOut ?? 0,
        playbackRate: 1,
      })
      continue
    }
    if (!a.asset) continue
    out.push({
      key: a.asset,
      asset: a.asset,
      role: a.role ?? 'music',
      start: at,
      sourceStart: a.sourceStart ?? 0,
      duration: Math.max(0, Math.min(a.duration ?? Infinity, total - at)),
      volume: a.volume ?? 1,
      volumeOrigin: at,
      fadeIn: a.fadeIn ?? 0,
      fadeOut: a.fadeOut ?? 0,
      playbackRate: 1,
    })
  }
  for (const { layer, start, duration } of placedLayers(comp)) {
    if (layer.type !== 'video' || layer.muted || (layer.volume ?? 1) <= 0) continue
    out.push({
      key: layer.asset,
      asset: layer.asset,
      role: 'video',
      start,
      sourceStart: layer.sourceStart ?? 0,
      duration: Math.max(0, Math.min(duration, total - start)),
      volume: layer.volume ?? 1,
      volumeOrigin: start,
      // Tiny fades avoid clicks at cuts.
      fadeIn: 0.02,
      fadeOut: 0.02,
      playbackRate: layer.playbackRate ?? 1,
    })
  }
  const mix = out.filter((c) => c.duration > 0 && c.start < total)
  const duck = comp.mix?.duck ?? {}
  if (duck !== false && mix.some((c) => c.role === 'voice')) for (const c of mix) if (c.role === 'music') c.duck = duck
  return mix
}

const peaks = new Map<string, number>()
function synthPeak(name: SfxName, length: number): number {
  const key = sfxKey(name, length)
  let p = peaks.get(key)
  if (p === undefined) {
    // The peak position does not depend on the sample rate; a low rate keeps this cheap.
    p = synthSfx(name, 8000, length).peak
    peaks.set(key, p)
  }
  return p
}

/** Adds a buffer for every synthesized effect in the mix. */
export function addSfxBuffers(ctx: BaseAudioContext, mix: MixClip[], buffers: Map<string, AudioBuffer>) {
  for (const clip of mix) {
    if (!clip.sfx || buffers.has(clip.key)) continue
    const { samples } = synthSfx(clip.sfx.name, ctx.sampleRate, clip.sfx.length)
    const buffer = ctx.createBuffer(2, samples.length, ctx.sampleRate)
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0)
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 1)
    buffers.set(clip.key, buffer)
  }
}

/**
 * Music gain over the comp under the voice, sampled at CURVE_RATE: 1 where nobody speaks, the duck
 * level while someone does, with smooth attack and release. Null when there is nothing to duck.
 */
export function duckCurve(mix: MixClip[], buffers: Map<string, AudioBuffer>): Float32Array | null {
  const settings = mix.find((c) => c.duck)?.duck
  const voices = mix.filter((c) => c.role === 'voice')
  if (!settings || !voices.length) return null
  const total = Math.max(...mix.map((c) => c.start + c.duration))
  const n = Math.ceil(total * CURVE_RATE) + 1
  const active = new Uint8Array(n)
  const threshold = 10 ** ((settings.threshold ?? -45) / 20)
  for (const clip of voices) {
    const buffer = buffers.get(clip.key)
    if (!buffer) continue
    const data = buffer.getChannelData(0)
    const rate = buffer.sampleRate
    const win = Math.round(rate * 0.02)
    for (let i = Math.floor(clip.start * CURVE_RATE); i < n && i / CURVE_RATE < clip.start + clip.duration; i++) {
      const t = i / CURVE_RATE
      const src = Math.round((clip.sourceStart + (t - clip.start) * clip.playbackRate) * rate)
      let sum = 0
      let count = 0
      for (let j = Math.max(0, src - win); j < Math.min(data.length, src + win); j++) {
        sum += data[j] * data[j]
        count++
      }
      const gain = valueAt(clip.volume, t - clip.volumeOrigin, 1)
      if (count && Math.sqrt(sum / count) * gain > threshold) active[i] = 1
    }
  }
  // Hold through the gaps between words so the music does not pump.
  const hold = Math.round(0.25 * CURVE_RATE)
  let last = -Infinity
  const held = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (active[i]) last = i
    held[i] = i - last <= hold ? 1 : 0
  }
  const low = 10 ** ((settings.amount ?? -12) / 20)
  const attack = 1 - Math.exp(-1 / ((settings.attack ?? 0.12) * CURVE_RATE))
  const release = 1 - Math.exp(-1 / ((settings.release ?? 0.45) * CURVE_RATE))
  // Look ahead by the attack time so the music is already down when the first word lands.
  const lead = Math.round((settings.attack ?? 0.12) * CURVE_RATE)
  const curve = new Float32Array(n)
  let g = 1
  for (let i = 0; i < n; i++) {
    const target = held[Math.min(n - 1, i + lead)] ? low : 1
    g += (target - g) * (target < g ? attack : release)
    curve[i] = g
  }
  return curve
}

/** Gain of `clip` at comp time `t`: volume keyframes, fades and ducking. */
export function clipGain(clip: MixClip, t: number, duck: Float32Array | null): number {
  const end = clip.start + clip.duration
  let v = valueAt(clip.volume, t - clip.volumeOrigin, 1)
  if (clip.fadeIn > 0) v *= Math.min(1, Math.max(0, (t - clip.start) / clip.fadeIn))
  if (clip.fadeOut > 0) v *= Math.min(1, Math.max(0, (end - t) / clip.fadeOut))
  if (duck && clip.duck) v *= duck[Math.max(0, Math.min(duck.length - 1, Math.round(t * CURVE_RATE)))]
  return Math.max(0, v)
}

/**
 * Schedules the mix on a Web Audio context (a live one for preview, an OfflineAudioContext for export),
 * starting from comp time `from`. Returns the scheduled sources so a preview can stop them.
 * `buffers` holds the decoded assets; synthesized effects are added to it here.
 */
export function scheduleMix(
  ctx: BaseAudioContext,
  mix: MixClip[],
  buffers: Map<string, AudioBuffer>,
  from = 0,
  destination: AudioNode = ctx.destination,
): AudioScheduledSourceNode[] {
  addSfxBuffers(ctx, mix, buffers)
  const duck = duckCurve(mix, buffers)
  const now = ctx.currentTime
  const sources: AudioScheduledSourceNode[] = []
  for (const clip of mix) {
    const buffer = buffers.get(clip.key)
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

    // The whole gain envelope as one curve in context time.
    const startTime = Math.max(from, clip.start)
    const points = Math.max(2, Math.ceil((end - startTime) * CURVE_RATE) + 1)
    const curve = new Float32Array(points)
    for (let i = 0; i < points; i++) curve[i] = clipGain(clip, startTime + ((end - startTime) * i) / (points - 1), duck)
    gain.gain.value = curve[0]
    if (end - startTime > 0.001) gain.gain.setValueCurveAtTime(curve, when, end - startTime)
    src.start(when, offset, remaining * clip.playbackRate)
    sources.push(src)
  }
  return sources
}
