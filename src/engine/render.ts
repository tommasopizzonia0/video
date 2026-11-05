// Draws one frame of a composition onto a 2D canvas. Everything is a pure function of time,
// so the same frame always looks the same: that is what makes headless rendering reliable.

import { num, progress, valueAt } from './animate'
import { presetList, presetMod, type Mod } from './presets'
import {
  DEFAULT_SIZE,
  formatCounter,
  layerFonts,
  layoutText,
  unitOrder,
  type TextLayout,
  type Unit,
} from './text'
import { activeScenes, compDuration, layerWindow } from './timeline'
import { shapedTransition, type Pose } from './transitions'
import { captionPages, pageAt, type CaptionPage } from './captions'
import type {
  CaptionWord,
  CaptionsLayer,
  Composition,
  Fill,
  GroupLayer,
  ImageLayer,
  Layer,
  PathLayer,
  Scene,
  Shadow,
  Stroke,
  TextLayer,
  Transition,
  VideoLayer,
} from './types'

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas

export interface Drawable {
  source: CanvasImageSource
  width: number
  height: number
}

/** Media the renderer needs. Video frames must be prepared (see `videoRequests`) before drawing. */
export interface Resources {
  image(asset: string): Drawable | null
  videoFrame(asset: string, time: number): Drawable | null
  videoSize(asset: string): { width: number; height: number } | null
  pathLength(d: string): number
  /** Word timings of a "captions" asset. */
  captions?(asset: string): CaptionWord[] | null
}

export interface VideoRequest {
  asset: string
  time: number
}

/** Video frames needed to draw comp time `t`. */
export function videoRequests(comp: Composition, t: number): VideoRequest[] {
  const out: VideoRequest[] = []
  const visit = (layers: Layer[], lt: number, parentDuration: number) => {
    for (const layer of layers) {
      if (layer.hidden) continue
      const w = layerWindow(layer, parentDuration)
      const local = lt - w.start
      if (local < 0 || local >= w.duration) continue
      if (layer.type === 'video') out.push({ asset: layer.asset, time: videoTime(layer, local) })
      else if (layer.type === 'group') visit(layer.layers, local, w.duration)
    }
  }
  for (const s of activeScenes(comp.scenes ?? [], t)) visit(s.scene.layers, s.local, s.scene.duration)
  visit(comp.layers ?? [], t, compDuration(comp))
  return out
}

export function videoTime(layer: VideoLayer, local: number): number {
  return (layer.sourceStart ?? 0) + local * (layer.playbackRate ?? 1)
}

function createCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/** Offscreen layers for isolated groups, blurs and transitions, reused across frames. */
class CanvasPool {
  private free = new Map<string, AnyCanvas[]>()
  readonly w: number
  readonly h: number
  constructor(w: number, h: number) {
    this.w = w
    this.h = h
  }
  take(w = this.w, h = this.h): { canvas: AnyCanvas; ctx: Ctx2D } {
    const canvas = this.free.get(`${w}x${h}`)?.pop() ?? createCanvas(w, h)
    const ctx = canvas.getContext('2d') as Ctx2D
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.filter = 'none'
    ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(0, 0, w, h)
    return { canvas, ctx }
  }
  give(canvas: AnyCanvas) {
    const key = `${canvas.width}x${canvas.height}`
    const list = this.free.get(key) ?? []
    list.push(canvas)
    this.free.set(key, list)
  }
}

interface Env {
  ctx: Ctx2D
  res: Resources
  W: number
  H: number
  /** Output pixels per comp pixel. */
  scale: number
  pool: CanvasPool
}

export interface RenderOptions {
  /** Output scale: 0.5 renders a half-size draft. */
  scale?: number
}

/**
 * `n` times spread over a shutter of `shutter` seconds centered on `t`, kept inside the comp
 * so the first and last frames don't blend in the empty background before 0 or after the end.
 */
export function shutterTimes(t: number, n: number, shutter: number, duration: number): number[] {
  const last = Math.max(0, duration - 1e-6)
  return Array.from({ length: n }, (_, i) => Math.min(last, Math.max(0, t - shutter / 2 + (shutter * i) / (n - 1))))
}

export class Renderer {
  readonly comp: Composition
  readonly width: number
  readonly height: number
  readonly duration: number
  readonly fps: number
  private ctx: Ctx2D
  private res: Resources
  private scale: number
  private pool: CanvasPool
  private grain: AnyCanvas[] | null = null

  constructor(canvas: AnyCanvas, comp: Composition, res: Resources, options: RenderOptions = {}) {
    this.comp = comp
    this.res = res
    this.scale = options.scale ?? 1
    // Even dimensions: H.264 with 4:2:0 chroma requires them.
    this.width = Math.max(2, 2 * Math.round((comp.width * this.scale) / 2))
    this.height = Math.max(2, 2 * Math.round((comp.height * this.scale) / 2))
    this.duration = compDuration(comp)
    this.fps = comp.fps ?? 30
    canvas.width = this.width
    canvas.height = this.height
    this.ctx = canvas.getContext('2d') as Ctx2D
    this.pool = new CanvasPool(this.width, this.height)
  }

  /** Sub-frame times sampled for motion blur at comp time `t`. */
  sampleTimes(t: number, motionBlur: boolean): number[] {
    const mb = this.comp.effects?.motionBlur
    const n = motionBlur && mb ? Math.max(1, Math.round(mb.samples ?? 6)) : 1
    if (n === 1) return [t]
    return shutterTimes(t, n, (mb!.shutter ?? 0.5) / this.fps, this.duration)
  }

