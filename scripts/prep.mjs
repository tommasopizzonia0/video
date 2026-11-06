#!/usr/bin/env node
// Clip prep before editing: measures shake and noise, and fixes what post can fix.
//
//   npm run prep -- clip.mp4                       → only the report: shake, background noise, hum
//   npm run prep -- clip.mp4 --stabilize --denoise → clip-prep.mp4, then the same report on it
//
// Options:
//   --stabilize        smooth out handheld shake (vid.stab, two passes); the picture is enlarged a
//                      little to hide the moving edges, the report says how much
//   --tripod           as if the camera were locked off (for shots meant to be still)
//   --smooth <s>       seconds of camera move kept by --stabilize (default 1; more = steadier, floatier)
//   --grain <light|strong>  remove video noise/grain (non-local means: good but slow)
//   --denoise [deep|voice|fft]  lower the background noise:
//                      deep (default when installed): DeepFilterNet, a neural network trained on
//                        speech, the most natural; needs the `deep-filter` program (see docs/MOTION.md)
//                      voice: RNNoise (scripts/models, BSD licence), lighter, can sound metallic
//                      fft: classic spectral filter, for ambience, music or nature sounds
//                      deep and voice treat everything that is not speech as noise
//   --keep <dB>        with deep: at most this much noise reduction (e.g. 20), leaving a little
//                      room sound for a more natural result (default: no limit)
//   --hum [50|60]      remove mains hum (found automatically when no frequency is given)
//   -o <file>          output (default: <clip>-prep.mp4)

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { globalMotion, measureNoise, measureShake, parseTrf } from '../src/engine/prep.ts'

const args = process.argv.slice(2)
const input = args[0] && resolve(args[0])
if (!input || input.startsWith('-') || !existsSync(input)) {
  console.error('usage: npm run prep -- <clip> [--stabilize] [--tripod] [--smooth <s>] [--grain light|strong] [--denoise [deep|voice|fft]] [--keep <dB>] [--hum [50|60]] [-o out.mp4]')
  process.exit(1)
}
const has = (f) => args.includes(f)
const value = (f) => {
  const i = args.indexOf(f)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('-') ? args[i + 1] : undefined
}
const stabilize = has('--stabilize') || has('--tripod')
const tripod = has('--tripod')
const smoothSec = Number(value('--smooth') ?? 1)
const grain = has('--grain') ? (value('--grain') ?? 'light') : undefined
const deepFilter = process.env.DEEP_FILTER || 'deep-filter'
const hasDeep = () => spawnSync(deepFilter, ['--version']).status === 0
let denoise = has('--denoise') ? value('--denoise') : undefined
if (has('--denoise') && !denoise) {
  denoise = hasDeep() ? 'deep' : 'voice'
  if (denoise === 'voice') console.log('DeepFilterNet non trovato (deep-filter): uso RNNoise, più metallico; vedi docs/MOTION.md per installarlo')
}
if (denoise && !['deep', 'voice', 'fft'].includes(denoise)) {
  console.error('--denoise: deep, voice o fft')
  process.exit(1)
}
if (denoise === 'deep' && !hasDeep()) {
  console.error(`non trovo ${deepFilter}: scaricalo da github.com/Rikorose/DeepFilterNet/releases o imposta DEEP_FILTER`)
  process.exit(1)
}
const keep = value('--keep')
const humArg = has('--hum') ? Number(value('--hum') ?? 0) : undefined
if (grain && !['light', 'strong'].includes(grain)) {
  console.error('--grain: light o strong')
  process.exit(1)
}
const fixing = stabilize || grain || denoise || humArg !== undefined
const out = resolve(value('-o') ?? input.slice(0, input.length - extname(input).length) + '-prep.mp4')

const tmp = mkdtempSync(join(tmpdir(), 'prep-'))
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }))

function run(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { maxBuffer: 1 << 30, ...opts })
  if (r.status !== 0) {
    console.error(`${cmd} non è riuscito: ${(r.stderr ?? '').toString().trim().split('\n').slice(-3).join('\n')}`)
    process.exit(1)
  }
  return r
}

function probe(file) {
  const r = run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate:format=duration', '-of', 'json', file], { encoding: 'utf8' })
  const j = JSON.parse(r.stdout)
  const v = j.streams.find((s) => s.codec_type === 'video')
  const [a, b] = (v?.r_frame_rate ?? '30/1').split('/').map(Number)
  return { width: v?.width, height: v?.height, fps: a / (b || 1), duration: Number(j.format.duration), video: !!v, audio: j.streams.some((s) => s.codec_type === 'audio') }
}

/** Shake and noise of a file; writes the motion fields to `trf` for the stabilizer. */
function analyze(file, info, trf) {
  const result = {}
  if (info.video) {
    run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', file, '-vf', `vidstabdetect=shakiness=8:accuracy=15:stepsize=6:result=${trf}`, '-f', 'null', '-'])
    const motions = parseTrf(readFileSync(trf, 'utf8')).map(globalMotion)
    result.shake = measureShake(motions, info.width, info.height, Math.round(info.fps * smoothSec))
  }
  if (info.audio) {
    const r = run('ffmpeg', ['-nostdin', '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'])
    result.noise = measureNoise(new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength / 4), 48000)
  }
  return result
}

