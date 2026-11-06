#!/usr/bin/env python3
"""
Rebuilds the VFX atlas, its UV table and the binary dust digit sprite.

Sources (the raw packs are large, so they stay out of the repo):
  https://kenney.nl/assets/particle-pack    CC0, by Kenney
  https://kenney.nl/assets/smoke-particles  CC0, by Kenney
Unzip each pack and pass the two folders. Embers, ash, blood, slashes, impacts, wind, light rays, cracks,
glow and binary.png are drawn here: the art review threw out the pack's twinkles and comic splats, and
the game wants restrained, heavy shapes, so each one is built from noise and supersampled.

Needs: pip install pillow numpy
Run:   python tools/build-fx-atlas.py <particle pack folder> <smoke pack folder> [preview.png]

Writes client/public/fx/atlas.png, client/public/fx/binary.png and client/src/game/fx/atlas.ts.
"""
import math
import random
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ATLAS_PNG = ROOT / 'client/public/fx/atlas.png'
BINARY_PNG = ROOT / 'client/public/fx/binary.png'
ATLAS_TS = ROOT / 'client/src/game/fx/atlas.ts'

ATLAS_SIZE = 1024
GUTTER = 8  # Transparent pixels between sprites, so bilinear filtering cannot pick up a neighbor.
ALPHA_LEVELS = 64  # Fewer alpha steps compress far better, and the dither pass hides the difference.
SUPERSAMPLE = 4

# ---------- Kenney sprites ----------


def grayscale(rgba):
    return rgba[..., :3].mean(axis=2)


def stretch(values, low, high):
    return np.clip((values - low) / max(high - low, 1e-3), 0, 1)


def load_kenney(path, shaded, gamma):
    """
    Returns white or grayscale on transparent. Kenney's alpha peaks well below full on the soft
    sprites, so it is stretched to full range. A gamma above 1 then tightens a hazy sprite. Shaded
    sprites keep their inner form in gray.
    """
    rgba = np.asarray(Image.open(path).convert('RGBA'), dtype=np.float32)
    alpha = stretch(rgba[..., 3], 6, np.percentile(rgba[..., 3], 99.8)) ** gamma
    out = np.full(rgba.shape, 255, dtype=np.float32)
    if shaded:
        gray = grayscale(rgba)
        visible = gray[rgba[..., 3] > 16]
        out[..., :3] = (120 + 135 * stretch(gray, np.percentile(visible, 2), np.percentile(visible, 99.5)))[..., None]
    out[..., 3] = alpha * 255
    return Image.fromarray(out.astype(np.uint8), 'RGBA')


def crop_centered(image):
    """Square crop around the image center, so the sprite still spins about its own middle."""
    box = image.getchannel('A').point(lambda a: 255 if a > 10 else 0).getbbox()
    cx, cy = image.width / 2, image.height / 2
    half = max(cx - box[0], box[2] - cx, cy - box[1], box[3] - cy)
    half = math.ceil(min(half + 2, cx, cy))
    square = image.crop((int(cx - half), int(cy - half), int(cx + half), int(cy + half)))
    # Haze can reach the crop, which would show as a square. Fade it out before the corners.
    data = np.array(square, dtype=np.float32)
    ys, xs = np.mgrid[0 : square.height, 0 : square.width]
    radius = np.hypot(xs + 0.5 - half, ys + 0.5 - half) / half
    data[..., 3] *= 1 - stretch(radius, 0.84, 0.99)
    return Image.fromarray(data.astype(np.uint8), 'RGBA')


def crop_tight(image):
    box = image.getchannel('A').point(lambda a: 255 if a > 10 else 0).getbbox()
    return image.crop((max(box[0] - 2, 0), max(box[1] - 2, 0), min(box[2] + 2, image.width), min(box[3] + 2, image.height)))


