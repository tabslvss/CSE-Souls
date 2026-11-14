#!/usr/bin/env python3
"""Build the boss-fight and critical-hit sound effects.

Every file is a layered mix of CC0 Kenney samples, ElevenLabs generations and
numpy synthesis (sub drops, risers, whooshes, rings, choir, heartbeat).
Output goes to client/public/audio/sfx/game/ as mono 96 kbps mp3 (the two
cinematic ones are stereo 128 kbps), peak normalized to about -1 dBFS.

Needs: numpy, soundfile (libsndfile >= 1.1 for mp3 decode), lameenc.

  python3 tools/build-crit-sfx.py \
    --impact  <Kenney "Impact Sounds" folder>/Audio \
    --rpg     <Kenney "RPG Audio" folder>/Audio \
    --scifi   <Kenney "Sci-fi Sounds" folder>/Audio \
    --el      <folder of ElevenLabs takes: roar-a.mp3 ... see EL_FILES> \
    [--out client/public/audio/sfx/game] [--only name,name] [--report out.json]

The script never overwrites a file that it does not build itself (see NAMES).
Deterministic: every random layer has a fixed seed.
"""
import argparse
import json
import os
import sys

import lameenc
import numpy as np
import soundfile as sf

SR = 44100
PEAK = 10 ** (-0.6 / 20)  # mp3 coding loses ~0.5 dB of peak here; lands near -1 dBFS
EL_FILES = ['roar-a', 'roar-b', 'roar-c', 'roar-d', 'growl', 'snort', 'hoof-a', 'hoof-b',
            'shatter', 'fbhit-a', 'fbhit-b', 'fblaunch', 'sheath', 'death', 'bow', 'boulder']

# ---------------------------------------------------------------- basics

def n_of(d):
    return int(round(d * SR))


def T(d):
    return np.arange(n_of(d)) / SR


def N(x):
    m = np.max(np.abs(x)) if len(x) else 0
    return x / m if m > 0 else x


def pow2(n):
    return 1 << int(np.ceil(np.log2(max(2, n))))


def varispeed(x, rate):
    """rate > 1 plays faster (higher, shorter)."""
    n = int(len(x) / rate)
    return np.interp(np.arange(n) * rate, np.arange(len(x)), x)


def tape(x, rates):
    """Variable-rate playback, one rate per output sample (tape stop / speed up)."""
    pos = np.concatenate([[0.0], np.cumsum(rates)[:-1]])
    pos = pos[pos < len(x) - 1]
    return np.interp(pos, np.arange(len(x)), x)


