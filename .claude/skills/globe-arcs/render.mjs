#!/usr/bin/env node
// Renders a dotted globe with arcs to MP4 from a small JSON spec.
//   node .claude/skills/globe-arcs/render.mjs spedizioni.globe.json            -> spedizioni.globe.mp4
//   node .claude/skills/globe-arcs/render.mjs spec.json --still 1,4            -> PNG stills to check
//   node .claude/skills/globe-arcs/render.mjs spec.json -o out/globe.mp4 --alpha   (WebM with transparency)
// Run it from the repo root: it uses the repo's Playwright, ffmpeg and the Inter font in node_modules.
import { readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const HERE = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const specPath = args.find((a) => a.endsWith('.json'))
if (!specPath) { console.error('uso: node render.mjs spec.json [-o out.mp4] [--still 1,4] [--alpha]'); process.exit(1) }
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }

const DEFAULTS = {
  width: 1080, height: 1920, fps: 30, duration: 6,
  background: '#05070a', ocean: ['#101820', '#05080c'], rim: 'rgba(90,150,255,0.22)',
  dot: '#9fb3c8', dots: 30000, dotSize: 2.4, accent: '#ff7a1a',
  focus: null, zoom: 1, zoomFrom: 0.85, spinFrom: 70, tiltFrom: 10, settle: 2.2, centerY: 0.5,
  pinStart: 1.4, arcStart: 2.0, arcStagger: 0.22, arcDraw: 1.1, arcHeight: 0.18, bend: 0.18, arcWidth: 4, trail: false,
  labels: true, labelSize: 30, font: 'Inter, system-ui, sans-serif',
}
const spec = { ...DEFAULTS, ...JSON.parse(readFileSync(specPath, 'utf8')) }
if (!spec.from || !Array.isArray(spec.to) || !spec.to.length) { console.error('lo spec deve avere "from" {name, lat, lon} e "to" [...]'); process.exit(1) }
const alpha = args.includes('--alpha')
if (alpha) spec.background = 'transparent'

const require = createRequire(join(process.cwd(), 'package.json'))
const { chromium } = require('playwright')
let fontCss = ''
try {
  const f = join(dirname(require.resolve('@fontsource-variable/inter/package.json')), 'files/inter-latin-wght-normal.woff2')
  fontCss = `@font-face{font-family:Inter;font-weight:100 900;src:url(data:font/woff2;base64,${readFileSync(f).toString('base64')})}`
} catch { console.warn('Inter non trovato in node_modules: uso il font di sistema') }

let browser
try { browser = await chromium.launch({ channel: 'chrome' }) } catch { browser = await chromium.launch() }
const page = await browser.newPage({ viewport: { width: spec.width, height: spec.height } })
await page.goto(pathToFileURL(join(HERE, 'globe.html')).href)
await page.addStyleTag({ content: fontCss })
await page.evaluate(([s, land]) => { window.SPEC = s; window.LAND = land }, [spec, JSON.parse(readFileSync(join(HERE, 'land-50m.json'), 'utf8'))])
await page.evaluate(() => document.fonts.load('600 30px Inter'))
const info = await page.evaluate(() => window.init())
console.log(`globo: ${info.dots} punti di terra`)

const frame = async (t) => {
  const url = await page.evaluate((t) => { window.draw(t); return document.getElementById('c').toDataURL('image/png') }, t)
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
}

const base = specPath.replace(/(\.globe)?\.json$/, '')
if (opt('--still')) {
  for (const s of opt('--still').split(',').map(Number)) {
    const out = `${base}-${s}s.png`; writeFileSync(out, await frame(s)); console.log('→', out)
  }
} else {
  const out = resolve(opt('-o') || `${base}.globe.${alpha ? 'webm' : 'mp4'}`)
  const enc = alpha
    ? ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '6M', '-auto-alt-ref', '0']
    : ['-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
  const ff = spawn(process.env.FFMPEG || 'ffmpeg', ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(spec.fps), '-c:v', 'png', '-i', '-', ...enc, out], { stdio: ['pipe', 'inherit', 'inherit'] })
  const n = Math.round(spec.duration * spec.fps)
  for (let i = 0; i < n; i++) {
    const buf = await frame(i / spec.fps)
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r))
    if (i % 30 === 0) process.stdout.write(`\r${i}/${n}`)
  }
  ff.stdin.end()
  await new Promise((r, j) => ff.on('close', (c) => (c ? j(new Error('ffmpeg ' + c)) : r())))
  console.log(`\r→ ${out}`)
}
await browser.close()
