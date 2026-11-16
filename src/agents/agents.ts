// The four arrows and what each one knows how to do. Every rule is plain arithmetic on the
// composition and on what the arrow measured (frames, file lengths, beats): no guessing, so the
// same composition always gets the same advice.

import { busOf } from '../engine/mixer'
import { compDuration, layerWindow, sceneStarts, transitionDuration } from '../engine/timeline'
import type { AudioClip, Composition, Layer, Scene } from '../engine/types'
import type { ClaudeTarget } from '../studio/live'
import { applyOps, getAt, ROLE_NAME, type Agent, type Message, type Outgoing, type Path, type TeamContext } from './team'

const r2 = (v: number) => Math.round(v * 100) / 100
const s1 = (v: number) => `${v.toFixed(1)} s`
const fileName = (src: string) => src.split(/[\\/]/).pop() ?? src

/** Reading speed used by the checks: about 3.5 words a second, plus a moment to notice the text. */
export const readingTime = (words: number) => words / 3.5 + 0.4

function sceneName(s: Scene | undefined, i: number) {
  return s?.id ?? `Scena ${i + 1}`
}

/** The timeline clip of a scene, for the arrows. */
function sceneTarget(comp: Composition, i: number): ClaudeTarget {
  return { clip: sceneName(comp.scenes?.[i], i) }
}

function layerLabel(l: Layer): string {
  if (l.type === 'text') return l.text.replace(/[{}]/g, '').replace(/\n/g, ' ')
  return l.id ?? l.type
}

/** When an audio entry starts in comp time. */
function clipStart(comp: Composition, a: AudioClip): number {
  let offset = 0
  if (a.scene !== undefined) {
    const scenes = comp.scenes ?? []
    const i = typeof a.scene === 'number' ? a.scene : scenes.findIndex((s) => s.id === a.scene)
    if (i >= 0) offset = sceneStarts(scenes)[i] ?? 0
  }
  return offset + (a.start ?? 0)
}

/** Where a scene ends (comp time). */
function sceneEnd(comp: Composition, i: number) {
  const scenes = comp.scenes ?? []
  return (sceneStarts(scenes)[i] ?? 0) + (scenes[i]?.duration ?? 0)
}

const say = (to: Outgoing['to'], text: string, extra: Partial<Outgoing> = {}): Outgoing => ({ to, text, ...extra })

// ---- Video: the frame ----

