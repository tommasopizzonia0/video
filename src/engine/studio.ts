// Product shots from photos: a "studio" layer (backdrop, products, camera move) turned into plain
// layers. It runs once the images are loaded, because the layout needs each photo's shape and the
// box of its visible pixels (a cut-out's transparent margins must not hold the product off the floor).

import { mixColors, withAlpha } from './color'
import type { Drawable } from './render'
import { compDuration } from './timeline'
import type { Anim, Composition, GroupLayer, Keyframe, Layer, StudioLayer, StudioProduct } from './types'

/** What the layout needs to know of an image: its size and the box of its visible pixels (0..1). */
export interface ImageInfo {
  width: number
  height: number
  /** [left, top, right, bottom] of the pixels that are not transparent, relative to the image. */
  box: [number, number, number, number]
}

/** Box of the pixels with alpha above `threshold` in RGBA data, relative to the size; the whole image when none are. */
export function boxFromAlpha(data: Uint8ClampedArray, w: number, h: number, threshold = 24): [number, number, number, number] {
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        y1 = y
      }
    }
  }
  if (x1 < 0) return [0, 0, 1, 1]
  return [x0 / w, y0 / h, (x1 + 1) / w, (y1 + 1) / h]
}

/** Size and visible box of a loaded image (browser only). */
export function imageInfo(img: Drawable): ImageInfo {
  const { width, height } = img
  const k = Math.min(1, 256 / Math.max(width, height, 1))
  const w = Math.max(1, Math.round(width * k))
  const h = Math.max(1, Math.round(height * k))
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img.source, 0, 0, w, h)
  return { width, height, box: boxFromAlpha(ctx.getImageData(0, 0, w, h).data, w, h) }
}

const ease = 'inOutSine'
/** Radial gradient radius that ends exactly at the edge of its ellipse (radii are relative to half the diagonal). */
const EDGE = Math.SQRT1_2
const r1 = (v: number) => Math.round(v * 10) / 10

/** A move from `a` to `b` over `d` seconds, or the plain value when they are equal. */
function move(a: number, b: number, d: number): Anim<number> {
  const r = (v: number) => Math.round(v * 1000) / 1000
  return a === b ? a : [{ t: 0, v: r(a) }, { t: d, v: r(b), ease }]
}

/** A slow up-and-down around `base` (period 3.2 s) over `d` seconds, `amp` px at the top. */
function bob(base: number, amp: number, d: number): Keyframe<number>[] {
  const out: Keyframe<number>[] = []
  for (let i = 0, t = 0; t <= d + 0.8; i++, t += 0.8) out.push({ t: Math.round(t * 100) / 100, v: r1(base + (i % 4 === 1 ? -amp : i % 4 === 3 ? amp * 0.4 : 0)), ease })
  return out
}

function full(W: number, H: number, layers: Layer[], extra: Partial<GroupLayer> = {}): GroupLayer {
  return { type: 'group', x: W / 2, y: H / 2, width: W, height: H, layers, ...extra }
}

function backdropLayers(l: StudioLayer, W: number, H: number, floor: number, focusX: number): Layer[] {
  const style = l.backdrop?.style ?? 'sweep'
  const c = l.backdrop?.color ?? '#ece8e1'
  if (style === 'none') return []
  // Larger than the frame, so camera moves never show its edges.
  const BW = W * 1.4
  const BH = H * 1.4
  const top = (H * 1.4 - H) / 2
  const at = (y: number) => Math.min(1, Math.max(0, (y + top) / BH))
  const light = mixColors(c, '#ffffff', 0.35)
  const dark = (u: number) => mixColors(c, '#000000', u)
  const out: Layer[] = []
  if (style === 'sweep') {
    // Seamless paper: the wall darker at the top, brightest where it curves into the floor, the floor darkening toward the lens.
    out.push({ type: 'rect', width: BW, height: BH, fill: { type: 'linear', angle: 180, stops: [[0, dark(0.22)], [at(floor - H * 0.25), c], [at(floor), light], [at(floor + H * 0.06), c], [1, dark(0.14)]] } })
  } else if (style === 'spot') {
    out.push({ type: 'rect', width: BW, height: BH, fill: { type: 'linear', angle: 180, stops: [[0, dark(0.55)], [at(floor), dark(0.35)], [1, dark(0.6)]] } })
    out.push({ type: 'ellipse', x: focusX, y: floor - H * 0.12, width: W * 1.3, height: H * 0.9, fill: { type: 'radial', r: EDGE, stops: [[0, light], [0.45, withAlpha(c, 0.55)], [1, withAlpha(c, 0)]] } })
  } else {
    // Table: a wall, then a floor plane with a soft edge at the horizon.
    out.push({ type: 'rect', width: BW, height: BH, fill: { type: 'linear', angle: 180, stops: [[0, dark(0.12)], [at(floor - H * 0.04), light], [at(floor - H * 0.04) + 0.001, mixColors(c, '#000000', 0.05)], [1, dark(0.25)]] } })
    out.push({ type: 'ellipse', x: focusX, y: floor - H * 0.2, width: W * 1.2, height: H * 0.6, fill: { type: 'radial', r: EDGE, stops: [[0, withAlpha('#ffffff', 0.35)], [1, withAlpha('#ffffff', 0)]] } })
  }
  return out
}