def spec(x, fn):
    n = len(x)
    M = pow2(n + SR // 2)
    X = np.fft.rfft(x, M)
    f = np.fft.rfftfreq(M, 1 / SR)
    return np.fft.irfft(X * fn(f), M)[:n]


def lp(x, fc, order=2):
    return spec(x, lambda f: 1 / np.sqrt(1 + (f / fc) ** (2 * order)))


def hp(x, fc, order=2):
    return spec(x, lambda f: 1 / np.sqrt(1 + (fc / np.maximum(f, 1e-3)) ** (2 * order)))


def bp(x, lo, hi, order=2):
    return hp(lp(x, hi, order), lo, order)


def conv(a, b):
    n = len(a) + len(b) - 1
    M = pow2(n)
    return np.fft.irfft(np.fft.rfft(a, M) * np.fft.rfft(b, M), M)[:n]


def reverb(x, wet=0.3, dur=1.4, tau=0.45, lpf=5000, seed=0, pre=0.012):
    r = np.random.default_rng(seed)
    t = T(dur)
    ir = lp(r.standard_normal(len(t)) * np.exp(-t / tau), lpf)
    ir[:n_of(pre)] = 0
    ir /= np.sqrt(np.sum(ir ** 2))
    w = conv(x, ir)[:len(x)]
    w = w * (np.max(np.abs(x)) / max(1e-9, np.max(np.abs(w))))
    return x + wet * w


def expenv(d, tau, att=0.002):
    t = T(d)
    a = np.minimum(1, t / att) if att > 0 else 1
    return np.exp(-t / tau) * a


def noise(d, seed):
    return np.random.default_rng(seed).standard_normal(n_of(d))


def sine_f(freq):
    """Sine from an instantaneous-frequency array."""
    return np.sin(2 * np.pi * np.cumsum(freq) / SR)


def sub_drop(d, f_start, f_end, sweep_tau, tau, att=0.003, drive=2.0):
    """A sine that falls fast from f_start to f_end and then holds, gently driven."""
    t = T(d)
    f = f_end + (f_start - f_end) * np.exp(-t / sweep_tau)
    s = sine_f(f)
    s = np.tanh(drive * s) / np.tanh(drive)
    return s * expenv(d, tau, att)


def ring(d, f0, ratios=(1.0, 2.76, 5.40, 8.93), tau=0.35, seed=0):
    """Inharmonic metal ring (struck plate / bell partials)."""
    r = np.random.default_rng(seed)
    t = T(d)
    out = np.zeros(len(t))
    for i, k in enumerate(ratios):
        out += np.sin(2 * np.pi * f0 * k * t + r.uniform(0, 6.28)) * np.exp(-t / (tau / (1 + 0.35 * i))) / (i + 1)
    return out * np.minimum(1, t / 0.001)


def sweep_noise(d, f0, f1, width=0.5, seed=0, curve=1.0, win=1024, hop=256):
    """Noise through a log-gaussian band whose centre moves from f0 to f1."""
    n = n_of(d)
    src = np.random.default_rng(seed).standard_normal(n + win)
    out = np.zeros(n + win)
    w = np.hanning(win)
    fr = np.maximum(np.fft.rfftfreq(win, 1 / SR), 1)
    for s in range(0, n, hop):
        u = (s / max(1, n - 1)) ** curve
        fc = f0 * (f1 / f0) ** u
        X = np.fft.rfft(src[s:s + win] * w) * np.exp(-0.5 * (np.log2(fr / fc) / width) ** 2)
        out[s:s + win] += np.fft.irfft(X, win) * w
    return out[:n]


def trim(x, th=0.03, pre=0.001):
    a = np.abs(x)
    i = int(np.argmax(a > th * a.max()))
    return x[max(0, i - n_of(pre)):]


def cut(x, d, fade=0.03):
    y = x[:n_of(d)].copy()
    k = min(len(y), n_of(fade))
    if k:
        y[-k:] *= np.cos(np.linspace(0, np.pi / 2, k))
    return y


def flatten(x, amount=0.6, win=0.03):
    """Even out a sample's dynamics (envelope follower division)."""
    k = max(1, n_of(win))
    e = np.sqrt(np.convolve(x ** 2, np.ones(k) / k, 'same')) + 1e-3 * np.max(np.abs(x))
    return x / e ** amount


def sat(x, drive=1.5):
    return np.tanh(drive * x) / np.tanh(drive)


class Mix:
    def __init__(self, d):
        self.buf = np.zeros(n_of(d))

    def add(self, x, t=0.0, g=1.0):
        i = n_of(t)
        if i >= len(self.buf):
            return self
        seg = x[:len(self.buf) - i]
        self.buf[i:i + len(seg)] += g * seg
        return self


def make_loop(x, L, X):
    """x has L+X samples of continuous material: blend the overhang into the head."""
    out = x[:L].copy()
    th = np.linspace(0, np.pi / 2, X)
    out[:X] = x[L:L + X] * np.cos(th) + x[:X] * np.sin(th)
    return out


# ---------------------------------------------------------------- sources

class Src:
    def __init__(self, a):
        self.a = a
        self.cache = {}

    def _load(self, path):
        if path not in self.cache:
            d, r = sf.read(path, dtype='float64', always_2d=True)
            m = d.mean(1)
            if r != SR:
                m = varispeed(m, r / SR)
            self.cache[path] = m
        return self.cache[path].copy()

    def imp(self, n):
        return self._load(os.path.join(self.a.impact, n + '.ogg'))

    def rpg(self, n):
        return self._load(os.path.join(self.a.rpg, n + '.ogg'))

    def sci(self, n):
        return self._load(os.path.join(self.a.scifi, n + '.ogg'))

    def el(self, n):
        return self._load(os.path.join(self.a.el, n + '.mp3'))


S = None


def debris(d, seed, density=45.0, decay=0.45, pitch=(1.0, 2.3), hiss=0.12):
    """Granular rocks and dirt: Kenney rock/concrete/wood grains, falling density."""
    r = np.random.default_rng(seed)
    grains = [trim(S.imp(f'footstep_concrete_00{i}')) for i in range(5)]
    grains += [cut(trim(S.imp(f'impactMining_00{i}')), 0.18) for i in range(5)]
    grains += [trim(S.imp(f'impactGeneric_light_00{i}')) for i in range(5)]
    grains += [trim(S.imp(f'impactWood_light_00{i}')) for i in range(3)]
    grains = [N(hp(g, 150)) for g in grains]
    m = Mix(d + 0.3)
    t = 0.0
    first = True
    while t < d:
        g = grains[r.integers(len(grains))]
        p = r.uniform(*pitch)
        x = cut(varispeed(g, p), 0.2, 0.02)
        amp = 1.0 if first else r.uniform(0.15, 0.85) * np.exp(-t / (decay * 1.6))
        m.add(x, t, amp)
        first = False
        t += r.exponential(1 / (density * np.exp(-t / decay) + 4))
    h = bp(noise(d, seed + 7), 700, 6000) * expenv(d, decay * 1.2, 0.03)
    m.add(N(h), 0, hiss)
    return m.buf[:n_of(d)]


def snap(seed, dur=0.07, tau=0.010):
    """Very short bright crack: hp noise burst."""
    x = hp(noise(dur, seed), 1800, 3) * expenv(dur, tau, 0.0004)
    return N(x)


def shimmer(d, count, seed, lo=23, hi=60, base=110.0, dens=1.5, glen=(0.05, 0.2)):
    r = np.random.default_rng(seed)
    m = Mix(d)
    for _ in range(count):
        u = r.random() ** (1 / dens)  # more grains late
        t0 = u * d
        gl = r.uniform(*glen)
        f = base * r.integers(lo, hi)
        tt = T(gl)
        g = np.sin(2 * np.pi * f * tt) * np.hanning(len(tt))
        m.add(g, t0, r.uniform(0.4, 1.0))
    return m.buf


# ---------------------------------------------------------------- the sounds

def impact_frame(k):
    def lay(*pairs):
        m = Mix(0.07)
        for x, g in pairs:
            m.add(x, 0, g)
        return N(m.buf)
    crack_src = [
        lambda: lay((snap(11), 1.0), (N(hp(cut(trim(S.imp('impactPlate_light_000')), 0.06, 0.02), 900)), 0.8)),
        lambda: lay((N(hp(cut(trim(S.imp('impactMining_002')), 0.07, 0.03), 400)), 1.0), (snap(12), 0.6)),
        lambda: lay((N(hp(cut(trim(S.imp('impactMetal_light_003')), 0.06, 0.02), 1200)), 1.0), (snap(13, tau=0.007), 0.9)),
    ][k]()
    hole = [0.10, 0.12, 0.085][k]
    body = [0.72, 0.78, 0.58][k]
    fend = [48.0, 43.0, 56.0][k]
    fring = [390.0, 330.0, 460.0][k]
    crack = crack_src[:n_of(0.07)] * expenv(0.07, 0.013, 0.0003)[:len(crack_src[:n_of(0.07)])]
    post = Mix(body)
    post.add(sub_drop(body, fend * 2.6, fend, 0.035, [0.30, 0.34, 0.24][k], 0.004, 2.2), 0, 1.0)
    bell = hp(varispeed(trim(S.imp(f'impactBell_heavy_00{[0, 1, 2][k]}')), 0.5), 250)
    post.add(N(bell) * expenv(len(bell) / SR, 0.3, 0), 0, 0.22)
    post.add(N(ring(body, fring, tau=0.32, seed=k)), 0, 0.16)
    post.add(N(lp(noise(0.05, 40 + k), 300)) * expenv(0.05, 0.012), 0, 0.35)  # thump front edge
    tail = reverb(post.buf, 0.18, 1.0, 0.3, 3000, seed=20 + k)
    m = Mix(hole + body)
    m.add(crack, 0, 1.0)
    m.add(tail, hole, 0.95)
    return m.buf, dict(hole=(0.075, hole - 0.002), sub=fend)


def crit_charge():
    d = 1.0
    t = T(d)
    u = t / d
    f = 70 * 4 ** (u ** 1.5)
    tone = np.zeros(len(t))
    for mult, g, det in [(1, 1, 0), (1.5, 0.5, 0.3), (2.01, 0.45, 0.6), (3, 0.25, 0.9), (4.02, 0.18, 1.3)]:
        tone += g * sat(sine_f(f * mult + det), 1.3)
    rate = 6 + 22 * u ** 2
    trem = 1 - 0.4 * (0.5 + 0.5 * np.sin(2 * np.pi * np.cumsum(rate) / SR))
    tone = N(tone) * trem * (0.12 + 0.88 * u ** 1.6)
    air = N(sweep_noise(d, 400, 7500, 0.5, seed=3, curve=1.4)) * (0.05 + u ** 2.2)
    bell = varispeed(trim(S.imp('impactBell_heavy_001')), 0.8)[::-1]
    bell = N(hp(bell, 200))[-n_of(d):]
    ff = trim(S.sci('forceField_001'))
    ff = N(tape(np.tile(ff, 3), 1.0 + 1.2 * u))[:len(t)]
    m = Mix(d)
    m.add(tone, 0, 0.9)
    m.add(air, 0, 0.45)
    m.add(bell, d - len(bell) / SR, 0.5)
    m.add(ff * u, 0, 0.3)
    x = m.buf
    x[-n_of(0.004):] *= np.linspace(1, 0, n_of(0.004))
    return x, dict(riser=True)


def crit_heavy_slam():
    d = 2.5
    ch = []
    for side in range(2):
        m = Mix(d)
        m.add(N(hp(trim(S.imp('impactMining_000')), 200)), 0, 0.75)
        m.add(N(trim(S.el('boulder'))), 0, 0.9)
        m.add(N(varispeed(trim(S.imp('impactPunch_heavy_000')), 0.55)), 0, 0.65)
        m.add(N(varispeed(trim(S.sci('lowFrequency_explosion_000')), 0.8)), 0, 0.85)
        m.add(N(varispeed(trim(S.sci('explosionCrunch_000')), 0.6)), 0.01, 0.4)
        m.add(sub_drop(2.0, 75, 36, 0.06, 0.55, 0.003, 2.4), 0, 1.0)
        m.add(snap(5 + side), 0, 0.5)
        m.add(N(debris(2.2, 100 + side, density=38, decay=0.55)), 0.22, 0.42)
        dust = bp(noise(d, 60 + side), 300, 3000) * expenv(d, 0.8, 0.06)
        m.add(N(dust), 0.05, 0.08)
        ch.append(reverb(m.buf, 0.35, 2.0, 0.65, 4000, seed=70 + side))
    return np.stack(ch, 1), dict(sub=36)


def crit_debris(k):
    d = [1.3, 1.1][k]
    x = debris(d, 200 + k, density=[50, 38][k], decay=[0.45, 0.35][k])
    return reverb(x, 0.2, 0.8, 0.25, 6000, seed=210 + k), {}


def crit_blade_dash():
    d = 0.3
    t = T(d)
    env = np.where(t < 0.2, 0.3 + 0.7 * (t / 0.2) ** 1.5, np.cos(np.minimum(1, (t - 0.2) / 0.1) * np.pi / 2))
    w = N(sweep_noise(d, 700, 6500, 0.45, seed=31, curve=1.3))
    whistle = sine_f(500 * (2600 / 500) ** ((t / d) ** 1.3))
    push = N(lp(noise(d, 32), 400))
    m = Mix(d)
    m.add(w * env, 0, 1.0)
    m.add(whistle * env, 0, 0.12)
    m.add(push * env, 0, 0.3)
    m.add(N(ring(0.12, 3200, (1.0, 1.47, 2.21), tau=0.06, seed=3)), 0.17, 0.25)
    return m.buf, {}


def crit_blade_sheath():
    slide = trim(S.rpg('drawKnife1'))[::-1]
    slide = trim(slide, 0.01)
    slide = varispeed(slide, len(slide) / n_of(0.42))
    slide = N(hp(flatten(slide, 0.8), 500)) * np.linspace(0.75, 1.0, len(slide))
    click = N(trim(S.rpg('metalLatch')))
    tsuba = N(varispeed(trim(S.rpg('metalClick')), 1.3))
    m = Mix(0.6)
    m.add(N(ring(0.05, 3400, (1.0, 1.5), tau=0.02, seed=8)), 0, 0.3)  # blade tip meets the mouth
    m.add(slide, 0, 0.55)
    m.add(click, 0.42, 1.0)
    m.add(cut(tsuba, 0.15), 0.455, 0.45)
    m.add(N(ring(0.15, 2900, (1.0, 1.52, 2.4), tau=0.05, seed=9)), 0.42, 0.12)
    return reverb(m.buf, 0.12, 0.5, 0.15, 6000, seed=5), {}


def crit_blade_cuts():
    d = 0.7
    r = np.random.default_rng(41)
    cuts = [N(hp(cut(trim(S.rpg(n)), 0.14, 0.04), 400)) for n in ('knifeSlice', 'knifeSlice2', 'chop')]
    flesh = [N(trim(S.imp(f'impactPunch_medium_00{i}'))) for i in range(5)]
    m = Mix(d)
    times = [0.0, 0.048, 0.105, 0.155, 0.225, 0.29]
    for i, t0 in enumerate(times):
        up = i % 2 == 0
        w = N(sweep_noise(0.09, 1500 if up else 7000, 7000 if up else 1500, 0.45, seed=50 + i))
        w *= np.sin(np.linspace(0, np.pi, len(w))) ** 0.7
        m.add(w, max(0, t0 - 0.0), 0.5 if i else 0.75)
        m.add(cut(varispeed(cuts[i % 3], r.uniform(0.9, 1.3)), 0.12), t0 + (0.0 if i == 0 else 0.03), 0.8)
        m.add(cut(varispeed(flesh[i % 5], r.uniform(1.0, 1.4)), 0.1), t0 + 0.035, 0.35)
    t1 = 0.38
    m.add(N(sweep_noise(0.08, 1200, 8000, 0.4, seed=70)), t1 - 0.06, 0.6)
    m.add(N(varispeed(cuts[2], 0.8)), t1, 1.0)
    m.add(N(varispeed(trim(S.imp('impactPunch_heavy_001')), 0.85)), t1, 0.7)
    m.add(N(ring(0.3, 2600, (1.0, 1.41, 2.13, 3.07), tau=0.15, seed=4)), t1, 0.22)
    m.add(sub_drop(0.25, 140, 70, 0.02, 0.07), t1, 0.5)
    return reverb(m.buf, 0.15, 0.6, 0.18, 6000, seed=8), {}


def crit_bow_slowmo():
    d = 1.2
    src_d = 2.2
    t = T(src_d)
    tex = np.zeros(len(t))
    for f, g in [(110, 1), (164.8, 0.6), (220, 0.5), (329.6, 0.25)]:
        tex += g * np.sin(2 * np.pi * f * t + 0.6 * np.sin(2 * np.pi * 0.3 * t))
    tex = N(tex) + 0.5 * N(bp(noise(src_d, 81), 400, 4000))
    ff = trim(S.sci('forceField_002'))
    tex += 0.5 * N(np.tile(ff, 3)[:len(t)])
    tex += 0.05 * np.sin(2 * np.pi * 3100 * t)
    to = T(d)
    rates = 1 - 0.72 * (to / d) ** 0.7
    y = N(tape(tex, rates))
    y = np.pad(y, (0, max(0, n_of(d) - len(y))))[:n_of(d)]
    u = to / d
    y = y * (1 - u) + lp(y, 900) * u
    y *= 1 - 0.55 * u
    m = Mix(d)
    m.add(y, 0, 0.55)
    m.add(sub_drop(0.6, 120, 40, 0.15, 0.3, 0.004, 1.6), 0, 0.6)

    def beat(f0):
        return sub_drop(0.16, f0, f0 * 0.68, 0.03, 0.05, 0.005, 1.8) + 0.3 * N(lp(noise(0.16, int(f0)), 180)) * expenv(0.16, 0.04, 0.004)
    m.add(beat(62), 0.40, 0.95)
    m.add(beat(54), 0.56, 0.6)
    m.add(beat(56), 0.92, 0.85)
    m.add(beat(48), 1.09, 0.5)
    return reverb(m.buf, 0.25, 1.2, 0.4, 3000, seed=12), dict(sub=55)


def karplus(d, f, decay=0.996, seed=0):
    r = np.random.default_rng(seed)
    p = int(SR / f)
    buf = r.uniform(-1, 1, p)
    out = np.zeros(n_of(d))
    for i in range(len(out)):
        j = i % p
        nxt = buf[(i + 1) % p]
        out[i] = buf[j]
        buf[j] = decay * 0.5 * (buf[j] + nxt)
    return out


def crit_bow_release():
    d = 0.9
    m = Mix(d)
    m.add(N(trim(S.el('bow'))), 0, 0.6)
    m.add(N(lp(karplus(d, 82, 0.997, 1), 2500)) * expenv(d, 0.35, 0.001), 0, 0.7)
    m.add(N(lp(karplus(d, 41, 0.998, 2), 600)) * expenv(d, 0.3, 0.002), 0, 0.45)
    m.add(sub_drop(0.3, 70, 45, 0.03, 0.08), 0, 0.6)
    m.add(snap(17, 0.03, 0.004), 0, 0.35)
    m.add(N(sweep_noise(0.35, 2500, 900, 0.6, seed=19)) * expenv(0.35, 0.12, 0.003), 0, 0.25)
    return reverb(m.buf, 0.18, 0.8, 0.25, 5000, seed=13), {}


def crit_arrow_fly():
    d = 0.8
    t = T(d)
    u = t / d
    env = (0.4 + 0.6 * u ** 1.5) * np.cos(np.clip((t - 0.74) / 0.06, 0, 1) * np.pi / 2)
    air = N(sweep_noise(d, 600, 3500, 0.35, seed=91, curve=2.0))
    flut = 1 - 0.25 * (0.5 + 0.5 * np.sin(2 * np.pi * np.cumsum(25 + 35 * u ** 2) / SR))
    f = 700 * 4 ** (u ** 2.2) * (1 + 0.006 * np.sin(2 * np.pi * 9 * t))
    m = Mix(d)
    m.add(air * flut * env, 0, 1.0)
    m.add(sine_f(f) * env, 0, 0.22)
    return m.buf, {}


def crit_arrow_impact():
    d = 0.9
    t = T(d)
    m = Mix(d)
    m.add(snap(23, 0.03, 0.003), 0, 0.9)
    m.add(N(trim(S.imp('impactWood_heavy_002'))), 0, 0.85)
    m.add(N(trim(S.imp('impactPunch_heavy_001'))), 0.002, 0.7)
    m.add(N(varispeed(trim(S.imp('impactPlate_light_001')), 0.8)), 0, 0.35)
    m.add(sub_drop(0.5, 90, 50, 0.03, 0.12), 0, 0.6)
    tw = np.sin(2 * np.pi * 160 * t) * (0.6 + 0.4 * np.sin(2 * np.pi * 30 * t)) * expenv(d, 0.25, 0.01)
    m.add(tw, 0.02, 0.15)
    return reverb(m.buf, 0.2, 0.8, 0.22, 5000, seed=14), {}


def crit_magic_gather():
    d = 1.2
    t = T(d)
    u = t / d
    hum = np.zeros(len(t))
    for f, g in [(110, 1), (164.8, 0.7), (220, 0.6), (277.2, 0.45), (329.6, 0.35)]:
        hum += g * (np.sin(2 * np.pi * (f - 0.4) * t) + np.sin(2 * np.pi * (f + 0.4) * t + 1.0))
    hum = N(hum) * (0.25 + 0.75 * u ** 1.3)
    hum[-n_of(0.06):] *= np.linspace(1, 0.4, n_of(0.06))
    m = Mix(d)
    m.add(hum, 0, 0.8)
    m.add(np.sin(2 * np.pi * 55 * t) * (0.3 + 0.7 * u), 0, 0.3)
    m.add(N(shimmer(d, 80, 33, dens=2.0)), 0, 0.3)
    m.add(N(varispeed(trim(S.sci('forceField_000')), 1.2)), 0.1, 0.3)
    m.add(N(bp(noise(d, 34), 2000, 8000)) * u ** 1.5, 0, 0.1)
    return reverb(m.buf, 0.3, 1.2, 0.4, 7000, seed=15), {}


def choir(d, seed, pan):
    """Additive 'ah' choir: detuned voices with vibrato, formant shaped. Returns L, R."""
    r = np.random.default_rng(seed)
    t = T(d)
    L = np.zeros(len(t))
    R = np.zeros(len(t))
    for f in (220.0, 277.2, 329.6, 440.0, 659.3):
        for v in range(3):
            cents = r.uniform(-9, 9)
            ff = f * 2 ** (cents / 1200) * (1 + 0.004 * np.sin(2 * np.pi * r.uniform(4.8, 6.0) * t + r.uniform(0, 6)))
            ph = 2 * np.pi * np.cumsum(ff) / SR
            voice = sum(np.sin(k * ph) / k for k in range(1, int(6000 / f) + 1))
            p = r.uniform(-pan, pan)
            L += voice * (0.5 - 0.5 * p)
            R += voice * (0.5 + 0.5 * p)

    def formant(f):
        lf = np.log2(np.maximum(f, 20))
        g = sum(a * np.exp(-0.5 * ((lf - np.log2(fc)) / 0.22) ** 2) for fc, a in ((800, 1), (1150, 0.6), (2900, 0.3), (3400, 0.2)))
        return g + 0.03
    return spec(L, formant), spec(R, formant)


def crit_magic_blast():
    d = 2.5
    cL, cR = choir(2.4, 77, 0.8)
    cen = expenv(2.4, 0.9, 0.03)
    ch = []
    for side, cv in enumerate((cL, cR)):
        m = Mix(d)
        m.add(snap(30 + side), 0, 0.6)
        m.add(N(trim(S.sci('lowFrequency_explosion_001'))), 0, 0.9)
        m.add(N(varispeed(trim(S.sci('explosionCrunch_002')), 0.75)), 0, 0.6)
        m.add(N(varispeed(trim(S.sci('laserLarge_000')), 0.5)), 0, 0.3)
        m.add(sub_drop(2.4, 85, 38, 0.08, 0.7, 0.003, 2.2), 0, 1.0)
        m.add(N(cv) * cen, 0.01, 0.5)
        m.add(N(shimmer(1.6, 70, 90 + side, lo=20, hi=64, dens=0.5)) * expenv(1.6, 0.6, 0.01), 0.02, 0.18)
        ch.append(reverb(m.buf, 0.4, 2.2, 0.75, 6000, seed=80 + side))
    return np.stack(ch, 1), dict(sub=38)


def boss_stance_break():
    d = 1.2
    r = np.random.default_rng(5)
    m = Mix(d)
    m.add(N(trim(S.el('shatter'))), 0, 0.9)
    m.add(N(trim(S.imp('impactGlass_heavy_000'))), 0, 0.7)
    m.add(N(varispeed(trim(S.imp('impactGlass_heavy_003')), 0.85)), 0.06, 0.4)
    m.add(N(varispeed(trim(S.imp('impactMining_003')), 0.7)), 0, 0.7)
    m.add(sub_drop(0.6, 70, 40, 0.05, 0.25), 0, 0.7)
    m.add(N(lp(varispeed(trim(S.el('growl')), 0.55), 1500)), 0.18, 0.6)
    for i in range(14):
        g = N(trim(S.imp(f'impactGlass_light_00{i % 5}')))
        m.add(varispeed(g, r.uniform(1.0, 1.7)), r.uniform(0.15, 0.8), r.uniform(0.08, 0.25))
    x = reverb(m.buf, 0.25, 1.0, 0.3, 6000, seed=16)
    return cut(x, d, 0.2), {}


def boss_stunned_loop():
    L, X = n_of(2.0), n_of(0.3)
    d = (L + X) / SR
    t = T(d)
    drone = (0.5 * np.sin(2 * np.pi * 55 * t) + 0.25 * np.sin(2 * np.pi * 82.5 * t) + 0.2 * np.sin(2 * np.pi * 110.5 * t)
             + 0.15 * np.sin(2 * np.pi * 110 * t))
    drone *= (1 - 0.3 * (0.5 + 0.5 * np.sin(2 * np.pi * 0.5 * t))) * (1 - 0.1 * np.sin(2 * np.pi * 1.5 * t))
    breath = N(lp(noise(d, 101), 600)) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.5 * t - 1.2)) ** 2
    ting = 0.5 * (np.sin(2 * np.pi * 1760 * t) + np.sin(2 * np.pi * 1763 * t))
    m = Mix(d)
    m.add(N(drone), 0, 0.8)
    m.add(breath, 0, 0.25)
    m.add(ting, 0, 0.035)
    g = N(lp(varispeed(trim(S.el('growl')), 0.4), 500))
    g = cut(g, 1.2, 0.4) * np.minimum(1, T(min(1.2, len(g) / SR)) / 0.2)
    m.add(g, 0.45, 0.3)
    return make_loop(m.buf, L, X), dict(loop=True, sub=55)


