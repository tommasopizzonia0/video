// The studio's timeline, laid out like a desktop editor: a ruler, the scenes as the main video
// track with thumbnails, overlay tracks for text, shapes and media, and the audio below.
// Clicking or dragging seeks; clicking a clip jumps to it and selects it.

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Renderer, videoRequests } from '../engine/render'
import type { BrowserResources } from '../engine/resources'
import { compDuration, layerWindow, sceneStarts, transitionDuration } from '../engine/timeline'
import type { Composition, Layer } from '../engine/types'
import { formatTime } from '../timeline'
import { MEDIA_DRAG, type MediaItem } from './library'

type Kind = 'text' | 'shape' | 'media' | 'audio'

interface Clip {
  key: string
  kind: Kind | 'scene'
  label: string
  /** What Claude's arrow uses to find it: scene id or layer id, else the label. */
  name: string
  start: number
  duration: number
  /** Overlap with the previous scene (its transition), for scene clips. */
  transition?: { type: string; duration: number }
  sceneIndex?: number
}

interface Track {
  key: string
  kind: Kind | 'scene'
  title: string
  clips: Clip[]
}

const KIND_TITLE: Record<Kind | 'scene', string> = { text: 'Testo', shape: 'Forme', media: 'Media', audio: 'Audio', scene: 'Video' }
const KIND_ICON: Record<Kind | 'scene', string> = { text: 'T', shape: '◆', media: '▣', audio: '♪', scene: '▶' }
const TYPE_LABEL: Record<string, string> = {
  rect: 'Rettangolo',
  ellipse: 'Ellisse',
  path: 'Forma',
  group: 'Gruppo',
  text: 'Testo',
  captions: 'Sottotitoli',
  image: 'Immagine',
  video: 'Video',
  studio: 'Studio',
}

function kindOf(layer: Layer): Kind {
  if (layer.type === 'text' || layer.type === 'captions') return 'text'
  if (layer.type === 'image' || layer.type === 'video' || layer.type === 'studio') return 'media'
  return 'shape'
}

function labelOf(layer: Layer): string {
  if (layer.type === 'text') return layer.text.replace(/[{}]/g, '').replace(/\n/g, ' ')
  if (layer.id) return layer.id
  if (layer.type === 'ellipse' && typeof layer.blur === 'number' && layer.blur > 40) return 'Bagliore'
  return TYPE_LABEL[layer.type] ?? layer.type
}

/** A full-frame plain rectangle is a scene background, not a clip worth a track. */
function isBackground(layer: Layer, comp: Composition): boolean {
  return layer.type === 'rect' && typeof layer.width === 'number' && typeof layer.height === 'number' && layer.width >= comp.width && layer.height >= comp.height
}

/** Puts clips of one kind on as few rows as possible without overlaps. */
function packLanes(kind: Kind, clips: Clip[]): Track[] {
  const lanes: Clip[][] = []
  for (const c of [...clips].sort((a, b) => a.start - b.start)) {
    const lane = lanes.find((l) => l[l.length - 1].start + l[l.length - 1].duration <= c.start + 1e-3)
    if (lane) lane.push(c)
    else lanes.push([c])
  }
  return lanes.map((clips, i) => ({ key: `${kind}-${i}`, kind, title: lanes.length > 1 ? `${KIND_TITLE[kind]} ${i + 1}` : KIND_TITLE[kind], clips }))
}

function buildTracks(comp: Composition): Track[] {
  const total = compDuration(comp)
  const scenes = comp.scenes ?? []
  const starts = sceneStarts(scenes)
  const byKind: Record<Kind, Clip[]> = { text: [], shape: [], media: [], audio: [] }

  const addLayers = (layers: Layer[], offset: number, parentDuration: number, prefix: string) => {
    layers.forEach((layer, i) => {
      if (layer.hidden || isBackground(layer, comp)) return
      const w = layerWindow(layer, parentDuration)
      const kind = kindOf(layer)
      byKind[kind].push({ key: `${prefix}-${i}`, kind, label: labelOf(layer), name: layer.id ?? labelOf(layer), start: offset + w.start, duration: w.duration })
    })
  }
  scenes.forEach((s, i) => addLayers(s.layers, starts[i], s.duration, `s${i}`))
  addLayers(comp.layers ?? [], 0, total, 'top')

  ;(comp.audio ?? []).forEach((a, i) => {
    let offset = 0
    if (a.scene !== undefined) {
      const idx = typeof a.scene === 'number' ? a.scene : scenes.findIndex((s) => s.id === a.scene)
      if (idx >= 0) offset = starts[idx]
    }
    const start = offset + (a.start ?? 0)
    const duration = a.duration ?? (a.sfx ? 0.6 : Math.max(0.1, total - start))
    byKind.audio.push({ key: `a${i}`, kind: 'audio', label: a.sfx ?? a.asset ?? 'Audio', name: a.sfx ?? a.asset ?? 'Audio', start: a.sfx ? Math.max(0, start - 0.15) : start, duration })
  })

  const sceneTrack: Track = {
    key: 'scenes',
    kind: 'scene',
    title: KIND_TITLE.scene,
    clips: scenes.map((s, i) => ({
      key: `scene-${i}`,
      kind: 'scene' as const,
      label: s.id ?? `Scena ${i + 1}`,
      name: s.id ?? `Scena ${i + 1}`,
      start: starts[i],
      duration: s.duration,
      sceneIndex: i,
      transition:
        i > 0 && s.transition && s.transition.type !== 'cut'
          ? { type: s.transition.type, duration: Math.min(transitionDuration(s.transition), scenes[i - 1].duration, s.duration) }
          : undefined,
    })),
  }

  return [
    ...packLanes('text', byKind.text),
    ...packLanes('shape', byKind.shape),
    ...packLanes('media', byKind.media),
    ...(sceneTrack.clips.length ? [sceneTrack] : []),
    ...packLanes('audio', byKind.audio),
  ]
}

