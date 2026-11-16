// Built-in sound effects, synthesized in code: no sample files, no licenses, identical every run.
// Each effect knows where its peak is, so a clip's `start` marks the moment the sound should hit
// (the impact frame, the end of a riser, the middle of a whoosh).

import type { SfxName } from './types'

export const SFX_NAMES: SfxName[] = ['whoosh', 'impact', 'riser', 'click', 'pop', 'tick', 'sparkle', 'boom', 'hit', 'swoosh', 'reverse', 'beat']

export interface Synth {
  samples: Float32Array
  /** Seconds from the start of the sound to its peak. */
  peak: number
}

/** Default lengths in seconds; whoosh and riser can be stretched with the clip's `duration`. */
export const SFX_LENGTH: Record<SfxName, number> = {
  whoosh: 0.55,
  impact: 0.9,
  riser: 1.6,
  click: 0.06,
  pop: 0.12,
  tick: 0.05,
  sparkle: 0.9,
  boom: 1.8,
  hit: 2.2,
  swoosh: 0.38,
  reverse: 1.1,
  beat: 8,
}

function noise(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return (s / 4294967296) * 2 - 1
  }
}

/** State-variable band-pass, cheap and stable for sweeping cutoffs. */
function bandpass(rate: number) {
  let low = 0
  let band = 0
  return (x: number, freq: number, q: number) => {
    const f = 2 * Math.sin((Math.PI * Math.min(freq, rate / 6)) / rate)
    const high = x - low - band / q
    band += f * high
    low += f * band
    return band
  }
}

function normalize(buf: Float32Array, peak = 0.5): Float32Array {
  let max = 0
  for (const v of buf) max = Math.max(max, Math.abs(v))
  if (max > 0) for (let i = 0; i < buf.length; i++) buf[i] *= peak / max
  return buf
}

