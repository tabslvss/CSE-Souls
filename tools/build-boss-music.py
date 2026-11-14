#!/usr/bin/env python3
"""Builds the layered boss-fight music in client/public/audio/music/boss/.

Source track: "Final Battle of the Dark Wizards" by Kevin MacLeod (incompetech.com),
CC BY 4.0. Download it yourself from
  https://incompetech.com/music/royalty-free/mp3-royaltyfree/Final%20Battle%20of%20the%20Dark%20Wizards.mp3
then run
  python3 tools/build-boss-music.py <that.mp3> client/public/audio/music/boss [decoderOffsetSeconds]
Needs numpy, scipy and soundfile (libsndfile 1.1+ for mp3). No ffmpeg.

What it makes (all 44.1 kHz stereo mp3):
  loops, all exactly 24 bars at 112 BPM (51.428571 s) with the same 0.5 s pre-roll and
  0.5 s post-roll, so they stay in sync when started together:
    boss-low   track low-passed at 900 Hz plus a synthesized D drone and sub rumble
    boss-main  the loudest, most driving 24-bar section, cut on the downbeat
    boss-high  the same section high-passed and brightened, plus synthesized war drums
               and a choir-like pad that follows the detected chords and rises per phrase
  one-shots:
    boss-intro         2-bar riser into a big hit that lands on the loop's first downbeat
    boss-stinger-stun  reversed swell into a hit and a metallic ring, 1.5 s
    boss-outro         the track's final hit with a long dark tail, 6.5 s
    boss-victory       a calm resolving chord swell, 7.5 s, fully synthesized
The optional decoderOffsetSeconds (measured by decoding in Chrome) is written into
boss-music.json so loopStart/loopEnd match what decodeAudioData returns.
"""
import json
import os
import sys

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt, sosfiltfilt, fftconvolve, stft, istft

SR = 44100
BPM = 112
BEAT = SR * 60 // BPM          # 23625 samples, exact at 112 BPM
BAR = 4 * BEAT                 # 94500 samples = 2.142857 s
BARS = 24
L = BARS * BAR                 # 2,268,000 samples = 51.428571 s
DOWNBEAT_GUESS = 131.182       # bar 61 downbeat, from onset comb + 24-bar similarity search
XF = int(0.045 * SR)           # 45 ms seam crossfade
PRE = SR // 2                  # pre-roll before loopStart
POST = SR // 2                 # post-roll after loopEnd (copy of the loop's start)
MAIN_RMS_DB = -18.0            # matches night-vigil / ancient-rite (about -18 dB RMS)
SUM_PEAK_DB = -1.5             # low+main+high summed must stay below this before encoding
rng = np.random.default_rng(312)


# ---------- small DSP helpers ----------
def db(v):
    return 20 * np.log10(max(float(v), 1e-12))


def rms(x):
    return float(np.sqrt(np.mean(np.square(x))))


def lp(fc, order=4):
    return butter(order, fc, 'low', fs=SR, output='sos')


def hp(fc, order=4):
    return butter(order, fc, 'high', fs=SR, output='sos')


def bp(lo, hi, order=2):
    return butter(order, [lo, hi], 'band', fs=SR, output='sos')


def stereo(x):
    return np.stack([x, x], 1) if x.ndim == 1 else x


def pfilt(sos, x):
    """Steady-state filtering of a periodic (looping) signal: filter two copies, keep the second."""
    y = sosfilt(sos, np.concatenate([x, x], 0), axis=0)
    return y[len(x):]


def place(buf, sig, pos):
    """Add sig into buf at pos, wrapping around the end (circular)."""
    n = len(buf)
    pos %= n
    first = min(len(sig), n - pos)
    buf[pos:pos + first] += sig[:first]
    rest = sig[first:]
    while len(rest):
        m = min(len(rest), n)
        buf[:m] += rest[:m]
        rest = rest[m:]


def reverb_ir(t60, dur=None, lpf=6500, predelay=0.018, seed=1):
    r = np.random.default_rng(seed)
    dur = dur or t60 * 1.1
    n = int(dur * SR)
    t = np.arange(n) / SR
    ir = r.standard_normal((n, 2)) * np.exp(-6.91 * t / t60)[:, None]
    ir = sosfilt(lp(lpf, 2), ir, axis=0)
    # the tail darkens: a second, slower low-passed copy takes over late
    dark = sosfilt(lp(1800, 2), r.standard_normal((n, 2)), axis=0) * np.exp(-6.91 * t / (t60 * 1.3))[:, None]
    ir = ir * np.exp(-t / (t60 * 0.5))[:, None] + dark * (1 - np.exp(-t / (t60 * 0.5)))[:, None] * 0.8
    ir[: int(0.004 * SR)] *= np.linspace(0, 1, int(0.004 * SR))[:, None]
    ir = np.concatenate([np.zeros((int(predelay * SR), 2)), ir], 0)
    return ir / np.sqrt(np.sum(ir ** 2, 0, keepdims=True))


