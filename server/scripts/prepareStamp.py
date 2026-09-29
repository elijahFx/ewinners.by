#!/usr/bin/env python3
"""Extract stamp+signature from stamp.pdf into transparent PNG for PDFKit."""
from pathlib import Path
import fitz
from PIL import Image
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'assets' / 'stamp.pdf'
FALLBACK = ROOT.parent / 'ewinners.by' / 'public' / 'stamp.pdf'
OUT = ROOT / 'assets' / 'stamp-signature.png'


def main():
    src = SRC if SRC.exists() else FALLBACK
    if not src.exists():
        raise SystemExit(f'stamp pdf not found: {src}')

    doc = fitz.open(src)
    page = doc[0]
    pix = page.get_pixmap(matrix=fitz.Matrix(3, 3), alpha=False)
    raw = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).astype(np.float32)

    brightness = raw.mean(axis=2)
    strong = brightness < 220
    row_counts = strong.sum(axis=1)
    row_thr = max(5, row_counts.max() * 0.02)
    active = row_counts >= row_thr
    segs = []
    start = None
    for i, v in enumerate(active):
        if v and start is None:
            start = i
        if (not v) and start is not None:
            segs.append((start, i - 1, int(row_counts[start:i].sum())))
            start = None
    if start is not None:
        segs.append((start, len(active) - 1, int(row_counts[start:].sum())))
    main_seg = max(segs, key=lambda s: s[2])

    pad = 30
    top = max(0, main_seg[0] - pad)
    bottom = min(raw.shape[0], main_seg[1] + pad)
    col_counts = strong[top:bottom].sum(axis=0)
    cols = np.where(col_counts >= max(3, col_counts.max() * 0.02))[0]
    left = max(0, int(cols.min()) - pad)
    right = min(raw.shape[1], int(cols.max()) + pad)

    crop = raw[top:bottom, left:right]
    br = brightness[top:bottom, left:right]
    r, g, b = crop[:, :, 0], crop[:, :, 1], crop[:, :, 2]
    blueish = (b > r + 8) & (b > g + 5) & (br < 252)
    dark = (br < 160) & (np.abs(r - g) < 25) & (np.abs(g - b) < 25)
    ink = blueish | dark | ((br < 235) & ((b > r) | (br < 180)))

    rgba = np.zeros((crop.shape[0], crop.shape[1], 4), dtype=np.uint8)
    rgba[:, :, 0] = np.clip(r, 0, 255).astype(np.uint8)
    rgba[:, :, 1] = np.clip(g, 0, 255).astype(np.uint8)
    rgba[:, :, 2] = np.clip(b, 0, 255).astype(np.uint8)
    dist = 255.0 - br
    alpha = np.where(ink, np.clip(dist * 4.5, 0, 255), 0)
    alpha = np.where(blueish & (dist > 15), np.maximum(alpha, 200), alpha)
    alpha = np.where(dark, np.maximum(alpha, 230), alpha)
    alpha = np.where(br >= 248, 0, alpha)
    rgba[:, :, 3] = alpha.astype(np.uint8)

    out = Image.fromarray(rgba, 'RGBA')
    bb = out.split()[-1].getbbox()
    if bb:
        out = out.crop(bb)
    if out.width > 900:
        ratio = 900 / out.width
        out = out.resize((900, int(out.height * ratio)), Image.Resampling.LANCZOS)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.save(OUT, optimize=True)
    print(f'OK {OUT} {out.size}')


if __name__ == '__main__':
    main()
