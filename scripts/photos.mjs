#!/usr/bin/env node
// Searches free photo archives for pictures usable in a paid ad, downloads the best ones, and
// writes a contact sheet and the credits:
//
//   npm run photos -- "olive tree in pot" --orient tall -n 12      → foto/olive-tree-in-pot/
//
// Only licences that allow commercial use and editing are kept: CC0, public domain, CC BY (credit
// needed), Pexels and Pixabay licences; CC BY-SA only with --sa. Search in English: the archives
// are tagged mostly in English.
//
// Options:
//   -n <count>         photos to download (default 12)
//   --orient <tall|wide|square>
//   --min <px>         shortest side (default 1080)
//   --sa               accept CC BY-SA (share-alike)
//   --sources <list>   comma-separated: pexels, pixabay, openverse, wikimedia
//                      (default: all; pexels needs PEXELS_API_KEY or a network secret, pixabay PIXABAY_API_KEY)
//   -o <dir>           output folder (default foto/<query>)

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { adUse, choosePhotos, creditLine, fromOpenverse, fromPexels, fromPixabay, fromWikimedia } from '../src/engine/photos.ts'

const args = process.argv.slice(2)
const query = args[0]
if (!query || query.startsWith('-')) {
  console.error('usage: npm run photos -- "<search>" [-n 12] [--orient tall|wide|square] [--min 1080] [--sa] [--sources pexels,pixabay,openverse,wikimedia] [-o dir]')
  process.exit(1)
}
const value = (f) => {
  const i = args.indexOf(f)
  return i >= 0 ? args[i + 1] : undefined
}
const count = Number(value('-n') ?? 12)
const filter = { minSide: Number(value('--min') ?? 1080), orientation: value('--orient'), shareAlike: args.includes('--sa') }
if (filter.orientation && !['tall', 'wide', 'square'].includes(filter.orientation)) {
  console.error('--orient: tall, wide o square')
  process.exit(1)
}
const slug = query.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const dir = resolve(value('-o') ?? join('foto', slug))
const UA = 'video-editor/0.1 (+https://github.com/tommasopizzonia0/video)'

// Pexels' key can also come as a network secret that adds the Authorization header on its own.
const available = {
  pexels: true,
  pixabay: !!process.env.PIXABAY_API_KEY,
  openverse: true,
  wikimedia: true,
}
const asked = value('--sources')?.split(',').map((s) => s.trim())
const sources = (asked ?? Object.keys(available)).filter((s) => {
  if (!(s in available)) {
    console.error(`fonte sconosciuta: ${s}`)
    process.exit(1)
  }
  if (!available[s] && asked) console.log(`${s}: manca PIXABAY_API_KEY (chiave gratuita dal sito), salto`)
  return available[s]
})

function curl(url, out, headers = []) {
  const argv = ['-sSLf', '--max-time', '60', '-A', UA, ...headers.flatMap((h) => ['-H', h]), url]
  if (out) argv.push('-o', out)
  const r = spawnSync('curl', argv, { maxBuffer: 1 << 28, encoding: out ? undefined : 'utf8' })
  if (r.status !== 0) {
    const err = (r.stderr ?? '').toString().trim() || `curl ${r.status}`
    if (/error: 429/.test(err)) throw new Error('troppe richieste da questa rete, riprova fra qualche minuto (429)')
    if (/error: 401|error: 403/.test(err) && url.includes('pexels')) throw new Error('chiave Pexels mancante o non valida (PEXELS_API_KEY)')
    throw new Error(err)
  }
  return r.stdout
}

const q = encodeURIComponent(query)
const searches = {
  openverse: () => {
    const aspect = filter.orientation ? `&aspect_ratio=${filter.orientation}` : ''
    return fromOpenverse(JSON.parse(curl(`https://api.openverse.org/v1/images/?q=${q}&page_size=20&license_type=commercial,modification&size=large&mature=false${aspect}`)))
  },
  wikimedia: () =>
    fromWikimedia(
      JSON.parse(
        curl(
          `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(`${query} filetype:bitmap`)}&gsrnamespace=6&gsrlimit=40&prop=imageinfo&iiprop=url|size|extmetadata`,
        ),
      ),
    ),
  pexels: () => {
    const o = { tall: '&orientation=portrait', wide: '&orientation=landscape', square: '&orientation=square' }[filter.orientation] ?? ''
    return fromPexels(JSON.parse(curl(`https://api.pexels.com/v1/search?query=${q}&per_page=40${o}`, null, process.env.PEXELS_API_KEY ? [`Authorization: ${process.env.PEXELS_API_KEY}`] : [])))
  },
  pixabay: () => {
    const o = { tall: '&orientation=vertical', wide: '&orientation=horizontal' }[filter.orientation] ?? ''
    return fromPixabay(JSON.parse(curl(`https://pixabay.com/api/?key=${process.env.PIXABAY_API_KEY}&q=${q}&image_type=photo&per_page=40&safesearch=true${o}`)))
  },
}

