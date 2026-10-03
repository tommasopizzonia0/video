// Checks a composition and explains every problem with a path ("scenes[1].layers[0].in") and a hint.
// Errors stop a render; warnings (unknown keys, missing fonts) only flag likely mistakes.

import { parseColor } from './color'
import { isKnownEase } from './easing'
import { PRESET_NAMES } from './presets'
import { SFX_NAMES } from './sfx'
import type { Composition } from './types'

export interface Issue {
  level: 'error' | 'warning'
  path: string
  message: string
}

export const BUILTIN_FONTS = [
  'Inter',
  'Inter Tight',
  'Fraunces',
  'Instrument Serif',
  'Space Grotesk',
  'Bricolage Grotesque',
  'JetBrains Mono',
]

const common = [
  'type', 'id', 'comment', 'hidden', 'start', 'duration', 'x', 'y', 'anchor', 'scale', 'scaleX', 'scaleY',
  'rotation', 'skewX', 'opacity', 'blur', 'brightness', 'contrast', 'saturate', 'grayscale', 'hueRotate',
  'shadow', 'blend', 'in', 'out',
]
const layerKeys: Record<string, string[]> = {
  rect: ['width', 'height', 'radius', 'fill', 'stroke'],
  ellipse: ['width', 'height', 'fill', 'stroke'],
  path: ['d', 'width', 'height', 'viewBox', 'fill', 'stroke', 'lineCap', 'lineJoin', 'trimStart', 'trimEnd'],
  text: [
    'text', 'font', 'size', 'weight', 'italic', 'color', 'letterSpacing', 'lineHeight', 'align', 'width',
    'uppercase', 'stroke', 'accent', 'background', 'animate', 'exit', 'counter',
  ],
  image: ['asset', 'width', 'height', 'fit', 'radius'],
  video: ['asset', 'width', 'height', 'fit', 'radius', 'sourceStart', 'playbackRate', 'volume', 'muted'],
  group: ['layers', 'width', 'height', 'clip', 'radius', 'fill', 'stroke'],
  captions: [
    'words', 'asset', 'mode', 'maxWords', 'maxChars', 'font', 'size', 'weight', 'italic', 'color', 'highlight',
    'uppercase', 'stroke', 'background', 'width', 'letterSpacing', 'lineHeight',
  ],
}
const animatable = new Set([
  'x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation', 'skewX', 'opacity', 'blur', 'brightness', 'contrast',
  'saturate', 'grayscale', 'hueRotate', 'width', 'height', 'radius', 'trimStart', 'trimEnd',
])
const compKeys = ['$schema', 'comment', 'width', 'height', 'fps', 'duration', 'background', 'fonts', 'assets', 'audio', 'mix', 'scenes', 'layers', 'effects']
const sceneKeys = ['id', 'comment', 'duration', 'background', 'layers', 'transition']
const transitionTypes = ['cut', 'fade', 'dip', 'slide', 'push', 'zoom', 'blur', 'wipe', 'iris', 'curve', 'zoomThrough', 'zoomBack', 'flash', 'whip']
const blendModes = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light',
  'soft-light', 'difference', 'exclusion', 'add',
]

function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return dp[a.length][b.length]
}

