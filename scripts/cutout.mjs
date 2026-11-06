#!/usr/bin/env node
// Background removal for product shots: a transparent PNG of the subject of each photo, ready for a
// `studio` layer, with a contact sheet and checks on the result.
//
//   npm run cutout -- foto/tazza.jpg                → foto/tazza-scontorno.png + provini-scontorno.jpg
//   npm run cutout -- foto/caffe/ -o tagli/        → every picture of the folder
//
// Options:
//   --lite        smaller model: less memory (about 6.5 GB instead of 8) and faster, slightly less precise edges
//   --margin <f>  empty border kept around the subject, as a fraction of its size (default 0.02)
//   -o <dir>      output folder (default: next to each picture)
//
// Uses BiRefNet (MIT licence) through rembg (MIT), on the CPU. Needs Python with
// `pip install "rembg[cpu]"` (CUTOUT_PYTHON points at a virtualenv's python); the model (about 1 GB,
// 200 MB with --lite) downloads from GitHub on first use into ~/.u2net or $U2NET_HOME.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const value = (f) => {
  const i = args.indexOf(f)
  return i >= 0 ? args[i + 1] : undefined
}
const flags = new Set(['--lite'])
const withValue = new Set(['-o', '--margin'])
const inputs = []
for (let i = 0; i < args.length; i++) {
  if (withValue.has(args[i])) i++
  else if (!flags.has(args[i])) inputs.push(resolve(args[i]))
}
if (!inputs.length) {
  console.error('usage: npm run cutout -- <foto o cartella>... [--lite] [--margin 0.02] [-o cartella]')
  process.exit(1)
}

const IMAGES = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const files = []
for (const p of inputs) {
  if (!existsSync(p)) {
    console.error(`non trovo ${p}`)
    process.exit(1)
  }
  if (statSync(p).isDirectory()) {
    for (const f of readdirSync(p).sort()) if (IMAGES.has(extname(f).toLowerCase()) && !f.includes('-scontorno') && !f.startsWith('provini')) files.push(join(p, f))
  } else files.push(p)
}
if (!files.length) {
  console.error('nessuna immagine (jpg, png, webp) da scontornare')
  process.exit(1)
}

const python = process.env.CUTOUT_PYTHON || 'python3'
if (spawnSync(python, ['-c', 'import rembg, onnxruntime'], { stdio: 'ignore' }).status !== 0) {
  console.error(`${python} non ha rembg: installalo con  pip install "rembg[cpu]"  (o imposta CUTOUT_PYTHON sul python di un virtualenv che lo ha)`)
  process.exit(1)
}

const model = args.includes('--lite') ? 'birefnet-general-lite' : 'birefnet-general'
const margin = Number(value('--margin') ?? 0.02)
// One run per output folder, so the model loads once.
const groups = new Map()
for (const f of files) {
  const out = resolve(value('-o') ?? dirname(f))
  mkdirSync(out, { recursive: true })
  groups.set(out, [...(groups.get(out) ?? []), f])
}

const script = join(dirname(fileURLToPath(import.meta.url)), 'cutout.py')
console.log(`scontorno ${files.length} ${files.length === 1 ? 'foto' : 'foto'} con BiRefNet${model.endsWith('lite') ? ' lite' : ''} (circa 20 s ciascuna; la prima volta scarica il modello)`)
let problems = 0
for (const [out, list] of groups) {
  const lines = await new Promise((done, fail) => {
    const p = spawn(python, ['-I', script, model, out, String(margin), ...list], { stdio: ['ignore', 'pipe', 'pipe'] })
    const got = []
    let err = ''
    let buf = ''
    p.stdout.on('data', (d) => {
      buf += d
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (line.trim()) {
          const r = JSON.parse(line)
          got.push(r)
          report(r)
        }
      }
    })
    p.stderr.on('data', (d) => (err += d))
    p.on('close', (code) => {
      if (code === 0) done(got)
      else fail(new Error(code === null || code === 137 ? 'memoria esaurita: chiudi altri programmi o usa --lite' : err.trim().split('\n').slice(-3).join('\n')))
    })
  }).catch((e) => {
    console.error(`scontorno non riuscito: ${e.message}`)
    process.exit(1)
  })
  if (lines.some((r) => r.out)) console.log(`${join(out, 'provini-scontorno.jpg')}: ogni scontorno su fondo scuro e chiaro, controlla i bordi`)
}
if (problems) console.log(`${problems} da controllare`)

function report(r) {
  const name = r.src.split(/[\\/]/).pop()
  if (r.empty) {
    problems++
    console.log(`  ${name}: non ho trovato un soggetto`)
    return
  }
  const notes = []
  if (r.cover > 0.9) notes.push('lo sfondo non si è staccato quasi per niente: forse la foto è tutta soggetto')
  if (r.touches.length) notes.push(`il soggetto è tagliato dal bordo della foto (${r.touches.join(', ')}): sul set apparirà mozzato`)
  if (r.soft > 0.15) notes.push('bordo incerto (capelli, vetro, sfocato): guardalo nel foglio provini')
  if (notes.length) problems++
  console.log(`  ${r.out.split(/[\\/]/).pop()}  ${r.width}×${r.height}  ${r.seconds} s${notes.length ? `\n    attenzione: ${notes.join('; ')}` : ''}`)
}
