// The arrows as a team of agents. Each arrow looks after one area of the studio (the frame, the
// timeline, the uploads, the audio console), notices what is wrong there, and talks to the others on
// a shared channel when the fix belongs to someone else: the Video arrow sees a caption that flashes
// by too fast and asks the Timeline to lengthen the scene; the Timeline does it and tells the Audio
// that the video now ends later; the Audio moves the music's ending. A director ("regista") runs the
// conversation, makes sure every arrow only touches its own area, groups each chain of messages into
// one proposal and holds back proposals that would collide. Nothing is applied until Tomm says so.
//
// Pure functions on the composition JSON: no DOM, no network, the same result every time.

import type { Platform } from '../engine/check'
import type { Composition } from '../engine/types'
import type { ArrowRole, ClaudeTarget } from '../studio/live'

export type Role = ArrowRole
export const ROLES: Role[] = ['video', 'timeline', 'media', 'audio']
export const ROLE_NAME: Record<Role | 'regista', string> = { video: 'Video', timeline: 'Timeline', media: 'Caricamenti', audio: 'Audio', regista: 'Regista' }

/** A place in the composition JSON: keys and array indexes, e.g. ["scenes", 2, "duration"]. */
export type Path = (string | number)[]

/** One change to the JSON. `push` appends to an array (created when missing), `remove` deletes a key. */
export type Op = { op: 'set'; path: Path; value: unknown } | { op: 'push'; path: Path; value: unknown } | { op: 'remove'; path: Path }

export interface Message {
  id: number
  from: Role | 'regista'
  /** Another arrow (a request it will answer), or the director (a note or a proposal for Tomm). */
  to: Role | 'regista'
  text: string
  /** What the request is about, for the receiving arrow: "allunga", "tempi", "whoosh"… */
  topic?: string
  data?: Record<string, unknown>
  /** What the sender's arrow points at while it says this. */
  target?: ClaudeTarget
  /** Comp time it is about. */
  at?: number
  /** A proposal: the changes the sender would make, in its own area. */
  ops?: Op[]
  /** The message this one answers. */
  replyTo?: number
}

/** What an arrow sends: a message without the id and sender, which the director fills in. */
export type Outgoing = Omit<Message, 'id' | 'from'>

/** What the Video arrow saw on the sampled frames, per text layer (see look.ts). */
export interface SeenText {
  /** Where the layer is in the composition. */
  path: Path
  label: string
  kind: 'text' | 'captions'
  /** First and last time it was on screen, and how long it was readable (opacity ≥ 0.5). */
  first: number
  visible: number
  words: number
  /** Font size in comp px, as held (median). */
  size: number
  /** Union of where it sat while held (outside transitions), comp px. */
  box: [number, number, number, number]
  /** Seconds it spent outside the platform's safe zone while held. */
  outside: number
  /** Lowest contrast against the background, when measured. Null when the text has a stroke or a backing. */
  contrast: number | null
}

export interface Look {
  step: number
  texts: SeenText[]
  /** Times of frames with almost nothing on them (flat colour). */
  empty: number[]
}

export interface MediaFacts {
  /** Seconds, for video and audio files. */
  duration?: number
  /** Pixels, for images and videos. */
  width?: number
  height?: number
}

export interface TeamContext {
  comp: Composition
  platform: Platform
  /** What the Video arrow saw (absent until the frames were sampled). */
  look?: Look
  /** What the Caricamenti arrow knows about each asset, by asset id. */
  media?: Record<string, MediaFacts>
  /** Beat times of the music, seconds (with the comp's offset applied). */
  beats?: number[]
  /** Files the composition names but the studio could not find. */
  missing?: string[]
}

/** One arrow: what it notices on its own, and how it answers the others. */
export interface Agent {
  role: Role
  /** Looks at its area without being asked. */
  observe(ctx: TeamContext): Outgoing[]
  /** Answers a message sent to it. `ctx.comp` already includes the changes proposed earlier in the same chain. */
  receive(msg: Message, ctx: TeamContext): Outgoing[]
}

/** A chain of messages started by one observation, with the changes it adds up to. */
export interface Plan {
  id: number
  /** The arrow that noticed the problem. */
  by: Role
  title: string
  messages: Message[]
  ops: Op[]
  /** "ready": Tomm can apply it. "waiting": it touches what an earlier plan changes; it comes back once that one is decided. */
  status: 'ready' | 'waiting'
  waitingFor?: number
}

export interface TeamResult {
  /** Every message in the order it was sent: the channel. */
  channel: Message[]
  /** Proposals for Tomm, most useful first. */
  plans: Plan[]
  /** Notes with no change attached (things Tomm should know). */
  notes: Message[]
  /** "regole": the built-in rules. "claude": a Claude session reasoning for each arrow (live page). */
  source: 'regole' | 'claude'
}

// ---- The JSON patches ----

export function getAt(root: unknown, path: Path): unknown {
  let cur = root
  for (const k of path) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string | number, unknown>)[k]
  }
  return cur
}

