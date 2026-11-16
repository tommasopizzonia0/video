// The audio console: one channel strip per sound (each `audio` entry and each video layer with
// sound), a group bus per role (music, voice, effects, video sound) and the master. Every strip runs
// the same chain as a desk: low/high cut, 3-band EQ, compressor, pan, fader, then post-fader sends
// to a shared reverb and echo. The same graph plays in the preview, the browser export and the CLI.

import { placedLayers } from './timeline'
import type { AudioClip, ChannelSettings, Composition, MixBus, MixFx, VideoLayer } from './types'

export const BUSES: MixBus[] = ['music', 'voice', 'sfx', 'video']

export const BUS_NAME: Record<MixBus, string> = { music: 'Musica', voice: 'Voce', sfx: 'Effetti', video: 'Audio video' }

/** Everything the console sets, by strip: channel ids are "a<i>" (audio entry i) and "v<n>" (video layer n). */
export interface MixerSettings {
  channels: Record<string, ChannelSettings>
  buses: Partial<Record<MixBus, ChannelSettings>>
  master: ChannelSettings
  fx: MixFx
}

export interface MixerChannel {
  id: string
  /** Desk name: A1, A2… for sounds, V1, V2… for video sound. */
  short: string
  label: string
  bus: MixBus
  kind: 'asset' | 'sfx' | 'video'
  /** Muted in the composition itself (`muted: true` on the video layer). */
  off?: boolean
}

export const SILENT_DB = -60

export const dbToGain = (db: number) => (db <= SILENT_DB ? 0 : 10 ** (db / 20))
export const gainToDb = (g: number) => (g <= 0 ? -Infinity : 20 * Math.log10(g))

export function busOf(clip: AudioClip): MixBus {
  return clip.role ?? (clip.sfx ? 'sfx' : 'music')
}

/** The video layers that can carry sound, in a fixed order (the same in the raw and the timed comp). */
export function videoLayers(comp: Composition): VideoLayer[] {
  return placedLayers(comp).flatMap(({ layer }) => (layer.type === 'video' ? [layer] : []))
}

const baseName = (s: string) => s.split(/[\\/]/).pop()!.replace(/\.[a-z0-9]+$/i, '')

/** The console's strips for this composition. */
export function mixerChannels(comp: Composition): MixerChannel[] {
  const out: MixerChannel[] = []
  ;(comp.audio ?? []).forEach((a, i) => {
    const label = a.sfx ?? (a.asset ? baseName(comp.assets?.[a.asset]?.src ?? a.asset) : 'Audio')
    out.push({ id: `a${i}`, short: `A${i + 1}`, label, bus: busOf(a), kind: a.sfx ? 'sfx' : 'asset' })
  })
  videoLayers(comp).forEach((l, n) => {
    out.push({ id: `v${n}`, short: `V${n + 1}`, label: l.id ?? baseName(comp.assets?.[l.asset]?.src ?? l.asset), bus: 'video', kind: 'video', off: l.muted || (l.volume ?? 1) <= 0 })
  })
  return out
}

export function mixerSettings(comp: Composition): MixerSettings {
  const channels: Record<string, ChannelSettings> = {}
  ;(comp.audio ?? []).forEach((a, i) => {
    if (a.mixer) channels[`a${i}`] = a.mixer
  })
  videoLayers(comp).forEach((l, n) => {
    if (l.mixer) channels[`v${n}`] = l.mixer
  })
  return { channels, buses: comp.mix?.buses ?? {}, master: comp.mix?.master ?? {}, fx: comp.mix?.fx ?? {} }
}