  /** Draws comp time `t`. Video frames for every sampled time must already be prepared. */
  draw(t: number, motionBlur = false) {
    const times = this.sampleTimes(t, motionBlur)
    if (times.length === 1) {
      this.drawInto(this.ctx, t)
    } else {
      // Running average of the sub-frames: sample i weighs 1/(i+1).
      const { canvas, ctx } = this.pool.take()
      this.ctx.setTransform(1, 0, 0, 1, 0, 0)
      times.forEach((st, i) => {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, this.width, this.height)
        this.drawInto(ctx, st, false)
        this.ctx.globalAlpha = 1 / (i + 1)
        this.ctx.drawImage(canvas, 0, 0)
      })
      this.ctx.globalAlpha = 1
      this.pool.give(canvas)
      this.drawEffects(this.ctx, t)
    }
  }

  private drawInto(ctx: Ctx2D, t: number, effects = true) {
    const env: Env = { ctx, res: this.res, W: this.comp.width, H: this.comp.height, scale: this.scale, pool: this.pool }
    ctx.setTransform(this.width / this.comp.width, 0, 0, this.height / this.comp.height, 0, 0)
    ctx.globalAlpha = 1
    ctx.filter = 'none'
    ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(0, 0, env.W, env.H)
    fillBox(env, this.comp.background ?? '#000000', t, 0, 0, env.W, env.H)

    const scenes = activeScenes(this.comp.scenes ?? [], t)
    if (scenes.length === 1 && scenes[0].enter === null) {
      drawScene(env, scenes[0].scene, scenes[0].local)
    } else if (scenes.length) {
      const incoming = scenes[scenes.length - 1]
      const outgoing = scenes.length > 1 ? scenes[0] : null
      const a = outgoing ? this.offscreen((e) => drawScene(e, outgoing.scene, outgoing.local)) : null
      const b = this.offscreen((e) => drawScene(e, incoming.scene, incoming.local))
      composeTransition(env, incoming.scene.transition, incoming.enter ?? 1, a?.canvas ?? null, b.canvas)
      if (a) this.pool.give(a.canvas)
      this.pool.give(b.canvas)
    }
    drawLayers(env, this.comp.layers ?? [], t, env.W, env.H, this.duration)
    if (effects) this.drawEffects(ctx, t)
  }

  private offscreen(draw: (env: Env) => void) {
    const off = this.pool.take()
    off.ctx.setTransform(this.width / this.comp.width, 0, 0, this.height / this.comp.height, 0, 0)
    draw({ ctx: off.ctx, res: this.res, W: this.comp.width, H: this.comp.height, scale: this.scale, pool: this.pool })
    return off
  }

  private drawEffects(ctx: Ctx2D, t: number) {
    const fx = this.comp.effects
    if (!fx) return
    const { width: w, height: h } = this
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.filter = 'none'
    if (fx.vignette) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.hypot(w, h) / 2)
      g.addColorStop(0, 'rgba(0,0,0,0)')
      g.addColorStop(1, `rgba(0,0,0,${Math.min(1, fx.vignette)})`)
      ctx.globalAlpha = 1
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    }
    if (fx.grain) {
      this.grain ??= makeGrain()
      const frame = Math.floor(t * this.fps)
      const tile = this.grain[frame % this.grain.length]
      const pattern = ctx.createPattern(tile, 'repeat')
      if (pattern) {
        const ox = (frame * 97) % 256
        const oy = (frame * 61) % 256
        pattern.setTransform(new DOMMatrix([1, 0, 0, 1, ox, oy]))
        ctx.globalCompositeOperation = 'overlay'
        ctx.globalAlpha = Math.min(1, fx.grain * 2)
        ctx.fillStyle = pattern
        ctx.fillRect(0, 0, w, h)
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 1
      }
    }
  }
}