def boss_roar(k):
    if k == 0:
        main = varispeed(trim(S.el('roar-b')), 0.68)
        under = lp(varispeed(trim(S.el('roar-b')), 0.34), 220)
        growl = varispeed(trim(S.el('growl')), 0.6)
    else:
        main = varispeed(trim(S.el('roar-d')), 0.7)
        under = lp(varispeed(trim(S.el('roar-a')), 0.55), 1200)
        growl = varispeed(trim(S.el('growl')), 0.5)
    d = 1.9
    m = Mix(d)
    m.add(sat(N(main), 1.4), 0, 1.0)
    m.add(N(under), 0, 0.45)
    m.add(N(growl), 0.03, 0.4)
    x = reverb(m.buf, 0.25, 1.2, 0.35, 4000, seed=17 + k)
    return cut(x, d, 0.3), {}


def boss_snort():
    s = trim(S.el('snort'))
    m = Mix(0.9)
    m.add(N(varispeed(s, 0.8)), 0, 1.0)
    m.add(N(lp(varispeed(s, 0.5), 300)), 0, 0.4)
    return cut(reverb(m.buf, 0.15, 0.6, 0.2, 4000, seed=18), 0.9, 0.2), {}


def boss_hoof(k):
    d = 0.6
    h = cut(trim(S.el(['hoof-b', 'hoof-a'][k])), 0.42, 0.12)
    m = Mix(d)
    m.add(N(h), 0, 0.9)
    m.add(N(varispeed(trim(S.imp(f'impactPunch_heavy_00{[2, 3][k]}')), [0.6, 0.55][k])), 0, 0.6)
    m.add(N(varispeed(trim(S.imp(f'footstep_concrete_00{[1, 3][k]}')), 0.7)), 0, 0.4)
    m.add(sub_drop(0.4, [80, 75][k], [45, 42][k], 0.02, 0.09), 0, 0.7)
    m.add(N(debris(0.35, 300 + k, density=25, decay=0.12, hiss=0.05)), 0.03, 0.12)
    return cut(reverb(m.buf, 0.15, 0.6, 0.2, 4000, seed=19 + k), d, 0.12), dict(sub=45)


