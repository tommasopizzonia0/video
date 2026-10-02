---
name: motion-video
description: Make a motion-design video (promo, reel, launch video, animated titles) with this repo's composition format and render it to MP4. Use when asked to create or edit a video in this project.
---

# Making a video with the Motion engine

1. Read `docs/MOTION.md` (the format) and look at `examples/launch.json` for a complete, polished reference
   (`examples/social-reel.json` shows curve transitions, sound effects on the cuts and captions).
2. Plan before writing: format (1080×1920 for Reels/TikTok, 1920×1080 for YouTube, 1080×1080 for feeds),
   total length, and one line per scene (what is said, what moves). 2–4 s per scene.
3. Write the composition JSON next to its assets (images, videos, music go in `assets` with paths
   relative to the JSON). Keep `comment` fields on scenes so the file stays readable.
4. Validate and review cheaply, then iterate:
   - `npm run render -- path/video.json --contact 24` and read the PNG: check hierarchy, overlaps,
     cut-off text, empty or frozen moments, and that every scene reads in half a second.
   - `--still 1.2,3.4` for a close look at a moment; `--scale 0.5` for a quick draft MP4.
5. Render the final: `npm run render -- path/video.json -o out/video.mp4` (needs Chromium + ffmpeg;
   in a cloud container set `PLAYWRIGHT_BROWSERS_PATH` if Chromium is preinstalled elsewhere).
6. Deliver the MP4 plus a poster frame (`--still`), and keep the JSON so the video can be edited
   later in the browser (Motion view, `#motion`).

Design rules that matter most: one accent color and one accent serif word per headline; headlines enter
with `maskUp` by word, secondary text later with `fadeUp`; ease out (`smooth`, `outExpo`), never linear
arrivals; slow background drift so no frame is static; `grain` ~0.04 and `vignette` ~0.3 for finish;
`motionBlur` for fast moves. Social and ads: `curve` transitions in one direction, a `sfx` on each cut
(cued with `scene`), `captions` on anything spoken (most feeds play muted), and leave `mix.loudness` at
-14 LUFS. When the engine can't express something, extend the engine
(`src/engine/`, with a test in `src/engine/engine.test.ts`) rather than faking it.
