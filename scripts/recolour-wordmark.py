"""Recolour the EverCalm wordmark by part, without touching its shapes.

Type, hands, sun and rays are separated by connected components on the
original artwork's own pixels; every pixel keeps its original alpha, so the
letterforms, proportions and artwork stay exactly as supplied. Two assets come
out: the brand mark, and an on-dark variant that changes only the two colours
that would otherwise disappear on a navy ground.
"""
from PIL import Image
from collections import deque

SRC = 'public/brand/evercalm-wordmark.png'
OUT = 'public/brand/evercalm-wordmark-brand.png'
OUT_DARK = 'public/brand/evercalm-wordmark-brand-on-dark.png'

NAVY = (0x1E, 0x2D, 0x3D)        # wordmark
TEAL = (0x2A, 0x5C, 0x5A)        # hands
CORAL = (0xE8, 0x85, 0x6C)       # central light
SAGE = (0x7F, 0xB5, 0xA0)        # rays
SAND = (0xF5, 0xE6, 0xD3)        # wordmark on dark (13.47:1 on navy-900)
TEAL_LIGHT = (0x7F, 0xB5, 0xB0)  # hands on dark (7.18:1 on navy-900)

im = Image.open(SRC).convert('RGBA')
W, H = im.size
px = im.load()
sat = lambda p: max(p[0], p[1], p[2]) - min(p[0], p[1], p[2])

label = [[0] * W for _ in range(H)]
comps = []
for y in range(H):
    for x in range(W):
        if label[y][x] or px[x, y][3] <= 60:
            continue
        cid = len(comps) + 1
        q = deque([(x, y)])
        label[y][x] = cid
        pixels, colourful = [], 0
        while q:
            cx, cy = q.popleft()
            pixels.append((cx, cy))
            if sat(px[cx, cy]) > 35:
                colourful += 1
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < W and 0 <= ny < H and not label[ny][nx] and px[nx, ny][3] > 60:
                        label[ny][nx] = cid
                        q.append((nx, ny))
        comps.append({'id': cid, 'px': pixels, 'colourful': colourful / len(pixels)})

glyph = sorted([c for c in comps if c['colourful'] > 0.5], key=lambda c: -len(c['px']))
for c in glyph:
    xs = [p[0] for p in c['px']]
    ys = [p[1] for p in c['px']]
    w, h = max(xs) - min(xs) + 1, max(ys) - min(ys) + 1
    c['centre'] = (sum(xs) / len(xs), sum(ys) / len(ys))
    c['fill'] = len(c['px']) / (w * h)

hands, rest = glyph[:2], glyph[2:]
sun = max(rest, key=lambda c: len(c['px']) * c['fill']) if rest else None
rays = [c for c in rest if c is not sun]
print(f'hands {[len(c["px"]) for c in hands]}  sun {len(sun["px"]) if sun else 0}  rays {len(rays)}')

def render(type_rgb, hands_rgb, path):
    colour_of = {c['id']: hands_rgb for c in hands}
    if sun:
        colour_of[sun['id']] = CORAL
    for c in rays:
        colour_of[c['id']] = SAGE
    parts = [(c['centre'], colour_of[c['id']]) for c in glyph]
    out = Image.new('RGBA', (W, H))
    op = out.load()
    for y in range(H):
        for x in range(W):
            p = px[x, y]
            if p[3] == 0:
                op[x, y] = (0, 0, 0, 0)
                continue
            cid = label[y][x]
            if cid in colour_of:
                rgb = colour_of[cid]
            elif sat(p) > 15 and parts:
                rgb = min(parts, key=lambda gp: (gp[0][0] - x) ** 2 + (gp[0][1] - y) ** 2)[1]
            else:
                rgb = type_rgb
            op[x, y] = (*rgb, p[3])
    out = out.crop(out.getbbox())
    out.save(path)
    print('wrote', path, out.size)

render(NAVY, TEAL, OUT)
render(SAND, TEAL_LIGHT, OUT_DARK)
