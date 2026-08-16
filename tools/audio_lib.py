"""Audio measurement and processing primitives for the Ducks SFX bank.

No scipy on this machine, so the two things that would normally come from it --
a K-weighting biquad pair and FFT-domain filtering -- are written out here. Both
are checked against an independent implementation rather than trusted:
`validate_kweighting()` compares this module's integrated loudness against
ffmpeg's own ebur128 filter on real files, and the check is part of the render
run rather than a thing done once and forgotten.

Everything works on float64 mono at an explicit sample rate. Nothing here reads
or writes mp3; `decode`/`encode` shell out to ffmpeg so the numbers are measured
on exactly the samples a browser would decode.
"""
import math
import os
import subprocess

import numpy as np

# --- codec i/o ---------------------------------------------------------------


def decode(path, rate=None, mono=True):
    """Decode to float64 at `rate` (native if None). Returns (samples, rate).

    float32 output from ffmpeg, NOT s16: an mp3 whose decoded waveform overshoots
    0 dBFS -- which ten files in this bank do -- would be silently clamped by an
    integer pipe, and the overshoot is precisely what has to be measured.
    """
    sr = rate or probe(path)['sample_rate']
    cmd = ['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le',
           '-ac', '1' if mono else '2', '-ar', str(sr), '-']
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype='<f4').astype(np.float64)
    if not mono:
        x = x.reshape(-1, 2)
    return x, sr


def probe(path):
    import json
    out = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries',
         'stream=sample_rate,channels,duration,bit_rate', '-of', 'json', path],
        capture_output=True, text=True, check=True).stdout
    s = json.loads(out)['streams'][0]
    s['sample_rate'] = int(s['sample_rate'])
    s['channels'] = int(s['channels'])
    return s


def encode(x, sr, path, bitrate=None, vbr=None, channels=1):
    """Write float64 samples to mp3 through ffmpeg."""
    if x.ndim == 2:
        channels = x.shape[1]
        data = x.astype('<f4').reshape(-1).tobytes()
    else:
        data = x.astype('<f4').tobytes()
    cmd = ['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(sr),
           '-ac', str(channels), '-i', '-', '-c:a', 'libmp3lame']
    if vbr is not None:
        cmd += ['-q:a', str(vbr)]
    else:
        cmd += ['-b:a', bitrate or '80k']
    cmd += [path]
    subprocess.run(cmd, input=data, capture_output=True, check=True)
    return os.path.getsize(path)


# --- levels ------------------------------------------------------------------


def db(v):
    v = float(v)
    return 20 * math.log10(v) if v > 1e-12 else -140.0


def peak_db(x):
    return db(np.max(np.abs(x))) if len(x) else -140.0


def rms_db(x):
    return db(math.sqrt(float(np.mean(x ** 2)))) if len(x) else -140.0


def biquad(x, b, a):
    """Direct form I, one channel. A python loop, because there is no scipy here
    and the whole bank is under three million samples."""
    y = np.empty_like(x)
    x1 = x2 = y1 = y2 = 0.0
    b0, b1, b2 = b
    a1, a2 = a[1], a[2]
    for i in range(len(x)):
        xi = x[i]
        yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        y[i] = yi
        x2, x1 = x1, xi
        y2, y1 = y1, yi
    return y


def kweight_coeffs(fs):
    """ITU-R BS.1770 K-weighting, derived for an arbitrary rate.

    The recommendation prints the two biquads as coefficients at 48 kHz only.
    These come from the analog prototypes behind them (the shelf and the
    high-pass) bilinear-transformed at `fs`, which reproduces the published
    48 kHz numbers exactly and generalises to 44.1 kHz -- the rate this bank is
    being rendered at. validate_kweighting() checks the result against ffmpeg.
    """
    # Stage 1: high-frequency shelf ("head effect").
    f0 = 1681.974450955533
    G = 3.999843853973347
    Q = 0.7071752369554196
    K = math.tan(math.pi * f0 / fs)
    Vh = 10.0 ** (G / 20.0)
    Vb = Vh ** 0.4996667741545416
    a0 = 1.0 + K / Q + K * K
    b_shelf = [(Vh + Vb * K / Q + K * K) / a0,
               2.0 * (K * K - Vh) / a0,
               (Vh - Vb * K / Q + K * K) / a0]
    a_shelf = [1.0, 2.0 * (K * K - 1.0) / a0, (1.0 - K / Q + K * K) / a0]

    # Stage 2: high-pass ("RLB").
    f0 = 38.13547087602444
    Q = 0.5003270373238773
    K = math.tan(math.pi * f0 / fs)
    den = 1.0 + K / Q + K * K
    b_hp = [1.0, -2.0, 1.0]
    a_hp = [1.0, 2.0 * (K * K - 1.0) / den, (1.0 - K / Q + K * K) / den]
    return (b_shelf, a_shelf), (b_hp, a_hp)


