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
npm run render -- examples/launch.json --check          # delivery checks (below)
```

### Delivery checks

`--check` samples the video every 0.1 s and reports, with the time of each problem:

- **Safe zones**: text that stays where the platform's buttons and captions cover it. `--platform reels`
  (Meta Reels/Stories ads: 14% top, 35% bottom, 6% sides; the default for 9:16), `tiktok` (TikTok's ads
  template, including the button column on the right), `feed` (4:5 and 1:1, 5% margins; the default for
  them), `youtube` (16:9, 5%). Entrances that pass through the edge and transitions are ignored.
- **Legibility**: text under 2.2% of the frame height (42 px on 1920), contrast under 3:1 against what
  surrounds it (texts with a `stroke` or `background` are skipped), text on screen for less time than it
  takes to read (about 3.5 words a second).
- **Rhythm**: an empty first frame, empty stretches, no movement and no text in the first 2 seconds,
  a length outside the platform's range, a frame shape that isn't the platform's.
- **The file**: when the `.mp4` exists (or `-o file.mp4`), its codec, yuv420p, size, fps, faststart,
  AAC audio, loudness and true peak. Every full render prints this report on its own.

The exit code is 2 when there are errors, so a script can stop a delivery.

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

## Platforms and format variants

`"platform"`: `reels` (Instagram/Facebook Reels and Stories), `tiktok`, `feed` (4:5 and 1:1) or `youtube`
(16:9). It sets the safe zones that `--check` and the studio's **Safe zone** guides use; without it the
shape decides (9:16 = reels).

`"variants"` delivers the same video in other formats. Each one sets a new `width`/`height`, a `platform`
and `layers`: properties that replace those of the layer with that `id` (anywhere, also inside groups).

```jsonc
"platform": "reels",
"variants": {
  "feed": { "width": 1080, "height": 1350, "platform": "feed", "layers": { "titolo": { "y": 420 }, "cta": { "y": 1080 } } },
  "tiktok": { "platform": "tiktok", "layers": { "cta": { "x": 460 } } }
}
```

```bash
npm run render -- spot.json --variant feed      # → spot-feed.mp4
npm run render -- spot.json --variant all       # every variant, each with its own file report
npm run render -- spot.json --variant feed --check
```

Layers without `x`/`y` stay centered in any frame and full-frame media fill it (`fit: "cover"`), so they
need nothing. Anything placed in pixels does: give it an `id` and an override. In the studio, the
**Formato** menu previews each variant.

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
| `blend` | `multiply`, `screen`, `overlay`, `soft-light`, `add`, … | `atop`: paint only on the layers below it inside an `isolate` group (a highlight on a product); `matte`: keep those layers only where this one is, with its alpha (a fading reflection) |
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
  `mask: { d, viewBox, width, height, x, y, scale, rotation }` clips the children to an SVG shape (x/y/scale/rotation anim):
  animate `scale` from 0 to well past the frame for a shape reveal (a leaf opening onto the next shot).
  `isolate: true` draws the children on their own first, so `atop` / `matte` act on them alone.
  A group with `fill` + `radius` + `shadow` is a card. Animate a group to move everything in it
  (a "camera": scale/x/y keyframes on a full-frame group).
- **`studio`** a product shot from photos: a set, products standing on it with shadows and studio light,
  and a camera move with parallax (the products move more than the set behind them). See "Product shots" below.
- **`captions`** word-timed subtitles in the social style: short pages of 1–3 words, the spoken word
  lit up. `words: [{ text, start, end }]` (seconds in the layer's time) or `asset` pointing to a
  `"type": "captions"` asset: an `.srt` / `.vtt` file or JSON (Whisper or whisper.cpp output with word
  timestamps, or a plain word list). `mode`: `highlight` (default, whole page shown, spoken word in
  `highlight` color, default `#FFE45E`) or `reveal` (words pop in as they are said). `maxWords` (3),
  `maxChars` (22), `font`, `size` (default 72 on 1080), `weight` (800), `italic`, `color`, `uppercase`,
  `stroke` (black outline by default, `false` for none), `background` (a pill behind the page),
  `width` (wrap width, default 80% of the frame), `letterSpacing`, `lineHeight`. Default position: centered at 58% of the height on 9:16 (above the 35% that ads cover with the caption and the button), 70% on other vertical shapes, 84% on horizontal ones.
  Put it in the top-level `layers` so it runs across scenes. Word timings come from a transcription: `npm run transcribe -- voce.mp3` writes
  `voce.words.json` (faster-whisper large-v3-turbo, Italian by default, `--language auto` to detect,
  `--prompt "Statera, ilvivaioonline.it"` for names to spell right). Word starts after a pause are
  moved to where the voice comes back, Italian elisions stay one word (`d'agosto`), and words the
  model is unsure of are listed so you can check them by ear. Needs Python with `pip install faster-whisper`
  (set `WHISPER_PYTHON` to use a virtualenv); the model (1.6 GB) downloads from Hugging Face the first time.

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

