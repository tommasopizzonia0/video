// Playback and rendering engine: plays the timeline onto a <canvas> and records it for export.

import {
  FORMAT_SIZES,
  clipStarts,
  locate,
  textsAt,
  totalDuration,
  type MediaItem,
  type Project,
  type TextOverlay,
} from './timeline'

const END_EPSILON = 1 / 60
const TEXT_FADE = 0.3

export class Player {
  private ctx: CanvasRenderingContext2D
  private elements = new Map<string, HTMLMediaElement>()
  private media = new Map<string, MediaItem>()
  private project: Project
  private activeIndex = -1
  private raf = 0
  private seekToken = 0

  private audioCtx: AudioContext | null = null
  private clipGain: GainNode | null = null
  private musicGain: GainNode | null = null
  private recordDest: MediaStreamAudioDestinationNode | null = null
  private connected = new Set<HTMLMediaElement>()

  time = 0
  playing = false
  onTime: (t: number) => void = () => {}
  onPlayingChange: (playing: boolean) => void = () => {}
  private onEndedOnce: (() => void) | null = null

  private canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement, project: Project) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.project = project
    this.applyFormat()
  }

  addMedia(item: MediaItem) {
    if (this.elements.has(item.id)) return
    const el = item.kind === 'audio' ? document.createElement('audio') : document.createElement('video')
    el.preload = 'auto'
    el.src = item.url
    if (el instanceof HTMLVideoElement) {
      el.playsInline = true
      el.addEventListener('seeked', () => {
        if (!this.playing) this.draw()
      })
    }
    this.elements.set(item.id, el)
    this.media.set(item.id, item)
    this.connectAudio(el, item.kind)
  }

  setProject(project: Project) {
    const formatChanged = project.format !== this.project.format
    // Editing the clips mid-playback would leave the engine pointing at the wrong clip.
    if (this.playing && project.clips !== this.project.clips) this.pause()
    this.project = project
    if (formatChanged) this.applyFormat()
    if (this.clipGain) this.clipGain.gain.value = project.clipVolume
    if (this.musicGain) this.musicGain.gain.value = project.music?.volume ?? 0
    if (!this.playing) void this.seek(this.time)
  }

  get duration() {
    return totalDuration(this.project.clips)
  }

  /** Move the playhead; keeps playing if it was playing. */
  async jump(t: number) {
    const wasPlaying = this.playing
    this.pause()
    await this.seek(t)
    if (wasPlaying) await this.play()
  }

  private async seek(t: number) {
    const token = ++this.seekToken
    const clips = this.project.clips
    this.time = Math.max(0, Math.min(t, this.duration))
    this.onTime(this.time)
    const loc = locate(clips, this.time) ?? (clips.length ? { index: clips.length - 1, offset: clips.at(-1)!.out - clips.at(-1)!.in } : null)
    this.pauseAllExcept(null)
    this.activeIndex = loc ? loc.index : -1
    if (loc) {
      const clip = clips[loc.index]
      const el = this.videoFor(loc.index)
      if (el) await seekElement(el, Math.min(clip.in + loc.offset, clip.out - END_EPSILON))
    }
    if (token === this.seekToken) this.draw()
  }

  async play() {
    if (this.playing || this.project.clips.length === 0) return
    this.ensureAudio()
    if (this.time >= this.duration - 0.05) await this.seek(0)
    else await this.seek(this.time)
    const el = this.videoFor(this.activeIndex)
    if (!el) return
    this.playing = true
    this.onPlayingChange(true)
    await el.play().catch(() => {})
    this.syncMusic()
    this.raf = requestAnimationFrame(this.tick)
  }

  pause() {
    if (!this.playing) return
    this.playing = false
    cancelAnimationFrame(this.raf)
    this.pauseAllExcept(null)
    this.onPlayingChange(false)
  }

  toggle() {
    if (this.playing) this.pause()
    else void this.play()
  }

  /** Plays the whole timeline from the start and records the canvas plus the audio mix. */
  async export(onProgress: (fraction: number) => void): Promise<{ blob: Blob; extension: string }> {
    this.pause()
    this.ensureAudio()
    const stream = this.canvas.captureStream(30)
    for (const track of this.recordDest!.stream.getAudioTracks()) stream.addTrack(track)
    const mimeType = pickMimeType()
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 })
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()))

    await this.seek(0)
    const previousOnTime = this.onTime
    this.onTime = (t) => {
      previousOnTime(t)
      onProgress(this.duration ? t / this.duration : 1)
    }
    const ended = new Promise<void>((resolve) => (this.onEndedOnce = resolve))
    recorder.start(250)
    await this.play()
    await ended
    await new Promise((r) => setTimeout(r, 150))
    recorder.stop()
    await stopped
    this.onTime = previousOnTime
    stream.getVideoTracks().forEach((t) => t.stop())
    const type = mimeType.split(';')[0]
    return { blob: new Blob(chunks, { type }), extension: type === 'video/mp4' ? 'mp4' : 'webm' }
  }

  destroy() {
    this.pause()
    for (const el of this.elements.values()) el.removeAttribute('src')
    void this.audioCtx?.close()
  }

  private tick = () => {
    if (!this.playing) return
    const clips = this.project.clips
    const clip = clips[this.activeIndex]
    const el = this.videoFor(this.activeIndex)
    if (!clip || !el) {
      this.finish()
      return
    }
    const starts = clipStarts(clips)
    if (el.currentTime >= clip.out - END_EPSILON || el.ended) {
      const next = this.activeIndex + 1
      if (next >= clips.length) {
        this.time = this.duration
        this.onTime(this.time)
        this.draw()
        this.finish()
        return
      }
      const nextClip = clips[next]
      const nextEl = this.videoFor(next)!
      this.activeIndex = next
      // A split clip continues seamlessly on the same element; anything else needs a seek.
      const continuous = nextEl === el && Math.abs(el.currentTime - nextClip.in) < 0.1
      if (!continuous) {
        el.pause()
        nextEl.currentTime = nextClip.in
        void nextEl.play().catch(() => {})
      }
      this.time = starts[next]
    } else {
      this.time = starts[this.activeIndex] + (el.currentTime - clip.in)
    }
    this.draw()
    this.onTime(this.time)
    this.raf = requestAnimationFrame(this.tick)
  }

  private finish() {
    this.pause()
    this.music()?.pause()
    const cb = this.onEndedOnce
    this.onEndedOnce = null
    cb?.()
  }

  private draw() {
    const { width, height } = this.canvas
    const ctx = this.ctx
    const el = this.videoFor(this.activeIndex)
    if (el && (el.readyState < 2 || el.seeking)) return // keep the previous frame instead of flashing black
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, width, height)
    if (el && el.videoWidth) {
      const scale = Math.min(width / el.videoWidth, height / el.videoHeight)
      const w = el.videoWidth * scale
      const h = el.videoHeight * scale
      ctx.drawImage(el, (width - w) / 2, (height - h) / 2, w, h)
    }
    for (const text of textsAt(this.project.texts, this.time)) this.drawText(text)
  }

  private drawText(text: TextOverlay) {
    const ctx = this.ctx
    const { width, height } = this.canvas
    const fontSize = (text.size * Math.min(width, height)) / 720
    const into = this.time - text.start
    const left = text.start + text.duration - this.time
    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, into / TEXT_FADE, left / TEXT_FADE))
    ctx.font = `700 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.lineWidth = fontSize / 8
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'
    ctx.fillStyle = text.color
    const lines = text.text.split('\n')
    const lineHeight = fontSize * 1.2
    const top = text.y * height - ((lines.length - 1) * lineHeight) / 2
    lines.forEach((line, i) => {
      ctx.strokeText(line, text.x * width, top + i * lineHeight)
      ctx.fillText(line, text.x * width, top + i * lineHeight)
    })
    ctx.restore()
  }

  private applyFormat() {
    const { width, height } = FORMAT_SIZES[this.project.format]
    this.canvas.width = width
    this.canvas.height = height
  }

  private videoFor(index: number): HTMLVideoElement | null {
    const clip = this.project.clips[index]
    if (!clip) return null
    const el = this.elements.get(clip.mediaId)
    return el instanceof HTMLVideoElement ? el : null
  }

  private music(): HTMLMediaElement | null {
    const music = this.project.music
    return music ? (this.elements.get(music.mediaId) ?? null) : null
  }

  private syncMusic() {
    const el = this.music()
    if (!el) return
    if (this.time < el.duration) {
      el.currentTime = this.time
      void el.play().catch(() => {})
    }
  }

  private pauseAllExcept(keep: HTMLMediaElement | null) {
    for (const el of this.elements.values()) if (el !== keep) el.pause()
  }

  /** Audio has to go through Web Audio so the export can record it. Created on first play (needs a user gesture). */
  private ensureAudio() {
    if (this.audioCtx) {
      void this.audioCtx.resume()
      return
    }
    const ctx = new AudioContext()
    this.audioCtx = ctx
    this.recordDest = ctx.createMediaStreamDestination()
    this.clipGain = ctx.createGain()
    this.musicGain = ctx.createGain()
    this.clipGain.gain.value = this.project.clipVolume
    this.musicGain.gain.value = this.project.music?.volume ?? 0
    for (const gain of [this.clipGain, this.musicGain]) {
      gain.connect(ctx.destination)
      gain.connect(this.recordDest)
    }
    for (const [id, el] of this.elements) this.connectAudio(el, this.media.get(id)!.kind)
  }

  private connectAudio(el: HTMLMediaElement, kind: MediaItem['kind']) {
    if (!this.audioCtx || this.connected.has(el)) return
    const source = this.audioCtx.createMediaElementSource(el)
    source.connect(kind === 'audio' ? this.musicGain! : this.clipGain!)
    this.connected.add(el)
  }
}

function seekElement(el: HTMLMediaElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(el.currentTime - t) < 0.01 && el.readyState >= 2 && !el.seeking) {
      resolve()
      return
    }
    const done = () => {
      el.removeEventListener('seeked', done)
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(done, 1500)
    el.addEventListener('seeked', done)
    el.currentTime = t
  })
}

function pickMimeType(): string {
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? 'video/webm'
}