_KW_IR = {}


def kweight_ir(fs, n=32768):
    """The two K-weighting biquads collapsed into one impulse response.

    The direct form runs at about a million samples a second in pure python,
    and matching levels means measuring loudness a few hundred times over the
    whole bank. Both filters are stable IIRs whose combined response is under
    -140 dB long before 32768 samples at 44.1 kHz, so convolving with the
    truncated response is the same answer several dozen times faster.
    The returned tail figure records how much is actually left at the cut, and
    validate_kweighting() still compares the end result against ffmpeg.
    """
    key = (fs, n)
    if key in _KW_IR:
        return _KW_IR[key]
    (bs, as_), (bh, ah) = kweight_coeffs(fs)
    imp = np.zeros(n)
    imp[0] = 1.0
    ir = biquad(biquad(imp, bs, as_), bh, ah)
    tail = float(np.sqrt(np.sum(ir[-1024:] ** 2)))
    _KW_IR[key] = (ir, db(tail))
    return _KW_IR[key]


def kweight(x, fs):
    ir, _tail_db = kweight_ir(fs)
    n = len(x) + len(ir) - 1
    nfft = 1 << (n - 1).bit_length()
    y = np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(ir, nfft), nfft)
    return y[:len(x)]


def _block_mean_squares(y, fs, block_s, overlap):
    n = int(round(block_s * fs))
    if n <= 0 or len(y) < n:
        return np.array([]), n
    hop = max(1, int(round(n * (1.0 - overlap))))
    idx = range(0, len(y) - n + 1, hop)
    return np.array([float(np.mean(y[i:i + n] ** 2)) for i in idx]), n


def lufs_integrated(x, fs):
    """BS.1770-4 gated integrated loudness, mono (channel weight 1.0).

    Returns None when the clip is shorter than one 400 ms block -- which is true
    of nineteen files in this bank, and is exactly why level-matching one-shots
    is done on `lk_short` below instead of on this number.
    """
    y = kweight(x, fs)
    ms, n = _block_mean_squares(y, fs, 0.400, 0.75)
    if not len(ms):
        return None
    with np.errstate(divide='ignore'):
        loud = -0.691 + 10.0 * np.log10(np.maximum(ms, 1e-20))
    keep = loud > -70.0
    if not keep.any():
        return None
    rel = -0.691 + 10.0 * math.log10(float(np.mean(ms[keep]))) - 10.0
    keep2 = keep & (loud > rel)
    if not keep2.any():
        return None
    return -0.691 + 10.0 * math.log10(float(np.mean(ms[keep2])))


def lk_short(x, fs, window_s=0.100):
    """Loudest K-weighted `window_s` of the clip, in LKFS.

    The level-matching metric for this bank. Integrated LUFS is undefined below
    400 ms and misleading for a one-shot with a long quiet tail: `box_spill` is
    a 1.6 s clip whose event is over in 200 ms, and gating its whole length
    against silence says it is 30 dB quieter than it plays. What the ear matches
    across one-shots is the loudest moment, which is this.

    The bank is matched at window_s = 0.010, NOT at the 0.100 default here --
    see audio-bank.py LK_WINDOW for the measurement that settled the width. The
    default is left at 100 ms because that is the conventional short-term
    window and this function has other callers (the report table quotes both).
    """
    y = kweight(x, fs)
    n = int(round(window_s * fs))
    if len(y) < n:
        # Shorter than the window: measure what is there, scaled as if the rest
        # of the window were silence, which is what a listener actually gets.
        pad = np.zeros(n)
        pad[:len(y)] = y
        y = pad
    sq = y ** 2
    c = np.concatenate(([0.0], np.cumsum(sq)))
    win = (c[n:] - c[:-n]) / n
    return -0.691 + 10.0 * math.log10(max(float(win.max()), 1e-20))