def thud(seed, g_sub=1.0):
    m = Mix(0.3)
    m.add(sub_drop(0.3, 70, 40, 0.02, 0.06), 0, g_sub)
    m.add(N(lp(varispeed(trim(S.imp(f'footstep_concrete_00{seed % 5}')), 0.6), 900)), 0, 0.5)
    return m.buf


def boss_charge_rumble():
    L, X = n_of(1.5), n_of(0.3)
    d = (L + X) / SR
    t = T(d)
    eng = varispeed(trim(S.sci('spaceEngineLow_000')), 0.6)
    eng = N(lp(eng, 400))[:len(t)]
    rum = N(lp(noise(d, 121), 120)) * (1 - 0.2 * np.sin(2 * np.pi * 2 * t))
    rat = N(bp(noise(d, 122), 1000, 4000)) * (0.5 + 0.5 * np.sin(2 * np.pi * (8 / 1.5) * t)) ** 4
    m = Mix(d)
    m.add(eng, 0, 0.5)
    m.add(rum, 0, 0.6)
    m.add(rat, 0, 0.08)
    for i, t0 in enumerate([0.0, 0.375, 0.75, 1.125, 1.5]):
        m.add(thud(i), t0, 0.9)
        m.add(thud(i + 2), t0 + 0.085, 0.55)
    return make_loop(m.buf, L, X), dict(loop=True, sub=45)


