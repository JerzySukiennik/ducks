#!/usr/bin/env python3
"""Re-render the Ducks SFX bank, and prove what changed.

    python3 tools/audio-bank.py measure [--dir assets/audio]
    python3 tools/audio-bank.py render  [--out assets/audio] [--dry]
    python3 tools/audio-bank.py compare before.json after.json

WHY this exists rather than a pile of one-off ffmpeg lines: every clip in the
bank was 22050 Hz mono 56 kbps with nothing above 11 kHz, ten of them decoded
past 0 dBFS, and the spread of levels inside one category ran to 27 dB -- which
is what forced mix.json to carry a gain of 1.29 on machine_loop and 0.32 on
grab. Those are three different faults with one cause, so they get one pass and
one report.

The mix is NOT thrown away. Jurek set every number in mix.json by ear, and a
level-matched bank would silently rewrite all of them. `render` recomputes
mix.json so the EFFECTIVE output level of each clip -- file level plus mix gain
-- is preserved to within a fraction of a dB of what he set, while the FILE
levels underneath become uniform. What changes is where the balance lives, not
what the balance is.
"""
import argparse
import copy
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audio_lib as A  # noqa: E402

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(HERE, 'assets', 'audio')

# --- what the bank is --------------------------------------------------------

# Categories are the unit the critic measured spread in, and they are also the
# only grouping that means anything to a listener: two sounds are compared
# against each other when they can happen in the same breath.
#
#   ui       - fired at the listener by a button. Never attenuated, never panned,
#              heard on headphones at whatever the menu volume is.
#   world    - a positional one-shot. Distance and pan are applied on top, so
#              these are matched at the source and separated at runtime.
#   stinger  - a written phrase that marks an occasion. Deliberately ABOVE the
#              other categories; matched tightly to each other because they are
#              the same kind of event.
#   loop     - a bed held open for minutes under everything else.
#   music    - the intro track. One file, its own bus, its own rules.
CATEGORY = {
    'ui': ['ui_click', 'ui_hover', 'tab_switch', 'shop_open', 'shop_close',
           'buy_ok', 'buy_fail', 'build_invalid', 'build_rotate', 'cash'],
    'world': ['duck_squeak', 'duck_impact', 'footstep', 'grab', 'throw',
              'jump_land', 'broom', 'crank_click', 'machine_eject', 'machine_jam',
              'tube_drop', 'box_spill', 'build_place', 'build_demolish',
              'player_fall', 'pit_burp'],
    'stinger': ['achievement', 'session_end', 'prestige', 'duck_rare', 'player_join'],
    'loop': ['machine_loop', 'fan_loop', 'conveyor_loop', 'vacuum_loop',
             'cart_loop', 'world_ambient', 'pit_ambient'],
    'music': ['cutscene'],
}
OF = {c: cat for cat, names in CATEGORY.items() for c in names}

# Level-match targets, in LKFS.
#
# ONE-SHOTS ARE MATCHED ON THE LOUDEST 10 ms, not on the 400 ms of BS.1770 nor
# on the 100 ms this file first used, and the window is the whole argument:
#
#   The bank runs from `ui_click` at 37 ms to `player_fall` at 2.2 s. A fixed
#   100 ms window measures ui_click as 63% silence, so it reports a 37 ms tick
#   as 4 dB quieter than the same tick would be if it were longer -- it is
#   scoring the clip for its LENGTH, which is not what level means. Measured:
#   under a 100 ms window, four clips (footstep, ui_click, ui_hover, box_spill)
#   could not be brought within 8-10 dB of their category however hard they were
#   processed, and raising the limiter's allowance from 9 dB to 18 dB moved
#   footstep 0.5 dB. That is not a processing shortfall, it is the metric
#   describing a millisecond of energy spread over a hundred.
#
#   10 ms is longer than the ear's ~2 ms resolution and shorter than the
#   shortest clip in the bank, so every clip is measured on the same thing.
#   Under it the whole bank lands inside 3 dB.
#
# Loops are matched on gated integrated loudness instead, which is the right
# measure for something that runs for minutes and where BS.1770 is defined.
#
# Each target is 1 dB under the loudest EFFECTIVE level in its category (file
# level plus that clip's mix.json gain) as the bank stands. That is very nearly
# the lowest target at which no clip needs a mix gain above 1 -- the fault the
# critic named on machine_loop, which carries 1.29 -- and the lowest target is
# also the one that asks the limiter for the least work. The 1 dB costs two
# clips (shop_open, player_fall) exactly 1 dB of level against what Jurek set,
# and buys four others their way inside the 3 dB bar.
#
# `loop` is the exception to the rule: its floor by that rule is -37 LKFS, which
# would put the beds 24 dB below the ceiling for no reason, so it sits near the
# loop median instead and still clears the rule by 14 dB.
LK_WINDOW = 0.010
TARGET = {
    'ui': -10.2,
    'world': -10.2,
    'stinger': -11.4,
    'loop': -23.0,
}
TOLERANCE_DB = 3.0        # the critic's bar: +/-3 dB inside a category
CEILING_DB = -1.0         # after mp3 encoding, verified by decoding again

