// Loads everything a composition needs in the browser: fonts, images, decoded video frames and audio.

import { ALL_FORMATS, BlobSource, CanvasSink, Input, UrlSource, type WrappedCanvas } from 'mediabunny'
import { audioMix } from './audio'
import { BUILTIN_FONT_FILES } from './fonts'
import type { Drawable, Resources, VideoRequest } from './render'
import { DEFAULT_FONT } from './text'
import type { Composition, FontSource, Layer } from './types'

/** Turns an asset `src` into something loadable: a URL or a File the user dropped. */
export type Resolver = (src: string) => string | Blob

/** Sequential frame access with cheap forward steps; jumps backwards or far ahead restart decoding. */
class VideoReader {
  private sink: CanvasSink
  private iterator: AsyncGenerator<WrappedCanvas, void, unknown> | null = null
  private current: WrappedCanvas | null = null
  private next: WrappedCanvas | null = null
  private ended = false

  constructor(sink: CanvasSink) {
    this.sink = sink
  }

  async frameAt(t: number): Promise<WrappedCanvas | null> {
    const cur = this.current
    if (cur && t >= cur.timestamp && (t < cur.timestamp + cur.duration || (this.ended && !this.next))) return cur
    if (!this.iterator || !cur || t < cur.timestamp || t > cur.timestamp + 1.5) {
      await this.iterator?.return()
      this.iterator = this.sink.canvases(Math.max(0, t))
      this.next = null
      this.ended = false
      const first = await this.iterator.next()
      this.current = first.done ? null : first.value
      if (!this.current) {
        this.ended = true
        return cur
      }
    }
    for (;;) {
      if (!this.next) {
        const r = await this.iterator.next()
        if (r.done) {
          this.ended = true
          break
        }
        this.next = r.value
      }
      if (this.next.timestamp <= t + 1e-4) {
        this.current = this.next
        this.next = null
      } else break
    }
    return this.current
  }

  async close() {
    await this.iterator?.return()
  }
}

interface VideoAsset {
  input: Input
  sink: CanvasSink
  width: number
  height: number
  readers: VideoReader[]
}

function usedFonts(comp: Composition): Set<string> {
  const used = new Set<string>()
  const visit = (layers: Layer[]) => {
    for (const l of layers) {
      if (l.type === 'text') {
        used.add(l.font ?? DEFAULT_FONT)
        if (l.accent?.font) used.add(l.accent.font)
      } else if (l.type === 'group') visit(l.layers)
    }
  }
  for (const s of comp.scenes ?? []) visit(s.layers)
  visit(comp.layers ?? [])
  return used
}

async function loadFont(f: FontSource, url: string) {
  const face = new FontFace(f.family, `url(${JSON.stringify(url)})`, { weight: f.weight ?? '100 900', style: f.style ?? 'normal' })
  await face.load()
  document.fonts.add(face)
}

async function loadImage(source: string | Blob): Promise<Drawable> {
  const blob = typeof source === 'string' ? await (await fetch(source)).blob() : source
  if (blob.type.includes('svg')) {
    // SVGs keep their vector sharpness when drawn through an <img>.
    const img = new Image()
    img.src = URL.createObjectURL(blob)
    await img.decode()
    return { source: img, width: img.naturalWidth || 512, height: img.naturalHeight || 512 }
  }
  const bitmap = await createImageBitmap(blob)
  return { source: bitmap, width: bitmap.width, height: bitmap.height }
}

export class BrowserResources implements Resources {
  private images = new Map<string, Drawable>()
  private videos = new Map<string, VideoAsset>()
  private frames = new Map<string, Drawable>()
  private lengths = new Map<string, number>()
  private comp: Composition
  private resolve: Resolver

  private constructor(comp: Composition, resolve: Resolver) {
    this.comp = comp
    this.resolve = resolve
  }

  /** Loads fonts, images and opens videos. Fails with a readable message naming the asset. */
  static async load(comp: Composition, resolve: Resolver, onStatus?: (msg: string) => void): Promise<BrowserResources> {
    const res = new BrowserResources(comp, resolve)
    const used = usedFonts(comp)
    const fontJobs = [
      ...BUILTIN_FONT_FILES.filter((f) => used.has(f.family)).map((f) => loadFont(f, f.src)),
      ...(comp.fonts ?? []).map(async (f) => {
        const src = resolve(f.src)
        await loadFont(f, typeof src === 'string' ? src : URL.createObjectURL(src))
      }),
    ]
    await Promise.all(fontJobs)
    for (const [id, asset] of Object.entries(comp.assets ?? {})) {
      onStatus?.(`Carico ${asset.src}`)
      try {
        if (asset.type === 'image') res.images.set(id, await loadImage(resolve(asset.src)))
        if (asset.type === 'video') res.videos.set(id, await res.openVideo(resolve(asset.src)))
      } catch (e) {
        throw new Error(`Asset "${id}" (${asset.src}): ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    return res
  }

  private async openVideo(source: string | Blob): Promise<VideoAsset> {
    const input = new Input({
      formats: ALL_FORMATS,
      source: typeof source === 'string' ? new UrlSource(source) : new BlobSource(source),
    })
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('no video track')
    if (!(await track.canDecode())) throw new Error(`this browser cannot decode ${track.codec ?? 'this codec'}`)
    const sink = new CanvasSink(track, { poolSize: 6, fit: 'fill' })
    return { input, sink, width: track.displayWidth, height: track.displayHeight, readers: [] }
  }

  /** Decodes the video frames a draw needs. Several requests for one asset get separate decoders. */
  async prepare(requests: VideoRequest[]) {
    this.frames.clear()
    const perAsset = new Map<string, number>()
    await Promise.all(
      requests.map(async (r) => {
        const v = this.videos.get(r.asset)
        if (!v) return
        const slot = perAsset.get(r.asset) ?? 0
        perAsset.set(r.asset, slot + 1)
        v.readers[slot] ??= new VideoReader(v.sink)
        const frame = await v.readers[slot].frameAt(r.time)
        if (frame) this.frames.set(`${r.asset}|${r.time}`, { source: frame.canvas, width: v.width, height: v.height })
      }),
    )
  }

  image(asset: string): Drawable | null {
    return this.images.get(asset) ?? null
  }

  videoFrame(asset: string, time: number): Drawable | null {
    return this.frames.get(`${asset}|${time}`) ?? null
  }

  videoSize(asset: string) {
    const v = this.videos.get(asset)
    return v ? { width: v.width, height: v.height } : null
  }

  pathLength(d: string): number {
    let len = this.lengths.get(d)
    if (len === undefined) {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      el.setAttribute('d', d)
      len = el.getTotalLength()
      this.lengths.set(d, len)
    }
    return len
  }

  /** Decoded audio for every asset the mix uses. Sources without sound are skipped. */
  async audioBuffers(ctx: BaseAudioContext): Promise<Map<string, AudioBuffer>> {
    const out = new Map<string, AudioBuffer>()
    const ids = new Set(audioMix(this.comp).map((c) => c.asset))
    for (const id of ids) {
      const asset = this.comp.assets?.[id]
      if (!asset) continue
      const src = this.resolve(asset.src)
      try {
        const data = typeof src === 'string' ? await (await fetch(src)).arrayBuffer() : await src.arrayBuffer()
        out.set(id, await ctx.decodeAudioData(data))
      } catch {
        // A video without an audio track, or a codec this browser cannot decode: silent.
      }
    }
    return out
  }

  async dispose() {
    for (const v of this.videos.values()) {
      for (const r of v.readers) await r.close()
      v.input.dispose()
    }
  }
}
