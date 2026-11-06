// Beat tracking for cutting on the music: onset strength (spectral flux), tempo (autocorrelation
// with a preference around 120 BPM) and beat times (dynamic programming, after Ellis 2007).
// No imports, so the CLI can load this file with Node directly. Times in seconds.

export interface BeatAnalysis {
  /** Beats per minute of the steady pulse. */
  bpm: number
  /** Every beat, in seconds from the start of the file. */
  beats: number[]
  /** Index in `beats` of the first beat of each bar (4/4 assumed; an estimate). */
  downbeats: number[]
  /** Loudness of the music on each beat, dB relative to its loudest beat. */
  energy: number[]
  /** Beats where the music jumps up (a drop, a new section): good places for the big cut. */
  hits: number[]
  /** How regular the pulse is, 0..1: low values mean the beats are guesses (ambient, rubato). */
  confidence: number
}

const HOP = 256
const WIN = 1024

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k + len / 2] = re[i + k] - ar
        im[i + k + len / 2] = im[i + k] - ai
        re[i + k] += ar
        im[i + k] += ai
        const t = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = t
      }
    }
  }
}

/** Onset strength per hop: summed positive change of the log spectrum, high-passed and normalized. */
export function onsetEnvelope(samples: Float32Array, rate: number): { env: Float64Array; fps: number; rms: Float64Array; low: Float64Array } {
  const frames = Math.max(0, Math.floor((samples.length - WIN) / HOP) + 1)
  const env = new Float64Array(frames)
  // Flux below ~200 Hz alone: kick and bass, which in pop and dance music fall on the beat.
  const low = new Float64Array(frames)
  const lowTop = Math.max(2, Math.round((200 / rate) * WIN))
  const rms = new Float64Array(frames)
  const window = new Float64Array(WIN).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WIN))
  const bins = WIN / 2
  // Up to ~8 kHz: above it there is mostly noise for rhythm.
  const top = Math.min(bins, Math.round((8000 / rate) * WIN))
  // Mel-like weighting: as many "ears" per hertz as a mel scale, so a kick drum counts as much as
  // the noise of a hi-hat (which spreads over hundreds of bins and would win the offbeats).
  const weight = new Float64Array(top).map((_, k) => 700 / (700 + (k * rate) / WIN))
  let prev = new Float64Array(top)
  const re = new Float64Array(WIN)
  const im = new Float64Array(WIN)
  for (let f = 0; f < frames; f++) {
    let e = 0
    for (let i = 0; i < WIN; i++) {
      const s = samples[f * HOP + i]
      re[i] = s * window[i]
      im[i] = 0
      e += s * s
    }
    rms[f] = Math.sqrt(e / WIN)
    fft(re, im)
    const cur = new Float64Array(top)
    let flux = 0
    for (let k = 1; k < top; k++) {
      cur[k] = Math.log1p(100 * Math.hypot(re[k], im[k]))
      const d = cur[k] - prev[k]
      if (d > 0) {
        flux += d * weight[k]
        if (k < lowTop) low[f] += d
      }
    }
    env[f] = flux
    prev = cur
  }
  // Subtract a local mean (~0.5 s) so slow swells don't read as beats, keep the positive part.
  const fps = rate / HOP
  const half = Math.round(fps * 0.25)
  const out = new Float64Array(frames)
  let sum = 0
  let count = 0
  for (let i = 0; i < Math.min(frames, half); i++) {
    sum += env[i]
    count++
  }
  for (let i = 0; i < frames; i++) {
    const add = i + half
    const drop = i - half - 1
    if (add < frames) {
      sum += env[add]
      count++
    }
    if (drop >= 0) {
      sum -= env[drop]
      count--
    }
    out[i] = Math.max(0, env[i] - sum / count)
  }
  const sd = Math.sqrt(out.reduce((a, v) => a + v * v, 0) / Math.max(1, frames)) || 1
  for (let i = 0; i < frames; i++) out[i] /= sd
  return { env: out, fps, rms, low }
}

/** The beat period in hops: autocorrelation weighted toward 120 BPM (one octave of spread). */
export function estimatePeriod(env: Float64Array, fps: number): { period: number; confidence: number } {
  const minLag = Math.floor((fps * 60) / 200)
  const maxLag = Math.ceil((fps * 60) / 50)
  let best = minLag
  let bestScore = -Infinity
  const scores: number[] = []
  for (let lag = minLag; lag <= maxLag; lag++) {
    let ac = 0
    for (let i = lag; i < env.length; i++) ac += env[i] * env[i - lag]
    ac /= env.length - lag
    const bpm = (60 * fps) / lag
    const w = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2)
    const s = ac * w
    scores.push(s)
    if (s > bestScore) {
      bestScore = s
      best = lag
    }
  }
  // Refine to a fractional lag with a parabola through the peak.
  const i = best - minLag
  let period = best
  if (i > 0 && i < scores.length - 1) {
    const [a, b, c] = [scores[i - 1], scores[i], scores[i + 1]]
    const den = a - 2 * b + c
    if (den < 0) period = best + (0.5 * (a - c)) / den
  }
  const mean = scores.reduce((x, y) => x + y, 0) / scores.length
  const confidence = bestScore > 0 ? Math.max(0, Math.min(1, (bestScore - mean) / bestScore)) : 0
  return { period, confidence }
}