Velocity-matched transitions ("cut the curve"): the old scene accelerates out, the cut lands at peak
speed and the new scene keeps moving the same way as it settles, so the eye reads one continuous move.
Only one scene is on screen at any frame, never a dissolve. Their curves are built in (`ease` is ignored).

- `curve` (0.6 s): a short push in `direction`, about 12% of the frame (`distance` in px to change it),
  the new scene ignites at 35% opacity mid-path. Optional `blur`. The default for "next".
- `zoomThrough` (0.7 s): everything grows through the cut, for going deeper. `zoomBack`: everything
  shrinks, for pulling out. `blur` (default 12 on 1080).
- `flash` (0.34 s): a hard cut hidden in a flash of `color` (white by default), for beats and drops.
- `whip` (0.36 s): a fast pan well past the screen with a directional smear.

## Preparing clips

`npm run prep -- clip.mp4` measures a clip before it goes in a comp: how much the picture shakes
(after removing the intended camera move), the background noise of the sound, and mains hum. It
suggests the options to use. With options it writes `clip-prep.mp4` and measures it again:

- `--stabilize`: vid.stab in two passes, keeping the camera move of the last `--smooth` seconds
  (default 1). The picture is enlarged just enough to hide the moving edges; the report says up to
  how much (an upper estimate). Over ~10% you lose visible sharpness: reshoot if you can.
  `--tripod` instead holds the frame still, for shots meant to be locked off.
- `--grain light|strong`: non-local means against sensor noise and grain. Slow, about 0.5–1 s per
  1080p frame.
- `--denoise [deep|voice|fft]`: lowers the background noise. The delay of each filter is taken
  back, so lips stay in sync.
  - `deep` (default when installed): DeepFilterNet 3, a neural network trained on speech (MIT /
    Apache-2.0). The most natural result, and the only one that also cleans *under the words*: in
    our tests the voice went from 6.6 to 13.7 dB above the noise there (RNNoise 7.4, fft 7.8). It needs the `deep-filter` program,
    one file with the model inside, no Python: download it for your system from
    https://github.com/Rikorose/DeepFilterNet/releases (the `deep-filter-…` file for your system,
    e.g. `deep-filter-0.5.6-x86_64-pc-windows-msvc.exe` on Windows), and put it on the PATH as
    `deep-filter` or point `DEEP_FILTER` at it. About 20 s per minute of sound on the cloud CPU.
  - `--keep <dB>` with `deep`: limits the reduction (e.g. `--keep 20`), leaving a little room sound;
    often more natural than total silence between the words.
  - `voice`: RNNoise (`scripts/models/rnnoise-voce.rnnn`, BSD, see `rnnoise-COPYING.txt`), the
    fallback when `deep-filter` is missing. Lighter, but it can sound metallic.
  - `fft`: high-pass + a spectral filter that follows the noise, for ambience, music or nature
    sounds: `deep` and `voice` treat everything that is not speech as noise.
- `--hum [50|60]`: notches on the mains frequency and its harmonics; found automatically when no
  frequency is given.

What it cannot do: motion blur and rolling-shutter wobble stay (they are in each frame); a shot out
of focus stays out of focus; `--denoise` cleans the pauses well but the noise under the words stays in part, and neither filter
helps transcription (Whisper does slightly worse on cleaned sound), so run `npm run transcribe`
on the original sound. Listen to the result: a recording made close to the mouth in a quiet room
still beats any cleanup.

## Finding photos and stock video

`npm run photos -- "olive tree in pot" --orient tall -n 12` searches free archives, keeps only
files whose licence allows a paid ad with an edited picture, downloads the best (pictures at most
2560 px, real size checked), and writes in `foto/<search>/`:

- `01-pexels.jpg`, `02-openverse.jpg`, …, best first (no credit needed, then larger);
- `provini.jpg`: a numbered contact sheet to choose from (for videos, the frame at 1 s);
- `CREDITI.txt` and `crediti.json`: author, licence and page of each file, and which ones must be
  credited in the ad (CC BY).

Options:

- `--video`: video clips from Pexels (up to 4K) and Pixabay (up to Full HD), saved as `.mp4`;
  `--max-duration <s>` drops longer clips; `-n` defaults to 6.
- `--kind photo|illustration|vector`: illustrations from Pixabay and Openverse, vectors (as
  pictures) from Pixabay.