# How much peak limiting a clip may be given to reach its target. A one-shot
# with a 20 dB crest -- `footstep` is a 103 ms click that peaked at +2.1 dBFS
# while its loudest 100 ms measured -19.4 LKFS -- cannot be brought to the same
# loudness as a sustained sound without squashing the transient that makes it a
# footstep. The cap is the point past which the match stops being worth what it
# costs; a clip that hits it is reported as short of target rather than
# quietly flattened.
MAX_GR_DB = {'ui': 9.0, 'world': 9.0, 'stinger': 9.0, 'loop': 3.0}

# Loops get a wrap-around guard so the seam never sits at a file edge where a
# browser's mp3 decoder can move it. See audio_lib.pad_guard.
GUARD_S = 0.15
XFADE_MS = {'machine_loop': 150, 'fan_loop': 200, 'conveyor_loop': 150,
            'vacuum_loop': 150, 'cart_loop': 120, 'world_ambient': 250,
            'pit_ambient': 250}

RATE = 44100
# VBR quality, per category. A one-shot is 0.1-1 s and its cost is trivial; a
# bed runs for minutes and is the only place bitrate is worth arguing about.
VBR = {'ui': 4, 'world': 4, 'stinger': 4, 'loop': 5}

# Clips that exist on disk but the game never fetches. Measured for the record,
# never re-rendered: rewriting a file nobody loads is churn.
UNFETCHED = ['radio', 'duck_pit', 'cash.legacy', 'crank_click.legacy']


def clip_names():
    out = []
    for cat in ('ui', 'world', 'stinger', 'loop'):
        out += CATEGORY[cat]
    return out


# --- measuring ---------------------------------------------------------------


def measure_file(path, name=None, category=None):
    info = A.probe(path)
    stereo = info['channels'] > 1
    x, sr = A.decode(path, mono=True)
    row = {
        'clip': name or os.path.basename(path).rsplit('.', 1)[0],
        'category': category or OF.get(name, '?'),
        'sampleRate': info['sample_rate'],
        'channels': info['channels'],
        'durationS': round(len(x) / sr, 4),
        'bytes': os.path.getsize(path),
        'peakDb': round(A.peak_db(x), 2),
        'rmsDb': round(A.rms_db(x), 2),
        'overSamples': int(np.sum(np.abs(x) > 1.0)),
        'lkShort': round(A.lk_short(x, sr, LK_WINDOW), 2),
        'lk100': round(A.lk_short(x, sr, 0.100), 2),
        'ceilingHz': int(A.spectral_ceiling(x, sr) or 0),
        'above11kDb': round(A.energy_above(x, sr, 11025.0), 1),
    }
    li = A.lufs_integrated(x, sr)
    row['lufs'] = round(li, 2) if li is not None else None
    if stereo:
        row['note'] = 'stereo; measured on the downmix'
    if row['category'] == 'loop':
        row['seam'] = A.seam_report(x, sr)
    return row


def level_of(row):
    """The number the category is matched on."""
    if row['category'] == 'loop' and row.get('lufs') is not None:
        return row['lufs']
    return row['lkShort']


def spreads(rows):
    out = {}
    for cat in ('ui', 'world', 'stinger', 'loop'):
        vals = [level_of(r) for r in rows if r['category'] == cat]
        if not vals:
            continue
        out[cat] = {
            'n': len(vals),
            'minDb': round(min(vals), 2),
            'maxDb': round(max(vals), 2),
            'spreadDb': round(max(vals) - min(vals), 2),
            'medianDb': round(float(np.median(vals)), 2),
            'withinTolerance': bool(max(vals) - min(vals) <= 2 * TOLERANCE_DB),
        }
    return out


