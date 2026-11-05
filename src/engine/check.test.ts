import { describe, expect, it } from 'vitest'
import { checkFile, checkFrames, contrastRatio, defaultPlatform, platformFor, PLATFORMS, relativeLuminance, type FileFacts, type FrameSample, type TextProbe } from './check'
import type { Composition } from './types'
import { validate } from './validate'
import { applyVariant } from './variants'

const W = 1080
const H = 1920

function text(key: string, box: [number, number, number, number], extra: Partial<TextProbe> = {}): TextProbe {
  const [x0, y0, x1, y1] = box
  return { key, label: key, kind: 'text', x0, y0, x1, y1, size: 80, alpha: 1, words: 2, contrast: 10, ...extra }
}

/** Samples every 0.1 s over `duration`, with `texts(t)` on each and some motion so the hook passes. */
function samples(duration: number, texts: (t: number) => TextProbe[], spread = 40): FrameSample[] {
  const out: FrameSample[] = []
  for (let i = 0; i * 0.1 < duration - 1e-9; i++) {
    const t = i * 0.1
    out.push({ t, transition: false, texts: texts(t), spread, change: i ? 5 : 0 })
  }
  return out
}

const facts = { width: W, height: H, duration: 8 }
const centered = text('titolo', [200, 800, 880, 960])

describe('delivery checks: frames', () => {
  it('a centered, readable title passes', () => {
    expect(checkFrames(facts, samples(8, () => [centered]), PLATFORMS.reels)).toEqual([])
  })

  it('flags text that stays in the bottom 35% on Reels, but not a brief entrance from there', () => {
    const low = text('cta', [300, 1500, 780, 1600])
    const issues = checkFrames(facts, samples(8, () => [centered, low]), PLATFORMS.reels)
    expect(issues.filter((i) => i.level === 'error').map((i) => i.message)).toEqual([expect.stringContaining('"cta"')])

    // Slides up through the bottom zone for 0.3 s, then sits in the middle for 3 s.
    const entering = (t: number) => (t < 0.3 ? [text('sale', [300, 1500 - t * 2000, 780, 1600 - t * 2000])] : t < 3.3 ? [text('sale', [300, 1000, 780, 1100])] : [])
    expect(checkFrames(facts, samples(8, (t) => [centered, ...entering(t)]), PLATFORMS.reels).filter((i) => i.level === 'error')).toEqual([])
  })

  it("knows TikTok's button column on the right", () => {
    // Fine on Reels; on TikTok its right end sits under the like/comment/share buttons.
    const wide = text('prezzo', [200, 1000, 900, 1100])
    const high = text('titolo', [200, 500, 880, 640])
    expect(checkFrames(facts, samples(8, () => [high, wide]), PLATFORMS.reels).filter((i) => i.level === 'error')).toEqual([])
    const errors = checkFrames(facts, samples(8, () => [high, wide]), PLATFORMS.tiktok).filter((i) => i.level === 'error')
    expect(errors.map((i) => i.message)).toEqual([expect.stringContaining('"prezzo"')])
  })

  it('ignores positions during transitions', () => {
    const s = samples(8, () => [centered, text('cta', [300, 1500, 780, 1600])]).map((x) => ({ ...x, transition: true }))
    expect(checkFrames(facts, s, PLATFORMS.reels).filter((i) => i.level === 'error')).toEqual([])
  })

  it('warns about small text, low contrast and text too short to read', () => {
    const issues = checkFrames(
      facts,
      samples(8, (t) => [
        centered,
        text('piccolo', [400, 700, 680, 730], { size: 30 }),
        text('grigio', [300, 1000, 780, 1100], { contrast: 1.4 }),
        ...(t >= 2 && t < 3 ? [text('lungo', [100, 1150, 980, 1300], { words: 12 })] : []),
      ]),
      PLATFORMS.reels,
    )
    const msg = issues.map((i) => i.message).join('\n')
    expect(msg).toMatch(/"piccolo": corpo 30 px/)
    expect(msg).toMatch(/"grigio": poco contrasto/)
    expect(msg).toMatch(/"lungo": resta a schermo 1\.0 s/)
    expect(msg).not.toMatch(/"titolo"/)
  })

  it('does not count a text that pops in as small text', () => {
    // Scaled up from 60% over the first 0.2 s, then 80 px for the rest.
    const pop = (t: number) => text('bottone', [300, 1000, 780, 1080], { size: t < 0.25 ? 30 : 80, alpha: t < 0.25 ? 0.8 : 1 })
    expect(checkFrames(facts, samples(8, (t) => [centered, pop(t)]), PLATFORMS.reels)).toEqual([])
  })

  it('finds empty frames, an empty first frame and a missing hook', () => {
    const s = samples(8, (t) => (t >= 3 ? [centered] : []), 40).map((x) => (x.t < 3 ? { ...x, spread: 0, change: 0 } : x))
    const msg = checkFrames(facts, s, PLATFORMS.reels).map((i) => i.message).join('\n')
    expect(msg).toMatch(/primo fotogramma è vuoto/)
    expect(msg).toMatch(/Fotogrammi vuoti da 0\.0s a 3\.0s/)
    expect(msg).toMatch(/Nessun gancio/)
  })

  it('finds texts on top of each other, but not ones that only touch', () => {
    const cta = text('cta', [300, 1000, 780, 1100])
    const caption = text('sub', [350, 1020, 730, 1090], { kind: 'captions' })
    const near = text('vicino', [300, 1100, 780, 1160])
    const msg = checkFrames(facts, samples(8, () => [centered, cta, caption, near]), PLATFORMS.reels).map((i) => i.message).join('\n')
    expect(msg).toMatch(/"cta" e sottotitoli si sovrappongono|Sottotitoli e "cta" si sovrappongono/)
    expect(msg).not.toMatch(/vicino/)
  })

  it('checks format and length against the platform', () => {
    const msg = checkFrames({ width: 1920, height: 1080, duration: 75 }, samples(2, () => [centered]), PLATFORMS.reels).map((i) => i.message).join('\n')
    expect(msg).toMatch(/1920×1080 non è quello/)
    expect(msg).toMatch(/75\.0 s/)
  })

  it('picks a platform from the shape', () => {
    expect(defaultPlatform(1080, 1920).id).toBe('reels')
    expect(defaultPlatform(1080, 1350).id).toBe('feed')
    expect(defaultPlatform(1080, 1080).id).toBe('feed')
    expect(defaultPlatform(1920, 1080).id).toBe('youtube')
  })

  it('computes WCAG contrast', () => {
    expect(contrastRatio(relativeLuminance(0, 0, 0), relativeLuminance(255, 255, 255))).toBeCloseTo(21, 5)
    expect(contrastRatio(relativeLuminance(118, 118, 118), relativeLuminance(255, 255, 255))).toBeCloseTo(4.54, 1)
  })
})

