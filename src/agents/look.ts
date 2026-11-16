// The Video arrow's eyes: draws a few frames with the studio's renderer and notes where every text
// sat, how long it stayed readable and how it stood out from what was behind it.

import type { Platform } from '../engine/check'
import { contrastRatio, relativeLuminance } from '../engine/check'
import { parseColor } from '../engine/color'
import { videoRequests, type Renderer } from '../engine/render'
import type { BrowserResources } from '../engine/resources'
import { activeScenes } from '../engine/timeline'
import type { Composition, Layer } from '../engine/types'
import type { Look, Path, SeenText } from './team'

/** Every layer object of the comp with its path, so a drawn text can be traced back to the JSON. */
function layerPaths(comp: Composition): Map<object, Path> {
  const out = new Map<object, Path>()
  const visit = (layers: Layer[], path: Path) =>
    layers.forEach((l, j) => {
      const p = [...path, j]
      out.set(l, p)
      if (l.type === 'group') visit(l.layers, [...p, 'layers'])
    })
  ;(comp.scenes ?? []).forEach((s, i) => visit(s.layers, ['scenes', i, 'layers']))
  visit(comp.layers ?? [], ['layers'])
  return out
}

/**
 * Samples the comp (at most `maxFrames` frames) through `renderer`, which draws on the preview canvas:
 * the caller redraws the current frame afterwards.
 */
export async function look(comp: Composition, renderer: Renderer, res: BrowserResources, canvas: HTMLCanvasElement, platform: Platform, maxFrames = 60): Promise<Look> {
  const duration = renderer.duration
  const step = Math.max(0.2, Math.ceil((duration / maxFrames) * 20) / 20)
  const paths = layerPaths(comp)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const W = canvas.width
  const H = canvas.height
  const k = W / comp.width
  const [sl, st, sr, sb] = platform.safe
  interface Acc extends SeenText {
    sizes: number[]
  }
  const seen = new Map<object, Acc>()
  const empty: number[] = []

  for (let t = 0; t < duration - 1e-6; t += step) {
    await res.prepare(videoRequests(comp, t))
    renderer.probe = []
    renderer.draw(t)
    const drawn = renderer.probe
    renderer.probe = null
    const px = ctx.getImageData(0, 0, W, H).data
    const lum = (x: number, y: number) => {
      const i = (Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 4
      return relativeLuminance(px[i], px[i + 1], px[i + 2])
    }
    // A flat frame: almost no difference across a coarse grid.
    let lo = 1
    let hi = 0
    for (let gy = 0; gy < 12; gy++)
      for (let gx = 0; gx < 12; gx++) {
        const v = lum(Math.floor(((gx + 0.5) * W) / 12), Math.floor(((gy + 0.5) * H) / 12))
        lo = Math.min(lo, v)
        hi = Math.max(hi, v)
      }
    if (hi - lo < 0.02) empty.push(Math.round(t * 100) / 100)

    const moving = activeScenes(comp.scenes ?? [], t).some((a) => a.enter !== null && a.enter < 1)
    for (const d of drawn) {
      if (d.alpha < 0.5) continue
      const path = paths.get(d.layer)
      if (!path) continue
      const xs = d.corners.map((c) => c[0])
      const ys = d.corners.map((c) => c[1])
      const box: [number, number, number, number] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
      let e = seen.get(d.layer)
      if (!e) {
        const flat = d.text.replace(/\s+/g, ' ').trim()
        const label = d.layer.id ?? (flat.length > 40 ? flat.slice(0, 38).trimEnd() + '…' : flat)
        e = { path, label, kind: d.layer.type, first: t, visible: 0, words: 0, size: 0, sizes: [], box: [...box], outside: 0, contrast: null }
        seen.set(d.layer, e)
      }
      e.visible += step
      e.words = Math.max(e.words, d.text.split(/\s+/).filter(Boolean).length)
      if (moving) continue
      e.sizes.push(d.size)
      e.box = [Math.min(e.box[0], box[0]), Math.min(e.box[1], box[1]), Math.max(e.box[2], box[2]), Math.max(e.box[3], box[3])]
      const x0 = box[0] / comp.width
      const y0 = box[1] / comp.height
      const x1 = box[2] / comp.width
      const y1 = box[3] / comp.height
      if (x0 < sl - 0.004 || y0 < st - 0.004 || x1 > sr + 0.004 || y1 > sb + 0.004) e.outside += step
      // Contrast with a ring around the text (median luminance), for texts with no backing.
      const rgba = !d.backed && d.color ? parseColor(d.color) : null
      if (rgba && d.alpha > 0.9) {
        const pad = Math.max(4, d.size * 0.35) * k
        const values: number[] = []
        const bx0 = box[0] * k - pad
        const by0 = box[1] * k - pad
        const bx1 = box[2] * k + pad
        const by1 = box[3] * k + pad
        const n = 24
        for (let i = 0; i <= n; i++) {
          const x = Math.round(bx0 + ((bx1 - bx0) * i) / n)
          const y = Math.round(by0 + ((by1 - by0) * i) / n)
          values.push(lum(x, Math.round(by0)), lum(x, Math.round(by1)), lum(Math.round(bx0), y), lum(Math.round(bx1), y))
        }
        values.sort((a, b) => a - b)
        const c = contrastRatio(relativeLuminance(rgba[0], rgba[1], rgba[2]), values[values.length >> 1])
        e.contrast = e.contrast === null ? c : Math.min(e.contrast, c)
      }
    }
  }

  const texts: SeenText[] = [...seen.values()].map(({ sizes, ...e }) => {
    const sorted = [...sizes].sort((a, b) => a - b)
    return { ...e, visible: Math.round(e.visible * 100) / 100, first: Math.round(e.first * 100) / 100, outside: Math.round(e.outside * 100) / 100, size: Math.round(sorted[sorted.length >> 1] ?? 0), box: e.box.map(Math.round) as SeenText['box'], contrast: e.contrast === null ? null : Math.round(e.contrast * 100) / 100 }
  })
  return { step, texts, empty }
}
