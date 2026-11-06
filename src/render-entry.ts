// Page used by the headless renderer (scripts/render.mjs). It exposes a small API on `window`
// that the CLI drives through Playwright: load a composition, draw frames, export.

import { audioMix } from './engine/audio'
import { checkCuts, checkFile, checkFrames, contrastRatio, formatFindings, platformFor, relativeLuminance, type FileFacts, type FrameSample, type TextProbe } from './engine/check'
import { parseColor } from './engine/color'
import { captionPages, pageText, toSrt } from './engine/captions'
import { exportVideo, renderAudio } from './engine/export'
import { encodeWav, integratedLoudness } from './engine/loudness'
import { Renderer, videoRequests } from './engine/render'
import { activeScenes, placedLayers } from './engine/timeline'
import { BrowserResources } from './engine/resources'
import type { Composition } from './engine/types'
import { validate } from './engine/validate'
import { applyVariant } from './engine/variants'
import { expandStudioWith } from './engine/studio'
import { applyBeatGrid, sceneCuts } from './engine/beatgrid'

interface Session {
  comp: Composition
  res: BrowserResources
  renderer: Renderer
  canvas: HTMLCanvasElement
}

let session: Session | null = null

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, quality))
}

const api = {
  /** Validates and loads a composition; asset paths resolve against `base`, with `overrides` replacing some. */
  async load(comp: Composition, base: string, scale: number, overrides: Record<string, string> = {}, variant: string | null = null) {
    const issues = validate(comp)
    if (issues.some((i) => i.level === 'error')) return { issues }
    if (variant) {
      try {
        const v = applyVariant(comp, variant)
        comp = v.comp
      } catch (e) {
        return { issues: [{ level: 'error' as const, path: 'variants', message: e instanceof Error ? e.message : String(e) }] }
      }
    }
    await session?.res.dispose()
    const resolve = (src: string) => overrides[src] ?? new URL(src, base).href
    const res = await BrowserResources.load(comp, resolve)
    if (comp.beats) comp = applyBeatGrid(comp, res.beats(comp.beats.asset) ?? [])
    comp = expandStudioWith(comp, res)
    const canvas = document.getElementById('stage') as HTMLCanvasElement
    const renderer = new Renderer(canvas, comp, res, { scale })
    session = { comp, res, renderer, canvas }
    return {
      issues,
      width: renderer.width,
      height: renderer.height,
      fps: renderer.fps,
      duration: renderer.duration,
      audioSources: [...new Set(audioMix(comp).flatMap((c) => (c.asset && comp.assets?.[c.asset] ? [comp.assets[c.asset].src] : [])))],
    }
  },

  /**
   * The mixed sound of [from, from + duration] as a 32-bit float WAV (base64), not normalized, with its
   * loudness. `overrides` maps asset srcs to decodable copies. Null when the comp is silent.
   */
  async mixdown(from: number, duration: number, overrides: Record<string, string> = {}) {
    const s = session!
    const buffer = await renderAudio(s.comp, s.res, duration, { from, audioSrc: (src) => overrides[src], normalize: false })
    if (!buffer) return null
    const channels = [buffer.getChannelData(0), buffer.getChannelData(1)]
    const wav = encodeWav(channels, buffer.sampleRate)
    return { data: await toBase64(new Blob([wav as Uint8Array<ArrayBuffer>])), loudness: integratedLoudness(channels, buffer.sampleRate) }
  },

  /** Video assets this browser cannot decode (the CLI converts them first). */
  async undecodable(comp: Composition, base: string): Promise<string[]> {
    const { ALL_FORMATS, Input, UrlSource } = await import('mediabunny')
    const out: string[] = []
    for (const asset of Object.values(comp.assets ?? {})) {
      if (asset.type !== 'video') continue
      const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(new URL(asset.src, base).href) })
      try {
        const track = await input.getPrimaryVideoTrack()
        if (track && !(await track.canDecode())) out.push(asset.src)
      } catch {
        // Unreadable files are reported by load().
      } finally {
        input.dispose()
      }
    }
    return out
  },

  /** Every caption page in comp time, as SRT text (empty when the comp has no captions). */
  srt() {
    const s = session!
    const cues: { start: number; end: number; text: string }[] = []
    for (const { layer, start, duration } of placedLayers(s.comp)) {
      if (layer.type !== 'captions') continue
      const words = layer.words ?? (layer.asset ? s.res.captions(layer.asset) : null) ?? []
      for (const page of captionPages(words, layer.maxWords ?? 3, layer.maxChars ?? 22)) {
        if (page.start >= duration) continue
        cues.push({ start: start + page.start, end: start + Math.min(page.end, duration), text: pageText(layer, page) })
      }
    }
    cues.sort((a, b) => a.start - b.start)
    return cues.length ? toSrt(cues) : ''
  },

  /** Draws comp time `t` and returns the frame as base64 JPEG or PNG. */
  async frame(t: number, format: 'jpeg' | 'png' = 'jpeg', motionBlur = true) {
    const s = session!
    const times = s.renderer.sampleTimes(t, motionBlur)
    await s.res.prepare(times.flatMap((st) => videoRequests(s.comp, st)))
    s.renderer.draw(t, motionBlur)
    return toBase64(await canvasBlob(s.canvas, `image/${format}`, 0.95))
  },

  /** A grid of frames at `times`, each `cellWidth` px wide, as base64 PNG. */
  async contact(times: number[], columns: number, cellWidth: number) {
    const s = session!
    const cellHeight = Math.round((cellWidth * s.renderer.height) / s.renderer.width)
    const rows = Math.ceil(times.length / columns)
    const gap = 8
    const label = 22
    const sheet = document.createElement('canvas')
    sheet.width = columns * cellWidth + (columns + 1) * gap
    sheet.height = rows * (cellHeight + label) + (rows + 1) * gap
    const ctx = sheet.getContext('2d')!
    ctx.fillStyle = '#111'
    ctx.fillRect(0, 0, sheet.width, sheet.height)
    ctx.font = '600 15px system-ui, sans-serif'
    for (let i = 0; i < times.length; i++) {
      const t = times[i]
      await s.res.prepare(videoRequests(s.comp, t))
      s.renderer.draw(t)
      const x = gap + (i % columns) * (cellWidth + gap)
      const y = gap + Math.floor(i / columns) * (cellHeight + label + gap)
      ctx.drawImage(s.canvas, x, y + label, cellWidth, cellHeight)
      ctx.fillStyle = '#ddd'
      ctx.fillText(`${t.toFixed(2)}s`, x + 2, y + 16)
    }
    return toBase64(await canvasBlob(sheet, 'image/png'))
  },

  /**
   * Delivery checks on frames sampled every `step` seconds: safe zones of `platform` (or the one the
   * comp's shape suggests), text size, contrast and reading time, empty frames, the hook. Printable lines.
   */
  async check(platformId: string | null, step = 0.1) {
    const s = session!
    const platform = platformFor(s.comp, platformId)
    const keys = new WeakMap<object, string>()
    let nextKey = 0
    const keyOf = (o: object) => {
      let k = keys.get(o)
      if (!k) keys.set(o, (k = `t${nextKey++}`))
      return k
    }
    const ctx = s.canvas.getContext('2d')!
    const W = s.canvas.width
    const H = s.canvas.height
    const k = W / s.comp.width
    const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b
    let prev: Float32Array | null = null
    const samples: FrameSample[] = []
    for (let t = 0; t < s.renderer.duration - 1e-6; t += step) {
      await s.res.prepare(videoRequests(s.comp, t))
      s.renderer.probe = []
      s.renderer.draw(t)
      const drawn = s.renderer.probe
      s.renderer.probe = null
      const px = ctx.getImageData(0, 0, W, H).data
      // A coarse luminance grid: spread (empty frames) and change from the previous sample (motion).
      const grid = new Float32Array(64 * 64)
      let sum = 0
      for (let gy = 0; gy < 64; gy++)
        for (let gx = 0; gx < 64; gx++) {
          const i = (Math.floor(((gy + 0.5) * H) / 64) * W + Math.floor(((gx + 0.5) * W) / 64)) * 4
          const v = lum(px[i], px[i + 1], px[i + 2])
          grid[gy * 64 + gx] = v
          sum += v
        }
      const mean = sum / grid.length
      const spread = Math.sqrt(grid.reduce((a, v) => a + (v - mean) ** 2, 0) / grid.length)
      const change = prev ? grid.reduce((a, v, i) => a + Math.abs(v - prev![i]), 0) / grid.length : 0
      prev = grid

      const texts: TextProbe[] = drawn.map((d) => {
        const xs = d.corners.map((c) => c[0])
        const ys = d.corners.map((c) => c[1])
        const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
        let contrast: number | null = null
        const rgba = d.color ? parseColor(d.color) : null
        if (!d.backed && rgba) {
          // What surrounds the text: a ring around its box, its median luminance.
          const pad = Math.max(4, d.size * 0.35) * k
          const x0 = Math.max(0, Math.floor(box.x0 * k - pad))
          const y0 = Math.max(0, Math.floor(box.y0 * k - pad))
          const x1 = Math.min(W - 1, Math.ceil(box.x1 * k + pad))
          const y1 = Math.min(H - 1, Math.ceil(box.y1 * k + pad))
          const values: number[] = []
          const stride = Math.max(1, Math.round(pad / 6))
          for (let y = y0; y <= y1; y += stride)
            for (let x = x0; x <= x1; x += stride) {
              const inside = x > box.x0 * k && x < box.x1 * k && y > box.y0 * k && y < box.y1 * k
              if (inside) continue
              const i = (y * W + x) * 4
              values.push(relativeLuminance(px[i], px[i + 1], px[i + 2]))
            }
          if (values.length) {
            values.sort((a, b) => a - b)
            contrast = contrastRatio(relativeLuminance(rgba[0], rgba[1], rgba[2]), values[values.length >> 1])
          }
        }
        const words = d.text.split(/\s+/).filter(Boolean).length
        const label = d.layer.id ?? d.text.replace(/\s+/g, ' ').slice(0, 32)
        return { key: keyOf(d.layer), label, kind: d.layer.type, ...box, size: d.size, alpha: d.alpha, words, contrast }
      })
      const scenes = activeScenes(s.comp.scenes ?? [], t)
      samples.push({ t, transition: scenes.length > 1 || scenes.some((a) => a.enter !== null && a.enter < 1), texts, spread, change })
    }
    const findings = checkFrames({ width: s.comp.width, height: s.comp.height, duration: s.renderer.duration }, samples, platform)
    if (s.comp.beats) {
      const beats = (s.res.beats(s.comp.beats.asset) ?? []).map((b) => b + (s.comp.beats!.offset ?? 0))
      findings.push(...checkCuts(sceneCuts(s.comp), beats, s.renderer.fps))
    }
    return { platform: platform.name, source: platform.source, lines: formatFindings(findings), errors: findings.filter((f) => f.level === 'error').length }
  },

  /** Checks a rendered file's specs (gathered by the CLI with ffprobe) against the comp. */
  checkFile(facts: FileFacts, platformId: string | null) {
    const s = session!
    const platform = platformFor(s.comp, platformId)
    const findings = checkFile(facts, { width: s.comp.width, height: s.comp.height, fps: s.renderer.fps, duration: s.renderer.duration, loudness: s.comp.mix?.loudness ?? -14 }, platform)
    return { lines: formatFindings(findings), errors: findings.filter((f) => f.level === 'error').length }
  },

  /** In-browser MP4 export, used when ffmpeg is not installed. */
  async exportInPage(scale: number) {
    const s = session!
    const { blob, extension } = await exportVideo(s.comp, s.res, {
      scale,
      onProgress: (f) => console.log(`progress ${Math.round(f * 100)}`),
    })
    return { data: await toBase64(blob), extension }
  },
}

declare global {
  interface Window {
    motion: typeof api
  }
}
window.motion = api
document.title = 'ready'
