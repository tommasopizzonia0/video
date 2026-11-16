// The director's desk: what each arrow is saying to the others, and the proposals waiting for Tomm.

import { ROLE_NAME, ROLES, type Message, type Plan, type Role, type TeamResult } from '../agents/team'

const ROLE_COLOR: Record<Role | 'regista', string> = {
  video: '#ff4d6d',
  timeline: '#2fb8ff',
  media: '#5fd36b',
  audio: '#ff8a3d',
  regista: '#c9c9d6',
}

function Who({ role }: { role: Role | 'regista' }) {
  return (
    <span className="tp-who" style={{ color: ROLE_COLOR[role] }}>
      {ROLE_NAME[role]}
    </span>
  )
}

function Line({ m, live }: { m: Message; live: boolean }) {
  return (
    <li className={`tp-line${live ? ' speaking' : ''}${m.ops?.length ? ' has-ops' : ''}`}>
      <Who role={m.from} />
      {m.to !== 'regista' && (
        <>
          <span className="tp-arrow">→</span>
          <Who role={m.to} />
        </>
      )}
      <span className="tp-text">{m.text}</span>
    </li>
  )
}

export function TeamPanel({
  result,
  view,
  onView,
  onAskClaude,
  asked,
  running,
  auto,
  speaking,
  onRun,
  onAuto,
  onApply,
  onApplyAll,
  onDismiss,
  onHover,
  onClose,
}: {
  result: TeamResult | null
  /** Which reasoning is shown, when Claude has sent a round (null: only the rules so far). */
  view: 'claude' | 'regole' | null
  onView: (v: 'claude' | 'regole') => void
  /** Live page only: asks Claude to reason as the four arrows. */
  onAskClaude?: () => void
  asked: string | null
  running: boolean
  auto: boolean
  speaking: number | null
  onRun: () => void
  onAuto: (v: boolean) => void
  onApply: (p: Plan) => void
  onApplyAll: () => void
  onDismiss: (p: Plan) => void
  onHover: (p: Plan | null) => void
  onClose: () => void
}) {
  const ready = result?.plans.filter((p) => p.status === 'ready') ?? []
  const said = (role: Role) => result?.channel.filter((m) => m.from === role).length ?? 0
  return (
    <aside className="team-panel" aria-label="Regia delle freccette">
      <header className="tp-head">
        <strong>Regia</strong>
        <span className="tp-sub">le freccette lavorano in squadra, tu decidi</span>
        <button className="tp-close" onClick={onClose} title="Chiudi">
          ×
        </button>
      </header>
      <div className="tp-team">
        {ROLES.map((r) => (
          <span key={r} className="tp-agent" style={{ borderColor: ROLE_COLOR[r] }}>
            <i style={{ background: ROLE_COLOR[r] }} />
            {ROLE_NAME[r]}
            <small>{said(r)}</small>
          </span>
        ))}
      </div>
      {view && (
        <div className="tp-tabs" role="tablist">
          <button className={view === 'claude' ? 'on' : ''} onClick={() => onView('claude')}>
            Ragiona Claude
          </button>
          <button className={view === 'regole' ? 'on' : ''} onClick={() => onView('regole')}>
            Regole fisse
          </button>
        </div>
      )}
      <div className="tp-actions">
        <button className="primary" onClick={onRun} disabled={running}>
          {running ? 'Stanno guardando…' : 'Analizza'}
        </button>
        <label className="field-inline" title="Rianalizza da solo dopo ogni modifica">
          <input type="checkbox" checked={auto} onChange={(e) => onAuto(e.target.checked)} />
          Sempre attive
        </label>
        {onAskClaude && (
          <button onClick={onAskClaude} disabled={running} title="Claude ragiona come le quattro freccette: ognuna guarda la sua sezione e si confronta con le altre">
            Fai ragionare Claude
          </button>
        )}
        {ready.length > 1 && <button onClick={onApplyAll}>Applica tutte ({ready.length})</button>}
      </div>
      {asked && <p className="tp-asked">{asked}</p>}
      {result?.source === 'claude' && view === 'claude' && <p className="tp-source">Queste proposte le ha ragionate Claude, una freccetta alla volta. La regia ha controllato che ognuna tocchi solo la sua sezione.</p>}

      <section className="tp-section">
        <h4>Proposte {result ? `(${result.plans.length})` : ''}</h4>
        {!result && <p className="tp-empty">Premi «Analizza»: ogni freccetta guarda la sua sezione e si confronta con le altre.</p>}
        {result && result.plans.length === 0 && <p className="tp-empty">Nessuna proposta: per le freccette la composizione è a posto.</p>}
        {result?.plans.map((p) => (
          <article key={p.id} className={`tp-plan ${p.status}`} onMouseEnter={() => onHover(p)} onMouseLeave={() => onHover(null)}>
            <div className="tp-plan-head">
              <span className="tp-num" style={{ background: ROLE_COLOR[p.by] }}>
                {p.id}
              </span>
              <span className="tp-route">
                {[...new Set(p.messages.map((m) => m.from))].map((r, i) => (
                  <span key={r}>
                    {i > 0 && ' → '}
                    <Who role={r} />
                  </span>
                ))}
              </span>
            </div>
            <ol className="tp-chain">
              {p.messages.map((m) => (
                <Line key={m.id} m={m} live={m.id === speaking} />
              ))}
            </ol>
            {p.status === 'waiting' ? (
              <p className="tp-wait">Tocca le stesse cose della proposta {p.waitingFor}: la regia la ripropone dopo che hai deciso su quella.</p>
            ) : (
              <div className="tp-buttons">
                <button className="primary" onClick={() => onApply(p)}>
                  Applica
                </button>
                <button onClick={() => onDismiss(p)}>Scarta</button>
              </div>
            )}
          </article>
        ))}
      </section>

      {result && result.notes.length > 0 && (
        <section className="tp-section">
          <h4>Da sapere</h4>
          <ol className="tp-chain">
            {result.notes.map((m) => (
              <Line key={m.id} m={m} live={m.id === speaking} />
            ))}
          </ol>
        </section>
      )}

      {result && result.channel.length > 0 && (
        <details className="tp-section tp-channel">
          <summary>Canale ({result.channel.length} messaggi)</summary>
          <ol className="tp-chain">
            {result.channel.map((m) => (
              <Line key={m.id} m={m} live={m.id === speaking} />
            ))}
          </ol>
        </details>
      )}
    </aside>
  )
}
