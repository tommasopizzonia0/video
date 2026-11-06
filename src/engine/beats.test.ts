import { describe, expect, it } from 'vitest'
import { analyzeBeats } from './beats'
import { applyBeatGrid, beatAt, nearestBeat, sceneCuts } from './beatgrid'
import { checkCuts } from './check'
import type { Composition } from './types'
import { validate } from './validate'

const RATE = 22050

/** A drum loop: kicks on the beats, quieter hats on the off-beats, louder from `drop` on. */
function loop(bpm: number, seconds: number, first: number, drop = Infinity): Float32Array {
  const x = new Float32Array(Math.round(seconds * RATE))
  const period = 60 / bpm
  const add = (at: number, gain: number, kind: 'kick' | 'hat') => {
    const i0 = Math.round(at * RATE)
    const len = Math.round((kind === 'kick' ? 0.4 : 0.05) * RATE)
    let phase = 0
    for (let i = 0; i < len && i0 + i < x.length; i++) {
      const t = i / RATE
      if (kind === 'kick') {
        phase += (2 * Math.PI * (45 + 80 * Math.exp(-t * 35))) / RATE
        x[i0 + i] += gain * Math.sin(phase) * Math.exp(-t * 12)
      } else {
        // Deterministic noise.
        const n = Math.sin(i * 12.9898 + at * 78.233) * 43758.5453
        x[i0 + i] += gain * 0.5 * (n - Math.floor(n) - 0.5) * Math.exp(-t * 90)
      }
    }
  }
  for (let t = first; t < seconds - 0.1; t += period) {
    const g = t >= drop ? 0.9 : 0.25
    add(t, g, 'kick')
    add(t + period / 2, g * 1.2, 'hat')
  }
  return x
}

describe('beat tracking', () => {
  for (const [bpm, first] of [
    [120, 0.25],
    [97, 0.1],
    [140, 0.4],
  ]) {
    it(`finds ${bpm} BPM and lands within 15 ms of every kick, even with loud off-beat hats`, () => {
      const a = analyzeBeats(loop(bpm, 16, first), RATE)
      expect(a.bpm).toBeGreaterThan(bpm * 0.99)
      expect(a.bpm).toBeLessThan(bpm * 1.01)
      const period = 60 / bpm
      const errors = a.beats.map((b) => {
        const k = Math.round((b - first) / period)
        return Math.abs(b - (first + k * period))
      })
      expect(Math.max(...errors)).toBeLessThan(0.015)
      expect(a.confidence).toBeGreaterThan(0.5)
    })
  }
  it('marks the drop as a hit', () => {
    const a = analyzeBeats(loop(120, 12, 0, 6), RATE)
    expect(a.hits.map((i) => a.beats[i])).toEqual([expect.closeTo(6, 1)])
  })
})

describe('beat grid', () => {
  const beats = [0.1, 0.6, 1.1, 1.6, 2.1, 2.6, 3.1, 3.6]
  it('continues the grid past the last beat and finds the nearest one', () => {
    expect(beatAt(beats, 10)).toBeCloseTo(5.1, 6)
    expect(nearestBeat(beats, 1.3)).toBe(2)
  })

  it('makes every cut land on a beat, with and without transitions', () => {
    const comp = {
      width: 1080,
      height: 1920,
      beats: { asset: 'b' },
      scenes: [
        { beats: 2, layers: [] },
        { beats: 4, layers: [], transition: { type: 'curve' } },
        { beats: 2, layers: [], transition: { type: 'flash' } },
        { duration: 1, layers: [] },
      ],
    } as unknown as Composition
    const timed = applyBeatGrid(comp, beats)
    // Scene 0 starts at 0 (nearest beat 0.1): cuts on beats 2, 6 and 8.
    expect(sceneCuts(timed)).toEqual([expect.closeTo(1.1, 6), expect.closeTo(3.1, 6), expect.closeTo(4.1, 6)])
    expect(checkCuts(sceneCuts(timed), beats, 30)).toEqual([])
  })

  it('shifts the grid by the music offset and places sounds on beats', () => {
    const comp = {
      width: 1080,
      height: 1920,
      beats: { asset: 'b', offset: 2 },
      scenes: [{ duration: 10, layers: [] }],
      audio: [{ sfx: 'impact', beat: 3 }],
    } as unknown as Composition
    expect(applyBeatGrid(comp, beats).audio![0].start).toBeCloseTo(3.6, 6)
  })

  it('reports cuts off the beat', () => {
    const issues = checkCuts([1.1, 2.0], beats, 30)
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toMatch(/2\.00 s è 100 ms/)
  })

  it('validates beats on scenes and sounds', () => {
    const errors = validate({ width: 1080, height: 1920, scenes: [{ beats: 1.5, layers: [] }], audio: [{ sfx: 'pop', beat: 2 }] })
      .filter((i) => i.level === 'error')
      .map((i) => i.path)
    expect(errors).toEqual(expect.arrayContaining(['scenes[0].beats', 'audio[0].beat']))
    const ok = validate({ width: 1080, height: 1920, assets: { b: { type: 'beats', src: 'm.beats.json' } }, beats: { asset: 'b' }, scenes: [{ beats: 4, layers: [] }] })
    expect(ok).toEqual([])
  })
})