/** Applies the changes to a copy of `comp`. Throws when a path does not lead anywhere. */
export function applyOps<T>(comp: T, ops: Op[]): T {
  const out = structuredClone(comp)
  for (const o of ops) {
    // Missing objects along the way are created for set and push ("mix" when there is no mix yet).
    let parent: unknown = out
    for (const k of o.path.slice(0, -1)) {
      const p = parent as Record<string | number, unknown>
      if (p[k] === undefined && o.op !== 'remove' && typeof k === 'string' && !Array.isArray(p)) p[k] = {}
      parent = p[k]
      if (parent === null || typeof parent !== 'object') break
    }
    const key = o.path[o.path.length - 1]
    if (parent === null || typeof parent !== 'object') throw new Error(`Percorso inesistente: ${o.path.join('.')}`)
    const p = parent as Record<string | number, unknown>
    if (o.op === 'set') p[key] = structuredClone(o.value)
    else if (o.op === 'remove') {
      if (Array.isArray(p)) p.splice(Number(key), 1)
      else delete p[key]
    } else {
      const list = (p[key] ??= []) as unknown[]
      if (!Array.isArray(list)) throw new Error(`Non è una lista: ${o.path.join('.')}`)
      list.push(structuredClone(o.value))
    }
  }
  return out
}

const TIMING_KEYS = new Set(['start', 'duration', 'beats', 'transition'])
const SOUND_KEYS = new Set(['volume', 'muted', 'mixer'])

/** Which arrow a part of the composition belongs to. */
export function ownerOf(path: Path): Role {
  const [head] = path
  if (head === 'assets' || head === 'fonts') return 'media'
  if (head === 'audio' || head === 'mix') return 'audio'
  if (head === 'duration' || head === 'beats') return 'timeline'
  if (head === 'scenes') {
    // ["scenes", i] (adding or removing a scene) and its timing are the timeline's.
    if (path.length <= 2) return 'timeline'
    if (path.length === 3) return TIMING_KEYS.has(String(path[2])) ? 'timeline' : 'video'
  }
  // Inside a layer: its timing goes to the timeline, its sound to the audio, the rest is the picture.
  const field = String(path[path.length - 1])
  const inLayer = path.includes('layers')
  if (inLayer && (field === 'start' || field === 'duration')) return 'timeline'
  if (inLayer && path.some((k) => SOUND_KEYS.has(String(k)))) return 'audio'
  return 'video'
}

const samePrefix = (a: Path, b: Path) => {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false
  return true
}

/** Two plans collide when one changes something the other also changes (or something inside it). */
export function overlaps(a: Op[], b: Op[]): boolean {
  // Appending to a list leaves its existing items alone.
  const clash = (x: Op, y: Op) => samePrefix(x.path, y.path) && !(x.op === 'push' && (y.op === 'push' || y.path.length > x.path.length))
  return a.some((x) => b.some((y) => clash(x, y) && clash(y, x)))
}

// ---- The director ----

export interface DirectorOptions {
  /** How many replies a chain may have before the director stops it (no endless ping-pong). */
  maxDepth?: number
  maxMessages?: number
}

/**
 * Runs one round: every arrow looks at its area, the requests travel between arrows (each answer
 * sees the composition as it would be with the changes proposed earlier in the same chain), and
 * every chain becomes a plan for Tomm.
 */
export function runTeam(agents: Agent[], ctx: TeamContext, opts: DirectorOptions = {}): TeamResult {
  const maxDepth = opts.maxDepth ?? 4
  const maxMessages = opts.maxMessages ?? 60
  const byRole = new Map(agents.map((a) => [a.role, a]))
  const channel: Message[] = []
  const notes: Message[] = []
  const plans: Plan[] = []
  let nextId = 1

  const post = (from: Role | 'regista', out: Outgoing): Message => {
    const m: Message = { id: nextId++, from, ...out }
    channel.push(m)
    return m
  }

  for (const agent of agents) {
    for (const first of safeCall(() => agent.observe(ctx))) {
      if (channel.length >= maxMessages) break
      const chain: Message[] = []
      let draft = ctx.comp
      let ops: Op[] = []
      const queue: { msg: Message; depth: number }[] = []

      const accept = (from: Role | 'regista', out: Outgoing, depth: number) => {
        // An arrow may only change its own area: anything else it has to ask for.
        if (from !== 'regista' && out.ops?.length) {
          const foreign = out.ops.find((o) => ownerOf(o.path) !== from)
          if (foreign) {
            const owner = ownerOf(foreign.path)
            const m = post('regista', {
              to: from,
              text: `${ROLE_NAME[from]}, "${foreign.path.join('.')}" è della ${ROLE_NAME[owner]}: chiediglielo, non lo cambio io.`,
              topic: 'fuori-area',
            })
            chain.push(m)
            return
          }
          try {
            draft = applyOps(draft, out.ops)
          } catch (e) {
            chain.push(post('regista', { to: from, text: `Non riesco ad applicare la proposta: ${e instanceof Error ? e.message : String(e)}`, topic: 'errore' }))
            return
          }
          ops = [...ops, ...out.ops]
        }
        const m = post(from, out)
        chain.push(m)
        if (m.to !== 'regista' && m.to !== from && byRole.has(m.to)) queue.push({ msg: m, depth })
      }

      accept(agent.role, first, 0)
      while (queue.length && channel.length < maxMessages) {
        const { msg, depth } = queue.shift()!
        if (depth >= maxDepth) {
          chain.push(post('regista', { to: msg.to, text: 'Basta così su questo punto: troppi passaggi, decide Tomm.', topic: 'stop' }))
          continue
        }
        const receiver = byRole.get(msg.to as Role)!
        for (const out of safeCall(() => receiver.receive(msg, { ...ctx, comp: draft }))) accept(receiver.role, { ...out, replyTo: out.replyTo ?? msg.id }, depth + 1)
      }

      if (ops.length) {
        plans.push({ id: plans.length + 1, by: agent.role, title: first.text, messages: chain, ops, status: 'ready' })
      } else {
        notes.push(...chain.filter((m) => m.to === 'regista' || m.from === 'regista'))
      }
    }
  }

  return { channel, plans: arbitrate(plans), notes, source: 'regole' }
}

