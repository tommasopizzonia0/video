// Delivery checks for ads and social video: what a reviewer would catch before a spot goes out.
// The renderer records where each text sits on sampled frames (see Renderer.probe); this module
// turns those samples, plus the final file's specs, into a list of findings. Pure functions, no DOM.

export type Severity = 'error' | 'warning' | 'info'

export interface Finding {
  level: Severity
  /** Seconds in the comp where it happens, when it is tied to a moment. */
  at?: number
  message: string
}

/** A rectangle in 0..1 of the frame: [left, top, right, bottom]. */
export type Box = [number, number, number, number]

export interface Platform {
  id: string
  name: string
  /** Width / height the platform expects. */
  aspect: number
  /** Area kept clear of the platform's UI, 0..1 of the frame. */
  safe: Box
  /** Extra areas inside `safe` covered by buttons (TikTok's right column). */
  blocked?: Box[]
  /** Above this many seconds the spot gets a warning. */
  maxSeconds: number
  source: string
}

// Ad safe zones as published in the platforms' ad templates. Organic posts have smaller overlays,
// so a spot that passes these passes there too.
export const PLATFORMS: Record<string, Platform> = {
  reels: {
    id: 'reels',
    name: 'Instagram / Facebook Reels e Stories (ads)',
    aspect: 9 / 16,
    // Meta Ads Guide: keep 14% top, 35% bottom and 6% each side free of text and logos.
    safe: [0.06, 0.14, 0.94, 0.65],
    maxSeconds: 60,
    source: 'Meta Ads Guide (14% top, 35% bottom, 6% sides)',
  },
  tiktok: {
    id: 'tiktok',
    name: 'TikTok (ads)',
    aspect: 9 / 16,
    // TikTok's 720×1280 safe-zone template: top 160, bottom 440, sides 80, and a 200 px button
    // column on the right from 720 px above the bottom.
    safe: [80 / 720, 160 / 1280, 640 / 720, 840 / 1280],
    blocked: [[520 / 720, 560 / 1280, 1, 1]],
    maxSeconds: 60,
    source: 'TikTok Ads Manager safe-zone template (720×1280)',
  },
  feed: {
    id: 'feed',
    name: 'Feed Instagram / Facebook (4:5 o 1:1)',
    aspect: 4 / 5,
    safe: [0.05, 0.05, 0.95, 0.95],
    maxSeconds: 60,
    source: 'margine di sicurezza generico del 5%',
  },
  youtube: {
    id: 'youtube',
    name: 'YouTube 16:9',
    aspect: 16 / 9,
    safe: [0.05, 0.05, 0.95, 0.95],
    maxSeconds: 120,
    source: 'action safe del 5% (broadcast)',
  },
}

/** The platform asked for, the one the comp names, or the one its shape suggests. */
export function platformFor(comp: { width: number; height: number; platform?: string }, asked?: string | null): Platform {
  return PLATFORMS[asked ?? ''] ?? PLATFORMS[comp.platform ?? ''] ?? defaultPlatform(comp.width, comp.height)
}

/** The platform a comp most likely targets, from its shape. */
export function defaultPlatform(width: number, height: number): Platform {
  const a = width / height
  if (a < 0.7) return PLATFORMS.reels
  if (a < 1.2) return PLATFORMS.feed
  return PLATFORMS.youtube
}

/** One text as the renderer drew it on one sampled frame. */
export interface TextProbe {
  /** Stable key of the layer (the same on every frame). */
  key: string
  label: string
  kind: 'text' | 'captions'
  /** Bounds in comp px. */
  x0: number
  y0: number
  x1: number
  y1: number
  /** Font size in comp px after every scale. */
  size: number
  /** Opacity it was drawn with, 0..1. */
  alpha: number
  /** Words in the text. */
  words: number
  /** Contrast ratio against what surrounds it (WCAG), when measured. Null when the text has its own backing. */
  contrast: number | null
}

export interface FrameSample {
  t: number
  /** True while two scenes are on screen (a transition): positions there are in motion. */
  transition: boolean
  texts: TextProbe[]
  /** Standard deviation of luminance over the frame, 0..255. Near 0 = an empty frame. */
  spread: number
  /** Mean luminance change from the previous sample, 0..255. */
  change: number
}

export interface CompFacts {
  width: number
  height: number
  duration: number
}

const fmt = (t: number) => `${t.toFixed(1)}s`