def reverb(x, ir, wet, dry=1.0):
    x = stereo(x)
    y = np.stack([fftconvolve(x[:, c], ir[:, c]) for c in range(2)], 1)
    out = np.zeros_like(y)
    out[: len(x)] += x * dry
    return out + y * wet


def creverb(x, ir, wet, dry=1.0):
    """Circular reverb for loop layers: the tail wraps onto the start."""
    n = len(x)
    irp = np.zeros((n, 2))
    m = min(len(ir), n)
    irp[:m] = ir[:m]
    y = np.fft.irfft(np.fft.rfft(x, axis=0) * np.fft.rfft(irp, axis=0), n, axis=0)
    return x * dry + y * wet


def polyblep_saw(freq):
    """Band-limited-ish sawtooth from a per-sample frequency array."""
    dt = freq / SR
    ph = np.cumsum(dt) + rng.random()
    t = ph % 1.0
    y = 2 * t - 1
    a = t < dt
    xa = t[a] / dt[a]
    y[a] -= xa + xa - xa * xa - 1
    b = t > 1 - dt
    xb = (t[b] - 1) / dt[b]
    y[b] -= xb * xb + xb + xb + 1
    return y


def midi_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def adsr(n, attack, release, sustain_end=None):
    env = np.ones(n)
    a = max(1, int(attack * SR))
    r = max(1, int(release * SR))
    env[:a] = np.sin(np.linspace(0, np.pi / 2, a)) ** 2
    env[n - r:] *= np.cos(np.linspace(0, np.pi / 2, r)) ** 2
    return env


# ---------- instruments ----------
def taiko(f0, vel, dur=1.1, seed=0):
    r = np.random.default_rng(seed)
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = f0 * (1 + 1.5 * np.exp(-t / 0.022))
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / 0.30) + 0.35 * np.sin(1.59 * ph + 0.4) * np.exp(-t / 0.11)
    slap = sosfilt(bp(350, 3200), r.standard_normal(n)) * np.exp(-t / 0.011) * 0.9
    y = np.tanh(1.7 * (body + slap)) * vel
    y[:44] *= np.linspace(0, 1, 44)
    return y


def boom(f_hi=72, f_lo=27, dur=2.4, decay=0.75):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = f_lo + (f_hi - f_lo) * np.exp(-t / 0.13)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / decay)
    click = sosfilt(lp(900), rng.standard_normal(n)) * np.exp(-t / 0.006) * 0.6
    y = np.tanh(1.4 * (y + click))
    y[:32] *= np.linspace(0, 1, 32)
    return y