export const videoAgent: Agent = {
  role: 'video',
  observe(ctx) {
    const out: Outgoing[] = []
    const { comp, platform, look } = ctx
    if (!look) return out
    const W = comp.width
    const H = comp.height
    const [sl, st, sr, sb] = platform.safe
    for (const t of look.texts) {
      const layer = getAt(comp, t.path) as Layer | undefined
      if (!layer || (layer.type !== 'text' && layer.type !== 'captions')) continue
      const name = t.kind === 'captions' ? 'I sottotitoli' : `"${t.label}"`
      const target: ClaudeTarget = { x: (t.box[0] + t.box[2]) / 2, y: (t.box[1] + t.box[3]) / 2 }

      // Outside the safe zone: moved back in, when its position is a plain number in a scene or the comp.
      if (t.outside >= Math.min(0.5, t.visible * 0.4)) {
        const margin = H * 0.01
        let dy = 0
        let dx = 0
        if (t.box[3] > sb * H) dy = sb * H - t.box[3] - margin
        else if (t.box[1] < st * H) dy = st * H - t.box[1] + margin
        if (t.box[2] > sr * W) dx = sr * W - t.box[2] - margin
        else if (t.box[0] < sl * W) dx = sl * W - t.box[0] + margin
        const direct = t.path.length === 4 || t.path.length === 2 // scenes.i.layers.j or layers.j
        const plainY = layer.y === undefined || typeof layer.y === 'number'
        const plainX = layer.x === undefined || typeof layer.x === 'number'
        const where = dy < 0 ? 'in basso' : dy > 0 ? 'in alto' : dx < 0 ? 'a destra' : 'a sinistra'
        if (direct && plainY && plainX && (dx || dy)) {
          const ops = []
          if (dy) ops.push({ op: 'set' as const, path: [...t.path, 'y'], value: Math.round(((layer.y as number | undefined) ?? H / 2) + dy) })
          if (dx) ops.push({ op: 'set' as const, path: [...t.path, 'x'], value: Math.round(((layer.x as number | undefined) ?? W / 2) + dx) })
          out.push(say('regista', `${name} esce di ${Math.round(Math.abs(dy || dx))} px dalla safe zone ${where}, dove su ${platform.name.split(' (')[0]} ci sono pulsanti e didascalie: lo sposto dentro.`, { ops, target, at: t.first }))
        } else {
          out.push(say('regista', `${name} esce dalla safe zone ${where}, ma si muove con un'animazione: va sistemato a mano.`, { target, at: t.first }))
        }
      }

      // Too short to read: the length is the timeline's job.
      const needed = readingTime(t.words)
      if (t.kind === 'text' && t.visible + look.step / 2 < needed && t.path[0] === 'scenes') {
        const scene = Number(t.path[1])
        const by = r2(Math.ceil((needed - t.visible) * 10) / 10)
        out.push(
          say('timeline', `Timeline, ${name} resta a schermo ${s1(t.visible)}: per ${t.words} parole ne servono ${s1(needed)}. Puoi allungare "${sceneName(comp.scenes?.[scene], scene)}" di ${s1(by)}?`, {
            topic: 'allunga',
            data: { scene, by, path: t.path, label: t.label },
            target,
            at: t.first,
          }),
        )
      }

      // Hard to read on its background: a soft dark outline, as on TV captions.
      if (t.contrast !== null && t.contrast < 3 && layer.type === 'text' && !layer.stroke && !layer.background) {
        out.push(
          say('regista', `${name} si legge poco sullo sfondo (contrasto ${t.contrast.toFixed(1)}:1, serve 3:1): gli metto un contorno scuro.`, {
            ops: [{ op: 'set', path: [...t.path, 'stroke'], value: { color: 'rgba(0,0,0,0.7)', width: Math.max(3, Math.round(t.size * 0.05)) } }],
            target,
            at: t.first,
          }),
        )
      }
    }
    if (look.empty.includes(0)) out.push(say('regista', 'Il primo fotogramma è vuoto: nel feed, prima che parta, si vede un riquadro piatto.', { target: { x: W / 2, y: H / 2 }, at: 0 }))
    return out
  },
  receive(msg, ctx) {
    // The timeline shortened a scene: are its texts still readable?
    if (msg.topic === 'verifica') {
      const i = Number(msg.data?.scene)
      const scene = ctx.comp.scenes?.[i]
      if (!scene) return []
      const short = scene.layers
        .filter((l): l is Extract<Layer, { type: 'text' }> => l.type === 'text')
        .map((l) => ({ l, w: layerWindow(l, scene.duration) }))
        .filter(({ l, w }) => w.duration < readingTime(l.text.split(/\s+/).filter(Boolean).length))
      if (!short.length) return [say('regista', `Ho ricontrollato "${sceneName(scene, i)}": i testi si leggono ancora.`, { target: sceneTarget(ctx.comp, i), topic: 'ok' })]
      return [say('regista', `Attenzione: accorciando "${sceneName(scene, i)}", "${layerLabel(short[0].l)}" resta troppo poco per leggerlo.`, { target: sceneTarget(ctx.comp, i) })]
    }
    return []
  },
}

// ---- Timeline: cuts, scene lengths, transitions ----

const LOUD_TRANSITIONS = new Set(['whip', 'zoomThrough', 'zoomBack', 'flash', 'curve', 'slide', 'push'])

function changedEnd(before: Composition, ops: Outgoing['ops']): { oldEnd: number; newEnd: number } {
  let after = before
  try {
    after = applyOps(before, ops ?? [])
  } catch {
    // Keep the old end.
  }
  return { oldEnd: r2(compDuration(before)), newEnd: r2(compDuration(after)) }
}

