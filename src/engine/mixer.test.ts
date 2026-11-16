import { describe, expect, it } from 'vitest'
import { audioMix } from './audio'
import { audible, cleanChannel, dbToGain, mixerChannels, mixerSettings, withoutMixer, writeMixer } from './mixer'
import { validate } from './validate'
import type { Composition } from './types'

const comp = (): Composition => ({
  width: 1080,
  height: 1920,
  assets: { m: { type: 'audio', src: 'music.mp3' }, v: { type: 'audio', src: 'voce.mp3' }, clip: { type: 'video', src: 'clip.mp4' } },
  audio: [
    { asset: 'm', mixer: { gain: -6 } },
    { asset: 'v', role: 'voice', start: 1 },
    { sfx: 'whoosh', start: 2 },
  ],
  scenes: [{ duration: 4, layers: [{ type: 'video', asset: 'clip', mixer: { pan: -0.5 } }] }],
})

describe('audio console', () => {
  it('has one strip per sound, on the bus of its role', () => {
    const ch = mixerChannels(comp())
    expect(ch.map((c) => [c.id, c.short, c.bus])).toEqual([
      ['a0', 'A1', 'music'],
      ['a1', 'A2', 'voice'],
      ['a2', 'A3', 'sfx'],
      ['v0', 'V1', 'video'],
    ])
    expect(audioMix(comp()).map((c) => c.channel)).toEqual(['a0', 'a1', 'a2', 'v0'])
  })

  it('reads and writes the settings in the JSON, leaving defaults out', () => {
    const c = comp()
    const m = mixerSettings(c)
    expect(m.channels).toEqual({ a0: { gain: -6 }, v0: { pan: -0.5 } })
    m.channels.a0 = { gain: 0.01 }
    m.channels.a2 = { mute: true, eq: { low: 3, midFreq: 1000 } }
    m.master = { limiter: true }
    writeMixer(c, m)
    expect(c.audio![0].mixer).toBeUndefined()
    expect(c.audio![2].mixer).toEqual({ mute: true, eq: { low: 3 } })
    expect(c.mix).toEqual({ master: { limiter: true } })
    expect(validate(c).filter((i) => i.path.includes('mixer') || i.path.startsWith('mix'))).toEqual([])
  })

  it('changing only the console needs no reload', () => {
    const a = comp()
    const b = comp()
    b.audio![1].mixer = { solo: true }
    b.mix = { master: { gain: -3 } }
    expect(withoutMixer(a)).toBe(withoutMixer(b))
    b.audio![1].start = 2
    expect(withoutMixer(a)).not.toBe(withoutMixer(b))
  })

  it('mutes and solos like a desk', () => {
    expect(audible([{}, { mute: true }, undefined])).toEqual([true, false, true])
    expect(audible([{ solo: true }, {}, { solo: true, mute: true }])).toEqual([true, false, false])
    expect(dbToGain(-60)).toBe(0)
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3)
    expect(cleanChannel({ gain: 0, pan: 0 })).toBeUndefined()
  })

  it('flags bad values', () => {
    const c = comp()
    c.audio![0].mixer = { pan: 3, eq: { low: 40 } }
    expect(validate(c).filter((i) => i.level === 'error').map((i) => i.path)).toEqual(['audio[0].mixer.pan', 'audio[0].mixer.eq.low'])
  })
})
