#!/usr/bin/env python3
"""Generate the extension icons (icons/icon{16,32,48,128}.png).

Chrome shows a puzzle piece for extensions without icons, so this repo ships
real ones. No image library is required: the PNGs are written by hand with
zlib, and the artwork (violet rounded square + amber underline + white "AI")
is rasterised with 4x supersampling so the small sizes stay crisp.

Usage: python3 tools/make-icons.py
"""
import os
import struct
import zlib

BG_TOP = (167, 139, 250)      # #a78bfa violet
BG_BOTTOM = (79, 70, 229)     # #4f46e5 indigo
ACCENT = (245, 158, 11, 255)  # #f59e0b amber
INK = (255, 255, 255, 255)
SS = 4                        # supersampling factor

# 5x7 bitmap glyphs for "A" and "I"
GLYPHS = {
    "A": [
        " ### ",
        "#   #",
        "#   #",
        "#####",
        "#   #",
        "#   #",
        "#   #",
    ],
    "I": [
        "#####",
        "  #  ",
        "  #  ",
        "  #  ",
        "  #  ",
        "  #  ",
        "#####",
    ],
}


def in_rounded_rect(x, y, w, h, r):
    if x < 0 or y < 0 or x > w or y > h:
        return False
    cx = min(max(x, r), w - r)
    cy = min(max(y, r), h - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r + 0.0001 or (r <= x <= w - r) or (r <= y <= h - r)


def render(size):
    """Return a list of rows, each a list of (r, g, b, a) tuples."""
    n = size * SS
    radius = n * 0.24
    # layout of the glyph block
    cell = (n * 0.085)
    gap = cell * 0.6
    glyph_w = 5 * cell
    glyph_h = 7 * cell
    total_w = glyph_w * 2 + gap
    ox = (n - total_w) / 2.0
    oy = (n - glyph_h) / 2.0 - n * 0.06
    bar_top = oy + glyph_h + n * 0.10
    bar_h = max(SS, n * 0.055)
    bar_w = total_w * 0.42
    bar_x = (n - bar_w) / 2.0

    hi = [[[0, 0, 0, 0] for _ in range(n)] for _ in range(n)]

    def put(px, py, colour):
        if 0 <= px < n and 0 <= py < n:
            hi[py][px] = list(colour)

    for py in range(n):
        for px in range(n):
            if not in_rounded_rect(px + 0.5, py + 0.5, n, n, radius):
                continue
            t = py / float(n)
            colour = (
                int(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t),
                int(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t),
                int(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t),
                255,
            )
            put(px, py, colour)

    def draw_glyph(glyph, x0, y0):
        rows = GLYPHS[glyph]
        for gy, row in enumerate(rows):
            for gx, ch in enumerate(row):
                if ch != "#":
                    continue
                for sy in range(int(cell * 0.82)):
                    for sx in range(int(cell * 0.82)):
                        put(int(x0 + gx * cell + sx + cell * 0.09), int(y0 + gy * cell + sy + cell * 0.05), INK)

    draw_glyph("A", ox, oy)
    draw_glyph("I", ox + glyph_w + gap, oy)

    for py in range(int(bar_top), int(bar_top + bar_h)):
        for px in range(int(bar_x), int(bar_x + bar_w)):
            put(px, py, ACCENT)

    # downsample
    out = []
    for y in range(size):
        row = []
        for x in range(size):
            r = g = b = a = 0
            for dy in range(SS):
                for dx in range(SS):
                    pr, pg, pb, pa = hi[y * SS + dy][x * SS + dx]
                    r += pr * pa
                    g += pg * pa
                    b += pb * pa
                    a += pa
            if a == 0:
                row.append((0, 0, 0, 0))
            else:
                row.append((r // a, g // a, b // a, a // (SS * SS)))
        out.append(row)
    return out


def write_png(path, pixels):
    size = len(pixels)
    raw = bytearray()
    for row in pixels:
        raw.append(0)  # filter: none
        for r, g, b, a in row:
            raw += bytes((r, g, b, a))

    def chunk(tag, data):
        out = struct.pack(">I", len(data)) + tag + data
        return out + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(png)
    return len(png)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(os.path.dirname(here), "icons")
    os.makedirs(out_dir, exist_ok=True)
    for size in (16, 32, 48, 128):
        path = os.path.join(out_dir, "icon%d.png" % size)
        written = write_png(path, render(size))
        print("%s (%d bytes)" % (path, written))


if __name__ == "__main__":
    main()
