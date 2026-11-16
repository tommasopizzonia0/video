import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

const MEDIA_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const parts: Buffer[] = []
    req.on('data', (d: Buffer) => parts.push(d))
    req.on('end', () => ok(Buffer.concat(parts)))
    req.on('error', fail)
  })
}

/** Sends a file with Range support, so videos can seek without downloading everything. */
function sendFile(req: IncomingMessage, res: ServerResponse, file: string) {
  const size = statSync(file).size
  res.setHeader('Content-Type', MEDIA_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream')
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Cache-Control', 'no-cache')
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '')
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]))
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
    if (start >= size || start > end) {
      res.statusCode = 416
      res.setHeader('Content-Range', `bytes */${size}`)
      res.end()
      return
    }
    res.statusCode = 206
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
    res.setHeader('Content-Length', end - start + 1)
    createReadStream(file, { start, end }).pipe(res)
    return
  }
  res.setHeader('Content-Length', size)
  createReadStream(file).pipe(res)
}

/**
 * Dev only, for working live on this computer (`npm run dev`, then `#live`):
 * - `live/current.json` is served at /__live (GET), saved from the page (POST), and every save is
 *   pushed to the open studio;
 * - the media library: Higgsfield downloads (`HIGGSFIELD_DIR`, default `../higgsfield` next to the
 *   repo), pictures fetched with `npm run photos` into `public/live`, and files dropped on the
 *   Caricamenti panel (`live/uploads`). Listed at /__media, served at /__media/<source>/<path>,
 *   uploaded with POST /__upload?name=…; any change in those folders is pushed to the page.
 */
function localLive(): Plugin {
  const root = import.meta.dirname
  const file = resolve(root, 'live/current.json')
  const sources: Record<string, string> = {
    higgsfield: resolve(process.env.HIGGSFIELD_DIR ?? resolve(root, '../higgsfield')),
    foto: resolve(root, 'public/live'),
    caricati: resolve(root, 'live/uploads'),
    suoni: resolve(root, 'live/suoni'),
  }
  const read = () => {
    try {
      return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
    } catch {
      return null // half-written or invalid: wait for the next save
    }
  }
  const list = () => {
    const out: { id: string; name: string; type: string; url: string; source: string; size: number; time: number }[] = []
    const walk = (source: string, dir: string, depth: number) => {
      if (depth > 4 || !existsSync(dir)) return
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(source, full, depth + 1)
        else {
          const type = MEDIA_TYPES[extname(entry.name).toLowerCase()]
          if (!type || /^provini/i.test(entry.name)) continue
          const rel = relative(sources[source], full).split(sep).join('/')
          const st = statSync(full)
          out.push({ id: `${source}/${rel}`, name: basename(full), type, url: `/__media/${source}/${rel.split('/').map(encodeURIComponent).join('/')}`, source, size: st.size, time: st.mtimeMs })
        }
      }
    }
    for (const [source, dir] of Object.entries(sources)) walk(source, dir, 0)
    return out.sort((a, b) => b.time - a.time)
  }
  return {
    name: 'local-live',
    apply: 'serve',
    configureServer(server) {
      server.watcher.add(file)
      for (const dir of Object.values(sources)) if (existsSync(dir)) server.watcher.add(dir)
      const inMedia = (path: string) => Object.values(sources).some((d) => resolve(path).startsWith(d + sep))
      let mediaTimer: ReturnType<typeof setTimeout> | undefined
      const push = (path: string) => {
        if (inMedia(path)) {
          clearTimeout(mediaTimer)
          mediaTimer = setTimeout(() => server.ws.send({ type: 'custom', event: 'media:update', data: list() }), 300)
        }
        if (resolve(path) !== file) return
        // A save can be caught half-written: read it again a moment later.
        const send = (retries: number) => {
          const data = read()
          if (data) server.ws.send({ type: 'custom', event: 'live:update', data })
          else if (retries > 0) setTimeout(() => send(retries - 1), 120)
        }
        send(4)
      }
      server.watcher.on('change', push)
      server.watcher.on('add', push)
      server.watcher.on('unlink', (path) => inMedia(path) && push(path))

      server.middlewares.use('/__live', (req, res) => {
        if (req.method === 'POST') {
          void readBody(req).then((body) => {
            try {
              const data = JSON.parse(body.toString('utf8'))
              mkdirSync(resolve(root, 'live'), { recursive: true })
              writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
              res.statusCode = 204
            } catch {
              res.statusCode = 400
            }
            res.end()
          })
          return
        }
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(read()))
      })

      server.middlewares.use('/__upload', (req, res) => {
        const name = new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? ''
        const safe = basename(name).replace(/[^\w.\- ]+/g, '_')
        if (req.method !== 'POST' || !safe || !MEDIA_TYPES[extname(safe).toLowerCase()]) {
          res.statusCode = 400
          res.end()
          return
        }
        void readBody(req).then((body) => {
          mkdirSync(sources.caricati, { recursive: true })
          writeFileSync(join(sources.caricati, safe), body)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ id: `caricati/${safe}` }))
        })
      })

      server.middlewares.use('/__media', (req, res, next) => {
        const path = decodeURIComponent((req.url ?? '/').split('?')[0])
        if (path === '/' || path === '') {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ items: list(), folders: sources }))
          return
        }
        const [, source, ...rest] = path.split('/')
        const dir = sources[source]
        const target = dir && resolve(dir, rest.join('/'))
        if (!target || !target.startsWith(dir + sep) || !existsSync(target)) return next()
        sendFile(req, res, target)
      })
    },
  }
}
// https://vite.dev/config/
export default defineConfig(({ mode }) =>
  mode === 'artifact'
    ? {
        // `npm run build:artifact`: the live Motion studio as one self-contained HTML file,
        // published as a claude.ai Artifact so Claude's edits show up while it works.
        base: './',
        plugins: [
          react(),
          viteSingleFile(),
          {
            name: 'artifact-html',
            transformIndexHtml: (html) =>
              html.replace('<title>Video Editor</title>', '<title>Motion Live</title>').replace(/\s*<link rel="icon"[^>]*>/, ''),
          },
        ],
        build: { outDir: 'dist-artifact', chunkSizeWarningLimit: 4000 },
      }
    : {
        // Relative paths so the build works on GitHub Pages under /<repo>/
        base: './',
        plugins: [react(), localLive()],
        // The motion studio and its WASM AAC encoder are large, but both load only on demand.
        build: { chunkSizeWarningLimit: 1100 },
      },
)