def boss_leap_land():
    d = 1.6
    m = Mix(d)
    m.add(N(trim(S.el('boulder'))), 0, 0.8)
    m.add(N(varispeed(trim(S.imp('impactPunch_heavy_004')), 0.5)), 0, 0.8)
    m.add(N(varispeed(trim(S.sci('lowFrequency_explosion_001')), 0.9)), 0, 0.7)
    m.add(sub_drop(1.4, 70, 36, 0.05, 0.4, 0.003, 2.2), 0, 1.0)
    m.add(N(debris(1.2, 400, density=35, decay=0.4)), 0.15, 0.3)
    return cut(reverb(m.buf, 0.3, 1.5, 0.5, 4000, seed=21), d, 0.25), dict(sub=36)


def boss_fireball_launch():
    d = 1.4
    m = Mix(d)
    ign = N(bp(noise(0.3, 131), 300, 3000)) * expenv(0.3, 0.08, 0.003)
    m.add(ign, 0, 0.7)
    m.add(N(cut(trim(S.sci('thrusterFire_002')), 0.5, 0.2)) * expenv(0.5, 0.25, 0.005), 0, 0.5)
    m.add(sub_drop(0.5, 90, 55, 0.04, 0.15), 0, 0.6)
    m.add(N(trim(S.el('fblaunch'), 0.01)), 0.0, 0.95)
    return cut(m.buf, d, 0.3), {}


