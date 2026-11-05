#!/usr/bin/env node
// Finds the beats of a music file, for cutting on the music:
//
//   npm run beats -- music.mp3            → music.beats.json next to it
//
// The JSON ({ bpm, beats, downbeats, energy, hits, confidence }) goes in a composition as a
// "beats" asset; see "Cutting on the music" in docs/MOTION.md.

import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import { analyzeBeats } from '../src/engine/beats.ts'

const [input, ...rest] = process.argv.slice(2)
if (!input || input.startsWith('-')) {
  console.error('usage: npm run beats -- <music file> [-o out.json]')
  process.exit(1)
}
const oi = rest.indexOf('-o')
const out = resolve(oi >= 0 ? rest[oi + 1] : input.replace(new RegExp(`${extname(input).replace('.', '\\.')}$`), '') + '.beats.json')
const rate = 22050
const r = spawnSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-i', input, '-vn', '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-'], {
  maxBuffer: 1 << 30,
})
if (r.status !== 0) {
  console.error(`ffmpeg could not read ${input}: ${r.stderr?.toString().trim()}`)
  process.exit(1)
}
const samples = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength / 4)
const started = Date.now()
const a = analyzeBeats(samples, rate)
writeFileSync(out, JSON.stringify({ source: basename(input), duration: Math.round((samples.length / rate) * 1000) / 1000, ...a }) + '\n')
console.log(`${out}`)
console.log(`${a.bpm} BPM, ${a.beats.length} beat, affidabilità ${a.confidence} (${((Date.now() - started) / 1000).toFixed(1)} s)`)
console.log(`primi beat: ${a.beats.slice(0, 8).map((b) => b.toFixed(2)).join(' ')}`)
console.log(`inizio battute (beat n.): ${a.downbeats.slice(0, 8).join(' ')}${a.downbeats.length > 8 ? ' …' : ''}`)
if (a.hits.length) console.log(`stacchi forti (beat n. → secondi): ${a.hits.map((i) => `${i} → ${a.beats[i].toFixed(2)}`).join(', ')}`)
if (a.confidence < 0.3) console.log('attenzione: il ritmo è poco regolare, i beat sono stime')
