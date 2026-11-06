import { describe, expect, it } from 'vitest'
import { bakeGrade, gradeColor, isIdentityGrade, parseCube, sampleLut } from './grade'
import { validate } from './validate'

const identityCube = (n: number) => {
  const lines = [`LUT_3D_SIZE ${n}`]
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) lines.push(`${r / (n - 1)} ${g / (n - 1)} ${b / (n - 1)}`)
  return lines.join('\n')
}
const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const close = (a: number[], b: number[], d = 1e-4) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], -Math.log10(d)))

describe('LUT files', () => {
  it('parses a .cube with comments and title, red changing fastest', () => {
    const lut = parseCube(`# made by hand\nTITLE "test"\nLUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n`)
    expect(lut.size).toBe(2)
    close(sampleLut(lut, 1, 0, 0), [1, 0, 0])
    close(sampleLut(lut, 0.25, 0.5, 0.75), [0.25, 0.5, 0.75])
  })
  it('explains broken files', () => {
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0')).toThrow(/expected 8 entries/)
    expect(() => parseCube('LUT_1D_SIZE 1024')).toThrow(/1D/)
    expect(() => parseCube('0 0 0')).toThrow(/LUT_3D_SIZE/)
  })
  it('interpolates between entries (trilinear)', () => {
    const invert = parseCube(identityCube(5).split('\n').map((l, i) => (i === 0 ? l : l.split(' ').map((v) => String(1 - Number(v))).join(' '))).join('\n'))
    close(sampleLut(invert, 0.1, 0.33, 0.9), [0.9, 0.67, 0.1])
  })
})

describe('grade', () => {
  it('an empty grade changes nothing', () => {
    expect(isIdentityGrade({})).toBe(true)
    expect(isIdentityGrade({ shadows: [0, 0, 0], contrast: 1 })).toBe(true)
    expect(isIdentityGrade({ exposure: 0.1 })).toBe(false)
    const baked = bakeGrade({}, null, 9)
    close(sampleLut(baked, 0.3, 0.6, 0.12), [0.3, 0.6, 0.12], 1e-3)
  })
  it('exposure +1 doubles the light', () => {
    const out = gradeColor({ exposure: 1 }, [0.4, 0.4, 0.4])
    expect(lin(out[0])).toBeCloseTo(lin(0.4) * 2, 4)
  })
  it('saturation 0 gives grey with the same luminance', () => {
    const [r, g, b] = gradeColor({ saturation: 0 }, [0.9, 0.3, 0.1])
    expect(r).toBeCloseTo(g, 5)
    expect(g).toBeCloseTo(b, 5)
    expect(lin(r)).toBeCloseTo(0.2126 * lin(0.9) + 0.7152 * lin(0.3) + 0.0722 * lin(0.1), 4)
  })
  it('warm temperature adds red and removes blue on grey, keeping its brightness', () => {
    const [r, g, b] = gradeColor({ temperature: 0.5 }, [0.5, 0.5, 0.5])
    expect(r).toBeGreaterThan(0.5)
    expect(b).toBeLessThan(0.5)
    expect(0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)).toBeCloseTo(lin(0.5), 4)
  })
  it('contrast keeps black, white and mid grey, and pushes the rest apart without clipping', () => {
    const k = { contrast: 1.4 }
    close(gradeColor(k, [0, 1, 0.4614]), [0, 1, 0.4614], 1e-3)
    expect(gradeColor(k, [0.2, 0.2, 0.2])[0]).toBeLessThan(0.2)
    expect(gradeColor(k, [0.8, 0.8, 0.8])[0]).toBeGreaterThan(0.8)
    expect(gradeColor(k, [0.98, 0.98, 0.98])[0]).toBeLessThan(1)
  })
  it('lift, gamma, gain and fade move shadows, mid-tones and highlights', () => {
    expect(gradeColor({ shadows: 0.4 }, [0, 0, 0])[0]).toBeCloseTo(0.1, 5)
    expect(gradeColor({ highlights: -0.2 }, [1, 1, 1])[0]).toBeCloseTo(0.8, 5)
    expect(gradeColor({ midtones: 0.3 }, [0.5, 0.5, 0.5])[0]).toBeGreaterThan(0.5)
    expect(gradeColor({ fade: 1 }, [0, 0, 0])[0]).toBeCloseTo(0.12, 5)
    // A colored lift tints only the shadows.
    const [r, , b] = gradeColor({ shadows: [0, 0, 0.4] }, [0.05, 0.05, 0.05])
    expect(b).toBeGreaterThan(r)
  })
  it('applies the LUT after the corrections, mixed by lutAmount', () => {
    const invert = parseCube(identityCube(3).split('\n').map((l, i) => (i === 0 ? l : l.split(' ').map((v) => String(1 - Number(v))).join(' '))).join('\n'))
    close(sampleLut(bakeGrade({}, invert, 17), 0.2, 0.2, 0.2), [0.8, 0.8, 0.8], 1e-3)
    close(sampleLut(bakeGrade({ lutAmount: 0.5 }, invert, 17), 0.2, 0.2, 0.2), [0.5, 0.5, 0.5], 1e-3)
  })
  it('validates grades and LUT assets', () => {
    const base = { width: 1080, height: 1920, scenes: [{ duration: 1, layers: [{ type: 'rect', width: 10, height: 10, grade: { contrast: 9 } }] }] }
    const issues = validate({ ...base, assets: { look: { type: 'image', src: 'a.png' } }, grade: { lut: 'look', shadows: [0, 2, 0] } })
    const paths = issues.filter((i) => i.level === 'error').map((i) => i.path)
    expect(paths).toEqual(expect.arrayContaining(['grade.lut', 'grade.shadows', 'scenes[0].layers[0].grade.contrast']))
    expect(validate({ ...base, scenes: [{ duration: 1, layers: [] }], assets: { look: { type: 'lut', src: 'look.cube' } }, grade: { lut: 'look', lutAmount: 0.6 } })).toEqual([])
  })
})
