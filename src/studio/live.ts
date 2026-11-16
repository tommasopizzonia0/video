// Live mode: when the Motion studio runs as a claude.ai Artifact, Claude writes the composition
// it is working on to a shared document, and every open studio follows along in real time.

export interface LiveUpdate {
  /** The composition JSON text. */
  json: string
  /** What Claude is doing, shown in the studio. */
  note?: string
  /** Comp time to show, so the viewer sees the part being changed. */
  time?: number
  /** Where Claude's arrow points (routed to the arrow of that area, see `arrowFor`). */
  cursor?: ClaudeTarget
  /** Several arrows at once, each with its own note: `{ video, timeline, media, audio }`. */
  arrows?: Partial<Record<ArrowRole, { target: ClaudeTarget; note?: string }>>
}

/**
 * `{ x, y }`: a spot on the frame, in composition pixels.
 * `{ clip, edge? }`: a timeline clip, by scene id ("foto") or layer id/label ("POLLO"), optionally its
 * "start" or "end" edge (where a trim happens).
 * `{ media }`: a file in the Caricamenti panel, by name ("ulivi-vaso-5s-720p.mp4").
 * `{ channel }`: a strip of the audio console: "a0" (audio entry 0), "v0" (video sound 0),
 * "bus:music" / "bus:voice" / "bus:sfx" / "bus:video", or "master".
 */
export type ClaudeTarget = { x: number; y: number } | { clip: string; edge?: 'start' | 'end' } | { media: string } | { channel: string }

/** Claude has one arrow per area: the frame, the timeline (cuts, clips), the uploads and the audio console. */
export type ArrowRole = 'video' | 'timeline' | 'media' | 'audio'
export const ARROW_ROLES: ArrowRole[] = ['video', 'timeline', 'media', 'audio']

export function arrowFor(t: ClaudeTarget): ArrowRole {
  return 'clip' in t ? 'timeline' : 'media' in t ? 'media' : 'channel' in t ? 'audio' : 'video'
}

function readCursor(v: unknown): ClaudeTarget | undefined {
  if (!v || typeof v !== 'object') return undefined
  const c = v as Record<string, unknown>
  if (typeof c.clip === 'string') return { clip: c.clip, edge: c.edge === 'start' || c.edge === 'end' ? c.edge : undefined }
  if (typeof c.media === 'string') return { media: c.media }
  if (typeof c.channel === 'string') return { channel: c.channel }
  return typeof c.x === 'number' && typeof c.y === 'number' ? { x: c.x, y: c.y } : undefined
}

function readArrows(v: unknown): LiveUpdate['arrows'] {
  if (!v || typeof v !== 'object') return undefined
  const out: NonNullable<LiveUpdate['arrows']> = {}
  for (const role of ARROW_ROLES) {
    const a = (v as Record<string, unknown>)[role] as Record<string, unknown> | undefined
    const target = readCursor(a?.target ?? a)
    if (target) out[role] = { target, note: typeof a?.note === 'string' ? a.note : undefined }
  }
  return out
}

interface DocSnapshot {
  exists: boolean
  data(): Record<string, unknown> | undefined
}
interface LiveDb {
  doc(path: string): { onSnapshot(next: (snap: DocSnapshot) => void, error?: (e: unknown) => void): () => void }
}
interface ClaudeRuntime {
  use(name: string): Promise<unknown>
}

export const LIVE_DOC = 'live/current'

/** Subscribes to Claude's live composition. Resolves to an unsubscribe, or null outside an Artifact. */
export async function connectLive(onUpdate: (u: LiveUpdate) => void): Promise<(() => void) | null> {
  const claude = (window as unknown as { claude?: ClaudeRuntime }).claude
  if (!claude?.use) return connectLocalLive(onUpdate)
  const db = (await claude.use('db')) as LiveDb | null
  if (!db) return null
  return db.doc(LIVE_DOC).onSnapshot((snap) => {
    const d = snap.exists ? snap.data() : undefined
    if (!d || typeof d.json !== 'string') return
    onUpdate({
      json: d.json,
      note: typeof d.note === 'string' ? d.note : undefined,
      time: typeof d.time === 'number' ? d.time : undefined,
      cursor: readCursor(d.cursor),
      arrows: readArrows(d.arrows),
    })
  })
}

/**
 * `npm run dev` on your own computer (`#live`): Claude writes `live/current.json` in the repo and the
 * dev server pushes every save to the page. Same shape as the shared doc: `{ json, note?, time? }`,
 * where `json` may also be the composition object itself.
 */
