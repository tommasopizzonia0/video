// Measures how smoothly the studio preview plays (needs `npm run dev` running):
//   npm run bench:preview -- comp.json [--mixer] [--seconds 8] [--cpu 4] [--warm] [--url http://localhost:5173/]
// Writes the comp to live/current.json, opens #live, plays for a few seconds and reports page fps,
// preview frames drawn per second, the delay before play starts, long tasks and where the main
// thread spent its time (CPU profile, grouped). BENCH_CHROME=<path> picks the Chromium to use.

import { chromium } from 'playwright'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : dflt
}
const compPath = args.find((a) => a.endsWith('.json'))
if (!compPath) throw new Error('usage: bench-preview.mjs comp.json [--mixer] [--seconds 8]')
const seconds = Number(flag('--seconds', 8))
const base = flag('--url', 'http://localhost:5173/')
const mixer = args.includes('--mixer')
const throttle = Number(flag('--cpu', 1))
const from = Number(flag('--from', 0))

mkdirSync(resolve('live'), { recursive: true })
// The live comp being worked on is put back when the measurement ends.
const livePath = resolve('live/current.json')
const previous = existsSync(livePath) ? readFileSync(livePath) : null
const restore = () => (previous ? writeFileSync(livePath, previous) : rmSync(livePath, { force: true }))
process.on('exit', restore)
writeFileSync(livePath, JSON.stringify({ json: JSON.parse(readFileSync(compPath, 'utf8')), time: from }))

const browser = await chromium.launch({ executablePath: process.env.BENCH_CHROME, args: ['--autoplay-policy=no-user-gesture-required', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
await page.addInitScript((mixer) => {
  localStorage.setItem('motion-studio-mixer', mixer ? '1' : '0')
  const w = window
  w.__bench = { draws: 0 }
  const clear = CanvasRenderingContext2D.prototype.clearRect
  CanvasRenderingContext2D.prototype.clearRect = function (...a) {
    if (this.canvas.parentElement?.classList.contains('stage')) {
      w.__bench.draws++
      if (w.__bench.pressed && !w.__bench.firstDraw) w.__bench.firstDraw = performance.now()
    }
    return clear.apply(this, a)
  }
}, mixer)
await page.goto(base + '#live')
await page.waitForSelector('.tl-clip', { timeout: 60_000 })
await page.waitForTimeout(3000)

// --warm: play and stop once first, to time a second press of play.
if (args.includes('--warm')) {
  await page.keyboard.press('Space')
  await page.waitForTimeout(1500)
  await page.keyboard.press('Space')
  await page.waitForTimeout(500)
  await page.keyboard.press('Home')
}
const cdp = await page.context().newCDPSession(page)
if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle })
await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 200 })

await page.evaluate(() => {
  const b = window.__bench
  b.frames = []
  b.long = []
  b.draws = 0
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) b.long.push(e.duration)
  }).observe({ type: 'longtask' })
  let last = performance.now()
  const loop = (now) => {
    b.frames.push(now - last)
    last = now
    b.raf = requestAnimationFrame(loop)
  }
  b.raf = requestAnimationFrame(loop)
})
await cdp.send('Profiler.start')
await page.evaluate(() => (window.__bench.pressed = performance.now()))
await page.keyboard.press('Space')
await page.waitForTimeout(seconds * 1000)
const { profile } = await cdp.send('Profiler.stop')
await page.keyboard.press('Space')
const r = await page.evaluate(() => {
  const b = window.__bench
  cancelAnimationFrame(b.raf)
  return { frames: b.frames.slice(2), long: b.long, draws: b.draws, startMs: Math.round(b.firstDraw - b.pressed) }
})
await browser.close()

const sorted = [...r.frames].sort((a, b) => a - b)
const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
const total = r.frames.reduce((a, b) => a + b, 0) / 1000

// Self time per group, from the sampled CPU profile.
const nodes = new Map(profile.nodes.map((n) => [n.id, n]))
const parent = new Map()
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
const self = new Map()
const dt = profile.timeDeltas
profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (dt[i] ?? 0)))
const groups = {}
const fns = {}
const groupOf = (id) => {
  // Walk up to the first frame from our own code or a known library.
  for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
    const cf = nodes.get(cur).callFrame
    const u = cf.url
    if (/src\/engine\//.test(u)) return 'engine (disegno)'
    if (/src\/studio\/AudioConsole|engine\/mixer/.test(u)) return 'console audio'
    if (/src\/studio\//.test(u)) return 'studio UI'
    if (/mediabunny/.test(u)) return 'decodifica video'
    if (/react-dom|scheduler|react/.test(u)) return 'React'
  }
  return null
}
let busy = 0
for (const [id, us] of self) {
  const cf = nodes.get(id).callFrame
  if (cf.functionName === '(idle)' || cf.functionName === '(program)') continue
  busy += us
  const g = groupOf(id) ?? (cf.functionName === '(garbage collector)' ? 'GC' : 'altro (browser, layout, stile)')
  groups[g] = (groups[g] ?? 0) + us
  const key = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`
  fns[key] = (fns[key] ?? 0) + us
}
const callers = {}
for (const [id, us] of self) {
  const cf = nodes.get(id).callFrame
  if (cf.functionName !== 'drawImage' && cf.functionName !== 'texImage2D') continue
  const pf = nodes.get(parent.get(id))?.callFrame
  const key = `${cf.functionName} <- ${pf?.functionName || '(anon)'} ${pf?.url.split('/').pop()}:${(pf?.lineNumber ?? 0) + 1}`
  callers[key] = (callers[key] ?? 0) + us
}
const ms = (us) => Math.round(us / 1000 / seconds)
console.log(
  JSON.stringify(
    {
      comp: compPath,
      mixer,
      cpuThrottle: throttle,
      startMs: r.startMs,
      pageFps: +(r.frames.length / total).toFixed(1),
      previewFps: +(r.draws / seconds).toFixed(1),
      frameMs: { p50: +pct(0.5).toFixed(1), p95: +pct(0.95).toFixed(1), max: +pct(1).toFixed(1) },
      jank: r.frames.filter((f) => f > 50).length,
      longTasks: { count: r.long.length, totalMs: Math.round(r.long.reduce((a, b) => a + b, 0)) },
      mainThreadBusyMsPerSec: ms(busy),
      busyByGroupMsPerSec: Object.fromEntries(Object.entries(groups).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, ms(v)])),
      canvasCopies: Object.entries(callers).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${ms(v)}ms/s ${k}`),
      topFunctions: Object.entries(fns).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${ms(v)}ms/s ${k}`),
    },
    null,
    2,
  ),
)