function outside(p: TextProbe, W: number, H: number, platform: Platform): boolean {
  const [l, t, r, b] = platform.safe
  const x0 = p.x0 / W
  const y0 = p.y0 / H
  const x1 = p.x1 / W
  const y1 = p.y1 / H
  // A couple of pixels of tolerance for glyph overhang.
  const tol = 0.004
  if (x0 < l - tol || y0 < t - tol || x1 > r + tol || y1 > b + tol) return true
  return (platform.blocked ?? []).some(([bl, bt, br, bb]) => x1 > bl + tol && x0 < br && y1 > bt + tol && y0 < bb)
}

/** Findings about the picture: safe zones, text size, contrast, reading time, empty frames, the hook. */
export function checkFrames(facts: CompFacts, samples: FrameSample[], platform: Platform): Finding[] {
  const out: Finding[] = []
  const { width: W, height: H, duration } = facts
  const step = samples.length > 1 ? samples[1].t - samples[0].t : 0.1

  // Format and length.
  const aspect = W / H
  if (Math.abs(aspect - platform.aspect) / platform.aspect > 0.02 && !(platform.id === 'feed' && Math.abs(aspect - 1) < 0.02)) {
    out.push({ level: 'error', message: `Il formato ${W}×${H} non è quello di ${platform.name}.` })
  }
  if (duration > platform.maxSeconds) {
    out.push({ level: 'warning', message: `Dura ${duration.toFixed(1)} s: per ${platform.name} conviene restare sotto i ${platform.maxSeconds} s.` })
  }
  if (duration < 5) out.push({ level: 'warning', message: `Dura solo ${duration.toFixed(1)} s: troppo corto per far passare un messaggio e una call to action.` })

  // Per text layer: where and how it was seen over time.
  interface Seen {
    label: string
    kind: string
    visible: number
    outside: number
    firstOutside: number
    minSize: number
    minContrast: number
    contrastAt: number
    words: number
    first: number
  }
  const seen = new Map<string, Seen>()
  for (const s of samples) {
    for (const p of s.texts) {
      if (p.alpha < 0.5) continue
      let e = seen.get(p.key)
      if (!e) {
        e = { label: p.label, kind: p.kind, visible: 0, outside: 0, firstOutside: -1, minSize: Infinity, minContrast: Infinity, contrastAt: 0, words: p.words, first: s.t }
        seen.set(p.key, e)
      }
      e.visible += step
      e.words = Math.max(e.words, p.words)
      if (s.transition) continue
      e.minSize = Math.min(e.minSize, p.size)
      if (outside(p, W, H, platform)) {
        e.outside += step
        if (e.firstOutside < 0) e.firstOutside = s.t
      }
      if (p.contrast !== null && p.alpha > 0.9 && p.contrast < e.minContrast) {
        e.minContrast = p.contrast
        e.contrastAt = s.t
      }
    }
  }

  // Texts on top of each other (a caption over a button, a title over a price).
  const overlaps = new Map<string, { a: string; b: string; time: number; at: number }>()
  for (const s of samples) {
    if (s.transition) continue
    const vis = s.texts.filter((p) => p.alpha >= 0.5)
    for (let i = 0; i < vis.length; i++)
      for (let j = i + 1; j < vis.length; j++) {
        const a = vis[i]
        const b = vis[j]
        if (a.key === b.key) continue
        const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
        const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
        if (w <= 0 || h <= 0) continue
        const smaller = Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0))
        if (w * h < smaller * 0.1) continue
        const id = [a.key, b.key].sort().join('|')
        const e = overlaps.get(id) ?? { a: a.kind === 'captions' ? 'Sottotitoli' : `"${a.label}"`, b: b.kind === 'captions' ? 'sottotitoli' : `"${b.label}"`, time: 0, at: s.t }
        e.time += step
        overlaps.set(id, e)
      }
  }
  for (const o of overlaps.values()) {
    if (o.time >= 0.3) out.push({ level: 'error', at: o.at, message: `${o.a} e ${o.b} si sovrappongono per ${o.time.toFixed(1)} s.` })
  }

  const minSize = H * 0.022
  for (const e of seen.values()) {
    const name = e.kind === 'captions' ? 'Sottotitoli' : `Testo "${e.label}"`
    // Entrances slide in from outside: only a text that stays out for a while is a problem.
    if (e.outside >= Math.min(0.5, e.visible * 0.4)) {
      out.push({ level: 'error', at: e.firstOutside, message: `${name}: fuori dalla safe zone di ${platform.name} per ${e.outside.toFixed(1)} s, finisce sotto pulsanti o didascalie.` })
    }
    if (e.minSize < minSize) {
      out.push({ level: 'warning', at: e.first, message: `${name}: corpo ${Math.round(e.minSize)} px, sotto ${Math.round(minSize)} px non si legge bene su un telefono.` })
    }
    if (e.minContrast < 3) {
      out.push({ level: 'warning', at: e.contrastAt, message: `${name}: poco contrasto con lo sfondo (${e.minContrast.toFixed(1)}:1, serve almeno 3:1). Aggiungi un contorno, un fondo o scurisci l'immagine.` })
    }
    // Reading speed: about 3.5 words a second, plus a moment to notice the text. Captions follow the voice.
    const needed = e.words / 3.5 + 0.4
    if (e.kind === 'text' && e.visible + step / 2 < needed) {
      out.push({ level: 'warning', at: e.first, message: `${name}: resta a schermo ${e.visible.toFixed(1)} s, ne servono circa ${needed.toFixed(1)} per ${e.words} parole.` })
    }
  }

  // Empty frames: a flat frame for more than half a second (or on the very first frame, the feed's poster).
  let flatFrom = -1
  for (const s of [...samples, null]) {
    const flat = s !== null && s.spread < 3
    if (flat && flatFrom < 0) flatFrom = s!.t
    if (!flat && flatFrom >= 0) {
      const end = s ? s.t : duration
      if (flatFrom === 0) out.push({ level: 'warning', at: 0, message: 'Il primo fotogramma è vuoto: nel feed, prima che parta, si vede un riquadro piatto.' })
      if (end - flatFrom >= 0.5) out.push({ level: 'warning', at: flatFrom, message: `Fotogrammi vuoti da ${fmt(flatFrom)} a ${fmt(end)}.` })
      flatFrom = -1
    }
  }

  // The hook: something must move or be said in the first 2 seconds.
  const opening = samples.filter((s) => s.t <= 2)
  const motion = opening.reduce((m, s) => Math.max(m, s.change), 0)
  const firstText = Math.min(...[...seen.values()].map((e) => e.first))
  if (motion < 2 && !(firstText <= 2)) {
    out.push({ level: 'warning', at: 0, message: 'Nessun gancio nei primi 2 secondi: niente si muove e nessun testo compare.' })
  } else if (!(firstText <= 2.5)) {
    out.push({ level: 'info', message: `Il primo testo arriva a ${Number.isFinite(firstText) ? fmt(firstText) : 'mai'}: senza audio il messaggio parte tardi.` })
  }
  if (!seen.size) out.push({ level: 'warning', message: 'Nessun testo in tutto il video: senza audio non si capisce nulla.' })

  return sortFindings(out)
}