export const timelineAgent: Agent = {
  role: 'timeline',
  observe(ctx) {
    const out: Outgoing[] = []
    const { comp, platform } = ctx
    const scenes = comp.scenes ?? []
    const starts = sceneStarts(scenes)
    const fps = comp.fps ?? 30

    // Fast transitions want a sound: that's the audio's job.
    scenes.forEach((s, i) => {
      if (i === 0 || !s.transition || !LOUD_TRANSITIONS.has(s.transition.type)) return
      const d = Math.min(transitionDuration(s.transition), scenes[i - 1].duration, s.duration)
      const hit = r2(starts[i] + d / 2)
      const covered = (comp.audio ?? []).some((a) => a.sfx && Math.abs(clipStart(comp, a) - hit) < 0.3)
      if (!covered) {
        out.push(
          say('audio', `Audio, a ${s1(hit)} entra "${sceneName(s, i)}" con uno stacco ${s.transition.type} ma non si sente niente. Ci metti un whoosh?`, {
            topic: 'whoosh',
            data: { time: hit, scene: s.id ?? i, offset: r2(d / 2) },
            target: sceneTarget(comp, i),
            at: hit,
          }),
        )
      }
    })

    // Cuts off the beat: every cut moved to its nearest beat, one scene length at a time.
    const beats = ctx.beats ?? []
    if (beats.length > 1 && scenes.length > 1 && !scenes.some((s) => s.beats !== undefined)) {
      const lengths = scenes.map((s) => s.duration)
      let moved = 0
      for (let i = 1; i < scenes.length; i++) {
        const cut = sceneStarts(scenes.map((s, k) => ({ ...s, duration: lengths[k] })))[i]
        let best = beats[0]
        for (const b of beats) if (Math.abs(b - cut) < Math.abs(best - cut)) best = b
        if (Math.abs(best - cut) > 1 / fps + 1e-6 && lengths[i - 1] + best - cut > 0.4) {
          lengths[i - 1] = r2(lengths[i - 1] + best - cut)
          moved++
        }
      }
      if (moved) {
        const ops = lengths.flatMap((v, k) => (v !== scenes[k].duration ? [{ op: 'set' as const, path: ['scenes', k, 'duration'], value: v }] : []))
        const end = changedEnd(comp, ops)
        out.push(say('regista', `${moved} ${moved === 1 ? 'taglio cade' : 'tagli cadono'} fuori dal beat della musica: li aggancio al beat più vicino.`, { ops, target: sceneTarget(comp, 1), at: starts[1] }))
        if (Math.abs(end.newEnd - end.oldEnd) > 0.04) out.push(say('audio', `Audio, agganciando i tagli il video ora finisce a ${s1(end.newEnd)} invece di ${s1(end.oldEnd)}.`, { topic: 'tempi', data: end }))
      }
    }

    const total = compDuration(comp)
    if (total > platform.maxSeconds) out.push(say('regista', `Il video dura ${s1(total)}: per ${platform.name} conviene restare sotto i ${platform.maxSeconds} s.`, { at: total }))
    return out
  },
  receive(msg, ctx) {
    const comp = ctx.comp
    const scenes = comp.scenes ?? []

    if (msg.topic === 'allunga') {
      const i = Number(msg.data?.scene)
      const by = Number(msg.data?.by)
      const scene = scenes[i]
      if (!scene || !(by > 0)) return []
      const ops: NonNullable<Outgoing['ops']> = []
      // A text with its own length inside a long enough scene: lengthen the text only.
      const path = msg.data?.path as Path | undefined
      const layer = path ? (getAt(comp, path) as Layer | undefined) : undefined
      if (layer?.duration !== undefined && path) {
        const w = layerWindow(layer, scene.duration)
        if (w.start + w.duration + by <= scene.duration + 1e-6) {
          return [say('regista', `Fatto: allungo il testo di ${s1(by)}, la scena ha già spazio. La durata del video non cambia.`, { ops: [{ op: 'set', path: [...path, 'duration'], value: r2(w.duration + by) }], target: sceneTarget(comp, i) })]
        }
        ops.push({ op: 'set', path: [...path, 'duration'], value: r2(w.duration + by) })
      }
      if (scene.beats !== undefined && (ctx.beats?.length ?? 0) > 1) {
        const b = ctx.beats!
        const period = (b[b.length - 1] - b[0]) / (b.length - 1)
        const extra = Math.max(1, Math.ceil(by / period))
        ops.push({ op: 'set', path: ['scenes', i, 'beats'], value: scene.beats + extra })
        const end = { oldEnd: r2(compDuration(comp)), newEnd: r2(compDuration(comp) + extra * period) }
        return [
          say('regista', `Allungo "${sceneName(scene, i)}" di ${extra} ${extra === 1 ? 'battuta' : 'battute'}, così il taglio resta a tempo.`, { ops, target: sceneTarget(comp, i) }),
          say('audio', `Audio, ho allungato "${sceneName(scene, i)}": il video ora finisce a ${s1(end.newEnd)} invece di ${s1(end.oldEnd)}.`, { topic: 'tempi', data: end }),
        ]
      }
      ops.push({ op: 'set', path: ['scenes', i, 'duration'], value: r2(scene.duration + by) })
      const end = changedEnd(comp, ops)
      return [
        say('regista', `Allungo "${sceneName(scene, i)}" da ${s1(scene.duration)} a ${s1(scene.duration + by)}.`, { ops, target: { clip: sceneName(scene, i), edge: 'end' } }),
        say('audio', `Audio, ho allungato "${sceneName(scene, i)}": il video ora finisce a ${s1(end.newEnd)} invece di ${s1(end.oldEnd)}.`, { topic: 'tempi', data: end }),
      ]
    }

    if (msg.topic === 'clip-corta') {
      const i = Number(msg.data?.scene)
      const until = Number(msg.data?.until)
      const scene = scenes[i]
      if (!scene || !(until > 0.5)) return []
      if (scene.beats !== undefined) return [say('regista', `"${sceneName(scene, i)}" è a tempo di musica: non la accorcio, meglio una clip più lunga.`, { target: sceneTarget(comp, i) })]
      const value = Math.floor(until * 20) / 20
      const ops = [{ op: 'set' as const, path: ['scenes', i, 'duration'], value }]
      const end = changedEnd(comp, ops)
      return [
        say('regista', `Accorcio "${sceneName(scene, i)}" da ${s1(scene.duration)} a ${s1(value)}, così finisce con la clip.`, { ops, target: { clip: sceneName(scene, i), edge: 'end' } }),
        say('video', `Video, ho accorciato "${sceneName(scene, i)}": controlli che i testi si leggano ancora?`, { topic: 'verifica', data: { scene: i } }),
        say('audio', `Audio, il video ora finisce a ${s1(end.newEnd)} invece di ${s1(end.oldEnd)}.`, { topic: 'tempi', data: end }),
      ]
    }
    return []
  },
}

