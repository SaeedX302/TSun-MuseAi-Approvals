#!/usr/bin/env python3
"""Generate icons/icon{16,32,48,128}.png — the TSun MuseAi mark.

Monochrome only: a black plate with one sliced corner and a white geometric
"TS", echoing the TSun monogram. Written by hand with zlib (no image library)
and rendered at 4x with supersampling so the 16 px size stays crisp.

Usage: python3 tools/make-icons.py
"""
import os
import struct
import zlib

INK = (0x11, 0x11, 0x11, 255)   # import/ink black
PAPER = (0xFF, 0xFF, 0xFF, 255)  # white glyphs
SS = 4                          # supersampling factor

# 5x7 bitmap glyphs
GLYPHS = {
    "T": [
        "#####",
        "  #  ",
        "  #  ",
        "  #  ",
        "  #  ",
        "  #  ",
        "  #  ",
    ],
    "S": [
        " ####",
        "#    ",
        "#    ",
        " ### ",
        "    #",
        "    #",
        "#### ",
    ],
}


def inside_plate(x, y, n):
    """Rounded square with the top-right corner sliced off."""
    r = n * 0.21
    if x < 0 or y < 0 or x > n or y > n:
        return False
    # sliced corner: everything above the line from (0.62n, 0) to (n, 0.38n)
    if y < 0.38 * n and y < x - 0.62 * n:
        return False
    cx = min(max(x, r), n - r)
    cy = min(max(y, r), n - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def render(size):
    n = size * SS
    canvas = [[[0, 0, 0, 0] for _ in range(n)] for _ in range(n)]

    def put(px, py, colour):
        if 0 <= px < n and 0 <= py < n:
            canvas[py][px] = list(colour)

    for py in range(n):
        for px in range(n):
            if inside_plate(px + 0.5, py + 0.5, n):
                put(px, py, INK)

    cell = n * 0.085
    gap = cell * 0.62
    glyph_w, glyph_h = 5 * cell, 7 * cell
    ox = (n - (glyph_w * 2 + gap)) / 2.0
    oy = (n - glyph_h) / 2.0

    def draw(letter, x0, y0):
        for gy, row in enumerate(GLYPHS[letter]):
            for gx, ch in enumerate(row):
                if ch != "#":
                    continue
                for sy in range(int(cell * 0.86)):
                    for sx in range(int(cell * 0.86)):
                        put(int(x0 + gx * cell + sx + cell * 0.07),
                            int(y0 + gy * cell + sy + cell * 0.07), PAPER)

    draw("T", ox, oy)
    draw("S", ox + glyph_w + gap, oy)

    out = []
    for y in range(size):
        row = []
        for x in range(size):
            r = g = b = a = 0
            for dy in range(SS):
                for dx in range(SS):
                    pr, pg, pb, pa = canvas[y * SS + dy][x * SS + dx]
                    r += pr * pa
                    g += pg * pa
                    b += pb * pa
                    a += pa
            row.append((0, 0, 0, 0) if a == 0 else (r // a, g // a, b // a, a // (SS * SS)))
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
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(png)
    return len(png)


def main():
    out_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
    os.makedirs(out_dir, exist_ok=True)
    for size in (16, 32, 48, 128):
        path = os.path.join(out_dir, "icon%d.png" % size)
        print("%s (%d bytes)" % (path, write_png(path, render(size))))


if __name__ == "__main__":
    main()