def validate_kweighting(paths, tol=0.35):
    """Compare lufs_integrated() against ffmpeg's ebur128 on real files."""
    rows = []
    for p in paths:
        # Mono only. ffmpeg's ebur128 sums the channels of a stereo file at
        # unity per channel; this module measures one downmixed channel, so a
        # stereo file disagrees by construction (measured: 0.69 LU on
        # cutscene.mp3) and would be comparing two different quantities.
        if probe(p)['channels'] != 1:
            continue
        x, sr = decode(p)
        mine = lufs_integrated(x, sr)
        theirs = _ffmpeg_lufs(p)
        if mine is None or theirs is None:
            continue
        rows.append({'file': os.path.basename(p), 'mine': round(mine, 2),
                     'ffmpeg': round(theirs, 2), 'deltaLU': round(mine - theirs, 3)})
    worst = max((abs(r['deltaLU']) for r in rows), default=None)
    return {'rows': rows, 'maxAbsDeltaLU': worst, 'pass': worst is not None and worst <= tol}


def _ffmpeg_lufs(path):
    p = subprocess.run(['ffmpeg', '-v', 'info', '-i', path, '-af',
                        'ebur128=framelog=quiet', '-f', 'null', '-'],
                       capture_output=True, text=True)
    lines = p.stderr.splitlines()
    for i, ln in enumerate(lines):
        if 'Integrated loudness' in ln:
            for j in range(i + 1, min(i + 4, len(lines))):
                if ' I:' in lines[j]:
                    try:
                        return float(lines[j].split('I:')[1].replace('LUFS', '').strip())
                    except ValueError:
                        return None
    return None


# --- spectrum ----------------------------------------------------------------


def band_energy_db(x, fs, lo, hi):
    """Energy in [lo, hi) Hz, in dB relative to full-scale sine, whole clip."""
    n = len(x)
    if n < 256:
        return -140.0
    X = np.fft.rfft(x * np.hanning(n))
    f = np.fft.rfftfreq(n, 1.0 / fs)
    m = (f >= lo) & (f < hi)
    if not m.any():
        return -140.0
    e = float(np.sum(np.abs(X[m]) ** 2)) / (n * n)
    return 10 * math.log10(e) if e > 1e-30 else -140.0


def energy_above(x, fs, hz):
    return band_energy_db(x, fs, hz, fs / 2.0)


def spectral_ceiling(x, fs, frac=0.999):
    n = min(len(x), 1 << 17)
    if n < 1024:
        return None
    X = np.abs(np.fft.rfft(x[:n] * np.hanning(n))) ** 2
    tot = X.sum()
    if tot <= 0:
        return None
    c = np.cumsum(X) / tot
    return float(np.searchsorted(c, frac)) * fs / n


def fft_filter(x, fs, lo=None, hi=None):
    """Zero-phase brick-wall band selection. Used to build an excitation band,
    never on the signal that reaches the output on its own."""
    n = len(x)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1.0 / fs)
    m = np.ones(len(f))
    if lo is not None:
        m *= 1.0 / (1.0 + np.exp(-(f - lo) / max(1.0, lo * 0.06)))
    if hi is not None:
        m *= 1.0 / (1.0 + np.exp((f - hi) / max(1.0, hi * 0.06)))
    return np.fft.irfft(X * m, n)


