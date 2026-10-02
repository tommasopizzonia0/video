// Motion studio: write or open a composition JSON, preview it frame-accurately and export it to MP4.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { audioMix, scheduleMix } from '../engine/audio'
import { exportVideo } from '../engine/export'
import { Renderer, videoRequests } from '../engine/render'
import { BrowserResources } from '../engine/resources'
import { sceneStarts } from '../engine/timeline'
import type { Composition } from '../engine/types'
import { parseComposition, type Issue } from '../engine/validate'
import { formatTime } from '../timeline'

const examples = import.meta.glob<string>('../../examples/*.json', { eager: true, query: '?raw', import: 'default' })
const exampleAssets = import.meta.glob<string>('../../examples/assets/*', { eager: true, query: '?url', import: 'default' })

const EXAMPLES = Object.entries(examples)
  .map(([path, text]) => ({ name: path.split('/').pop()!.replace('.json', ''), text }))
  .filter((e) => !e.name.startsWith('_'))
const ASSET_URLS = new Map(Object.entries(exampleAssets).map(([path, url]) => [path.split('/').pop()!, url]))

const STORAGE_KEY = 'motion-studio-json'
const fileName = (src: string) => src.split(/[\\/]/).pop() ?? src

function loadSaved(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return saved
  } catch {
    // Storage can be blocked; start from an example instead.
  }
  return EXAMPLES[0]?.text ?? '{\n  "width": 1080,\n  "height": 1920,\n  "scenes": []\n}'
}