// ---- Audio: music, voice, effects, the console ----

/** Where a sound ends in comp time, when it can be known. */
function clipEnd(comp: Composition, a: AudioClip, media: TeamContext['media'], total: number): number | null {
  const start = clipStart(comp, a)
  if (a.duration !== undefined) return start + a.duration
  const len = a.asset ? media?.[a.asset]?.duration : undefined
  if (len === undefined) return null
  return Math.min(total, start + len - (a.sourceStart ?? 0))
}

function musicFixes(comp: Composition, media: TeamContext['media'], reason: string): Outgoing[] {
  const out: Outgoing[] = []
  const total = compDuration(comp)
  ;(comp.audio ?? []).forEach((a, i) => {
    if (a.sfx || busOf(a) !== 'music') return
    const start = clipStart(comp, a)
    const target: ClaudeTarget = { channel: `a${i}` }
    const name = a.asset ? fileName(comp.assets?.[a.asset]?.src ?? a.asset) : 'la musica'
    // A set length that no longer matches the end of the video.
    if (a.duration !== undefined) {
      const end = start + a.duration
      const len = a.asset ? media?.[a.asset]?.duration : undefined
      const room = len !== undefined ? len - (a.sourceStart ?? 0) : Infinity
      if (Math.abs(end - total) > 0.05 && Math.abs(end - total) < 6 && total - start <= room + 0.01) {
        const value = r2(total - start)
        out.push(say('regista', `${reason}La musica ${name} finisce a ${s1(end)}, il video a ${s1(total)}: la porto alla fine${(a.fadeOut ?? 0) < 0.5 ? ' con una dissolvenza' : ''}.`, {
          ops: [{ op: 'set', path: ['audio', i, 'duration'], value }, ...((a.fadeOut ?? 0) < 0.5 ? [{ op: 'set' as const, path: ['audio', i, 'fadeOut'], value: 1.5 }] : [])],
          target,
          at: total,
        }))
        return
      }
      if (total - start > room + 0.01) {
        out.push(say('regista', `${reason}La musica ${name} dura ${s1(room)}: non basta ad arrivare alla fine del video (${s1(total)}).`, { target, at: start + room }))
        return
      }
    }
    // Running to the very end without fading: it gets cut off.
    const end = clipEnd(comp, a, media, total)
    if (end !== null && end >= total - 0.05 && (a.fadeOut ?? 0) < 0.5) {
      out.push(say('regista', `${reason}La musica ${name} si interrompe di colpo sull'ultimo fotogramma: le metto una dissolvenza di 1.5 s.`, { ops: [{ op: 'set', path: ['audio', i, 'fadeOut'], value: 1.5 }], target, at: total }))
    } else if (reason && end === null) {
      out.push(say('regista', `${reason}La musica ${name} segue già la fine del video, la dissolvenza si sposta da sola.`, { target, topic: 'ok' }))
    }
  })
  return out
}