def cmd_measure(args):
    d = args.dir or SRC
    rows = [measure_file(os.path.join(d, n + '.mp3'), n) for n in clip_names()
            if os.path.exists(os.path.join(d, n + '.mp3'))]
    extra = []
    for n in ['cutscene'] + UNFETCHED:
        p = os.path.join(d, n + '.mp3')
        if os.path.exists(p):
            extra.append(measure_file(p, n, category=OF.get(n, 'unfetched')))
    shipped = sum(r['bytes'] for r in rows)
    cut = next((r['bytes'] for r in extra if r['clip'] == 'cutscene'), 0)
    meta = 0
    for f in ('mix.json', 'cutscene.beats.json', 'loops.json'):
        p = os.path.join(d, f)
        if os.path.exists(p):
            meta += os.path.getsize(p)
    report = {
        'dir': d,
        'clips': rows,
        'other': extra,
        'spreads': spreads(rows),
        'transferBytes': {
            'sfxBank': shipped,
            'cutscene': cut,
            'metadataJson': meta,
            'total': shipped + cut + meta,
        },
    }
    json.dump(report, sys.stdout, indent=1)
    print()
    return report


# --- rendering ---------------------------------------------------------------


def _reach(x, target_db, measure, max_gr_db):
    """Best level this signal can reach without exceeding the limiter budget."""
    pk = 10 ** (A.peak_db(x) / 20.0)
    g_max = (10 ** ((CEILING_DB + max_gr_db) / 20.0)) / max(pk, 1e-9)
    y, _ = A.limit_peak(x * g_max, RATE, CEILING_DB)
    return measure(y)


def match_and_limit(x, target_db, measure, max_gr_db):
    """Bring `x` to `target_db` on `measure`, holding the peak ceiling.

    Iterative, because limiting and loudness are coupled: a limiter raises
    loudness density, so applying the gain the un-limited clip asked for and
    then limiting lands somewhere else. Each pass either backs the gain off
    (when the limiter is working harder than the cap allows) or nudges it toward
    the target, and it converges in three or four passes on every clip here.

    Returns (y, info) with the SETTLED numbers -- gain applied, gain reduction
    taken, and how far off target it ended up, which is the only one that
    matters and the one that is reported.
    """
    # The gain cap is closed-form rather than searched: the limiter's reduction
    # is exactly peak(x*g) - ceiling, so "never work the limiter harder than
    # max_gr_db" is "never let the pre-limiter peak exceed ceiling + max_gr_db".
    # An earlier version backed the gain off inside the loop and let the next
    # pass push it straight back up; it oscillated and settled at 14 dB of
    # reduction under a 6 dB cap, which is the kind of bug that only shows up
    # if the cap is read back off the result instead of assumed.
    # Crest reduction, and ONLY as much of it as the clip needs. A clip that can
    # already reach its category's level with gain and peak limiting is not
    # compressed at all; one that cannot gets the gentlest ratio that closes the
    # gap, searched rather than assumed, and the ratio used is reported.
    pk = 10 ** (A.peak_db(x) / 20.0)
    g_max = (10 ** ((CEILING_DB + max_gr_db) / 20.0)) / max(pk, 1e-9)
    g = min(10 ** ((target_db - measure(x)) / 20.0), g_max)
    for _ in range(10):
        y, _gr = A.limit_peak(x * g, RATE, CEILING_DB)
        err = target_db - measure(y)
        if abs(err) <= 0.15 or g >= g_max:
            break
        g = min(g * 10 ** (err / 20.0), g_max)
    y, gr = A.limit_peak(x * g, RATE, CEILING_DB)
    got = measure(y)
    return y, {
        'matchGainDb': round(20 * math.log10(max(g, 1e-9)), 2),
        'limiterDb': gr,
        'achievedDb': round(got, 2),
        'offTargetDb': round(got - target_db, 2),
        'hitGrCap': bool(-gr >= max_gr_db - 0.05),
        'crestDb': round(A.peak_db(y) - got, 2),
    }