function makeGrain(): AnyCanvas[] {
  let seed = 1234567
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
  return Array.from({ length: 6 }, () => {
    const c = createCanvas(256, 256)
    const ctx = c.getContext('2d') as Ctx2D
    const img = ctx.createImageData(256, 256)
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.round(128 + (rand() + rand() + rand() - 1.5) * 120)
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v
      img.data[i + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    return c
  })
}

function drawScene(env: Env, scene: Scene, local: number) {
  if (scene.background) fillBox(env, scene.background, local, 0, 0, env.W, env.H)
  drawLayers(env, scene.layers, local, env.W, env.H, scene.duration)
}

function composeTransition(env: Env, tr: Transition | undefined, p: number, a: AnyCanvas | null, b: AnyCanvas) {
  const ctx = env.ctx
  const W = env.W
  const H = env.H
  const draw = (c: AnyCanvas | null, alpha = 1, dx = 0, dy = 0, scale = 1, blur = 0) => {
    if (!c || alpha <= 0) return
    let source = c
    let small: ReturnType<CanvasPool['take']> | null = null
    let sw = c.width
    let sh = c.height
    const px = blur * env.scale
    if (px > 0.5) {
      // Blur a downscaled copy: same look, a fraction of the cost.
      const down = downFor(px)
      sw = c.width * down
      sh = c.height * down
      small = env.pool.take(Math.max(1, Math.ceil(sw)), Math.max(1, Math.ceil(sh)))
      small.ctx.filter = `blur(${(px * down).toFixed(2)}px)`
      small.ctx.drawImage(c, 0, 0, sw, sh)
      source = small.canvas
    }
    ctx.save()
    ctx.globalAlpha = Math.min(1, alpha)
    ctx.imageSmoothingQuality = 'high'
    ctx.translate(W / 2 + dx, H / 2 + dy)
    ctx.scale(scale, scale)
    ctx.drawImage(source, 0, 0, sw, sh, -W / 2, -H / 2, W, H)
    ctx.restore()
    if (small) env.pool.give(small.canvas)
  }
  const shaped = tr ? shapedTransition(tr, p, W, H) : null
  if (shaped) {
    const pose = (c: AnyCanvas | null, q: Pose | null) => {
      if (!c || !q) return
      if (!q.smear) return draw(c, q.alpha, q.dx, q.dy, q.scale, q.blur)
      // Directional smear: a running average of copies spread along the motion.
      const n = 7
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1) - 0.5
        draw(c, q.alpha / (i + 1), q.dx + q.smear[0] * f, q.dy + q.smear[1] * f, q.scale, q.blur)
      }
    }
    pose(a, shaped.a)
    pose(b, shaped.b)
    if (shaped.overlay && shaped.overlay.alpha > 0) {
      ctx.save()
      ctx.globalAlpha = Math.min(1, shaped.overlay.alpha)
      ctx.fillStyle = shaped.overlay.color
      ctx.fillRect(0, 0, W, H)
      ctx.restore()
    }
    return
  }
  const type = tr?.type ?? 'fade'
  const dir = tr?.direction ?? 'left'
  const vx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0
  const vy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0
  const k = Math.min(W, H) / 1080
  switch (type) {
    case 'cut':
      return draw(b)
    case 'fade':
      draw(a)
      return draw(b, p)
    case 'dip': {
      const color = tr?.color ?? '#000000'
      if (p < 0.5) draw(a)
      else draw(b)
      ctx.save()
      ctx.globalAlpha = 1 - Math.abs(p * 2 - 1)
      ctx.fillStyle = color
      ctx.fillRect(0, 0, W, H)
      ctx.restore()
      return
    }
    case 'slide':
      draw(a, 1, vx * W * p * 0.25, vy * H * p * 0.25)
      return draw(b, 1, -vx * W * (1 - p), -vy * H * (1 - p))
    case 'push':
      draw(a, 1, vx * W * p, vy * H * p)
      return draw(b, 1, -vx * W * (1 - p), -vy * H * (1 - p))
    case 'zoom':
      // Punch through: the old scene rushes past, the new one settles from slightly closer.
      draw(a, 1, 0, 0, 1 + 0.4 * p, 24 * k * p)
      return draw(b, p, 0, 0, 1.2 - 0.2 * p, 16 * k * (1 - p))
    case 'blur':
      draw(a, 1, 0, 0, 1, 40 * k * p)
      return draw(b, p, 0, 0, 1, 40 * k * (1 - p))
    case 'wipe': {
      draw(a)
      ctx.save()
      ctx.beginPath()
      if (vx < 0) ctx.rect(W * (1 - p), 0, W * p, H)
      else if (vx > 0) ctx.rect(0, 0, W * p, H)
      else if (vy < 0) ctx.rect(0, H * (1 - p), W, H * p)
      else ctx.rect(0, 0, W, H * p)
      ctx.clip()
      draw(b)
      ctx.restore()
      return
    }
    case 'iris': {
      draw(a)
      ctx.save()
      ctx.beginPath()
      ctx.arc(W / 2, H / 2, (Math.hypot(W, H) / 2) * p, 0, Math.PI * 2)
      ctx.clip()
      draw(b)
      ctx.restore()
      return
    }
  }
}

export function drawLayers(env: Env, layers: Layer[], t: number, pw: number, ph: number, parentDuration: number) {
  for (const layer of layers) drawLayer(env, layer, t, pw, ph, parentDuration)
}

const layoutCache = new WeakMap<TextLayer, Map<string, TextLayout>>()

function textLayout(ctx: Ctx2D, layer: TextLayer, text: string): TextLayout {
  let byText = layoutCache.get(layer)
  if (!byText) {
    byText = new Map()
    layoutCache.set(layer, byText)
  }
  const cached = byText.get(text)
  if (cached) return cached
  const fonts = layerFonts(layer)
  const size = layer.size ?? DEFAULT_SIZE
  const ls = (layer.letterSpacing ?? 0) * size
  ctx.save()
  ctx.letterSpacing = `${ls}px`
  ctx.font = fonts[0]
  const m = ctx.measureText('Hg')
  const ascent = m.fontBoundingBoxAscent ?? size * 0.8
  const descent = m.fontBoundingBoxDescent ?? size * 0.2
  const widths = new Map<string, number>()
  const measure = (s: string, accent: boolean) => {
    const key = (accent ? '1' : '0') + s
    let w = widths.get(key)
    if (w === undefined) {
      ctx.font = fonts[accent ? 1 : 0]
      w = ctx.measureText(s).width
      widths.set(key, w)
    }
    return w
  }
  const layout = layoutText(layer, text, measure, ascent, descent)
  ctx.restore()
  layout.fonts = fonts
  if (byText.size > 200) byText.clear()
  byText.set(text, layout)
  return layout
}

function textOf(layer: TextLayer, lt: number): string {
  const c = layer.counter
  if (!c) return layer.text
  const p = progress(lt, c.at ?? 0, c.duration ?? 1.5, c.ease, 'outExpo')
  const value = c.from + (c.to - c.from) * p
  return layer.text.includes('#') ? layer.text.replace('#', formatCounter(c, value)) : formatCounter(c, value)
}