- `--min <px>` shortest side (default 1080), `--orient tall|wide|square`, `--sources`, `-o <dir>`.
- `--lang it`: search words in Italian for Pixabay and Pexels; Openverse and Wikimedia are tagged
  mostly in English, so search in English to use all sources.

Licences kept: CC0, public domain, Pexels, Pixabay (no credit), CC BY (credit). Left out:
non-commercial (NC), no-derivatives (ND) and, unless `--sa`, share-alike (CC BY-SA).

Sources and keys: Pexels (`PEXELS_API_KEY`, free from pexels.com/api: the best photos and videos
for ads), Pixabay (`PIXABAY_API_KEY`, free; pictures up to 1280 px on the long side unless Pixabay
grants the account full API access, then the original is used automatically), Openverse and
Wikimedia Commons (no key). Openverse lists files hosted on many sites; the ones the network does
not reach are skipped. In the cloud, Wikimedia and Flickr often answer "too many requests" because
the address is shared: try again later or from your computer. Pixabay asks for no mass downloads:
search for what the spot needs.

Not available through any API: Pixabay music, sound effects, GIFs and 3D models (download them by
hand from the site; 3D models would also need a 3D renderer, which the engine does not have).

A licence covers the copyright of the file, not recognizable people or trademarks in it: an ad
needs their consent, so prefer pictures without faces and logos. Wikimedia's `personality` and
`trademarked` warnings end up in `CREDITI.txt`.

## Product shots (`studio` layer)

Turns product photos into a studio shot. Best with **cut-outs** (PNG/WebP with a transparent
background): their transparent margins are measured, so the product itself stands on the floor at
the width you ask. A photo with its own background sits on the set as a rectangle (the checker warns).

```json
{ "type": "studio",
  "backdrop": { "style": "sweep", "color": "#e8e2d6" },
  "camera": "push",
  "products": [{ "asset": "vaso", "width": 520, "shadow": "cast", "light": "left", "shine": 0.8 }] }
```

- `backdrop.style`: `sweep` (seamless paper, wall into floor, default), `spot` (a pool of light on a
  darker set), `table` (a wall and a table top), `none` (keep your own background or video).
  `color` (default warm white), `floor` (px from the top where products stand, default 74% of the height).
- `camera`: `push` (default, slow move in), `pull`, `drift` (sideways), `rise`, `still`; `move` scales it (1 = default).
  It lasts the whole layer; the set moves about a third as much as the products.
- products: `asset`, `width` (of the product itself, px), `x`, `y` (base, default the floor; one
  product is centered, several are spread out), `id`, `in`/`out` presets, and
  - `shadow`: `soft` (contact + soft ground shadow, default), `cast` (also a long shadow away from the light), `false`
  - `light`: `left` (default), `right`, `top` or `false`: a softbox highlight near that edge and shade on
    the other, painted only on the product; `lightAmount` 0..1 (0.6)
  - `reflection`: 0..1, a mirror image on a glossy floor
  - `shine`: a band of light crossing the product, starting at that second (`true` = 0.5 s)
  - `halo`: a color glowing behind the product
  - `float`: a slow up-and-down, the shadow breathing with it

Put titles, price and CTA as normal layers above it. Limits: this is 2D: the light is painted on, not
computed from the product's shape, so it reads best on simple objects (bottles, boxes, pots); on
foliage `shine` looks like mist. A cut-out with leftover edges or its own baked shadow shows them.

## Color grade

`grade` on the comp colors the whole picture (the scenes; the top-level `layers`, such as captions and
a logo, keep their colors). `grade` on a layer colors that layer alone: use it to match footage from
different cameras before the overall look.

```jsonc
"assets": { "look": { "type": "lut", "src": "looks/caldo-pellicola.cube" } },
"grade": {
  "exposure": 0.15,          // stops: +1 doubles the light
  "temperature": 0.2,        // -1 cool .. 1 warm
  "tint": 0,                 // -1 green .. 1 magenta
  "saturation": 1.1,         // 0 = black and white
  "contrast": 1.15,          // S-curve around mid grey; black and white stay put, nothing clips
  "shadows": [0, 0.03, 0.1], // lift: a number, or [r, g, b] to tint the shadows (here: teal)
  "midtones": 0,             // gamma
  "highlights": [0.05, 0.02, 0],  // gain: warm highlights
  "fade": 0.1,               // matte, lifted blacks
  "lut": "look", "lutAmount": 0.8  // a 3D .cube LUT after the corrections, mixed at 80%
}
```

