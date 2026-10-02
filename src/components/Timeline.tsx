import { useRef, useState, type Dispatch, type PointerEvent } from 'react'
import type { Action, State } from '../state'
import { clipLength, clipStarts } from '../timeline'

interface Props {
  state: State
  time: number
  duration: number
  onSeek: (t: number) => void
  dispatch: Dispatch<Action>
}

const LABEL_WIDTH = 80

export function Timeline({ state, time, duration, onSeek, dispatch }: Props) {
  const { project, media, selection } = state
  const [zoom, setZoom] = useState(60) // pixels per second
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const starts = clipStarts(project.clips)
  const musicItem = project.music ? media.find((m) => m.id === project.music!.mediaId) : undefined
  const textEnd = Math.max(0, ...project.texts.map((t) => t.start + t.duration))
  const length = Math.max(duration, textEnd, 10) + 5
  const width = length * zoom

  const timeAt = (clientX: number) => {
    const rect = scrollRef.current!.getBoundingClientRect()
    return (clientX - rect.left + scrollRef.current!.scrollLeft - LABEL_WIDTH) / zoom
  }

  const scrub = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    onSeek(timeAt(e.clientX))
  }

  const dragText = (e: PointerEvent<HTMLDivElement>, id: string, start: number) => {
    e.stopPropagation()
    dispatch({ type: 'select', selection: { kind: 'text', id } })
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const x0 = e.clientX
    const move = (ev: globalThis.PointerEvent) => {
      const next = Math.max(0, Math.round((start + (ev.clientX - x0) / zoom) * 10) / 10)
      dispatch({ type: 'updateText', id, patch: { start: next } })
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const tickStep = zoom >= 80 ? 1 : zoom >= 30 ? 2 : zoom >= 12 ? 5 : 10
  const ticks = Array.from({ length: Math.ceil(length / tickStep) + 1 }, (_, i) => i * tickStep)

  return (
    <section className="timeline">
      <div className="timeline-tools">
        <span className="muted">Timeline</span>
        <label className="field-inline">
          Zoom
          <input type="range" min={8} max={200} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
        </label>
      </div>
      <div className="timeline-scroll" ref={scrollRef}>
        <div className="timeline-inner" style={{ width: width + LABEL_WIDTH }}>
          <div className="ruler" onPointerDown={scrub} onPointerMove={(e) => e.buttons === 1 && onSeek(timeAt(e.clientX))}>
            <div className="track-label" />
            {ticks.map((t) => (
              <span key={t} className="tick" style={{ left: LABEL_WIDTH + t * zoom }}>
                {t}s
              </span>
            ))}
          </div>

          <div className="track" onPointerDown={(e) => e.target === e.currentTarget && onSeek(timeAt(e.clientX))}>
            <div className="track-label">Video</div>
            {project.clips.map((clip, i) => {
              const item = media.find((m) => m.id === clip.mediaId)
              const selected = selection?.kind === 'clip' && selection.id === clip.id
              return (
                <div
                  key={clip.id}
                  className={`block clip ${selected ? 'selected' : ''} ${dragFrom === i ? 'dragging' : ''}`}
                  style={{
                    left: LABEL_WIDTH + starts[i] * zoom,
                    width: Math.max(4, clipLength(clip) * zoom - 2),
                    backgroundImage: item?.thumbnail ? `url(${item.thumbnail})` : undefined,
                  }}
                  draggable
                  onDragStart={(e) => {
                    setDragFrom(i)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragEnd={() => setDragFrom(null)}
                  onDragOver={(e) => {
                    if (dragFrom !== null) e.preventDefault()
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (dragFrom !== null) dispatch({ type: 'moveClip', from: dragFrom, to: i })
                    setDragFrom(null)
                  }}
                  onClick={() => dispatch({ type: 'select', selection: { kind: 'clip', id: clip.id } })}
                  title={item?.name}
                >
                  <span>{item?.name}</span>
                </div>
              )
            })}
          </div>

          <div className="track" onPointerDown={(e) => e.target === e.currentTarget && onSeek(timeAt(e.clientX))}>
            <div className="track-label">Testi</div>
            {project.texts.map((text) => {
              const selected = selection?.kind === 'text' && selection.id === text.id
              return (
                <div
                  key={text.id}
                  className={`block text ${selected ? 'selected' : ''}`}
                  style={{ left: LABEL_WIDTH + text.start * zoom, width: Math.max(4, text.duration * zoom - 2) }}
                  onPointerDown={(e) => dragText(e, text.id, text.start)}
                  title="Trascina per spostare"
                >
                  <span>{text.text}</span>
                </div>
              )
            })}
          </div>

          <div className="track" onPointerDown={(e) => e.target === e.currentTarget && onSeek(timeAt(e.clientX))}>
            <div className="track-label">Musica</div>
            {musicItem && (
              <div
                className={`block music ${selection?.kind === 'music' ? 'selected' : ''}`}
                style={{ left: LABEL_WIDTH, width: Math.max(4, Math.min(musicItem.duration, Math.max(duration, 1)) * zoom - 2) }}
                onClick={() => dispatch({ type: 'select', selection: { kind: 'music' } })}
              >
                <span>♪ {musicItem.name}</span>
              </div>
            )}
          </div>

          <div className="playhead" style={{ left: LABEL_WIDTH + time * zoom }} />
        </div>
      </div>
    </section>
  )
}