export const audioAgent: Agent = {
  role: 'audio',
  observe(ctx) {
    const out: Outgoing[] = musicFixes(ctx.comp, ctx.media, '')
    const audio = ctx.comp.audio ?? []
    const hasVoice = audio.some((a) => a.role === 'voice')
    const hasMusic = audio.some((a) => !a.sfx && busOf(a) === 'music')
    if (hasVoice && hasMusic && ctx.comp.mix?.duck === false) {
      out.push(say('regista', 'C\'è una voce sopra la musica ma il ducking è spento: la riaccendo, così la musica si abbassa quando si parla.', { ops: [{ op: 'set', path: ['mix', 'duck'], value: {} }], target: { channel: 'bus:music' } }))
    }
    if (audio.length && ctx.comp.mix?.loudness !== false && !ctx.comp.mix?.master?.limiter) {
      out.push(say('regista', 'Sul master manca il limiter: dopo la normalizzazione a -14 LUFS i picchi possono distorcere. Lo accendo.', { ops: [{ op: 'set', path: ['mix', 'master'], value: { ...(ctx.comp.mix?.master ?? {}), limiter: true } }], target: { channel: 'master' } }))
    }
    return out
  },
  receive(msg, ctx) {
    if (msg.topic === 'tempi') {
      const fixes = musicFixes(ctx.comp, ctx.media, 'Ricevuto. ')
      return fixes.length ? fixes : [say('regista', 'Ricevuto: con i nuovi tempi l\'audio è già a posto.', { topic: 'ok' })]
    }
    if (msg.topic === 'whoosh') {
      const time = Number(msg.data?.time)
      if (!Number.isFinite(time)) return []
      const n = ctx.comp.audio?.length ?? 0
      // Cued on the scene, so it stays on the cut if the scenes before it change length.
      const scene = msg.data?.scene as string | number | undefined
      const cue = scene !== undefined ? { scene, start: Number(msg.data?.offset ?? 0) } : { start: r2(time) }
      return [
        say('regista', `Metto un whoosh sullo stacco (${s1(time)}), a volume 0.7 così non copre la voce. Resta agganciato alla scena anche se i tempi cambiano.`, {
          ops: [{ op: 'push', path: ['audio'], value: { sfx: 'whoosh', ...cue, volume: 0.7 } }],
          target: { channel: `a${n}` },
          at: time,
        }),
      ]
    }
    return []
  },
}

