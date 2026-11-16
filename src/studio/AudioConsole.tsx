// The audio console: a desk-style mixer next to the timeline. One strip per sound (A1, A2… for the
// audio entries, V1… for video sound), a bus per role and the master, each with EQ, compressor,
// sends, pan, mute/solo, a fader and a live meter. The left panel shows everything about the
// selected strip. Changes play at once; releasing a control writes it into the composition JSON.

import { memo, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { BUSES, BUS_NAME, SILENT_DB, dbToGain, mixerChannels, type MixerChannel, type MixerSettings } from '../engine/mixer'
import type { ChannelSettings, Composition, MixBus } from '../engine/types'

export interface ConsoleLevels {
  levels: Record<string, [number, number]>
  reduction: Record<string, number>
}

type StripId = string // channel id, "bus:<name>" or "master"

const BUS_COLOR: Record<MixBus | 'master', string> = { music: '#3fb4ff', voice: '#ff9f43', sfx: '#b689ff', video: '#3ddc97', master: '#ff5a76' }

// ---------- value helpers ----------

const MAX_DB = 12
/** Fader travel 0..1 for a level in dB, with the usual desk feel: fine near 0 dB, compressed at the bottom. */
const faderPos = (db: number) => (db <= SILENT_DB ? 0 : Math.min(1, (dbToGain(db) / dbToGain(MAX_DB)) ** 0.25))
const faderDb = (pos: number) => {
  if (pos <= 0.001) return SILENT_DB
  const db = 20 * Math.log10(pos ** 4 * dbToGain(MAX_DB))
  return db <= SILENT_DB ? SILENT_DB : Math.min(MAX_DB, db)
}
const fmtDb = (db: number) => (db <= SILENT_DB ? '−∞' : `${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(db).toFixed(1)}`)
const fmtPan = (p: number) => (Math.abs(p) < 0.005 ? 'C' : `${p < 0 ? 'L' : 'R'}${Math.round(Math.abs(p) * 100)}`)
const fmtHz = (hz: number) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)}k` : `${Math.round(hz)}`)
/** Meter scale: -60..+6 dBFS. */
const meterPos = (lin: number) => (lin <= 0.001 ? 0 : Math.max(0, Math.min(1, (20 * Math.log10(lin) + 60) / 66)))

const eqActive = (s: ChannelSettings) => !!s.eq && !s.eq.bypass && ['low', 'mid', 'high', 'lowCut', 'highCut'].some((k) => (s.eq as Record<string, number>)[k])
const dynActive = (s: ChannelSettings) => !!s.dynamics && !s.dynamics.bypass

function getStrip(m: MixerSettings, id: StripId): ChannelSettings {
  if (id === 'master') return m.master
  if (id.startsWith('bus:')) return m.buses[id.slice(4) as MixBus] ?? {}
  return m.channels[id] ?? {}
}

function setStrip(m: MixerSettings, id: StripId, s: ChannelSettings): MixerSettings {
  if (id === 'master') return { ...m, master: s }
  if (id.startsWith('bus:')) return { ...m, buses: { ...m.buses, [id.slice(4)]: s } }
  return { ...m, channels: { ...m.channels, [id]: s } }
}

// ---------- controls ----------

/** A rotary knob: drag up/down (Shift for fine), wheel, double-click to reset. */
function Knob({
  value,
  min,
  max,
  def,
  onChange,
  size = 30,
  label,
  format,
  log,
  color = '#cfd3ff',
  title,
}: {
  value: number
  min: number
  max: number
  def: number
  onChange: (v: number, final: boolean) => void
  size?: number
  label?: string
  format?: (v: number) => string
  log?: boolean
  color?: string
  title?: string
}) {
  const toNorm = (v: number) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min))
  const fromNorm = (n: number) => {
    const c = Math.max(0, Math.min(1, n))
    return log ? min * (max / min) ** c : min + c * (max - min)
  }
  const drag = useRef<{ y: number; n: number; last: number; start: number } | null>(null)
  const n = Math.max(0, Math.min(1, toNorm(value)))
  const a0 = -135
  const angle = a0 + n * 270
  const r = size / 2 - 3
  const c = size / 2
  const pt = (deg: number, rr = r) => [c + rr * Math.sin((deg * Math.PI) / 180), c - rr * Math.cos((deg * Math.PI) / 180)]
  const arc = (from: number, to: number) => {
    const [x0, y0] = pt(from)
    const [x1, y1] = pt(to)
    return `M${x0} ${y0} A${r} ${r} 0 ${Math.abs(to - from) > 180 ? 1 : 0} ${to > from ? 1 : 0} ${x1} ${y1}`
  }
  // Bipolar knobs (pan, EQ gain) light up from the centre.
  const zero = min < 0 && max > 0 && !log ? a0 + toNorm(0) * 270 : a0
  const [px, py] = pt(angle, r - 4)
  return (
    <div className="ac-knob" title={title ?? label}>
      <svg
        width={size}
        height={size}
        onPointerDown={(e) => {
          e.preventDefault()
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { y: e.clientY, n, last: value, start: value }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const v = fromNorm(d.n + ((d.y - e.clientY) / 160) * (e.shiftKey ? 0.2 : 1))
          d.last = v
          onChange(v, false)
        }}
        onPointerUp={() => {
          const d = drag.current
          drag.current = null
          if (d && d.last !== d.start) onChange(d.last, true)
        }}
        onDoubleClick={() => onChange(def, true)}
        onWheel={(e) => onChange(fromNorm(n - Math.sign(e.deltaY) * 0.02), true)}
      >
        <circle cx={c} cy={c} r={r} className="ac-knob-body" />
        <path d={arc(a0, a0 + 270)} className="ac-knob-track" />
        {Math.abs(angle - zero) > 0.5 && <path d={arc(Math.min(zero, angle), Math.max(zero, angle))} stroke={color} className="ac-knob-value" />}
        <line x1={c} y1={c} x2={px} y2={py} className="ac-knob-needle" />
      </svg>
      {(label || format) && (
        <span className="ac-knob-label">
          {label && <b>{label}</b>}
          {format && <span>{format(value)}</span>}
        </span>
      )}
    </div>
  )
}

/** The fader: drag the cap (Shift for fine), wheel for ±0.5 dB, double-click for 0 dB. */
function Fader({ db, onChange, color }: { db: number; onChange: (db: number, final: boolean) => void; color: string }) {
  const track = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; pos: number; last: number; start: number } | null>(null)
  const pos = faderPos(db)
  const marks = [12, 6, 0, -6, -12, -20, -30, -40, -60]
  const start = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const el = track.current
    if (!el) return
    e.currentTarget.setPointerCapture(e.pointerId)
    let p = pos
    // Pressing the slot (not the cap) jumps there first.
    if (!(e.target as HTMLElement).classList.contains('ac-fader-cap')) {
      const r = el.getBoundingClientRect()
      p = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height))
      onChange(faderDb(p), false)
    }
    drag.current = { y: e.clientY, pos: p, last: faderDb(p), start: db }
  }
  return (
    <div className="ac-fader" onDoubleClick={() => onChange(0, true)} onWheel={(e) => onChange(Math.max(SILENT_DB, Math.min(MAX_DB, (db <= SILENT_DB ? -40 : db) - Math.sign(e.deltaY) * 0.5)), true)}>
      <div className="ac-scale">
        {marks.map((m) => (
          <span key={m} style={{ bottom: `${faderPos(m) * 100}%` }}>
            {m > 0 ? `+${m}` : m === -60 ? '∞' : m}
          </span>
        ))}
      </div>
      <div
        className="ac-fader-slot"
        ref={track}
        onPointerDown={start}
        onPointerMove={(e) => {
          const d = drag.current
          const el = track.current
          if (!d || !el) return
          const h = el.getBoundingClientRect().height
          const p = Math.max(0, Math.min(1, d.pos + ((d.y - e.clientY) / h) * (e.shiftKey ? 0.2 : 1)))
          d.last = faderDb(p)
          onChange(d.last, false)
        }}
        onPointerUp={() => {
          const d = drag.current
          drag.current = null
          if (d && d.last !== d.start) onChange(d.last, true)
        }}
      >
        <i className="ac-fader-zero" style={{ bottom: `${faderPos(0) * 100}%` }} />
        <div className="ac-fader-cap" style={{ bottom: `calc(${pos * 100}% - 9px)`, ['--cap' as string]: color }} />
      </div>
    </div>
  )
}

/** Stereo meter; the console's animation loop writes into it directly (no React renders). */
function Meter({ id, register }: { id: string; register: (id: string, el: HTMLElement | null) => void }) {
  return (
    <div className="ac-meter" ref={(el) => register(id, el)}>
      <div className="ac-meter-bar">
        <i />
        <b />
      </div>
      <div className="ac-meter-bar">
        <i />
        <b />
      </div>
    </div>
  )
}

/** A frequency-response curve of the strip's EQ, drawn with the browser's own filters. */
let eqCtx: OfflineAudioContext | null = null
function eqCurve(s: ChannelSettings, width: number, height: number): string {
  try {
    eqCtx ??= new OfflineAudioContext(1, 1, 48000)
  } catch {
    return ''
  }
  const ctx = eqCtx
  const eq = s.eq && !s.eq.bypass ? s.eq : {}
  const n = 96
  const freqs = new Float32Array(n)
  for (let i = 0; i < n; i++) freqs[i] = 20 * 1000 ** (i / (n - 1))
  const total = new Float32Array(n).fill(1)
  const mag = new Float32Array(n)
  const phase = new Float32Array(n)
  const add = (type: BiquadFilterType, f: number, gain = 0, q = 0.707) => {
    const b = ctx.createBiquadFilter()
    b.type = type
    b.frequency.value = f
    b.gain.value = gain
    b.Q.value = q
    b.getFrequencyResponse(freqs, mag, phase)
    for (let i = 0; i < n; i++) total[i] *= mag[i]
  }
  if (eq.lowCut) add('highpass', eq.lowCut)
  if (eq.highCut) add('lowpass', eq.highCut)
  add('lowshelf', 100, eq.low ?? 0)
  add('peaking', eq.midFreq ?? 1000, eq.mid ?? 0, 0.9)
  add('highshelf', 8000, eq.high ?? 0)
  let d = ''
  for (let i = 0; i < n; i++) {
    const db = Math.max(-18, Math.min(18, 20 * Math.log10(Math.max(1e-5, total[i]))))
    const x = (i / (n - 1)) * width
    const y = height / 2 - (db / 18) * (height / 2 - 2)
    d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
  }
  return d
}

function EqGraph({ s, color, onToggle }: { s: ChannelSettings; color: string; onToggle?: () => void }) {
  const w = 220
  const h = 76
  const d = useMemo(() => eqCurve(s, w, h), [s])
  const grid = [100, 1000, 10000].map((f) => (Math.log10(f / 20) / 3) * w)
  return (
    <svg className={`ac-eq-graph${eqActive(s) ? '' : ' flat'}`} viewBox={`0 0 ${w} ${h}`} onClick={onToggle}>
      {grid.map((x) => (
        <line key={x} x1={x} x2={x} y1={0} y2={h} />
      ))}
      <line x1={0} x2={w} y1={h / 2} y2={h / 2} />
      {d && <path d={`${d} L${w} ${h} L0 ${h} Z`} fill={color} opacity={0.14} stroke="none" />}
      {d && <path d={d} stroke={color} fill="none" strokeWidth={2} />}
      <text x={grid[0] + 3} y={h - 4}>100</text>
      <text x={grid[1] + 3} y={h - 4}>1k</text>
      <text x={grid[2] + 3} y={h - 4}>10k</text>
    </svg>
  )
}

// ---------- strips ----------

interface StripProps {
  id: StripId
  short: string
  label: string
  color: string
  s: ChannelSettings
  selected: boolean
  off?: boolean
  master?: boolean
  onSelect: (id: StripId) => void
  onChange: (id: StripId, s: ChannelSettings, final: boolean) => void
  register: (id: string, el: HTMLElement | null) => void
}

const Strip = memo(function Strip({ id, short, label, color, s, selected, off, master, onSelect, onChange, register }: StripProps) {
  const set = (patch: Partial<ChannelSettings>, final: boolean) => onChange(id, { ...s, ...patch }, final)
  return (
    <div
      className={`ac-strip${selected ? ' selected' : ''}${master ? ' master' : ''}${off ? ' off' : ''}`}
      data-claude={`channel:${id}`}
      style={{ ['--strip' as string]: color }}
      onPointerDown={() => onSelect(id)}
      title={off ? `${label}: muto nella composizione (muted)` : label}
    >
      <div className="ac-strip-name">
        <b>{short}</b>
        <span>{label}</span>
      </div>
      <div className="ac-fx">
        <button className={eqActive(s) ? 'on' : ''} title="Equalizzatore (dettagli a sinistra)" onClick={() => onSelect(id)}>
          EQ
        </button>
        <button
          className={dynActive(s) ? 'on' : ''}
          title="Compressore: clic per accenderlo o spegnerlo"
          onClick={() => set({ dynamics: s.dynamics ? { ...s.dynamics, bypass: !s.dynamics.bypass || undefined } : { threshold: -24, ratio: 4 } }, true)}
        >
          DYN
        </button>
      </div>
      <div className="ac-sends">
        <Knob size={22} value={s.reverb ?? 0} min={0} max={1} def={0} onChange={(v, f) => set({ reverb: v }, f)} title={`Mandata riverbero ${Math.round((s.reverb ?? 0) * 100)}%`} color="#7dd3fc" />
        <Knob size={22} value={s.delay ?? 0} min={0} max={1} def={0} onChange={(v, f) => set({ delay: v }, f)} title={`Mandata eco ${Math.round((s.delay ?? 0) * 100)}%`} color="#fcd34d" />
      </div>
      <div className="ac-sends-label">
        <span>REV</span>
        <span>ECO</span>
      </div>
      <Knob size={30} value={s.pan ?? 0} min={-1} max={1} def={0} onChange={(v, f) => set({ pan: v }, f)} format={fmtPan} title="Pan (doppio clic: centro)" color={color} />
      <div className="ac-ms">
        <button className={`mute${s.mute ? ' on' : ''}`} title="Muto" onClick={() => set({ mute: !s.mute || undefined }, true)}>
          M
        </button>
        {!master && (
          <button className={`solo${s.solo ? ' on' : ''}`} title="Solo" onClick={() => set({ solo: !s.solo || undefined }, true)}>
            S
          </button>
        )}
      </div>
      <div className="ac-fader-row">
        <Fader db={s.gain ?? 0} color={color} onChange={(db, f) => set({ gain: db }, f)} />
        <Meter id={id} register={register} />
      </div>
      <div className="ac-db">{fmtDb(s.gain ?? 0)}</div>
    </div>
  )
})

// ---------- the console ----------

export function AudioConsole({
  comp,
  mixer,
  onDraft,
  onCommit,
  onEdit,
  getLevels,
  selected,
  onSelect,
}: {
  comp: Composition | null
  mixer: MixerSettings
  onDraft: (m: MixerSettings) => void
  onCommit: (m: MixerSettings, note: string) => void
  /** Changes outside the console's strips (clip role and fades, loudness, ducking). */
  onEdit: (edit: (c: Composition) => void, note: string) => void
  getLevels: () => ConsoleLevels | null
  selected: StripId | null
  onSelect: (id: StripId) => void
}) {
  const channels = useMemo(() => (comp ? mixerChannels(comp) : []), [comp])
  const usedBuses = useMemo(() => BUSES.filter((b) => channels.some((c) => c.bus === b)), [channels])
  const mixerRef = useRef(mixer)
  useEffect(() => {
    mixerRef.current = mixer
  }, [mixer])

  const names = useMemo(() => {
    const m = new Map<StripId, string>()
    for (const c of channels) m.set(c.id, `${c.short} (${c.label})`)
    for (const b of BUSES) m.set(`bus:${b}`, `il bus ${BUS_NAME[b]}`)
    m.set('master', 'il master')
    return m
  }, [channels])

  const change = useMemo(
    () => (id: StripId, s: ChannelSettings, final: boolean) => {
      const next = setStrip(mixerRef.current, id, s)
      mixerRef.current = next
      if (final) onCommit(next, `Tomm ha regolato ${names.get(id) ?? id} nella console audio`)
      else onDraft(next)
    },
    [onCommit, onDraft, names],
  )

  // Meters: one animation loop for every strip, writing straight into the DOM.
  const meters = useRef(new Map<string, { el: HTMLElement; hold: [number, number]; at: [number, number]; shown: [number, number] }>())
  const register = useMemo(
    () => (id: string, el: HTMLElement | null) => {
      if (el) meters.current.set(id, { el, hold: [0, 0], at: [0, 0], shown: [0, 0] })
      else meters.current.delete(id)
    },
    [],
  )
  const [gr, setGr] = useState<Record<string, number>>({})
  const getLevelsRef = useRef(getLevels)
  useEffect(() => {
    getLevelsRef.current = getLevels
  })
  useEffect(() => {
    let raf = 0
    let frame = 0
    const tick = () => {
      const data = getLevelsRef.current()
      const now = performance.now()
      for (const [id, m] of meters.current) {
        const lv = data?.levels[id] ?? [0, 0]
        const bars = m.el.children
        for (let ch = 0; ch < 2; ch++) {
          const target = meterPos(lv[ch])
          // Fast attack, slow fall, like a desk's peak meter.
          m.shown[ch] = target > m.shown[ch] ? target : Math.max(target, m.shown[ch] - 0.012)
          if (m.shown[ch] >= m.hold[ch] || now - m.at[ch] > 1200) {
            m.hold[ch] = m.shown[ch]
            m.at[ch] = now
          }
          const bar = bars[ch] as HTMLElement
          ;(bar.children[0] as HTMLElement).style.clipPath = `inset(${(1 - m.shown[ch]) * 100}% 0 0 0)`
          const peak = bar.children[1] as HTMLElement
          peak.style.bottom = `${m.hold[ch] * 100}%`
          peak.style.opacity = m.hold[ch] > 0.01 ? '1' : '0'
          peak.classList.toggle('clip', m.hold[ch] > meterPos(1) - 0.001)
        }
      }
      if (++frame % 10 === 0) setGr((prev) => (JSON.stringify(prev) === JSON.stringify(data?.reduction ?? {}) ? prev : (data?.reduction ?? {})))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const sel: StripId = selected && (selected === 'master' || selected.startsWith('bus:') || channels.some((c) => c.id === selected)) ? selected : (channels[0]?.id ?? 'master')

  const stripsOf = (list: MixerChannel[]) =>
    list.map((c) => (
      <Strip
        key={c.id}
        id={c.id}
        short={c.short}
        label={c.label}
        color={BUS_COLOR[c.bus]}
        s={getStrip(mixer, c.id)}
        selected={sel === c.id}
        off={c.off}
        onSelect={onSelect}
        onChange={change}
        register={register}
      />
    ))

  return (
    <section className="ac">
      <header className="ac-head">
        <span className="ac-title">🎚 Console audio</span>
        <span className="ac-legend">
          {usedBuses.map((b) => (
            <span key={b}>
              <i style={{ background: BUS_COLOR[b] }} />
              {BUS_NAME[b]}
            </span>
          ))}
        </span>
        <span className="ac-hint">Trascina fader e manopole · Shift = fine · doppio clic = reset</span>
      </header>
      <div className="ac-body">
        <Detail
          id={sel}
          channel={channels.find((c) => c.id === sel)}
          comp={comp}
          s={getStrip(mixer, sel)}
          mixer={mixer}
          gr={gr[sel]}
          onChange={change}
          onCommit={onCommit}
          onDraft={onDraft}
          onEdit={onEdit}
        />
        <div className="ac-strips">
          {channels.length === 0 && <p className="ac-empty">Nessun suono ancora: aggiungi musica, voce o effetti e appariranno qui.</p>}
          {stripsOf(channels)}
        </div>
        <div className="ac-buses">
          {usedBuses.map((b) => (
            <Strip
              key={b}
              id={`bus:${b}`}
              short="BUS"
              label={BUS_NAME[b]}
              color={BUS_COLOR[b]}
              s={getStrip(mixer, `bus:${b}`)}
              selected={sel === `bus:${b}`}
              onSelect={onSelect}
              onChange={change}
              register={register}
            />
          ))}
          <Strip id="master" short="MAIN" label="Master" color={BUS_COLOR.master} s={mixer.master} selected={sel === 'master'} master onSelect={onSelect} onChange={change} register={register} />
        </div>
      </div>
    </section>
  )
}

// ---------- the detail panel ----------

function Section({ title, on, onToggle, children }: { title: string; on?: boolean; onToggle?: () => void; children: ReactNode }) {
  return (
    <div className="ac-section">
      <div className="ac-section-head">
        <span>{title}</span>
        {onToggle && (
          <button className={`ac-power${on ? ' on' : ''}`} onClick={onToggle} title={on ? 'Spegni' : 'Accendi'}>
            ⏻
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

const LOW_CUTS = [0, 40, 80, 120, 200]
const HIGH_CUTS = [0, 16000, 12000, 8000, 5000]
const LOUDNESS = [
  { v: -14, label: '−14 LUFS (Instagram, TikTok, YouTube)' },
  { v: -16, label: '−16 LUFS (podcast)' },
  { v: -23, label: '−23 LUFS (TV)' },
  { v: false as const, label: 'Nessuna normalizzazione' },
]

function Detail({
  id,
  channel,
  comp,
  s,
  mixer,
  gr,
  onChange,
  onCommit,
  onDraft,
  onEdit,
}: {
  id: StripId
  channel?: MixerChannel
  comp: Composition | null
  s: ChannelSettings
  mixer: MixerSettings
  gr?: number
  onChange: (id: StripId, s: ChannelSettings, final: boolean) => void
  onCommit: (m: MixerSettings, note: string) => void
  onDraft: (m: MixerSettings) => void
  onEdit: (edit: (c: Composition) => void, note: string) => void
}) {
  const bus: MixBus | 'master' = id === 'master' ? 'master' : id.startsWith('bus:') ? (id.slice(4) as MixBus) : (channel?.bus ?? 'music')
  const color = BUS_COLOR[bus]
  const eq = s.eq ?? {}
  const dyn = s.dynamics ?? {}
  const setEq = (patch: Partial<NonNullable<ChannelSettings['eq']>>, final: boolean) => onChange(id, { ...s, eq: { ...eq, ...patch } }, final)
  const setDyn = (patch: Partial<NonNullable<ChannelSettings['dynamics']>>, final: boolean) => onChange(id, { ...s, dynamics: { threshold: -24, ratio: 4, ...dyn, ...patch } }, final)
  const title = id === 'master' ? 'Master' : id.startsWith('bus:') ? `Bus ${BUS_NAME[bus as MixBus]}` : `${channel?.short} · ${channel?.label}`
  const clipIndex = /^a(\d+)$/.exec(id)
  const clip = clipIndex ? comp?.audio?.[Number(clipIndex[1])] : undefined
  const fx = mixer.fx
  const setFx = (patch: Partial<MixerSettings['fx']>, final: boolean) => {
    const next = { ...mixer, fx: { ...fx, ...patch } }
    if (final) onCommit(next, 'Tomm ha regolato gli effetti della console audio')
    else onDraft(next)
  }
  const fxShown = fx

  return (
    <aside className="ac-detail" style={{ ['--strip' as string]: color }}>
      <div className="ac-detail-title">
        <i />
        <b>{title}</b>
        {id !== 'master' && !id.startsWith('bus:') && <span>→ {BUS_NAME[bus as MixBus]}</span>}
        <button
          className="ac-reset"
          title="Riporta la striscia ai valori iniziali"
          onClick={() => onChange(id, {}, true)}
        >
          Reset
        </button>
      </div>

      <Section
        title="Equalizzatore"
        on={!eq.bypass && eqActive(s)}
        onToggle={() => setEq({ bypass: !eq.bypass || undefined }, true)}
      >
        <EqGraph s={s} color={color} />
        <div className="ac-knobs">
          <Knob value={eq.low ?? 0} min={-15} max={15} def={0} label="Bassi" format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`} onChange={(v, f) => setEq({ low: v }, f)} color={color} />
          <Knob value={eq.mid ?? 0} min={-15} max={15} def={0} label="Medi" format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`} onChange={(v, f) => setEq({ mid: v }, f)} color={color} />
          <Knob value={eq.midFreq ?? 1000} min={150} max={6000} def={1000} log label="Freq" format={fmtHz} onChange={(v, f) => setEq({ midFreq: v }, f)} color={color} />
          <Knob value={eq.high ?? 0} min={-15} max={15} def={0} label="Alti" format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`} onChange={(v, f) => setEq({ high: v }, f)} color={color} />
        </div>
        <div className="ac-row">
          <label>
            Taglio bassi
            <select value={eq.lowCut ?? 0} onChange={(e) => setEq({ lowCut: Number(e.target.value) || undefined }, true)}>
              {LOW_CUTS.map((f) => (
                <option key={f} value={f}>
                  {f ? `${f} Hz` : 'Spento'}
                </option>
              ))}
            </select>
          </label>
          <label>
            Taglio alti
            <select value={eq.highCut ?? 0} onChange={(e) => setEq({ highCut: Number(e.target.value) || undefined }, true)}>
              {HIGH_CUTS.map((f) => (
                <option key={f} value={f}>
                  {f ? `${fmtHz(f)} Hz` : 'Spento'}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Section>

      <Section
        title={`Compressore${gr !== undefined && gr < -0.5 ? ` · GR ${gr.toFixed(1)} dB` : ''}`}
        on={dynActive(s)}
        onToggle={() => onChange(id, { ...s, dynamics: s.dynamics ? { ...s.dynamics, bypass: !s.dynamics.bypass || undefined } : { threshold: -24, ratio: 4 } }, true)}
      >
        <div className="ac-knobs">
          <Knob value={dyn.threshold ?? -24} min={-60} max={0} def={-24} label="Soglia" format={(v) => v.toFixed(0)} onChange={(v, f) => setDyn({ threshold: v }, f)} color={color} />
          <Knob value={dyn.ratio ?? 4} min={1} max={20} def={4} log label="Rapporto" format={(v) => `${v.toFixed(1)}:1`} onChange={(v, f) => setDyn({ ratio: v }, f)} color={color} />
          <Knob value={(dyn.attack ?? 0.01) * 1000} min={1} max={200} def={10} log label="Attacco" format={(v) => `${v.toFixed(0)}ms`} onChange={(v, f) => setDyn({ attack: v / 1000 }, f)} color={color} />
          <Knob value={(dyn.release ?? 0.25) * 1000} min={20} max={1000} def={250} log label="Rilascio" format={(v) => `${v.toFixed(0)}ms`} onChange={(v, f) => setDyn({ release: v / 1000 }, f)} color={color} />
          <Knob value={dyn.makeup ?? 0} min={0} max={18} def={0} label="Guadagno" format={(v) => `+${v.toFixed(1)}`} onChange={(v, f) => setDyn({ makeup: v }, f)} color={color} />
        </div>
      </Section>

      <Section title="Mandate effetti">
        <div className="ac-knobs">
          <Knob value={s.reverb ?? 0} min={0} max={1} def={0} label="Riverbero" format={(v) => `${Math.round(v * 100)}%`} onChange={(v, f) => onChange(id, { ...s, reverb: v }, f)} color="#7dd3fc" />
          <Knob value={s.delay ?? 0} min={0} max={1} def={0} label="Eco" format={(v) => `${Math.round(v * 100)}%`} onChange={(v, f) => onChange(id, { ...s, delay: v }, f)} color="#fcd34d" />
          <Knob value={s.pan ?? 0} min={-1} max={1} def={0} label="Pan" format={fmtPan} onChange={(v, f) => onChange(id, { ...s, pan: v }, f)} color={color} />
        </div>
      </Section>

      {clip && clipIndex && (
        <Section title="Clip">
          <div className="ac-row">
            <label>
              Ruolo
              <select
                value={clip.role ?? (clip.sfx ? 'sfx' : 'music')}
                onChange={(e) => {
                  const role = e.target.value as 'music' | 'voice' | 'sfx'
                  onEdit((c) => {
                    const a = c.audio?.[Number(clipIndex[1])]
                    if (a) a.role = role
                  }, `Tomm ha spostato ${channel?.short} sul bus ${BUS_NAME[role]}`)
                }}
              >
                <option value="music">Musica</option>
                <option value="voice">Voce</option>
                <option value="sfx">Effetti</option>
              </select>
            </label>
            <NumberField label="Fade in (s)" value={clip.fadeIn ?? 0} onCommit={(v) => onEdit((c) => setClipField(c, Number(clipIndex[1]), 'fadeIn', v), `Tomm ha cambiato il fade in di ${channel?.short}`)} />
            <NumberField label="Fade out (s)" value={clip.fadeOut ?? 0} onCommit={(v) => onEdit((c) => setClipField(c, Number(clipIndex[1]), 'fadeOut', v), `Tomm ha cambiato il fade out di ${channel?.short}`)} />
          </div>
        </Section>
      )}

      {id === 'master' && (
        <>
          <Section title="Uscita">
            <div className="ac-row">
              <label className="ac-check">
                <input type="checkbox" checked={!!s.limiter} onChange={(e) => onChange(id, { ...s, limiter: e.target.checked || undefined }, true)} />
                Limitatore (−1 dB)
              </label>
              <label>
                Volume finale
                <select
                  value={String(comp?.mix?.loudness ?? -14)}
                  onChange={(e) => {
                    const v = e.target.value === 'false' ? false : Number(e.target.value)
                    onEdit((c) => {
                      ;(c.mix ??= {}).loudness = v
                    }, 'Tomm ha cambiato il volume finale del video')
                  }}
                >
                  {LOUDNESS.map((l) => (
                    <option key={String(l.v)} value={String(l.v)}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="ac-row">
              <label className="ac-check">
                <input
                  type="checkbox"
                  checked={comp?.mix?.duck !== false}
                  onChange={(e) =>
                    onEdit((c) => {
                      const mix = (c.mix ??= {})
                      if (e.target.checked) delete mix.duck
                      else mix.duck = false
                    }, e.target.checked ? 'Tomm ha acceso il ducking' : 'Tomm ha spento il ducking')
                  }
                />
                Musica più bassa quando parla la voce
              </label>
              {comp?.mix?.duck !== false && (
                <NumberField
                  label="di (dB)"
                  value={(comp?.mix?.duck || {}).amount ?? -12}
                  onCommit={(v) =>
                    onEdit((c) => {
                      const mix = (c.mix ??= {})
                      mix.duck = { ...(mix.duck || {}), amount: Math.min(0, v) }
                    }, 'Tomm ha cambiato il ducking')
                  }
                />
              )}
            </div>
          </Section>
          <Section title="Effetti condivisi">
            <div className="ac-knobs">
              <Knob value={fxShown.reverb ?? 2.2} min={0.4} max={6} def={2.2} log label="Riverbero" format={(v) => `${v.toFixed(1)}s`} onChange={(v, f) => setFx({ reverb: v }, f)} color="#7dd3fc" />
              <Knob value={(fxShown.delay ?? 0.32) * 1000} min={40} max={1200} def={320} log label="Eco" format={(v) => `${v.toFixed(0)}ms`} onChange={(v, f) => setFx({ delay: v / 1000 }, f)} color="#fcd34d" />
              <Knob value={fxShown.feedback ?? 0.35} min={0} max={0.9} def={0.35} label="Ripetizioni" format={(v) => `${Math.round(v * 100)}%`} onChange={(v, f) => setFx({ feedback: v }, f)} color="#fcd34d" />
            </div>
          </Section>
        </>
      )}
    </aside>
  )
}

function setClipField(c: Composition, index: number, key: 'fadeIn' | 'fadeOut', v: number) {
  const a = c.audio?.[index]
  if (!a) return
  if (v > 0) a[key] = Math.round(v * 100) / 100
  else delete a[key]
}

function NumberField({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const done = () => {
    const v = Number(text.replace(',', '.'))
    if (Number.isFinite(v) && v !== value) onCommit(v)
    else setText(String(value))
  }
  return (
    <label>
      {label}
      <input className="ac-num" value={text} onChange={(e) => setText(e.target.value)} onBlur={done} onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} />
    </label>
  )
}
