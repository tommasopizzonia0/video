import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Inspector } from './components/Inspector'
import { Library } from './components/Library'
import { Timeline } from './components/Timeline'
import { loadMediaFile } from './media'
import { Player } from './player'
import { initialState, reducer } from './state'
import { formatTime, totalDuration, type Format } from './timeline'

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playerRef = useRef<Player | null>(null)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [exporting, setExporting] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { project } = state
  const duration = totalDuration(project.clips)

  useEffect(() => {
    const player = new Player(canvasRef.current!, initialState.project)
    player.onTime = setTime
    player.onPlayingChange = setPlaying
    playerRef.current = player
    return () => player.destroy()
  }, [])

  useEffect(() => {
    const player = playerRef.current!
    for (const item of state.media) player.addMedia(item)
  }, [state.media])

  useEffect(() => {
    playerRef.current?.setProject(project)
  }, [project])

  const importFiles = useCallback(async (files: FileList | File[]) => {
    setError(null)
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('video/') && !file.type.startsWith('audio/')) {
        setError(`"${file.name}" non è un video o un audio.`)
        continue
      }
      try {
        const item = await loadMediaFile(file)
        dispatch({ type: 'addMedia', item })
        // Imported videos go straight onto the timeline; they can be added again from the library.
        if (item.kind === 'video') dispatch({ type: 'addClip', mediaId: item.id })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }
  }, [])

  const seek = useCallback((t: number) => void playerRef.current?.jump(t), [])

  const exportVideo = async () => {
    const player = playerRef.current
    if (!player || duration === 0) return
    setExporting(0)
    try {
      const { blob, extension } = await player.export(setExporting)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `video.${extension}`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
    } catch (e) {
      setError(`Export non riuscito: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setExporting(null)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select') || exporting !== null) return
      if (e.code === 'Space') {
        e.preventDefault()
        playerRef.current?.toggle()
      } else if (e.key === 's' || e.key === 'S') {
        dispatch({ type: 'split', time })
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        dispatch({ type: 'deleteSelection' })
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        seek(time + (e.key === 'ArrowLeft' ? -1 : 1) / (e.shiftKey ? 1 : 10))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [time, exporting, seek])

  return (
    <div
      className="app"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        if (e.dataTransfer.files.length) void importFiles(e.dataTransfer.files)
      }}
    >
      <header className="topbar">
        <div className="brand">
          <span className="logo">▶</span> Video Editor
          <a className="mode-link" href="#motion" title="Video di motion design da un file JSON">
            ✦ Motion
          </a>
        </div>
        <div className="topbar-actions">
          <label className="field-inline">
            Formato
            <select
              value={project.format}
              onChange={(e) => dispatch({ type: 'setFormat', format: e.target.value as Format })}
              disabled={exporting !== null}
            >
              <option value="16:9">16:9 orizzontale</option>
              <option value="9:16">9:16 verticale</option>
              <option value="1:1">1:1 quadrato</option>
            </select>
          </label>
          <button className="primary" onClick={exportVideo} disabled={duration === 0 || exporting !== null}>
            {exporting === null ? 'Esporta video' : `Esportazione… ${Math.round(exporting * 100)}%`}
          </button>
        </div>
      </header>

      {error && (
        <div className="error" role="alert">
          {error} <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      <Library media={state.media} music={project.music} onImport={importFiles} dispatch={dispatch} />

      <main className="preview">
        <div className={`stage format-${project.format.replace(':', 'x')}`}>
          <canvas ref={canvasRef} />
          {duration === 0 && (
            <div className="stage-empty">
              <p>Trascina qui i tuoi video, oppure usa «Importa» a sinistra.</p>
            </div>
          )}
        </div>
        <div className="transport">
          <button onClick={() => seek(0)} title="Vai all'inizio" disabled={exporting !== null}>
            ⏮
          </button>
          <button className="play" onClick={() => playerRef.current?.toggle()} disabled={duration === 0 || exporting !== null} title="Play/Pausa (spazio)">
            {playing ? '⏸' : '▶'}
          </button>
          <span className="timecode">
            {formatTime(time)} / {formatTime(duration)}
          </span>
          <button onClick={() => dispatch({ type: 'split', time })} disabled={duration === 0 || exporting !== null} title="Dividi la clip al cursore (S)">
            ✂ Dividi
          </button>
          <button onClick={() => dispatch({ type: 'addText', time: Math.min(time, Math.max(0, duration - 1)) })} disabled={exporting !== null}>
            T Aggiungi testo
          </button>
        </div>
      </main>

      <Inspector state={state} time={time} dispatch={dispatch} />

      <Timeline state={state} time={time} duration={duration} onSeek={seek} dispatch={dispatch} />

      {exporting !== null && (
        <div className="overlay">
          <div className="overlay-card">
            <p>Sto registrando il video in tempo reale…</p>
            <progress value={exporting} max={1} />
            <p className="hint">Tieni questa scheda aperta e in primo piano fino alla fine.</p>
          </div>
        </div>
      )}
    </div>
  )
}