export function MotionStudio() {
  const [text, setText] = useState(loadSaved)
  const [files, setFiles] = useState<Map<string, File>>(new Map())
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  // Errors are tied to the composition they came from, so editing clears them.
  const [failure, setFailure] = useState<{ comp: Composition | null; message: string } | null>(null)
  const [exporting, setExporting] = useState<number | null>(null)
  const [session, setSession] = useState<{ comp: Composition; res: BrowserResources; renderer: Renderer } | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const jsonInput = useRef<HTMLInputElement>(null)
  const drawing = useRef(false)
  const playback = useRef<{ raf: number; audio: AudioContext | null; sources: AudioScheduledSourceNode[] } | null>(null)
  const timeRef = useRef(0)
  useEffect(() => {
    timeRef.current = time
  }, [time])

  // Parse after a short pause in typing.
  const [parsed, setParsed] = useState(() => parseComposition(text))
  useEffect(() => {
    const id = setTimeout(() => setParsed(parseComposition(text)), 300)
    try {
      localStorage.setItem(STORAGE_KEY, text)
    } catch {
      // Not critical.
    }
    return () => clearTimeout(id)
  }, [text])

  const resolve = useCallback(
    (src: string): string | Blob => {
      const dropped = files.get(src) ?? files.get(fileName(src))
      if (dropped) return dropped
      if (/^(https?:|data:|blob:)/.test(src)) return src
      return ASSET_URLS.get(fileName(src)) ?? src
    },
    [files],
  )

  // Load fonts and media whenever the composition changes.
  const comp = parsed.comp
  const missing = useMemo(
    () =>
      Object.values(comp?.assets ?? {})
        .filter((a) => {
          const r = resolve(a.src)
          return typeof r === 'string' && r === a.src && !/^(https?:|data:|blob:)/.test(a.src)
        })
        .map((a) => fileName(a.src)),
    [comp, resolve],
  )
  useEffect(() => {
    if (!comp) return
    let cancelled = false
    BrowserResources.load(comp, resolve, setStatus)
      .then((res) => {
        if (cancelled) {
          void res.dispose()
          return
        }
        const renderer = new Renderer(canvasRef.current!, comp, res, { scale: Math.min(1, 1280 / Math.max(comp.width, comp.height)) })
        setSession((prev) => {
          void prev?.res.dispose()
          return { comp, res, renderer }
        })
        setStatus(null)
      })
      .catch((e) => {
        if (!cancelled) {
          setFailure({ comp, message: e instanceof Error ? e.message : String(e) })
          setStatus(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [comp, resolve])

  const duration = session?.renderer.duration ?? 0

  // One draw at a time; while one runs, only the latest requested time is kept.
  const pending = useRef<number | null>(null)
  const draw = useCallback(
    async (t: number) => {
      if (!session) return
      if (drawing.current) {
        pending.current = t
        return
      }
      drawing.current = true
      try {
        let next: number | null = t
        while (next !== null) {
          pending.current = null
          await session.res.prepare(videoRequests(session.comp, next))
          session.renderer.draw(next)
          next = pending.current
        }
      } finally {
        drawing.current = false
      }
    },
    [session],
  )

  useEffect(() => {
    if (!playing) void draw(Math.min(time, duration))
  }, [draw, time, playing, duration])

  const stop = useCallback(() => {
    const p = playback.current
    if (!p) return
    cancelAnimationFrame(p.raf)
    for (const s of p.sources) s.stop()
    void p.audio?.close()
    playback.current = null
    setPlaying(false)
  }, [])

  const play = useCallback(async () => {
    if (!session || playback.current) return
    const from = timeRef.current >= duration - 0.05 ? 0 : timeRef.current
    const state: { raf: number; audio: AudioContext | null; sources: AudioScheduledSourceNode[] } = { raf: 0, audio: null, sources: [] }
    playback.current = state
    setPlaying(true)
    if (audioMix(session.comp).length) {
      const audio = new AudioContext()
      state.audio = audio
      const buffers = await session.res.audioBuffers(audio)
      if (playback.current !== state) return
      state.sources = scheduleMix(audio, audioMix(session.comp), buffers, from)
    }
    const started = performance.now()
    const tick = () => {
      if (playback.current !== state) return
      const t = from + (performance.now() - started) / 1000
      if (t >= duration) {
        setTime(duration)
        stop()
        return
      }
      setTime(t)
      void draw(t)
      state.raf = requestAnimationFrame(tick)
    }
    state.raf = requestAnimationFrame(tick)
  }, [session, duration, draw, stop])

  useEffect(() => stop, [stop, session])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      if (e.code === 'Space') {
        e.preventDefault()
        if (playback.current) stop()
        else void play()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        stop()
        const fps = session?.renderer.fps ?? 30
        const step = e.shiftKey ? 1 : 1 / fps
        setTime((t) => Math.max(0, Math.min(duration, t + (e.key === 'ArrowLeft' ? -step : step))))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [play, stop, session, duration])

  const addFiles = (list: FileList | File[]) => {
    const jsons = Array.from(list).filter((f) => f.name.endsWith('.json'))
    const media = Array.from(list).filter((f) => !f.name.endsWith('.json'))
    if (media.length)
      setFiles((prev) => {
        const next = new Map(prev)
        for (const f of media) next.set(f.name, f)
        return next
      })
    if (jsons[0]) void jsons[0].text().then(setText)
  }

  const exportMp4 = async () => {
    if (!session) return
    stop()
    setExporting(0)
    try {
      const { blob, extension } = await exportVideo(session.comp, session.res, { onProgress: setExporting })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `motion.${extension}`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
    } catch (e) {
      setFailure({ comp: session.comp, message: `Export non riuscito: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setExporting(null)
      void draw(timeRef.current)
    }
  }

  const downloadJson = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    a.download = 'composizione.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  }

  const scenes = useMemo(() => {
    const list = session?.comp.scenes ?? []
    const starts = sceneStarts(list)
    return list.map((s, i) => ({ start: starts[i], label: s.id ?? `Scena ${i + 1}` }))
  }, [session])

  const issues: Issue[] = parsed.issues
  const loadError = missing.length
    ? `Mancano dei file: ${missing.join(', ')}. Aggiungili con «Aggiungi file» o trascinali qui.`
    : failure && failure.comp === comp
      ? failure.message
      : null

  return (
    <div
      className="studio"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
      }}
    >
      <header className="topbar">
        <div className="brand">
          <span className="logo">✦</span> Motion
          <a className="mode-link" href="#">
            ← Editor
          </a>
        </div>
        <div className="topbar-actions">
          <label className="field-inline">
            Esempio
            <select value="" onChange={(e) => e.target.value && setText(EXAMPLES.find((x) => x.name === e.target.value)!.text)}>
              <option value="">Scegli…</option>
              {EXAMPLES.map((x) => (
                <option key={x.name} value={x.name}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => jsonInput.current?.click()}>Apri JSON</button>
          <button onClick={() => fileInput.current?.click()} title="Immagini, video, audio e font usati dalla composizione">
            Aggiungi file{files.size ? ` (${files.size})` : ''}
          </button>
          <button onClick={downloadJson}>Scarica JSON</button>
          <button className="primary" onClick={exportMp4} disabled={!session || exporting !== null}>
            {exporting === null ? 'Esporta MP4' : `Esportazione… ${Math.round(exporting * 100)}%`}
          </button>
          <input ref={jsonInput} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
        </div>
      </header>

      <section className="code-panel">
        <textarea
          className="code"
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              e.preventDefault()
              const el = e.currentTarget
              const { selectionStart: s, selectionEnd: end } = el
              const next = text.slice(0, s) + '  ' + text.slice(end)
              setText(next)
              requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2))
            }
          }}
        />
        <div className="issues">
          {issues.length === 0 ? (
            <p className="ok">✓ Composizione valida</p>
          ) : (
            issues.map((i, k) => (
              <p key={k} className={i.level}>
                <code>{i.path || 'radice'}</code> {i.message}
              </p>
            ))
          )}
        </div>
      </section>

      <main className="preview">
        {loadError && (
          <div className="error" role="alert">
            {loadError}
          </div>
        )}
        <div className="stage">
          <canvas ref={canvasRef} />
          {status && <div className="stage-empty">{status}</div>}
        </div>
        <div className="transport">
          <button onClick={() => (playing ? stop() : void play())} className="play" disabled={!session} title="Play/Pausa (spazio)">
            {playing ? '⏸' : '▶'}
          </button>
          <span className="timecode">
            {formatTime(time)} / {formatTime(duration)}
          </span>
          <input
            className="scrub"
            type="range"
            min={0}
            max={duration || 1}
            step={1 / (session?.renderer.fps ?? 30)}
            value={time}
            onChange={(e) => {
              stop()
              setTime(Number(e.target.value))
            }}
          />
        </div>
        {scenes.length > 1 && (
          <div className="scene-chips">
            {scenes.map((s) => (
              <button
                key={s.start + s.label}
                onClick={() => {
                  stop()
                  setTime(s.start)
                }}
              >
                {s.label} <span>{formatTime(s.start)}</span>
              </button>
            ))}
          </div>
        )}
      </main>

      {exporting !== null && (
        <div className="overlay">
          <div className="overlay-card">
            <p>Sto creando il video, un fotogramma alla volta…</p>
            <progress value={exporting} max={1} />
            <p className="hint">Puoi continuare a usare il computer: il risultato è identico all'anteprima.</p>
          </div>
        </div>
      )}
    </div>
  )
}