/** Size of the layer box at local time `lt`. */
function boxSize(env: Env, layer: Layer, lt: number, pw: number, ph: number): [number, number] {
  switch (layer.type) {
    case 'rect':
    case 'ellipse':
      return [num(layer.width, lt, 0), num(layer.height, lt, 0)]
    case 'path':
      return [layer.width, layer.height]
    case 'text': {
      const l = textLayout(env.ctx, layer, textOf(layer, lt))
      return [l.w, l.h]
    }
    case 'group':
      return [num(layer.width, lt, pw), num(layer.height, lt, ph)]
    case 'captions': {
      const page = captionState(env, layer, lt)
      return page ? [page.layout.w, page.layout.h] : [0, 0]
    }
    case 'image':
    case 'video': {
      const natural = layer.type === 'image' ? env.res.image(layer.asset) : env.res.videoSize(layer.asset)
      const w = layer.width === undefined ? undefined : num(layer.width, lt, 0)
      const h = layer.height === undefined ? undefined : num(layer.height, lt, 0)
      if (w !== undefined && h !== undefined) return [w, h]
      if (layer.type === 'video' && w === undefined && h === undefined) return [pw, ph]
      if (!natural || !natural.width || !natural.height) return [w ?? 0, h ?? 0]
      const aspect = natural.width / natural.height
      if (w !== undefined) return [w, w / aspect]
      if (h !== undefined) return [h * aspect, h]
      return [natural.width, natural.height]
    }
  }
}

/** CSS filter for everything except blur, which drawLayer handles itself. */
function filterString(layer: Layer, lt: number): string {
  const parts: string[] = []
  const brightness = num(layer.brightness, lt, 1)
  if (brightness !== 1) parts.push(`brightness(${brightness})`)
  const contrast = num(layer.contrast, lt, 1)
  if (contrast !== 1) parts.push(`contrast(${contrast})`)
  const saturate = num(layer.saturate, lt, 1)
  if (saturate !== 1) parts.push(`saturate(${saturate})`)
  const grayscale = num(layer.grayscale, lt, 0)
  if (grayscale) parts.push(`grayscale(${grayscale})`)
  const hue = num(layer.hueRotate, lt, 0)
  if (hue) parts.push(`hue-rotate(${hue}deg)`)
  return parts.length ? parts.join(' ') : 'none'
}

function applyLook(ctx: Ctx2D, layer: Layer, opacity: number, filter: string) {
  ctx.globalAlpha *= opacity
  ctx.filter = filter
  if (layer.blend && layer.blend !== 'normal') {
    ctx.globalCompositeOperation = layer.blend === 'add' ? 'lighter' : layer.blend
  }
}

/** Largest power-of-two downscale that keeps a blur of `px` output pixels at 3 to 6 small pixels. */
function downFor(px: number): number {
  let down = 1
  while (down > 1 / 64 && px * down > 6) down /= 2
  return down
}

/**
 * Drop shadow from the silhouette of `source` (drawn at `down` scale): tinted, blurred at low
 * resolution and drawn behind the layer. Far cheaper than canvas shadowBlur at large radii.
 */
function drawShadow(env: Env, source: AnyCanvas, down: number, shadow: Shadow, opacity: number) {
  const blurPx = (shadow.blur ?? 30) * env.scale
  const sd = Math.min(down, downFor(blurPx))
  const w = Math.max(1, Math.ceil(env.pool.w * sd))
  const h = Math.max(1, Math.ceil(env.pool.h * sd))
  const sil = env.pool.take(w, h)
  sil.ctx.drawImage(source, 0, 0, env.pool.w * down, env.pool.h * down, 0, 0, env.pool.w * sd, env.pool.h * sd)
  sil.ctx.globalCompositeOperation = 'source-in'
  sil.ctx.fillStyle = shadow.color ?? 'rgba(0,0,0,0.35)'
  sil.ctx.fillRect(0, 0, w, h)
  const blurred = env.pool.take(w, h)
  if (blurPx * sd > 0.05) blurred.ctx.filter = `blur(${(blurPx * sd).toFixed(2)}px)`
  blurred.ctx.drawImage(sil.canvas, 0, 0)
  const ctx = env.ctx
  ctx.save()
  ctx.globalAlpha *= opacity
  ctx.filter = 'none'
  ctx.imageSmoothingQuality = 'high'
  const dx = (shadow.x ?? 0) * env.scale
  const dy = (shadow.y ?? 12) * env.scale
  ctx.drawImage(blurred.canvas, 0, 0, env.pool.w * sd, env.pool.h * sd, dx, dy, env.pool.w, env.pool.h)
  ctx.restore()
  env.pool.give(sil.canvas)
  env.pool.give(blurred.canvas)
}