def extend_top(x, fs, split=10500.0, top=19000.0, max_rel_db=-9.0, headroom_db=0.0):
    """Synthesise the octave above a 22.05 kHz source's ceiling from its own
    material, at the level the clip's own spectral slope predicts.

    Every clip in this bank was rendered at 22050 Hz, so there is nothing above
    11025 Hz -- not attenuated, absent. Resampling to 44.1 kHz does not change
    that, and shipping a 44.1 kHz file with an empty top octave would be a
    bigger file saying the same thing.

    What this does is generate the missing band rather than pretend to recover
    it: the 5.25-10.5 kHz band is passed through |v|*v, which folds it up an
    octave, the result is band-limited to `split`..`top`, and its level is set so
    the spectral density CONTINUES the slope measured across the two octaves
    below `split` -- capped at `max_rel_db` under the source band so a clip with
    a rising top end cannot be handed a bright artificial one. It is derived
    from the clip and from nothing else, so no new material enters the project.

    Returns (y, info).
    """
    if fs < 26000:
        return x, {'applied': False, 'reason': 'source rate too low to hold the band'}
    lo1, lo2 = split / 4.0, split / 2.0
    e_low = band_energy_db(x, fs, lo1, lo2)          # one octave below
    e_high = band_energy_db(x, fs, lo2, split)       # the octave under the split
    if e_high < -100:
        return x, {'applied': False, 'reason': 'no energy under the split'}
    slope = e_high - e_low                            # dB per octave (negative = rolling off)
    # One more octave of the same slope, and never brighter than the cap.
    want = min(e_high + slope, e_high + max_rel_db) + headroom_db
    exc = fft_filter(x, fs, lo=lo2 * 0.75, hi=split)
    # Normalised before the nonlinearity, because squaring is not scale-free:
    # a clip sitting 30 dB down produces an excitation 60 dB down, which the
    # floor test below then rejects as "nothing". machine_loop, the quietest
    # file in the bank at -44 dBFS RMS, was skipped for exactly that reason.
    # The level is set by `want` afterwards regardless, so normalising here
    # changes nothing except whether the band gets built at all.
    pk = float(np.max(np.abs(exc)))
    if pk > 1e-9:
        exc = exc / pk
    exc = exc * np.abs(exc)
    exc = fft_filter(exc, fs, lo=split, hi=top)
    have = band_energy_db(exc, fs, split, top)
    if have < -120:
        return x, {'applied': False, 'reason': 'excitation produced nothing'}
    g = 10 ** ((want - have) / 20.0)
    y = x + exc * g
    return y, {
        'applied': True,
        'slopeDbPerOctave': round(slope, 2),
        'sourceBandDb': round(e_high, 2),
        'addedBandDb': round(want, 2),
        'relativeDb': round(want - e_high, 2),
        'gain': round(g, 5),
    }


# --- dynamics ----------------------------------------------------------------


def limit_peak(x, fs, ceiling_db=-1.0, lookahead_ms=1.5, release_ms=60.0):
    """Lookahead peak limiter. Holds the ceiling without simply turning the clip
    down, so a level match survives a single transient.

    Gain reduction is computed on a forward-looking sliding maximum, then
    smoothed with a one-pole release, then applied. No oversampling: the ceiling
    is verified after mp3 encoding by decoding the file again, which catches
    inter-sample overshoot where an oversampled estimate would only predict it.
    """
    ceil = 10 ** (ceiling_db / 20.0)
    a = np.abs(x)
    if not len(a) or a.max() <= ceil:
        return x, 0.0
    w = max(1, int(round(lookahead_ms * 1e-3 * fs)))
    # Forward sliding maximum over `w` samples, as a max of shifts.
    m = a.copy()
    for k in range(1, w):
        m[:-k] = np.maximum(m[:-k], a[k:])
    want = np.minimum(1.0, ceil / np.maximum(m, 1e-12))
    # One-pole release so gain recovers smoothly; attack is instant (lookahead
    # is what makes that inaudible).
    coef = math.exp(-1.0 / max(1.0, release_ms * 1e-3 * fs))
    g = np.empty_like(want)
    cur = 1.0
    for i in range(len(want)):
        t = want[i]
        cur = t if t < cur else t + (cur - t) * coef
        g[i] = cur
    y = x * g
    return y, round(db(float(g.min())), 2)


def _smooth(x, fs, tau_ms):
    """One-pole smoothing as an FFT convolution with the exponential kernel.

    A sample-by-sample one-pole is a python loop, and the level match calls this
    a few thousand times across the bank. Same filter, done in the frequency
    domain, at a few hundred times the speed.
    """
    tau = max(1e-4, tau_ms * 1e-3) * fs
    n = int(min(len(x), max(16, tau * 8)))
    k = np.exp(-np.arange(n) / tau)
    k /= k.sum()
    nf = 1 << (len(x) + n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, nf) * np.fft.rfft(k, nf), nf)[:len(x)]