interface Placed {
  p: StudioProduct
  info: ImageInfo
  /** Visible width and height, px. */
  vw: number
  vh: number
  /** Drawn image size, px. */
  iw: number
  ih: number
  x: number
  floor: number
  anchor: [number, number]
}

function place(p: StudioProduct, info: ImageInfo, x: number, floor: number, width: number): Placed {
  const [bx0, by0, bx1, by1] = info.box
  const vw = width
  const iw = vw / (bx1 - bx0)
  const ih = (iw * info.height) / info.width
  return { p, info, vw, vh: ih * (by1 - by0), iw, ih, x, floor, anchor: [(bx0 + bx1) / 2, by1] }
}

function productLayers(q: Placed, D: number, W: number, H: number): Layer[] {
  const { p, vw, vh, iw, ih, x, floor, anchor } = q
  const image = (extra: Partial<Layer> = {}): Layer => ({ type: 'image', asset: p.asset, width: r1(iw), height: r1(ih), x, y: floor, anchor, ...extra }) as Layer
  const lift = p.float ? bob(0, -Math.max(8, vh * 0.025), D) : undefined
  const out: Layer[] = []

  if (p.halo) {
    out.push({ type: 'ellipse', x, y: floor - vh * 0.55, width: vw * 1.9, height: vh * 1.5, blur: 20, fill: { type: 'radial', r: EDGE, stops: [[0, withAlpha(p.halo, 0.9)], [0.5, withAlpha(p.halo, 0.35)], [1, withAlpha(p.halo, 0)]] } })
  }
  const shadow = p.shadow ?? 'soft'
  const light = p.light ?? 'left'
  if (shadow) {
    // Shadows get lighter and wider as the product rises.
    const breath = lift ? lift.map((k) => ({ ...k, v: r1(1 + k.v / vh) })) : 1
    const fade = lift ? lift.map((k) => ({ ...k, v: Math.round((1 + (6 * k.v) / vh) * 100) / 100 })) : 1
    out.push({ type: 'ellipse', x, y: floor + vw * 0.012, width: vw * 1.3, height: Math.max(10, vw * 0.16), blur: Math.max(6, vw * 0.06), fill: 'rgba(0,0,0,0.30)', scaleX: breath, opacity: fade })
    out.push({ type: 'ellipse', x, y: floor, width: vw * 0.86, height: Math.max(5, vw * 0.045), blur: Math.max(2, vw * 0.014), fill: 'rgba(0,0,0,0.55)', opacity: fade })
    if (shadow === 'cast' && light !== 'top') {
      // The silhouette lying on the floor away from the light, foreshortened.
      out.push(image({ brightness: 0, opacity: 0.22, blur: Math.max(4, vw * 0.02), scaleY: 0.32, skewX: light === 'left' ? -50 : 50 } as Partial<Layer>))
    }
  }
  if (p.reflection) {
    // The mirror image under the floor line, fading out with a gradient matte.
    out.push(
      full(W, H, [
        image({ scaleY: -1, y: lift ? lift.map((k) => ({ ...k, v: floor - k.v })) : floor } as Partial<Layer>),
        { type: 'rect', x, y: floor, anchor: [0.5, 0], width: iw * 1.2, height: vh * 0.55, blend: 'matte', fill: { type: 'linear', angle: 180, stops: [[0, 'rgba(0,0,0,1)'], [1, 'rgba(0,0,0,0)']] } },
      ], { isolate: true, opacity: Math.min(1, Math.max(0, p.reflection)) }),
    )
  }

  // The product, with light painted only on its own pixels.
  const lit: Layer[] = [image()]
  const amount = Math.min(1, Math.max(0, p.lightAmount ?? 0.6))
  if (light && amount > 0) {
    const w = (a: number) => `rgba(255,255,255,${Math.round(a * amount * 100) / 100})`
    const k = (a: number) => `rgba(0,0,0,${Math.round(a * amount * 100) / 100})`
    // A softbox stripe near the lit edge, shade falling to the far edge.
    const stops: [number, string][] = [[0, w(0.12)], [0.1, w(0.5)], [0.24, w(0)], [0.62, k(0)], [1, k(0.38)]]
    const angle = light === 'left' ? 90 : light === 'right' ? 270 : 180
    lit.push({ type: 'rect', x, y: floor - vh / 2, width: vw, height: vh, blend: 'atop', fill: { type: 'linear', angle, stops } })
  }
  if (p.shine !== undefined && p.shine !== false) {
    const at = p.shine === true ? 0.5 : p.shine
    const band = vw * 0.4
    lit.push({
      type: 'rect',
      y: floor - vh / 2,
      x: { from: x - vw / 2 - band, to: x + vw / 2 + band, at, duration: 0.9, ease: 'inOutSine' },
      width: band,
      height: vh * 1.4,
      rotation: 18,
      blend: 'atop',
      fill: { type: 'linear', angle: 90, stops: [[0, 'rgba(255,255,255,0)'], [0.5, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']] },
    })
  }
  out.push(full(W, H, lit, { isolate: true, ...(lift && { y: lift.map((k) => ({ ...k, v: H / 2 + k.v })) }) }))
  return out
}

/** The camera move of one depth plane: 1 = the products, less for the backdrop behind them. */
function camera(l: StudioLayer, depth: number, D: number, W: number, H: number, cx: number, cy: number): Partial<GroupLayer> {
  const m = (l.move ?? 1) * depth
  const anchor: [number, number] = [cx / W, cy / H]
  const base = { x: cx, y: cy, anchor }
  switch (l.camera ?? 'push') {
    case 'push':
      return { ...base, scale: move(1, 1 + 0.08 * m, D) }
    case 'pull':
      return { ...base, scale: move(1 + 0.08 * m, 1, D) }
    case 'drift':
      return { ...base, x: move(cx - W * 0.035 * m, cx + W * 0.035 * m, D), scale: 1.02 }
    case 'rise':
      return { ...base, y: move(cy + H * 0.04 * m, cy, D), scale: move(1, 1 + 0.03 * m, D) }
    default:
      return base
  }
}

/** The plain layers of a studio layer lasting `D` seconds, in a `W`×`H` parent. */
export function expandStudioLayer(l: StudioLayer, D: number, W: number, H: number, info: (asset: string) => ImageInfo | null): GroupLayer {
  const floor = l.backdrop?.floor ?? H * 0.74
  const n = l.products.length
  const placed: Placed[] = []
  l.products.forEach((p, i) => {
    const im = info(p.asset)
    if (!im) return
    const x = p.x ?? (W * (i + 1)) / (n + 1)
    const width = p.width ?? (n === 1 ? W * 0.5 : (W * 0.8) / n)
    placed.push(place(p, im, x, p.y ?? floor, width))
  })
  const focusX = placed.length ? placed.reduce((s, q) => s + q.x, 0) / placed.length : W / 2
  const focusY = placed.length ? placed.reduce((s, q) => s + q.floor - q.vh / 2, 0) / placed.length : H / 2
  const { type: _t, backdrop: _b, products: _p, camera: _c, move: _m, ...base } = l
  return {
    ...base,
    type: 'group',
    width: W,
    height: H,
    layers: [
      full(W, H, backdropLayers(l, W, H, floor, focusX), camera(l, 0.35, D, W, H, W / 2, H / 2)),
      ...placed.map((q) => full(W, H, productLayers(q, D, W, H), { ...camera(l, 1, D, W, H, focusX, focusY), id: q.p.id, in: q.p.in, out: q.p.out })),
    ],
  }
}

function expandList(layers: Layer[], D: number, W: number, H: number, info: (asset: string) => ImageInfo | null): Layer[] {
  return layers.map((l) => {
    const d = l.duration ?? Math.max(0, D - (l.start ?? 0))
    if (l.type === 'studio') return expandStudioLayer(l, d, W, H, info)
    if (l.type === 'group') return { ...l, layers: expandList(l.layers, d, num(l.width, W), num(l.height, H), info) }
    return l
  })
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' ? v : fallback)

/** Whether the comp has a studio layer anywhere. */
export function hasStudio(comp: Composition): boolean {
  const visit = (ls: Layer[]): boolean => ls.some((l) => l.type === 'studio' || (l.type === 'group' && visit(l.layers)))
  return (comp.scenes ?? []).some((s) => visit(s.layers)) || visit(comp.layers ?? [])
}

/** The comp with every studio layer turned into plain layers. */
export function expandStudio(comp: Composition, info: (asset: string) => ImageInfo | null, duration: number): Composition {
  if (!hasStudio(comp)) return comp
  return {
    ...comp,
    scenes: comp.scenes?.map((s) => ({ ...s, layers: expandList(s.layers, s.duration, comp.width, comp.height, info) })),
    layers: comp.layers && expandList(comp.layers, duration, comp.width, comp.height, info),
  }
}

/** `expandStudio` with the images of loaded resources (browser only). */
export function expandStudioWith(comp: Composition, res: { image(asset: string): Drawable | null }): Composition {
  if (!hasStudio(comp)) return comp
  const cache = new Map<string, ImageInfo | null>()
  const info = (asset: string) => {
    if (!cache.has(asset)) {
      const img = res.image(asset)
      cache.set(asset, img ? imageInfo(img) : null)
    }
    return cache.get(asset)!
  }
  return expandStudio(comp, info, compDuration(comp))
}