function suggest(word: string, options: string[]): string {
  let best = ''
  let bestD = Infinity
  for (const o of options) {
    const d = distance(word.toLowerCase(), o.toLowerCase())
    if (d < bestD) {
      bestD = d
      best = o
    }
  }
  return bestD <= Math.max(2, word.length / 3) ? ` Did you mean "${best}"?` : ''
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function validate(input: unknown): Issue[] {
  const issues: Issue[] = []
  const err = (path: string, message: string) => issues.push({ level: 'error', path, message })
  const warn = (path: string, message: string) => issues.push({ level: 'warning', path, message })

  if (!isObj(input)) {
    err('', 'The composition must be a JSON object.')
    return issues
  }
  const comp = input as unknown as Composition
  const keys = (obj: Record<string, unknown>, allowed: string[], path: string) => {
    for (const k of Object.keys(obj)) if (!allowed.includes(k)) warn(`${path}${path ? '.' : ''}${k}`, `Unknown property, ignored.${suggest(k, allowed)}`)
  }
  keys(input, compKeys, '')

  for (const k of ['width', 'height'] as const) {
    if (!isNum(comp[k]) || comp[k] <= 0) err(k, 'Must be a positive number of pixels.')
    else if (comp[k] % 2) warn(k, 'MP4 (H.264) needs even dimensions; it will be rounded.')
  }
  if (comp.fps !== undefined && (!isNum(comp.fps) || comp.fps <= 0 || comp.fps > 120)) err('fps', 'Must be between 1 and 120.')
  if (comp.duration !== undefined && (!isNum(comp.duration) || comp.duration <= 0)) err('duration', 'Must be a positive number of seconds.')
  if (comp.scenes === undefined && comp.layers === undefined) err('', 'Add "scenes" or "layers".')
  if (comp.scenes === undefined && comp.duration === undefined && comp.layers !== undefined)
    warn('duration', 'Without scenes, set "duration" explicitly.')

  const assets = isObj(comp.assets) ? comp.assets : {}
  if (comp.assets !== undefined && !isObj(comp.assets)) err('assets', 'Must be an object of { id: { type, src } }.')
  for (const [id, a] of Object.entries(assets)) {
    const p = `assets.${id}`
    if (!isObj(a)) {
      err(p, 'Must be { "type": "image" | "video" | "audio", "src": "..." }.')
      continue
    }
    if (!['image', 'video', 'audio', 'captions'].includes(a.type as string)) err(`${p}.type`, 'Must be "image", "video", "audio" or "captions".')
    if (typeof a.src !== 'string' || !a.src) err(`${p}.src`, 'Must be a path relative to the composition file, or a URL.')
  }

  const fonts = new Set(BUILTIN_FONTS)
  if (comp.fonts !== undefined) {
    if (!Array.isArray(comp.fonts)) err('fonts', 'Must be a list of { family, src }.')
    else
      comp.fonts.forEach((f, i) => {
        if (!isObj(f) || typeof f.family !== 'string' || typeof f.src !== 'string') err(`fonts[${i}]`, 'Must be { "family": "...", "src": "..." }.')
        else fonts.add(f.family)
      })
  }

  const checkEase = (v: unknown, path: string) => {
    if (v !== undefined && !isKnownEase(v)) err(path, 'Unknown easing. Use a name like "smooth", "outExpo", "inOutCubic", "spring", a [x1,y1,x2,y2] bezier or { "spring": {...} }.')
  }

  const checkColor = (v: unknown, path: string) => {
    if (typeof v !== 'string' || !parseColor(v)) err(path, `"${String(v)}" is not a color. Use "#rrggbb", "rgba(...)" or "hsl(...)".`)
  }

  const checkAnim = (v: unknown, path: string, kind: 'number' | 'color') => {
    if (v === undefined) return
    const checkValue = (x: unknown, p: string) => {
      if (kind === 'number' && !isNum(x)) err(p, 'Must be a number.')
      if (kind === 'color') checkColor(x, p)
    }
    if (Array.isArray(v)) {
      if (!v.length) return err(path, 'Keyframes list is empty.')
      let prev = -Infinity
      v.forEach((k, i) => {
        if (!isObj(k) || !isNum(k.t) || !('v' in k)) return err(`${path}[${i}]`, 'A keyframe is { "t": seconds, "v": value, "ease"?: ... }.')
        if (k.t < prev) err(`${path}[${i}].t`, 'Keyframes must be sorted by time.')
        prev = k.t
        checkValue(k.v, `${path}[${i}].v`)
        checkEase(k.ease, `${path}[${i}].ease`)
      })
      return
    }
    if (isObj(v)) {
      if (!('from' in v) || !('to' in v)) return err(path, 'An animated value is a number, a keyframe list or { "from", "to", "duration", "at"?, "ease"? }.')
      checkValue(v.from, `${path}.from`)
      checkValue(v.to, `${path}.to`)
      if (!isNum(v.duration) || v.duration < 0) err(`${path}.duration`, 'Must be a number of seconds.')
      checkEase(v.ease, `${path}.ease`)
      return
    }
    checkValue(v, path)
  }

  const checkFill = (v: unknown, path: string) => {
    if (v === undefined) return
    if (isObj(v) && 'stops' in v) {
      if (v.type !== 'linear' && v.type !== 'radial') err(`${path}.type`, 'Gradient type must be "linear" or "radial".')
      if (!Array.isArray(v.stops) || v.stops.length < 2) return err(`${path}.stops`, 'A gradient needs at least two [offset, color] stops.')
      v.stops.forEach((s, i) => {
        if (!Array.isArray(s) || !isNum(s[0])) err(`${path}.stops[${i}]`, 'A stop is [offset 0..1, color].')
        else checkColor(s[1], `${path}.stops[${i}][1]`)
      })
      return
    }
    checkAnim(v, path, 'color')
  }

  const checkPreset = (v: unknown, path: string) => {
    if (v === undefined) return
    const list = Array.isArray(v) ? v : [v]
    list.forEach((p, i) => {
      const pp = Array.isArray(v) ? `${path}[${i}]` : path
      const name = typeof p === 'string' ? p : isObj(p) ? p.type : undefined
      if (typeof name !== 'string' || !PRESET_NAMES.includes(name as never))
        err(isObj(p) ? `${pp}.type` : pp, `Unknown preset "${String(name)}".${suggest(String(name), PRESET_NAMES)} Options: ${PRESET_NAMES.join(', ')}.`)
      if (isObj(p)) {
        keys(p, ['type', 'duration', 'delay', 'ease', 'distance', 'scale', 'blur', 'angle'], pp)
        checkEase(p.ease, `${pp}.ease`)
      }
    })
  }

  const checkTextAnim = (v: unknown, path: string) => {
    if (v === undefined) return
    if (!isObj(v)) return err(path, 'Must be { "by", "preset", "stagger", "duration", "delay", "ease", "order" }.')
    keys(v, ['by', 'preset', 'stagger', 'duration', 'delay', 'ease', 'order'], path)
    if (v.by !== undefined && !['char', 'word', 'line'].includes(v.by as string)) err(`${path}.by`, 'Must be "char", "word" or "line".')
    if (v.order !== undefined && !['start', 'end', 'center', 'edges', 'random'].includes(v.order as string))
      err(`${path}.order`, 'Must be "start", "end", "center", "edges" or "random".')
    checkPreset(v.preset, `${path}.preset`)
    checkEase(v.ease, `${path}.ease`)
  }

  const checkLayers = (layers: unknown, path: string) => {
    if (!Array.isArray(layers)) return err(path, 'Must be a list of layers.')
    layers.forEach((layer, i) => checkLayer(layer, `${path}[${i}]`))
  }

  const checkLayer = (l: unknown, path: string) => {
    if (!isObj(l)) return err(path, 'A layer must be an object with a "type".')
    const type = l.type as string
    if (!(type in layerKeys)) return err(`${path}.type`, `Unknown layer type "${type}".${suggest(String(type), Object.keys(layerKeys))} Options: ${Object.keys(layerKeys).join(', ')}.`)
    keys(l, [...common, ...layerKeys[type]], path)
    for (const k of Object.keys(l)) if (animatable.has(k)) checkAnim(l[k], `${path}.${k}`, 'number')
    for (const k of ['start', 'duration'] as const) if (l[k] !== undefined && (!isNum(l[k]) || (l[k] as number) < 0)) err(`${path}.${k}`, 'Must be a number of seconds (>= 0).')
    if (l.anchor !== undefined && !(Array.isArray(l.anchor) && l.anchor.length === 2 && l.anchor.every(isNum))) err(`${path}.anchor`, 'Must be [x, y] relative to the layer box, e.g. [0.5, 0.5].')
    if (l.blend !== undefined && !blendModes.includes(l.blend as string)) err(`${path}.blend`, `Unknown blend mode.${suggest(String(l.blend), blendModes)}`)
    checkPreset(l.in, `${path}.in`)
    checkPreset(l.out, `${path}.out`)
    if (l.shadow !== undefined) {
      if (!isObj(l.shadow)) err(`${path}.shadow`, 'Must be { color, blur, x, y }.')
      else if (l.shadow.color !== undefined) checkColor(l.shadow.color, `${path}.shadow.color`)
    }
    if (l.stroke !== undefined && !(type === 'captions' && l.stroke === false)) {
      if (!isObj(l.stroke)) err(`${path}.stroke`, 'Must be { "color", "width" }.')
      else checkColor(l.stroke.color, `${path}.stroke.color`)
    }
    if ('fill' in l) checkFill(l.fill, `${path}.fill`)

    switch (type) {
      case 'rect':
      case 'ellipse':
        if (l.width === undefined || l.height === undefined) err(path, `A ${type} needs "width" and "height".`)
        break
      case 'path':
        if (typeof l.d !== 'string') err(`${path}.d`, 'Must be SVG path data, e.g. "M0 0 L100 100".')
        if (!isNum(l.width) || !isNum(l.height)) err(path, 'A path needs numeric "width" and "height" (its box).')
        if (l.viewBox !== undefined && !(Array.isArray(l.viewBox) && l.viewBox.length === 4 && l.viewBox.every(isNum)))
          err(`${path}.viewBox`, 'Must be [minX, minY, width, height].')
        if (l.fill === undefined && l.stroke === undefined) warn(path, 'A path with no fill and no stroke is invisible.')
        break
      case 'text':
        if (typeof l.text !== 'string') err(`${path}.text`, 'Must be a string.')
        if (l.size !== undefined && (!isNum(l.size) || l.size <= 0)) err(`${path}.size`, 'Must be a positive number of pixels.')
        checkFill(l.color, `${path}.color`)
        if (isObj(l.accent)) {
          keys(l.accent, ['font', 'weight', 'italic', 'color'], `${path}.accent`)
          checkFill(l.accent.color, `${path}.accent.color`)
          if (typeof l.accent.font === 'string' && !fonts.has(l.accent.font)) warn(`${path}.accent.font`, `Font "${l.accent.font}" is not built in or declared in "fonts".${suggest(l.accent.font, [...fonts])}`)
        }
        if (typeof l.font === 'string' && !fonts.has(l.font)) warn(`${path}.font`, `Font "${l.font}" is not built in or declared in "fonts".${suggest(l.font, [...fonts])}`)
        if (isObj(l.background)) checkFill(l.background.fill, `${path}.background.fill`)
        checkTextAnim(l.animate, `${path}.animate`)
        checkTextAnim(l.exit, `${path}.exit`)
        if (l.counter !== undefined && (!isObj(l.counter) || !isNum(l.counter.from) || !isNum(l.counter.to)))
          err(`${path}.counter`, 'Must be { "from": number, "to": number, ... }.')
        break
      case 'image':
      case 'video': {
        const a = assets[l.asset as string]
        if (typeof l.asset !== 'string') err(`${path}.asset`, 'Must be the id of an entry in "assets".')
        else if (!a) err(`${path}.asset`, `No asset "${l.asset}" in "assets".${suggest(l.asset, Object.keys(assets))}`)
        else if (a.type !== type) err(`${path}.asset`, `Asset "${l.asset}" is a ${a.type}, not a ${type}.`)
        if (l.fit !== undefined && !['cover', 'contain', 'fill'].includes(l.fit as string)) err(`${path}.fit`, 'Must be "cover", "contain" or "fill".')
        break
      }
      case 'group':
        checkLayers(l.layers, `${path}.layers`)
        break
      case 'captions': {
        if (l.words === undefined && l.asset === undefined) err(path, 'Captions need "words" ([{ text, start, end }]) or a "captions" asset.')
        if (l.words !== undefined) {
          if (!Array.isArray(l.words)) err(`${path}.words`, 'Must be a list of { "text", "start", "end" } in seconds.')
          else
            l.words.forEach((w, i) => {
              if (!isObj(w) || typeof w.text !== 'string' || !isNum(w.start) || !isNum(w.end)) err(`${path}.words[${i}]`, 'A word is { "text": "...", "start": s, "end": s }.')
              else if (w.end < w.start) err(`${path}.words[${i}].end`, 'Ends before it starts.')
            })
        }
        if (l.asset !== undefined) {
          const a = assets[l.asset as string]
          if (!a) err(`${path}.asset`, `No asset "${String(l.asset)}" in "assets".`)
          else if (a.type !== 'captions') err(`${path}.asset`, `Asset "${String(l.asset)}" is a ${a.type}; captions need a "captions" asset.`)
        }
        if (l.mode !== undefined && !['highlight', 'reveal'].includes(l.mode as string)) err(`${path}.mode`, 'Must be "highlight" or "reveal".')
        for (const k of ['color', 'highlight'] as const) if (l[k] !== undefined) checkColor(l[k], `${path}.${k}`)
        for (const k of ['maxWords', 'maxChars', 'size'] as const) if (l[k] !== undefined && (!isNum(l[k]) || (l[k] as number) <= 0)) err(`${path}.${k}`, 'Must be a positive number.')
        if (typeof l.font === 'string' && !fonts.has(l.font)) warn(`${path}.font`, `Font "${l.font}" is not built in or declared in "fonts".${suggest(l.font, [...fonts])}`)
        if (isObj(l.background)) checkFill(l.background.fill, `${path}.background.fill`)
        break
      }
    }
  }

  if (comp.scenes !== undefined) {
    if (!Array.isArray(comp.scenes)) err('scenes', 'Must be a list of scenes.')
    else
      comp.scenes.forEach((s, i) => {
        const p = `scenes[${i}]`
        if (!isObj(s)) return err(p, 'A scene is { "duration", "layers", ... }.')
        keys(s, sceneKeys, p)
        if (!isNum(s.duration) || s.duration <= 0) err(`${p}.duration`, 'Must be a positive number of seconds.')
        checkFill(s.background, `${p}.background`)
        checkLayers(s.layers ?? [], `${p}.layers`)
        const tr = s.transition
        if (tr !== undefined) {
          if (!isObj(tr) || !transitionTypes.includes(tr.type as string))
            err(`${p}.transition`, `Must be { "type": ${transitionTypes.map((t) => `"${t}"`).join(' | ')}, "duration"?, "ease"?, "direction"? }.`)
          else {
            keys(tr, ['type', 'duration', 'ease', 'direction', 'color', 'blur', 'distance'], `${p}.transition`)
            if (tr.color !== undefined) checkColor(tr.color, `${p}.transition.color`)
            checkEase(tr.ease, `${p}.transition.ease`)
            if (i === 0) warn(`${p}.transition`, 'The first scene has nothing to transition from; ignored.')
          }
        }
      })
  }
  if (comp.layers !== undefined) checkLayers(comp.layers, 'layers')
  checkFill(comp.background, 'background')

  if (comp.audio !== undefined) {
    if (!Array.isArray(comp.audio)) err('audio', 'Must be a list of { asset, start, volume, ... }.')
    else
      comp.audio.forEach((a, i) => {
        const p = `audio[${i}]`
        if (!isObj(a)) return err(p, 'Must be { "asset": "...", ... }.')
        keys(a, ['asset', 'sfx', 'role', 'scene', 'start', 'sourceStart', 'duration', 'volume', 'fadeIn', 'fadeOut', 'comment'], p)
        if (a.sfx !== undefined) {
          if (!SFX_NAMES.includes(a.sfx as never)) err(`${p}.sfx`, `Unknown sound effect "${String(a.sfx)}".${suggest(String(a.sfx), SFX_NAMES)} Options: ${SFX_NAMES.join(', ')}.`)
          if (a.asset !== undefined) err(p, 'Use either "asset" or "sfx", not both.')
        } else {
          const asset = assets[a.asset as string]
          if (!asset) err(`${p}.asset`, `No asset "${String(a.asset)}" in "assets".${typeof a.asset === 'string' ? suggest(a.asset, Object.keys(assets)) : ' Add "asset" or a built-in "sfx".'}`)
          else if (asset.type === 'image') err(`${p}.asset`, 'An image has no audio.')
        }
        if (a.role !== undefined && !['music', 'voice', 'sfx'].includes(a.role as string)) err(`${p}.role`, 'Must be "music", "voice" or "sfx".')
        if (a.scene !== undefined) {
          const scenes = Array.isArray(comp.scenes) ? comp.scenes : []
          const ok = typeof a.scene === 'number' ? Number.isInteger(a.scene) && a.scene >= 0 && a.scene < scenes.length : scenes.some((sc) => isObj(sc) && sc.id === a.scene)
          if (!ok) err(`${p}.scene`, `No scene "${String(a.scene)}". Use a scene "id" or its index in "scenes".`)
        }
        checkAnim(a.volume, `${p}.volume`, 'number')
        for (const k of ['start', 'sourceStart', 'duration', 'fadeIn', 'fadeOut'] as const)
          if (a[k] !== undefined && !isNum(a[k])) err(`${p}.${k}`, 'Must be a number of seconds.')
      })
  }
  if (comp.mix !== undefined) {
    if (!isObj(comp.mix)) err('mix', 'Must be { "loudness"?: LUFS | false, "duck"?: {...} | false }.')
    else {
      keys(comp.mix, ['loudness', 'duck'], 'mix')
      const l = comp.mix.loudness
      if (l !== undefined && l !== false && (!isNum(l) || l > -5 || l < -40)) err('mix.loudness', 'Must be a target in LUFS between -40 and -5 (social: -14), or false.')
      const d = comp.mix.duck
      if (d !== undefined && d !== false) {
        if (!isObj(d)) err('mix.duck', 'Must be { amount?, attack?, release?, threshold? } or false.')
        else keys(d, ['amount', 'attack', 'release', 'threshold'], 'mix.duck')
      }
    }
  }
  if (comp.effects !== undefined) {
    if (!isObj(comp.effects)) err('effects', 'Must be { grain?, vignette?, motionBlur? }.')
    else keys(comp.effects, ['grain', 'vignette', 'motionBlur'], 'effects')
  }
  return issues
}

/** Parses JSON text and validates it. Returns the composition only when there are no errors. */
export function parseComposition(text: string): { comp: Composition | null; issues: Issue[] } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    return { comp: null, issues: [{ level: 'error', path: '', message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` }] }
  }
  const issues = validate(data)
  return { comp: issues.some((i) => i.level === 'error') ? null : (data as Composition), issues }
}
