// Motion studio: write or open a composition JSON, preview it frame-accurately and export it to MP4.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { audioMix, scheduleMix } from '../engine/audio'
import { platformFor } from '../engine/check'
import { exportVideo } from '../engine/export'
import { Renderer, videoRequests } from '../engine/render'
import { BrowserResources } from '../engine/resources'
import type { Composition, Layer } from '../engine/types'
import { sceneStarts } from '../engine/timeline'
import { MediaPanel } from './MediaPanel'
import { hasLibrary, mediaDuration, saveLive, type MediaItem } from './library'
import { parseComposition, type Issue } from '../engine/validate'
import { applyVariant } from '../engine/variants'
import { expandStudioWith } from '../engine/studio'
import { applyBeatGrid } from '../engine/beatgrid'
import { connectLive, saveLiveFile, sendToClaude, uploadLiveFiles, watchLiveFiles, type ClaudeTarget, type LiveUpdate, type ArrowRole, ARROW_ROLES, arrowFor } from './live'
import { StudioTimeline } from './StudioTimeline'

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

/** `live`: follow the composition Claude is editing (when running as a claude.ai Artifact). */
export function MotionStudio({ live = false }: { live?: boolean }) {
  const [text, setText] = useState(loadSaved)
  const [files, setFiles] = useState<Map<string, File>>(new Map())
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [liveState, setLiveState] = useState<{ connected: boolean; note?: string; follow: boolean }>({ connected: false, follow: true })
  const followRef = useRef(true)
  const liveUpdate = useRef<LiveUpdate | null>(null)
  // Claude's arrow on the frame and the last few things it said it was doing.
  // Claude's three arrows (frame, timeline, uploads): what each points at, its note, and when it last moved.
  const [arrows, setArrows] = useState<Record<ArrowRole, { target: ClaudeTarget | null; note?: string; at: number }>>({
    video: { target: null, at: 0 },
    timeline: { target: null, at: 0 },
    media: { target: null, at: 0 },
  })
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!live) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [live])
  const [activity, setActivity] = useState<{ id: number; note: string }[]>([])
  const codeRef = useRef<HTMLTextAreaElement>(null)
  // While watching Claude live, the JSON stays out of the way until asked for.
  const [showCode, setShowCode] = useState(!live)
  // The media library exists on the local dev server only.
  const showLibrary = live && hasLibrary
  const textRef = useRef(text)
  useEffect(() => {
    textRef.current = text
  }, [text])
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

  // The format shown: the comp itself or one of its variants (9:16, 4:5, 1:1, 16:9).
  const [variant, setVariant] = useState('')
  const [guides, setGuides] = useState(true)
  const variantNames = useMemo(() => Object.keys(parsed.comp?.variants ?? {}), [parsed.comp])
  const comp = useMemo(() => {
    const base = parsed.comp
    if (!base || !variant || !base.variants?.[variant]) return base
    return applyVariant(base, variant).comp
  }, [parsed.comp, variant])

  // Where the canvas sits in the stage, for the safe-zone guides drawn over it.
  const [canvasBox, setCanvasBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    const stage = canvas?.parentElement
    if (!canvas || !stage) return
    const measure = () => {
      const c = canvas.getBoundingClientRect()
      const s = stage.getBoundingClientRect()
      setCanvasBox({ left: c.left - s.left, top: c.top - s.top, width: c.width, height: c.height })
    }
    const ro = new ResizeObserver(measure)
    ro.observe(canvas)
    ro.observe(stage)
    measure()
    return () => ro.disconnect()
  }, [])

  // Load fonts and media whenever the composition changes.
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
        // Scene lengths in beats become seconds once the beat times are loaded.
        const timed = expandStudioWith(comp.beats ? applyBeatGrid(comp, res.beats(comp.beats.asset) ?? []) : comp, res)
        const renderer = new Renderer(canvasRef.current!, timed, res, { scale: Math.min(1, 1280 / Math.max(comp.width, comp.height)) })
        setSession((prev) => {
          void prev?.res.dispose()
          return { comp: timed, res, renderer }
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

  // Live: Claude's edits replace the JSON as they arrive, and can jump to the part being changed.
  useEffect(() => {
    if (!live) return
    let unsubscribe: (() => void) | null = null
    let cancelled = false
    void connectLive((u) => {
      liveUpdate.current = u
      setLiveState((s) => ({ ...s, connected: true, note: u.note }))
      if (u.cursor || u.arrows) {
        const at = Date.now()
        setArrows((prev) => {
          const next = { ...prev }
          if (u.cursor) next[arrowFor(u.cursor)] = { target: u.cursor, note: u.note, at }
          for (const role of ARROW_ROLES) {
            const a = u.arrows?.[role]
            if (a) next[role] = { target: a.target, note: a.note ?? u.note, at }
          }
          return next
        })
      }
      if (u.note) {
        const note = u.note
        setActivity((a) => (a[0]?.note === note ? a : [{ id: Date.now(), note }, ...a].slice(0, 6)))
      }
      if (!followRef.current) return
      revealChange(codeRef.current, textRef.current, u.json)
      setText(u.json)
      if (u.time !== undefined) {
        stop()
        setTime(u.time)
      }
    }).then((off) => {
      if (cancelled) off?.()
      else {
        unsubscribe = off
        if (off) setLiveState((s) => ({ ...s, connected: true }))
      }
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [live, stop])

  /**
   * Turns a library item into a clip: a picture or video becomes a new full-frame scene at the scene
   * boundary nearest `at` (the end when left out), a sound joins the audio at `at`. On the local live
   * page the result is saved to live/current.json so Claude continues from it.
   */
  const addMedia = async (item: MediaItem, at?: number) => {
    let comp: Composition
    try {
      comp = JSON.parse(textRef.current) as Composition
    } catch {
      setFailure({ comp: null, message: 'Il JSON ha un errore: correggilo prima di aggiungere clip.' })
      return
    }
    const kind = item.type.split('/')[0] as 'image' | 'video' | 'audio'
    const slug = item.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'media'
    const assets = (comp.assets ??= {})
    const src = location.origin + item.url
    let key = Object.keys(assets).find((k) => assets[k].src === src)
    if (!key) {
      key = slug
      for (let n = 2; assets[key]; n++) key = `${slug}-${n}`
      assets[key] = { type: kind, src }
    }
    const length = kind === 'image' ? 0 : await mediaDuration(item.url, item.type)
    const scenes = (comp.scenes ??= [])
    const starts = sceneStarts(scenes)
    const end = scenes.length ? starts[scenes.length - 1] + scenes[scenes.length - 1].duration : 0
    const time = at ?? end

    let note: string
    let jump = time
    if (kind === 'audio') {
      ;(comp.audio ??= []).push({ asset: key, start: Math.round(time * 100) / 100, ...(length ? { duration: Math.round(length * 100) / 100 } : {}) })
      note = `Tomm ha aggiunto il suono ${item.name}`
    } else {
      const ids = new Set(scenes.map((s) => s.id))
      let id = slug
      for (let n = 2; ids.has(id); n++) id = `${slug}-${n}`
      const duration = kind === 'video' ? Math.round(Math.min(length || 5, 15) * 100) / 100 : 3
      const layer: Layer =
        kind === 'video'
          ? { type: 'video', id: item.name, asset: key }
          : { type: 'image', id: item.name, asset: key, width: comp.width, height: comp.height, fit: 'cover', scale: [{ t: 0, v: 1.08 }, { t: duration, v: 1, ease: 'glide' }] }
      // Before the first scene that is mostly after the drop point.
      let index = scenes.findIndex((s, i) => starts[i] + s.duration / 2 > time)
      if (index < 0) index = scenes.length
      scenes.splice(index, 0, { id, duration, layers: [layer] })
      jump = sceneStarts(scenes)[index] + Math.min(1, duration / 2)
      note = `Tomm ha aggiunto ${item.name}`
    }
    const json = JSON.stringify(comp, null, 2)
    setText(json)
    stop()
    setTime(jump)
    setActivity((a) => [{ id: Date.now(), note }, ...a].slice(0, 6))
    if (live) void saveLive({ json: comp, note, time: jump })
  }

  // Timeline selection, deleting it with Canc, and undo (Ctrl+Z) of those deletions.
  const [selectedClip, setSelectedClip] = useState<string | null>(null)
  const history = useRef<string[]>([])

  /** Replaces the composition text and, on the local live page, saves it for Claude. */
  const commit = (json: string, note: string) => {
    setText(json)
    setActivity((a) => [{ id: Date.now(), note }, ...a].slice(0, 6))
    if (live) {
      try {
        void saveLive({ json: JSON.parse(json), note })
      } catch {
        // Not valid JSON: nothing to save.
      }
    }
  }

  const deleteClip = (key: string) => {
    let comp: Composition
    try {
      comp = JSON.parse(textRef.current) as Composition
    } catch {
      return
    }
    const scenes = comp.scenes ?? []
    let removed: string | undefined
    let m: RegExpExecArray | null
    if ((m = /^scene-(\d+)$/.exec(key))) {
      const [scene] = scenes.splice(Number(m[1]), 1)
      if (scene) {
        removed = `la scena ${scene.id ?? Number(m[1]) + 1}`
        // Sounds cued on that scene go with it.
        if (comp.audio) comp.audio = comp.audio.filter((a) => a.scene === undefined || (a.scene !== scene.id && a.scene !== Number(m![1])))
      }
    } else if ((m = /^s(\d+)-(\d+)$/.exec(key))) {
      const [layer] = scenes[Number(m[1])]?.layers.splice(Number(m[2]), 1) ?? []
      if (layer) removed = layer.id ?? (layer.type === 'text' ? `il testo "${layer.text.replace(/[{}]/g, '')}"` : layer.type)
    } else if ((m = /^top-(\d+)$/.exec(key))) {
      const [layer] = comp.layers?.splice(Number(m[1]), 1) ?? []
      if (layer) removed = layer.id ?? layer.type
    } else if ((m = /^a(\d+)$/.exec(key))) {
      const [clip] = comp.audio?.splice(Number(m[1]), 1) ?? []
      if (clip) removed = `il suono ${clip.sfx ?? clip.asset ?? ''}`.trim()
    }
    if (!removed) return
    history.current.push(textRef.current)
    setSelectedClip(null)
    commit(JSON.stringify(comp, null, 2), `Tomm ha cancellato ${removed} (Ctrl+Z per annullare)`)
  }

  const undo = () => {
    const prev = history.current.pop()
    if (prev !== undefined) commit(prev, 'Tomm ha annullato la cancellazione')
  }

  const setFollow = (follow: boolean) => {
    followRef.current = follow
    setLiveState((s) => ({ ...s, follow }))
    const u = liveUpdate.current
    if (follow && u) setText(u.json)
  }

  const play = useCallback(async () => {
    if (!session || playback.current) return
    const from = timeRef.current >= duration - 0.05 ? 0 : timeRef.current
    const state: { raf: number; audio: AudioContext | null; sources: AudioScheduledSourceNode[] } = { raf: 0, audio: null, sources: [] }
    playback.current = state
    setPlaying(true)
    if (audioMix(session.comp).length) {
      const audio = new AudioContext()
      state.audio = audio
      const mix = audioMix(session.comp)
      const buffers = await session.res.audioBuffers(audio, undefined, mix)
      if (playback.current !== state) return
      state.sources = scheduleMix(audio, mix, buffers, from)
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
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClip) {
        e.preventDefault()
        deleteClip(selectedClip)
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && history.current.length) {
        e.preventDefault()
        undo()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        stop()
        const fps = session?.renderer.fps ?? 30
        const step = e.shiftKey ? 1 : 1 / fps
        setTime((t) => Math.max(0, Math.min(duration, t + (e.key === 'ArrowLeft' ? -step : step))))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Files shared on the live page: fetched once and used like dropped files.
  useEffect(() => {
    if (!live) return
    let off: (() => void) | null = null
    let cancelled = false
    const fetched = new Set<string>()
    void watchLiveFiles((list) => {
      for (const f of list) {
        if (fetched.has(f.id)) continue
        fetched.add(f.id)
        void fetch(f.url)
          .then((r) => r.blob())
          .then((blob) => {
            if (cancelled) return
            setFiles((prev) => new Map(prev).set(f.name, new File([blob], f.name)))
          })
      }
    }).then((unsubscribe) => {
      if (cancelled) unsubscribe?.()
      else off = unsubscribe
    })
    return () => {
      cancelled = true
      off?.()
    }
  }, [live])

  const addFiles = (list: FileList | File[]) => {
    const jsons = Array.from(list).filter((f) => f.name.endsWith('.json'))
    const media = Array.from(list).filter((f) => !f.name.endsWith('.json'))
    if (media.length) {
      setFiles((prev) => {
        const next = new Map(prev)
        for (const f of media) next.set(f.name, f)
        return next
      })
      // On the live page the files are also shared with Claude.
      if (live) {
        setStatus(`Invio ${media.length === 1 ? media[0].name : `${media.length} file`} a Claude…`)
        uploadLiveFiles(media)
          .then(() => setStatus(null))
          .catch((e) => {
            setStatus(null)
            setFailure({ comp, message: `Invio non riuscito: ${e?.message ?? String(e)}` })
          })
      }
    }
    if (jsons[0]) void jsons[0].text().then(setText)
  }

  /** Hands a file to the user: through the Artifact viewer when live, a plain download otherwise. */
  const offerFile = async (filename: string, blob: Blob) => {
    if (live && (await saveLiveFile(filename, blob).catch(() => false))) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  }

  const exportMp4 = async () => {
    if (!session) return
    stop()
    setExporting(0)
    try {
      const { blob, extension } = await exportVideo(session.comp, session.res, { onProgress: setExporting })
      await offerFile(`motion.${extension}`, blob)
    } catch (e) {
      setFailure({ comp: session.comp, message: `Export non riuscito: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setExporting(null)
      void draw(timeRef.current)
    }
  }

  const downloadJson = () => void offerFile('composizione.json', new Blob([text], { type: 'application/json' }))

  // Messages to Claude, tagged with the moment of the video being looked at.
  const stageRef = useRef<HTMLDivElement>(null)
  const [message, setMessage] = useState('')
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'unavailable'>('idle')
  const send = async () => {
    const body = message.trim()
    if (!body || !stageRef.current) return
    setSendState('sending')
    try {
      const ok = await sendToClaude(stageRef.current, `[al secondo ${time.toFixed(1)}] ${body}`)
      setSendState(ok ? 'sent' : 'unavailable')
      if (ok) setMessage('')
    } catch {
      setSendState('unavailable')
    }
  }


  const issues: Issue[] = parsed.issues
  const loadError = missing.length
    ? `Mancano dei file: ${missing.join(', ')}. Aggiungili con «Aggiungi file» o trascinali qui.`
    : failure && failure.comp === comp
      ? failure.message
      : null

  return (
    <div
      className={`studio${showCode ? '' : ' no-code'}${showLibrary ? ' with-library' : ''}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
      }}
    >
      <header className="topbar">
        <div className="brand">
          <span className="logo">✦</span> Motion
          {!live && (
            <a className="mode-link" href="#">
              ← Editor
            </a>
          )}
          {live && (
            <span className={`live-badge${liveState.connected ? ' on' : ''}`} title={liveState.note}>
              <i /> {liveState.connected ? (liveState.note ?? 'In diretta con Claude') : 'In attesa di Claude…'}
            </span>
          )}
        </div>
        <div className="topbar-actions">
          {live && (
            <label className="field-inline" title="Quando è attivo, le modifiche di Claude sostituiscono il JSON">
              <input type="checkbox" checked={liveState.follow} onChange={(e) => setFollow(e.target.checked)} />
              Segui Claude
            </label>
          )}
          {live && <button onClick={() => setShowCode((v) => !v)}>{showCode ? 'Nascondi JSON' : 'Mostra JSON'}</button>}
          {variantNames.length > 0 && (
            <label className="field-inline" title="I formati definiti in &quot;variants&quot;">
              Formato
              <select value={variant} onChange={(e) => setVariant(e.target.value)}>
                <option value="">
                  Originale {parsed.comp ? `${parsed.comp.width}×${parsed.comp.height}` : ''}
                </option>
                {variantNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field-inline" title="Le zone coperte da pulsanti e didascalie della piattaforma">
            <input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} />
            Safe zone
          </label>
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
          ref={codeRef}
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
        <div className="stage" ref={stageRef}>
          <canvas ref={canvasRef} />
          {guides && session && canvasBox && <SafeZone comp={session.comp} box={canvasBox} />}
          {live && activity.length > 0 && (
            <ol className="claude-activity">
              {activity.map((a) => (
                <li key={a.id}>{a.note}</li>
              ))}
            </ol>
          )}
          {status && <div className="stage-empty">{status}</div>}
        </div>
        {/* Messages to Claude go through the claude.ai page; on the local dev server Tomm writes in the chat. */}
        {live && import.meta.env.MODE === 'artifact' && (
          <form
            className="ask"
            onSubmit={(e) => {
              e.preventDefault()
              void send()
            }}
          >
            <input
              value={message}
              onChange={(e) => {
                setMessage(e.target.value)
                if (sendState !== 'sending') setSendState('idle')
              }}
              placeholder={`Scrivi a Claude cosa cambiare (al secondo ${time.toFixed(1)})`}
            />
            <button className="primary" disabled={!message.trim() || sendState === 'sending'}>
              {sendState === 'sending' ? 'Invio…' : 'Invia a Claude'}
            </button>
            {sendState === 'sent' && <span className="ask-note">Inviato ✓ Claude risponde nei commenti.</span>}
            {sendState === 'unavailable' && <span className="ask-note">Non riesco a inviarlo da qui: usa i commenti della pagina.</span>}
          </form>
        )}
      </main>

      <StudioTimeline
        comp={session?.comp ?? null}
        res={session?.res ?? null}
        time={time}
        duration={duration}
        fps={session?.renderer.fps ?? 30}
        playing={playing}
        onSeek={(t) => {
          stop()
          setTime(t)
        }}
        onTogglePlay={() => (playing ? stop() : void play())}
        onDropMedia={showLibrary ? (item, t) => void addMedia(item, t) : undefined}
        selected={selectedClip}
        onSelect={setSelectedClip}
      />

      {showLibrary && <MediaPanel onAdd={(item) => void addMedia(item)} />}

      {live &&
        session &&
        ARROW_ROLES.filter((role) => role !== 'media' || showLibrary).map((role) => (
          <ClaudeCursor
            key={role}
            role={role}
            comp={session.comp}
            canvas={canvasRef}
            at={arrows[role].target}
            note={arrows[role].note}
            active={now - arrows[role].at < 6000}
          />
        ))}

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

/** The platform's covered areas, shaded over the preview, with the safe area outlined. */
/** Scrolls the JSON panel to the first line Claude changed, and selects it so it stands out. */
function revealChange(el: HTMLTextAreaElement | null, before: string, after: string) {
  if (!el || before === after) return
  let i = 0
  while (i < before.length && i < after.length && before[i] === after[i]) i++
  const line = after.slice(0, i).split('\n').length - 1
  const lineStart = after.lastIndexOf('\n', i - 1) + 1
  const lineEnd = after.indexOf('\n', i)
  requestAnimationFrame(() => {
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 18
    el.scrollTop = Math.max(0, line * lh - el.clientHeight / 3)
    el.setSelectionRange(lineStart, lineEnd === -1 ? after.length : lineEnd)
  })
}

const ARROW_STYLE: Record<ArrowRole, { name: string; stops: [string, string, string] }> = {
  video: { name: 'Video', stops: ['#ffd166', '#ff4d6d', '#7c5cff'] },
  timeline: { name: 'Timeline', stops: ['#7df9ff', '#2fb8ff', '#3b5bff'] },
  media: { name: 'Caricamenti', stops: ['#d9ff7a', '#5fd36b', '#13a882'] },
}

/** Where a target is on screen right now, or null when it is not shown. */
function locate(target: ClaudeTarget, comp: Composition, canvas: HTMLCanvasElement | null): { left: number; top: number } | null {
  if ('clip' in target || 'media' in target) {
    const key = 'clip' in target ? target.clip : `media:${target.media}`
    const el = document.querySelector(`[data-claude="${CSS.escape(key)}"]`)
    if (!el) return null
    const r = el.getBoundingClientRect()
    const edge = 'clip' in target ? target.edge : undefined
    const left = edge === 'start' ? r.left : edge === 'end' ? r.right : r.left + Math.min(r.width / 2, 60)
    return { left: left - 3, top: r.top + Math.min(r.height / 2, 60) - 2 }
  }
  if (!canvas) return null
  const r = canvas.getBoundingClientRect()
  return { left: r.left + (target.x / comp.width) * r.width, top: r.top + (target.y / comp.height) * r.height }
}

/** Where an arrow waits when it has nothing to do: at the edge of its own area, always visible. */
function parking(role: ArrowRole, canvas: HTMLCanvasElement | null): { left: number; top: number } | null {
  const el = role === 'video' ? canvas : document.querySelector(role === 'timeline' ? '.tl-toolbar' : '.mp-head')
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (role === 'video') return { left: r.right - 30, top: r.top + 24 }
  if (role === 'timeline') return { left: r.left + 230, top: r.top + 10 }
  return { left: r.left + 130, top: r.top + 12 }
}

/**
 * One of Claude's arrows: it glides to what Claude is working on in its area (the frame, the
 * timeline, or the uploads), says what it is doing, and waits at the edge of its area otherwise.
 */
function ClaudeCursor({ role, comp, canvas, at, note, active }: { role: ArrowRole; comp: Composition; canvas: RefObject<HTMLCanvasElement | null>; at: ClaudeTarget | null; note?: string; active: boolean }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  // A clip or file it points at is brought into view once (as soon as it exists on the page),
  // then followed as the layout moves.
  const scrolledFor = useRef<ClaudeTarget | null>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      if (at && at !== scrolledFor.current && ('clip' in at || 'media' in at)) {
        const key = 'clip' in at ? at.clip : `media:${at.media}`
        const el = document.querySelector(`[data-claude="${CSS.escape(key)}"]`)
        if (el) {
          el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
          scrolledFor.current = at
        }
      }
      const p = (at && locate(at, comp, canvas.current)) ?? parking(role, canvas.current)
      setPos((prev) => (prev && p && Math.abs(prev.left - p.left) < 0.5 && Math.abs(prev.top - p.top) < 0.5 ? prev : p))
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [at, comp, canvas, role])
  if (!pos) return null
  const style = ARROW_STYLE[role]
  const gradient = `claude-cursor-${role}`
  return (
    <div
      className={`claude-cursor role-${role}${active ? ' active' : ' idle'}${pos.left > window.innerWidth - 340 ? ' flip' : ''}${pos.top > window.innerHeight - 70 ? ' up' : ''}`}
      style={pos}
    >
      <svg width="34" height="40" viewBox="0 0 34 40" aria-hidden>
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={style.stops[0]} />
            <stop offset="0.5" stopColor={style.stops[1]} />
            <stop offset="1" stopColor={style.stops[2]} />
          </linearGradient>
        </defs>
        <path d="M2 2 L30 20 L17 22 L11 37 Z" fill={`url(#${gradient})`} stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <span className="claude-cursor-label" style={{ background: `linear-gradient(90deg, ${style.stops[1]}, ${style.stops[2]})` }}>
        {style.name}
        {active && note ? ` · ${note}` : ''}
      </span>
    </div>
  )
}
function SafeZone({ comp, box }: { comp: Composition; box: { left: number; top: number; width: number; height: number } }) {
  const p = platformFor(comp)
  const [l, t, r, b] = p.safe
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`
  const shades: [number, number, number, number][] = [
    [0, 0, 1, t],
    [0, b, 1, 1],
    [0, t, l, b],
    [r, t, 1, b],
    ...(p.blocked ?? []),
  ]
  return (
    <div className="safe-zone" style={{ left: box.left, top: box.top, width: box.width, height: box.height }} title={`Safe zone: ${p.name} (${p.source})`}>
      {shades.map(([x0, y0, x1, y1], i) => (
        <div key={i} className="safe-shade" style={{ left: pct(x0), top: pct(y0), width: pct(x1 - x0), height: pct(y1 - y0) }} />
      ))}
      <div className="safe-frame" style={{ left: pct(l), top: pct(t), width: pct(r - l), height: pct(b - t) }} />
      <span className="safe-label">{p.name}</span>
    </div>
  )
}
