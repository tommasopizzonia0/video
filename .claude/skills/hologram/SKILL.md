---
name: hologram
description: Make a "hologram" scene with the Motion engine — a product, a plant or a place rebuilt as ice-blue glowing lines on black, scanned in by a light plane, with HUD brackets, target boxes that lock onto parts and values that roll in and turn amber when locked. Use for "/hologram", sci-fi/tech looks, spec walkthroughs, "scansione" of a product.
---

# /hologram

The subject is shown as light, not as a photo: glowing edges plus a faint scan-lined volume above a
projector pad on a near-black stage, with a HUD around it. Built entirely in the Motion engine
(see `motion-video` skill and `docs/MOTION.md`); one helper script makes the images.
Complete example: `examples/hologram/ulivo-hologram.json` (render it with `--contact 8` to see it).

## Steps

1. **Subject image.** Best: a cut-out PNG (`npm run cutout -- foto.jpg`), so only the subject is traced.
   A full photo also works (the background becomes part of the hologram, like the example).
   A frame of a clip: `ffmpeg -ss 2 -i clip.mp4 -frames:v 1 soggetto.png`.
2. **Hologram layers:** `node .claude/skills/hologram/holo.mjs soggetto.png [--color 8BE9FF] [--width 900] [--edges 0.06,0.18]`
   → `soggetto.holo-linee.png` (edges as light), `soggetto.holo-volume.png` (body with scanlines) and
   `griglia-holo.png` (dot grid for the stage). Lower `--edges` = more lines; raise them if it looks noisy.
3. **Comp.** Copy the example and change the assets, the lock positions and the values. The stack, bottom to top:
   dot grid (slow drift) → cyan glow ellipse → projector pad (stroked ellipses, `fill` transparent) →
   volume (`blend: screen`) → lines blurred 10 px (`blend: add`, glow) → lines (`blend: add`) → scan plane →
   HUD frame and texts → target locks → title.
4. **Check** with `npm run render -- file.json --contact 8`, then render as usual (`--check` for social).

## The look (rules that make it read as a hologram)

- **One cold hue + one warm accent.** Lines, HUD and text in the hue (`#8BE9FF` ice blue); the accent
  (`#FFB547` amber) is used **only** for a value at the moment it is locked. White = "active right now"
  (the scan line, a lock flash).
- **Scan in, never fade in:** the subject appears with `wipeUp` (linear, 1.5–2 s) while a bright line with a
  soft glow climbs with it. Exits are the same scan going down.
- **Target lock:** a stroked rect starts at scale 1.9, rotated 45°, faint, and snaps to the part in
  ~0.22 s (`outCubic`), with a 3-frame white flash. Then a leader line draws (`trimEnd` 0→1) and the value
  counts up (`counter`), switching to the accent on the frame it lands.
- **HUD furniture:** four corner brackets, a mono label top-left ("SOGGETTO // SCANSIONE"), a live
  status/percentage top-right, the name at the end typed in (`by: char`, `appear`). Mono text in
  JetBrains Mono, big numbers in mono too so they don't jitter while counting.
- **Text never sits on bright lines:** put cards beside the subject; on busy areas add a dark translucent
  plate (`group` with `fill: rgba(2,8,12,0.75)`, 1 px stroke) behind the text.
- **Depth:** dot grid and glow move slower than the subject (parallax), the HUD stays still.
- One glitch at most (an opacity dip of 2–3 frames on the volume), on the biggest moment.
- Sound: `riser` under the scan, `click` on each lock, `impact` on the title; keep it under the voice.

## Uses for the shop

A tree or a plant scanned in with its real specs (height, pot diameter, age, hardiness), a product
"tech sheet" for ads, an "upgrade" (old vs new value), or a loop screen with 3–5 specs and no voice.
Use real numbers from the user or the website, never invented ones.