/** Drops default values, so untouched strips leave nothing in the JSON. */
export function cleanChannel(s: ChannelSettings): ChannelSettings | undefined {
  const out: ChannelSettings = {}
  if (s.gain !== undefined && Math.abs(s.gain) > 0.05) out.gain = Math.round(s.gain * 10) / 10
  if (s.pan !== undefined && Math.abs(s.pan) > 0.005) out.pan = Math.round(s.pan * 100) / 100
  if (s.mute) out.mute = true
  if (s.solo) out.solo = true
  if (s.eq) {
    const eq = Object.fromEntries(Object.entries(s.eq).filter(([k, v]) => (k === 'bypass' ? v : typeof v === 'number' && (k === 'midFreq' ? Math.abs(v - 1000) > 1 : Math.abs(v) > 0.05))))
    for (const k of ['low', 'mid', 'high'] as const) if (typeof eq[k] === 'number') eq[k] = Math.round((eq[k] as number) * 10) / 10
    if (typeof eq.midFreq === 'number') eq.midFreq = Math.round(eq.midFreq as number)
    if (Object.keys(eq).some((k) => k !== 'bypass')) out.eq = eq
  }
  if (s.dynamics) out.dynamics = s.dynamics
  if (s.reverb) out.reverb = Math.round(s.reverb * 100) / 100
  if (s.delay) out.delay = Math.round(s.delay * 100) / 100
  if (s.limiter) out.limiter = true
  return Object.keys(out).length ? out : undefined
}

/** Writes the console's settings into a composition (the editable JSON, not the timed copy). */
export function writeMixer(comp: Composition, m: MixerSettings): Composition {
  ;(comp.audio ?? []).forEach((a, i) => {
    const s = m.channels[`a${i}`] && cleanChannel(m.channels[`a${i}`])
    if (s) a.mixer = s
    else delete a.mixer
  })
  videoLayers(comp).forEach((l, n) => {
    const s = m.channels[`v${n}`] && cleanChannel(m.channels[`v${n}`])
    if (s) l.mixer = s
    else delete l.mixer
  })
  const mix = (comp.mix ??= {})
  const buses: Partial<Record<MixBus, ChannelSettings>> = {}
  for (const b of BUSES) {
    const s = m.buses[b] && cleanChannel(m.buses[b]!)
    if (s) buses[b] = s
  }
  if (Object.keys(buses).length) mix.buses = buses
  else delete mix.buses
  const master = cleanChannel(m.master)
  if (master) mix.master = master
  else delete mix.master
  const fx = Object.fromEntries(Object.entries(m.fx).filter(([, v]) => typeof v === 'number')) as MixFx
  if (Object.keys(fx).length) mix.fx = fx
  else delete mix.fx
  if (!Object.keys(mix).length) delete comp.mix
  return comp
}

/** The composition without the console's settings: changing only those needs no reload of the media. */
export function withoutMixer(comp: Composition): string {
  const { buses: _b, master: _m, fx: _f, ...rest } = comp.mix ?? {}
  const mix = Object.keys(rest).length ? rest : undefined
  return JSON.stringify({ ...comp, mix }, (k, v) => (k === 'mixer' ? undefined : v))
}

/** Which strips of a row are heard: muted ones never, and only the soloed ones when any is soloed. */
export function audible(row: (ChannelSettings | undefined)[]): boolean[] {
  const solo = row.some((s) => s?.solo)
  return row.map((s) => !s?.mute && (!solo || !!s?.solo))
}

interface Strip {
  input: GainNode
  lowCut: BiquadFilterNode
  highCut: BiquadFilterNode
  low: BiquadFilterNode
  mid: BiquadFilterNode
  high: BiquadFilterNode
  comp: DynamicsCompressorNode
  compWet: GainNode
  compDry: GainNode
  pan: StereoPannerNode
  fader: GainNode
  reverb: GainNode
  delay: GainNode
  meter?: [AnalyserNode, AnalyserNode]
  /** Last applied settings, so unchanged values are not rescheduled. */
  key?: string
}

function createStrip(ctx: BaseAudioContext, sends: { reverb: AudioNode; delay: AudioNode } | null, meters: boolean): Strip {
  const input = ctx.createGain()
  // Mono sources become a centred stereo pair before the panner (no 3 dB drop).
  input.channelCount = 2
  input.channelCountMode = 'explicit'
  input.channelInterpretation = 'speakers'
  const lowCut = ctx.createBiquadFilter()
  const highCut = ctx.createBiquadFilter()
  const low = ctx.createBiquadFilter()
  low.type = 'lowshelf'
  low.frequency.value = 100
  const mid = ctx.createBiquadFilter()
  mid.type = 'peaking'
  mid.Q.value = 0.9
  const high = ctx.createBiquadFilter()
  high.type = 'highshelf'
  high.frequency.value = 8000
  const comp = ctx.createDynamicsCompressor()
  comp.knee.value = 6
  const compWet = ctx.createGain()
  const compDry = ctx.createGain()
  const pan = ctx.createStereoPanner()
  const fader = ctx.createGain()
  const reverb = ctx.createGain()
  const delay = ctx.createGain()
  input.connect(lowCut).connect(highCut).connect(low).connect(mid).connect(high)
  high.connect(comp).connect(compWet).connect(pan)
  high.connect(compDry).connect(pan)
  pan.connect(fader)
  if (sends) {
    fader.connect(reverb).connect(sends.reverb)
    fader.connect(delay).connect(sends.delay)
  }
  const strip: Strip = { input, lowCut, highCut, low, mid, high, comp, compWet, compDry, pan, fader, reverb, delay }
  if (meters) {
    const split = ctx.createChannelSplitter(2)
    fader.connect(split)
    const l = ctx.createAnalyser()
    const r = ctx.createAnalyser()
    l.fftSize = r.fftSize = 1024
    split.connect(l, 0)
    split.connect(r, 1)
    strip.meter = [l, r]
  }
  return strip
}

