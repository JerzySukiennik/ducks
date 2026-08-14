"""Find the tempo, the beat grid and the strongest section of a track.

Written for the intro cutscene: the cut has to start ON a beat and the animation
has to be able to land its hits on the same grid, so both the BPM and the phase
of the grid matter -- a correct tempo with the wrong phase still feels off.

Everything here is measured from the audio. Nothing is guessed.

Usage: python3 tools/analyse-track.py <file.mp3> [--want 30]
"""

import subprocess, sys, json
import numpy as np

SR = 22050


def decode(path):
    """Decode to mono float32 at SR through ffmpeg."""
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR),
         "-f", "f32le", "-"],
        capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype=np.float32)


def onset_envelope(x, hop=256, win=1024):
    """Spectral flux: how much the spectrum GREW frame to frame.

    Plain energy peaks on every loud moment including sustained notes; flux
    reacts to onsets, which is what a beat actually is.
    """
    n = 1 + (len(x) - win) // hop
    frames = np.lib.stride_tricks.as_strided(
        x, shape=(n, win), strides=(x.strides[0] * hop, x.strides[0]))
    w = np.hanning(win).astype(np.float32)
    mag = np.abs(np.fft.rfft(frames * w, axis=1))
    d = np.diff(mag, axis=0)
    flux = np.sum(np.maximum(d, 0.0), axis=1)
    # Remove the slow drift so a loud chorus does not outrank a crisp verse
    # purely by level.
    k = 41
    pad = np.pad(flux, (k // 2, k // 2), mode="edge")
    base = np.convolve(pad, np.ones(k) / k, mode="valid")[:len(flux)]
    env = np.maximum(flux - base, 0.0)
    return env / (env.max() + 1e-9), SR / hop


def tempo(env, fps, lo=70, hi=180):
    """Autocorrelation of the onset envelope, restricted to musical tempi."""
    e = env - env.mean()
    ac = np.correlate(e, e, mode="full")[len(e) - 1:]
    ac /= (ac[0] + 1e-9)
    best, best_v = None, -1
    for bpm100 in range(int(lo * 100), int(hi * 100) + 1, 25):
        bpm = bpm100 / 100.0
        lag = fps * 60.0 / bpm
        i = int(round(lag))
        if i <= 0 or i >= len(ac):
            continue
        # Reward a tempo whose HALF and DOUBLE also line up: that is what
        # separates the real pulse from a subdivision of it.
        v = ac[i]
        for m in (0.5, 2.0):
            j = int(round(lag * m))
            if 0 < j < len(ac):
                v += 0.5 * ac[j]
        if v > best_v:
            best_v, best = v, bpm
    return best, best_v


def phase(env, fps, bpm):
    """Where the grid sits. Try every offset within one beat, keep the best."""
    period = fps * 60.0 / bpm
    n = len(env)
    best_off, best_score = 0.0, -1
    for off in np.arange(0, period, 0.25):
        idx = np.arange(off, n - 1, period).astype(int)
        if len(idx) < 8:
            continue
        s = env[idx].sum() / len(idx)
        if s > best_score:
            best_score, best_off = s, off
    return best_off / fps, best_score


def sections(env, fps, want, step=1.0):
    """Rank every `want`-second window by mean onset strength and steadiness."""
    w = int(want * fps)
    hop = int(step * fps)
    out = []
    for start in range(0, max(1, len(env) - w), hop):
        seg = env[start:start + w]
        if len(seg) < w:
            break
        mean = float(seg.mean())
        # Penalise a window that is half silence: std/mean high means uneven.
        halves = np.array_split(seg, 6)
        even = float(min(h.mean() for h in halves) / (mean + 1e-9))
        out.append({
            "start": start / fps,
            "energy": mean,
            "evenness": even,
            "score": mean * (0.5 + 0.5 * even),
        })
    out.sort(key=lambda r: -r["score"])
    return out


def main():
    path = sys.argv[1]
    want = 30.0
    if "--want" in sys.argv:
        want = float(sys.argv[sys.argv.index("--want") + 1])
    x = decode(path)
    env, fps = onset_envelope(x)
    bpm, conf = tempo(env, fps)
    off, _ = phase(env, fps, bpm)
    beat = 60.0 / bpm
    best = sections(env, fps, want)[:6]
    # Snap each candidate start to the beat grid, and prefer a BAR line (4 beats)
    # so the cut starts where the music restarts, not mid-phrase.
    bar = beat * 4
    for r in best:
        k = round((r["start"] - off) / bar)
        r["snapped"] = max(0.0, off + k * bar)
    print(json.dumps({
        "duration": len(x) / SR,
        "bpm": round(bpm, 2),
        "confidence": round(float(conf), 3),
        "beatSeconds": round(beat, 4),
        "gridOffset": round(off, 3),
        "candidates": [
            {k: (round(v, 3) if isinstance(v, float) else v) for k, v in r.items()}
            for r in best
        ],
    }, indent=2))


if __name__ == "__main__":
    main()
