// Loudness: ITU-R BS.1770 integrated loudness (LUFS), gain normalization and WAV encoding.
// Social platforms play everything around -14 LUFS, so a mix measured and set there sounds as loud
// as the videos around it without being turned down (or clipping).

export const DEFAULT_LOUDNESS = -14
export const PEAK_CEILING_DB = -1

type Biquad = [number, number, number, number, number] // b0 b1 b2 a1 a2

/** The two K-weighting filters of BS.1770 for any sample rate (high shelf, then high-pass). */
function kWeighting(rate: number): Biquad[] {
  let K = Math.tan((Math.PI * 1681.974450955533) / rate)
  const Q1 = 0.7071752369554196
  const Vh = 10 ** (3.999843853973347 / 20)
  const Vb = Vh ** 0.4996667741545416
  let a0 = 1 + K / Q1 + K * K
  const shelf: Biquad = [(Vh + (Vb * K) / Q1 + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q1 + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q1 + K * K) / a0]
  K = Math.tan((Math.PI * 38.13547087602444) / rate)
  const Q2 = 0.5003270373238773
  a0 = 1 + K / Q2 + K * K
  const highpass: Biquad = [1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q2 + K * K) / a0]
  return [shelf, highpass]
}

function filter(x: Float32Array, [b0, b1, b2, a1, a2]: Biquad): Float32Array {
  const y = new Float32Array(x.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1
    x1 = x[i]
    y2 = y1
    y1 = v
    y[i] = v
  }
  return y
}

/** Integrated loudness in LUFS of planar channels (gated, as in BS.1770-4). -Infinity for silence. */
export function integratedLoudness(channels: Float32Array[], rate: number): number {
  if (!channels.length || !channels[0].length) return -Infinity
  const [shelf, hp] = kWeighting(rate)
  const weighted = channels.map((c) => filter(filter(c, shelf), hp))
  const block = Math.round(0.4 * rate)
  const step = Math.round(0.1 * rate)
  const len = weighted[0].length
  const powers: number[] = []
  if (len < block) {
    // Shorter than one gating block: measure it whole.
    let sum = 0
    for (const c of weighted) for (const v of c) sum += v * v
    powers.push(sum / len)
  } else {
    // Running sums make each 400 ms block O(1).
    const prefix = weighted.map((c) => {
      const p = new Float64Array(c.length + 1)
      for (let i = 0; i < c.length; i++) p[i + 1] = p[i] + c[i] * c[i]
      return p
    })
    for (let s = 0; s + block <= len; s += step) {
      let sum = 0
      for (const p of prefix) sum += (p[s + block] - p[s]) / block
      powers.push(sum)
    }
  }
  const lufs = (p: number) => -0.691 + 10 * Math.log10(p)
  const mean = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length
  const absolute = powers.filter((p) => p > 0 && lufs(p) > -70)
  if (!absolute.length) return -Infinity
  const relativeGate = lufs(mean(absolute)) - 10
  const gated = absolute.filter((p) => lufs(p) > relativeGate)
  return lufs(mean(gated.length ? gated : absolute))
}

export function samplePeak(channels: Float32Array[]): number {
  let max = 0
  for (const c of channels) for (const v of c) max = Math.max(max, Math.abs(v))
  return max
}

/**
 * Gain (linear) that brings the mix to `target` LUFS without letting sample peaks exceed the
 * ceiling. Quiet passages are never boosted beyond what the peaks allow.
 */
export function normalizationGain(channels: Float32Array[], rate: number, target = DEFAULT_LOUDNESS, ceilingDb = PEAK_CEILING_DB): number {
  const loudness = integratedLoudness(channels, rate)
  if (!Number.isFinite(loudness)) return 1
  const gain = 10 ** ((target - loudness) / 20)
  const peak = samplePeak(channels)
  const limit = peak > 0 ? 10 ** (ceilingDb / 20) / peak : gain
  return Math.min(gain, limit)
}

/** 32-bit float WAV, so levels above 0 dBFS survive until the encoder normalizes them. */
export function encodeWav(channels: Float32Array[], rate: number): Uint8Array {
  const n = channels[0]?.length ?? 0
  const ch = channels.length
  const data = n * ch * 4
  const buf = new ArrayBuffer(44 + data)
  const v = new DataView(buf)
  const text = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  text(0, 'RIFF')
  v.setUint32(4, 36 + data, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 3, true) // IEEE float
  v.setUint16(22, ch, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * ch * 4, true)
  v.setUint16(32, ch * 4, true)
  v.setUint16(34, 32, true)
  text(36, 'data')
  v.setUint32(40, data, true)
  let o = 44
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      v.setFloat32(o, channels[c][i], true)
      o += 4
    }
  return new Uint8Array(buf)
}