async function connectLocalLive(onUpdate: (u: LiveUpdate) => void): Promise<(() => void) | null> {
  const hot = import.meta.hot
  if (!hot) return null
  const apply = (raw: unknown) => {
    if (!raw || typeof raw !== 'object') return
    const d = raw as Record<string, unknown>
    const json = typeof d.json === 'string' ? d.json : d.json && typeof d.json === 'object' ? JSON.stringify(d.json, null, 2) : null
    if (json === null) return
    onUpdate({
      json,
      note: typeof d.note === 'string' ? d.note : undefined,
      time: typeof d.time === 'number' ? d.time : undefined,
      cursor: readCursor(d.cursor),
      arrows: readArrows(d.arrows),
    })
  }
  const listener = (data: unknown) => apply(data)
  hot.on('live:update', listener)
  await fetch('/__live')
    .then((r) => (r.ok ? r.json() : null))
    .then(apply)
    .catch(() => {})
  return () => hot.off('live:update', listener)
}

// ---- Working together on the page: files and messages from the viewer to Claude ----

export interface LiveFile {
  name: string
  id: string
  url: string
}

interface Assets {
  upload(blob: Blob, options?: { type?: string }): Promise<{ id: string; url: string }>
}
interface FilesDb {
  collection(path: string): {
    doc(id: string): { set(data: Record<string, unknown>): Promise<void> }
    onSnapshot(next: (snap: { docs: { id: string; data(): Record<string, unknown> | undefined }[] }) => void): () => void
  }
}
interface Comments {
  anchorFor(el: Element): Promise<unknown>
  canSendToClaude(): Promise<string>
  sendToClaude(target: { anchor: unknown; text: string }): Promise<unknown>
}
interface Downloads {
  save(req: { filename: string; data: Blob }): Promise<unknown>
}

async function capability<T>(name: string): Promise<T | null> {
  const claude = (window as unknown as { claude?: ClaudeRuntime }).claude
  if (!claude?.use) return null
  return (await claude.use(name)) as T | null
}

/** The asset store accepts a closed set of types; other media (mp3, wav…) is stored as opaque data. */
function storedType(file: File): string {
  const ok = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'video/mp4', 'video/webm', 'font/woff2', 'font/woff', 'font/ttf', 'font/otf']
  if (ok.includes(file.type)) return file.type
  if (/\.(m4a|mp4|mov)$/i.test(file.name)) return 'video/mp4'
  return 'text/plain'
}

/** Uploads files to the Artifact and lists them under `files/`, where Claude can read them. */
export async function uploadLiveFiles(files: File[]): Promise<void> {
  const assets = await capability<Assets>('assets')
  const db = await capability<FilesDb>('db')
  if (!assets || !db) throw new Error('Caricamento non disponibile in questa vista.')
  for (const file of files) {
    const { id } = await assets.upload(file, { type: storedType(file) })
    const key = file.name.replace(/[^\w.-]+/g, '_')
    await db.collection('files').doc(key).set({ name: file.name, id, type: file.type, size: file.size, at: Date.now() })
  }
}

/** Follows the shared file list. Each file resolves to its stored asset. */
export async function watchLiveFiles(onChange: (files: LiveFile[]) => void): Promise<(() => void) | null> {
  const db = await capability<FilesDb>('db')
  if (!db) return null
  return db.collection('files').onSnapshot((snap) => {
    const out: LiveFile[] = []
    for (const d of snap.docs) {
      const data = d.data()
      if (data && typeof data.name === 'string' && typeof data.id === 'string') out.push({ name: data.name, id: data.id, url: `/_blob/${data.id}` })
    }
    onChange(out)
  })
}

/** Sends a message to Claude as a comment on `el`. Returns false when this viewer cannot. */
export async function sendToClaude(el: Element, text: string): Promise<boolean> {
  const comments = await capability<Comments>('comments')
  if (!comments || (await comments.canSendToClaude()) !== 'available') return false
  await comments.sendToClaude({ anchor: await comments.anchorFor(el), text })
  return true
}

/** Saves a file through the Artifact viewer (plain download links do nothing there). */
export async function saveLiveFile(filename: string, data: Blob): Promise<boolean> {
  const downloads = await capability<Downloads>('downloads')
  if (!downloads) return false
  await downloads.save({ filename, data })
  return true
}