function applyStrip(ctx: BaseAudioContext, strip: Strip, s: ChannelSettings, on: boolean, smooth: boolean) {
  const key = JSON.stringify([s, on])
  if (strip.key === key) return
  strip.key = key
  const set = (p: AudioParam, v: number) => {
    if (smooth) p.setTargetAtTime(v, ctx.currentTime, 0.012)
    else p.value = v
  }
  const eq = s.eq && !s.eq.bypass ? s.eq : {}
  strip.lowCut.type = eq.lowCut ? 'highpass' : 'allpass'
  strip.lowCut.frequency.value = eq.lowCut || 20
  strip.lowCut.Q.value = 0.707
  strip.highCut.type = eq.highCut ? 'lowpass' : 'allpass'
  strip.highCut.frequency.value = eq.highCut || 20000
  strip.highCut.Q.value = 0.707
  set(strip.low.gain, eq.low ?? 0)
  set(strip.mid.gain, eq.mid ?? 0)
  strip.mid.frequency.value = eq.midFreq ?? 1000
  set(strip.high.gain, eq.high ?? 0)
  const d = s.dynamics && !s.dynamics.bypass ? s.dynamics : null
  strip.comp.threshold.value = d?.threshold ?? -24
  strip.comp.ratio.value = d?.ratio ?? 4
  strip.comp.attack.value = d?.attack ?? 0.01
  strip.comp.release.value = d?.release ?? 0.25
  set(strip.compWet.gain, d ? dbToGain(d.makeup ?? 0) : 0)
  set(strip.compDry.gain, d ? 0 : 1)
  set(strip.pan.pan, Math.max(-1, Math.min(1, s.pan ?? 0)))
  set(strip.fader.gain, on ? dbToGain(s.gain ?? 0) : 0)
  set(strip.reverb.gain, Math.max(0, Math.min(1, s.reverb ?? 0)))
  set(strip.delay.gain, Math.max(0, Math.min(1, s.delay ?? 0)))
}

/** A stereo reverb tail: decaying noise, a little darker as it fades. */
function impulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.max(1, Math.round(seconds * ctx.sampleRate))
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  let seed = 12345
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c)
    let lp = 0
    for (let i = 0; i < length; i++) {
      const t = i / length
      const k = 0.15 + 0.8 * (1 - t)
      lp += ((rand() * 2 - 1) - lp) * k
      data[i] = lp * (1 - t) ** 3 * 0.6
    }
  }
  return buffer
}

/**
 * The console as a Web Audio graph. Clips connect to `input(channelId)`; `set` changes any setting
 * while playing (smoothly); `levels` reads the meters when built with `meters: true`.
 */
export class MixGraph {
  private channels = new Map<string, { strip: Strip; bus: MixBus }>()
  private buses = new Map<MixBus, Strip>()
  private master: Strip
  private limiter: DynamicsCompressorNode
  private limitWet: GainNode
  private limitDry: GainNode
  private reverb: ConvolverNode
  private reverbSize = -1
  private delay: DelayNode
  private feedback: GainNode
  private ctx: BaseAudioContext
  private settings: MixerSettings
  private meters: boolean

