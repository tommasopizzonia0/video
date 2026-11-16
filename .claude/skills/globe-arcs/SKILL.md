---
name: globe-arcs
description: Render a dark 3D globe made of thousands of dots that spins to a region and zooms in, with glowing arcs flying from one place (the shop, the warehouse) to many cities, pins and labels; outputs an MP4 clip to use as a video layer in a Motion comp. Use for "/globe-arcs", "spediamo in tutta Italia / in Europa", delivery coverage, offices, routes between cities.
---

# /globe-arcs

A 9:16 (or any size) clip: the globe of dots turns into the region, the camera zooms in, the origin pin
drops, then one orange arc per destination draws itself and each city pin lands with its label.
Pure function of time, rendered frame by frame (no timers), so it is exactly repeatable.

## Steps

1. **Places.** Get the origin (name + lat/lon) and the destinations. Look up real coordinates; ask the
   user where the origin really is if you don't know it (never guess the shop's address).
2. **Spec** next to the video, e.g. `spot/spedizioni.globe.json` (complete example:
   `examples/globe/spedizioni-italia.json`):
   ```json
   { "duration": 6,
     "from": { "name": "Il vivaio", "lat": 43.93, "lon": 10.91 },
     "to": [ { "name": "Milano", "lat": 45.46, "lon": 9.19 }, { "name": "Roma", "lat": 41.9, "lon": 12.5 } ],
     "focus": [42.3, 12.4], "zoom": 9 }
   ```
3. **Check stills first** (seconds): `node .claude/skills/globe-arcs/render.mjs spot/spedizioni.globe.json --still 0.3,2,4.5`
   and look at them: labels readable and not overlapping, arcs inside the frame, the region centred.
4. **Render**: `node .claude/skills/globe-arcs/render.mjs spot/spedizioni.globe.json` → `spot/spedizioni.globe.mp4`
   (about 50 s for 6 s at 1080×1920). `--alpha` writes a WebM with transparency instead, to lay the globe
   over another background; `-o path` to choose the output.
5. **Use it** in the Motion comp as a `video` asset/layer and put the headline on top with the engine
   (e.g. "Spediamo in {tutta Italia}" with `maskUp`), plus a `whoosh` on the zoom and `pop`s on the pins.

Run from the repo root: it uses the repo's Playwright/Chromium, ffmpeg and Inter.

## Spec reference (all optional except `from` and `to`)

| key | default | |
|---|---|---|
| `width`, `height`, `fps`, `duration` | 1080, 1920, 30, 6 | |
| `focus` | mean of all places | `[lat, lon]` the camera ends on |
| `zoom` / `zoomFrom` | 1 / 0.85 | 1 = whole globe; ~3 Europe; ~9 Italy; ~20 one region |
| `spinFrom`, `tiltFrom`, `settle` | 70, 10, 2.2 | degrees the globe turns before it settles, and in how many seconds |
| `centerY` | 0.5 | vertical position of the globe (0.45 leaves room for a caption below) |
| `pinStart`, `arcStart`, `arcStagger`, `arcDraw` | 1.4, 2.0, 0.22, 1.1 | timing in seconds |
| `arcHeight`, `bend`, `arcWidth`, `trail` | 0.18, 0.18, 4, false | arc lift above the globe, screen bow, line width, draw as a moving comet |
| `accent`, `dot`, `background`, `ocean`, `rim` | `#ff7a1a`, `#9fb3c8`, `#05070a`, … | one accent only: arcs, pins and origin label |
| `dots`, `dotSize` | 30000, 2.4 | density of the coarsest level (finer levels appear as the camera zooms) |
| `labels`, `labelSize`, `font` | true, 30, Inter | |

## Taste

- One accent colour, everything else greys on near-black. The origin is the only filled label.
- 5–10 destinations; more reads as noise. For "tutta Italia" pick cities spread north to south and islands.
- Keep the zoom move and the arcs apart: the camera settles first, then the arcs fly.
- Land shapes: Natural Earth via world-atlas 50m (ISC, `LICENSE-world-atlas.txt`); fine for countries,
  too coarse for a single city (use `/map-route` for streets).