def fit(image, width, height):
    scale = min(width / image.width, height / image.height)
    size = (max(round(image.width * scale), 1), max(round(image.height * scale), 1))
    # Scale in premultiplied form, or the gray of invisible pixels would bleed into soft edges.
    data = np.asarray(image, dtype=np.float32) / 255
    data[..., :3] *= data[..., 3:]
    channels = [Image.fromarray(data[..., index]).resize(size, Image.LANCZOS) for index in range(4)]
    out = np.stack([np.asarray(channel) for channel in channels], axis=2).clip(0, 1)
    rgb = np.where(out[..., 3:] > 1e-3, out[..., :3] / np.maximum(out[..., 3:], 1e-3), 1)
    return Image.fromarray((np.dstack([rgb.clip(0, 1), out[..., 3]]) * 255).astype(np.uint8), 'RGBA')


def fade_edges(image, pixels=4):
    """Some sources run off their own canvas. This keeps those from ending in a hard cut on the quad."""
    data = np.array(image, dtype=np.float32)
    ys, xs = np.mgrid[0 : image.height, 0 : image.width]
    distance = np.minimum.reduce([xs, ys, image.width - 1 - xs, image.height - 1 - ys])
    data[..., 3] *= np.clip(distance / pixels, 0, 1)
    return Image.fromarray(data.astype(np.uint8), 'RGBA')


def kenney(folder, stem, size, *, tight=False, turn=False, shaded=False, gamma=1.0):
    image = load_kenney(folder / f'{stem}.png', shaded, gamma)
    image = crop_tight(image) if tight else crop_centered(image)
    if turn:
        image = image.rotate(-90, expand=True)
    return fade_edges(fit(image, *size))


# ---------- Drawn sprites ----------