/** Cuts more than a frame away from the nearest beat, when the comp follows a beat grid. */
export function checkCuts(cuts: number[], beats: number[], fps: number): Finding[] {
  const out: Finding[] = []
  if (!beats.length) return out
  for (const c of cuts) {
    let best = Infinity
    for (const b of beats) if (Math.abs(b - c) < Math.abs(best)) best = b - c
    // Past the last analysed beat the grid continues at the average spacing.
    const n = beats.length
    if (n > 1 && c > beats[n - 1]) {
      const period = (beats[n - 1] - beats[0]) / (n - 1)
      best = beats[n - 1] + Math.round((c - beats[n - 1]) / period) * period - c
    }
    if (Math.abs(best) > 1 / fps + 1e-6) {
      out.push({ level: 'warning', at: c, message: `Il taglio a ${c.toFixed(2)} s è ${Math.round(Math.abs(best) * 1000)} ms ${best > 0 ? 'prima del' : 'dopo il'} beat: usa "beats" sulla scena per agganciarlo.` })
    }
  }
  return out
}

/** What ffprobe and ffmpeg's ebur128 report about a rendered file. */
export interface FileFacts {
  width: number
  height: number
  fps: number
  duration: number
  videoCodec: string
  profile: string
  pixFmt: string
  colorSpace?: string
  audioCodec?: string
  sampleRate?: number
  channels?: number
  /** Integrated loudness (LUFS) and true peak (dBTP), when there is sound. */
  loudness?: number
  truePeak?: number
  /** The index is at the start, so playback starts before the whole file downloads. */
  faststart: boolean
  bytes: number
}