  constructor(ctx: BaseAudioContext, channels: { id: string; bus: MixBus }[], settings: MixerSettings, options: { meters?: boolean; destination?: AudioNode } = {}) {
    this.ctx = ctx
    this.settings = settings
    this.meters = !!options.meters
    this.master = createStrip(ctx, null, this.meters)
    // Shared effects return into the master.
    this.reverb = ctx.createConvolver()
    this.reverb.connect(this.master.input)
    this.delay = ctx.createDelay(2)
    this.feedback = ctx.createGain()
    const tone = ctx.createBiquadFilter()
    tone.type = 'lowpass'
    tone.frequency.value = 5000
    this.delay.connect(tone).connect(this.feedback).connect(this.delay)
    tone.connect(this.master.input)
    const sends = { reverb: this.reverb, delay: this.delay }
    this.limiter = ctx.createDynamicsCompressor()
    this.limiter.threshold.value = -1.5
    this.limiter.knee.value = 0
    this.limiter.ratio.value = 20
    this.limiter.attack.value = 0.002
    this.limiter.release.value = 0.12
    this.limitWet = ctx.createGain()
    this.limitDry = ctx.createGain()
    const out = options.destination ?? ctx.destination
    this.master.fader.connect(this.limiter).connect(this.limitWet).connect(out)
    this.master.fader.connect(this.limitDry).connect(out)
    for (const b of BUSES) {
      const strip = createStrip(ctx, sends, this.meters)
      strip.fader.connect(this.master.input)
      this.buses.set(b, strip)
    }
    for (const c of channels) {
      if (this.channels.has(c.id)) continue
      const strip = createStrip(ctx, sends, this.meters)
      strip.fader.connect(this.buses.get(c.bus)!.input)
      this.channels.set(c.id, { strip, bus: c.bus })
    }
    this.apply(false)
  }

  input(id: string): AudioNode {
    return this.channels.get(id)?.strip.input ?? this.master.input
  }

  set(settings: MixerSettings) {
    this.settings = settings
    this.apply(true)
  }

  private apply(smooth: boolean) {
    const { ctx, settings } = this
    const ids = [...this.channels.keys()]
    const on = audible(ids.map((id) => settings.channels[id]))
    ids.forEach((id, i) => applyStrip(ctx, this.channels.get(id)!.strip, settings.channels[id] ?? {}, on[i], smooth))
    const busOn = audible(BUSES.map((b) => settings.buses[b]))
    BUSES.forEach((b, i) => applyStrip(ctx, this.buses.get(b)!, settings.buses[b] ?? {}, busOn[i], smooth))
    applyStrip(ctx, this.master, settings.master, !settings.master.mute, smooth)
    const limit = !!settings.master.limiter
    this.limitWet.gain.value = limit ? 1 : 0
    this.limitDry.gain.value = limit ? 0 : 1
    const size = Math.max(0.3, Math.min(8, settings.fx.reverb ?? 2.2))
    if (size !== this.reverbSize) {
      this.reverbSize = size
      this.reverb.buffer = impulse(ctx, size)
    }
    this.delay.delayTime.value = Math.max(0.02, Math.min(2, settings.fx.delay ?? 0.32))
    this.feedback.gain.value = Math.max(0, Math.min(0.9, settings.fx.feedback ?? 0.35))
  }

  /** Peak levels (linear, 0..1+) per strip since the last call: "a0", "bus:music", "master". */
  levels(): Record<string, [number, number]> {
    const out: Record<string, [number, number]> = {}
    const buf = new Float32Array(1024)
    const peak = (a: AnalyserNode) => {
      a.getFloatTimeDomainData(buf)
      let p = 0
      for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i]))
      return p
    }
    const read = (key: string, s: Strip) => {
      if (s.meter) out[key] = [peak(s.meter[0]), peak(s.meter[1])]
    }
    for (const [id, c] of this.channels) read(id, c.strip)
    for (const [b, s] of this.buses) read(`bus:${b}`, s)
    read('master', this.master)
    return out
  }

  /** Gain reduction of the compressors, in dB (negative), for the meters' GR lights. */
  reduction(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const [id, c] of this.channels) if (c.strip.compWet.gain.value > 0) out[id] = c.strip.comp.reduction
    for (const [b, s] of this.buses) if (s.compWet.gain.value > 0) out[`bus:${b}`] = s.comp.reduction
    if (this.master.compWet.gain.value > 0) out.master = this.master.comp.reduction
    return out
  }
}