/** Synthesizes `name` at `rate` Hz, mono. `length` stretches whoosh and riser. */
export function synthSfx(name: SfxName, rate: number, length?: number): Synth {
  const len = Math.max(0.02, length ?? SFX_LENGTH[name])
  const n = Math.max(1, Math.round(len * rate))
  const out = new Float32Array(n)
  const rnd = noise(name.length * 7919 + Math.round(len * 1000))
  switch (name) {
    case 'whoosh': {
      // Filtered noise whose band sweeps up then down, peaking just after the middle.
      const bp = bandpass(rate)
      const peakAt = 0.55
      for (let i = 0; i < n; i++) {
        const u = i / n
        const env = u < peakAt ? Math.sin(((u / peakAt) * Math.PI) / 2) ** 3 : Math.cos((((u - peakAt) / (1 - peakAt)) * Math.PI) / 2) ** 2
        const freq = 350 + 2600 * Math.sin(Math.PI * u) ** 2
        out[i] = bp(rnd(), freq, 0.9) * env
      }
      return { samples: normalize(out, 0.45), peak: len * peakAt }
    }
    case 'impact': {
      // A falling sine thump with a short noisy transient on top.
      const bp = bandpass(rate)
      let phase = 0
      for (let i = 0; i < n; i++) {
        const t = i / rate
        const freq = 42 + 95 * Math.exp(-t / 0.05)
        phase += (2 * Math.PI * freq) / rate
        const body = Math.sin(phase) * Math.exp(-t / 0.22)
        const crack = bp(rnd(), 1800, 0.7) * Math.exp(-t / 0.012) * 0.8
        out[i] = body + crack
      }
      return { samples: normalize(out, 0.6), peak: 0.004 }
    }
    case 'riser': {
      // Noise and a tone climbing together, swelling into an abrupt stop on the peak.
      const bp = bandpass(rate)
      let phase = 0
      for (let i = 0; i < n; i++) {
        const u = i / n
        const freq = 220 * 2 ** (u * 2)
        phase += (2 * Math.PI * freq) / rate
        const env = u ** 2.2 * Math.min(1, (1 - u) * 60)
        out[i] = (bp(rnd(), 300 + 4200 * u * u, 1.4) * 0.8 + Math.sin(phase) * 0.25) * env
      }
      return { samples: normalize(out, 0.45), peak: len * 0.985 }
    }
    case 'click': {
      for (let i = 0; i < n; i++) {
        const t = i / rate
        out[i] = (rnd() * Math.exp(-t / 0.0015) + Math.sin(2 * Math.PI * 3200 * t) * Math.exp(-t / 0.006)) * 0.8
      }
      return { samples: normalize(out, 0.5), peak: 0.001 }
    }
    case 'pop': {
      let phase = 0
      for (let i = 0; i < n; i++) {
        const t = i / rate
        phase += (2 * Math.PI * (380 + 700 * Math.min(1, t / 0.03))) / rate
        out[i] = Math.sin(phase) * Math.exp(-t / 0.035) * Math.min(1, t / 0.002)
      }
      return { samples: normalize(out, 0.5), peak: 0.004 }
    }
    case 'tick': {
      for (let i = 0; i < n; i++) {
        const t = i / rate
        out[i] = Math.sin(2 * Math.PI * 1900 * t) * Math.exp(-t / 0.008) * Math.min(1, t / 0.0005)
      }
      return { samples: normalize(out, 0.4), peak: 0.001 }
    }
    case 'sparkle': {
      // A short cascade of bright, slightly detuned bell partials.
      const notes = [2637, 3520, 4186, 5274, 6272]
      notes.forEach((f, k) => {
        const at = Math.round(k * 0.045 * rate)
        for (let i = at; i < n; i++) {
          const t = (i - at) / rate
          out[i] += (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2.01 * t)) * Math.exp(-t / 0.18) * Math.min(1, t / 0.001) * (1 - k * 0.12)
        }
      })
      return { samples: normalize(out, 0.35), peak: 0.002 }
    }
    case 'boom': {
      // Trailer sub drop: a saturated 808-style sine diving from 110 to 34 Hz, a click on top and a
      // long dark tail. Felt more than heard: the "drop" of an ad.
      let phase = 0
      for (let i = 0; i < n; i++) {
        const t = i / rate
        const freq = 34 + 76 * Math.exp(-t / 0.09)
        phase += (2 * Math.PI * freq) / rate
        const body = Math.tanh(2.2 * Math.sin(phase)) * Math.exp(-t / 0.55) * Math.min(1, t / 0.0015)
        const click = rnd() * Math.exp(-t / 0.004) * 0.5
        out[i] = body + click
      }
      return { samples: normalize(out, 0.6), peak: 0.004 }
    }
    case 'hit': {
      // Cinematic hit: the boom, a metallic inharmonic clang and a noise burst, with a few early
      // reflections for size.
      const bp = bandpass(rate)
      let phase = 0
      const partials = [182, 297, 433, 611, 887]
      for (let i = 0; i < n; i++) {
        const t = i / rate
        const freq = 36 + 80 * Math.exp(-t / 0.08)
        phase += (2 * Math.PI * freq) / rate
        const sub = Math.tanh(2 * Math.sin(phase)) * Math.exp(-t / 0.6)
        let metal = 0
        for (let k = 0; k < partials.length; k++) metal += Math.sin(2 * Math.PI * partials[k] * t + k) * Math.exp(-t / (0.35 - k * 0.05))
        const burst = bp(rnd(), 2400, 0.6) * Math.exp(-t / 0.05)
        out[i] = (sub + metal * 0.18 + burst * 0.7) * Math.min(1, t / 0.001)
      }
      const taps = [0.023, 0.041, 0.067, 0.093].map((s) => Math.round(s * rate))
      for (let i = n - 1; i >= 0; i--) for (let k = 0; k < taps.length; k++) if (i - taps[k] >= 0) out[i] += out[i - taps[k]] * (0.35 - k * 0.07)
      return { samples: normalize(out, 0.6), peak: 0.004 }
    }
    case 'swoosh': {
      // A fast, bright pass-by: noise sweeping high with a falling "doppler" tone, peak in the middle.
      const bp = bandpass(rate)
      let phase = 0
      for (let i = 0; i < n; i++) {
        const u = i / n
        const env = Math.sin(Math.PI * u) ** 4
        const freq = 900 + 6500 * Math.sin(Math.PI * u) ** 2
        phase += (2 * Math.PI * (520 - 300 * u)) / rate
        out[i] = (bp(rnd(), freq, 1.1) + Math.sin(phase) * 0.12) * env
      }
      return { samples: normalize(out, 0.5), peak: len * 0.5 }
    }
    case 'reverse': {
      // Reverse cymbal: bright noise swelling exponentially and cut dead on the hit.
      const bp = bandpass(rate)
      for (let i = 0; i < n; i++) {
        const u = i / n
        const env = Math.exp(5 * (u - 1)) * Math.min(1, (1 - u) * 200)
        out[i] = (bp(rnd(), 3500 + 2500 * u, 1) + rnd() * 0.25) * env
      }
      return { samples: normalize(out, 0.45), peak: len * 0.995 }
    }
    case 'beat': {
      // A music bed for ads: 124 BPM, four-on-the-floor kick, claps on 2 and 4, sixteenth hats, a
      // driving bass and a warm chord pad (C – G – Am – F), all pumping with the kick. Stretch it
      // with `duration`; it starts on a downbeat.
      const beatLen = 60 / 124
      const chords = [
        [130.81, 164.81, 196.0, 261.63],
        [98.0, 123.47, 146.83, 196.0],
        [110.0, 130.81, 164.81, 220.0],
        [87.31, 110.0, 130.81, 174.61],
      ]
      const roots = [65.41, 49.0, 55.0, 43.65]
      const hatBp = bandpass(rate)
      const clapBp = bandpass(rate)
      let lp = 0
      for (let i = 0; i < n; i++) {
        const t = i / rate
        const beat = t / beatLen
        const inBeat = (beat % 1) * beatLen
        const bar = Math.floor(beat / 4) % 4
        const kick = Math.sin(2 * Math.PI * (45 * inBeat + 4 * (1 - Math.exp(-inBeat * 30)))) * Math.exp(-inBeat / 0.16)
        const clap = clapBp(rnd(), 1500, 0.8) * (Math.floor(beat) % 2 === 1 ? Math.exp(-inBeat / 0.06) : 0)
        const sixT = ((beat * 4) % 1) * (beatLen / 4)
        const accent = Math.floor(beat * 4) % 2 === 1 ? 1 : 0.55
        const hat = hatBp(rnd(), 6000, 1) * Math.exp(-sixT / 0.018) * accent
        let pad = 0
        for (const f of chords[bar]) for (const det of [0.997, 1.003]) pad += ((t * f * det) % 1) * 2 - 1
        lp += 0.035 * (pad / 8 - lp)
        const pump = 1 - 0.85 * Math.exp(-inBeat / 0.12)
        const padEnv = 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, ((beat % 4) / 4) * 1.2))
        const bass = Math.tanh(1.8 * Math.sin(2 * Math.PI * roots[bar] * t)) * (0.6 + 0.4 * Math.cos(2 * Math.PI * beat * 2)) * pump
        const edge = Math.min(1, t / 0.02, (len - t) / 0.4)
        out[i] = (kick * 0.9 + clap * 0.35 + hat * 0.12 + lp * 0.55 * pump * padEnv + bass * 0.32) * edge
      }
      return { samples: normalize(out, 0.55), peak: 0 }
    }
  }
}
