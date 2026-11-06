import { describe, expect, it } from 'vitest'
import { boxFromAlpha, expandStudio, type ImageInfo } from './studio'
import type { Composition, GroupLayer, ImageLayer, Layer } from './types'
import { validate } from './validate'

const all = (layers: Layer[]): Layer[] => layers.flatMap((l) => (l.type === 'group' ? [l, ...all(l.layers)] : [l]))

describe('studio product shots', () => {
  it('finds the visible pixels of a cut-out', () => {
    const w = 10
    const h = 8
    const data = new Uint8ClampedArray(w * h * 4)
    for (let y = 2; y < 6; y++) for (let x = 3; x < 9; x++) data[(y * w + x) * 4 + 3] = 255
    expect(boxFromAlpha(data, w, h)).toEqual([0.3, 0.25, 0.9, 0.75])
    expect(boxFromAlpha(new Uint8ClampedArray(w * h * 4), w, h)).toEqual([0, 0, 1, 1])
  })

  // A 1000×1000 picture whose product fills x 0.2..0.6 and y 0.1..0.8: the margins must not count.
  const info = (): ImageInfo => ({ width: 1000, height: 1000, box: [0.2, 0.1, 0.6, 0.8] })
  const comp = (extra: Record<string, unknown> = {}): Composition => ({
    width: 1080,
    height: 1920,
    assets: { vaso: { type: 'image', src: 'vaso.png' } },
    scenes: [{ duration: 4, layers: [{ type: 'studio', products: [{ asset: 'vaso', width: 400, x: 540, ...extra }] }] }],
  })

  it('stands the visible product on the floor at the asked width', () => {
    const out = expandStudio(comp(), info, 4)
    const layers = all(out.scenes![0].layers)
    const product = layers.find((l): l is ImageLayer => l.type === 'image' && !l.brightness && l.scaleY === undefined)!
    // Visible width 400 px of a box 0.4 wide: the picture is drawn 1000 px wide.
    expect(product.width).toBe(1000)
    expect(product.anchor).toEqual([0.4, 0.8])
    expect(product.y).toBeCloseTo(1920 * 0.74)
    expect(product.x).toBe(540)
    // Soft and contact shadows on the floor line, a highlight painted only on the product.
    expect(layers.filter((l) => l.type === 'ellipse').length).toBeGreaterThanOrEqual(2)
    expect(layers.some((l) => l.blend === 'atop')).toBe(true)
    expect(layers.some((l) => l.type === 'group' && l.isolate)).toBe(true)
    expect(layers.some((l) => l.type === 'studio')).toBe(false)
  })

  it('adds the asked extras and the camera move', () => {
    const out = expandStudio(comp({ reflection: 0.3, shine: 1, shadow: 'cast', halo: '#ffcc66', float: true }), info, 4)
    const top = out.scenes![0].layers[0] as GroupLayer
    const layers = all(top.layers)
    expect(layers.some((l) => l.blend === 'matte')).toBe(true)
    expect(layers.some((l) => l.type === 'image' && l.scaleY === -1)).toBe(true)
    expect(layers.some((l) => l.type === 'image' && l.brightness === 0)).toBe(true)
    // Push in: the products move more than the backdrop behind them (parallax).
    const [backdrop, product] = top.layers as GroupLayer[]
    const end = (v: unknown) => (Array.isArray(v) ? v[v.length - 1].v : v)
    expect(end(product.scale)).toBeCloseTo(1.08)
    expect(end(backdrop.scale)).toBeCloseTo(1.028)
  })

  it('leaves comps without a studio alone', () => {
    const c: Composition = { width: 100, height: 100, duration: 1, layers: [{ type: 'rect', width: 10, height: 10 }] }
    expect(expandStudio(c, info, 1)).toBe(c)
  })

  it('validates studio layers', () => {
    expect(validate(comp()).filter((i) => i.level === 'error')).toEqual([])
    const bad = validate({
      ...comp({ shadow: 'hard', asset: 'nope' }),
      scenes: [{ duration: 2, layers: [{ type: 'studio', camera: 'zoom', products: [{ asset: 'nope', shadow: 'hard' }] }] }],
    } as unknown as Composition)
    const paths = bad.filter((i) => i.level === 'error').map((i) => i.path)
    expect(paths).toContain('scenes[0].layers[0].camera')
    expect(paths).toContain('scenes[0].layers[0].products[0].asset')
    expect(paths).toContain('scenes[0].layers[0].products[0].shadow')
    const jpg = validate({ ...comp(), assets: { vaso: { type: 'image', src: 'vaso.jpg' } } })
    expect(jpg.some((i) => i.level === 'warning' && /cut-out/.test(i.message))).toBe(true)
  })
})