def dc_trim(x):
    return x - float(np.mean(x)) if len(x) else x


def trim_silence(x, fs, floor_db=-62.0, keep_head_ms=3.0, keep_tail_ms=25.0):
    """Strip dead air off both ends, keeping a little on each side.

    Half of what a 56 kbps 22 kHz one-shot costs is codec lead-in and a tail
    that has already fallen below hearing. Bytes, and a tighter response to the
    button that fired it.
    """
    thr = 10 ** (floor_db / 20.0)
    nz = np.nonzero(np.abs(x) > thr)[0]
    if not len(nz):
        return x, (0, 0)
    a = max(0, int(nz[0]) - int(keep_head_ms * 1e-3 * fs))
    b = min(len(x), int(nz[-1]) + 1 + int(keep_tail_ms * 1e-3 * fs))
    return x[a:b], (a, len(x) - b)


def fade_edges(x, fs, in_ms=1.5, out_ms=8.0):
    """Cosine ramps at both ends, so a trimmed one-shot starts and ends on
    silence rather than on a step."""
    y = x.copy()
    n_in = min(len(y), int(in_ms * 1e-3 * fs))
    n_out = min(len(y), int(out_ms * 1e-3 * fs))
    if n_in > 1:
        y[:n_in] *= 0.5 - 0.5 * np.cos(np.linspace(0, math.pi, n_in))
    if n_out > 1:
        y[-n_out:] *= 0.5 + 0.5 * np.cos(np.linspace(0, math.pi, n_out))
    return y


# --- loops -------------------------------------------------------------------


def nearest_zero_crossing(x, i, radius):
    """Index of the rising-or-falling zero crossing closest to `i`."""
    lo = max(1, i - radius)
    hi = min(len(x) - 1, i + radius)
    best, bestd = i, radius + 1
    for j in range(lo, hi):
        if (x[j - 1] <= 0.0 < x[j]) or (x[j - 1] >= 0.0 > x[j]):
            d = abs(j - i)
            if d < bestd:
                best, bestd = j, d
    return best


def seam_report(body, fs, win_ms=(5.0, 20.0, 60.0)):
    """What a loop does at the splice, three ways.

    sampleStep is the instantaneous jump the buffer makes when it wraps -- the
    click. levelStep is the RMS of the last window against the first, measured
    at three widths because a splice between two takes shows up wide and a bad
    zero crossing shows up narrow, and one window size hides one of them.
    """
    step = float(abs(body[0] - body[-1]))
    d = np.abs(np.diff(body))
    typical = float(np.sqrt(np.mean(d ** 2))) if len(d) else 0.0
    out = {
        'sampleStep': round(step, 6),
        'sampleStepDb': round(db(step), 2),
        # The step the wrap makes, against the step this material makes between
        # ANY two neighbouring samples. This is the number that says whether the
        # seam is a discontinuity or just a steep piece of waveform: a raw step
        # in dBFS gets bigger when a clip is turned up, and says nothing on its
        # own. At or under 1 the wrap is indistinguishable from the material.
        'stepVsTypical': round(step / typical, 3) if typical > 1e-12 else None,
        'firstSample': round(float(body[0]), 6),
        'lastSample': round(float(body[-1]), 6),
    }
    for w_ms in win_ms:
        w = max(8, int(fs * w_ms / 1000))
        if len(body) < 2 * w:
            continue
        h = rms_db(body[:w])
        t = rms_db(body[-w:])
        out['levelStepDb@%gms' % w_ms] = round(h - t, 2)
    steps = [abs(v) for k, v in out.items() if k.startswith('levelStepDb')]
    out['worstLevelStepDb'] = round(max(steps), 2) if steps else None
    return out


