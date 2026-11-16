// The media library of the local live studio (`npm run dev`, `#live`): files the dev server finds in
// the Higgsfield downloads folder, the pictures fetched with `npm run photos`, and the files dropped
// on the Caricamenti panel. See `localLive` in vite.config.ts.

export interface MediaItem {
  /** `<source>/<path>`, stable across reloads. */
  id: string
  name: string
  /** MIME type: image/…, video/… or audio/…. */
  type: string
  /** Same-origin URL the file is served at. */
  url: string
  source: 'higgsfield' | 'foto' | 'caricati' | string
  size: number
  /** Last modified, ms. */
  time: number
}

export const SOURCE_LABEL: Record<string, string> = { higgsfield: 'Higgsfield', foto: 'Foto', caricati: 'Caricati', suoni: 'Suoni' }

/** Whether this page runs on the dev server that has the library. */
export const hasLibrary = Boolean(import.meta.hot)

export async function fetchLibrary(): Promise<MediaItem[]> {
  if (!hasLibrary) return []
  const r = await fetch('/__media/')
  if (!r.ok) return []
  return ((await r.json()) as { items: MediaItem[] }).items
}

/** Calls `onChange` with the new list whenever a file appears, changes or goes away. */
export function watchLibrary(onChange: (items: MediaItem[]) => void): () => void {
  const hot = import.meta.hot
  if (!hot) return () => {}
  const listener = (items: MediaItem[]) => onChange(items)
  hot.on('media:update', listener)
  return () => hot.off('media:update', listener)
}

/** Copies files into the library (`live/uploads`). */
export async function uploadToLibrary(files: File[]): Promise<void> {
  for (const f of files) {
    const r = await fetch(`/__upload?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f })
    if (!r.ok) throw new Error(`Non riesco a caricare ${f.name}: formato non supportato.`)
  }
}

/**
 * Hands Claude what the arrows see (local live page): `live/team/context.json` and the sampled
 * frames as `live/team/frames/<name>.png`. The old frames are replaced.
 */
export async function saveTeamContext(context: unknown, frames: { name: string; blob: Blob }[]): Promise<boolean> {
  if (!hasLibrary) return false
  const r = await fetch('/__team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context, frames: frames.map((f) => f.name) }) })
  if (!r.ok) return false
  for (const f of frames) await fetch(`/__team/frame?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f.blob })
  return true
}

/** Saves the composition the viewer changed back to live/current.json, so Claude works on the same one. */
export async function saveLive(data: { json: unknown; note?: string; time?: number; cursor?: unknown }): Promise<void> {
  if (!hasLibrary) return
  await fetch('/__live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
}

/** Length of a video or audio file in seconds (0 when it can't be read). */
export function mediaDuration(url: string, type: string): Promise<number> {
  return new Promise((ok) => {
    const el = document.createElement(type.startsWith('audio/') ? 'audio' : 'video')
    el.preload = 'metadata'
    el.onloadedmetadata = () => ok(Number.isFinite(el.duration) ? el.duration : 0)
    el.onerror = () => ok(0)
    el.src = url
  })
}

/** The drag payload used between the panel and the timeline. */
export const MEDIA_DRAG = 'application/x-motion-media'
