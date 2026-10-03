import { describe, expect, it } from 'vitest'
import { valueAt } from './animate'
import { audioMix, clipGain } from './audio'
import { captionPages, pageAt, toSrt, wordsFromJson, wordsFromSrt } from './captions'
import { integratedLoudness, normalizationGain } from './loudness'
import { SFX_NAMES, synthSfx } from './sfx'
import { shapedTransition } from './transitions'
import { mixColors, parseColor } from './color'
import { cubicBezier, getEase, spring } from './easing'
import { presetMod } from './presets'
import { formatCounter, layoutText, unitOrder } from './text'
import { activeScenes, compDuration, sceneStarts } from './timeline'
import type { Composition, Scene, TextLayer } from './types'
import { parseComposition, validate } from './validate'

describe('easing', () => {
  it('named curves start at 0 and end at 1', () => {
    for (const name of ['linear', 'smooth', 'outExpo', 'inOutCubic', 'spring', 'bouncy', 'outBack']) {
      const f = getEase(name)
      expect(f(0)).toBeCloseTo(0, 5)
      expect(f(1)).toBeCloseTo(1, 5)
    }
  })
  it('cubic-bezier matches its endpoints and is monotonic for ease', () => {
    const f = cubicBezier(0.25, 0.1, 0.25, 1)
    let prev = 0
    for (let u = 0; u <= 1; u += 0.05) {
      expect(f(u)).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = f(u)
    }
    expect(getEase('cubic-bezier(0.25, 0.1, 0.25, 1)')(0.5)).toBeCloseTo(f(0.5), 6)
  })
  it('an underdamped spring overshoots, a critically damped one does not', () => {
    const wobbly = spring(200, 8)
    const firm = spring(100, 20)
    const max = (f: (u: number) => number) => Math.max(...Array.from({ length: 101 }, (_, i) => f(i / 100)))
    expect(max(wobbly)).toBeGreaterThan(1.05)
    expect(max(firm)).toBeLessThanOrEqual(1.0005)
  })
})

describe('colors', () => {
  it('parses common formats', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1])
    expect(parseColor('#16b07a80')?.[3]).toBeCloseTo(0.5, 2)
    expect(parseColor('rgba(10, 20, 30, 0.4)')).toEqual([10, 20, 30, 0.4])
    expect(parseColor('hsl(0, 100%, 50%)')?.slice(0, 3).map(Math.round)).toEqual([255, 0, 0])
    expect(parseColor('nope')).toBeNull()
  })
  it('mixes in linear light and keeps the color when fading from transparent', () => {
    expect(mixColors('#000000', '#ffffff', 0.5)).toBe('rgb(188,188,188)')
    expect(mixColors('transparent', '#ff0000', 0.5)).toBe('rgba(255,0,0,0.5)')
  })
})

describe('animated values', () => {
  it('evaluates keyframes with easing and holds the ends', () => {
    const kf = [
      { t: 1, v: 0 },
      { t: 2, v: 100, ease: 'linear' },
    ]
    expect(valueAt(kf, 0, -1)).toBe(0)
    expect(valueAt(kf, 1.5, -1)).toBe(50)
    expect(valueAt(kf, 9, -1)).toBe(100)
  })
  it('evaluates tweens and colors', () => {
    expect(valueAt({ from: 0, to: 10, at: 1, duration: 2, ease: 'linear' }, 2, 0)).toBe(5)
    expect(valueAt([{ t: 0, v: '#000000' }, { t: 1, v: '#ffffff', ease: 'linear' }], 0.5, '')).toBe('rgb(188,188,188)')
    expect(valueAt(undefined, 1, 7)).toBe(7)
  })
})

describe('presets', () => {
  const ctx = { boxW: 100, boxH: 50, frameW: 1080, frameH: 1920, unit: false }
  it('fadeUp starts below and transparent, then rests', () => {
    const start = presetMod([{ type: 'fadeUp' }], [], 0, 5, ctx)
    expect(start.opacity).toBe(0)
    expect(start.dy).toBeGreaterThan(0)
    const rest = presetMod([{ type: 'fadeUp' }], [], 2, 5, ctx)
    expect(rest).toMatchObject({ opacity: 1, dy: 0 })
  })
  it('exits continue in the named direction', () => {
    const leaving = presetMod([], [{ type: 'fadeUp', duration: 1 }], 4.5, 5, ctx)
    expect(leaving.dy).toBeLessThan(0)
    expect(leaving.opacity).toBeLessThan(1)
  })
  it('wipes clip the box and masks offset the content', () => {
    expect(presetMod([{ type: 'wipeRight' }], [], 0, 5, ctx).clip).toEqual([0, 0, 1, 0])
    expect(presetMod([{ type: 'maskUp' }], [], 0, 5, ctx).innerY).toBeGreaterThan(0.9)
  })
})

