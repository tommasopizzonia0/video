#!/usr/bin/env node
// Searches Openverse (Freesound effects, Jamendo and ccMixter music) for sounds usable in a paid ad,
// downloads the best ones and writes the credits. No API key needed.
//
//   npm run sounds -- "whoosh transition" -n 8 --max 3          → suoni/whoosh-transition/
//   npm run sounds -- "upbeat corporate" --music -n 6 --min 30   → suoni/upbeat-corporate/
//
// Only licences that allow commercial use and editing are kept: CC0 and public domain (no credit),
// CC BY (credit needed in the ad or its description). With --cc0 only no-credit sounds are kept.
//
// Options:
//   -n <count>       files to download (default 8)
//   --music          music tracks instead of sound effects
//   --min <s>        shortest length in seconds      --max <s>  longest length in seconds
//   --cc0            only CC0 / public domain
//   -o <dir>         output folder (default live/suoni/<query>, shown in the studio's Caricamenti)

import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const query = args[0]
if (!query || query.startsWith('-')) {
  console.error('usage: npm run sounds -- "<search>" [-n 8] [--music] [--min s] [--max s] [--cc0] [-o dir]')
  process.exit(1)
}
const value = (f) => {
  const i = args.indexOf(f)
  return i >= 0 ? args[i + 1] : undefined
}
const music = args.includes('--music')
const count = Number(value('-n') ?? 8)
const minS = value('--min') !== undefined ? Number(value('--min')) : music ? 20 : 0
const maxS = value('--max') !== undefined ? Number(value('--max')) : music ? 400 : 12
const cc0 = args.includes('--cc0')
const slug = query.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const dir = resolve(value('-o') ?? join(import.meta.dirname, '..', 'live', 'suoni', slug))
const UA = 'video-editor (motion studio; local)'

const OK = cc0 ? ['cc0', 'pdm'] : ['cc0', 'pdm', 'by']
const NAMES = { cc0: 'CC0', pdm: 'Pubblico dominio', by: 'CC BY' }

function curl(url, out) {
  const argv = ['-sSLf', '--max-time', '90', '-A', UA, url]
  if (out) argv.push('-o', out)
  const r = spawnSync('curl', argv, { maxBuffer: 1 << 28, encoding: out ? undefined : 'utf8' })
  if (r.status !== 0) throw new Error((r.stderr ?? '').toString().trim() || `curl ${r.status}`)
  return r.stdout
}

const params = new URLSearchParams({ q: query, license: OK.join(','), page_size: '20' /* anonymous requests: at most 20 */ })
if (music) params.set('category', 'music')
const found = JSON.parse(curl(`https://api.openverse.org/v1/audio/?${params}`)).results ?? []
const seconds = (r) => (r.duration ?? 0) / 1000
const candidates = found
  .filter((r) => OK.includes(r.license) && r.url && seconds(r) >= minS && seconds(r) <= maxS)
  .filter((r) => !music || r.category === 'music' || r.source !== 'freesound')
  // Prefer no-credit licences, then the ones Openverse ranks higher (its order).
  .sort((a, b) => (a.license === 'by') - (b.license === 'by'))

mkdirSync(dir, { recursive: true })
const kept = []
for (const r of candidates) {
  if (kept.length >= count) break
  const n = String(kept.length + 1).padStart(2, '0')
  const name = `${n}-${r.title.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'suono'}.mp3`
  const raw = join(dir, `.${n}.download`)
  try {
    curl(r.url, raw)
  } catch (e) {
    console.log(`  salto ${r.foreign_landing_url}: download non riuscito (${e.message.split('\n')[0]})`)
    continue
  }
  // Re-encoded as a clean MP3 (some sources serve other formats), stereo 48 kHz.
  const out = join(dir, name)
  const c = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', raw, '-vn', '-ac', '2', '-ar', '48000', '-b:a', '192k', out])
  spawnSync(process.platform === 'win32' ? 'cmd' : 'rm', process.platform === 'win32' ? ['/c', 'del', '/q', raw] : ['-f', raw])
  if (c.status !== 0) {
    console.log(`  salto ${r.foreign_landing_url}: non è un audio leggibile`)
    continue
  }
  kept.push({ file: name, title: r.title, creator: r.creator ?? 'sconosciuto', source: r.source, page: r.foreign_landing_url,
    licence: NAMES[r.license] ?? r.license, licenceUrl: r.license_url, credit: r.license === 'by', seconds: Math.round(seconds(r) * 10) / 10 })
}
if (!kept.length) {
  console.error('nessun suono scaricato: prova altre parole (in inglese) o allarga --min/--max')
  process.exit(1)
}

writeFileSync(join(dir, 'crediti.json'), JSON.stringify({ query, music, credits: kept }, null, 2) + '\n')
const line = (k) => `"${k.title}" di ${k.creator} (${k.source}), ${k.licence} ${k.licenceUrl ?? ''}`.trim()
writeFileSync(join(dir, 'CREDITI.txt'), [
  `${music ? 'Musica' : 'Effetti'} per "${query}"`, '',
  'Da citare nell’annuncio o nella descrizione:',
  ...(kept.some((k) => k.credit) ? kept.filter((k) => k.credit).map((k) => `  ${k.file}: ${line(k)}`) : ['  nessuno']), '',
  'Tutti i file:', ...kept.map((k) => `  ${k.file}: ${line(k)}  ${k.page}`), '',
].join('\n'))

console.log(`\n${dir}`)
for (const k of kept) console.log(`  ${k.file}  ${k.seconds}s  ${k.licence}${k.credit ? ' (citare)' : ''}  ${k.creator}`)