let found = []
for (const s of sources) {
  try {
    const r = searches[s]()
    console.log(`${s}: ${r.length} risultati`)
    found.push(...r)
  } catch (e) {
    console.log(`${s}: ricerca non riuscita (${e.message.split('\n')[0]})`)
  }
}
const ranked = choosePhotos(found, filter)
console.log(`${ranked.length} con licenza adatta e almeno ${filter.minSide} px${filter.orientation ? `, ${filter.orientation}` : ''}`)
if (!ranked.length) process.exit(1)

mkdirSync(dir, { recursive: true })
const tmp = join(dir, '.scarico')
mkdirSync(tmp, { recursive: true })
const kept = []
for (const p of ranked) {
  if (kept.length >= count) break
  const n = String(kept.length + 1).padStart(2, '0')
  const raw = join(tmp, n)
  const file = join(dir, `${n}-${p.source}.jpg`)
  try {
    curl(p.url, raw)
  } catch (e) {
    console.log(`  salto ${p.page}: download non riuscito (${e.message.split('\n')[0]})`)
    continue
  }
  // At most 2560 px on the long side, as a JPEG; then check the real size, which archives sometimes misreport.
  const r = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', raw, '-vf', "scale='min(2560,iw)':'min(2560,ih)':force_original_aspect_ratio=decrease", '-q:v', '2', '-frames:v', '1', file])
  if (r.status !== 0) {
    console.log(`  salto ${p.page}: non è un'immagine leggibile`)
    continue
  }
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', raw], { encoding: 'utf8' })
  const [w, h] = probe.stdout.trim().split(',').map(Number)
  if (Math.min(w, h) < filter.minSide) {
    console.log(`  salto ${p.page}: in realtà è ${w}×${h}`)
    rmSync(file, { force: true })
    continue
  }
  kept.push({ file: `${n}-${p.source}.jpg`, ...p, width: w, height: h })
}
rmSync(tmp, { recursive: true, force: true })
if (!kept.length) {
  console.log('nessuna foto scaricata')
  process.exit(1)
}

// Contact sheet: every photo in a 400 px square, numbered.
const font = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 'C:/Windows/Fonts/arialbd.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf'].find(existsSync)
if (kept.length) {
  const cols = Math.min(4, kept.length)
  const inputs = kept.flatMap((k) => ['-i', join(dir, k.file)])
  const label = (i) => (font ? `,drawtext=fontfile='${font.replace(/:/g, '\\:')}':text='${i + 1}':x=12:y=10:fontsize=44:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8` : '')
  const cells = kept.map((_, i) => `[${i}]scale=400:400:force_original_aspect_ratio=decrease,pad=400:400:(ow-iw)/2:(oh-ih)/2:color=0x202020${label(i)}[c${i}]`)
  const layout = kept.map((_, i) => `${(i % cols) * 400}_${Math.floor(i / cols) * 400}`).join('|')
  const graph = `${cells.join(';')};${kept.map((_, i) => `[c${i}]`).join('')}xstack=inputs=${kept.length}:layout=${layout}:fill=0x202020`
  const r = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', ...inputs, '-filter_complex', kept.length > 1 ? graph : cells[0].replace(/\[c0\]$/, ''), '-frames:v', '1', join(dir, 'provini.jpg')])
  if (r.status !== 0) console.log('provini non creati: ' + r.stderr.toString().trim().split('\n').pop())
}

const credits = kept.map((k) => ({ file: k.file, source: k.source, title: k.title, creator: k.creator, page: k.page, licence: k.licenceName, licenceUrl: k.licenceUrl, credit: adUse(k, filter).credit, restrictions: k.restrictions, line: creditLine(k) }))
writeFileSync(join(dir, 'crediti.json'), JSON.stringify({ query, credits }, null, 2) + '\n')
const lines = [
  `Foto per "${query}"`,
  '',
  'Da citare nell’annuncio o nella descrizione:',
  ...(credits.filter((c) => c.credit).map((c) => `  ${c.file}: ${c.line}`) || []),
  ...(credits.some((c) => c.credit) ? [] : ['  nessuna']),
  '',
  'Senza obbligo di citazione:',
  ...credits.filter((c) => !c.credit).map((c) => `  ${c.file}: ${c.licence}, ${c.creator} (${c.page})`),
  '',
  'Le licenze coprono il diritto d’autore della foto, non le persone riconoscibili né i marchi',
  'che vi compaiono: per un annuncio servono il consenso delle persone e nessun marchio altrui.',
]
for (const c of credits.filter((c) => c.restrictions.length)) lines.push(`Attenzione ${c.file}: l'archivio segnala ${c.restrictions.join(', ')}`)
writeFileSync(join(dir, 'CREDITI.txt'), lines.join('\n') + '\n')

console.log(`\n${dir}`)
for (const c of credits) console.log(`  ${c.file}  ${c.licence}${c.credit ? ' (citare)' : ''}  ${c.creator}`)
console.log(`provini.jpg, CREDITI.txt, crediti.json`)