describe('scenes', () => {
  const scenes: Scene[] = [
    { duration: 3, layers: [] },
    { duration: 3, layers: [], transition: { type: 'fade', duration: 1 } },
    { duration: 2, layers: [] },
  ]
  it('transitions overlap the previous scene', () => {
    expect(sceneStarts(scenes)).toEqual([0, 2, 5])
    expect(compDuration({ width: 2, height: 2, scenes })).toBe(7)
  })
  it('shows two scenes only during a transition', () => {
    expect(activeScenes(scenes, 1).map((s) => s.index)).toEqual([0])
    const mid = activeScenes(scenes, 2.5)
    expect(mid.map((s) => s.index)).toEqual([0, 1])
    expect(mid[1].enter).toBeGreaterThan(0)
    expect(activeScenes(scenes, 5.5).map((s) => s.index)).toEqual([2])
    expect(activeScenes(scenes, 99).map((s) => s.index)).toEqual([2])
  })
})

describe('text', () => {
  // Monospace stand-in: every char is 10px wide.
  const measure = (s: string) => s.length * 10
  const layer = (patch: Partial<TextLayer>): TextLayer => ({ type: 'text', text: '', size: 20, ...patch })

  it('wraps words to the width and splits units', () => {
    const l = layoutText(layer({ text: 'uno due tre', width: 75 }), 'uno due tre', measure, 16, 4)
    expect(l.lines).toHaveLength(2)
    expect(l.words.map((w) => w.pieces.map((p) => p.text).join(''))).toEqual(['uno', 'due', 'tre'])
    expect(l.chars).toHaveLength(9)
  })
  it('marks accent spans only when an accent style exists', () => {
    const withAccent = layoutText(layer({ text: 'a {b}', accent: { italic: true } }), 'a {b}', measure, 16, 4)
    expect(withAccent.words[1].pieces[0]).toMatchObject({ text: 'b', accent: true })
    const literal = layoutText(layer({ text: '{x}' }), '{x}', measure, 16, 4)
    expect(literal.words[0].pieces[0].text).toBe('{x}')
  })
  it('aligns lines inside the box', () => {
    const l = layoutText(layer({ text: 'ab\nabcd', align: 'right' }), 'ab\nabcd', measure, 16, 4)
    expect(l.w).toBe(40)
    expect(l.lines[0].x).toBe(20)
  })
  it('formats counters', () => {
    expect(formatCounter({ from: 0, to: 1, separator: '.', suffix: ' €' }, 1234567)).toBe('1.234.567 €')
    expect(formatCounter({ from: 0, to: 1, decimals: 1 }, 3.14159)).toBe('3.1')
  })
  it('orders units', () => {
    expect(unitOrder(5, 'center')).toEqual([2, 1, 0, 1, 2])
    expect(unitOrder(3, 'end')).toEqual([2, 1, 0])
    expect([...unitOrder(6, 'random')].sort()).toEqual([0, 1, 2, 3, 4, 5])
  })
})

describe('audio mix', () => {
  it('includes music and unmuted video layers, clipped to the comp', () => {
    const comp: Composition = {
      width: 100,
      height: 100,
      assets: { m: { type: 'audio', src: 'm.mp3' }, v: { type: 'video', src: 'v.mp4' } },
      audio: [{ asset: 'm', volume: 0.5, fadeOut: 1 }],
      scenes: [
        { duration: 4, layers: [{ type: 'video', asset: 'v', sourceStart: 2 }] },
        { duration: 4, layers: [{ type: 'video', asset: 'v', muted: true }], transition: { type: 'fade', duration: 1 } },
      ],
    }
    const mix = audioMix(comp)
    expect(mix).toHaveLength(2)
    expect(mix[0]).toMatchObject({ asset: 'm', role: 'music', start: 0, duration: 7, volume: 0.5 })
    expect(mix[1]).toMatchObject({ asset: 'v', start: 0, sourceStart: 2, duration: 4 })
  })
})

