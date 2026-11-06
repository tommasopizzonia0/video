#!/usr/bin/env python3
"""Background removal with BiRefNet (MIT licence) through rembg (MIT), for `npm run cutout`.

Reads image paths and writes, for each, a PNG with a transparent background next to the output
folder given; prints one JSON line per file with what the checks found. Called by scripts/cutout.mjs.
"""
import json
import sys
import time

import numpy as np
import onnxruntime as ort
from PIL import Image
from rembg import new_session, remove


def main():
    model, out_dir, margin = sys.argv[1], sys.argv[2], float(sys.argv[3])
    files = sys.argv[4:]
    opts = ort.SessionOptions()
    # Without the memory arena the peak stays at one image's worth (about 8 GB with the full model).
    opts.enable_cpu_mem_arena = False
    opts.enable_mem_pattern = False
    session = new_session(model, sess_opts=opts)
    done = []
    for src in files:
        t0 = time.time()
        image = Image.open(src).convert('RGB')
        cut = remove(image, session=session, post_process_mask=False)
        alpha = np.asarray(cut.getchannel('A'))
        h, w = alpha.shape
        solid = alpha > 127
        cover = float(solid.mean())
        # Edge pixels that are neither in nor out: a soft, uncertain border (hair, glass, motion blur).
        soft = float(((alpha > 16) & (alpha < 240)).sum() / max(1, solid.sum()))
        ys, xs = np.nonzero(alpha > 16)
        result = {'src': src, 'seconds': round(time.time() - t0, 1), 'cover': round(cover, 3), 'soft': round(soft, 3)}
        if len(xs) == 0:
            result['empty'] = True
            print(json.dumps(result), flush=True)
            continue
        x0, x1, y0, y1 = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
        # Cut by the frame: the product continues outside the photo.
        result['touches'] = [side for side, hit in (('sinistra', x0 == 0), ('destra', x1 == w), ('alto', y0 == 0), ('basso', y1 == h)) if hit]
        pad = int(round(margin * max(x1 - x0, y1 - y0)))
        box = (max(0, x0 - pad), max(0, y0 - pad), min(w, x1 + pad), min(h, y1 + pad))
        name = src.replace('\\', '/').split('/')[-1].rsplit('.', 1)[0]
        out = f'{out_dir}/{name}-scontorno.png'
        cut.crop(box).save(out, optimize=True)
        result.update({'out': out, 'width': box[2] - box[0], 'height': box[3] - box[1]})
        print(json.dumps(result), flush=True)
        done.append(out)
    if done:
        sheet(done, f'{out_dir}/provini-scontorno.jpg')


def sheet(files, out, cell=420):
    """Each cut-out on a background half dark, half light, so fringes of either color show."""
    cols = min(4, len(files))
    rows = (len(files) + cols - 1) // cols
    page = Image.new('RGB', (cols * cell, rows * cell), (120, 120, 120))
    for i, f in enumerate(files):
        bg = Image.new('RGB', (cell, cell), (238, 236, 232))
        bg.paste((34, 34, 38), (0, 0, cell // 2, cell))
        im = Image.open(f)
        im.thumbnail((cell - 30, cell - 30))
        bg.paste(im, ((cell - im.width) // 2, (cell - im.height) // 2), im)
        page.paste(bg, ((i % cols) * cell, (i // cols) * cell))
    page.save(out, quality=88)


if __name__ == '__main__':
    main()
