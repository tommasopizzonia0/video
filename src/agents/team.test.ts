import { describe, expect, it } from 'vitest'
import { PLATFORMS } from '../engine/check'
import type { Composition } from '../engine/types'
import { audioAgent, mediaAgent, TEAM, timelineAgent, videoAgent } from './agents'
import { applyOps, fromClaude, ownerOf, runTeam, type Agent, type Look, type TeamContext } from './team'

const base = (): Composition => ({
  width: 1080,
  height: 1920,
  fps: 30,
  assets: { musica: { type: 'audio', src: 'musica.mp3' }, clip: { type: 'video', src: 'ulivi.mp4' }, vecchio: { type: 'image', src: 'vecchio.jpg' } },
  audio: [{ asset: 'musica', duration: 9 }],
  mix: { master: { limiter: true } },
  scenes: [
    { id: 'apertura', duration: 3, layers: [{ type: 'text', text: 'Alberi da frutto spediti dalla Calabria in tutta Italia', y: 900 }] },
    { id: 'ulivi', duration: 6, transition: { type: 'whip' }, layers: [{ type: 'video', asset: 'clip' }] },
  ],
})

const ctx = (comp: Composition, extra: Partial<TeamContext> = {}): TeamContext => ({ comp, platform: PLATFORMS.reels, media: { musica: { duration: 60 }, clip: { duration: 4.2, width: 1080, height: 1920 } }, ...extra })

const lookShort: Look = {
  step: 0.1,
  empty: [],
  texts: [{ path: ['scenes', 0, 'layers', 0], label: 'Alberi da frutto', kind: 'text', first: 0.2, visible: 1.2, words: 9, size: 80, box: [100, 860, 980, 940], outside: 0, contrast: null }],
}

describe('ownerOf', () => {
  it('gives each part of the JSON to one arrow', () => {
    expect(ownerOf(['scenes', 1, 'duration'])).toBe('timeline')
    expect(ownerOf(['scenes', 1, 'transition'])).toBe('timeline')
    expect(ownerOf(['scenes', 1, 'layers', 0, 'duration'])).toBe('timeline')
    expect(ownerOf(['scenes', 1, 'layers', 0, 'y'])).toBe('video')
    expect(ownerOf(['scenes', 1, 'layers', 0, 'volume'])).toBe('audio')
    expect(ownerOf(['audio', 0, 'fadeOut'])).toBe('audio')
    expect(ownerOf(['mix', 'master'])).toBe('audio')
    expect(ownerOf(['assets', 'x'])).toBe('media')
    expect(ownerOf(['grade'])).toBe('video')
  })
})

describe('applyOps', () => {
  it('sets, appends and removes without touching the original', () => {
    const c = base()
    const out = applyOps(c, [
      { op: 'set', path: ['scenes', 0, 'duration'], value: 4 },
      { op: 'push', path: ['audio'], value: { sfx: 'whoosh', start: 2 } },
      { op: 'remove', path: ['assets', 'vecchio'] },
    ])
    expect(out.scenes![0].duration).toBe(4)
    expect(out.audio).toHaveLength(2)
    expect(out.assets!.vecchio).toBeUndefined()
    expect(c.scenes![0].duration).toBe(3)
  })
})

