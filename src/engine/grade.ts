// Color grading: exposure, white balance, saturation, lift/gamma/gain, contrast, fade and a .cube LUT,
// all baked into one 3D lookup table (pure math, tested) and applied to a canvas on the GPU (WebGL2),
// with a CPU fallback. The preview and the render use the same code, so they match.

import type { Grade } from './types'

/** A 3D LUT: size³ RGB triplets, red changing fastest (the .cube order), values 0..1. */
export interface Lut {
  size: number
  data: Float32Array
}

/** Parses an Adobe/Resolve .cube 3D LUT. */
export function parseCube(text: string): Lut {
  let size = 0
  let min = [0, 0, 0]
  let max = [1, 1, 1]
  const values: number[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const parts = line.split(/\s+/)
    const key = parts[0].toUpperCase()
    if (key === 'LUT_3D_SIZE') size = Number(parts[1])
    else if (key === 'LUT_1D_SIZE') throw new Error('1D LUTs are not supported: export a 3D .cube')
    else if (key === 'DOMAIN_MIN') min = parts.slice(1, 4).map(Number)
    else if (key === 'DOMAIN_MAX') max = parts.slice(1, 4).map(Number)
    else if (/^[-+.\d]/.test(parts[0]) && parts.length >= 3) values.push(Number(parts[0]), Number(parts[1]), Number(parts[2]))
  }
  if (!(size >= 2 && size <= 256)) throw new Error('missing or invalid LUT_3D_SIZE')
  if (values.length !== size ** 3 * 3) throw new Error(`expected ${size ** 3} entries, found ${values.length / 3}`)
  if (values.some((v) => !Number.isFinite(v))) throw new Error('invalid number in the LUT')
  // Normalize a custom input domain to 0..1 by resampling is rarely needed; the output range is kept as is.
  if (min.some((v) => v !== 0) || max.some((v) => v !== 1)) throw new Error('DOMAIN_MIN/MAX other than 0..1 are not supported')
  return { size, data: Float32Array.from(values) }
}

/** Samples a LUT with trilinear interpolation at r, g, b in 0..1. */
export function sampleLut(lut: Lut, r: number, g: number, b: number, out: number[] = [0, 0, 0]): number[] {
  const n = lut.size - 1
  const fr = Math.min(Math.max(r, 0), 1) * n
  const fg = Math.min(Math.max(g, 0), 1) * n
  const fb = Math.min(Math.max(b, 0), 1) * n
  const r0 = Math.min(Math.floor(fr), n - 1)
  const g0 = Math.min(Math.floor(fg), n - 1)
  const b0 = Math.min(Math.floor(fb), n - 1)
  const dr = fr - r0
  const dg = fg - g0
  const db = fb - b0
  const s = lut.size
  const d = lut.data
  for (let c = 0; c < 3; c++) {
    const at = (ri: number, gi: number, bi: number) => d[((bi * s + gi) * s + ri) * 3 + c]
    const c00 = at(r0, g0, b0) * (1 - dr) + at(r0 + 1, g0, b0) * dr
    const c10 = at(r0, g0 + 1, b0) * (1 - dr) + at(r0 + 1, g0 + 1, b0) * dr
    const c01 = at(r0, g0, b0 + 1) * (1 - dr) + at(r0 + 1, g0, b0 + 1) * dr
    const c11 = at(r0, g0 + 1, b0 + 1) * (1 - dr) + at(r0 + 1, g0 + 1, b0 + 1) * dr
    out[c] = (c00 * (1 - dg) + c10 * dg) * (1 - db) + (c01 * (1 - dg) + c11 * dg) * db
  }
  return out
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.max(v, 0) ** (1 / 2.4) - 0.055)
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const triple = (v: number | number[] | undefined, fallback: number): number[] =>
  v === undefined ? [fallback, fallback, fallback] : typeof v === 'number' ? [v, v, v] : [v[0] ?? fallback, v[1] ?? fallback, v[2] ?? fallback]

/** 18% grey in sRGB: the pivot of the contrast curve, so mid-tones keep their brightness. */
const PIVOT = toSrgb(0.18)

/** The grade applied to one sRGB color (0..1), without the LUT. */
export function gradeColor(g: Grade, rgb: number[]): number[] {
  // Linear light: exposure, white balance, saturation.
  let [r, gr, b] = rgb.map(toLinear)
  const exp = 2 ** (g.exposure ?? 0)
  // Temperature: warmer = more red, less blue; tint: + = magenta, - = green. Luminance is kept.
  const t = g.temperature ?? 0
  const tint = g.tint ?? 0
  let wr = 1 + 0.18 * t
  let wg = 1 - 0.12 * tint
  let wb = 1 - 0.18 * t
  const norm = 0.2126 * wr + 0.7152 * wg + 0.0722 * wb
  wr /= norm
  wg /= norm
  wb /= norm
  r *= exp * wr
  gr *= exp * wg
  b *= exp * wb
  const sat = g.saturation ?? 1
  if (sat !== 1) {
    const l = 0.2126 * r + 0.7152 * gr + 0.0722 * b
    r = l + (r - l) * sat
    gr = l + (gr - l) * sat
    b = l + (b - l) * sat
  }
  let out = [r, gr, b].map((v) => clamp01(toSrgb(v)))

  // Display space: lift (shadows), gamma (midtones), gain (highlights), per channel for color wheels.
  const lift = triple(g.shadows, 0)
  const gamma = triple(g.midtones, 0)
  const gain = triple(g.highlights, 0)
  out = out.map((v, c) => {
    let x = v * (1 + gain[c]) + lift[c] * 0.25 * (1 - v)
    x = clamp01(x) ** 2 ** -gamma[c]
    return x
  })

  // Contrast: an S-curve around mid grey that keeps black and white in place (no clipping).
  const k = g.contrast ?? 1
  if (k !== 1) {
    out = out.map((v) => (v < PIVOT ? PIVOT * (v / PIVOT) ** k : 1 - (1 - PIVOT) * ((1 - v) / (1 - PIVOT)) ** k))
  }
  // Fade: lifted blacks, the matte film look.
  const fade = (g.fade ?? 0) * 0.12
  if (fade) out = out.map((v) => fade + v * (1 - fade))
  return out.map(clamp01)
}