def gong(f0, dur=3.0, bend=-0.012, amp=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    ratios = [1.0, 1.47, 2.09, 2.56, 3.18, 3.92, 4.73, 5.61, 6.83]
    y = np.zeros(n)
    for i, rr in enumerate(ratios):
        f = f0 * rr * (1 + bend * (1 - np.exp(-t / 1.2)))
        y += np.sin(2 * np.pi * np.cumsum(f) / SR + rng.random() * 6.28) * np.exp(-t * (0.6 + 0.55 * i)) / (1 + 0.5 * i)
    y += sosfilt(bp(2500, 9000), rng.standard_normal(n)) * np.exp(-t / 0.05) * 0.4
    y[:22] *= np.linspace(0, 1, 22)
    return y * amp / (np.abs(y).max() + 1e-9)


def noise_burst(lo, hi, decay, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = sosfilt(bp(lo, hi), rng.standard_normal((n, 2)), axis=0) * np.exp(-t / decay)[:, None]
    return y


FORMANTS = {'ah': [(800, 1.0), (1150, 0.55), (2900, 0.22)], 'oo': [(350, 1.0), (700, 0.45), (2400, 0.08)]}


def choir(notes, dur, attack=0.35, release=0.6, vowel='ah', vib=0.012, spread=0.008):
    """A choir-like 'ah' or 'oo': detuned saw ensemble per note through vowel formants."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros((n, 2))
    for m in notes:
        f0 = midi_hz(m)
        for c in range(2):
            src = np.zeros(n)
            for det in (-spread, 0.0, spread * 0.8):
                vrate = 4.6 + rng.random() * 1.2
                fm = f0 * (1 + det + (rng.random() - 0.5) * 0.003) * (1 + vib * np.sin(2 * np.pi * vrate * t + rng.random() * 6.28))
                src += polyblep_saw(fm)
            v = sum(g * sosfilt(bp(fc * 0.88, fc * 1.12), src) for fc, g in FORMANTS[vowel])
            v += 0.12 * sosfilt(lp(500), src)
            out[:, c] += v
    return out * adsr(n, attack, release)[:, None] / max(1, len(notes))


def strings(notes, dur, attack=1.0, release=1.5, cutoff=1700):
    n = int(dur * SR)
    out = np.zeros((n, 2))
    for m in notes:
        f0 = midi_hz(m)
        for c in range(2):
            src = np.zeros(n)
            for cents in (-12, -5, 4, 11):
                src += polyblep_saw(np.full(n, f0 * 2 ** ((cents + (rng.random() - 0.5) * 3) / 1200)))
            out[:, c] += sosfilt(lp(cutoff, 2), src)
    return out * adsr(n, attack, release)[:, None] / max(1, len(notes))


def bell(f0, dur=4.0, amp=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for rr, a, d in ((1.0, 1.0, 2.6), (2.0, 0.5, 1.6), (2.76, 0.35, 1.0), (5.4, 0.18, 0.5), (8.93, 0.08, 0.25)):
        y += a * np.sin(2 * np.pi * f0 * rr * t) * np.exp(-t / d)
    y[:66] *= np.linspace(0, 1, 66)
    return y * amp / np.abs(y).max()


def pan(x, p):
    """p in -1..1, equal power."""
    a = (p + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)], 1)


# ---------- analysis of the source ----------
def onset_near(m, t_guess, win=0.04):
    a = int((t_guess - win) * SR)
    seg = m[a: a + int(2 * win * SR)]
    h = 32
    e = np.array([np.sum(seg[i:i + h] ** 2) for i in range(0, len(seg) - h, h)])
    le = np.log(e + 1e-9)
    le = np.convolve(le, np.ones(3) / 3, 'same')
    d = np.diff(le)
    return a + (int(np.argmax(d)) + 1) * h


def strongest_hit(m, t0, t1, last=False):
    h = 256
    a = int(t0 * SR)
    seg = m[a: int(t1 * SR)]
    e = np.array([np.sum(seg[i:i + h] ** 2) for i in range(0, len(seg) - h, h)])
    k = int(0.12 * SR / h)
    score = np.zeros(len(e))
    for i in range(k, len(e) - k):
        score[i] = (e[i:i + k].mean() + 1e-9) / (e[i - k:i].mean() + 1e-9) * np.sqrt(e[i:i + k].mean())
    i = int(np.argmax(score)) if not last else int(np.nonzero(score > 0.35 * score.max())[0][-1])
    return a + i * h


def chroma(x, lo=60, hi=1500):
    f, _, Z = stft(x, SR, nperseg=8192, noverlap=8192 - 2048)
    P = np.abs(Z) ** 2
    pc = np.full(len(f), -1)
    ok = (f > lo) & (f < hi)
    pc[ok] = np.round(12 * np.log2(f[ok] / 440) + 69).astype(int) % 12
    c = np.array([P[pc == k].sum() for k in range(12)])
    return c / (c.sum() + 1e-12)


NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']


def best_chord(c):
    best = None
    for r in range(12):
        for q, third in (('', 4), ('m', 3)):
            s = c[r] * 1.2 + c[(r + third) % 12] + c[(r + 7) % 12] - 0.4 * c[(r + third + (1 if third == 3 else -1)) % 12]
            if best is None or s > best[0]:
                best = (s, r, third, q)
    return best[1], best[2], NAMES[best[1]] + best[3]


# ---------- main ----------
def main():
    src, outdir = sys.argv[1], sys.argv[2]
    dec_off = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0
    os.makedirs(outdir, exist_ok=True)
    x, sr = sf.read(src, always_2d=True)
    assert sr == SR and x.shape[1] == 2, (sr, x.shape)
    m = x.mean(1)

    # loop start: the real downbeat transient near the guess, a few ms early, snapped to a quiet sample
    on = onset_near(m, DOWNBEAT_GUESS)
    s = on - int(0.004 * SR)
    w = np.abs(x[s - 40:s + 1]).sum(1)
    s = s - 40 + int(np.argmin(w))
    grid0 = on - s                              # samples from loop start to the first beat
    on_end = onset_near(m, (s + L) / SR, 0.03)
    print(f'loop start {s / SR:.4f}s (onset {on / SR:.4f}), end {(s + L) / SR:.4f}s, end-onset drift {(on_end - s - L - grid0) / SR * 1000:.1f} ms')

    R0 = s - 3 * BAR
    reg = x[R0: s + L + 3 * BAR]
    o = s - R0

    def loop_from(proc):
        body = proc[o:o + L].copy()
        nn = np.arange(XF) / XF
        fi = (0.5 - 0.5 * np.cos(np.pi * nn))[:, None]
        body[L - XF:] = proc[o + L - XF:o + L] * (1 - fi) + proc[o - XF:o] * fi
        return body, proc[o - PRE:o].copy()

    main_t, main_pre = loop_from(reg)
    low_t, low_pre = loop_from(sosfiltfilt(lp(900), reg, axis=0))
    hpr = sosfiltfilt(hp(1500), reg, axis=0)
    exc = sosfiltfilt(hp(2200), np.tanh(6 * sosfiltfilt(hp(3000), reg, axis=0)) / 6, axis=0)
    high_t, high_pre = loop_from(hpr + 0.6 * sosfiltfilt(hp(5000), reg, axis=0) + 0.5 * exc)

    # chords per bar for the pad
    # harmony per bar: chord root from the full mix, bass root from 40-250 Hz.
    # The section moves from D minor into F minor / Bb minor, so the synthesized parts follow
    # it (open fifths only, so a wrong third can never clash).
    chords, bass = [], []
    for b in range(BARS):
        seg = main_t[b * BAR:(b + 1) * BAR].mean(1)
        chords.append(best_chord(chroma(seg)))
        bass.append(int(np.argmax(chroma(seg, 40, 250))))
    print('chords', ' '.join(c[2] for c in chords))
    print('bass  ', ' '.join(NAMES[r] for r in bass))
    key_c = chroma(main_t.mean(1))
    print('section chroma', {NAMES[i]: round(float(key_c[i]), 3) for i in np.argsort(key_c)[::-1][:6]})

    def runs(seq):
        out, b0 = [], 0
        for b in range(1, BARS + 1):
            if b == BARS or seq[b] != seq[b0]:
                out.append((b0, b - b0, seq[b0]))
                b0 = b
        return out

    t = np.arange(L) / SR
    Ls = L / SR

    # --- drone on the chord root (D1..C#2 plus octaves), held through runs of the same root ---
    drone = np.zeros((L, 2))   # exactly one loop; place() wraps tails onto the start
    for b0, nb, r_ in runs([c[0] for c in chords]):
        f = midi_hz(26 + (r_ - 2) % 12)
        dur = nb * BAR / SR + 0.5
        n = int(dur * SR)
        tt = np.arange(n) / SR
        seg = np.zeros((n, 2))
        for fm, amp in ((f, 1.0), (2 * f, 0.5), (4 * f, 0.1)):
            for c, dets in ((0, (-0.21, 0.27)), (1, (-0.3, 0.18))):
                for d in dets:
                    fb = fm + d
                    for h in range(1, int(420 / fb) + 1):
                        seg[:, c] += amp / h / (1 + (h * fb / 170) ** 2) * np.sin(2 * np.pi * h * fb * tt + rng.random() * 6.28)
        seg *= adsr(n, 0.25, 0.45)[:, None]
        place(drone, seg, grid0 + b0 * BAR - int(0.12 * SR))
    am = 1 + 0.22 * np.sin(2 * np.pi * 3 * t / Ls + 1.0) + 0.12 * np.sin(2 * np.pi * 8 * t / Ls)
    drone *= am[:, None]
    spec = np.fft.rfft(rng.standard_normal((L, 2)), axis=0)
    fr = np.fft.rfftfreq(L, 1 / SR)
    spec *= ((fr > 22) & (fr < 95))[:, None] * np.exp(-((np.log(fr + 1e-9) - np.log(45)) ** 2) / 0.5)[:, None]
    rumble = np.fft.irfft(spec, L, axis=0)
    drone += rumble / (rms(rumble) + 1e-12) * rms(drone) * 0.5

    # --- war drums on the beat grid ---
    drums = np.zeros((L, 2))   # exactly one loop; place() wraps tails onto the start
    k = 0
    for b in range(BARS):
        if b % 4 == 3:
            pat = [(0, 1.0, 'lo'), (1, 0.55, 'hi'), (2, 0.85, 'lo'), (3, 0.6, 'hi'), (3.25, 0.62, 'hi'), (3.5, 0.78, 'lo'), (3.75, 0.95, 'lo')]
        elif b % 2 == 1:
            pat = [(0, 1.0, 'lo'), (1.5, 0.5, 'hi'), (2, 0.85, 'lo'), (3, 0.55, 'hi'), (3.5, 0.48, 'hi')]
        else:
            pat = [(0, 1.0, 'lo'), (1, 0.45, 'hi'), (2, 0.8, 'lo'), (2.5, 0.42, 'hi'), (3, 0.6, 'lo')]
        for pos, vel, kind in pat:
            k += 1
            v = vel * (0.92 + 0.12 * rng.random())
            at = grid0 + int(round((b * 4 + pos) * BEAT)) + int(rng.normal(0, 0.002) * SR)
            if kind == 'lo':
                sig = pan(taiko(56 + rng.random() * 3, v, seed=k), -0.35)
            else:
                sig = pan(taiko(92 + rng.random() * 5, v * 0.8, dur=0.7, seed=k), 0.4)
            place(drums, sig, at)
        if b % 4 == 0:   # a deep odaiko on each phrase start
            place(drums, pan(taiko(41, 1.15, dur=1.8, seed=900 + b), 0.0), grid0 + b * BAR)
    drums = creverb(drums, reverb_ir(1.7, seed=3), wet=0.35)

    # --- choir pad following the chords, rising through each 4-bar phrase ---
    pad = np.zeros((L, 2))   # exactly one loop; place() wraps tails onto the start
    for b0, nb, r_ in runs([c[0] for c in chords]):
        root = 45 + (r_ - 9) % 12             # A2..G#3
        notes = [root + 12, root + 19, root + 24]   # open fifth and octave, A3..G#5
        seg = choir(notes, nb * BAR / SR + 0.7, attack=0.3, release=0.65)
        place(pad, seg, grid0 + b0 * BAR - int(0.08 * SR))
    phr = ((t - grid0 / SR) % (4 * BAR / SR)) / (4 * BAR / SR)
    rise = 0.28 + 0.72 * phr ** 1.6
    win = np.hanning(int(0.14 * SR))
    win /= win.sum()
    kern = np.zeros(L)
    kern[:len(win)] = win
    rise = np.fft.irfft(np.fft.rfft(rise) * np.fft.rfft(kern), L)
    rise = np.roll(rise, -len(win) // 2)
    bright = pfilt(hp(1800, 2), pad)
    pad = (pad + 1.2 * bright * (phr ** 2)[:, None]) * rise[:, None]
    pad = creverb(pad, reverb_ir(2.6, seed=5), wet=0.55)

    # --- levels ---
    def jump(v):
        return float(np.abs(v[0] - v[-1]).max()), float(np.percentile(np.abs(np.diff(v, axis=0)).max(1), 99))
    print('component seams (jump, p99 step):', {k_: tuple(round(q, 5) for q in jump(v_)) for k_, v_ in
          (('lowtrack', low_t), ('drone', drone), ('drums', drums), ('pad', pad), ('hightrack', high_t))})

    def soft(v, ceil):
        return np.tanh(v / ceil) * ceil
    gM = 10 ** (MAIN_RMS_DB / 20) / rms(main_t)
    main_b = main_t * gM
    lowtrack = low_t * gM * 0.3
    gDr = rms(lowtrack) * 10 ** (-1 / 20) / rms(drone)
    low_b = lowtrack + drone * gDr
    drums_n = drums / rms(drums)
    drums_n = soft(drums_n, 3.2)                       # tame the taiko crest (about 10 dB)
    drums_n *= 10 ** (-25.5 / 20) / rms(drums_n)
    pad_n = pad * (10 ** (-27 / 20) / rms(pad))
    hiT = high_t * gM * 0.75
    high_b = hiT + drums_n + pad_n
    low_p = low_pre * gM * 0.3 + drone[-PRE:] * gDr
    high_p = high_pre * gM * 0.75 + (drums_n + pad_n)[-PRE:]
    main_p = main_pre * gM
    c_hi = 3.5 * rms(high_b)                           # memoryless soft limit, same curve on pre-roll
    high_b, high_p = soft(high_b, c_hi), soft(high_p, c_hi)

    files = {}
    for name, body, pre in (('boss-low', low_b, low_p), ('boss-main', main_b, main_p), ('boss-high', high_b, high_p)):
        files[name] = np.concatenate([pre, body, body[:POST]], 0)
    # loudness: low+main (what plays for most of the fight) matches the existing tracks;
    # then everything comes down together if all three summed would get near clipping
    g = 10 ** (MAIN_RMS_DB / 20) / rms((files['boss-low'] + files['boss-main'])[PRE:PRE + L])
    total = (files['boss-low'] + files['boss-main'] + files['boss-high']) * g
    g *= min(1.0, 10 ** (SUM_PEAK_DB / 20) / np.abs(total).max())
    for kk in files:
        files[kk] *= g
    gM *= g
    total = files['boss-low'] + files['boss-main'] + files['boss-high']
    lm = files['boss-low'] + files['boss-main']
    print(f'low+main: rms {db(rms(lm[PRE:PRE + L])):.2f} dB peak {db(np.abs(lm).max()):.2f} dB')
    for kk, v in files.items():
        print(f'{kk}: rms {db(rms(v[PRE:PRE + L])):.2f} dB  peak {db(np.abs(v).max()):.2f} dB')
    print(f'sum low+main+high: rms {db(rms(total)):.2f} dB peak {db(np.abs(total).max()):.2f} dB')

    # seam check: jump from the last loop sample to the first, against the loop's own sample-to-sample steps
    seam = {}
    for kk, v in files.items():
        body = v[PRE:PRE + L]
        jump = float(np.abs(body[0] - body[-1]).max())
        steps = np.abs(np.diff(body, axis=0)).max(1)
        seam[kk] = dict(jump=round(jump, 5), p50=round(float(np.percentile(steps, 50)), 5), p99=round(float(np.percentile(steps, 99)), 5))
    print('seam', seam)

    # ---------- one-shots ----------
    H = 2 * BAR + grid0                       # intro hit lands where the loop's first downbeat would
    IR_big = reverb_ir(2.8, seed=7)

    # intro: 2-bar riser into a hit
    n = int(5.0 * SR)
    intro = np.zeros((n + 6 * SR, 2))
    rs = reverb(main_b[:BAR], IR_big, wet=1.0, dry=0.6)[: int(2.4 * SR)][::-1]
    rs = sosfilt(hp(250), rs, axis=0)
    rs *= (np.linspace(0, 1, len(rs)) ** 2.5)[:, None]
    gap = int(0.055 * SR)
    place(intro, rs * 0.9, H - gap - len(rs))
    rl = H - gap
    nr = np.zeros((rl, 2))
    for c in range(2):   # noise swept upward by a moving band (shaped in the STFT domain)
        fq, _, Z = stft(rng.standard_normal(rl), SR, nperseg=2048)
        u = np.linspace(0, 1, Z.shape[1])
        cen = 250 * (9000 / 250) ** (u ** 1.3)
        mask = np.exp(-((np.log2(fq[:, None] + 1) - np.log2(cen[None, :])) ** 2) / (2 * 0.7 ** 2)) * (u ** 2.2)[None, :]
        _, y = istft(Z * mask, SR, nperseg=2048)
        y = y[:rl]
        nr[:len(y), c] = y
    nr /= np.abs(nr).max() + 1e-9
    place(intro, nr * 0.35, 0)
    tt = np.arange(rl) / SR
    gl = midi_hz(38) * 2 ** (1.0 * (tt / tt[-1]) ** 1.6)
    riser = sosfilt(lp(2400), polyblep_saw(gl) + polyblep_saw(gl * 1.006) + 0.6 * polyblep_saw(gl * 1.498))
    riser *= (tt / tt[-1]) ** 2 * 0.22
    place(intro, pan(riser, 0), 0)
    dr = np.sin(2 * np.pi * midi_hz(26) * tt) + 0.4 * np.sin(2 * np.pi * midi_hz(38) * tt)
    place(intro, pan(dr * (tt / tt[-1]) ** 1.4 * 0.32, 0), 0)
    hits = [(0, 0.35, 'lo'), (2, 0.42, 'lo'), (4, 0.5, 'lo'), (5, 0.52, 'hi'), (6, 0.58, 'lo'), (6.5, 0.6, 'hi'),
            (7, 0.66, 'lo'), (7.25, 0.7, 'hi'), (7.5, 0.78, 'lo'), (7.75, 0.9, 'lo')]
    for i, (pos, vel, kind) in enumerate(hits):
        sig = taiko(57, vel, seed=200 + i) if kind == 'lo' else taiko(94, vel * 0.8, dur=0.7, seed=200 + i)
        place(intro, pan(sig, -0.3 if kind == 'lo' else 0.35), grid0 + int(pos * BEAT))
    hit = np.zeros((int(5.5 * SR), 2))
    for sig in (pan(boom(78, 27, 2.6, 0.8), 0), pan(taiko(52, 1.2, 1.6, seed=300), -0.1), pan(taiko(90, 0.8, 0.8, seed=301), 0.2)):
        hit[:len(sig)] += sig
    hit[: int(3 * SR)] += noise_burst(1800, 9000, 0.32, 3.0) * 0.3
    hit[: int(3 * SR)] += pan(gong(midi_hz(38), 3.0, amp=0.35), 0)
    hit = reverb(hit, IR_big, wet=0.45)
    place(intro, hit, H)
    intro = intro[:n]
    fo = int(0.5 * SR)
    intro[-fo:] *= np.cos(np.linspace(0, np.pi / 2, fo))[:, None] ** 2

    # stinger for the stance break: reversed swell, hit, metallic ring
    hs = strongest_hit(m, 20, 255)
    print(f'stinger source hit at {hs / SR:.3f}s')
    n = int(1.5 * SR)
    Hs = int(0.62 * SR)
    st = np.zeros((n + 4 * SR, 2))
    src_hit = x[hs - int(0.003 * SR): hs + int(0.9 * SR)].copy() * gM * 1.2
    src_hit[-int(0.4 * SR):] *= np.cos(np.linspace(0, np.pi / 2, int(0.4 * SR)))[:, None] ** 2
    sw = reverb(src_hit, reverb_ir(2.0, seed=9), wet=1.0, dry=0.4)[: int(1.4 * SR)][::-1]
    sw = sw[-(Hs - int(0.03 * SR)):]
    sw = sosfilt(hp(180), sw, axis=0) * (np.linspace(0, 1, len(sw)) ** 2.2)[:, None]
    place(st, sw, 0)
    h2 = np.zeros((int(3 * SR), 2))
    h2[:len(src_hit)] += src_hit
    h2 += pan(boom(90, 30, 3.0, 0.6), 0) * 0.9
    h2 += pan(gong(midi_hz(38) * 1.0, 3.0, amp=0.5), -0.2) + pan(gong(midi_hz(45) * 1.02, 3.0, amp=0.3), 0.25)
    h2[: int(0.8 * SR)] += noise_burst(4500, 12000, 0.07, 0.8) * 0.45
    h2[: int(1.1 * SR)] += pan(taiko(60, 1.1, 1.1, seed=400), 0)
    h2 = reverb(h2, IR_big, wet=0.4)
    place(st, h2, Hs)
    st = st[:n]
    fo = int(0.6 * SR)
    st[-fo:] *= np.cos(np.linspace(0, np.pi / 2, fo))[:, None] ** 2

    # outro: the track's own final hit with a long dark tail
    hf = strongest_hit(m, 258, 270, last=True)
    fin = x[hf - int(0.003 * SR):].copy() * gM * 1.15
    rootc = int(np.argmax(chroma(fin[: int(1.2 * SR)].mean(1))))
    print(f'outro source hit at {hf / SR:.3f}s, root {NAMES[rootc]}')
    n = int(6.5 * SR)
    ou = np.zeros((n + 6 * SR, 2))
    ou[:len(fin)] += fin
    ou[: int(3 * SR)] += pan(boom(70, 26, 3.0, 1.1), 0) * 0.9
    rootm = 26 + (rootc - 2) % 12        # near D1
    tt = np.arange(n) / SR
    tail = np.sin(2 * np.pi * midi_hz(rootm) * tt) + 0.5 * np.sin(2 * np.pi * midi_hz(rootm + 12) * tt * 1.001)
    tail *= (np.minimum(tt / 0.6, 1) * np.exp(-tt / 2.4))
    ou[:n] += pan(tail * 0.35, 0)
    ch = choir([rootm + 24, rootm + 31, rootm + 36 + 3 - 12 + 12], 6.0, attack=0.9, release=3.5, vowel='oo')
    ou[int(0.25 * SR): int(0.25 * SR) + len(ch)] += ch * 0.9
    ou = reverb(ou, reverb_ir(4.5, seed=11, lpf=4000), wet=0.55)
    ou = ou[:n]
    fo = int(1.4 * SR)
    ou[-fo:] *= np.cos(np.linspace(0, np.pi / 2, fo))[:, None] ** 2

    # victory: a calm swell that resolves Bb -> Dsus4 -> D major
    n = int(7.5 * SR)
    vi = np.zeros((n + 6 * SR, 2))
    for start, dur, notes in ((0.0, 2.9, [46, 58, 62, 65, 70]), (2.4, 2.1, [50, 62, 67, 69, 74]), (4.1, 3.4, [38, 50, 62, 66, 69, 74])):
        seg = strings(notes, dur, attack=0.9 if start == 0 else 0.5, release=0.8 if start < 4 else 2.4)
        place(vi, seg * 0.9, int(start * SR))
    for start, dur, notes in ((0.3, 2.7, [70, 74]), (2.5, 1.9, [69, 74]), (4.15, 3.3, [69, 78])):
        place(vi, choir(notes, dur, attack=0.7, release=0.9 if start < 4 else 2.4, vib=0.008) * 0.6, int(start * SR))
    vi[int(4.1 * SR): int(4.1 * SR) + 5 * SR] += pan(bell(midi_hz(74), 5.0, 0.12), 0.25) + pan(bell(midi_hz(81), 5.0, 0.06), -0.3)
    vi = reverb(vi, reverb_ir(3.4, seed=13, lpf=7000), wet=0.5)[:n]
    fo = int(1.6 * SR)
    vi[-fo:] *= np.cos(np.linspace(0, np.pi / 2, fo))[:, None] ** 2

    def norm(v, peak_db, rms_db=None):
        g = 10 ** (peak_db / 20) / np.abs(v).max()
        if rms_db is not None:
            g = min(g, 10 ** (rms_db / 20) / rms(v))
        return v * g

    shots = {
        'boss-intro': norm(intro, -1.0, -16.5),
        'boss-stinger-stun': norm(st, -1.0, -15.0),
        'boss-outro': norm(ou, -1.0, -17.0),
        'boss-victory': norm(vi, -3.0, -20.0),
    }
    for kk, v in shots.items():
        print(f'{kk}: dur {len(v) / SR:.3f}s rms {db(rms(v)):.2f} dB peak {db(np.abs(v).max()):.2f} dB')

    for kk, v in files.items():
        sf.write(os.path.join(outdir, kk + '.mp3'), v, SR, format='MP3', bitrate_mode='CONSTANT', compression_level=0.6667)
    for kk, v in shots.items():
        sf.write(os.path.join(outdir, kk + '.mp3'), v, SR, format='MP3', bitrate_mode='CONSTANT', compression_level=0.7)
    ref_dir = os.environ.get('BOSS_WAV_DIR')        # optional: lossless references for measuring decode offsets
    if ref_dir:
        os.makedirs(ref_dir, exist_ok=True)
        for kk, v in list(files.items()) + list(shots.items()):
            sf.write(os.path.join(ref_dir, kk + '.wav'), v, SR, subtype='FLOAT')

    meta = {
        'bpm': BPM, 'beatSeconds': BEAT / SR, 'barSeconds': BAR / SR, 'loopBars': BARS,
        'decoderOffsetSeconds': dec_off,
        'loopStart': round(PRE / SR + dec_off, 6), 'loopEnd': round((PRE + L) / SR + dec_off, 6),
        'firstBeatAfterLoopStart': round(grid0 / SR, 6),
        'introHitAt': round(H / SR + dec_off, 6),
        'stingerHitAt': round(Hs / SR + dec_off, 6),
        'chords': [c[2] for c in chords],
        'source': {'title': 'Final Battle of the Dark Wizards', 'author': 'Kevin MacLeod (incompetech.com)',
                   'license': 'CC BY 4.0', 'licenseUrl': 'https://creativecommons.org/licenses/by/4.0/',
                   'sectionSeconds': [round(s / SR, 4), round((s + L) / SR, 4)]},
        'seam': seam,
    }
    with open(os.path.join(outdir, 'boss-music.json'), 'w') as fh:
        json.dump(meta, fh, indent=2)
    print(json.dumps({k: meta[k] for k in ('loopStart', 'loopEnd', 'introHitAt', 'stingerHitAt')}))


if __name__ == '__main__':
    main()
