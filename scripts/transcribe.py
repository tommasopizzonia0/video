#!/usr/bin/env python3
"""Transcribes speech to word timings for a Motion "captions" layer, with faster-whisper.

    npm run transcribe -- voce.mp3                  -> voce.words.json next to the audio
    npm run transcribe -- voce.mp3 --prompt "Statera, ilvivaioonline.it"   # names to spell right

The JSON is { language, duration, text, words: [{ text, start, end, p }] }, usable directly as a
"captions" asset. Words the model is unsure of (p < 0.5) are listed at the end: check them by ear.
"""

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path


def refine_onsets(words, samples, rate=16000):
    """Whisper glues a word's start to the previous word's end, so after a pause the next word
    would light up early. Move such starts to where the voice actually comes back."""
    import numpy as np

    hop = rate // 100  # 10 ms frames
    n = len(samples) // hop
    if n == 0:
        return
    rms = np.sqrt(np.mean(samples[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12)
    speech = np.median(rms[rms > np.percentile(rms, 60)]) if n > 10 else rms.max()
    threshold = speech * 0.18
    for w in words:
        span = w["end"] - w["start"]
        expected = 0.09 * len(w["text"]) + 0.15
        if span <= expected:
            continue
        a, b = int(w["start"] * 100), min(n, int(w["end"] * 100))
        # A pause inside the word's span (50 ms under the threshold), then the onset after it:
        # the first frame from which the voice stays up for 30 ms.
        quiet = 0
        for i in range(a, b):
            quiet = quiet + 1 if rms[i] < threshold else 0
            if quiet >= 5:
                for j in range(i + 1, max(i + 1, b - 2)):
                    if (rms[j : j + 3] > threshold).all():
                        w["start"] = min(j / 100, w["end"] - 0.08)
                        break
                break


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("audio", help="audio or video file with the voice")
    ap.add_argument("-o", "--out", help="output JSON (default: <audio>.words.json)")
    ap.add_argument("--language", default="it", help="spoken language (default: it); 'auto' to detect")
    ap.add_argument("--model", default="large-v3-turbo", help="Whisper model (default: large-v3-turbo; 'small' is faster, less accurate)")
    ap.add_argument("--prompt", default=None, help="names, brands and terms to spell correctly")
    args = ap.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("faster-whisper is not installed: pip install faster-whisper", file=sys.stderr)
        return 1

    audio = Path(args.audio)
    if not audio.is_file():
        print(f"no such file: {audio}", file=sys.stderr)
        return 1
    out = Path(args.out) if args.out else audio.with_suffix(".words.json")

    started = time.time()
    # Decoded with ffmpeg (any audio or video file), not the bundled PyAV, whose API keeps changing.
    import numpy as np

    pcm = subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(audio), "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
        capture_output=True,
    )
    if pcm.returncode != 0:
        print(f"ffmpeg could not read {audio}: {pcm.stderr.decode(errors='replace').strip()}", file=sys.stderr)
        return 1
    samples = np.frombuffer(pcm.stdout, dtype=np.float32)

    model = WhisperModel(args.model, device="auto", compute_type="int8")
    segments, info = model.transcribe(
        samples,
        language=None if args.language == "auto" else args.language,
        word_timestamps=True,
        vad_filter=True,
        initial_prompt=args.prompt,
        condition_on_previous_text=False,
    )
    words = []
    for seg in segments:
        for w in seg.words or []:
            text = w.word.strip()
            if not text:
                continue
            # Italian elisions come split ("d" + "'agosto"): one word on screen.
            if words and (text.startswith("'") or words[-1]["text"].endswith("'")):
                prev = words[-1]
                prev["text"] += text
                prev["end"] = w.end
                prev["p"] = min(prev["p"], w.probability)
                continue
            words.append({"text": text, "start": w.start, "end": w.end, "p": w.probability})
    refine_onsets(words, samples)
    for w in words:
        w["start"], w["end"], w["p"] = round(w["start"], 3), round(w["end"], 3), round(w["p"], 3)
    result = {
        "language": info.language,
        "duration": round(info.duration, 3),
        "text": " ".join(w["text"] for w in words),
        "words": words,
    }
    out.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")

    took = time.time() - started
    print(f"{out}  {len(words)} parole, {info.duration:.1f} s di audio in {took:.0f} s ({info.language})")
    unsure = [w for w in words if w["p"] < 0.5]
    if unsure:
        print("parole incerte, da controllare:")
        for w in unsure:
            print(f"  {w['start']:6.2f}s  {w['text']}  ({w['p']:.2f})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
