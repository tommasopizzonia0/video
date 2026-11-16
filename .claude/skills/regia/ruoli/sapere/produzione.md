# Production and media: the whole field, as a checklist of knowledge

The map of what a complete producer and asset manager knows. Apply what fits the brief.

## 1. Formats and quality
- Resolutions: 1080×1920 (9:16), 1080×1350 (4:5), 1080×1080 (1:1), 1920×1080 (16:9), 3840×2160 (4K).
  Upscaling more than ~1.5× is visible; 2× and more looks soft. Downscaling 4K to 1080 sharpens.
- Frame rates: 23.976/24 (cinematic), 25 (PAL/EU TV), 29.97/30 (web/US), 50/60 (smooth motion, slow-mo
  source). Mixing rates causes stutter; conform to the timeline rate.
- Codecs: H.264 (delivery, yuv420p, High profile), H.265/HEVC (efficient, less compatible), ProRes/DNxHR
  (editing/masters), VP9/AV1 (web). Bitrates for social 1080p: 8-16 Mbps. Variable frame rate phone footage
  should be conformed.
- Colour: Rec.709 for web; log footage needs a conversion; HDR (HLG/PQ) is rarely right for social ads.
- Images: at least the frame size; PNG for cut-outs with alpha; JPEG quality ≥ 85; avoid screenshots of
  web pages blown up.

## 2. Coverage: what a video needs to tell its story
- Establishing shot (the place), hero shots (the product), detail/macro (quality), in use (benefit, people),
  process (how it is made/shipped), result/emotion (the customer happy), brand/CTA end card.
- For e-commerce: the range of the catalogue, packaging and delivery, scale (product next to a person),
  proof (reviews, numbers).
- A shot list names subject, shot size, angle, movement, duration, purpose.
- B-roll for every claim the voice makes; cutaways to cover edits.

## 3. Sources
- Own footage (best: authentic, exclusive); AI generation (Higgsfield: consistent style, costs credits;
  check hands, text and physics artifacts); stock (Pixabay, Pexels: free, licence terms, avoid overused
  clips; `npm run photos` in this repo); UGC (permission needed).
- Voice: recorded voice-over, or synthetic (Seed Audio, same voice across the project).
- Music: royalty-free libraries, custom, licensed tracks (sync licence).

## 4. Rights and hygiene
- Licences: commercial use, attribution, model/property releases for recognizable people and places,
  trademarks in shot, music sync rights, Content ID.
- File management: clear names (`scene-subject-version`), one folder per source, no unused or duplicate
  assets, versions kept, credits file for stock.

## 5. Planning
- Brief → script/storyboard → shot list → production → post → review rounds → delivery.
- Deliverables matrix: each platform's formats, lengths, captions, thumbnails, cover frames.
- Budget awareness: say what costs credits or money before proposing it.
