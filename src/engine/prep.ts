// Clip prep analysis: camera shake from vid.stab's motion fields, background noise and mains hum
// from the sound. No imports, so the CLI can load this file with Node directly.

/** One local motion field of a vid.stab `.trf` file: how a patch at (x, y) moved since the last frame. */
export interface LocalMotion {
  dx: number
  dy: number
  x: number
  y: number
}

/** Camera motion from one frame to the next: shift in pixels, rotation in radians. */
export interface Motion {
  dx: number
  dy: number
  da: number
}

/** The local motions of every frame of a vid.stab `.trf` file (format VID.STAB 1). */
export function parseTrf(text: string): LocalMotion[][] {
  const frames: LocalMotion[][] = []
  for (const line of text.split('\n')) {
    const m = /^Frame (\d+) \(List \d+ \[(.*)\]\)/.exec(line)
    if (!m) continue
    const list: LocalMotion[] = []
    for (const lm of m[2].matchAll(/\(LM (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/g)) {
      list.push({ dx: +lm[1], dy: +lm[2], x: +lm[3], y: +lm[4] })
    }
    frames[+m[1] - 1] = list
  }
  for (let i = 0; i < frames.length; i++) frames[i] ??= []
  return frames
}

function median(v: number[]): number {
  if (!v.length) return 0
  const s = [...v].sort((a, b) => a - b)
  const h = s.length >> 1
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2
}

/**
 * The camera motion behind a frame's local motions: shift (at the centre of the patches) plus a
 * small rotation about it, fitted by least squares after dropping patches that disagree (a subject moving).
 */
export function globalMotion(fields: LocalMotion[]): Motion {
  if (!fields.length) return { dx: 0, dy: 0, da: 0 }
  let use = fields
  let fit: Motion = { dx: median(fields.map((f) => f.dx)), dy: median(fields.map((f) => f.dy)), da: 0 }
  for (let pass = 0; pass < 2; pass++) {
    const cx = use.reduce((s, f) => s + f.x, 0) / use.length
    const cy = use.reduce((s, f) => s + f.y, 0) / use.length
    const tx = use.reduce((s, f) => s + f.dx, 0) / use.length
    const ty = use.reduce((s, f) => s + f.dy, 0) / use.length
    // dx = tx - a·(y - cy), dy = ty + a·(x - cx)
    let num = 0
    let den = 0
    for (const f of use) {
      const rx = f.x - cx
      const ry = f.y - cy
      num += -(f.dx - tx) * ry + (f.dy - ty) * rx
      den += rx * rx + ry * ry
    }
    const a = den ? num / den : 0
    fit = { dx: tx, dy: ty, da: a }
    const res = fields.map((f) => Math.hypot(f.dx - (tx - a * (f.y - cy)), f.dy - (ty + a * (f.x - cx))))
    const limit = Math.max(1.5, 3 * median(res))
    const kept = fields.filter((_, i) => res[i] <= limit)
    if (kept.length < 3) break
    use = kept
  }
  return fit
}

export interface Shake {
  /** Shake left after removing the intended camera move: RMS distance from the smoothed path, px. */
  jitter: number
  /** The same, as a percentage of the frame width. */
  jitterPct: number
  /** How much the picture must be enlarged to hide the edges once stabilized, percent (estimate). */
  zoom: number
}

/**
 * Shake of a clip from its frame-to-frame motions. `smoothing` is vid.stab's: frames on each side
 * of the gaussian that keeps the intended move.
 */
export function measureShake(motions: Motion[], width: number, height: number, smoothing: number): Shake {
  const n = motions.length
  if (!n) return { jitter: 0, jitterPct: 0, zoom: 0 }
  const path = { x: [0], y: [0], a: [0] }
  for (let i = 1; i < n; i++) {
    path.x.push(path.x[i - 1] + motions[i].dx)
    path.y.push(path.y[i - 1] + motions[i].dy)
    path.a.push(path.a[i - 1] + motions[i].da)
  }
  const sigma = Math.max(1, smoothing / 2)
  const smooth = (v: number[], i: number) => {
    let s = 0
    let w = 0
    // Symmetric window, narrower near the ends, so a steady pan is not mistaken for shake there.
    const half = Math.min(smoothing, i, n - 1 - i)
    for (let k = i - half; k <= i + half; k++) {
      const g = Math.exp(-0.5 * ((k - i) / sigma) ** 2)
      s += v[k] * g
      w += g
    }
    return s / w
  }
  let sum = 0
  let zoom = 1
  for (let i = 0; i < n; i++) {
    const cx = smooth(path.x, i) - path.x[i]
    const cy = smooth(path.y, i) - path.y[i]
    const ca = Math.abs(smooth(path.a, i) - path.a[i])
    sum += cx * cx + cy * cy
    zoom = Math.max(zoom, 1 + (2 * Math.abs(cx)) / width + (ca * height) / width, 1 + (2 * Math.abs(cy)) / height + (ca * width) / height)
  }
  const jitter = Math.sqrt(sum / n)
  return { jitter: round(jitter, 1), jitterPct: round((100 * jitter) / width, 2), zoom: round((zoom - 1) * 100, 1) }
}

function round(v: number, d: number) {
  const k = 10 ** d
  return Math.round(v * k) / k
}

export interface Noise {
  /** Level of the quiet parts (10th percentile of 50 ms windows), dBFS. */
  floor: number
  /** Level of the loud parts (95th percentile), dBFS. */
  signal: number
  /** Mains hum found in the quietest second: 50 or 60 Hz, or 0. */
  hum: 0 | 50 | 60
  /** Where the quietest half second starts, seconds: a good noise sample. */
  quietAt: number
}

/** Power of `x` at `freq` (Goertzel), per sample. */
function tone(x: Float32Array, from: number, to: number, freq: number, rate: number): number {
  const w = (2 * Math.PI * freq) / rate
  const c = 2 * Math.cos(w)
  let s1 = 0
  let s2 = 0
  for (let i = from; i < to; i++) {
    const s0 = x[i] + c * s1 - s2
    s2 = s1
    s1 = s0
  }
  const n = to - from
  return (s1 * s1 + s2 * s2 - c * s1 * s2) / (n * n)
}

/** Background noise and hum of mono samples. */
export function measureNoise(x: Float32Array, rate: number): Noise {
  const win = Math.round(rate * 0.05)
  const levels: number[] = []
  for (let i = 0; i + win <= x.length; i += win) {
    let e = 0
    for (let k = i; k < i + win; k++) e += x[k] * x[k]
    levels.push(e / win)
  }
  if (!levels.length) return { floor: -120, signal: -120, hum: 0, quietAt: 0 }
  const db = (p: number) => round(10 * Math.log10(p + 1e-12), 1)
  const sorted = [...levels].sort((a, b) => a - b)
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
  // Quietest 0.5 s (10 windows).
  let best = 0
  let bestE = Infinity
  for (let i = 0; i + 10 <= levels.length; i++) {
    let e = 0
    for (let k = i; k < i + 10; k++) e += levels[k]
    if (e < bestE) {
      bestE = e
      best = i
    }
  }
  // Hum: the mains tone and its harmonics 9 dB or more above the frequencies between them, in the quietest second.
  const from = best * win
  const to = Math.min(x.length, from + rate)
  let hum: 0 | 50 | 60 = 0
  let humScore = 0
  for (const f of [50, 60] as const) {
    let on = 0
    let off = 0
    for (const h of [1, 2, 3]) {
      on += tone(x, from, to, f * h, rate)
      off += tone(x, from, to, f * h + f / 2, rate)
    }
    const ratio = on / (off + 1e-15)
    if (ratio > 8 && ratio > humScore) {
      humScore = ratio
      hum = f
    }
  }
  return { floor: db(pick(0.1)), signal: db(pick(0.95)), hum, quietAt: round((best * win) / rate, 2) }
}