/** Beat frames by dynamic programming: strong onsets, spaced close to the period. */
export function trackBeats(env: Float64Array, period: number, tightness = 100): number[] {
  const n = env.length
  if (!n) return []
  const score = new Float64Array(n)
  const back = new Int32Array(n).fill(-1)
  const lo = Math.round(period / 2)
  const hi = Math.round(period * 2)
  for (let t = 0; t < n; t++) {
    let bestPrev = -1
    let bestVal = 0
    for (let p = t - hi; p <= t - lo; p++) {
      if (p < 0) continue
      const v = score[p] - tightness * Math.log((t - p) / period) ** 2
      if (bestPrev < 0 || v > bestVal) {
        bestVal = v
        bestPrev = p
      }
    }
    score[t] = env[t] + (bestPrev >= 0 ? Math.max(0, bestVal) : 0)
    back[t] = bestVal > 0 ? bestPrev : -1
  }
  // End on the best-scoring frame within the last period.
  let t = n - 1
  for (let i = Math.max(0, n - Math.round(period)); i < n; i++) if (score[i] > score[t]) t = i
  const beats: number[] = []
  while (t >= 0) {
    beats.push(t)
    t = back[t]
  }
  beats.reverse()
  // Before the first strong beat the chain may stop early: extend backwards on the grid.
  while (beats.length && beats[0] - period >= 0) beats.unshift(Math.round(beats[0] - period))
  return beats
}

/**
 * Loud hi-hats on the off-beats can pull the tracker half a beat off. The kick sits on the beat,
 * so when the low end hits harder halfway between the beats than on them, move the grid there.
 */
export function onKick(frames: number[], low: Float64Array, period: number): number[] {
  if (frames.length < 4) return frames
  const at = (f: number) => {
    let m = 0
    for (let k = Math.max(0, f - 2); k <= Math.min(low.length - 1, f + 2); k++) m = Math.max(m, low[k])
    return m
  }
  const half = period / 2
  const mids = frames.slice(0, -1).map((f, i) => Math.round((f + frames[i + 1]) / 2))
  const on = frames.reduce((s, f) => s + at(f), 0) / frames.length
  const off = mids.reduce((s, f) => s + at(f), 0) / mids.length
  if (off <= on * 1.5) return frames
  const out = [...mids]
  if (frames[0] - half >= 0) out.unshift(Math.round(frames[0] - half))
  if (frames[frames.length - 1] + half < low.length) out.push(Math.round(frames[frames.length - 1] + half))
  return out
}

/** Full analysis of mono samples. */
export function analyzeBeats(samples: Float32Array, rate: number): BeatAnalysis {
  const { env, fps, rms, low } = onsetEnvelope(samples, rate)
  const { period, confidence } = estimatePeriod(env, fps)
  const frames = onKick(trackBeats(env, period), low, period)
  // Each beat on the onset peak near it, with a sub-frame position from a parabola.
  const precise = frames.map((f) => {
    let m = f
    for (let k = Math.max(1, f - 2); k <= Math.min(env.length - 2, f + 2); k++) if (env[k] > env[m]) m = k
    if (m <= 0 || m >= env.length - 1 || env[m] <= 0) return f
    const [a, b, c] = [env[m - 1], env[m], env[m + 1]]
    const den = a - 2 * b + c
    return den < 0 ? m + (0.5 * (a - c)) / den : m
  })
  // Frame f covers samples f·HOP .. f·HOP + WIN; an attack shows when it reaches the window's middle.
  const latency = (WIN / 2 + HOP / 2) / rate
  const beats = precise.map((f) => Math.max(0, Math.round((f / fps + latency) * 1000) / 1000))
  // Loudness around each beat (up to the next), in dB below the loudest beat.
  const db = frames.map((f, i) => {
    const end = frames[i + 1] ?? Math.min(rms.length, f + Math.round(period))
    let s = 0
    let c = 0
    for (let k = f; k < end; k++) {
      s += rms[k] * rms[k]
      c++
    }
    return 10 * Math.log10(c ? s / c + 1e-12 : 1e-12)
  })
  const top = Math.max(...db)
  const energy = db.map((v) => Math.round((v - top) * 10) / 10)
  // Downbeats: of the four phases, the one whose beats carry the strongest onsets.
  const strength = frames.map((f) => Math.max(env[f - 1] ?? 0, env[f], env[f + 1] ?? 0))
  let phase = 0
  let bestPhase = -Infinity
  for (let p = 0; p < 4; p++) {
    let s = 0
    let c = 0
    for (let i = p; i < strength.length; i += 4) {
      s += strength[i]
      c++
    }
    if (c && s / c > bestPhase) {
      bestPhase = s / c
      phase = p
    }
  }
  const downbeats: number[] = []
  for (let i = phase; i < beats.length; i += 4) downbeats.push(i)
  // Hits: a beat at least 6 dB louder than the average of the 4 before it.
  const hits: number[] = []
  for (let i = 4; i < energy.length; i++) {
    const before = (energy[i - 1] + energy[i - 2] + energy[i - 3] + energy[i - 4]) / 4
    if (energy[i] - before >= 6 && (!hits.length || i - hits[hits.length - 1] >= 4)) hits.push(i)
  }
  const bpm = Math.round(((60 * fps) / period) * 10) / 10
  return { bpm, beats, downbeats, energy, hits, confidence: Math.round(confidence * 100) / 100 }
}
