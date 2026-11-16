// Video during playback in the studio. Frame-accurate decoding (mediabunny, used for export and
// while paused) decodes every frame on the main thread and copies each full-size frame into a
// canvas: fine for exporting, too slow to keep up in real time with two 1080×1920 clips at once.
// While playing, the preview draws from plain <video> elements instead: the browser decodes them on
// the GPU, in the background, and they keep running by themselves; we only keep them in sync with
// the playhead. The MP4 export and the paused frame are untouched.

import type { Composition } from '../engine/types'
import type { Drawable, Resources, VideoRequest } from '../engine/render'
import type { Resolver } from '../engine/resources'

interface Player {
  el: HTMLVideoElement
  /** Source time asked for at the last draw, and when (performance.now). */
  last: { time: number; at: number } | null
  used: boolean
}

/** How far a <video> may drift from the playhead before it is moved back. */
const MAX_DRIFT = 0.12

export class PlaybackVideo {
  private players = new Map<string, Player[]>()
  private frames = new Map<string, Drawable>()
  private urls: string[] = []
  private sources = new Map<string, string>()

  constructor(comp: Composition, resolve: Resolver) {
    for (const [id, asset] of Object.entries(comp.assets ?? {})) {
      if (asset.type !== 'video') continue
      const src = resolve(asset.src)
      const url = typeof src === 'string' ? src : URL.createObjectURL(src)
      if (typeof src !== 'string') this.urls.push(url)
      this.sources.set(id, url)
    }
  }

  private player(asset: string, slot: number): Player | null {
    const url = this.sources.get(asset)
    if (!url) return null
    const list = this.players.get(asset) ?? []
    this.players.set(asset, list)
    if (!list[slot]) {
      const el = document.createElement('video')
      el.muted = true // the sound plays through the audio console's mix
      el.playsInline = true
      el.preload = 'auto'
      el.crossOrigin = 'anonymous'
      el.src = url
      list[slot] = { el, last: null, used: false }
    }
    return list[slot]
  }

  /** Opens every video ahead of time, so the first scene with one does not wait for it. */
  warm() {
    for (const id of this.sources.keys()) this.player(id, 0)
  }

  /**
   * Brings the <video> elements to the frames a draw needs: running at the speed the playhead moves
   * them, moved back when they drift, paused when their layer is not on screen.
   */
  async prepare(requests: VideoRequest[]) {
    this.frames.clear()
    for (const list of this.players.values()) for (const p of list) p.used = false
    const now = performance.now()
    const perAsset = new Map<string, number>()
    const waits: Promise<void>[] = []
    for (const r of requests) {
      const slot = perAsset.get(r.asset) ?? 0
      perAsset.set(r.asset, slot + 1)
      const p = this.player(r.asset, slot)
      if (!p) continue
      p.used = true
      const { el } = p
      // Source seconds per real second (a layer's playbackRate), from the last two draws.
      let rate = 1
      if (p.last && now > p.last.at) {
        const r2 = (r.time - p.last.time) / ((now - p.last.at) / 1000)
        if (r2 > 0.1 && r2 < 8) rate = Math.round(r2 * 4) / 4 || 1
      }
      const resumed = !p.last || now - p.last.at > 250
      p.last = { time: r.time, at: now }
      if (Math.abs(el.playbackRate - rate) > 0.01) el.playbackRate = rate
      const drift = el.currentTime - r.time
      if (resumed || el.readyState < 2 || Math.abs(drift) > MAX_DRIFT) {
        if (Math.abs(drift) > 1 / 60 || el.readyState < 2) {
          el.currentTime = r.time
          // Wait briefly for the frame, so a scene does not start on an empty or stale picture.
          waits.push(waitFor(el, 'seeked', 250))
        }
      }
      if (el.paused) void el.play().catch(() => {})
    }
    for (const list of this.players.values()) for (const p of list) if (!p.used && !p.el.paused) p.el.pause()
    if (waits.length) await Promise.all(waits)
    perAsset.clear()
    for (const r of requests) {
      const slot = perAsset.get(r.asset) ?? 0
      perAsset.set(r.asset, slot + 1)
      const el = this.players.get(r.asset)?.[slot]?.el
      if (el && el.readyState >= 2 && el.videoWidth) this.frames.set(`${r.asset}|${r.time}`, { source: el, width: el.videoWidth, height: el.videoHeight })
    }
  }

  /** Cues the videos that a draw a moment from now will need, while they are still off screen. */
  cue(upcoming: VideoRequest[]) {
    const perAsset = new Map<string, number>()
    for (const r of upcoming) {
      const slot = perAsset.get(r.asset) ?? 0
      perAsset.set(r.asset, slot + 1)
      const p = this.player(r.asset, slot)
      if (!p || p.used || !p.el.paused) continue
      if (Math.abs(p.el.currentTime - r.time) > 0.1) p.el.currentTime = r.time
    }
  }

  frame(asset: string, time: number): Drawable | null {
    return this.frames.get(`${asset}|${time}`) ?? null
  }

  /** Stops every video (playback paused): the paused frame is drawn frame-accurately again. */
  pause() {
    this.frames.clear()
    for (const list of this.players.values())
      for (const p of list) {
        p.last = null
        if (!p.el.paused) p.el.pause()
      }
  }

  dispose() {
    for (const list of this.players.values())
      for (const p of list) {
        p.el.pause()
        p.el.removeAttribute('src')
        p.el.load()
      }
    this.players.clear()
    for (const u of this.urls) URL.revokeObjectURL(u)
  }
}

function waitFor(el: HTMLVideoElement, event: string, ms: number): Promise<void> {
  return new Promise((done) => {
    const finish = () => {
      clearTimeout(timer)
      el.removeEventListener(event, finish)
      done()
    }
    const timer = setTimeout(finish, ms)
    el.addEventListener(event, finish)
  })
}

/** Whether the studio is playing (read by the preview's resources at every draw). */
export class PlayState {
  playing = false
  set(playing: boolean) {
    this.playing = playing
  }
}

/**
 * The resources the preview renderer draws with: everything comes from `base`, except video frames
 * while `video.active` is set (playing), which come from the <video> elements.
 */
export function previewResources<R extends Resources>(base: R, video: PlaybackVideo, state: PlayState): R {
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === 'videoFrame') return (asset: string, time: number) => (state.playing ? video.frame(asset, time) : target.videoFrame(asset, time))
      const v = Reflect.get(target, prop, receiver)
      return typeof v === 'function' ? v.bind(target) : v
    },
  })
}
