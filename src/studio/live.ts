// Live mode: when the Motion studio runs as a claude.ai Artifact, Claude writes the composition
// it is working on to a shared document, and every open studio follows along in real time.

export interface LiveUpdate {
  /** The composition JSON text. */
  json: string
  /** What Claude is doing, shown in the studio. */
  note?: string
  /** Comp time to show, so the viewer sees the part being changed. */
  time?: number
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
  if (!claude?.use) return null
  const db = (await claude.use('db')) as LiveDb | null
  if (!db) return null
  return db.doc(LIVE_DOC).onSnapshot((snap) => {
    const d = snap.exists ? snap.data() : undefined
    if (!d || typeof d.json !== 'string') return
    onUpdate({
      json: d.json,
      note: typeof d.note === 'string' ? d.note : undefined,
      time: typeof d.time === 'number' ? d.time : undefined,
    })
  })
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
