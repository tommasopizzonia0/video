import { describe, expect, it } from 'vitest'
import { globalMotion, measureNoise, measureShake, parseTrf, type LocalMotion, type Motion } from './prep'

describe('clip prep: shake', () => {
  it('reads vid.stab motion files', () => {
    const trf = 'VID.STAB 1\n#      accuracy = 15\nFrame 1 (List 0 [])\nFrame 2 (List 2 [(LM 6 9 702 216 112 0.59 3.2),(LM -1.5 7 864 1456 112 0.52 1.8)])\n'
    expect(parseTrf(trf)).toEqual([[], [{ dx: 6, dy: 9, x: 702, y: 216 }, { dx: -1.5, dy: 7, x: 864, y: 1456 }]])
  })

  it('finds shift and rotation, ignoring a subject that moves on its own', () => {
    const fields: LocalMotion[] = []
    const [tx, ty, a] = [4, -3, 0.01]
    for (let x = 100; x <= 1000; x += 150) {
      for (let y = 100; y <= 1800; y += 200) fields.push({ x, y, dx: tx - a * (y - 900), dy: ty + a * (x - 550) })
    }
    // The patches are centred on (550, 900). A person walking through a corner of the frame.
    for (let i = 0; i < 6; i++) fields.push({ x: 900, y: 1700 - i * 20, dx: 40, dy: 0 })
    const m = globalMotion(fields)
    expect(m.da).toBeCloseTo(a, 4)
    expect(m.dx).toBeCloseTo(tx, 1)
    expect(m.dy).toBeCloseTo(ty, 1)
  })

  it('keeps the intended pan and measures only the shake', () => {
    const fps = 30
    const motions = (amp: number): Motion[] =>
      Array.from({ length: 300 }, (_, i) => {
        const t = i / fps
        const x = (s: number) => 5 * s + amp * Math.sin(2 * Math.PI * 4 * s)
        return { dx: i ? x(t) - x(t - 1 / fps) : 0, dy: 0, da: 0 }
      })
    const pan = measureShake(motions(0), 1080, 1920, 30)
    expect(pan.jitter).toBeLessThan(0.2)
    const shaky = measureShake(motions(20), 1080, 1920, 30)
    // A 20 px sine has an RMS of 14 px.
    expect(shaky.jitter).toBeGreaterThan(13)
    expect(shaky.jitter).toBeLessThan(15)
    // Enough to cover ±20 px on each side of 1080.
    expect(shaky.zoom).toBeGreaterThanOrEqual(3.6)
    expect(shaky.zoom).toBeLessThan(5)
  })
})

describe('clip prep: noise', () => {
  const rate = 48000
  function signal(hum: number, noise: number) {
    const x = new Float32Array(rate * 4)
    let seed = 1
    for (let i = 0; i < x.length; i++) {
      seed = (seed * 16807) % 2147483647
      const t = i / rate
      // "Speech" in the first 3 s (bursts), silence after.
      const voice = t < 3 && Math.sin(2 * Math.PI * 3 * t) > 0 ? 0.3 * Math.sin(2 * Math.PI * 220 * t) : 0
      x[i] = voice + noise * (seed / 2147483647 - 0.5) + hum * (Math.sin(2 * Math.PI * hum_f * t) + 0.5 * Math.sin(2 * Math.PI * 3 * hum_f * t))
    }
    return x
  }
  let hum_f = 50

  it('measures the floor, the loud parts and where it is quiet', () => {
    const n = measureNoise(signal(0, 0.01), rate)
    expect(n.hum).toBe(0)
    expect(n.signal - n.floor).toBeGreaterThan(30)
    expect(n.quietAt).toBeGreaterThanOrEqual(0.5)
  })

  it('finds 50 and 60 Hz hum', () => {
    hum_f = 50
    expect(measureNoise(signal(0.01, 0.01), rate).hum).toBe(50)
    hum_f = 60
    expect(measureNoise(signal(0.01, 0.01), rate).hum).toBe(60)
  })
})