// ---- Caricamenti: the files ----

/** Every asset id the composition uses. */
export function usedAssets(comp: Composition): Set<string> {
  const used = new Set<string>()
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if ((k === 'asset' || k === 'lut') && typeof x === 'string') used.add(x)
        else walk(x)
      }
    }
  }
  walk({ ...comp, assets: undefined })
  return used
}

export const mediaAgent: Agent = {
  role: 'media',
  observe(ctx) {
    const out: Outgoing[] = []
    const { comp, media } = ctx
    const assets = comp.assets ?? {}

    for (const name of ctx.missing ?? []) out.push(say('regista', `Manca il file ${name}: trascinalo nei Caricamenti o la scena resterà vuota.`, { target: { media: name } }))

    // Video clips shorter than the time they have on screen: the last frame would freeze.
    ;(comp.scenes ?? []).forEach((scene, i) => {
      scene.layers.forEach((l, j) => {
        if (l.type !== 'video') return
        const len = media?.[l.asset]?.duration
        if (!len) return
        const w = layerWindow(l, scene.duration)
        const plays = (len - (l.sourceStart ?? 0)) / (l.playbackRate ?? 1)
        if (plays + 0.1 >= w.duration) return
        const file = fileName(assets[l.asset]?.src ?? l.asset)
        const frozen = w.duration - plays
        if (l.duration === undefined && w.start === 0) {
          out.push(
            say('timeline', `Timeline, la clip ${file} dura ${s1(plays)} ma "${sceneName(scene, i)}" ne dura ${s1(scene.duration)}: per ${s1(frozen)} resterebbe fermo l'ultimo fotogramma. Accorci la scena?`, {
              topic: 'clip-corta',
              data: { scene: i, until: r2(plays), path: ['scenes', i, 'layers', j] },
              target: { media: file },
              at: sceneEnd(comp, i) - frozen,
            }),
          )
        } else {
          out.push(say('regista', `La clip ${file} finisce ${s1(frozen)} prima del suo spazio in "${sceneName(scene, i)}": l'ultimo fotogramma resta fermo.`, { target: { media: file } }))
        }
      })
    })

    // Pictures too small for the frame.
    for (const [id, a] of Object.entries(assets)) {
      const f = media?.[id]
      if ((a.type !== 'image' && a.type !== 'video') || !f?.width || !f.height) continue
      const need = Math.min(comp.width, comp.height) * 0.6
      if (Math.min(f.width, f.height) < need) out.push(say('regista', `${fileName(a.src)} è ${f.width}×${f.height}: a tutto schermo in ${comp.width}×${comp.height} si vedrà sgranato.`, { target: { media: fileName(a.src) } }))
    }

    // Files listed but never used: tidy up.
    const used = usedAssets(comp)
    const unused = Object.keys(assets).filter((k) => !used.has(k) && comp.beats?.asset !== k)
    if (unused.length) {
      out.push(
        say('regista', `${unused.length === 1 ? 'Un file è caricato' : `${unused.length} file sono caricati`} ma non ${unused.length === 1 ? 'è usato' : 'sono usati'} da nessuna parte (${unused.map((k) => fileName(assets[k].src)).join(', ')}): li tolgo dall'elenco.`, {
          ops: unused.map((k) => ({ op: 'remove' as const, path: ['assets', k] })),
          target: { media: fileName(assets[unused[0]].src) },
        }),
      )
    }
    return out
  },
  receive(msg: Message) {
    return msg.topic ? [say('regista', `${ROLE_NAME[msg.from as keyof typeof ROLE_NAME]} mi ha scritto, ma qui non c'è niente da cambiare.`)] : []
  },
}

/** The team, in the order they speak: the files first (what exists), then picture, cuts and sound. */
export const TEAM: Agent[] = [mediaAgent, videoAgent, timelineAgent, audioAgent]