describe('velocity-matched transitions', () => {
  const W = 1920
  const H = 1080
  it('curve: one scene per frame, same direction on both sides, continuous speed at the cut', () => {
    const tr = { type: 'curve' as const, direction: 'left' as const }
    const pos = (p: number) => {
      const f = shapedTransition(tr, p, W, H)!
      expect(Boolean(f.a) !== Boolean(f.b)).toBe(true)
      return (f.a ?? f.b)!.dx
    }
    // Old scene moves left (negative), new scene arrives from the right (positive) and settles at 0.
    expect(pos(0.3)).toBeLessThan(0)
    expect(pos(0.6)).toBeGreaterThan(0)
    expect(pos(1)).toBeCloseTo(0, 6)
    // Both halves travel leftward: x decreases on each side of the cut.
    expect(pos(0.44)).toBeLessThan(pos(0.4))
    expect(pos(0.5)).toBeLessThan(pos(0.46))
    // Partial travel: about 12% of the width.
    expect(Math.abs(pos(0.4499))).toBeGreaterThan(0.1 * W)
    expect(Math.abs(pos(0.4499))).toBeLessThan(0.13 * W)
    // Peak speed on both sides of the cut is of the same order (velocity matched).
    const dt = 0.002
    const vOut = Math.abs(pos(0.4499) - pos(0.4499 - dt)) / dt
    const vIn = Math.abs(pos(0.4501 + dt) - pos(0.4501)) / dt
    expect(vIn / vOut).toBeGreaterThan(0.6)
    expect(vIn / vOut).toBeLessThan(1.7)
  })
  it('zoomThrough grows on both sides, zoomBack shrinks on both sides', () => {
    for (const [type, sign] of [['zoomThrough', 1], ['zoomBack', -1]] as const) {
      const scale = (p: number) => {
        const f = shapedTransition({ type }, p, W, H)!
        return (f.a ?? f.b)!.scale
      }
      expect(Math.sign(scale(0.2) - scale(0.1))).toBe(sign)
      expect(Math.sign(scale(0.6) - scale(0.4))).toBe(sign)
      expect(scale(1)).toBeCloseTo(1, 3)
    }
  })
  it('flash peaks on the cut and is gone at the ends', () => {
    const alpha = (p: number) => shapedTransition({ type: 'flash' }, p, W, H)!.overlay!.alpha
    expect(alpha(0)).toBe(0)
    expect(alpha(0.4999)).toBeGreaterThan(0.95)
    expect(alpha(1)).toBeCloseTo(0, 6)
    expect(shapedTransition({ type: 'fade' }, 0.5, W, H)).toBeNull()
  })
  it('new transitions run linearly by default and have their own durations', () => {
    const scenes: Scene[] = [
      { duration: 2, layers: [] },
      { duration: 2, layers: [], transition: { type: 'curve' } },
    ]
    expect(sceneStarts(scenes)).toEqual([0, 1.4])
    expect(activeScenes(scenes, 1.7)[1].enter).toBeCloseTo(0.5, 6)
  })
})

describe('sound effects and loudness', () => {
  it('every effect is deterministic, bounded and peaks where it says', () => {
    for (const name of SFX_NAMES) {
      const a = synthSfx(name, 48000)
      const b = synthSfx(name, 48000)
      expect(a.samples).toEqual(b.samples)
      const max = Math.max(...a.samples.map(Math.abs))
      expect(max).toBeGreaterThan(0.2)
      expect(max).toBeLessThanOrEqual(0.61)
      expect(a.peak).toBeGreaterThanOrEqual(0)
      expect(a.peak).toBeLessThan(a.samples.length / 48000)
    }
  })
  it('measures a -20 dBFS 1 kHz stereo sine at about -20 LUFS and normalizes it', () => {
    const rate = 48000
    const sine = new Float32Array(rate * 3).map((_, i) => 0.1 * Math.sin((2 * Math.PI * 1000 * i) / rate))
    expect(integratedLoudness([sine, sine], rate)).toBeCloseTo(-20, 0)
    expect(20 * Math.log10(normalizationGain([sine, sine], rate, -14))).toBeCloseTo(6, 0)
    // The peak ceiling wins over the loudness target.
    expect(normalizationGain([sine, sine], rate, 0)).toBeCloseTo(10 ** (-1 / 20) / 0.1, 2)
    expect(integratedLoudness([new Float32Array(rate)], rate)).toBe(-Infinity)
  })
  it('places effects by their peak, relative to scenes, with keyframed volume', () => {
    const comp: Composition = {
      width: 100,
      height: 100,
      assets: { m: { type: 'audio', src: 'm.mp3' }, vo: { type: 'audio', src: 'vo.wav' } },
      audio: [
        { asset: 'm', volume: [{ t: 0, v: 0 }, { t: 2, v: 1, ease: 'linear' }] },
        { asset: 'vo', role: 'voice', start: 1 },
        { sfx: 'whoosh', scene: 'b', start: 0 },
        { sfx: 'impact', start: 0 },
      ],
      scenes: [
        { duration: 3, layers: [] },
        { id: 'b', duration: 3, layers: [] },
      ],
    }
    const mix = audioMix(comp)
    const whoosh = mix.find((c) => c.sfx?.name === 'whoosh')!
    // The whoosh peaks right on the start of scene "b" (t = 3).
    expect(whoosh.start + synthSfx('whoosh', 8000).peak).toBeCloseTo(3, 3)
    const impact = mix.find((c) => c.sfx?.name === 'impact')!
    expect(impact.start).toBe(0)
    expect(impact.sourceStart).toBeGreaterThan(0)
    const music = mix.find((c) => c.asset === 'm')!
    expect(clipGain(music, 1, null)).toBeCloseTo(0.5, 6)
    // A voice makes the music duck; turning it off removes it.
    expect(music.duck).toBeDefined()
    expect(audioMix({ ...comp, mix: { duck: false } }).find((c) => c.asset === 'm')!.duck).toBeUndefined()
  })
})