function drawLayer(env: Env, layer: Layer, t: number, pw: number, ph: number, parentDuration: number) {
  if (layer.hidden) return
  const win = layerWindow(layer, parentDuration)
  const lt = t - win.start
  if (lt < 0 || lt >= win.duration) return

  const [bw, bh] = boxSize(env, layer, lt, pw, ph)
  const enter = presetList(layer.in)
  const exit = presetList(layer.out)
  const mod = presetMod(enter, exit, lt, win.duration, {
    boxW: bw,
    boxH: bh,
    frameW: env.W,
    frameH: env.H,
    unit: false,
  })
  const opacity = num(layer.opacity, lt, 1) * mod.opacity
  if (opacity <= 0.001 || mod.scale === 0) return

  const filter = filterString(layer, lt)
  // Blur in output pixels. Small blurs use the canvas filter directly; large ones are drawn
  // at reduced resolution and blurred there, which looks the same and is many times faster.
  const blurPx = (num(layer.blur, lt, 0) + mod.blur) * env.scale
  const heavyBlur = blurPx > 3
  const lightBlur = blurPx > 0.05 && !heavyBlur ? `blur(${blurPx.toFixed(2)}px)` : ''
  const fullFilter = [filter === 'none' ? '' : filter, lightBlur].filter(Boolean).join(' ') || 'none'
  const isolate =
    heavyBlur ||
    !!layer.shadow ||
    (layer.type === 'group' && (opacity < 1 || fullFilter !== 'none' || (!!layer.blend && layer.blend !== 'normal')))

  const outer = env.ctx
  outer.save()
  let target = outer
  let off: ReturnType<CanvasPool['take']> | null = null
  // Downsampling factor: a power of two that keeps the blur radius at 3 to 6 small pixels.
  const down = heavyBlur ? downFor(blurPx) : 1
  if (isolate) {
    off = env.pool.take(Math.max(1, Math.ceil(env.pool.w * down)), Math.max(1, Math.ceil(env.pool.h * down)))
    const m = outer.getTransform()
    off.ctx.setTransform(m.a * down, m.b * down, m.c * down, m.d * down, m.e * down, m.f * down)
    target = off.ctx
  } else {
    applyLook(outer, layer, opacity, fullFilter)
  }
  const e: Env = { ...env, ctx: target }

  const x = num(layer.x, lt, pw / 2)
  // Captions sit in the lower third by default, clear of the platform buttons at the very bottom.
  const y = num(layer.y, lt, layer.type === 'captions' ? ph * (ph > pw ? 0.7 : 0.84) : ph / 2)
  const [ax, ay] = layer.anchor ?? [0.5, 0.5]
  const scale = num(layer.scale, lt, 1) * mod.scale
  target.translate(x + mod.dx, y + mod.dy)
  const rot = num(layer.rotation, lt, 0) + mod.rotation
  if (rot) target.rotate((rot * Math.PI) / 180)
  const skew = num(layer.skewX, lt, 0)
  if (skew) target.transform(1, 0, Math.tan((skew * Math.PI) / 180), 1, 0, 0)
  target.scale(num(layer.scaleX, lt, 1) * scale, num(layer.scaleY, lt, 1) * scale)
  target.translate(-ax * bw, -ay * bh)
  applyModClip(target, mod, bw, bh, layer.type === 'text' ? (layer.size ?? DEFAULT_SIZE) * 0.25 : 0)

  drawContent(e, layer, lt, win.duration, bw, bh)

  if (off) {
    let source = off.canvas
    let blurred: ReturnType<CanvasPool['take']> | null = null
    if (heavyBlur) {
      blurred = env.pool.take(off.canvas.width, off.canvas.height)
      blurred.ctx.filter = `blur(${(blurPx * down).toFixed(2)}px)`
      blurred.ctx.drawImage(off.canvas, 0, 0)
      source = blurred.canvas
    }
    outer.setTransform(1, 0, 0, 1, 0, 0)
    if (layer.shadow) drawShadow({ ...env, ctx: outer }, source, down, layer.shadow, opacity)
    applyLook(outer, layer, opacity, heavyBlur ? filter : fullFilter)
    outer.imageSmoothingQuality = 'high'
    outer.drawImage(source, 0, 0, env.pool.w * down, env.pool.h * down, 0, 0, env.pool.w, env.pool.h)
    env.pool.give(off.canvas)
    if (blurred) env.pool.give(blurred.canvas)
  }
  outer.restore()
}

/** Clip and inner offset of mask/wipe presets. `pad` leaves room for glyphs that overhang their box. */
function applyModClip(ctx: Ctx2D, mod: Mod, w: number, h: number, pad: number) {
  if (mod.clip) {
    const [l, t, r, b] = mod.clip
    ctx.beginPath()
    const x0 = l > 0 ? l * w : -pad - w
    const y0 = t > 0 ? t * h : mod.innerY !== 0 ? -pad * 0.2 : -pad - h
    const x1 = r > 0 ? w * (1 - r) : w + pad + w
    const y1 = b > 0 ? h * (1 - b) : mod.innerY !== 0 ? h + pad * 0.6 : h + pad + h
    // Mask presets only clip along their axis of travel.
    const cx0 = mod.innerX !== 0 ? Math.max(x0, -pad * 0.2) : x0
    const cx1 = mod.innerX !== 0 ? Math.min(x1, w + pad * 0.2) : x1
    ctx.rect(cx0, y0, Math.max(0, cx1 - cx0), Math.max(0, y1 - y0))
    ctx.clip()
  }
  if (mod.innerX || mod.innerY) ctx.translate(mod.innerX * w, mod.innerY * h)
}

function drawContent(env: Env, layer: Layer, lt: number, duration: number, bw: number, bh: number) {
  const ctx = env.ctx
  switch (layer.type) {
    case 'rect': {
      const r = Math.min(num(layer.radius, lt, 0), bw / 2, bh / 2)
      ctx.beginPath()
      if (r > 0) ctx.roundRect(0, 0, bw, bh, r)
      else ctx.rect(0, 0, bw, bh)
      paint(env, layer.fill ?? '#ffffff', layer.stroke, lt, bw, bh)
      return
    }
    case 'ellipse':
      ctx.beginPath()
      ctx.ellipse(bw / 2, bh / 2, bw / 2, bh / 2, 0, 0, Math.PI * 2)
      paint(env, layer.fill ?? '#ffffff', layer.stroke, lt, bw, bh)
      return
    case 'path':
      return drawPath(env, layer, lt, bw, bh)
    case 'text':
      return drawText(env, layer, lt, duration)
    case 'image':
    case 'video': {
      const img = layer.type === 'image' ? env.res.image(layer.asset) : env.res.videoFrame(layer.asset, videoTime(layer, lt))
      if (!img) return
      return drawMedia(env, img, layer, lt, bw, bh)
    }
    case 'group':
      return drawGroup(env, layer, lt, duration, bw, bh)
    case 'captions':
      return drawCaptions(env, layer, lt)
  }
}

function paint(env: Env, fill: Fill | undefined, stroke: Stroke | undefined, lt: number, w: number, h: number) {
  const ctx = env.ctx
  if (fill !== undefined && fill !== null) {
    ctx.fillStyle = makeFill(ctx, fill, lt, 0, 0, w, h)
    ctx.fill()
  }
  if (stroke) {
    ctx.strokeStyle = stroke.color
    ctx.lineWidth = stroke.width ?? 2
    ctx.stroke()
  }
}