def boss_fireball_fly():
    L, X = n_of(1.0), n_of(0.25)
    d = (L + X) / SR
    t = T(d)
    a = N(varispeed(trim(S.sci('thrusterFire_000')), 0.85))[:len(t)]
    b = N(varispeed(trim(S.sci('thrusterFire_003')), 1.1))[:len(t)]
    hiss = N(bp(noise(d, 141), 200, 2000)) * (0.75 + 0.25 * np.sin(2 * np.pi * 7 * t))
    r = np.random.default_rng(142)
    cr = Mix(d)
    for _ in range(40):
        cr.add(N(hp(noise(0.01, int(r.integers(1e6))), 3000)) * expenv(0.01, 0.002, 0), r.uniform(0, d - 0.01), r.uniform(0.2, 1))
    m = Mix(d)
    m.add(a, 0, 0.6)
    m.add(b, 0, 0.35)
    m.add(hiss, 0, 0.5)
    m.add(cr.buf, 0, 0.15)
    return make_loop(m.buf, L, X), dict(loop=True)


def boss_fireball_hit(k):
    d = 1.2
    r = np.random.default_rng(150 + k)
    m = Mix(d)
    m.add(N(trim(S.el(['fbhit-b', 'fbhit-a'][k]))), 0, 0.9)
    m.add(N(trim(S.sci(f'explosionCrunch_00{[1, 3][k]}'))), 0, 0.6)
    m.add(sub_drop(0.6, 80, 40, 0.04, 0.25), 0, 0.8)
    cr = Mix(1.0)
    for _ in range(50):
        tt = r.uniform(0, 1) ** 2
        cr.add(N(hp(noise(0.008, int(r.integers(1e6))), 2500)) * expenv(0.008, 0.002, 0), tt, r.uniform(0.2, 1) * (1 - tt))
    m.add(cr.buf, 0.05, 0.25)
    tail = N(lp(cut(trim(S.sci(f'thrusterFire_00{[1, 4][k]}')), 1.0, 0.5), 2500)) * expenv(1.0, 0.35, 0.02)
    m.add(tail, 0.03, 0.3)
    return cut(reverb(m.buf, 0.25, 1.0, 0.3, 5000, seed=22 + k), d, 0.2), dict(sub=40)


