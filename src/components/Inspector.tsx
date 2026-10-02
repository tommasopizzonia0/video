import type { Dispatch } from 'react'
import type { Action, State } from '../state'
import { formatTime } from '../timeline'

interface Props {
  state: State
  time: number
  dispatch: Dispatch<Action>
}

export function Inspector({ state, time, dispatch }: Props) {
  const { selection, project, media } = state

  return (
    <aside className="panel inspector">
      <div className="panel-head">
        <h2>Proprietà</h2>
      </div>

      {selection?.kind === 'clip' && (() => {
        const index = project.clips.findIndex((c) => c.id === selection.id)
        const clip = project.clips[index]
        if (!clip) return null
        const source = media.find((m) => m.id === clip.mediaId)
        const max = source?.duration ?? clip.out
        return (
          <div className="fields">
            <p className="muted ellipsis">Clip: {source?.name}</p>
            <Range label="Inizio" value={clip.in} max={max} onChange={(v) => dispatch({ type: 'trimClip', id: clip.id, in: v })} />
            <Range label="Fine" value={clip.out} max={max} onChange={(v) => dispatch({ type: 'trimClip', id: clip.id, out: v })} />
            <p className="muted">Durata: {formatTime(clip.out - clip.in)}</p>
            <div className="row">
              <button disabled={index === 0} onClick={() => dispatch({ type: 'moveClip', from: index, to: index - 1 })}>
                ← Sposta
              </button>
              <button disabled={index === project.clips.length - 1} onClick={() => dispatch({ type: 'moveClip', from: index, to: index + 1 })}>
                Sposta →
              </button>
            </div>
            <button className="danger" onClick={() => dispatch({ type: 'deleteSelection' })}>
              Elimina clip
            </button>
          </div>
        )
      })()}

      {selection?.kind === 'text' && (() => {
        const text = project.texts.find((t) => t.id === selection.id)
        if (!text) return null
        const update = (patch: Partial<typeof text>) => dispatch({ type: 'updateText', id: text.id, patch })
        return (
          <div className="fields">
            <label>
              Testo
              <textarea rows={2} value={text.text} onChange={(e) => update({ text: e.target.value })} />
            </label>
            <div className="row">
              <label>
                Inizio (s)
                <input type="number" min={0} step={0.1} value={round(text.start)} onChange={(e) => update({ start: Math.max(0, Number(e.target.value)) })} />
              </label>
              <label>
                Durata (s)
                <input type="number" min={0.2} step={0.1} value={round(text.duration)} onChange={(e) => update({ duration: Math.max(0.2, Number(e.target.value)) })} />
              </label>
            </div>
            <button onClick={() => update({ start: round(time) })}>Inizia al cursore</button>
            <Range label="Dimensione" value={text.size} min={16} max={160} step={1} onChange={(v) => update({ size: v })} format={(v) => `${v}px`} />
            <Range label="Posizione orizzontale" value={text.x} max={1} step={0.01} onChange={(v) => update({ x: v })} format={percent} />
            <Range label="Posizione verticale" value={text.y} max={1} step={0.01} onChange={(v) => update({ y: v })} format={percent} />
            <label className="field-inline">
              Colore
              <input type="color" value={text.color} onChange={(e) => update({ color: e.target.value })} />
            </label>
            <button className="danger" onClick={() => dispatch({ type: 'deleteSelection' })}>
              Elimina testo
            </button>
          </div>
        )
      })()}

      {selection?.kind === 'music' && project.music && (
        <div className="fields">
          <p className="muted ellipsis">Musica: {media.find((m) => m.id === project.music!.mediaId)?.name}</p>
          <button className="danger" onClick={() => dispatch({ type: 'deleteSelection' })}>
            Rimuovi musica
          </button>
        </div>
      )}

      {!selection && <p className="muted">Seleziona una clip, un testo o la musica nella timeline per modificarli.</p>}

      <div className="fields mix">
        <h3>Volume</h3>
        <Range label="Audio delle clip" value={project.clipVolume} max={1} step={0.01} onChange={(v) => dispatch({ type: 'setClipVolume', volume: v })} format={percent} />
        {project.music && (
          <Range label="Musica" value={project.music.volume} max={1} step={0.01} onChange={(v) => dispatch({ type: 'setMusicVolume', volume: v })} format={percent} />
        )}
      </div>

      <div className="shortcuts muted">
        <b>Scorciatoie</b>: Spazio play/pausa · S dividi · Canc elimina · ←/→ sposta il cursore
      </div>
    </aside>
  )
}

function Range({
  label,
  value,
  min = 0,
  max,
  step = 0.05,
  onChange,
  format = (v) => formatTime(v),
}: {
  label: string
  value: number
  min?: number
  max: number
  step?: number
  onChange: (v: number) => void
  format?: (v: number) => string
}) {
  return (
    <label>
      <span className="range-label">
        {label} <span className="muted">{format(value)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}

const round = (v: number) => Math.round(v * 10) / 10
const percent = (v: number) => `${Math.round(v * 100)}%`