export function makeFill(ctx: Ctx2D, fill: Fill, lt: number, x: number, y: number, w: number, h: number): string | CanvasGradient {
  if (typeof fill === 'object' && fill !== null && !Array.isArray(fill) && 'stops' in fill) {
    let g: CanvasGradient
    if (fill.type === 'radial') {
      const cx = x + (fill.cx ?? 0.5) * w
      const cy = y + (fill.cy ?? 0.5) * h
      g = ctx.createRadialGradient(cx, cy, 0, cx, cy, ((fill.r ?? 1) * Math.hypot(w, h)) / 2)
    } else {
      const a = (((fill.angle ?? 180) % 360) * Math.PI) / 180
      const dx = Math.sin(a)
      const dy = -Math.cos(a)
      const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2
      const cx = x + w / 2
      const cy = y + h / 2
      g = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half)
    }
    for (const [offset, color] of fill.stops) g.addColorStop(Math.max(0, Math.min(1, offset)), color)
    return g
  }
  return valueAt(fill, lt, '#ffffff')
}

function fillBox(env: Env, fill: Fill, lt: number, x: number, y: number, w: number, h: number) {
  env.ctx.fillStyle = makeFill(env.ctx, fill, lt, x, y, w, h)
  env.ctx.fillRect(x, y, w, h)
}

let pathCache = new Map<string, Path2D>()
function path2d(d: string): Path2D {
  let p = pathCache.get(d)
  if (!p) {
    if (pathCache.size > 500) pathCache = new Map()
    p = new Path2D(d)
    pathCache.set(d, p)
  }
  return p
}

function drawPath(env: Env, layer: PathLayer, lt: number, bw: number, bh: number) {
  const ctx = env.ctx
  const [vx, vy, vw, vh] = layer.viewBox ?? [0, 0, bw, bh]
  ctx.save()
  ctx.scale(bw / vw, bh / vh)
  ctx.translate(-vx, -vy)
  const p = path2d(layer.d)
  if (layer.fill !== undefined) {
    ctx.fillStyle = makeFill(ctx, layer.fill, lt, vx, vy, vw, vh)
    ctx.fill(p)
  }
  if (layer.stroke) {
    ctx.strokeStyle = layer.stroke.color
    ctx.lineWidth = layer.stroke.width ?? 2
    ctx.lineCap = layer.lineCap ?? 'round'
    ctx.lineJoin = layer.lineJoin ?? 'round'
    const start = Math.max(0, Math.min(1, num(layer.trimStart, lt, 0)))
    const end = Math.max(0, Math.min(1, num(layer.trimEnd, lt, 1)))
    if (start > 0 || end < 1) {
      if (end <= start) {
        ctx.restore()
        return
      }
      const len = env.res.pathLength(layer.d)
      ctx.setLineDash([(end - start) * len, len * 2])
      ctx.lineDashOffset = -start * len
    }
    ctx.stroke(p)
  }
  ctx.restore()
}

function drawMedia(env: Env, img: Drawable, layer: ImageLayer | VideoLayer, lt: number, bw: number, bh: number) {
  const ctx = env.ctx
  const r = Math.min(num(layer.radius, lt, 0), bw / 2, bh / 2)
  const fit = layer.fit ?? 'cover'
  let sx = 0
  let sy = 0
  let sw = img.width
  let sh = img.height
  let dx = 0
  let dy = 0
  let dw = bw
  let dh = bh
  if (fit === 'cover') {
    const s = Math.max(bw / img.width, bh / img.height)
    sw = bw / s
    sh = bh / s
    sx = (img.width - sw) / 2
    sy = (img.height - sh) / 2
  } else if (fit === 'contain') {
    const s = Math.min(bw / img.width, bh / img.height)
    dw = img.width * s
    dh = img.height * s
    dx = (bw - dw) / 2
    dy = (bh - dh) / 2
  }
  if (r > 0) {
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(dx, dy, dw, dh, r)
    ctx.clip()
    ctx.drawImage(img.source, sx, sy, sw, sh, dx, dy, dw, dh)
    ctx.restore()
  } else {
    ctx.drawImage(img.source, sx, sy, sw, sh, dx, dy, dw, dh)
  }
}

function drawGroup(env: Env, layer: GroupLayer, lt: number, duration: number, bw: number, bh: number) {
  const ctx = env.ctx
  const r = Math.min(num(layer.radius, lt, 0), bw / 2, bh / 2)
  const shape = () => {
    ctx.beginPath()
    if (r > 0) ctx.roundRect(0, 0, bw, bh, r)
    else ctx.rect(0, 0, bw, bh)
  }
  if (layer.fill !== undefined || layer.stroke) {
    shape()
    paint(env, layer.fill, undefined, lt, bw, bh)
  }
  ctx.save()
  if (layer.clip) {
    shape()
    ctx.clip()
  }
  drawLayers(env, layer.layers, lt, bw, bh, duration)
  ctx.restore()
  if (layer.stroke) {
    shape()
    paint(env, undefined, layer.stroke, lt, bw, bh)
  }
}