function describe(a) {
  const lines = []
  if (a.shake) {
    const s = a.shake
    const level = s.jitterPct < 0.15 ? 'ferma' : s.jitterPct < 0.5 ? 'un po’ mossa' : 'mossa'
    lines.push(`  immagine ${level}: tremolio ${s.jitter} px (${s.jitterPct}% della larghezza); per stabilizzarla va ingrandita al massimo del ${s.zoom}% circa`)
  }
  if (a.noise) {
    const n = a.noise
    const gap = Math.round((n.signal - n.floor) * 10) / 10
    const level = gap > 45 ? 'pulito' : gap > 30 ? 'con un po’ di fondo' : 'rumoroso'
    lines.push(`  audio ${level}: fondo ${n.floor} dBFS, ${gap} dB sotto le parti forti${n.hum ? `; ronzio di rete a ${n.hum} Hz` : ''}`)
  }
  return lines
}

const info = probe(input)
console.log(`${input}: ${info.video ? `${info.width}×${info.height} ${Math.round(info.fps * 100) / 100} fps, ` : ''}${info.duration.toFixed(1)} s`)
const trf = join(tmp, 'motion.trf')
const t0 = Date.now()
const before = analyze(input, info, trf)
for (const l of describe(before)) console.log(l)

if (!fixing) {
  const tips = []
  if (before.shake && before.shake.jitterPct >= 0.15) tips.push('--stabilize')
  if (before.noise && before.noise.signal - before.noise.floor <= 45) tips.push('--denoise')
  if (before.noise?.hum) tips.push('--hum')
  console.log(tips.length ? `consiglio: npm run prep -- ${input} ${tips.join(' ')}` : 'niente da sistemare')
  process.exit(0)
}

const vf = []
if (stabilize && info.video) {
  const smoothing = Math.max(1, Math.round(info.fps * smoothSec))
  vf.push(`vidstabtransform=input=motion.trf:${tripod ? 'tripod=1' : `smoothing=${smoothing}`}:optzoom=1:interpol=bicubic`, 'unsharp=5:5:0.4:3:3:0')
  if (before.shake.zoom > 10 && !tripod) console.log(`attenzione: serve un ingrandimento del ${before.shake.zoom}%, si perde definizione`)
}
if (grain && info.video) vf.push(grain === 'strong' ? 'nlmeans=s=9:p=7:r=11' : 'nlmeans=s=6:p=7:r=9')

const af = []
const hum = humArg === undefined ? 0 : humArg || before.noise?.hum || 0
if (humArg !== undefined && !hum) console.log('ronzio non trovato: --hum ignorato (indica 50 o 60 per forzarlo)')
if (hum && info.audio) for (const h of [1, 2, 3, 4]) af.push(`bandreject=f=${hum * h}:width_type=q:w=30`)
let cleanWav
if (denoise === 'deep' && info.audio) {
  // DeepFilterNet works on a WAV at 48 kHz: hum out first (when asked), then the network, which
  // handles rumble itself (-D takes back its delay); the result replaces the sound of the clip.
  const pre = af.length ? ['-af', af.join(',')] : []
  af.length = 0
  run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', input, '-vn', ...pre, '-ar', '48000', '-c:a', 'pcm_s16le', join(tmp, 'voce.wav')])
  run(deepFilter, ['-D', ...(keep ? ['-a', String(Number(keep))] : []), '-o', join(tmp, 'pulita'), join(tmp, 'voce.wav')])
  cleanWav = join(tmp, 'pulita', 'voce.wav')
} else if (denoise && info.audio) {
  // Both filters delay the sound (RNNoise 10 ms, afftdn 25 ms): take it back so lips stay in sync.
  if (denoise === 'voice') {
    copyFileSync(join(dirname(fileURLToPath(import.meta.url)), 'models', 'rnnoise-voce.rnnn'), join(tmp, 'voce.rnnn'))
    af.push('highpass=f=80', 'arnndn=m=voce.rnnn', 'atrim=start=0.010')
  } else af.push('highpass=f=80', 'afftdn=nr=20:nf=-30:tn=1', 'atrim=start=0.025')
  af.push('asetpts=PTS-STARTPTS', `apad=whole_dur=${info.duration}`)
}

const argv = ['-nostdin', '-v', 'error', '-stats', '-y', '-i', input]
if (cleanWav) argv.push('-i', cleanWav, '-map', '0:v?', '-map', '1:a')
if (vf.length) argv.push('-vf', vf.join(','), '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p')
else argv.push('-c:v', 'copy')
if (cleanWav) argv.push('-c:a', 'aac', '-b:a', '192k')
else if (af.length) argv.push('-af', af.join(','), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000')
else argv.push('-c:a', 'copy')
argv.push('-movflags', '+faststart', '-shortest', out)
if (grain) console.log('riduzione della grana: è lenta (circa 0,5–1 s per fotogramma a 1080p)')
// Run inside the temp folder so filter arguments are plain file names (no drive letters to escape).
run('ffmpeg', argv, { stdio: ['ignore', 'inherit', 'pipe'], cwd: tmp })

const after = analyze(out, probe(out), join(tmp, 'after.trf'))
console.log(`\n${out}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
for (const l of describe(after)) console.log(l)
if (before.shake && after.shake && stabilize) console.log(`  tremolio: ${before.shake.jitter} → ${after.shake.jitter} px`)
if (before.noise && after.noise && (denoise || hum)) console.log(`  fondo audio: ${before.noise.floor} → ${after.noise.floor} dBFS`)
