#!/usr/bin/env node
// Renders a composition JSON to MP4 (or stills / a contact sheet) with headless Chromium.
//
//   npm run render -- examples/launch.json                    → examples/launch.mp4
//   npm run render -- examples/launch.json -o out/video.mp4
//   npm run render -- examples/launch.json --still 0.5,2,4.25  → PNG stills next to the JSON
//   npm run render -- examples/launch.json --contact 16        → one PNG with 16 frames spread over the video
//   npm run render -- examples/launch.json --scale 0.5         → quick half-size draft
//
// Needs Chromium (`npx playwright install chromium`, or Google Chrome) and, for the best MP4, ffmpeg.

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function usage(msg) {
  if (msg) console.error(`error: ${msg}\n`)
  console.error(`usage: npm run render -- <composition.json> [options]

  -o, --out <file>      output file (default: next to the JSON, .mp4)
  --still <t1,t2,...>   render PNG stills at these times instead of a video
  --contact <n>         render one PNG contact sheet with n frames
  --scale <k>           render at k times the composition size (0.5 = draft)
  --from <s> --to <s>   render only part of the timeline
  --png                 lossless frames (slower; default is high-quality JPEG)
  --crf <n>             x264 quality, lower is better (default 16)
  --no-motion-blur      skip motion blur even if the composition asks for it
  --workers <n>         browser pages rendering in parallel (default: CPU cores - 1)`)
  process.exit(msg ? 1 : 0)
}

function parseArgs(argv) {
  const opts = { scale: 1, crf: 16, motionBlur: true, png: false }
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      if (i + 1 >= argv.length) usage(`${a} needs a value`)
      return argv[++i]
    }
    if (a === '-h' || a === '--help') usage()
    else if (a === '-o' || a === '--out') opts.out = next()
    else if (a === '--still') opts.still = next().split(',').map(Number)
    else if (a === '--contact') opts.contact = Number(next())
    else if (a === '--scale') opts.scale = Number(next())
    else if (a === '--from') opts.from = Number(next())
    else if (a === '--to') opts.to = Number(next())
    else if (a === '--crf') opts.crf = Number(next())
    else if (a === '--png') opts.png = true
    else if (a === '--no-motion-blur') opts.motionBlur = false
    else if (a === '--workers') opts.workers = Number(next())
    else if (a.startsWith('-')) usage(`unknown option ${a}`)
    else rest.push(a)
  }
  if (rest.length !== 1) usage('pass exactly one composition file')
  opts.input = resolve(rest[0])
  return opts
}

const has = (cmd) => spawnSync(cmd, ['-version'], { stdio: 'ignore' }).status === 0

const mime = {
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
}

/** Serves `dir` under `prefix`, with Range support (video decoding reads files in pieces). */
function staticFiles(prefix, dir) {
  return (req, res, next) => {
    if (!req.url.startsWith(prefix)) return next()
    const rel = decodeURIComponent(req.url.slice(prefix.length).split('?')[0])
    const file = resolve(dir, rel)
    if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404
      return res.end('not found')
    }
    const size = statSync(file).size
    res.setHeader('Content-Type', mime[extname(file).toLowerCase()] ?? 'application/octet-stream')
    res.setHeader('Accept-Ranges', 'bytes')
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '')
    if (range) {
      const start = range[1] ? Number(range[1]) : size - Number(range[2])
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      res.statusCode = 206
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
      res.setHeader('Content-Length', end - start + 1)
      return createReadStream(file, { start, end }).pipe(res)
    }
    res.setHeader('Content-Length', size)
    createReadStream(file).pipe(res)
  }
}

async function launchBrowser() {
  const { chromium } = await import('playwright')
  const args = ['--autoplay-policy=no-user-gesture-required']
  // Google Chrome can decode H.264 itself; Playwright's Chromium cannot, so videos get converted first.
  try {
    return { browser: await chromium.launch({ channel: 'chrome', args }), chrome: true }
  } catch {
    try {
      return { browser: await chromium.launch({ args }), chrome: false }
    } catch (e) {
      console.error('Could not start Chromium. Install it with:  npx playwright install chromium')
      throw e
    }
  }
}

/** Converts a video to VP9 WebM, which every Chromium build decodes. Cached by content. */
function toWebm(file, cacheDir) {
  const hash = createHash('sha1').update(file).update(String(statSync(file).mtimeMs)).digest('hex').slice(0, 12)
  const out = join(cacheDir, `${basename(file, extname(file))}-${hash}.webm`)
  if (existsSync(out)) return out
  console.log(`converting ${basename(file)} for Chromium…`)
  const r = spawnSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-i', file, '-an', '-c:v', 'libvpx-vp9', '-crf', '18', '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-g', '30', out],
    { stdio: 'inherit' },
  )
  if (r.status !== 0) throw new Error(`ffmpeg could not convert ${file}`)
  return out
}

