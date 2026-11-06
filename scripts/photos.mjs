#!/usr/bin/env node
// Searches free archives for photos, illustrations and video clips usable in a paid ad, downloads
// the best ones, and writes a contact sheet and the credits:
//
//   npm run photos -- "olive tree in pot" --orient tall -n 12      → foto/olive-tree-in-pot/
//   npm run photos -- "olive grove drone" --video --orient wide    → foto/olive-grove-drone/*.mp4
//
// Only licences that allow commercial use and editing are kept: CC0, public domain, CC BY (credit
// needed), Pexels and Pixabay licences; CC BY-SA only with --sa. Search in English: the archives
// are tagged mostly in English.
//
// Options:
//   -n <count>         files to download (default 12; 6 for videos)
//   --video            video clips (Pexels, Pixabay) instead of pictures
//   --cutout           also remove the background of each picture (npm run cutout), for a studio layer
//   --kind <photo|illustration|vector>  type of picture (illustrations and vectors: Pixabay, Openverse)
//   --max-duration <s> videos: longest clip
//   --lang <code>      language of the search words for Pixabay and Pexels (e.g. it; default en)
//   --orient <tall|wide|square>
//   --min <px>         shortest side (default 1080)
//   --sa               accept CC BY-SA (share-alike)
//   --sources <list>   comma-separated: pexels, pixabay, openverse, wikimedia
//                      (default: all; pexels needs PEXELS_API_KEY or a network secret, pixabay PIXABAY_API_KEY)
//   -o <dir>           output folder (default foto/<query>)

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { adUse, choosePhotos, creditLine, fromOpenverse, fromPexels, fromPexelsVideos, fromPixabay, fromPixabayVideos, fromWikimedia } from '../src/engine/photos.ts'

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
const video = args.includes('--video')
const kind = value('--kind') ?? 'photo'
if (!['photo', 'illustration', 'vector'].includes(kind)) {
  console.error('--kind: photo, illustration o vector')
  process.exit(1)
}
const lang = value('--lang') ?? 'en'
const count = Number(value('-n') ?? (video ? 6 : 12))
const filter = {
  minSide: Number(value('--min') ?? 1080),
  orientation: value('--orient'),
  shareAlike: args.includes('--sa'),
  maxDuration: value('--max-duration') ? Number(value('--max-duration')) : undefined,
}
if (filter.orientation && !['tall', 'wide', 'square'].includes(filter.orientation)) {
  console.error('--orient: tall, wide o square')
  process.exit(1)
}
const slug = query.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const dir = resolve(value('-o') ?? join('foto', slug))
const UA = 'video-editor/0.1 (+https://github.com/tommasopizzonia0/video)'