describe('delivery checks: file', () => {
  const good: FileFacts = {
    width: 1080, height: 1920, fps: 30, duration: 8, videoCodec: 'h264', profile: 'High', pixFmt: 'yuv420p', colorSpace: 'bt709',
    audioCodec: 'aac', sampleRate: 48000, channels: 2, loudness: -14.2, truePeak: -1.3, faststart: true, bytes: 12e6,
  }
  const expected = { width: 1080, height: 1920, fps: 30, duration: 8, loudness: -14 as const }

  it('a correct export passes', () => {
    expect(checkFile(good, expected, PLATFORMS.reels)).toEqual([])
  })

  it('catches the usual export mistakes', () => {
    const bad = { ...good, pixFmt: 'yuvj444p', profile: 'High 4:4:4 Predictive', fps: 25, loudness: -20, truePeak: 0.2, faststart: false, audioCodec: 'opus' }
    const msg = checkFile(bad, expected, PLATFORMS.reels).map((i) => i.message).join('\n')
    for (const re of [/yuv420p/, /4:4:4/, /Frame rate 25/, /-20\.0 LUFS/, /Picco/, /faststart/, /AAC/]) expect(msg).toMatch(re)
  })

  it('does not judge loudness when the comp opts out', () => {
    expect(checkFile({ ...good, loudness: -23 }, { ...expected, loudness: false }, PLATFORMS.reels)).toEqual([])
  })
})

describe('format variants', () => {
  const comp = {
    width: 1080,
    height: 1920,
    platform: 'reels',
    scenes: [{ duration: 3, layers: [{ type: 'text', id: 'titolo', text: 'Ciao', y: 500 }, { type: 'group', layers: [{ type: 'text', id: 'cta', text: 'Compra', y: 1100 }] }] }],
    variants: {
      feed: { width: 1080, height: 1350, platform: 'feed', layers: { titolo: { y: 380, size: 90 }, cta: { y: 900 } } },
      orizzontale: { width: 1920, height: 1080, layers: { manca: { y: 1 } } },
    },
  } as unknown as Composition

  it('changes the frame and patches layers by id, also inside groups', () => {
    const { comp: feed, missing } = applyVariant(comp, 'feed')
    expect([feed.width, feed.height, feed.platform]).toEqual([1080, 1350, 'feed'])
    const layers = feed.scenes![0].layers as unknown as Record<string, unknown>[]
    expect(layers[0]).toMatchObject({ y: 380, size: 90, text: 'Ciao' })
    expect((layers[1].layers as Record<string, unknown>[])[0]).toMatchObject({ y: 900 })
    expect(missing).toEqual([])
    expect(feed.variants).toBeUndefined()
    // The original is untouched.
    expect((comp.scenes![0].layers[0] as unknown as { y: number }).y).toBe(500)
  })

  it('reports override ids that match no layer, and unknown variants', () => {
    expect(applyVariant(comp, 'orizzontale').missing).toEqual(['manca'])
    expect(() => applyVariant(comp, 'quadrato')).toThrow(/feed, orizzontale/)
  })

  it('validates platform and variants', () => {
    const issues = validate({ ...comp, platform: 'tiktk' })
    expect(issues.find((i) => i.path === 'platform')?.message).toMatch(/tiktok/)
    expect(validate(comp).find((i) => i.path === 'variants.orizzontale.layers.manca')?.level).toBe('warning')
  })

  it('the platform comes from the option, then the comp, then the shape', () => {
    expect(platformFor({ width: 1080, height: 1920 }).id).toBe('reels')
    expect(platformFor({ width: 1080, height: 1920, platform: 'tiktok' }).id).toBe('tiktok')
    expect(platformFor({ width: 1080, height: 1920, platform: 'tiktok' }, 'reels').id).toBe('reels')
  })
})