function hasAudio(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file], {
    encoding: 'utf8',
  })
  return r.status === 0 && r.stdout.trim().length > 0
}

/** ffmpeg arguments that mix the audio clips; inputs start at index 1 (0 is the frames). */
function audioArgs(mix, assets, projectDir, from, duration) {
  const inputs = []
  const filters = []
  const labels = []
  const files = new Map()
  mix.forEach((clip, i) => {
    const asset = assets[clip.asset]
    if (!asset || /^https?:/.test(asset.src)) return
    const file = resolve(projectDir, asset.src)
    if (!existsSync(file) || !hasAudio(file)) return
    if (!files.has(file)) {
      files.set(file, inputs.length / 2 + 1)
      inputs.push('-i', file)
    }
    const idx = files.get(file)
    // Shift into the rendered range.
    const start = clip.start - from
    const skip = Math.max(0, -start)
    const dur = clip.duration - skip
    if (dur <= 0 || start >= duration) return
    const chain = [
      `atrim=start=${clip.sourceStart + skip * clip.playbackRate}:duration=${dur * clip.playbackRate}`,
      'asetpts=PTS-STARTPTS',
    ]
    if (clip.playbackRate !== 1) chain.push(`atempo=${Math.min(2, Math.max(0.5, clip.playbackRate))}`)
    chain.push(`volume=${clip.volume}`)
    if (clip.fadeIn > 0 && skip < clip.fadeIn) chain.push(`afade=t=in:st=0:d=${clip.fadeIn - skip}`)
    if (clip.fadeOut > 0) chain.push(`afade=t=out:st=${Math.max(0, dur - clip.fadeOut)}:d=${clip.fadeOut}`)
    const delay = Math.round(Math.max(0, start) * 1000)
    chain.push(`adelay=${delay}:all=1`)
    filters.push(`[${idx}:a]${chain.join(',')}[a${i}]`)
    labels.push(`[a${i}]`)
  })
  if (!labels.length) return null
  filters.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest,apad[aout]`)
  return { inputs, filter: filters.join(';') }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const comp = JSON.parse(readFileSync(opts.input, 'utf8'))
  const projectDir = dirname(opts.input)
  const cacheDir = join(tmpdir(), 'video-editor-render-cache')
  mkdirSync(cacheDir, { recursive: true })

  const { createServer } = await import('vite')
  const server = await createServer({
    root,
    configFile: join(root, 'vite.config.ts'),
    logLevel: 'error',
    // No file watching: an edit during a render must not reload the pages.
    server: { port: 0, host: '127.0.0.1', hmr: false, watch: null },
    plugins: [
      {
        name: 'render-files',
        configureServer(s) {
          s.middlewares.use(staticFiles('/__project/', projectDir))
          s.middlewares.use(staticFiles('/__cache/', cacheDir))
        },
      },
    ],
  })
  await server.listen()
  const address = server.httpServer.address()
  const origin = `http://127.0.0.1:${address.port}`

  const { browser, chrome } = await launchBrowser()
  try {
    const openPage = async () => {
      // Separate contexts get separate renderer processes, so pages draw in parallel.
      const context = await browser.newContext()
      const page = await context.newPage()
      page.on('pageerror', (e) => console.error('page error:', e.message))
      page.on('console', (m) => {
        if (m.type() === 'error') console.error('page:', m.text())
      })
      await page.goto(`${origin}/render.html`)
      await page.waitForFunction(() => document.title === 'ready', null, { timeout: 60_000 })
      return page
    }
    const page = await openPage()

    const base = `${origin}/__project/`
    const overrides = {}
    if (!chrome) {
      const bad = await page.evaluate(([c, b]) => window.motion.undecodable(c, b), [comp, base])
      if (bad.length && !has('ffmpeg')) throw new Error(`Chromium cannot decode ${bad.join(', ')}; install ffmpeg or Google Chrome.`)
      for (const src of bad) overrides[src] = `${origin}/__cache/${basename(toWebm(resolve(projectDir, src), cacheDir))}`
    }

    const load = (p) => p.evaluate(([c, b, s, o]) => window.motion.load(c, b, s, o), [comp, base, opts.scale, overrides])
    const info = await load(page)
    for (const i of info.issues) console.error(`${i.level}: ${i.path || '(root)'}: ${i.message}`)
    if (info.issues.some((i) => i.level === 'error')) process.exit(1)
    const { width, height, fps, duration } = info
    const stem = join(projectDir, basename(opts.input, extname(opts.input)))

    if (opts.still) {
      for (const t of opts.still) {
        const data = await page.evaluate(([tt]) => window.motion.frame(tt, 'png', true), [t])
        const file = opts.out && opts.still.length === 1 ? resolve(opts.out) : `${stem}-${t.toFixed(2)}s.png`
        writeFileSync(file, Buffer.from(data, 'base64'))
        console.log(file)
      }
      return
    }
    if (opts.contact) {
      const n = Math.max(1, opts.contact)
      const times = Array.from({ length: n }, (_, i) => (duration * (i + 0.5)) / n)
      const columns = Math.ceil(Math.sqrt((n * height) / width))
      const cellWidth = Math.min(480, Math.round(2400 / columns))
      const data = await page.evaluate(([t, c, w]) => window.motion.contact(t, c, w), [times, columns, cellWidth])
      const file = opts.out ? resolve(opts.out) : `${stem}-contact.png`
      writeFileSync(file, Buffer.from(data, 'base64'))
      console.log(file)
      return
    }

    const from = Math.max(0, opts.from ?? 0)
    const to = Math.min(duration, opts.to ?? duration)
    const frames = Math.max(1, Math.round((to - from) * fps))
    const out = resolve(opts.out ?? `${stem}.mp4`)
    mkdirSync(dirname(out), { recursive: true })

    if (!has('ffmpeg')) {
      console.log('ffmpeg not found: encoding in the browser instead.')
      page.on('console', (m) => process.stdout.write(`\r${m.text()}%   `))
      const { data, extension } = await page.evaluate(([s]) => window.motion.exportInPage(s), [opts.scale])
      const file = out.replace(/\.[^.]+$/, `.${extension}`)
      writeFileSync(file, Buffer.from(data, 'base64'))
      console.log(`\n${file}`)
      return
    }

    const audio = audioArgs(info.mix, comp.assets ?? {}, projectDir, from, to - from)
    const args = [
      '-y', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(fps), '-c:v', opts.png ? 'png' : 'mjpeg', '-i', '-',
      ...(audio ? audio.inputs : []),
      ...(audio ? ['-filter_complex', audio.filter, '-map', '0:v', '-map', '[aout]', '-c:a', 'aac', '-b:a', '192k'] : []),
      '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', String(opts.crf), '-tune', 'animation',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
      '-r', String(fps), '-t', String(frames / fps), '-movflags', '+faststart', out,
    ]
    const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] })
    const done = new Promise((ok, fail) => ff.on('close', (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg exited with ${code}`)))))

    const workers = Math.max(1, Math.min(frames, opts.workers ?? Math.max(1, availableParallelism() - 1)))
    const pages = [page]
    while (pages.length < workers) {
      const p = await openPage()
      await load(p)
      pages.push(p)
    }
    // Worker k draws frames k, k+n, k+2n...; frames are written to ffmpeg in order.
    const pending = new Map()
    const render = (i) =>
      pages[i % workers].evaluate(([tt, f, mb]) => window.motion.frame(tt, f, mb), [from + i / fps, opts.png ? 'png' : 'jpeg', opts.motionBlur])
    const chains = pages.map(() => Promise.resolve())
    const started = Date.now()
    let next = 0
    const schedule = () => {
      while (next < frames && pending.size < workers * 3) {
        const i = next++
        const k = i % workers
        const job = chains[k].then(() => render(i))
        chains[k] = job.then(() => undefined, () => undefined)
        pending.set(i, job)
      }
    }
    for (let i = 0; i < frames; i++) {
      schedule()
      const data = await pending.get(i)
      pending.delete(i)
      if (!ff.stdin.write(Buffer.from(data, 'base64'))) await new Promise((r) => ff.stdin.once('drain', r))
      if (i % fps === 0 || i === frames - 1) {
        const rate = (i + 1) / ((Date.now() - started) / 1000)
        process.stdout.write(`\rframe ${i + 1}/${frames}  (${rate.toFixed(1)} fps, ${workers} pages)   `)
      }
    }
    ff.stdin.end()
    await done
    console.log(`\n${out}  ${width}×${height} ${fps}fps ${(frames / fps).toFixed(2)}s`)
  } finally {
    await browser.close()
    await server.close()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