function drawText(env: Env, layer: TextLayer, lt: number, duration: number) {
  const ctx = env.ctx
  const layout = textLayout(ctx, layer, textOf(layer, lt))
  const fill = layer.color ?? '#ffffff'
  const fillStyle = makeFill(ctx, fill, lt, 0, 0, layout.w, layout.h)
  const accentFill = layer.accent?.color !== undefined ? makeFill(ctx, layer.accent.color, lt, 0, 0, layout.w, layout.h) : fillStyle

  if (layer.background) {
    const bg = layer.background
    const [py, px] = typeof bg.padding === 'number' ? [bg.padding, bg.padding] : (bg.padding ?? [16, 28])
    const boxes =
      bg.mode === 'line'
        ? layout.lines.filter((l) => l.w > 0).map((l) => [l.x - px, l.top - py, l.w + px * 2, layout.lineHeight + py * 2])
        : [[Math.min(...layout.lines.map((l) => l.x)) - px, -py, Math.max(...layout.lines.map((l) => l.w)) + px * 2, layout.h + py * 2]]
    ctx.save()
    ctx.fillStyle = makeFill(ctx, bg.fill, lt, 0, 0, layout.w, layout.h)
    for (const [x, y, w, h] of boxes) {
      ctx.beginPath()
      ctx.roundRect(x, y, w, h, Math.min(bg.radius ?? 12, h / 2))
      ctx.fill()
    }
    ctx.restore()
  }

  ctx.letterSpacing = `${layout.letterSpacing}px`
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  const stroke = layer.stroke

  const drawUnitPieces = (u: Unit) => {
    const baseline = layout.lines[u.line].baseline
    for (const piece of u.pieces) {
      ctx.font = layout.fonts[piece.accent ? 1 : 0]
      if (stroke) {
        ctx.lineJoin = 'round'
        ctx.lineWidth = stroke.width ?? 2
        ctx.strokeStyle = stroke.color
        ctx.strokeText(piece.text, piece.x, baseline)
      }
      ctx.fillStyle = piece.accent ? accentFill : fillStyle
      ctx.fillText(piece.text, piece.x, baseline)
    }
  }

  const anim = layer.animate
  const exitAnim = layer.exit
  if (!anim && !exitAnim) {
    for (const u of layout.lineUnits) drawUnitPieces(u)
    return
  }

  // Per-unit animation: each unit gets its own staggered entrance and exit.
  const by = anim?.by ?? exitAnim?.by ?? 'word'
  const units = by === 'char' ? layout.chars : by === 'line' ? layout.lineUnits : layout.words
  const enter = presetList(anim?.preset ?? (anim ? 'fadeUp' : undefined))
  const exit = presetList(exitAnim?.preset ?? (exitAnim ? 'fade' : undefined))
  const order = unitOrder(units.length, anim?.order)
  const exitOrder = unitOrder(units.length, exitAnim?.order)
  const stagger = anim?.stagger ?? (by === 'char' ? 0.03 : by === 'word' ? 0.08 : 0.15)
  const exitStagger = exitAnim?.stagger ?? stagger / 2
  const maxExitOrder = Math.max(0, ...exitOrder)
  const size = layer.size ?? DEFAULT_SIZE

  const baseAlpha = ctx.globalAlpha
  const baseFilter = ctx.filter
  units.forEach((u, i) => {
    const enterStart = (anim?.delay ?? 0) + order[i] * stagger
    const exitEnd = duration - (exitAnim?.delay ?? 0) - (maxExitOrder - exitOrder[i]) * exitStagger
    const top = layout.lines[u.line].top
    const unitCtx = { boxW: u.w, boxH: layout.lineHeight, frameW: env.W, frameH: env.H, unit: true }
    const mod = combine(
      presetMod(enter, [], lt, duration, unitCtx, enterStart, exitEnd, { duration: anim?.duration, ease: anim?.ease }),
      presetMod([], exit, lt, duration, unitCtx, enterStart, exitEnd, { duration: exitAnim?.duration, ease: exitAnim?.ease }),
    )
    if (mod.opacity <= 0.001 || mod.scale === 0) return
    ctx.save()
    ctx.globalAlpha = baseAlpha * mod.opacity
    if (mod.blur > 0.05) ctx.filter = `${baseFilter === 'none' ? '' : baseFilter + ' '}blur(${(mod.blur * env.scale).toFixed(2)}px)`
    const cx = u.x + u.w / 2
    const cy = top + layout.lineHeight / 2
    ctx.translate(cx + mod.dx, cy + mod.dy)
    if (mod.rotation) ctx.rotate((mod.rotation * Math.PI) / 180)
    if (mod.scale !== 1) ctx.scale(mod.scale, mod.scale)
    ctx.translate(-cx, -cy)
    if (mod.clip || mod.innerX || mod.innerY) {
      ctx.translate(u.x, top)
      applyModClip(ctx, mod, u.w, layout.lineHeight, size * 0.25)
      ctx.translate(-u.x, -top)
    }
    drawUnitPieces(u)
    ctx.restore()
  })
}

function combine(a: Mod, b: Mod): Mod {
  return {
    dx: a.dx + b.dx,
    dy: a.dy + b.dy,
    scale: a.scale * b.scale,
    rotation: a.rotation + b.rotation,
    opacity: a.opacity * b.opacity,
    blur: a.blur + b.blur,
    clip: a.clip && b.clip ? a.clip.map((v, i) => Math.max(v, b.clip![i])) as Mod['clip'] : (a.clip ?? b.clip),
    innerX: a.innerX + b.innerX,
    innerY: a.innerY + b.innerY,
  }
}

interface CaptionLine {
  words: { text: string; x: number; w: number; index: number }[]
  w: number
}
interface CaptionLayout {
  lines: CaptionLine[]
  w: number
  h: number
  lineHeight: number
  font: string
  size: number
}

const captionCache = new WeakMap<CaptionsLayer, { pages: CaptionPage[]; layouts: Map<number, CaptionLayout> }>()

function captionWords(env: Env, layer: CaptionsLayer): CaptionWord[] {
  if (layer.words) return layer.words
  return (layer.asset && env.res.captions?.(layer.asset)) || []
}

