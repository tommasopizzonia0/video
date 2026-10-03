// Built-in sound effects, synthesized in code: no sample files, no licenses, identical every run.
// Each effect knows where its peak is, so a clip's `start` marks the moment the sound should hit
// (the impact frame, the end of a riser, the middle of a whoosh).

import type { SfxName } from './types'

export const SFX_NAMES: SfxName[] = ['whoosh', 'impact', 'riser', 'click', 'pop', 'tick', 'sparkle']

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
  }
}
