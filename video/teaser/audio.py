"""The teaser soundtrack, synthesised: python video/teaser/audio.py out.wav. 21 s, cut to the same beats as both films (3.75, 7.5, 11.5, 16.5 s)."""
import sys
import wave

import numpy as np

RATE = 48000
LENGTH = 21.0
BEATS = [3.75, 7.5, 11.5]
HIT = 16.5
t = np.arange(int(LENGTH * RATE)) / RATE
rng = np.random.default_rng(23)


def smooth(a, b, x):
    u = np.clip((x - a) / (b - a), 0, 1)
    return u * u * (3 - 2 * u)


def lowpass(x, cutoff):
    """One pole forward and back, so nothing is shifted in time."""
    a = 1 - np.exp(-2 * np.pi * cutoff / RATE)
    out = np.zeros_like(x)
    for direction in (1, -1):
        y, v = np.zeros_like(x), 0.0
        for i, s in enumerate(x[::direction]):
            v += a * (s - v)
            y[i] = v
        x = y[::direction]
    return x


def stereo(mono, spread=0.0, delay=0.011):
    d = int(delay * RATE)
    return np.stack([mono, (1 - spread) * mono + spread * np.roll(mono, d)], axis=1)


# the bed: a sub drone with two slow, beating partials that opens up as the shots go by
level = 0.35 + 0.5 * smooth(0, HIT, t)
bed = sum(g * np.sin(2 * np.pi * f * t + 0.6 * np.sin(2 * np.pi * r * t)) for f, g, r in ((41.2, 0.55, 0.07), (41.5, 0.4, 0.05), (61.8, 0.22, 0.11), (82.6, 0.12, 0.09)))
bed = bed * level * smooth(0, 2.5, t) * (t < HIT)

# air: filtered noise, the room the thing hangs in
air = lowpass(rng.normal(0, 1, t.size), 900) * 0.5 * smooth(0, 4, t) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.09 * t) ** 2) * (t < HIT)

# metal: inharmonic struck partials, one on each cut, as the slit first catches something
metal = np.zeros_like(t)
for when, base in zip([0.9, *BEATS], (392.0, 293.7, 440.0, 261.6)):
    age = np.clip(t - when, 0, None)
    tone = sum(g * np.sin(2 * np.pi * base * r * age) * np.exp(-age / d) for r, g, d in ((1, 1, 2.6), (2.76, 0.45, 1.5), (5.4, 0.2, 0.7), (8.93, 0.08, 0.3)))
    metal += tone * (t >= when) * smooth(0, 0.004, age) * 0.11

# rotors: they wake from 12.6 s, in pitch and in level, and are cut off by the hit
wake = np.clip((t - 12.6) / (HIT - 12.6), 0, 1) ** 3.1
phase = 2 * np.pi * np.cumsum(30 + 620 * wake) / RATE
rotor = sum(g * np.sin(n * phase) for n, g in ((1, 1), (3, 0.5), (6, 0.22), (11, 0.1)))
rotor = rotor * smooth(12.6, 16.2, t) * 0.17 * (t < HIT)
wash = lowpass(rng.normal(0, 1, t.size), 3200) * smooth(13.5, 16.4, t) ** 2 * 0.24 * (t < HIT)

# the hit: a sub drop and a dark tail under the title; then a last, quiet ping as the name resolves
age = np.clip(t - HIT, 0, None)
hit = np.sin(2 * np.pi * (34 * age + 14 * (1 - np.exp(-age * 7)) / 7)) * np.exp(-age / 1.7) * (t >= HIT) * 0.95
tail = lowpass(rng.normal(0, 1, t.size), 420) * np.exp(-age / 1.5) * (t >= HIT) * 0.5
ping_age = np.clip(t - 17.4, 0, None)
ping = sum(g * np.sin(2 * np.pi * 587.3 * r * ping_age) * np.exp(-ping_age / d) for r, g, d in ((1, 1, 2.3), (2.76, 0.35, 1.2))) * (t >= 17.4) * 0.07

mix = stereo(bed + hit, 0.0) + stereo(air + tail, 0.7, 0.017) + stereo(metal + ping, 0.65, 0.023) + stereo(rotor + wash, 0.5, 0.008)
mix *= (1 - smooth(LENGTH - 0.8, LENGTH, t))[:, None]
mix = np.tanh(mix * 1.15)
mix *= 0.6 / np.abs(mix).max()

with wave.open(sys.argv[1], "wb") as out:
    out.setnchannels(2)
    out.setsampwidth(2)
    out.setframerate(RATE)
    out.writeframes((mix * 32767).astype(np.int16).tobytes())
print(f"{sys.argv[1]}: {LENGTH} s, peak {np.abs(mix).max():.2f}")
