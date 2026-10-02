# Motion: the composition format

A motion-design video is a JSON file. The same file is previewed in the browser
(the **Motion** view, `#motion`) and rendered headlessly to MP4 with `npm run render`.
Every frame is a pure function of time, so a render always matches the preview.

```bash
npm run render -- examples/launch.json                  # → examples/launch.mp4
npm run render -- examples/launch.json --contact 24     # one PNG with 24 frames: review the whole video at a glance
npm run render -- examples/launch.json --still 1.2,4    # PNG stills at those times
npm run render -- examples/launch.json --scale 0.5      # fast half-size draft
npm run render -- examples/launch.json --from 3 --to 6  # only part of the timeline
```

The renderer needs Chromium (`npx playwright install chromium`, or Google Chrome) and ffmpeg for the
final MP4 (H.264 + AAC, BT.709). Without ffmpeg it encodes inside the browser instead.
Errors and warnings name the exact path, e.g. `scenes[1].layers[2].in: Unknown preset "fadeUpp". Did you mean "fadeUp"?`

## Skeleton

```jsonc
{
  "width": 1080, "height": 1920,        // 1920×1080 for 16:9, 1080×1080 for 1:1
  "fps": 60,                            // default 30
  "background": "#07080b",              // color or gradient
  "effects": { "grain": 0.04, "vignette": 0.3, "motionBlur": { "samples": 4, "shutter": 0.5 } },
  "assets": { "logo": { "type": "image", "src": "assets/logo.svg" },
              "clip": { "type": "video", "src": "media/clip.mp4" },
              "music": { "type": "audio", "src": "media/music.mp3" } },
  "fonts": [{ "family": "Brand Sans", "src": "fonts/brand.woff2", "weight": "100 900" }],
  "audio": [{ "asset": "music", "volume": 0.8, "fadeIn": 0.5, "fadeOut": 1.5 }],
  "scenes": [ { "duration": 3, "layers": [ ... ] },
              { "duration": 4, "transition": { "type": "push", "direction": "up" }, "layers": [ ... ] } ],
  "layers": [ ... ]                     // optional overlay above all scenes, in comp time
}
```

Paths in `src` are relative to the JSON file. `duration` of the comp defaults to the end of the last scene.

## Time