def boss_stomp():
    d = 1.0
    m = Mix(d)
    m.add(N(varispeed(trim(S.imp('impactPunch_heavy_000')), 0.45)), 0, 0.8)
    m.add(N(varispeed(trim(S.el('boulder')), 0.85)), 0, 0.6)
    m.add(N(varispeed(trim(S.imp('footstep_concrete_004')), 0.6)), 0, 0.5)
    m.add(sub_drop(0.9, 65, 38, 0.04, 0.25, 0.003, 2.2), 0, 1.0)
    m.add(N(debris(0.6, 500, density=30, decay=0.2, hiss=0.06)), 0.04, 0.2)
    return cut(reverb(m.buf, 0.25, 1.0, 0.35, 4000, seed=24), d, 0.2), dict(sub=38)


def boss_death():
    d = 3.0
    m = Mix(d)
    m.add(N(varispeed(trim(S.el('death')), 0.6)), 0, 0.8)
    g = N(lp(varispeed(trim(S.el('growl')), 0.42), 900))
    m.add(cut(g, 2.0, 0.6), 0.1, 0.6)
    m.add(N(lp(varispeed(trim(S.el('roar-c')), 0.5), 700)), 0, 0.35)
    m.add(N(varispeed(trim(S.imp('impactPunch_heavy_002')), 0.5)), 1.72, 0.55)
    m.add(sub_drop(0.4, 70, 45, 0.03, 0.1), 1.72, 0.5)
    t1 = 2.0
    m.add(N(varispeed(trim(S.sci('lowFrequency_explosion_000')), 0.75)), t1, 0.8)
    m.add(N(varispeed(trim(S.imp('impactSoft_heavy_000')), 0.5)), t1, 0.8)
    m.add(sub_drop(1.0, 60, 34, 0.06, 0.45, 0.003, 2.2), t1, 1.0)
    m.add(N(debris(0.9, 600, density=30, decay=0.3)), t1 + 0.05, 0.25)
    m.add(N(lp(varispeed(trim(S.el('snort')), 0.6), 800)), 2.5, 0.25)
    return cut(reverb(m.buf, 0.3, 1.5, 0.5, 4000, seed=25), d, 0.35), dict(sub=34)


BUILD = {
    'impact-frame-1': lambda: impact_frame(0),
    'impact-frame-2': lambda: impact_frame(1),
    'impact-frame-3': lambda: impact_frame(2),
    'crit-charge': crit_charge,
    'crit-heavy-slam': crit_heavy_slam,
    'crit-debris-1': lambda: crit_debris(0),
    'crit-debris-2': lambda: crit_debris(1),
    'crit-blade-dash': crit_blade_dash,
    'crit-blade-sheath': crit_blade_sheath,
    'crit-blade-cuts': crit_blade_cuts,
    'crit-bow-slowmo': crit_bow_slowmo,
    'crit-bow-release': crit_bow_release,
    'crit-arrow-fly': crit_arrow_fly,
    'crit-arrow-impact': crit_arrow_impact,
    'crit-magic-gather': crit_magic_gather,
    'crit-magic-blast': crit_magic_blast,
    'boss-stance-break': boss_stance_break,
    'boss-stunned-loop': boss_stunned_loop,
    'boss-roar-1': lambda: boss_roar(0),
    'boss-roar-2': lambda: boss_roar(1),
    'boss-snort': boss_snort,
    'boss-hoof-1': lambda: boss_hoof(0),
    'boss-hoof-2': lambda: boss_hoof(1),
    'boss-charge-rumble': boss_charge_rumble,
    'boss-leap-land': boss_leap_land,
    'boss-fireball-launch': boss_fireball_launch,
    'boss-fireball-fly': boss_fireball_fly,
    'boss-fireball-hit-1': lambda: boss_fireball_hit(0),
    'boss-fireball-hit-2': lambda: boss_fireball_hit(1),
    'boss-stomp': boss_stomp,
    'boss-death': boss_death,
}
NAMES = list(BUILD)

# ---------------------------------------------------------------- output + checks


def finish(x, meta):
    x = np.asarray(x, dtype='float64')
    mono = x.ndim == 1
    xs = x[:, None] if mono else x
    if meta.get('loop'):
        # circular high-pass so the end still runs straight into the start
        f = np.fft.rfftfreq(len(xs), 1 / SR)
        g = 1 / np.sqrt(1 + (22 / np.maximum(f, 1e-3)) ** 4)
        xs = np.stack([np.fft.irfft(np.fft.rfft(xs[:, c]) * g, len(xs)) for c in range(xs.shape[1])], 1)
    else:
        xs = np.stack([hp(xs[:, c], 22, 2) for c in range(xs.shape[1])], 1)
    if not meta.get('loop'):
        k = n_of(0.01)
        xs[-k:] *= np.linspace(1, 0, k)[:, None]
    xs = xs * (PEAK / np.max(np.abs(xs)))
    return xs[:, 0] if mono else xs