/** One small frame per scene, rendered off screen, for the filmstrip on the video track. */
function useSceneThumbs(comp: Composition | null, res: BrowserResources | null): string[] {
  const [thumbs, setThumbs] = useState<string[]>([])
  useEffect(() => {
    if (!comp || !res) return
    let cancelled = false
    const scenes = comp.scenes ?? []
    const starts = sceneStarts(scenes)
    void (async () => {
      const canvas = document.createElement('canvas')
      const renderer = new Renderer(canvas, comp, res, { scale: 120 / Math.max(comp.width, comp.height) })
      const out: string[] = []
      for (let i = 0; i < scenes.length; i++) {
        if (cancelled) return
        // Late in the scene, when its entrances have played, but before the next one cuts in.
        const t = starts[i] + scenes[i].duration * 0.75
        try {
          await res.prepare(videoRequests(comp, t))
          renderer.draw(t)
          out.push(canvas.toDataURL('image/jpeg', 0.7))
        } catch {
          out.push('')
        }
      }
      if (!cancelled) setThumbs(out)
    })()
    return () => {
      cancelled = true
    }
  }, [comp, res])
  return thumbs
}

const HEADER = 120

function rulerLabel(t: number): string {
  const whole = Math.floor(t + 1e-6)
  const frac = t - whole > 1e-3 ? `.${Math.round((t - whole) * 10)}` : ''
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}${frac}`
}

export function StudioTimeline({
  comp,
  res,
  time,
  duration,
  fps,
  playing,
  onSeek,
  onTogglePlay,
  onDropMedia,
  selected = null,
  onSelect,
}: {
  comp: Composition | null
  res: BrowserResources | null
  time: number
  duration: number
  fps: number
  playing: boolean
  onSeek: (t: number) => void
  onTogglePlay: () => void
  /** A library item dropped on the timeline at comp time 	ime. */
  onDropMedia?: (item: MediaItem, time: number) => void
  /** Key of the selected clip: scene-<i>, s<scene>-<layer>, top-<layer> or a<audio>. Canc deletes it. */
  selected?: string | null
  onSelect?: (key: string | null) => void
}) {
  const tracks = useMemo(() => (comp ? buildTracks(comp) : []), [comp])
  const thumbs = useSceneThumbs(comp, res)
  const scroller = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [width, setWidth] = useState(800)
  const [dropAt, setDropAt] = useState<number | null>(null)

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const total = Math.max(duration, 1)
  // At zoom 1 the whole video fits the visible width.
  const pps = (Math.max(200, width - HEADER - 24) / total) * zoom
  const contentWidth = total * pps
  const x = (t: number) => t * pps

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scroller.current
    if (!el || !playing) return
    const px = HEADER + x(time)
    if (px > el.scrollLeft + el.clientWidth - 40 || px < el.scrollLeft + HEADER) el.scrollLeft = px - HEADER - 40
  })

  // Labelled ticks every `step` seconds (with a minor tick halfway), at least ~70px apart.
  const step = [0.5, 1, 2, 5, 10, 30, 60].find((s) => s * pps >= 70) ?? 60
  const ticks: number[] = []
  for (let t = 0; t <= total + 1e-6; t += step / 2) ticks.push(Math.round(t * 1000) / 1000)

  const seekFromPointer = (e: ReactPointerEvent<HTMLElement>) => {
    const area = e.currentTarget.getBoundingClientRect()
    const t = (e.clientX - area.left) / pps
    onSeek(Math.min(total, Math.max(0, Math.round(t * fps) / fps)))
  }
  const startScrub = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    onSelect?.(null)
    e.currentTarget.setPointerCapture(e.pointerId)
    seekFromPointer(e)
  }
  const moveScrub = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) seekFromPointer(e)
  }

  const frame = 1 / fps
  return (
    <section className="tl">
      <div className="tl-toolbar">
        <div className="tl-tools">
          <button title="Vai all'inizio" onClick={() => onSeek(0)}>⏮</button>
          <button title="Fotogramma precedente (←)" onClick={() => onSeek(Math.max(0, time - frame))}>‹</button>
          <button className="tl-play" title="Play/Pausa (spazio)" onClick={onTogglePlay} disabled={!comp}>
            {playing ? '❚❚' : '▶'}
          </button>
          <button title="Fotogramma successivo (→)" onClick={() => onSeek(Math.min(total, time + frame))}>›</button>
          <button title="Vai alla fine" onClick={() => onSeek(total)}>⏭</button>
        </div>
        <div className="tl-timecode">
          <strong>{formatTime(time)}</strong> <span>/ {formatTime(duration)}</span>
        </div>
        <div className="tl-zoom">
          <button title="Riduci" onClick={() => setZoom((z) => Math.max(1, z / 1.5))}>−</button>
          <input type="range" min={1} max={12} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom timeline" />
          <button title="Ingrandisci" onClick={() => setZoom((z) => Math.min(12, z * 1.5))}>+</button>
          <button title="Adatta alla finestra" onClick={() => setZoom(1)}>Adatta</button>
        </div>
      </div>

      <div
        className={`tl-scroll${dropAt !== null ? ' dropping' : ''}`}
        ref={scroller}
        onDragOver={(e) => {
          if (!onDropMedia || !e.dataTransfer.types.includes(MEDIA_DRAG)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          const r = e.currentTarget.getBoundingClientRect()
          setDropAt(Math.min(total, Math.max(0, (e.clientX - r.left + e.currentTarget.scrollLeft - HEADER) / pps)))
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(null)
        }}
        onDrop={(e) => {
          const raw = e.dataTransfer.getData(MEDIA_DRAG)
          const at = dropAt
          setDropAt(null)
          if (!raw || !onDropMedia || at === null) return
          e.preventDefault()
          onDropMedia(JSON.parse(raw) as MediaItem, at)
        }}
      >
        <div className="tl-inner" style={{ width: HEADER + contentWidth + 24 }}>
          <div className="tl-row tl-ruler-row">
            <div className="tl-head tl-corner" />
            <div className="tl-ruler" style={{ width: contentWidth }} onPointerDown={startScrub} onPointerMove={moveScrub}>
              {ticks.map((t, i) => (
                <div key={t} className={`tl-tick${i % 2 === 0 ? ' major' : ''}`} style={{ left: x(t) }}>
                  {i % 2 === 0 && <span>{rulerLabel(t)}</span>}
                </div>
              ))}
            </div>
          </div>

          {tracks.length === 0 && <div className="tl-empty">La timeline si riempie quando la composizione è pronta.</div>}

          {tracks.map((track) => (
            <div key={track.key} className={`tl-row tl-track kind-${track.kind}`}>
              <div className="tl-head">
                <span className="tl-icon">{KIND_ICON[track.kind]}</span>
                {track.title}
              </div>
              <div className="tl-lane" style={{ width: contentWidth }} onPointerDown={startScrub} onPointerMove={moveScrub}>
                {track.clips.map((c) => {
                  const thumb = c.sceneIndex !== undefined ? thumbs[c.sceneIndex] : undefined
                  // Scenes sit back to back: the part overlapping the previous one is its transition,
                  // shown as a marker on the cut.
                  const lead = c.transition?.duration ?? 0
                  return (
                    <div
                      key={c.key}
                      data-claude={c.name}
                      className={`tl-clip kind-${c.kind}${selected === c.key ? ' selected' : ''}`}
                      style={{
                        left: x(c.start + lead),
                        width: Math.max(4, x(c.duration - lead) - 2),
                        backgroundImage: thumb ? `url(${thumb})` : undefined,
                      }}
                      title={`${c.label} · ${formatTime(c.start)} → ${formatTime(c.start + c.duration)}`}
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        onSelect?.(c.key)
                        onSeek(c.start)
                      }}
                    >
                      <span className="tl-clip-label">{c.label}</span>
                      {c.kind === 'scene' && <span className="tl-clip-dur">{c.duration.toFixed(1)}s</span>}
                    </div>
                  )
                })}
                {track.clips.map((c) =>
                  c.transition ? (
                    <span
                      key={`${c.key}-tr`}
                      className="tl-transition"
                      style={{ left: x(c.start + c.transition.duration) }}
                      title={`Transizione: ${c.transition.type} (${c.transition.duration.toFixed(2)}s)`}
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        onSeek(c.start)
                      }}
                    >
                      ⧓
                    </span>
                  ) : null,
                )}
              </div>
            </div>
          ))}

          {dropAt !== null && (
            <div className="tl-drop" style={{ left: HEADER + x(dropAt) }}>
              <span>Rilascia per aggiungere qui</span>
            </div>
          )}

          <div className="tl-playhead" style={{ left: HEADER + x(Math.min(time, total)) }}>
            <i />
          </div>
        </div>
      </div>
    </section>
  )
}