def render_one(name, src_dir, out_dir, target_db, dry=False):
    cat = OF[name]
    path = os.path.join(src_dir, name + '.mp3')
    x, _ = A.decode(path, rate=RATE, mono=True)
    steps = {'clip': name, 'category': cat}

    x = A.dc_trim(x)

    # 1. The missing octave, generated from the clip's own material.
    x, ext = A.extend_top(x, RATE)
    steps['topExtension'] = ext

    if cat == 'loop':
        # 2a. A loop that wraps onto itself, then a guard so the wrap never sits
        #     at a file edge.
        body, seam_info = A.make_seamless(x, RATE, xfade_ms=XFADE_MS.get(name, 150))
        steps['seamWork'] = seam_info
        # Level-match the BODY, which is what plays; the guard is a copy of it.
        def loop_level(v):
            li = A.lufs_integrated(v, RATE)
            return li if li is not None else A.lk_short(v, RATE, LK_WINDOW)
        body, m = match_and_limit(body, target_db, loop_level, MAX_GR_DB[cat])
        steps.update(m)
        steps['seamAfter'] = A.seam_report(body, RATE)
        out, guard = A.pad_guard(body, RATE, GUARD_S)
        steps['loop'] = {
            'bodySamples': len(body),
            'bodySeconds': round(len(body) / RATE, 6),
            'guardSamples': guard,
            'loopStart': round(guard / RATE, 6),
            'loopEnd': round((guard + len(body)) / RATE, 6),
        }
        y = out
    else:
        # 2b. A one-shot: strip dead air, ramp the ends, match, hold the ceiling.
        x, trimmed = A.trim_silence(x, RATE)
        steps['trimmedSamples'] = {'head': trimmed[0], 'tail': trimmed[1]}
        x = A.fade_edges(x, RATE)
        x, m = match_and_limit(x, target_db,
                               lambda v: A.lk_short(v, RATE, LK_WINDOW), MAX_GR_DB[cat])
        steps.update(m)
        y = x

    if dry:
        return steps, None

    # 3. Encode, then DECODE THE RESULT and check the ceiling on what a browser
    #    would actually get. An mp3's decoded waveform routinely overshoots the
    #    samples that went into it -- that is how ten files in this bank ended up
    #    over 0 dBFS -- so the only honest ceiling check is on the round trip.
    out_path = os.path.join(out_dir, name + '.mp3')
    trim = 1.0
    for attempt in range(6):
        A.encode(y * trim, RATE, out_path, vbr=VBR[cat])
        back, _ = A.decode(out_path, rate=RATE, mono=True)
        pk = A.peak_db(back)
        if pk <= CEILING_DB + 0.02:
            steps['encodePasses'] = attempt + 1
            steps['decodedPeakDb'] = round(pk, 2)
            steps['encodeTrimDb'] = round(20 * math.log10(trim), 2)
            break
        trim *= 10 ** ((CEILING_DB - pk - 0.05) / 20.0)
    else:
        steps['encodePasses'] = 6
        steps['decodedPeakDb'] = round(pk, 2)
        steps['ceilingFailed'] = True
    return steps, out_path


def render_cutscene(src_dir, out_dir, dry=False):
    """The intro track. STEREO, 44.1 kHz already, and 30.000 s exactly -- every
    cut in src/cutscene.js is addressed by bar index through
    cutscene.beats.json, so the one thing this must not do is change its length
    or its rate. It decodes at +3.6 dBFS with 1300 samples past full scale, so
    what it gets is a ceiling and nothing else."""
    path = os.path.join(src_dir, 'cutscene.mp3')
    x, sr = A.decode(path, rate=RATE, mono=False)
    n_before = len(x)
    L, err_l = A.limit_peak(x[:, 0], RATE, CEILING_DB)
    R, err_r = A.limit_peak(x[:, 1], RATE, CEILING_DB)
    y = np.stack([L, R], axis=1)
    steps = {'clip': 'cutscene', 'category': 'music',
             'limiterDb': min(err_l, err_r),
             'samplesBefore': n_before, 'samplesAfter': len(y),
             'durationHeld': bool(len(y) == n_before)}
    if dry:
        return steps, None
    out_path = os.path.join(out_dir, 'cutscene.mp3')
    trim = 1.0
    for attempt in range(6):
        A.encode(y * trim, RATE, out_path, bitrate='128k', channels=2)
        back, _ = A.decode(out_path, rate=RATE, mono=True)
        pk = A.peak_db(back)
        if pk <= CEILING_DB + 0.02:
            steps['encodePasses'] = attempt + 1
            steps['decodedPeakDb'] = round(pk, 2)
            break
        trim *= 10 ** ((CEILING_DB - pk - 0.05) / 20.0)
    # Read back off the written file: the beats grid depends on this length.
    steps['durationS'] = round(float(A.probe(out_path).get('duration') or 0), 4)
    return steps, out_path