describe('the team', () => {
  it('Video asks the Timeline to lengthen a scene, and the Timeline tells the Audio', () => {
    const r = runTeam(TEAM, ctx(base(), { look: lookShort }))
    const plan = r.plans.find((p) => p.by === 'video')!
    expect(plan).toBeTruthy()
    expect(plan.messages.map((m) => `${m.from}>${m.to}`)).toEqual(['video>timeline', 'timeline>regista', 'timeline>audio', 'audio>regista'])
    // 9 words need 9/3.5+0.4 = 2.97 s; seen 1.2 s → +1.8 s.
    expect(plan.ops).toContainEqual({ op: 'set', path: ['scenes', 0, 'duration'], value: 4.8 })
    // The audio sees the composition with the longer scene: music now runs to the new end.
    const after = applyOps(base(), plan.ops)
    const music = after.audio![0]
    expect(music.duration).toBeCloseTo(after.scenes![0].duration + after.scenes![1].duration - 0.36, 2)
    expect(music.fadeOut).toBe(1.5)
  })

  it('Caricamenti notices a clip shorter than its scene and the Timeline trims it, then checks with Video', () => {
    const r = runTeam([mediaAgent, timelineAgent, audioAgent, videoAgent], ctx(base()))
    const plan = r.plans.find((p) => p.by === 'media' && p.ops.some((o) => o.path[0] === 'scenes'))!
    expect(plan.messages[0].to).toBe('timeline')
    expect(plan.ops[0]).toEqual({ op: 'set', path: ['scenes', 1, 'duration'], value: 4.2 })
    expect(plan.messages.some((m) => m.from === 'video' && m.text.includes('si leggono ancora'))).toBe(true)
  })

  it('the Timeline asks the Audio for a whoosh on a fast transition', () => {
    const r = runTeam([timelineAgent, audioAgent], ctx(base()))
    const plan = r.plans.find((p) => p.messages[0].topic === 'whoosh')!
    expect(plan.ops).toEqual([{ op: 'push', path: ['audio'], value: { sfx: 'whoosh', scene: 'ulivi', start: 0.18, volume: 0.7 } }])
  })

  it('tidies unused files', () => {
    const r = runTeam([mediaAgent], ctx(base()))
    expect(r.plans.some((p) => p.ops.some((o) => o.op === 'remove' && o.path[1] === 'vecchio'))).toBe(true)
  })

  it('stops an arrow from changing what belongs to another', () => {
    const rogue: Agent = { role: 'video', observe: () => [{ to: 'regista', text: 'accorcio io', ops: [{ op: 'set', path: ['scenes', 0, 'duration'], value: 1 }] }], receive: () => [] }
    const r = runTeam([rogue], ctx(base()))
    expect(r.plans).toEqual([])
    expect(r.channel[0].from).toBe('regista')
    expect(r.channel[0].text).toContain('Timeline')
  })

  it('holds back a plan that collides with an earlier one', () => {
    const a: Agent = { role: 'timeline', observe: () => [{ to: 'regista', text: 'a', ops: [{ op: 'set', path: ['scenes', 0, 'duration'], value: 4 }] }, { to: 'regista', text: 'b', ops: [{ op: 'set', path: ['scenes', 0, 'duration'], value: 5 }] }], receive: () => [] }
    const r = runTeam([a], ctx(base()))
    expect(r.plans.map((p) => p.status)).toEqual(['ready', 'waiting'])
    expect(r.plans[1].waitingFor).toBe(1)
  })

  it('ends endless back-and-forth', () => {
    const ping: Agent = { role: 'video', observe: () => [{ to: 'timeline', text: 'ping', topic: 'x' }], receive: () => [{ to: 'timeline', text: 'ping', topic: 'x' }] }
    const pong: Agent = { role: 'timeline', observe: () => [], receive: () => [{ to: 'video', text: 'pong', topic: 'x' }] }
    const r = runTeam([ping, pong], ctx(base()))
    expect(r.channel.length).toBeLessThan(10)
    expect(r.channel[r.channel.length - 1].from).toBe('regista')
  })

  it('a clean composition gets no proposals', () => {
    const c = base()
    c.assets = { musica: c.assets!.musica }
    c.audio = [{ asset: 'musica', fadeOut: 1.5 }]
    c.scenes = [{ id: 'a', duration: 4, layers: [{ type: 'text', text: 'Ciao', y: 900 }] }]
    const r = runTeam(TEAM, ctx(c, { look: { step: 0.1, empty: [], texts: [] } }))
    expect(r.plans).toEqual([])
  })
})

describe('applyOps on a comp without a mix', () => {
  it('creates the missing objects', () => {
    const out = applyOps({ width: 1, height: 1 } as Composition, [{ op: 'set', path: ['mix', 'master'], value: { limiter: true } }])
    expect(out.mix?.master?.limiter).toBe(true)
  })
})

describe('fromClaude', () => {
  it('turns a written conversation into checked proposals', () => {
    const r = fromClaude(
      [
        { plan: 1, from: 'video', to: 'timeline', text: 'Timeline, il titolo passa troppo in fretta: allunghi l\'apertura di 1 s?', target: { x: 540, y: 900 } },
        { plan: 1, from: 'timeline', to: 'regista', text: 'Allungo l\'apertura a 4 s.', ops: [{ op: 'set', path: ['scenes', 0, 'duration'], value: 4 }] },
        { plan: 2, from: 'video', to: 'regista', text: 'Accorcio io la scena.', ops: [{ op: 'set', path: ['scenes', 1, 'duration'], value: 2 }] },
        { plan: 3, from: 'audio', to: 'regista', text: 'Tolgo la musica.', ops: [{ op: 'set', path: ['audio', 7, 'volume'], value: 0 }] },
        { from: 'media', to: 'regista', text: 'Le clip sono a 480p.' },
      ],
      base(),
    )
    expect(r.source).toBe('claude')
    expect(r.plans).toHaveLength(1)
    expect(r.plans[0].ops).toEqual([{ op: 'set', path: ['scenes', 0, 'duration'], value: 4 }])
    expect(r.plans[0].by).toBe('video')
    // Video touching a scene length is vetoed by the director; the broken path becomes a note.
    expect(r.channel.some((m) => m.from === 'regista' && m.text.includes('Timeline'))).toBe(true)
    expect(r.notes.some((m) => m.text.includes('480p'))).toBe(true)
    expect(r.notes.some((m) => m.from === 'regista' && m.text.includes('scartata'))).toBe(true)
  })
})
