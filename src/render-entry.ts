// Page used by the headless renderer (scripts/render.mjs). It exposes a small API on `window`
// that the CLI drives through Playwright: load a composition, draw frames, export.

import { audioMix } from './engine/audio'
import { exportVideo } from './engine/export'
import { Renderer, videoRequests } from './engine/render'
import { BrowserResources } from './engine/resources'
import type { Composition } from './engine/types'
import { validate } from './engine/validate'

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
  async load(comp: Composition, base: string, scale: number, overrides: Record<string, string> = {}) {
    const issues = validate(comp)
    if (issues.some((i) => i.level === 'error')) return { issues }
    await session?.res.dispose()
    const resolve = (src: string) => overrides[src] ?? new URL(src, base).href
    const res = await BrowserResources.load(comp, resolve)
    const canvas = document.getElementById('stage') as HTMLCanvasElement
    const renderer = new Renderer(canvas, comp, res, { scale })
    session = { comp, res, renderer, canvas }
    return {
      issues,
      width: renderer.width,
      height: renderer.height,
      fps: renderer.fps,
      duration: renderer.duration,
      mix: audioMix(comp),
    }
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