describe('captions', () => {
  const words = 'Questo video dice a tutti che funziona, davvero. Fine'.split(' ').map((text, i) => ({ text, start: i * 0.3, end: i * 0.3 + 0.25 }))
  it('groups words into short pages, breaking on punctuation and pauses', () => {
    const pages = captionPages(words, 3, 22)
    expect(pages.map((p) => p.words.map((w) => w.text).join(' '))).toEqual(['Questo video dice', 'a tutti che', 'funziona,', 'davvero.', 'Fine'])
    // Pages never overlap and stay up long enough to read.
    for (let i = 1; i < pages.length; i++) expect(pages[i].start).toBeGreaterThanOrEqual(pages[i - 1].end)
    expect(pages[pages.length - 1].end - pages[pages.length - 1].start).toBeGreaterThanOrEqual(0.7 - 1e-9)
    expect(pageAt(pages, 0.1)).toBe(0)
    expect(pageAt(pages, 99)).toBe(-1)
  })
  it('reads Whisper JSON, word lists and SRT, and writes SRT', () => {
    const whisper = { segments: [{ words: [{ word: ' Ciao', start: 0, end: 0.4 }, { word: 'ne', start: 0.4, end: 0.5 }, { word: ' mondo', start: 0.6, end: 1 }] }] }
    expect(wordsFromJson(whisper).map((w) => w.text)).toEqual(['Ciaone', 'mondo'])
    expect(wordsFromJson([{ text: 'a', start: 0, end: 1 }])).toHaveLength(1)
    const srt = wordsFromSrt('1\n00:00:01,000 --> 00:00:02,000\nuno due\n')
    expect(srt.map((w) => w.text)).toEqual(['uno', 'due'])
    expect(srt[0].start).toBe(1)
    expect(srt[1].end).toBeCloseTo(2, 6)
    expect(toSrt([{ start: 61.5, end: 62, text: 'ok' }])).toBe('1\n00:01:01,500 --> 00:01:02,000\nok\n')
  })
})

describe('validation', () => {
  it('explains mistakes with paths and suggestions', () => {
    const issues = validate({
      width: 1080,
      height: 1920,
      scenes: [{ duration: 2, layers: [{ type: 'txt' }, { type: 'text', text: 'x', in: 'fadeUpp', colr: '#fff' }] }],
    })
    const msg = issues.map((i) => `${i.level} ${i.path}: ${i.message}`).join('\n')
    expect(msg).toContain('error scenes[0].layers[0].type')
    expect(msg).toContain('Did you mean "text"?')
    expect(msg).toContain('Did you mean "fadeUp"?')
    expect(msg).toContain('warning scenes[0].layers[1].colr')
  })
  it('rejects bad JSON and missing assets', () => {
    expect(parseComposition('{').comp).toBeNull()
    const r = parseComposition(JSON.stringify({ width: 10, height: 10, duration: 1, layers: [{ type: 'image', asset: 'logo' }] }))
    expect(r.comp).toBeNull()
    expect(r.issues[0].message).toContain('No asset "logo"')
  })
  it('checks sound effects, cues, mix settings and captions', () => {
    const issues = validate({
      width: 100,
      height: 100,
      mix: { loudness: 3, duk: {} },
      audio: [{ sfx: 'woosh' }, { sfx: 'pop', scene: 'nope' }],
      scenes: [{ duration: 1, layers: [{ type: 'captions' }, { type: 'captions', words: [{ text: 'a', start: 1, end: 0 }] }], transition: { type: 'curv' } }],
    })
    const msg = issues.map((i) => `${i.level} ${i.path}: ${i.message}`).join('\n')
    expect(msg).toContain('error audio[0].sfx: Unknown sound effect "woosh". Did you mean "whoosh"?')
    expect(msg).toContain('error audio[1].scene')
    expect(msg).toContain('error mix.loudness')
    expect(msg).toContain('warning mix.duk')
    expect(msg).toContain('error scenes[0].layers[0]: Captions need')
    expect(msg).toContain('error scenes[0].layers[1].words[0].end')
    expect(msg).toContain('error scenes[0].transition')
  })
  it('accepts every example', () => {
    const examples = import.meta.glob<string>('../../examples/*.json', { eager: true, query: '?raw', import: 'default' })
    expect(Object.keys(examples).length).toBeGreaterThan(0)
    for (const [file, text] of Object.entries(examples)) {
      if (file.includes('/_')) continue
      expect(parseComposition(text).issues, file).toEqual([])
    }
  })
})