def write_mp3(path, x):
    stereo = x.ndim == 2
    enc = lameenc.Encoder()
    enc.set_bit_rate(128 if stereo else 96)
    enc.set_in_sample_rate(SR)
    enc.set_channels(2 if stereo else 1)
    enc.set_quality(2)
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2')
    data = bytes(enc.encode(pcm.tobytes()) + enc.flush())
    with open(path, 'wb') as f:
        f.write(info_frame(data, len(x), stereo) + data)


ENC_DELAY = 576  # LAME's encoder delay at 44.1 kHz
BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]


def crc16(buf, crc=0):
    """CRC-16/ARC (poly 0x8005 reflected), the one the LAME tag uses."""
    for b in buf:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc


def info_frame(data, nsamples, stereo):
    """A LAME 'Info' header frame so decoders (Chrome/FFmpeg, mpg123) trim the
    encoder delay and end padding: sample-exact onsets and gapless loops."""
    assert data[0] == 0xFF and (data[1] & 0xE0) == 0xE0, 'stream must start with a frame'
    nframes, i = 0, 0
    while i + 4 <= len(data):
        h = data[i:i + 4]
        assert h[0] == 0xFF and (h[1] & 0xE0) == 0xE0
        br = BITRATES[h[2] >> 4] * 1000
        i += 144 * br // SR + ((h[2] >> 1) & 1)
        nframes += 1
    br_idx = data[2] >> 4
    size = 144 * BITRATES[br_idx] * 1000 // SR
    fr = bytearray(size)
    fr[0:4] = bytes([0xFF, data[1], (br_idx << 4) | (data[2] & 0x0C), data[3]])
    p = 4 + (32 if stereo else 17)
    pad = nframes * 1152 - ENC_DELAY - nsamples
    assert 0 <= pad < 4096, pad
    total = size + len(data)
    fr[p:p + 4] = b'Info'
    fr[p + 4:p + 8] = (0x0F).to_bytes(4, 'big')
    fr[p + 8:p + 12] = nframes.to_bytes(4, 'big')
    fr[p + 12:p + 16] = total.to_bytes(4, 'big')
    fr[p + 16:p + 116] = bytes(min(255, k * 256 // 100) for k in range(100))
    fr[p + 116:p + 120] = (50).to_bytes(4, 'big')
    q = p + 120
    fr[q:q + 9] = b'LAME3.100'
    fr[q + 9] = 0x00          # tag rev 0, CBR
    fr[q + 10] = 0xA0         # lowpass 16 kHz / 100
    fr[q + 19] = 0x00         # encoding flags / ATH type
    fr[q + 20] = min(255, BITRATES[br_idx])
    fr[q + 21:q + 24] = ((ENC_DELAY << 12) | pad).to_bytes(3, 'big')
    fr[q + 28:q + 32] = total.to_bytes(4, 'big')
    fr[q + 32:q + 34] = crc16(data).to_bytes(2, 'big')
    fr[q + 34:q + 36] = crc16(bytes(fr[:q + 34])).to_bytes(2, 'big')
    return bytes(fr)


def measure(path, meta):
    d, r = sf.read(path, dtype='float64', always_2d=True)
    m = d.mean(1)
    a = np.abs(d).max(1)
    pk = a.max()
    res = dict(file=os.path.basename(path), kb=round(os.path.getsize(path) / 1024, 1), ch=d.shape[1],
               dur=round(len(d) / r, 3), peak_db=round(20 * np.log10(pk), 2),
               onset_ms=round(1000 * np.argmax(a > 0.1 * pk) / r, 1))
    if 'sub' in meta:
        seg = m[n_of(meta['hole'][1]):] if 'hole' in meta else m
        M = pow2(len(seg))
        X = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), M))
        f = np.fft.rfftfreq(M, 1 / r)
        band = (f >= 20) & (f <= 200)
        res['low_hz'] = round(float(f[band][np.argmax(X[band])]), 1)
    if 'hole' in meta:
        h0, h1 = meta['hole']
        hole = m[n_of(h0):n_of(h1)]
        res['hole_db'] = round(20 * np.log10(np.sqrt(np.mean(hole ** 2)) / pk + 1e-12), 1)
    if meta.get('loop'):
        k = n_of(0.02)
        res['seam_jump'] = round(float(abs(m[-1] - m[0]) / pk), 3)
        res['rms_end_vs_start_db'] = round(20 * np.log10(np.sqrt(np.mean(m[-k:] ** 2)) / np.sqrt(np.mean(m[:k] ** 2))), 1)
    if meta.get('riser'):
        res['riser'] = True
    return res


def main():
    global S
    ap = argparse.ArgumentParser()
    ap.add_argument('--impact', required=True)
    ap.add_argument('--rpg', required=True)
    ap.add_argument('--scifi', required=True)
    ap.add_argument('--el', required=True)
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'client', 'public', 'audio', 'sfx', 'game'))
    ap.add_argument('--only', default='')
    ap.add_argument('--report', default='')
    a = ap.parse_args()
    S = Src(a)
    names = [n for n in a.only.split(',') if n] or NAMES
    rows = []
    for name in names:
        x, meta = BUILD[name]()
        x = finish(x, meta)
        path = os.path.join(a.out, name + '.mp3')
        write_mp3(path, x)
        row = measure(path, meta)
        rows.append(row)
        print(json.dumps(row))
    total = sum(os.path.getsize(os.path.join(a.out, n + '.mp3')) for n in NAMES if os.path.exists(os.path.join(a.out, n + '.mp3')))
    print(f'total {total / 1024:.0f} KB')
    if a.report:
        with open(a.report, 'w') as f:
            json.dump(rows, f, indent=1)


if __name__ == '__main__':
    sys.exit(main())