/** Findings about the delivered file: codec, size, frame rate, sound level. */
export function checkFile(f: FileFacts, expected: { width: number; height: number; fps: number; duration: number; loudness: number | false }, platform: Platform): Finding[] {
  const out: Finding[] = []
  if (f.videoCodec !== 'h264') out.push({ level: 'error', message: `Video in ${f.videoCodec}: le piattaforme vogliono H.264.` })
  if (f.pixFmt !== 'yuv420p') out.push({ level: 'error', message: `Pixel format ${f.pixFmt}: serve yuv420p, altrimenti telefoni e Instagram possono non riprodurlo.` })
  if (/4:4:4|10/.test(f.profile)) out.push({ level: 'error', message: `Profilo H.264 ${f.profile}: serve High o Main.` })
  if (f.colorSpace && f.colorSpace !== 'bt709') out.push({ level: 'warning', message: `Spazio colore ${f.colorSpace}: con bt709 i colori restano uguali su ogni schermo.` })
  if (f.width !== expected.width || f.height !== expected.height) out.push({ level: 'error', message: `Il file è ${f.width}×${f.height}, la composizione ${expected.width}×${expected.height}.` })
  if (f.width * f.height < 1080 * 1080 * 0.99 && Math.min(f.width, f.height) < 1080) out.push({ level: 'warning', message: `Risoluzione ${f.width}×${f.height}: per ${platform.name} consegna almeno 1080 px sul lato corto.` })
  if (Math.abs(f.fps - expected.fps) > 0.01) out.push({ level: 'error', message: `Frame rate ${f.fps} invece di ${expected.fps}.` })
  if (f.fps < 24 || f.fps > 60) out.push({ level: 'warning', message: `Frame rate ${f.fps}: usa tra 24 e 60.` })
  if (Math.abs(f.duration - expected.duration) > 1.5 / expected.fps + 0.05) out.push({ level: 'warning', message: `Il file dura ${f.duration.toFixed(2)} s invece di ${expected.duration.toFixed(2)} s.` })
  if (!f.faststart) out.push({ level: 'warning', message: 'Manca faststart: il video parte solo dopo il download completo.' })
  if (f.bytes > 250 * 1024 * 1024) out.push({ level: 'warning', message: `Il file pesa ${(f.bytes / 1048576).toFixed(0)} MB: alcune piattaforme rifiutano file così grandi.` })

  if (!f.audioCodec) {
    out.push({ level: 'info', message: 'Il video non ha audio.' })
  } else {
    if (f.audioCodec !== 'aac') out.push({ level: 'error', message: `Audio in ${f.audioCodec}: serve AAC.` })
    if (f.sampleRate && f.sampleRate !== 48000 && f.sampleRate !== 44100) out.push({ level: 'warning', message: `Audio a ${f.sampleRate} Hz: usa 48000.` })
    if (f.channels && f.channels !== 2) out.push({ level: 'warning', message: `Audio a ${f.channels} canali: usa lo stereo.` })
    if (expected.loudness !== false && f.loudness !== undefined && Number.isFinite(f.loudness)) {
      if (Math.abs(f.loudness - expected.loudness) > 1) {
        out.push({ level: 'warning', message: `Volume ${f.loudness.toFixed(1)} LUFS invece di ${expected.loudness}: la piattaforma lo alzerà o abbasserà.` })
      }
    }
    if (f.truePeak !== undefined && f.truePeak > -0.5) out.push({ level: 'warning', message: `Picco a ${f.truePeak.toFixed(1)} dBTP: sopra -1 rischia di distorcere dopo la ricompressione.` })
  }
  return sortFindings(out)
}

const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 }

function sortFindings(list: Finding[]): Finding[] {
  return list.sort((a, b) => order[a.level] - order[b.level] || (a.at ?? 0) - (b.at ?? 0))
}

/** WCAG relative luminance of an sRGB color, 0..1. */
export function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG contrast ratio between two relative luminances, 1..21. */
export function contrastRatio(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

/** Findings as printable lines. */
export function formatFindings(list: Finding[]): string[] {
  const tag: Record<Severity, string> = { error: 'ERRORE    ', warning: 'ATTENZIONE', info: 'nota      ' }
  return list.map((f) => `${tag[f.level]} ${f.at !== undefined ? `[${fmt(f.at)}] ` : ''}${f.message}`)
}
