#!/usr/bin/env node
// Turns a photo or a cut-out into the two layers of a hologram, plus the dot-grid stage.
//   node .claude/skills/hologram/holo.mjs albero.png                 -> albero.holo-linee.png, albero.holo-volume.png, griglia-holo.png
//   node .claude/skills/hologram/holo.mjs foto.jpg --color 8BE9FF --width 900 --edges 0.06,0.18
// linee  = the edges as glowing lines (colour, alpha = edge strength)
// volume = the body as a faint tinted volume with scanlines (alpha = brightness x 0.4)
// A transparent cut-out (npm run cutout) gives clean outlines; a full photo also traces its background.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const args = process.argv.slice(2)
const input = args.find((a) => !a.startsWith('--') && existsSync(a))
if (!input) { console.error('uso: node holo.mjs immagine.png [--color 8BE9FF] [--width 900] [--edges 0.06,0.18] [--grid 1080x1920]'); process.exit(1) }
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const color = opt('--color', '8BE9FF').replace('#', '')
const width = Number(opt('--width', 900))
const [low, high] = opt('--edges', '0.06,0.18').split(',').map(Number)
const [gw, gh] = opt('--grid', '1080x1920').split('x').map(Number)
const FF = process.env.FFMPEG || 'ffmpeg'
const base = input.replace(/\.[^.]+$/, '')
const ff = (a) => execFileSync(FF, ['-loglevel', 'error', '-y', ...a], { stdio: 'inherit' })

const [w, h] = execFileSync(process.env.FFPROBE || 'ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', input])
  .toString().trim().split(',').map(Number)
const H = Math.round((h * width) / w / 2) * 2
// flatten on black first, so a cut-out's own edge becomes the outline and its empty area stays empty
const flat = `color=c=black:s=${width}x${H}[bg];[0]scale=${width}:${H}:flags=lanczos,format=rgba[im];[bg][im]overlay=format=auto,format=gray`

ff(['-i', input, '-filter_complex',
  `${flat},edgedetect=low=${low}:high=${high},gblur=sigma=0.6,curves=all='0/0 0.25/0.6 1/1'[e];` +
  `color=c=0x${color}:s=${width}x${H}[c];[c][e]alphamerge`,
  '-frames:v', '1', `${base}.holo-linee.png`])

ff(['-i', input, '-filter_complex',
  `${flat},curves=all='0/0 0.5/0.35 1/0.9',geq=lum='lum(X,Y)*(if(lt(mod(Y,4),2),1,0.35))*0.45'[a];` +
  `color=c=0x${color}:s=${width}x${H}[c];[c][a]alphamerge`,
  '-frames:v', '1', `${base}.holo-volume.png`])

const grid = join(dirname(input), 'griglia-holo.png')
if (!existsSync(grid)) {
  // dot grid every 36 px, fading out towards the edges
  ff(['-f', 'lavfi', '-i', `color=c=black@0:s=${gw}x${gh},format=rgba`, '-vf',
    `geq=r=${parseInt(color.slice(0, 2), 16)}:g=${parseInt(color.slice(2, 4), 16)}:b=${parseInt(color.slice(4, 6), 16)}:` +
    `a='if(lt(mod(X,36),3)*lt(mod(Y,36),3),255*0.22*max(0,1-hypot(X-W/2,Y-H*0.45)/(H*0.6)),0)'`,
    '-frames:v', '1', grid])
}
console.log(`→ ${base}.holo-linee.png\n→ ${base}.holo-volume.png\n→ ${grid}  (${width}x${H})`)
