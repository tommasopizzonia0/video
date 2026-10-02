// Pure data model and timeline math. No DOM access here, so it is easy to test.

export type MediaKind = 'video' | 'audio'

export interface MediaItem {
  id: string
  name: string
  kind: MediaKind
  url: string
  duration: number
  width: number
  height: number
  thumbnail?: string
}

/** A piece of a source video placed on the timeline, from `in` to `out` (seconds in the source). */
export interface Clip {
  id: string
  mediaId: string
  in: number
  out: number
}

export interface TextOverlay {
  id: string
  text: string
  start: number
  duration: number
  /** Center position, 0..1 relative to the frame. */
  x: number
  y: number
  /** Font size in px at 720p height. */
  size: number
  color: string
}

export interface MusicTrack {
  mediaId: string
  volume: number
}

export type Format = '16:9' | '9:16' | '1:1'

export interface Project {
  clips: Clip[]
  texts: TextOverlay[]
  music: MusicTrack | null
  clipVolume: number
  format: Format
}

export const MIN_CLIP_LENGTH = 0.1

export const FORMAT_SIZES: Record<Format, { width: number; height: number }> = {
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '1:1': { width: 1080, height: 1080 },
}

export function emptyProject(): Project {
  return { clips: [], texts: [], music: null, clipVolume: 1, format: '16:9' }
}

let counter = 0
export function newId(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now().toString(36)}-${counter}`
}

export function clipLength(clip: Clip): number {
  return clip.out - clip.in
}

export function totalDuration(clips: Clip[]): number {
  return clips.reduce((sum, c) => sum + clipLength(c), 0)
}

/** Timeline start time of every clip. */
export function clipStarts(clips: Clip[]): number[] {
  const starts: number[] = []
  let t = 0
  for (const c of clips) {
    starts.push(t)
    t += clipLength(c)
  }
  return starts
}

/** Which clip is under timeline time `t`, and how far into it. Null past the end. */
export function locate(clips: Clip[], t: number): { index: number; offset: number } | null {
  let start = 0
  for (let i = 0; i < clips.length; i++) {
    const len = clipLength(clips[i])
    if (t >= start && t < start + len) return { index: i, offset: t - start }
    start += len
  }
  return null
}

/** Split the clip under timeline time `t` into two clips. Returns the input unchanged if `t` is too close to an edge. */
export function splitAt(clips: Clip[], t: number): Clip[] {
  const loc = locate(clips, t)
  if (!loc) return clips
  const clip = clips[loc.index]
  if (loc.offset < MIN_CLIP_LENGTH || clipLength(clip) - loc.offset < MIN_CLIP_LENGTH) return clips
  const cut = clip.in + loc.offset
  const left: Clip = { ...clip, out: cut }
  const right: Clip = { ...clip, id: newId('clip'), in: cut }
  return [...clips.slice(0, loc.index), left, right, ...clips.slice(loc.index + 1)]
}

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= items.length) return items
  const next = items.slice()
  const [item] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item)
  return next
}

/** Clamp trim points so that 0 <= in < out <= duration and the clip keeps a minimum length. */
export function trimClip(clip: Clip, sourceDuration: number, patch: { in?: number; out?: number }): Clip {
  let inPoint = patch.in ?? clip.in
  let outPoint = patch.out ?? clip.out
  inPoint = Math.max(0, Math.min(inPoint, sourceDuration - MIN_CLIP_LENGTH))
  outPoint = Math.max(MIN_CLIP_LENGTH, Math.min(outPoint, sourceDuration))
  if (outPoint - inPoint < MIN_CLIP_LENGTH) {
    if (patch.in !== undefined) inPoint = outPoint - MIN_CLIP_LENGTH
    else outPoint = inPoint + MIN_CLIP_LENGTH
  }
  return { ...clip, in: inPoint, out: outPoint }
}

export function textsAt(texts: TextOverlay[], t: number): TextOverlay[] {
  return texts.filter((x) => t >= x.start && t < x.start + x.duration)
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds)
  const m = Math.floor(s / 60)
  const rest = s - m * 60
  return `${m}:${rest.toFixed(1).padStart(4, '0')}`
}