/** Whether a grade changes anything. */
export function isIdentityGrade(g: Grade | undefined): boolean {
  if (!g) return true
  const zero = (v: number | number[] | undefined) => v === undefined || (typeof v === 'number' ? v === 0 : v.every((x) => x === 0))
  return (
    !g.lut &&
    (g.exposure ?? 0) === 0 &&
    (g.temperature ?? 0) === 0 &&
    (g.tint ?? 0) === 0 &&
    (g.saturation ?? 1) === 1 &&
    (g.contrast ?? 1) === 1 &&
    (g.fade ?? 0) === 0 &&
    zero(g.shadows) &&
    zero(g.midtones) &&
    zero(g.highlights)
  )
}

/** The whole grade (corrections, then the creative LUT mixed by `lutAmount`) as one 33³ LUT. */
export function bakeGrade(g: Grade, lut: Lut | null, size = 33): Lut {
  const data = new Float32Array(size ** 3 * 3)
  const amount = clamp01(g.lutAmount ?? 1)
  const tmp = [0, 0, 0]
  let i = 0
  for (let bi = 0; bi < size; bi++)
    for (let gi = 0; gi < size; gi++)
      for (let ri = 0; ri < size; ri++) {
        const c = gradeColor(g, [ri / (size - 1), gi / (size - 1), bi / (size - 1)])
        if (lut && amount > 0) {
          const l = sampleLut(lut, c[0], c[1], c[2], tmp)
          for (let k = 0; k < 3; k++) c[k] = c[k] + (clamp01(l[k]) - c[k]) * amount
        }
        data[i++] = c[0]
        data[i++] = c[1]
        data[i++] = c[2]
      }
  return { size, data }
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas

const VERT = `#version 300 es
in vec2 p;
out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler2D img;
uniform sampler3D lut;
uniform float size;
in vec2 uv;
out vec4 color;
void main() {
  vec4 c = texture(img, vec2(uv.x, 1.0 - uv.y));
  vec3 rgb = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
  vec3 coord = (clamp(rgb, 0.0, 1.0) * (size - 1.0) + 0.5) / size;
  vec3 graded = texture(lut, coord).rgb;
  color = vec4(graded * c.a, c.a);
}`

/** Applies baked LUTs to canvases on the GPU. One per renderer. */
export class LutPass {
  private gl: WebGL2RenderingContext
  private canvas: AnyCanvas
  private program: WebGLProgram
  private image: WebGLTexture
  private luts = new WeakMap<Lut, WebGLTexture>()
  private sizeLoc: WebGLUniformLocation | null

  static create(): LutPass | null {
    try {
      const canvas: AnyCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(2, 2) : document.createElement('canvas')
      const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false }) as WebGL2RenderingContext | null
      return gl ? new LutPass(canvas, gl) : null
    } catch {
      return null
    }
  }

  private constructor(canvas: AnyCanvas, gl: WebGL2RenderingContext) {
    this.canvas = canvas
    this.gl = gl
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error')
      return s
    }
    const program = gl.createProgram()!
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERT))
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link error')
    this.program = program
    gl.useProgram(program)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(program, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    gl.uniform1i(gl.getUniformLocation(program, 'img'), 0)
    gl.uniform1i(gl.getUniformLocation(program, 'lut'), 1)
    this.sizeLoc = gl.getUniformLocation(program, 'size')
    this.image = gl.createTexture()!
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.image)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  private texture(lut: Lut): WebGLTexture {
    let tex = this.luts.get(lut)
    if (tex) return tex
    const gl = this.gl
    tex = gl.createTexture()!
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_3D, tex)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, lut.size, lut.size, lut.size, 0, gl.RGB, gl.FLOAT, lut.data)
    this.luts.set(lut, tex)
    return tex
  }

  /** Grades `target` in place through `lut`. */
  apply(target: AnyCanvas, lut: Lut) {
    const gl = this.gl
    const { width, height } = target
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }
    gl.viewport(0, 0, width, height)
    gl.useProgram(this.program)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_3D, this.texture(lut))
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.image)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, target as TexImageSource)
    gl.uniform1f(this.sizeLoc, lut.size)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    const ctx = target.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.filter = 'none'
    ctx.globalCompositeOperation = 'copy'
    ctx.drawImage(this.canvas, 0, 0)
    ctx.restore()
  }
}

/** CPU fallback when WebGL2 is unavailable: slower, same result. */
export function applyLutCpu(target: AnyCanvas, lut: Lut) {
  const ctx = target.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  const img = ctx.getImageData(0, 0, target.width, target.height)
  const d = img.data
  const out = [0, 0, 0]
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    sampleLut(lut, d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, out)
    d[i] = Math.round(out[0] * 255)
    d[i + 1] = Math.round(out[1] * 255)
    d[i + 2] = Math.round(out[2] * 255)
  }
  ctx.putImageData(img, 0, 0)
}
