// Frame-accurate export in the browser: every frame is drawn, encoded with WebCodecs and muxed
// into MP4 (H.264 + AAC) by Mediabunny. Much faster than recording in real time, and identical every run.

import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_VERY_HIGH,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
} from 'mediabunny'
import { audioMix, scheduleMix } from './audio'
import { DEFAULT_LOUDNESS, normalizationGain } from './loudness'
import { Renderer, videoRequests } from './render'
import type { BrowserResources } from './resources'
import type { Composition } from './types'

export interface ExportOptions {
  scale?: number
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

let aacRegistered = false

export interface RenderAudioOptions {
  /** Comp time to start from (default 0). */
  from?: number
  /** Overrides the asset file used for sound (see BrowserResources.audioBuffers). */
  audioSrc?: (src: string) => string | undefined
  /** Normalize to the composition's loudness target (default true). */
  normalize?: boolean
}

/** Renders the comp's sound to a sample-accurate buffer, normalized to `mix.loudness` (default -14 LUFS). */
export async function renderAudio(comp: Composition, res: BrowserResources, duration: number, options: RenderAudioOptions = {}): Promise<AudioBuffer | null> {
  const mix = audioMix(comp)
  if (!mix.length) return null
  const rate = 48000
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * rate)), rate)
  const buffers = await res.audioBuffers(ctx, options.audioSrc)
  if (!buffers.size && !mix.some((c) => c.sfx)) return null
  scheduleMix(ctx, mix, buffers, options.from ?? 0)
  const out = await ctx.startRendering()
  const target = comp.mix?.loudness ?? DEFAULT_LOUDNESS
  if (options.normalize !== false && target !== false) {
    const channels = [out.getChannelData(0), out.getChannelData(1)]
    const gain = normalizationGain(channels, rate, target)
    for (const c of channels) for (let i = 0; i < c.length; i++) c[i] *= gain
  }
  return out
}

export async function exportVideo(comp: Composition, res: BrowserResources, options: ExportOptions = {}): Promise<{ blob: Blob; extension: string }> {
  const canvas = new OffscreenCanvas(2, 2)
  const renderer = new Renderer(canvas, comp, res, { scale: options.scale })
  const { width, height, fps, duration } = renderer
  const frames = Math.max(1, Math.round(duration * fps))

  const mp4 = await canEncodeVideo('avc', { width, height })
  const output = new Output({
    format: mp4 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  })
  const video = new CanvasSource(canvas, { codec: mp4 ? 'avc' : 'vp9', quality: QUALITY_VERY_HIGH, keyFrameInterval: 2 })
  output.addVideoTrack(video, { frameRate: fps })

  const audio = await renderAudio(comp, res, frames / fps)
  let audioSource: AudioBufferSource | null = null
  if (audio) {
    const codec = mp4 ? 'aac' : 'opus'
    if (codec === 'aac' && !aacRegistered && !(await canEncodeAudio('aac'))) {
      // Loaded on demand: a WASM AAC encoder for browsers without a native one.
      const { registerAacEncoder } = await import('@mediabunny/aac-encoder')
      registerAacEncoder()
      aacRegistered = true
    }
    audioSource = new AudioBufferSource({ codec, quality: QUALITY_HIGH })
    output.addAudioTrack(audioSource)
  }

  await output.start()
  for (let i = 0; i < frames; i++) {
    if (options.signal?.aborted) {
      await output.cancel()
      throw new DOMException('Export annullato', 'AbortError')
    }
    const t = i / fps
    const times = renderer.sampleTimes(t, true)
    await res.prepare(times.flatMap((st) => videoRequests(comp, st)))
    renderer.draw(t, true)
    await video.add(t, 1 / fps)
    options.onProgress?.((i + 1) / frames)
  }
  video.close()
  if (audioSource && audio) {
    await audioSource.add(audio)
    audioSource.close()
  }
  await output.finalize()
  const buffer = (output.target as BufferTarget).buffer!
  return { blob: new Blob([buffer], { type: mp4 ? 'video/mp4' : 'video/webm' }), extension: mp4 ? 'mp4' : 'webm' }
}