// Pexels' key can also come as a network secret that adds the Authorization header on its own.
const available = {
  pexels: kind === 'photo',
  pixabay: !!process.env.PIXABAY_API_KEY,
  // No videos there; Wikimedia search does not tell photos from drawings.
  openverse: !video && kind !== 'vector',
  wikimedia: !video && kind === 'photo',
}
const asked = value('--sources')?.split(',').map((s) => s.trim())
const sources = (asked ?? Object.keys(available)).filter((s) => {
  if (!(s in available)) {
    console.error(`fonte sconosciuta: ${s}`)
    process.exit(1)
  }
  if (!available[s] && asked) console.log(s === 'pixabay' ? 'pixabay: manca PIXABAY_API_KEY (chiave gratuita dal sito), salto' : `${s}: non ha ${video ? 'video' : kind}, salto`)
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
const pexelsAuth = process.env.PEXELS_API_KEY ? [`Authorization: ${process.env.PEXELS_API_KEY}`] : []
const pexelsLocale = lang === 'en' ? '' : `&locale=${lang}-${lang.toUpperCase()}`
const searches = {
  openverse: () => {
    const aspect = filter.orientation ? `&aspect_ratio=${filter.orientation}` : ''
    const category = kind === 'illustration' ? '&category=illustration' : '&category=photograph'
    return fromOpenverse(JSON.parse(curl(`https://api.openverse.org/v1/images/?q=${q}&page_size=20&license_type=commercial,modification&size=large&mature=false${aspect}${category}`)))
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
    if (video) return fromPexelsVideos(JSON.parse(curl(`https://api.pexels.com/videos/search?query=${q}&per_page=40${o}${pexelsLocale}`, null, pexelsAuth)))
    return fromPexels(JSON.parse(curl(`https://api.pexels.com/v1/search?query=${q}&per_page=40${o}${pexelsLocale}`, null, pexelsAuth)))
  },
  pixabay: () => {
    const key = `key=${process.env.PIXABAY_API_KEY}&q=${q}&lang=${lang}&per_page=40&safesearch=true`
    if (video) return fromPixabayVideos(JSON.parse(curl(`https://pixabay.com/api/videos/?${key}&video_type=film`)))
    const o = { tall: '&orientation=vertical', wide: '&orientation=horizontal' }[filter.orientation] ?? ''
    return fromPixabay(JSON.parse(curl(`https://pixabay.com/api/?${key}&image_type=${kind}${o}`)))
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
  const name = `${n}-${p.source}.${video ? 'mp4' : 'jpg'}`
  const file = join(dir, name)
  try {
    curl(p.url, raw)
  } catch (e) {
    console.log(`  salto ${p.page}: download non riuscito (${e.message.split('\n')[0]})`)
    continue
  }
  // Pictures: at most 2560 px on the long side, as a JPEG. Videos: kept as they are (remuxed with
  // faststart). Then the real size is checked: archives sometimes misreport it.
  const convert = video
    ? ['-i', raw, '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', '-movflags', '+faststart', file]
    : ['-i', raw, '-vf', "scale='min(2560,iw)':'min(2560,ih)':force_original_aspect_ratio=decrease", '-q:v', '2', '-frames:v', '1', file]
  const r = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', ...convert])
  if (r.status !== 0) {
    console.log(`  salto ${p.page}: non è ${video ? 'un video' : "un'immagine"} leggibile`)
    continue
  }
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', raw], { encoding: 'utf8' })
  const [w, h] = probe.stdout.trim().split(',').map(Number)
  if (Math.min(w, h) < filter.minSide) {
    console.log(`  salto ${p.page}: in realtà è ${w}×${h}`)
    rmSync(file, { force: true })
    continue
  }
  kept.push({ file: name, ...p, width: w, height: h })
}
rmSync(tmp, { recursive: true, force: true })
if (!kept.length) {
  console.log(`nessun${video ? ' video' : 'a foto'} scaricat${video ? 'o' : 'a'}`)
  process.exit(1)
}

// Contact sheet: every photo in a 400 px square, numbered.
const font = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 'C:/Windows/Fonts/arialbd.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf'].find(existsSync)
if (kept.length) {
  const cols = Math.min(4, kept.length)
  // Videos: the frame at 1 s (or the first, for shorter clips).
  const inputs = kept.flatMap((k) => [...(video && (k.duration ?? 0) > 1.5 ? ['-ss', '1'] : []), '-i', join(dir, k.file)])
  const label = (i) => (font ? `,drawtext=fontfile='${font.replace(/:/g, '\\:')}':text='${i + 1}':x=12:y=10:fontsize=44:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8` : '')
  const cells = kept.map((_, i) => `[${i}]scale=400:400:force_original_aspect_ratio=decrease,pad=400:400:(ow-iw)/2:(oh-ih)/2:color=0x202020${label(i)}[c${i}]`)
  const layout = kept.map((_, i) => `${(i % cols) * 400}_${Math.floor(i / cols) * 400}`).join('|')
  const graph = `${cells.join(';')};${kept.map((_, i) => `[c${i}]`).join('')}xstack=inputs=${kept.length}:layout=${layout}:fill=0x202020`
  const r = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', ...inputs, '-filter_complex', kept.length > 1 ? graph : cells[0].replace(/\[c0\]$/, ''), '-frames:v', '1', join(dir, 'provini.jpg')])
  if (r.status !== 0) console.log('provini non creati: ' + r.stderr.toString().trim().split('\n').pop())
}

const credits = kept.map((k) => ({ file: k.file, source: k.source, ...(video ? { duration: k.duration, size: `${k.width}×${k.height}` } : {}), title: k.title, creator: k.creator, page: k.page, licence: k.licenceName, licenceUrl: k.licenceUrl, credit: adUse(k, filter).credit, restrictions: k.restrictions, line: creditLine(k) }))
writeFileSync(join(dir, 'crediti.json'), JSON.stringify({ query, credits }, null, 2) + '\n')
const lines = [
  `${video ? "Video" : "Foto"} per "${query}"`,
  '',
  'Da citare nell’annuncio o nella descrizione:',
  ...(credits.filter((c) => c.credit).map((c) => `  ${c.file}: ${c.line}`) || []),
  ...(credits.some((c) => c.credit) ? [] : ['  nessuna']),
  '',
  'Senza obbligo di citazione:',
  ...credits.filter((c) => !c.credit).map((c) => `  ${c.file}: ${c.licence}, ${c.creator} (${c.page})`),
  '',
  'Le licenze coprono il diritto d’autore del file, non le persone riconoscibili né i marchi',
  'che vi compaiono: per un annuncio servono il consenso delle persone e nessun marchio altrui.',
]
for (const c of credits.filter((c) => c.restrictions.length)) lines.push(`Attenzione ${c.file}: l'archivio segnala ${c.restrictions.join(', ')}`)
writeFileSync(join(dir, 'CREDITI.txt'), lines.join('\n') + '\n')

console.log(`\n${dir}`)
for (const c of credits) console.log(`  ${c.file}  ${video ? `${c.size} ${c.duration}s  ` : ''}${c.licence}${c.credit ? ' (citare)' : ''}  ${c.creator}`)
console.log(`provini.jpg, CREDITI.txt, crediti.json`)

if (args.includes('--cutout') && !video) {
  console.log('')
  const r = spawnSync(process.execPath, [join(import.meta.dirname, 'cutout.mjs'), ...kept.map((k) => join(dir, k.file))], { stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