- A **scene** has a `duration` and its own clock starting at 0. A `transition` makes it start
  *before* the previous scene ends (they overlap by the transition's duration).
- A **layer** lives from `start` for `duration` seconds of its parent (comp, scene or group);
  without `duration` it lasts until the parent ends. Times inside a group are relative to the group.
- Keyframe `t` values are seconds from the layer's start.

## Coordinates

Every layer has a box (its `width`/`height`, or the measured text). `x`/`y` place the box's
`anchor` point (default `[0.5, 0.5]`, the center) in the parent, in px. Without `x`/`y` a layer
sits at the center of its parent. So `{ "type": "text", "text": "Ciao" }` is centered on screen.
Use `"anchor": [0, 0.5], "x": 80` to align a layer's left edge at x = 80.

## Animating values

Any property marked *anim* below accepts:

```jsonc
"opacity": 0.5                                                   // constant
"x": [{ "t": 0, "v": 100 }, { "t": 1.2, "v": 540, "ease": "smooth" }]  // keyframes; ease shapes the arrival
"scale": { "from": 0.9, "to": 1, "at": 0.3, "duration": 0.8, "ease": "spring" }  // tween
"color": [{ "t": 0, "v": "#ffffff" }, { "t": 1, "v": "#7c5cff" }]      // colors animate too
```

**Easings:** `linear`, `smooth` (soft landing, the go-to), `snappy`, `glide` (calm, symmetric, for camera
moves), `anticipate`, `in/out/inOut` + `Sine|Quad|Cubic|Quart|Quint|Expo|Circ|Back`, `outElastic`,
`outBounce`, springs `spring`, `bouncy`, `gentle`, CSS `ease`, `ease-in-out`, `"cubic-bezier(a,b,c,d)"`,
`[a, b, c, d]`, or `{ "spring": { "stiffness": 170, "damping": 18, "mass": 1 } }`.
Springs settle exactly at the end of their segment. Default between keyframes: `inOutCubic`.

## Layer properties (all types)

| property | | |
|---|---|---|
| `x`, `y` | anim | anchor position in the parent, px |
| `anchor` | `[ax, ay]` | 0..1 within the box |
| `scale`, `scaleX`, `scaleY`, `rotation` (deg), `skewX` (deg), `opacity` | anim | |
| `blur` (px), `brightness`, `contrast`, `saturate`, `grayscale`, `hueRotate` | anim | filters; big blurs are cheap |
| `shadow` | `{ color, blur, x, y }` | soft drop shadow from the layer's silhouette |
| `blend` | `multiply`, `screen`, `overlay`, `soft-light`, `add`, … | |
| `in`, `out` | preset | entrance / exit, see below |
| `start`, `duration`, `hidden`, `id`, `comment` | | |

## Layer types

- **`rect`** `width`, `height`, `radius` (anim), `fill`, `stroke: { color, width }`
- **`ellipse`** `width`, `height` (anim), `fill`, `stroke`. A big blurred ellipse = a glow.
- **`path`** SVG `d`, `width`, `height`, `viewBox: [x, y, w, h]` (scales `d` into the box, like SVG),
  `fill`, `stroke`, `lineCap`, `lineJoin`, `trimStart`/`trimEnd` (anim, 0..1: animate `trimEnd` 0 → 1 to draw a line).
  With a `viewBox`, stroke width is in viewBox units.
- **`text`**
  - `text` (`\n` for breaks), `font`, `size` (px), `weight`, `italic`, `color` (color or gradient),
    `letterSpacing` (em; -0.03 to -0.05 for tight headlines), `lineHeight` (× size, default 1.15),
    `align` (`center` default), `width` (wrap width, px), `uppercase`, `stroke`
  - `accent: { font, weight, italic, color }` styles the parts written in `{curly braces}`:
    `"Video che sembrano {fatti da uno studio.}"`. Without `accent`, braces are plain text.
  - `background: { fill, padding: [v, h], radius, mode: "box" | "line" }` (pill or highlighter)
  - `animate: { by: "char" | "word" | "line", preset, stagger, duration, delay, ease, order }`
    animates each unit with its own staggered entrance; `exit` is the same for leaving.
    `order`: `start`, `end`, `center`, `edges`, `random`.
  - `counter: { from, to, at, duration, ease, decimals, prefix, suffix, separator }` counts a number;
    a `#` in `text` is replaced by it (`"text": "+# clienti"`), otherwise the text is the number.
- **`image`** `asset`, `width`/`height` (one is enough: aspect is kept; none = natural size), `fit`, `radius`
- **`video`** `asset`, `width`/`height` (default: fill the parent, `fit: "cover"`), `radius`,
  `sourceStart` (s into the source), `playbackRate`, `volume`, `muted`. Frames are decoded exactly, no drift.
- **`group`** `layers`, `width`/`height` (default: parent size), `fill`, `stroke`, `radius`, `clip`.
  A group with `fill` + `radius` + `shadow` is a card. Animate a group to move everything in it
  (a "camera": scale/x/y keyframes on a full-frame group).

**Fills** are a color (`"#16b07a"`, `"rgba(0,0,0,.5)"`, `"hsl(...)"`) or a gradient:
`{ "type": "linear", "angle": 135, "stops": [[0, "#7c5cff"], [1, "#2563eb"]] }` (CSS angles) or
`{ "type": "radial", "cx": 0.5, "cy": 0.4, "r": 0.9, "stops": [...] }`.

## Presets (`in`, `out`, text `preset`)

`fade`, `fadeUp`, `fadeDown`, `fadeLeft`, `fadeRight` (short move + fade) · `slideUp/Down/Left/Right`
(from outside the frame) · `maskUp/Down/Left/Right` (content rises from behind an invisible edge; the
premium headline reveal) · `wipeUp/Down/Left/Right` (clip grows in that direction) · `scale`, `zoom`
(from 1.25), `pop` (spring from 0) · `blur` · `rotate` · `appear` (instant; with `by: "char"` = typewriter).

A preset is a name, `{ "type": "fadeUp", "delay": 0.4, "duration": 0.8, "ease": "smooth", "distance": 60 }`
(also `scale`, `blur`, `angle`), or a list to combine: `["fadeUp", "blur"]`.
Exits move *onward* in the named direction (`out: "fadeUp"` keeps rising while fading).
Default timing: entrances 0.7 s with `smooth`, exits 0.45 s with `inCubic`, ending at the layer's end.

## Transitions (scene `transition`)

`cut`, `fade`, `dip` (through `color`), `slide` (new scene slides over), `push` (both move),
`zoom` (punch through), `blur`, `wipe`, `iris`. Options: `duration` (default 0.6), `ease`,
`direction` (`left`, `right`, `up`, `down`).

## Audio

`audio` entries play assets on the comp timeline: `asset`, `start`, `sourceStart`, `duration`,
`volume`, `fadeIn`, `fadeOut`. Unmuted `video` layers add their own sound automatically.

## Built-in fonts

`Inter` (default), `Inter Tight`, `Fraunces`, `Instrument Serif` (400, normal + italic),
`Space Grotesk`, `Bricolage Grotesque`, `JetBrains Mono`. Variable weights. Others: declare in `fonts`.

## Design notes

What makes these videos look designed rather than generated:

- **One idea per scene**, 2–4 s each. Headlines big (90–180 px on 1080 wide), one accent word in a
  contrasting serif italic (`accent`), tight letter spacing (-0.04 em).
- **Motion has hierarchy**: the headline enters first (`maskUp` by word, stagger 0.06–0.09),
  supporting text 0.4–0.8 s later with a quiet `fadeUp`. Never animate everything at once.
- **Ease out, never linear** for things arriving (`smooth`, `outExpo`); `glide` for slow drifts;
  springs for playful objects. Keep a slow drift (scale 1.04 → 1, blurred glows moving) so frames never freeze.
- **Restrained palette**: one background family, one accent color, neutrals for the rest.
- **Depth**: blurred ellipses as light, soft `shadow`s on cards, `grain` 0.03–0.05 and `vignette` 0.25–0.35.
- **Transitions with intent**: `push` for "next", `zoom` for "going deeper", `blur`/`fade` for endings.
- Check with `--contact 24` before the full render; look for overlaps, cut-off text and empty frames.