/** Drops plans that repeat an earlier one and holds back those that collide with an earlier one. */
export function arbitrate(plans: Plan[]): Plan[] {
  // Same changes proposed twice (two arrows noticed the same thing): keep the first.
  const unique: Plan[] = []
  for (const p of plans) {
    const key = JSON.stringify(p.ops)
    if (unique.some((u) => JSON.stringify(u.ops) === key)) continue
    unique.push(p)
  }
  // Plans that collide with an earlier one wait for it.
  unique.forEach((p, i) => {
    p.id = i + 1
    p.status = 'ready'
    p.waitingFor = undefined
    const before = unique.slice(0, i).find((q) => q.status === 'ready' && overlaps(q.ops, p.ops))
    if (before) {
      p.status = 'waiting'
      p.waitingFor = before.id
    }
  })
  return unique
}

// ---- Claude as the team (live page) ----

/**
 * A message as a Claude session writes it in the live document (`team.messages`): the same fields
 * as `Message`, without the id, plus `plan` to group the messages of one chain.
 */
export interface WireMessage extends Partial<Omit<Message, 'id' | 'replyTo'>> {
  plan?: number | string
}

const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as string[]).includes(v)

/**
 * Turns the conversation a Claude session wrote for the arrows into proposals, with the same rules
 * as the built-in team: an arrow may only change its own area, every chain must apply cleanly to the
 * current composition, colliding proposals wait. What breaks a rule becomes a note from the director.
 */
export function fromClaude(wire: WireMessage[], comp: Composition): TeamResult {
  const channel: Message[] = []
  const notes: Message[] = []
  const chains = new Map<string, Message[]>()
  let nextId = 1
  for (const w of wire) {
    if (!w || typeof w.text !== 'string') continue
    const from = isRole(w.from) || w.from === 'regista' ? w.from : 'regista'
    const to = isRole(w.to) || w.to === 'regista' ? w.to : 'regista'
    const m: Message = { id: nextId++, from, to, text: w.text, target: w.target, at: typeof w.at === 'number' ? w.at : undefined, topic: w.topic, data: w.data }
    let ops = Array.isArray(w.ops) ? w.ops.filter((o) => o && Array.isArray(o.path) && ['set', 'push', 'remove'].includes(o.op)) : []
    if (ops.length && from !== 'regista') {
      const foreign = ops.find((o) => ownerOf(o.path) !== from)
      if (foreign) {
        ops = []
        channel.push(m)
        const key = w.plan !== undefined ? String(w.plan) : `n${m.id}`
        const veto: Message = { id: nextId++, from: 'regista', to: from, text: `${ROLE_NAME[from]}, "${foreign.path.join('.')}" è della ${ROLE_NAME[ownerOf(foreign.path)]}: proposta tolta.`, topic: 'fuori-area' }
        channel.push(veto)
        chains.set(key, [...(chains.get(key) ?? []), m, veto])
        continue
      }
    }
    if (ops.length) m.ops = ops
    channel.push(m)
    const key = w.plan !== undefined ? String(w.plan) : `n${m.id}`
    chains.set(key, [...(chains.get(key) ?? []), m])
  }
  const plans: Plan[] = []
  for (const messages of chains.values()) {
    const ops = messages.flatMap((m) => m.ops ?? [])
    if (!ops.length) {
      notes.push(...messages)
      continue
    }
    try {
      applyOps(comp, ops)
    } catch (e) {
      const err: Message = { id: nextId++, from: 'regista', to: 'regista', text: `Proposta scartata, non si applica alla composizione attuale: ${e instanceof Error ? e.message : String(e)}` }
      channel.push(err)
      notes.push(...messages.map((m) => ({ ...m, ops: undefined })), err)
      continue
    }
    const by = messages.find((m) => m.from !== 'regista')?.from
    plans.push({ id: 0, by: by && by !== 'regista' ? by : 'video', title: messages[0].text, messages, ops, status: 'ready' })
  }
  return { channel, plans: arbitrate(plans), notes, source: 'claude' }
}

function safeCall(fn: () => Outgoing[]): Outgoing[] {
  try {
    return fn()
  } catch {
    return []
  }
}
