---
name: swiss-grid
description: Make a video in the International Typographic Style (Swiss grid) with the Motion engine — strict column grid, one sans typeface, flush-left type, a giant numeral, black on light paper and one signal colour, wipes and clip-reveals instead of fades. Use for "/swiss-grid", editorial/poster looks, catalogues, lists, price or feature reels that should look designed and calm.
---

# /swiss-grid

Graphic design in motion: the frame is a page with a visible column grid, everything snaps to it, and one
red element is the protagonist. Built entirely in the Motion engine (see `motion-video` and
`docs/MOTION.md`). Complete example: `examples/swiss-grid/vivaio-swiss.json` (built by hand from the rules below).

## The system (decide it before writing scenes)

- **Page:** 1080×1920, 6 columns, 72 px side margins, 24 px gutters → column width 134 px; column `i`
  starts at `72 + i × 158`. Everything's left edge sits on a column start (`anchor: [0, 0]`, `align: left`).
  On 16:9 use 12 columns with 96 px margins.
- **Colours:** paper `#EAE9E5`, ink `#111111`, guides `#CFCEC9` (1 px), one signal colour (red `#E30613`,
  or orange `#FF5A00`, ultramarine `#1F3FFF`, green). **Only one thing per scene carries it.**
  No gradients, glows, shadows or grain; leave `effects` off.
- **Type:** one family (Inter), several weights. Flush left, ragged right. Huge contrast: a numeral at
  400–600 px next to notes at 30–34 px. Headlines 96–150 px, weight 800, `letterSpacing` -0.02,
  `lineHeight` 1.0, lowercase is fine. Notes: a 2 px rule above, then a short line of text.
- **What the grid means:** make the modules count something real (12 varieties, 7 days, 4 sizes), so the
  layout is information, not decoration.

## Motion

- **One curve:** `"ease": "cubic-bezier(0.7,0,0.2,1)"` for every snap; `linear` only for lines being drawn.
  No springs, no bounce, no overshoot.
- **Entrances are wipes or clip-reveals, never fades:** text `animate: { by: "word", preset: "maskUp" }`;
  blocks `in: wipeRight/wipeDown`; guides grow with `scaleY` 0→1; rules with `scaleX` 0→1 (linear).
- **Scene changes:** `wipe` transitions in one direction, or hard cuts on the beat. Never `fade`/`dissolve`.
- **Rhythm:** snaps land on the music's beats (`npm run beats`, scenes with `beats: n`); modules arrive
  one per beat or per half-beat, nearest first.
- **The exception:** the signal-colour element may break the grid or move linearly while everything else
  snaps; that is what makes it the protagonist. Use it once.
- **Deleting:** a thin line crosses an element, then it collapses to its midline (`scaleY` → 0), not a fade.

## Scene ideas for the shop

- Chapter card: giant "01" + "ulivi in vaso" + a note row (the example's first scene).
- Catalogue grid: 12 black modules snap in, one is red = the product of the ad.
- Price/size table: rows with rules, the number counting (`counter`) on the beat.
- Closing: a full-width red band with "Spediamo in tutta Italia." and the site in a note row.

Check with `--contact 8` and `--check`: big type near the top must stay inside the platform safe zones.
