// The Caricamenti panel on the left of the live studio: every picture, clip and sound in the library,
// filtered by where it came from. Drag one onto the timeline (or press +) to make it a clip.

import { useEffect, useMemo, useRef, useState } from 'react'
import { ENABLED as HIGGSFIELD_ON, generate } from './higgsfield'
import { MEDIA_DRAG, SOURCE_LABEL, fetchLibrary, mediaDuration, uploadToLibrary, watchLibrary, type MediaItem } from './library'

const FILTERS = ['tutti', 'higgsfield', 'foto', 'suoni', 'caricati'] as const
type Filter = (typeof FILTERS)[number]

function formatDuration(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`
}

/** A sound in the panel: press to listen, press again to stop. */
function AudioPreview({ url }: { url: string }) {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  useEffect(() => () => audio.current?.pause(), [])
  const toggle = () => {
    if (!audio.current) {
      audio.current = new Audio(url)
      audio.current.onended = () => setPlaying(false)
    }
    if (playing) {
      audio.current.pause()
      audio.current.currentTime = 0
      setPlaying(false)
    } else {
      void audio.current.play()
      setPlaying(true)
    }
  }
  return (
    <button className={`mp-audio${playing ? ' playing' : ''}`} title={playing ? 'Ferma' : 'Ascolta'} onClick={toggle} onPointerDown={(e) => e.stopPropagation()}>
      {playing ? '■' : '▶'}
    </button>
  )
}

function Thumb({ item }: { item: MediaItem }) {
  const [length, setLength] = useState<number | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (!item.type.startsWith('image/')) void mediaDuration(item.url, item.type).then(setLength)
  }, [item])
  return (
    <div className="mp-thumb">
      {item.type.startsWith('image/') && <img src={item.url} alt="" loading="lazy" draggable={false} />}
      {item.type.startsWith('video/') && (
        <video
          ref={video}
          src={`${item.url}#t=0.5`}
          muted
          preload="metadata"
          playsInline
          onMouseEnter={() => void video.current?.play().catch(() => {})}
          onMouseLeave={() => video.current?.pause()}
        />
      )}
      {item.type.startsWith('audio/') && <AudioPreview url={item.url} />}
      {length !== null && length > 0 && <span className="mp-length">{formatDuration(length)}</span>}
    </div>
  )
}

export function MediaPanel({ onAdd }: { onAdd: (item: MediaItem) => void }) {
  const [items, setItems] = useState<MediaItem[]>([])
  const [filter, setFilter] = useState<Filter>('tutti')
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [genNote, setGenNote] = useState<string | null>(null)
  // Files that showed up while the page was open get a "Nuovo" badge.
  const known = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const apply = (list: MediaItem[]) => {
      if (known.current) {
        const added = list.filter((i) => !known.current!.has(i.id)).map((i) => i.id)
        if (added.length) setFresh((f) => new Set([...f, ...added]))
      }
      known.current = new Set(list.map((i) => i.id))
      setItems(list)
    }
    void fetchLibrary().then(apply)
    return watchLibrary(apply)
  }, [])

  const shown = useMemo(() => (filter === 'tutti' ? items : items.filter((i) => i.source === filter)), [items, filter])

  const upload = async (files: FileList | File[]) => {
    setError(null)
    try {
      await uploadToLibrary([...files])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <aside
      className={`media-panel${dragOver ? ' drag-over' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          e.stopPropagation()
          setDragOver(true)
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        e.stopPropagation()
        setDragOver(false)
        void upload(e.dataTransfer.files)
      }}
    >
      <div className="mp-head">
        <h2>Caricamenti</h2>
        <button className="primary" onClick={() => fileInput.current?.click()}>
          + Importa
        </button>
        <input ref={fileInput} type="file" multiple accept="image/*,video/*,audio/*" hidden onChange={(e) => e.target.files && void upload(e.target.files)} />
      </div>
      <div className="mp-filters">
        {FILTERS.map((f) => (
          <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
            {f === 'tutti' ? 'Tutti' : SOURCE_LABEL[f]}
            <span>{f === 'tutti' ? items.length : items.filter((i) => i.source === f).length}</span>
          </button>
        ))}
      </div>
      {error && <p className="mp-error">{error}</p>}

      <div className="mp-grid">
        {shown.length === 0 && (
          <p className="mp-empty">
            {filter === 'higgsfield'
              ? 'I video che scarichi da Higgsfield nella cartella Videos\\higgsfield compaiono qui da soli.'
              : 'Trascina qui foto, video o musica, oppure usa «Importa».'}
          </p>
        )}
        {shown.map((item) => (
          <div
            key={item.id}
            className="mp-item"
            data-claude={`media:${item.name}`}
            draggable
            title={`${item.name} · ${SOURCE_LABEL[item.source] ?? item.source} — trascinalo nella timeline`}
            onDragStart={(e) => {
              e.dataTransfer.setData(MEDIA_DRAG, JSON.stringify(item))
              e.dataTransfer.effectAllowed = 'copy'
            }}
          >
            <Thumb item={item} />
            <div className="mp-meta">
              <span className="mp-name">{item.name}</span>
              <span className={`mp-source src-${item.source}`}>{SOURCE_LABEL[item.source] ?? item.source}</span>
            </div>
            {fresh.has(item.id) && <span className="mp-new">Nuovo</span>}
            <button className="mp-add" title="Aggiungi in fondo al video" onClick={() => onAdd(item)}>
              +
            </button>
          </div>
        ))}
      </div>

      <details className="mp-generate">
        <summary>
          Genera con Higgsfield <span className="mp-off">{HIGGSFIELD_ON ? 'attivo' : 'spento'}</span>
        </summary>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Descrivi il video da generare…" rows={2} />
        <button
          disabled={!HIGGSFIELD_ON || !prompt.trim()}
          onClick={() => void generate({ prompt }).catch((e: Error) => setGenNote(e.message))}
          title={HIGGSFIELD_ON ? '' : 'Non ancora attivo: nessun credito verrà usato'}
        >
          Genera
        </button>
        <p className="mp-hint">{genNote ?? 'Non ancora attivo, quindi nessun credito usato. Per ora i video generati sul sito arrivano qui dalla cartella higgsfield.'}</p>
      </details>
    </aside>
  )
}