/** Default caption size: 72 px when the short side of the frame is 1080. */
const captionSize = (env: Env, layer: CaptionsLayer) => layer.size ?? Math.round((72 * Math.min(env.W, env.H)) / 1080)

/** The page visible at `lt` with its layout, or null between pages. */
function captionState(env: Env, layer: CaptionsLayer, lt: number): { page: CaptionPage; layout: CaptionLayout } | null {
  let cache = captionCache.get(layer)
  if (!cache) {
    cache = { pages: captionPages(captionWords(env, layer), layer.maxWords ?? 3, layer.maxChars ?? 22), layouts: new Map() }
    if (cache.pages.length) captionCache.set(layer, cache)
  }
  const i = pageAt(cache.pages, lt)
  if (i < 0) return null
  const page = cache.pages[i]
  let layout = cache.layouts.get(i)
  if (!layout) {
    const ctx = env.ctx
    const size = captionSize(env, layer)
    const font = `${layer.italic ? 'italic ' : ''}${layer.weight ?? 800} ${size}px ${JSON.stringify(layer.font ?? DEFAULT_FONT_FAMILY)}, sans-serif`
    ctx.save()
    ctx.font = font
    ctx.letterSpacing = `${(layer.letterSpacing ?? 0) * size}px`
    // Heavy outlined captions need a wider gap than a plain space, or the strokes of neighbours touch.
    const space = ctx.measureText(' ').width * 1.5
    const maxW = layer.width ?? env.W * 0.8
    const lines: CaptionLine[] = []
    let line: CaptionLine = { words: [], w: 0 }
    page.words.forEach((word, index) => {
      const text = layer.uppercase ? word.text.toUpperCase() : word.text
      const w = ctx.measureText(text).width
      const x = line.words.length ? line.w + space : 0
      if (line.words.length && x + w > maxW) {
        lines.push(line)
        line = { words: [], w: 0 }
        line.words.push({ text, x: 0, w, index })
        line.w = w
      } else {
        line.words.push({ text, x, w, index })
        line.w = x + w
      }
    })
    if (line.words.length) lines.push(line)
    ctx.restore()
    const lineHeight = size * (layer.lineHeight ?? 1.12)
    layout = { lines, w: Math.max(...lines.map((l) => l.w)), h: lineHeight * lines.length, lineHeight, font, size }
    cache.layouts.set(i, layout)
  }
  return { page, layout }
}

const DEFAULT_FONT_FAMILY = 'Inter'

function drawCaptions(env: Env, layer: CaptionsLayer, lt: number) {
  const state = captionState(env, layer, lt)
  if (!state) return
  const { page, layout } = state
  const ctx = env.ctx
  const color = layer.color ?? '#ffffff'
  const highlight = layer.highlight ?? '#FFE45E'
  const stroke = layer.stroke === false ? null : (layer.stroke ?? { color: '#000000', width: Math.max(4, layout.size * 0.14) })
  const reveal = layer.mode === 'reveal'
  // The page arrives with a short pop; in reveal mode each word pops on its own start instead.
  const pageIn = Math.min(1, (lt - page.start) / 0.12)

  if (layer.background) {
    const bg = layer.background
    const [py, px] = typeof bg.padding === 'number' ? [bg.padding, bg.padding] : (bg.padding ?? [layout.size * 0.22, layout.size * 0.4])
    ctx.save()
    ctx.globalAlpha *= reveal ? 1 : pageIn
    ctx.fillStyle = makeFill(ctx, bg.fill, lt, 0, 0, layout.w, layout.h)
    ctx.beginPath()
    ctx.roundRect(-px, -py, layout.w + px * 2, layout.h + py * 2, Math.min(bg.radius ?? layout.size * 0.3, (layout.h + py * 2) / 2))
    ctx.fill()
    ctx.restore()
  }

  ctx.font = layout.font
  ctx.letterSpacing = `${(layer.letterSpacing ?? 0) * layout.size}px`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.lineJoin = 'round'
  const base = ctx.globalAlpha
  layout.lines.forEach((line, li) => {
    const ox = (layout.w - line.w) / 2
    const cy = layout.lineHeight * (li + 0.5)
    for (const word of line.words) {
      const w = page.words[word.index]
      const spoken = lt >= w.start
      const active = spoken && (lt < w.end || word.index === page.words.length - 1 || lt < page.words[word.index + 1].start)
      if (reveal && !spoken) continue
      // Pop: a quick scale from 0.7 (reveal) or a small swell on the active word (highlight).
      const since = lt - w.start
      const pop = Math.min(1, Math.max(0, since / 0.16))
      const ease = 1 - (1 - pop) ** 3
      const scale = reveal ? 0.7 + 0.3 * ease + 0.06 * Math.sin(Math.PI * ease) : active ? 1 + 0.05 * Math.sin(Math.PI * Math.min(1, since / 0.22)) : 1
      ctx.save()
      ctx.globalAlpha = base * (reveal ? Math.min(1, since / 0.08) : 0.35 + 0.65 * pageIn)
      const cx = ox + word.x + word.w / 2
      ctx.translate(cx, cy)
      ctx.scale(scale, scale)
      if (!reveal && pageIn < 1) ctx.scale(0.92 + 0.08 * pageIn, 0.92 + 0.08 * pageIn)
      if (stroke) {
        ctx.strokeStyle = stroke.color
        ctx.lineWidth = stroke.width ?? 10
        ctx.strokeText(word.text, -word.w / 2, 0)
      }
      ctx.fillStyle = active ? highlight : color
      ctx.fillText(word.text, -word.w / 2, 0)
      ctx.restore()
    }
  })
}