def white_with_alpha(alpha):
    """Takes a supersampled grayscale mask and returns the final white-on-transparent sprite."""
    alpha = alpha.resize((alpha.width // SUPERSAMPLE, alpha.height // SUPERSAMPLE), Image.LANCZOS)
    sprite = Image.new('RGBA', alpha.size, (255, 255, 255, 0))
    sprite.putalpha(alpha)
    return sprite


def stroke(width, height, points):
    """Draws (x, y, radius, brightness) samples, all in 0-1 of the sprite's size, as one soft line."""
    mask = Image.new('L', (width * SUPERSAMPLE, height * SUPERSAMPLE), 0)
    draw = ImageDraw.Draw(mask)
    for x, y, radius, brightness in points:
        px, py, pr = x * mask.width, y * mask.height, radius * mask.height
        draw.ellipse((px - pr, py - pr, px + pr, py + pr), fill=int(brightness * 255))
    return white_with_alpha(mask.filter(ImageFilter.GaussianBlur(SUPERSAMPLE * 0.45)))


def noise(rng, height, width, cells_y, cells_x):
    """Smooth value noise in 0-1: random numbers on a coarse grid, scaled up with a soft filter."""
    grid = np.array([[rng.random() for _ in range(cells_x)] for _ in range(cells_y)], dtype=np.float32)
    image = Image.fromarray(grid).resize((width, height), Image.BICUBIC)
    return np.asarray(image).clip(0, 1)


def fbm(rng, height, width, base=3, octaves=4):
    total = np.zeros((height, width), dtype=np.float32)
    amplitude = 1.0
    span = 0.0
    for octave in range(octaves):
        cells = base * 2**octave
        total += noise(rng, height, width, cells, cells) * amplitude
        span += amplitude
        amplitude *= 0.55
    return total / span


def sprite_from(gray, alpha):
    """Gray keeps the inner shading, so a tint gets lighter and darker parts instead of a flat cutout."""
    rgba = np.zeros((*alpha.shape, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(gray, 0, 1)[..., None]
    rgba[..., 3] = np.clip(alpha, 0, 1)
    return fade_edges(Image.fromarray((rgba * 255).astype(np.uint8), 'RGBA'), 2)


def centered_grid(height, width):
    ys, xs = np.mgrid[0:height, 0:width].astype(np.float32)
    return (xs + 0.5) / width * 2 - 1, (ys + 0.5) / height * 2 - 1


def glow():
    """A smooth falloff with no flat top, so stacked additive glows do not show a disc."""
    xs, ys = centered_grid(96, 96)
    radius = np.hypot(xs, ys)
    return sprite_from(np.ones_like(radius), np.clip(1 - radius**2, 0, 1) ** 3)


def ember(seed, stretch_x=1.0):
    """A coal rather than a twinkle: a lumpy blob with a hot middle and a dim, broken edge."""
    rng = random.Random(seed)
    size = 32
    xs, ys = centered_grid(size, size)
    radius = np.hypot(xs / stretch_x, ys)
    lumps = fbm(rng, size, size, base=3, octaves=2)
    body = np.clip(1 - radius / (0.3 + 0.55 * lumps), 0, 1)
    return sprite_from(0.55 + 0.45 * np.clip(body * 1.8, 0, 1), np.clip(body * 2.4, 0, 1))


def ash_flake(seed):
    rng = random.Random(seed)
    size = 40
    xs, ys = centered_grid(size, size)
    angle = rng.uniform(0, math.pi)
    u = xs * math.cos(angle) + ys * math.sin(angle)
    v = -xs * math.sin(angle) + ys * math.cos(angle)
    torn = fbm(rng, size, size, base=4, octaves=3)
    body = 1 - np.hypot(u / 0.85, v / 0.5) - (torn - 0.5) * 1.3
    return sprite_from(0.55 + 0.45 * fbm(rng, size, size, base=5, octaves=2), np.clip(body * 7, 0, 1))


def blood_drop():
    """A droplet caught in motion: a blunt head with a thin smear behind it. No teardrop outline."""
    width, height = 64, 20
    xs, ys = centered_grid(height, width)
    along = (xs + 1) / 2
    half_width = 0.06 + 0.62 * along**2.2 * np.clip((1 - along) * 9, 0, 1) ** 0.5
    body = np.clip(1 - np.abs(ys) / np.maximum(half_width, 1e-3), 0, 1)
    return sprite_from(0.6 + 0.4 * body, np.clip(body * 3, 0, 1) * (0.25 + 0.75 * along))


def droplets(rng, width, height, count, place):
    """Stamps soft-edged droplets of different strength. place(rng) gives x, y, radius, strength in 0-1."""
    mask = Image.new('L', (width * SUPERSAMPLE, height * SUPERSAMPLE), 0)
    draw = ImageDraw.Draw(mask)
    for _ in range(count):
        x, y, radius, strength = place(rng)
        px, py, pr = x * mask.width, y * mask.height, radius * mask.height
        draw.ellipse((px - pr, py - pr, px + pr, py + pr), fill=int(strength * 255))
    mask = mask.filter(ImageFilter.GaussianBlur(SUPERSAMPLE * 0.5)).resize((width, height), Image.LANCZOS)
    return np.asarray(mask, dtype=np.float32) / 255


def blood_mist(seed):
    rng = random.Random(seed)
    size = 128
    xs, ys = centered_grid(size, size)
    falloff = np.clip(1 - np.hypot(xs, ys) / 0.92, 0, 1)
    cloud = np.clip(fbm(rng, size, size, base=4, octaves=4) * 1.9 - 0.62, 0, 1) * falloff**1.3

    def place(random_source):
        angle = random_source.uniform(0, math.tau)
        distance = random_source.uniform(0, 0.42) ** 0.9
        return 0.5 + math.cos(angle) * distance, 0.5 + math.sin(angle) * distance, random_source.uniform(0.003, 0.012), random_source.uniform(0.35, 1)

    specks = droplets(rng, size, size, 110, place)
    alpha = np.maximum(cloud * 1.15, specks * (0.5 + 0.5 * falloff))
    return sprite_from(0.5 + 0.5 * fbm(rng, size, size, base=6, octaves=2), alpha)


def blood_spray(seed):
    """A fan thrown from the left edge. Fat, dense drops near the wound; fine, faint ones far out."""
    rng = random.Random(seed)
    width, height = 192, 96

    def place(random_source):
        reach = random_source.random() ** 0.8
        spread = random_source.gauss(0, 0.05 + 0.3 * reach)
        return 0.03 + reach * 0.93, 0.5 + spread, (0.03 * (1 - reach) ** 1.5 + 0.005) * random_source.uniform(0.6, 1.3), random_source.uniform(0.4, 1) * (1 - 0.45 * reach)

    drops = droplets(rng, width, height, 240, place)
    xs, ys = centered_grid(height, width)
    along = (xs + 1) / 2
    wedge = np.clip(1 - np.abs(ys) / (0.1 + 0.72 * along), 0, 1) * np.clip(1 - along * 1.1, 0, 1)
    haze = wedge * np.clip(fbm(rng, height, width, base=5, octaves=3) * 1.8 - 0.55, 0, 1) * 0.6
    return sprite_from(0.55 + 0.45 * fbm(rng, height, width, base=7, octaves=2), np.maximum(drops, haze))


def blood_splat(seed, core):
    """A ground stain. Dark and thick in the middle, thin at the rim, with drops thrown clear of it."""
    rng = random.Random(seed)
    size = 128
    xs, ys = centered_grid(size, size)
    radius = np.hypot(xs, ys)
    wobble = fbm(rng, size, size, base=4, octaves=4)
    body = np.clip((core * 2.6 + (wobble - 0.5) * 0.65 - radius) * 7, 0, 1)

    def place(random_source):
        angle = random_source.uniform(0, math.tau)
        distance = core * 0.9 + random_source.random() ** 1.4 * 0.36
        return 0.5 + math.cos(angle) * distance, 0.5 + math.sin(angle) * distance, random_source.uniform(0.003, 0.02) * (1.2 - distance), random_source.uniform(0.35, 1)

    drops = droplets(rng, size, size, 85, place)
    density = 0.55 + 0.45 * fbm(rng, size, size, base=6, octaves=3)
    return sprite_from(0.5 + 0.5 * density, np.maximum(body * density, drops * np.clip(1.05 - radius, 0, 1)))


def thin_slash(seed, width, height, curve):
    """A cut, not a crescent: razor thin, tapered to nothing, one edge sharp and the other soft."""
    rng = random.Random(seed)
    xs, ys = centered_grid(height, width)
    center = curve * (xs**2 - 0.45) * -1
    taper = (1 - xs**2) ** 1.6
    half = 0.03 + 0.26 * taper
    offset = (ys - center) / half
    sharp = np.exp(-np.maximum(offset, 0) ** 2 * 14)
    soft = np.exp(-np.minimum(offset, 0) ** 2 * 1.6)
    grain = noise(rng, height, width, 3, 22) * 0.45 + 0.55
    alpha = sharp * soft * taper**0.7 * grain
    return sprite_from(0.72 + 0.28 * np.exp(-offset**2 * 4), alpha)


def impact_burst(seed):
    """The first frames of a hit. Uneven spikes from angle-based noise, so it never reads as a star icon."""
    rng = random.Random(seed)
    size = 128
    xs, ys = centered_grid(size, size)
    radius = np.hypot(xs, ys)
    angle = np.arctan2(ys, xs)
    spikes = np.zeros_like(radius)
    for frequency, weight in ((5, 0.6), (11, 0.3), (23, 0.22)):
        phase = rng.uniform(0, math.tau)
        phase2 = rng.uniform(0, math.tau)
        spikes += weight * (0.5 + 0.5 * np.sin(angle * frequency + phase + np.sin(angle * 2 + phase2)))
    reach = 0.16 + 0.72 * np.clip(spikes - 0.35, 0, 1) ** 1.7
    rays = np.clip(1 - radius / reach, 0, 1) ** 1.2
    core = np.exp(-(radius / 0.15) ** 2)
    return sprite_from(0.65 + 0.35 * core, np.maximum(rays * 0.85, core))


def wind_streak():
    """A thin gust line, running left to right. It is thickest in the middle and fades at both ends."""
    points = []
    for index in range(1500):
        t = index / 1499
        taper = math.sin(math.pi * t)
        x = 0.03 + 0.94 * t
        y = 0.72 - 0.44 * math.sin(math.pi * (t * 0.9 + 0.05)) ** 1.5 + 0.1 * t
        points.append((x, y, 0.008 + 0.028 * taper**1.4, taper**0.8))
    return stroke(256, 48, points)


def wind_wisp(seed):
    """Sheared air: thin parallel lines of different lengths that break up, with no curl at the end."""
    rng = random.Random(seed)
    points = []
    for _ in range(9):
        start = rng.uniform(0.02, 0.55)
        length = rng.uniform(0.25, 0.97 - start)
        base_y = rng.uniform(0.2, 0.8)
        bend = rng.uniform(-0.1, 0.1)
        strength = rng.uniform(0.35, 1)
        for index in range(600):
            t = index / 599
            taper = math.sin(math.pi * t)
            y = base_y + bend * math.sin(math.pi * t)
            points.append((start + length * t, y, 0.006 + 0.012 * taper, taper**1.3 * strength))
    return stroke(256, 48, points)


def light_ray():
    width, height = 48, 192
    xs, ys = centered_grid(height, width)
    rng = random.Random(4)
    up = (1 - ys) / 2
    fan = 0.26 + 0.5 * up
    beam = np.exp(-(xs / fan) ** 2 * 2.2)
    strands = noise(rng, height, width, 3, 12) * 0.5 + 0.5
    alpha = beam * np.clip(up * 12, 0, 1) * (1 - up) ** 1.25 * strands
    return sprite_from(np.ones_like(alpha), alpha)


def ground_crack(seed):
    """Jagged lines that fork as they leave the center, drawn thin, fading before the rim."""
    rng = random.Random(seed)
    size = 128
    mask = Image.new('L', (size * SUPERSAMPLE, size * SUPERSAMPLE), 0)
    draw = ImageDraw.Draw(mask)

    def branch(x, y, angle, length, width, depth):
        steps = max(int(length / 0.03), 2)
        for _ in range(steps):
            angle += rng.uniform(-0.55, 0.55)
            nx, ny = x + math.cos(angle) * 0.03, y + math.sin(angle) * 0.03
            fade = int(255 * max(1 - math.hypot(nx - 0.5, ny - 0.5) / 0.48, 0) ** 0.6)
            draw.line((x * mask.width, y * mask.height, nx * mask.width, ny * mask.height), fill=fade, width=max(int(width * SUPERSAMPLE), 1))
            x, y = nx, ny
            if depth > 0 and rng.random() < 0.2:
                branch(x, y, angle + rng.choice((-1, 1)) * rng.uniform(0.5, 1.1), length * 0.5, width * 0.65, depth - 1)
            width = max(width * 0.93, 0.6)

    arms = 7
    for index in range(arms):
        branch(0.5, 0.5, index / arms * math.tau + rng.uniform(-0.3, 0.3), rng.uniform(0.25, 0.46), 2.4, 2)
    return white_with_alpha(mask.filter(ImageFilter.GaussianBlur(SUPERSAMPLE * 0.35)))


def grass_blade():
    points = []
    for index in range(600):
        t = index / 599
        points.append((0.45 + 0.34 * t * t, 0.97 - 0.92 * t, 0.012 + 0.018 * (1 - t), 1))
    return stroke(24, 48, points)


def dead_leaf(seed):
    rng = random.Random(seed)
    size = 24
    xs, ys = centered_grid(size, size)
    wobble = fbm(rng, size, size, base=3, octaves=2)
    body = 1 - np.hypot(xs / 0.9, ys / 0.5) - (wobble - 0.5) * 0.9
    return sprite_from(0.65 + 0.35 * (1 - np.abs(ys) * 2).clip(0, 1), np.clip(body * 6, 0, 1))


def binary_sprite():
    """Bold monospace 1 and 0, like the HUD icon. White, so the shader picks the red from its seed."""
    one = ['...##...', '..###...', '.####...', '...##...', '...##...', '...##...', '.######.', '........']
    zero = ['..####..', '.##..##.', '.##..##.', '.##..##.', '.##..##.', '.##..##.', '..####..', '........']
    sprite = Image.new('RGBA', (16, 8), (255, 255, 255, 0))
    for offset, glyph in ((0, one), (8, zero)):
        for y, row in enumerate(glyph):
            for x, cell in enumerate(row):
                if cell == '#':
                    sprite.putpixel((offset + x, y), (255, 255, 255, 255))
    return sprite


# ---------- Atlas ----------


def build_sprites(particles, smoke):
    black = smoke / 'Black smoke'
    return [
        # Sprite name, picture, where it came from.
        ('shockwave', kenney(particles, 'circle_01', (192, 192), gamma=1.3), 'Kenney Particle Pack circle_01. Soft ring with a faint inner fill.'),
        ('smoke-ring', kenney(particles, 'smoke_10', (128, 128)), 'Kenney Particle Pack smoke_10.'),
        ('ring', kenney(particles, 'circle_02', (128, 128), gamma=1.8), 'Kenney Particle Pack circle_02. Crisp ring. Use faint and brief.'),
        ('smoke-1', kenney(particles, 'smoke_07', (128, 128), shaded=True), 'Kenney Particle Pack smoke_07. Shaded in gray.'),
        ('smoke-2', kenney(particles, 'smoke_04', (128, 128), shaded=True), 'Kenney Particle Pack smoke_04. Shaded in gray.'),
        ('smoke-3', kenney(black, 'blackSmoke03', (128, 128), shaded=True), 'Kenney Smoke Particles blackSmoke03. Lifted to light gray so it can be tinted.'),
        ('smoke-4', kenney(black, 'blackSmoke19', (128, 128), shaded=True), 'Kenney Smoke Particles blackSmoke19. Lifted to light gray so it can be tinted.'),
        ('dust-1', kenney(particles, 'smoke_02', (128, 128), shaded=True), 'Kenney Particle Pack smoke_02.'),
        ('dust-2', kenney(particles, 'smoke_05', (128, 128), shaded=True), 'Kenney Particle Pack smoke_05.'),
        ('dust-3', kenney(particles, 'dirt_02', (128, 128)), 'Kenney Particle Pack dirt_02. Grit, for ground kicks. Small sizes only.'),
        ('flame-3', kenney(particles, 'muzzle_04', (96, 128), tight=True), 'Kenney Particle Pack muzzle_04. Base at the bottom.'),
        ('lightning', kenney(particles, 'spark_05', (128, 128), tight=True), 'Kenney Particle Pack spark_05. Runs top to bottom. Small and fast only.'),
        ('spark-streak', kenney(particles, 'trace_01', (128, 32), tight=True, turn=True), 'Kenney Particle Pack trace_01, turned. Runs left to right.'),
        ('glow', glow(), 'Drawn in this script. Soft round glow.'),
        ('slash-arc', thin_slash(3, 256, 64, 0.5), 'Drawn in this script. Thin curved cut, runs left to right.'),
        ('slash-line', thin_slash(8, 256, 24, 0.0), 'Drawn in this script. Straight razor line, hot in the middle.'),
        ('impact-1', impact_burst(21), 'Drawn in this script. Uneven burst for the moment of a hit.'),
        ('impact-2', impact_burst(44), 'Drawn in this script. Uneven burst for the moment of a hit.'),
        ('ember-1', ember(5), 'Drawn in this script. Tiny uneven coal, hot in the middle.'),
        ('ember-2', ember(12), 'Drawn in this script. Tiny uneven coal, hot in the middle.'),
        ('ember-3', ember(31, stretch_x=1.7), 'Drawn in this script. Coal fleck, longer than wide.'),
        ('ash-1', ash_flake(2), 'Drawn in this script. Torn flake of ash.'),
        ('ash-2', ash_flake(19), 'Drawn in this script. Torn flake of ash.'),
        ('ash-3', ash_flake(40), 'Drawn in this script. Torn flake of ash.'),
        ('blood-drop', blood_drop(), 'Drawn in this script. Stretched droplet, runs left to right, head at the right.'),
        ('blood-mist-1', blood_mist(7), 'Drawn in this script. Thin cloud of fine droplets with uneven density.'),
        ('blood-mist-2', blood_mist(23), 'Drawn in this script. Thin cloud of fine droplets with uneven density.'),
        ('blood-spray', blood_spray(13), 'Drawn in this script. A thrown fan of droplets from the left edge outward.'),
        ('blood-splat-1', blood_splat(11, 0.1), 'Drawn in this script. Ground stain with uneven opacity and thrown drops.'),
        ('blood-splat-2', blood_splat(29, 0.15), 'Drawn in this script. Ground stain with uneven opacity and thrown drops.'),
        ('wind-streak', wind_streak(), 'Drawn in this script. Runs left to right.'),
        ('wind-wisp', wind_wisp(17), 'Drawn in this script. A bundle of broken air lines, runs left to right.'),
        ('wind-wisp-2', wind_wisp(52), 'Drawn in this script. A bundle of broken air lines, runs left to right.'),
        ('ray', light_ray(), 'Drawn in this script. Soft shaft of light, base at the bottom.'),
        ('crack', ground_crack(6), 'Drawn in this script. Fractures from the center, for a ground decal.'),
        ('grass', grass_blade(), 'Drawn in this script. One bent blade of grass, base at the bottom.'),
        ('leaf', dead_leaf(9), 'Drawn in this script. A scrap of dead leaf.'),
    ]


def pack(sprites):
    """Simple shelf packing, tallest first. Returns name -> (x, y, width, height) in image pixels."""
    placed = {}
    x = y = GUTTER
    shelf = 0
    for name, image, _ in sorted(sprites, key=lambda sprite: -sprite[1].height):
        if x + image.width + GUTTER > ATLAS_SIZE:
            x = GUTTER
            y += shelf + GUTTER
            shelf = 0
        if y + image.height + GUTTER > ATLAS_SIZE:
            raise SystemExit(f'Atlas is full at {name}')
        placed[name] = (x, y, image.width, image.height)
        x += image.width + GUTTER
        shelf = max(shelf, image.height)
    return placed


def compose(sprites, placed):
    # White under the transparent pixels too, so filtering can never pull in a dark fringe.
    atlas = np.full((ATLAS_SIZE, ATLAS_SIZE, 4), 255, dtype=np.uint8)
    atlas[..., 3] = 0
    for name, image, _ in sprites:
        x, y, width, height = placed[name]
        data = np.array(image)
        # The sprite's own outer pixel row is forced clear, so no quad ever shows a hard cut edge.
        data[0, :, 3] = data[-1, :, 3] = 0
        data[:, 0, 3] = data[:, -1, 3] = 0
        atlas[y : y + height, x : x + width] = data
    step = 255 / (ALPHA_LEVELS - 1)
    atlas[..., 3] = (np.round(atlas[..., 3] / step) * step).astype(np.uint8)
    # Gray steps are coarse as well, for the same reason.
    atlas[..., :3] = (np.round(atlas[..., :3] / step) * step).astype(np.uint8)
    return Image.fromarray(atlas, 'RGBA')


def write_table(sprites, placed):
    lines = [
        '// Generated by tools/build-fx-atlas.py. Do not edit by hand.',
        '//',
        '// UVs for /fx/atlas.png in three.js convention: v goes up, (u0, v0) is the bottom-left corner',
        '// and (u1, v1) the top-right. They assume the default texture.flipY = true.',
        '// Sprites are white or gray on transparent, so multiply by a tint in the shader.',
        '// `frames` marks a horizontal flipbook strip: the UVs cover the whole strip.',
        '',
        'export type AtlasSprite = { u0: number; v0: number; u1: number; v1: number; frames?: number };',
        '',
        'export const ATLAS: Record<string, AtlasSprite> = {',
    ]
    for name, _, source in sorted(sprites, key=lambda sprite: natural_key(sprite[0])):
        x, y, width, height = placed[name]
        u0, u1 = x / ATLAS_SIZE, (x + width) / ATLAS_SIZE
        v0, v1 = 1 - (y + height) / ATLAS_SIZE, 1 - y / ATLAS_SIZE
        lines.append(f'  // {source}')
        lines.append(f"  '{name}': {{ u0: {u0:.6f}, v0: {v0:.6f}, u1: {u1:.6f}, v1: {v1:.6f} }},")
    lines += ['};', '']
    ATLAS_TS.parent.mkdir(parents=True, exist_ok=True)
    ATLAS_TS.write_text('\n'.join(lines))


def natural_key(name):
    return [int(part) if part.isdigit() else part for part in re.split(r'(\d+)', name)]


def read_table():
    pattern = r"'([\w-]+)': \{ u0: ([\d.]+), v0: ([\d.]+), u1: ([\d.]+), v1: ([\d.]+) \}"
    return {m[1]: tuple(float(m[i]) for i in range(2, 6)) for m in re.finditer(pattern, ATLAS_TS.read_text())}


def over(image, tint, background):
    """Draws a sprite the way the game will: its gray times the tint, blended by its alpha."""
    data = np.asarray(image, dtype=np.float32) / 255
    tinted = data[..., :3] * np.array(tint, dtype=np.float32) / 255
    blended = tinted * data[..., 3:] + np.array(background, dtype=np.float32) / 255 * (1 - data[..., 3:])
    return Image.fromarray((blended * 255).astype(np.uint8), 'RGB')


def write_preview(path):
    """Reads the sprites back through the generated UVs, so a wrong table shows up here."""
    background = (20, 19, 24)
    atlas = Image.open(ATLAS_PNG).convert('RGBA')
    table = read_table()
    tints = {'blood': (120, 12, 12), 'flame': (255, 150, 50), 'slash': (255, 214, 130), 'impact': (255, 214, 130), 'ember': (255, 170, 80), 'ash': (120, 114, 108), 'spark': (255, 190, 90), 'smoke': (120, 116, 112), 'dust': (150, 128, 100), 'wind': (200, 215, 215), 'glow': (255, 190, 90), 'lightning': (255, 214, 130), 'ray': (255, 214, 130), 'crack': (60, 50, 40), 'grass': (110, 110, 60), 'leaf': (110, 90, 50)}
    cell_w, cell_h, columns = 170, 170, 9
    rows = math.ceil(len(table) / columns)
    sheet = Image.new('RGB', (ATLAS_SIZE + cell_w * columns + 20, max(ATLAS_SIZE, rows * cell_h + 170)), background)
    sheet.paste(over(atlas, (255, 255, 255), background), (0, 0))
    draw = ImageDraw.Draw(sheet)
    for index, name in enumerate(sorted(table, key=natural_key)):
        u0, v0, u1, v1 = table[name]
        box = (round(u0 * ATLAS_SIZE), round((1 - v1) * ATLAS_SIZE), round(u1 * ATLAS_SIZE), round((1 - v0) * ATLAS_SIZE))
        draw.rectangle((box[0] - 1, box[1] - 1, box[2], box[3]), outline=(70, 66, 50))
        draw.text((box[0] + 2, box[1] + 1), name, fill=(120, 200, 255))
        family = name.split('-')[0]
        sprite = atlas.crop(box)
        sprite.thumbnail((cell_w - 4, cell_h - 18))
        tile = over(sprite, tints.get(family, (255, 255, 255)), background)
        x = ATLAS_SIZE + 20 + index % columns * cell_w
        y = index // columns * cell_h
        sheet.paste(tile, (x + (cell_w - tile.width) // 2, y + 14 + (cell_h - 14 - tile.height) // 2))
        draw.text((x + 2, y + 1), name, fill=(255, 220, 120))
    binary = Image.open(BINARY_PNG).convert('RGBA').resize((16 * 8, 8 * 8), Image.NEAREST)
    y = rows * cell_h + 20
    draw.text((ATLAS_SIZE + 22, y - 14), 'binary.png x8, #ff3b22 and white', fill=(255, 220, 120))
    sheet.paste(over(binary, (255, 59, 34), background), (ATLAS_SIZE + 22, y))
    sheet.paste(over(binary, (255, 255, 255), background), (ATLAS_SIZE + 22 + 144, y))
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path)


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    particles = Path(sys.argv[1]) / 'PNG (Transparent)'
    smoke = Path(sys.argv[2]) / 'PNG'
    sprites = build_sprites(particles, smoke)
    placed = pack(sprites)
    ATLAS_PNG.parent.mkdir(parents=True, exist_ok=True)
    compose(sprites, placed).save(ATLAS_PNG, optimize=True)
    binary_sprite().save(BINARY_PNG, optimize=True)
    write_table(sprites, placed)
    if len(sys.argv) > 3:
        write_preview(sys.argv[3])
    used = max(y + height for _, y, _, height in placed.values())
    print(f'{len(sprites)} sprites, shelves end at y={used}, atlas {ATLAS_PNG.stat().st_size / 1024:.0f} KB')


if __name__ == '__main__':
    main()