def make_seamless(x, fs, xfade_ms=120.0, zc_radius_ms=8.0):
    """Turn a hard-cut region into a body that wraps onto itself continuously.

    The tail is crossfaded (equal power) onto the head, which is the only way to
    remove a splice without material from outside the clip, and the result is
    then trimmed to the zero crossing nearest the join so the wrap does not step
    even by one sample. The body gets SHORTER by the crossfade length; that is
    the cost and it is paid once.
    """
    n = len(x)
    xf = min(int(xfade_ms * 1e-3 * fs), n // 3)
    if xf < 8:
        return x, {'crossfadeSamples': 0}
    body_len = n - xf
    y = x[:body_len].copy()
    t = np.linspace(0.0, 1.0, xf)
    fade_in = np.sqrt(t)
    fade_out = np.sqrt(1.0 - t)
    y[:xf] = x[:xf] * fade_in + x[body_len:body_len + xf] * fade_out
    # The crossfade has made this body wrap onto itself continuously, which means
    # every ROTATION of it does too: rotating moves the wrap to what was an
    # interior sample pair, and consecutive samples cannot step. So the wrap
    # point is now free, and it is worth spending: pick the rotation whose join
    # both crosses zero and sits where the clip's own envelope is flat, so the
    # seam measures clean at every window width rather than only at the sample.
    z, score = best_wrap_point(y, fs)
    if z:
        y = np.concatenate([y[z:], y[:z]])
    return y, {'crossfadeSamples': xf, 'rotatedSamples': int(z),
               'crossfadeMs': round(xf * 1000.0 / fs, 1),
               'wrapScoreDb': round(score, 3)}


def best_wrap_point(y, fs, windows=(5.0, 20.0, 60.0), stride_ms=0.5):
    """Rotation index whose wrap has the flattest envelope, among zero crossings.

    Score is the worst |head - tail| RMS step across `windows`, so a candidate
    that looks clean at 5 ms and steps 3 dB at 20 ms loses to one that is even
    at all three.
    """
    n = len(y)
    ws = [max(8, int(fs * w / 1000)) for w in windows]
    if n < 4 * max(ws):
        return 0, 0.0
    stride = max(1, int(fs * stride_ms / 1000))
    # Frame energies, so each candidate is a couple of array lookups.
    cs = np.concatenate(([0.0], np.cumsum(y ** 2)))

    def win_rms(i, w):
        # RMS of w samples starting at i, wrapping.
        if i + w <= n:
            s = cs[i + w] - cs[i]
        else:
            s = (cs[n] - cs[i]) + (cs[i + w - n] - cs[0])
        return math.sqrt(max(s, 0.0) / w)

    # The typical step this material makes between neighbouring samples. A wrap
    # is only a discontinuity if it steps FURTHER than that, so the score is in
    # units of it rather than in dBFS -- a raw dBFS step grows when the clip is
    # turned up and would rank a loud loop worse than a quiet one for nothing.
    typical = float(np.sqrt(np.mean(np.diff(y) ** 2))) or 1e-12

    best, best_score = 0, float('inf')
    for i in range(1, n - 1, stride):
        if not ((y[i - 1] <= 0.0 < y[i]) or (y[i - 1] >= 0.0 > y[i])):
            j = nearest_zero_crossing(y, i, stride)
            if j <= 0 or j >= n - 1:
                continue
            i = j
        worst = 0.0
        for w in ws:
            head = win_rms(i, w)
            tail = win_rms((i - w) % n, w)
            worst = max(worst, abs(db(head) - db(tail)))
        # Envelope flatness in dB, plus whatever the join steps beyond the
        # material's own sample-to-sample motion.
        score = worst + max(0.0, abs(y[i] - y[i - 1]) / typical - 1.0)
        if score < best_score:
            best, best_score = i, score
    return best, best_score


def pad_guard(body, fs, guard_s):
    """Wrap `guard_s` of the body around both ends.

    The padded signal is EXACTLY periodic with period len(body) across its whole
    length, which is the property that makes the loop survive a decoder. Browser
    mp3 decoders disagree about encoder delay -- Safari has historically handed
    back about 1100 samples of leading silence that Chrome strips -- so a loop
    whose seam sits at the file's own edges is at the decoder's mercy. With the
    seam in the interior and loopStart/loopEnd set in SECONDS, any decoder
    offset up to the guard shifts both points together and the window is still
    exactly one period, which is still seamless.
    """
    g = int(round(guard_s * fs))
    g = min(g, len(body))
    out = np.concatenate([body[-g:], body, body[:g]])
    return out, g
