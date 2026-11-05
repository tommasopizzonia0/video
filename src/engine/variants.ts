// Format variants: one composition, delivered as 9:16, 4:5, 1:1 or 16:9. A variant changes the frame
// size and platform and patches layers by `id`; layers without x/y stay centered on their own,
// anything placed in pixels needs an override. Pure functions, no DOM.

import type { Composition, Layer, Variant } from './types'

function eachLayer(layers: Layer[] | undefined, visit: (layer: Layer) => void) {
  for (const layer of layers ?? []) {
    visit(layer)
    if (layer.type === 'group') eachLayer(layer.layers, visit)
  }
}

/** Every layer id in the comp (scenes, groups and the top-level overlay). */
export function layerIds(comp: Composition): Set<string> {
  const ids = new Set<string>()
  const add = (l: Layer) => l.id && ids.add(l.id)
  for (const s of comp.scenes ?? []) eachLayer(s.layers, add)
  eachLayer(comp.layers, add)
  return ids
}

/**
 * The comp as variant `name` delivers it: its size and platform, and its layer overrides merged
 * into the layers with those ids. `missing` lists override ids no layer has.
 */
export function applyVariant(comp: Composition, name: string): { comp: Composition; missing: string[] } {
  const variant: Variant | undefined = comp.variants?.[name]
  if (!variant) throw new Error(`No variant "${name}". Variants: ${Object.keys(comp.variants ?? {}).join(', ') || 'none'}.`)
  const out: Composition = structuredClone(comp)
  delete out.variants
  if (variant.width) out.width = variant.width
  if (variant.height) out.height = variant.height
  if (variant.platform) out.platform = variant.platform
  const overrides = variant.layers ?? {}
  const used = new Set<string>()
  const patch = (l: Layer) => {
    const o = l.id ? overrides[l.id] : undefined
    if (!o) return
    used.add(l.id!)
    Object.assign(l, structuredClone(o))
  }
  for (const s of out.scenes ?? []) eachLayer(s.layers, patch)
  eachLayer(out.layers, patch)
  return { comp: out, missing: Object.keys(overrides).filter((id) => !used.has(id)) }
}