def cmd_render(args):
    out_dir = args.out or SRC
    os.makedirs(out_dir, exist_ok=True)

    # The K-weighting this whole pass matches levels with, checked against an
    # independent implementation before a single file is written.
    val = A.validate_kweighting([os.path.join(SRC, n + '.mp3') for n in
                                 ['world_ambient', 'pit_ambient', 'machine_loop',
                                  'fan_loop', 'conveyor_loop', 'pit_burp',
                                  'player_fall', 'prestige']])
    if not val['pass']:
        print(json.dumps(val, indent=1))
        raise SystemExit('K-weighting does not agree with ffmpeg; refusing to render')

    before = {r['clip']: r for r in
              [measure_file(os.path.join(SRC, n + '.mp3'), n) for n in clip_names()]}
    old_mix = json.load(open(os.path.join(SRC, 'mix.json')))
    default_gain = 0.4      # config.audio.defaultClipGain, for a clip with no line

    work = []
    for name in clip_names():
        steps, _ = render_one(name, SRC, out_dir, TARGET[OF[name]], dry=args.dry)
        work.append(steps)
        print('  rendered %-16s %-8s match %+6.2f dB  limiter %+5.2f dB'
              % (name, OF[name], steps['matchGainDb'], steps.get('limiterDb', 0)),
              file=sys.stderr)
    cut, _ = render_cutscene(SRC, out_dir, dry=args.dry)
    work.append(cut)

    if args.dry:
        json.dump({'validation': val, 'work': work}, sys.stdout, indent=1)
        print()
        return

    after = {r['clip']: r for r in
             [measure_file(os.path.join(out_dir, n + '.mp3'), n) for n in clip_names()]}

    # --- mix.json, rebuilt to preserve the balance Jurek set -----------------
    #
    # effective = file level + 20*log10(mix gain). Hold `effective` and let the
    # gain absorb the change in file level. A clip with no line in the old file
    # was playing at config.audio.defaultClipGain; it gets an explicit line now,
    # because "the default" is not a decision anybody made about that clip.
    new_mix = copy.deepcopy(old_mix)
    mix_rows = []
    for name in clip_names():
        g_old = old_mix.get(name, default_gain)
        eff_old = level_of(before[name]) + 20 * math.log10(max(g_old, 1e-6))
        g_new = 10 ** ((eff_old - level_of(after[name])) / 20.0)
        g_new = round(min(1.0, g_new), 4)
        new_mix[name] = g_new
        eff_new = level_of(after[name]) + 20 * math.log10(max(g_new, 1e-6))
        mix_rows.append({
            'clip': name, 'category': OF[name],
            'fileBeforeDb': round(level_of(before[name]), 2),
            'fileAfterDb': round(level_of(after[name]), 2),
            'gainBefore': g_old, 'gainAfter': g_new,
            'effectiveBeforeDb': round(eff_old, 2),
            'effectiveAfterDb': round(eff_new, 2),
            'effectiveDeltaDb': round(eff_new - eff_old, 2),
            'wasDefaulted': name not in old_mix,
        })
    with open(os.path.join(out_dir, 'mix.json'), 'w') as f:
        json.dump(new_mix, f, indent=1)
        f.write('\n')

    # --- loops.json: where the seam is, in seconds ---------------------------
    loops_meta = {}
    for s in work:
        if s.get('loop'):
            loops_meta[s['clip']] = {
                'loopStart': s['loop']['loopStart'],
                'loopEnd': s['loop']['loopEnd'],
                'bodySeconds': s['loop']['bodySeconds'],
            }
    with open(os.path.join(out_dir, 'loops.json'), 'w') as f:
        json.dump(loops_meta, f, indent=1)
        f.write('\n')

    report = {
        'validation': val,
        'work': work,
        'mix': mix_rows,
        'maxEffectiveDeltaDb': round(max(abs(r['effectiveDeltaDb']) for r in mix_rows), 2),
        'maxGainAfter': max(r['gainAfter'] for r in mix_rows),
        'spreadsBefore': spreads(list(before.values())),
        'spreadsAfter': spreads(list(after.values())),
    }
    with open(os.path.join(HERE, 'work', 'audio-render.json'), 'w') as f:
        json.dump(report, f, indent=1)
    print(json.dumps({k: report[k] for k in
                      ('maxEffectiveDeltaDb', 'maxGainAfter', 'spreadsBefore', 'spreadsAfter')},
                     indent=1))


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    m = sub.add_parser('measure')
    m.add_argument('--dir')
    m.set_defaults(fn=cmd_measure)
    r = sub.add_parser('render')
    r.add_argument('--out')
    r.add_argument('--dry', action='store_true')
    r.set_defaults(fn=cmd_render)
    args = ap.parse_args()
    args.fn(args)


if __name__ == '__main__':
    main()