Exposure, white balance and saturation work in linear light; the rest on the display image. The
whole grade is baked into one 33³ LUT and applied on the GPU (WebGL2), with a CPU fallback, so the
preview and the render match. `.cube` files from Resolve, Premiere or a LUT pack work as they are
(3D, input range 0..1). `examples/looks/caldo-pellicola.cube` is a starting look made for this
project (cool shadows, warm highlights, soft S-curve).

Cost: on a computer with a graphics card it is negligible; in a cloud container without one
(software WebGL) the render runs at about 60% of its speed. With motion blur the scenes are
graded once per frame, not once per sub-frame.

What a grade can't do: recover detail that is clipped white or crushed black in the footage,
or fix mixed light (a face lit by a window and a lamp) — that is done on set.

## Audio

`audio` entries play on the comp timeline: `asset`, `start`, `sourceStart`, `duration`, `volume`,
`fadeIn`, `fadeOut`. Unmuted `video` layers add their own sound automatically.

- `volume` can be keyframed like any value (times from the clip's start): a swell, a dip under a line.
- `scene` (id or index) makes `start` relative to that scene's start, so cues follow the edit when
  scene durations change: `{ "sfx": "whoosh", "scene": "demo", "start": 0 }` hits on that cut.
- `role`: `music` (default for assets), `voice` or `sfx`. Music ducks under voice clips automatically.
- `sfx` plays a built-in sound effect instead of an asset, synthesized in code (no files, no licenses):
  `whoosh` and `riser` (stretch them with `duration`), `impact`, `click`, `pop`, `tick`, `sparkle`.
  `start` is when the sound *hits*: the middle of the whoosh, the end of the riser, the attack of the
  rest. So put it exactly on the cut or the beat; the effect starts early on its own.

`mix` sets the final mix:

- `loudness` (default `-14`): integrated loudness target in LUFS, what Instagram, TikTok, YouTube and
  Spotify play at, with peaks kept under -1 dBFS. The CLI uses ffmpeg's two-pass `loudnorm`, the
  browser export a gain to the same target. `false` leaves levels as mixed.
- `duck` (on when a `voice` clip exists): `amount` (dB, default -12), `attack` (0.12 s), `release`
  (0.45 s), `threshold` (-45 dBFS). The music dips while someone speaks, holds through short pauses,
  and is already down when the first word lands. `false` turns it off.

## Cutting on the music

`npm run beats -- music.mp3` writes `music.beats.json` next to the file and prints the tempo, how
reliable it is, the bar starts and the *stacchi forti* (beats where the music jumps up by 6 dB or
more: a drop, a new section, the place for the big cut). Load it as a `beats` asset and point
`beats` at it:

```json
"assets": { "musica": { "type": "audio", "src": "music.mp3" }, "grid": { "type": "beats", "src": "music.beats.json" } },
"beats": { "asset": "grid" },
"audio": [ { "asset": "musica" }, { "sfx": "impact", "beat": 8 } ],
"scenes": [ { "beats": 8, "layers": [] }, { "beats": 4, "transition": { "type": "curve" }, "layers": [] } ]
```

- Scene `beats: n` replaces `duration`: the next cut lands n beats after this scene's cut. The cut is
  the middle of the transition (where the new picture takes over), so a transition straddles the beat.
- Audio `beat: n` plays the clip on beat n (0 = the first beat of the file) instead of `start`.
- `beats.offset`: comp time where the music starts, when it does not start at 0.
- Past the last analysed beat the grid continues at the average spacing.
- `--check` warns about every cut more than one frame off the beat.

Limits: the tracker assumes a steady pulse. With rubato, ambient pads or tempo changes the confidence
drops (under ~0.5 the beats are guesses): listen, and set `duration` by hand there. Bar starts assume
4/4 and are an estimate. Measured on test tracks: mean error under 7 ms, worst 32 ms (one frame at
30 fps is 33 ms).

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
- **Transitions with intent**: `curve` for "next", `zoomThrough` for "going deeper", `flash` on a beat,
  `blur`/`fade` for endings. Keep one direction for a whole video (every `curve` going `left`): the
  story moves forward, and alternating directions reads as noise.
- **Hold, don't drift, on the scenes around a curve**: the transition carries the motion, so a scene
  that also slides makes the cut feel mushy.
- **Sound on the cut**: a `whoosh` on moving transitions, an `impact` on the hit, a `riser` into a
  reveal, `pop`/`click` for UI. Keep effects under the music and the voice (volume 0.4–0.8).
- **Captions on anything with a voice**: most social video plays muted. 1–3 words per page,
  uppercase, heavy weight, in the lower third but above the platform buttons.
- `--srt` writes the captions as a sidecar `.srt` (upload it as closed captions too).
- Check with `--contact 24` before the full render; look for overlaps, cut-off text and empty frames.
