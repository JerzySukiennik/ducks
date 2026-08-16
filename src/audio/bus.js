// One bus. Every sound in the game goes through this file and through the gains
// in assets/audio/mix.json, which were set by ear, clip by clip, and are read
// here rather than restated anywhere in code.
//
// Two rules this module exists to enforce:
//
//   1. A missing, slow or undecodable clip is a NO-OP, never an exception.
//      Audio hangs off the frame loop; a throw in here would freeze the game,
//      and a silent game is an acceptable failure mode where a frozen one is
//      not. Every public function is guarded and returns null on failure.
//   2. Browsers refuse to start an AudioContext before a user gesture. The
//      context is created suspended, resume() is attached to the first real
//      interaction, and until then play() records the request and returns null
//      without warning. Nothing in the game may wait on it.

import { fetchWithTimeout, loadJSON } from '../core/assets.js';

const CTOR = (typeof window !== 'undefined')
  ? (window.AudioContext || window.webkitAudioContext || null)
  : null;

// The ship list: every clip the game FETCHES, exactly once, and src/audio/wire.js
// maps every one of these to a game event. The two lists are cross-checked at
// boot (debugAudioCoverage), which is gate F-D.
//
// Not on this list on purpose: `duck_pit`. The pit payoff is synthesized in
// src/audio/pitsynth.js so its pitch can climb with the run; duck_pit.mp3 is
// left on disk, unfetched and unreferenced. Its mix.json gain is still read --
// that number was set by ear and it is still the level of the pit sound.
// Same for cash.legacy.mp3 and crank_click.legacy.mp3: the previous samples,
// kept, superseded by the ones Jurek supplied.
//
// Not on this list either, and this one is a SIZE decision: `radio`. It is
// 826 KB -- 36% of everything the page downloads -- 103 seconds long, and it was
// fetched and decoded on every single load while wire.js held it permanently
// off ("remove the background song totally"). A disabled loop that still costs
// a third of the download is the worst of both: the player waits for it and
// never hears it. The clip stays on disk and putting the string back on this
// list plus the setAmbient line in wire.js is the whole of bringing it back.
export const CLIPS = [
  'achievement', 'box_spill', 'broom', 'build_demolish', 'build_invalid',
  'build_place', 'build_rotate', 'buy_fail', 'buy_ok', 'cart_loop', 'cash',
  'conveyor_loop', 'crank_click', 'duck_impact', 'duck_rare',
  'duck_squeak', 'fan_loop', 'footstep', 'grab', 'jump_land', 'machine_eject',
  'machine_jam', 'machine_loop', 'pit_ambient', 'pit_burp', 'player_fall',
  'player_join', 'prestige', 'session_end', 'shop_close', 'shop_open',
  'tab_switch', 'throw', 'tube_drop', 'ui_click', 'ui_hover', 'vacuum_loop',
  'world_ambient',
];

// Which of them are meant to be held open rather than fired once. Named here so
// the wiring cannot accidentally one-shot a two-second ambience.
export const LOOP_CLIPS = [
  'machine_loop', 'fan_loop', 'conveyor_loop', 'vacuum_loop', 'cart_loop',
  'world_ambient', 'pit_ambient',
];

const GESTURES = ['pointerdown', 'mousedown', 'keydown', 'touchstart', 'wheel'];

function num(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

// How far the music bus sits under the rest. cutscene.mp3 peaks at +3.8 dBFS
// against a game whose loudest one-shots sit around -1, and it was going
// through the effects bus at its own gain -- measured 4 to 12 dB above
// everything the game does. -8 dB puts the intro under the game rather than
// over it, which is the direction a title card should sit.
const MUSIC_TRIM = 0.4;

// The bucket deck behind per-play variation. See config.audio.variation for WHY
// this is not Math.random(): the ear locks onto clustering, and bare random
// clusters. Each clip gets its own deck of bucket indices over [-1, +1];
// shuffled, dealt, refilled, and never reopened on the slice it just closed on.
function createDeck(buckets) {
  const n = Math.max(1, Math.round(buckets));
  const decks = Object.create(null);
  const lastOf = Object.create(null);

  function refill(name) {
    const d = [];
    for (let i = 0; i < n; i++) d.push(i);
    // Fisher-Yates.
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = d[i]; d[i] = d[j]; d[j] = t;
    }
    // Never open a fresh deck on the bucket the last one closed on: that is the
    // one case a shuffled deck can still hand out two neighbours in a row.
    //
    // The guard is on the LAST element, not the first, because next() deals with
    // pop(). Guarding d[0] instead looks right and does nothing, which is not a
    // theory -- it was measured: 40 draws, aligned blocks all clean permutations,
    // and exactly one adjacent repeat, sitting precisely on a deck seam.
    if (n > 1 && d[n - 1] === lastOf[name]) { const t = d[n - 1]; d[n - 1] = d[n - 2]; d[n - 2] = t; }
    decks[name] = d;
    return d;
  }

  // Returns a number in [-1, +1], stratified.
  return function next(name) {
    let d = decks[name];
    if (!d || !d.length) d = refill(name);
    const b = d.pop();
    lastOf[name] = b;
    // Somewhere inside bucket b, so two draws from the same slice on different
    // passes are still not the same number.
    const u = (b + Math.random()) / n;
    return u * 2 - 1;
  };
}

export function createAudioBus({ config }) {
  const A = config.audio;
  const enabled = A.enabled > 0 && !!CTOR;

  let ctx = null;
  let master = null;
  // Two sub-buses under the master, and they are the ONLY place a player's
  // volume sliders touch anything. A slider scales a bus; it never rewrites the
  // per-clip gains from mix.json, which Jurek set by ear, clip by clip.
  //
  // The split is one-shots against loops rather than "music against effects"
  // because that is the split this game actually has: LOOP_CLIPS are the
  // factory bed and the world ambience, which are meant to sit under the
  // action, and everything else is an event you did.
  //
  // A THIRD bus, for music. src/cutscene.js used to hand its track to
  // synthNodes(), which is the sfx bus -- so the intro sat 4-12 dB above the
  // game and was governed by the EFFECTS slider, which is not what anybody
  // reaches for when the intro is too loud. Music is its own thing and gets its
  // own gain; the ambience slider drives it, being the closest of the three to
  // "the bed under everything".
  let sfxBus = null;
  let loopBus = null;
  let musicBus = null;
  // The room. One ConvolverNode for the whole game, fed by a send off each
  // one-shot voice whose gain rises with distance -- see startReverb() below
  // for why the send is per voice and the convolver is not.
  let convolver = null;
  let reverbIn = null;
  let reverbOut = null;
  let impulseInfo = null;
  // The duck. A gain node of its own AFTER loopBus, so the pit payoff can dip
  // the factory without ever touching the number the player's ambience slider
  // owns.
  let loopDuck = null;
  const duckStats = { ducks: 0, lastAt: -1, minGainSeen: 1, depth: 1 };
  // The limiter. 24 voices summing at 0.9 headroom with nothing catching the
  // peaks means the loudest moments of the game -- a crate in the pit while a
  // machine jams -- were the moments it clipped.
  let limiter = null;
  const volume = { master: 1, sfx: 1, loop: 1 };
  let contextError = enabled ? null : (CTOR ? 'disabled by config.audio.enabled' : 'no AudioContext');

  const buffers = new Map();     // name -> AudioBuffer
  const failures = new Map();    // name -> reason string
  let mix = {};
  // name -> { loopStart, loopEnd } in SECONDS. Seconds, not samples, and that
  // is deliberate: decodeAudioData resamples every buffer to the context's rate
  // (48 kHz on most machines, against a 44.1 kHz file), so a sample index would
  // point somewhere else in the decoded buffer while a time does not move.
  let loopPoints = {};
  let loopsLoaded = false;
  let mixLoaded = false;
  let loading = null;

  const counts = Object.create(null);   // name -> times actually started
  const denied = Object.create(null);   // reason -> count
  let log = [];
  let logSeq = 0;
  let started = 0;
  let resumeAttempts = 0;
  let gestureSeen = false;

  function note(reason) {
    denied[reason] = (denied[reason] || 0) + 1;
  }

  // The clock the retrigger window is measured against. It defaults to the
  // audio context's own time, but the owner replaces it with the SIMULATION
  // clock -- and that is not a detail. debugStep() runs ninety simulated frames
  // inside five milliseconds of wall time, so a wall-clock limiter would refuse
  // nine footsteps out of ten in every head-down test while behaving completely
  // differently under requestAnimationFrame. Measured before this line existed:
  // ten strides walked, one voice started, nine "dropped by retrigger". On the
  // sim clock the limiter behaves identically in both, which is the only way a
  // head-down measurement means anything.
  let clock = null;
  function timeMs() {
    if (clock) {
      try {
        const t = clock();
        if (typeof t === 'number' && isFinite(t)) return t;
      } catch (_) { /* fall through to the context clock */ }
    }
    if (ctx) return ctx.currentTime * 1000;
    return (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  // The context is built lazily and suspended. Creating it costs nothing and
  // asking it to run before a gesture is what produces the console warning this
  // project refuses to ship.
  function ensureContext() {
    if (ctx || !enabled) return ctx;
    try {
      ctx = new CTOR();
      master = ctx.createGain();
      master.gain.value = A.masterGain * volume.master;
      // master -> limiter -> destination. A DynamicsCompressorNode with a 12:1
      // ratio and a 3 ms attack IS a limiter; there is no separate node for one
      // in the Web Audio API. It goes AFTER the master gain so the player's
      // slider decides how hard the mix hits it, and after a makeup gain so
      // turning it on does not simply make the game quieter.
      const M = A.master || {};
      if (M.limiterEnabled > 0 && typeof ctx.createDynamicsCompressor === 'function') {
        limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = num(M.thresholdDb, -6);
        limiter.knee.value = Math.max(0, num(M.kneeDb, 3));
        limiter.ratio.value = Math.max(1, num(M.ratio, 12));
        limiter.attack.value = Math.max(0, num(M.attackSeconds, 0.003));
        limiter.release.value = Math.max(0.01, num(M.releaseSeconds, 0.18));
        const makeup = ctx.createGain();
        makeup.gain.value = Math.max(0, num(M.makeup, 1.15));
        master.connect(limiter);
        limiter.connect(makeup);
        makeup.connect(ctx.destination);
      } else {
        limiter = null;
        master.connect(ctx.destination);
      }
      sfxBus = ctx.createGain();
      sfxBus.gain.value = volume.sfx;
      sfxBus.connect(master);
      loopBus = ctx.createGain();
      loopBus.gain.value = volume.loop;
      // loopBus -> loopDuck -> master. Two nodes rather than one, and the split
      // is the whole point: the player's ambience slider writes loopBus.gain
      // and the pit payoff writes loopDuck.gain, so a duck in flight cannot be
      // erased by someone moving the slider and a slider move cannot be undone
      // by a duck releasing. One node would make those the same value.
      loopDuck = ctx.createGain();
      loopDuck.gain.value = 1;
      loopBus.connect(loopDuck);
      loopDuck.connect(master);
      musicBus = ctx.createGain();
      musicBus.gain.value = volume.loop * MUSIC_TRIM;
      musicBus.connect(master);
      buildReverb();
    } catch (err) {
      ctx = null;
      master = null;
      sfxBus = null;
      loopBus = null;
      musicBus = null;
      limiter = null;
      contextError = err && err.message ? err.message : String(err);
    }
    return ctx;
  }

  // --- the room --------------------------------------------------------------

  // The impulse response, built rather than downloaded. A 35 m concrete plate
  // is not a subtle acoustic space: it is a handful of discrete early
  // reflections off flat hard surfaces, followed by an exponentially decaying
  // diffuse tail whose top end dies before its bottom end does. All three of
  // those are arithmetic, so the alternative -- shipping an IR file -- would
  // cost a download and a third-party licence to account for and buy nothing.
  //
  // Left and right get INDEPENDENT noise. A convolver fed the same IR on both
  // channels returns a wider mono, not a room.
  function buildImpulse(c) {
    const R = A.reverb || {};
    const sr = c.sampleRate;
    const seconds = Math.max(0.05, num(R.seconds, 2.1));
    const n = Math.max(1, Math.round(seconds * sr));
    const channels = R.stereo > 0 ? 2 : 1;
    const buf = c.createBuffer(channels, n, sr);
    const pre = Math.max(0, Math.round(num(R.preDelaySeconds, 0.05) * sr));
    // RT60: 60 dB of decay across `seconds`.
    const decay = Math.log(1000) / n;
    const damping = Math.max(0.01, Math.min(1, num(R.damping, 0.34)));
    const taps = Array.isArray(R.earlyTaps) ? R.earlyTaps : [];

    let energy = 0;
    for (let ch = 0; ch < channels; ch++) {
      const d = buf.getChannelData(ch);
      // The diffuse tail: noise under an exponential envelope, run through a
      // one-pole low-pass whose coefficient tightens as the tail ages. That is
      // what makes a long room sound like a room rather than like a long noise
      // burst -- an undamped tail reads as hiss.
      let lp = 0;
      for (let i = pre; i < n; i++) {
        const t = (i - pre) / (n - pre || 1);
        const env = Math.exp(-decay * (i - pre));
        const a = damping * (1 - t) + damping * damping * t;
        lp += a * ((Math.random() * 2 - 1) - lp);
        d[i] = lp * env;
      }
      // The early reflections, laid in front of it. Alternating signs: a real
      // reflection off a hard surface is not a copy, and same-sign taps comb
      // into a metallic ring.
      for (let k = 0; k < taps.length; k++) {
        const tap = taps[k];
        if (!tap || tap.length < 2) continue;
        // A few samples of channel offset, so the two ears do not receive the
        // same reflection at the same instant.
        const j = pre + Math.round(num(tap[0], 0) * sr) + (ch === 1 ? Math.round(0.0013 * sr) : 0);
        if (j >= 0 && j < n) d[j] += num(tap[1], 0);
      }
      for (let i = 0; i < n; i++) energy += d[i] * d[i];
    }
    // Normalised to unit energy, so changing seconds/damping in config moves
    // the CHARACTER of the room and never its level. Without this a longer
    // reverb is also a louder one and every wet gain has to be re-tuned.
    const norm = energy > 0 ? 1 / Math.sqrt(energy) : 1;
    let peak = 0;
    for (let ch = 0; ch < channels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) {
        d[i] *= norm;
        const a = Math.abs(d[i]);
        if (a > peak) peak = a;
      }
    }
    impulseInfo = {
      seconds: Math.round((n / sr) * 1e4) / 1e4,
      samples: n,
      channels,
      sampleRate: sr,
      preDelaySeconds: Math.round((pre / sr) * 1e5) / 1e5,
      earlyTaps: taps.length,
      damping,
      peak: Math.round(peak * 1e6) / 1e6,
      normalisedEnergy: 1,
    };
    return buf;
  }

  function buildReverb() {
    const R = A.reverb || {};
    if (!(R.enabled > 0) || !ctx || typeof ctx.createConvolver !== 'function') return false;
    try {
      convolver = ctx.createConvolver();
      convolver.normalize = false;   // the IR is normalised above, by energy
      convolver.buffer = buildImpulse(ctx);
      // A gain in front of the convolver so every send is summed once and the
      // convolution runs ONCE. A ConvolverNode per voice would be twenty-four
      // two-second convolutions a frame for a game that needs one room.
      reverbIn = ctx.createGain();
      reverbIn.gain.value = 1;
      reverbOut = ctx.createGain();
      reverbOut.gain.value = Math.max(0, num(R.wetGain, 0.5));
      reverbIn.connect(convolver);
      convolver.connect(reverbOut);
      // The return lands on the SFX BUS, not on the master: the wet signal is
      // the same sound as the dry one and must move with the effects slider.
      // Landing it on master would make turning effects down turn the room UP,
      // relatively speaking.
      reverbOut.connect(sfxBus);
      return true;
    } catch (_) {
      convolver = null;
      reverbIn = null;
      reverbOut = null;
      impulseInfo = null;
      return false;
    }
  }

  // How much of a voice at `meters` goes to the room. Dry at arm's length,
  // fully wet across the plate, linear in between -- the plate is 35 m and flat,
  // so there is no case for anything cleverer.
  function sendFor(meters) {
    const R = A.reverb || {};
    if (!(R.enabled > 0)) return 0;
    if (typeof meters !== 'number' || !isFinite(meters)) {
      return Math.max(0, num(R.sendUnpositioned, 0));
    }
    const dry = num(R.dryMeters, 3);
    const wet = num(R.wetMeters, 26);
    const max = Math.max(0, num(R.sendMax, 0.85));
    if (meters <= dry) return 0;
    if (meters >= wet) return max;
    return max * ((meters - dry) / Math.max(1e-6, wet - dry));
  }

  function resume() {
    const c = ensureContext();
    if (!c) return false;
    if (c.state === 'running') return true;
    resumeAttempts++;
    try {
      const p = c.resume();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_) { /* a refused resume is not an error, it is a browser */ }
    return c.state === 'running';
  }

  function onGesture() {
    gestureSeen = true;
    resume();
  }

  if (enabled && typeof window !== 'undefined') {
    for (let i = 0; i < GESTURES.length; i++) {
      window.addEventListener(GESTURES[i], onGesture, { passive: true });
    }
  }

  // --- loading ---------------------------------------------------------------

  async function decodeOne(name) {
    const url = A.basePath + name + '.mp3';
    try {
      const res = await fetchWithTimeout(url, A.fetchTimeoutMs);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const bytes = await res.arrayBuffer();
      const c = ensureContext();
      if (!c) throw new Error(contextError || 'no context');
      // Safari's decodeAudioData is callback-only on old versions; both shapes
      // are handled so a decode failure is one dead clip, not a dead bus.
      const buf = await new Promise((resolve, reject) => {
        let settled = false;
        const ok = (b) => { if (!settled) { settled = true; resolve(b); } };
        const bad = (e) => { if (!settled) { settled = true; reject(e || new Error('decode failed')); } };
        let r;
        try { r = c.decodeAudioData(bytes, ok, bad); } catch (e) { bad(e); return; }
        if (r && typeof r.then === 'function') r.then(ok, bad);
      });
      buffers.set(name, buf);
      return true;
    } catch (err) {
      failures.set(name, err && err.message ? err.message : String(err));
      return false;
    }
  }

  // Fetched in waves so forty requests do not race the models the player is
  // waiting to look at. Never throws: the returned report is the whole story.
  async function load() {
    if (!enabled) return { loaded: 0, failed: 0, skipped: true, reason: contextError };
    if (loading) return loading;
    loading = (async () => {
      mix = await loadJSON(A.mixPath, {}, A.fetchTimeoutMs) || {};
      mixLoaded = true;
      // Loop points are optional in the strongest sense: if this file is
      // missing or malformed, every loop falls back to looping the whole
      // buffer, which is exactly what the game did before it existed.
      loopPoints = await loadJSON(A.loopsPath, {}, A.fetchTimeoutMs) || {};
      loopsLoaded = Object.keys(loopPoints).length > 0;
      const queue = CLIPS.slice();
      const width = Math.max(1, Math.round(A.concurrency));
      const workers = [];
      for (let w = 0; w < width; w++) {
        workers.push((async () => {
          for (;;) {
            const name = queue.shift();
            if (!name) return;
            await decodeOne(name);
          }
        })());
      }
      await Promise.all(workers);
      return {
        loaded: buffers.size,
        failed: failures.size,
        missingFromMix: CLIPS.filter((n) => typeof mix[n] !== 'number'),
        failures: Array.from(failures.entries()).map(([k, v]) => ({ clip: k, reason: v })),
      };
    })();
    return loading;
  }

  // --- playback --------------------------------------------------------------

  function clipGain(name) {
    const g = mix[name];
    return typeof g === 'number' && isFinite(g) && g >= 0 ? g : A.defaultClipGain;
  }

  function record(name, gain, kind, extra) {
    counts[name] = (counts[name] || 0) + 1;
    started++;
    const row = { n: logSeq++, clip: name, gain: Math.round(gain * 1e4) / 1e4, kind, t: Math.round(timeMs()) };
    if (extra) {
      // The variation actually APPLIED to the node, read back off what was set
      // rather than off what was asked for. This is the only record that can
      // prove no two consecutive plays of a clip were identical.
      if (extra.rate !== undefined) row.rate = Math.round(extra.rate * 1e5) / 1e5;
      if (extra.pan !== undefined) row.pan = Math.round(extra.pan * 1e4) / 1e4;
      // How much of this voice went to the room, read off the send node. The
      // only record that can show wet rising with distance across a session.
      if (extra.send !== undefined) row.send = Math.round(extra.send * 1e4) / 1e4;
      if (extra.loopStart !== undefined) row.loopStart = Math.round(extra.loopStart * 1e5) / 1e5;
      if (extra.loopEnd !== undefined) row.loopEnd = Math.round(extra.loopEnd * 1e5) / 1e5;
    }
    log.push(row);
    if (log.length > A.logMax) log = log.slice(log.length - A.logMax);
  }

  // --- per-play variation ------------------------------------------------------

  const V = A.variation || {};
  const P = A.pan || {};
  const deck = createDeck(num(V.buckets, 7));
  const varMax = { rate: Math.max(0, num(V.maxRate, 0.45)), gain: Math.max(0, num(V.maxGain, 0.6)) };

  // [rateSpread, gainSpread] for a clip, as +/- fractions. A loop gets the loop
  // numbers -- zero by default, deliberately; see config.audio.variation.
  function spreadFor(name, isLoop) {
    if (isLoop) {
      return [Math.min(varMax.rate, Math.max(0, num(V.loopRate, 0))),
        Math.min(varMax.gain, Math.max(0, num(V.loopGain, 0)))];
    }
    const row = V.clips ? V.clips[name] : null;
    const r = row && typeof row[0] === 'number' ? row[0] : num(V.defaultRate, 0.07);
    const g = row && typeof row[1] === 'number' ? row[1] : num(V.defaultGain, 0.12);
    return [Math.min(varMax.rate, Math.max(0, r)), Math.min(varMax.gain, Math.max(0, g))];
  }

  // scale is everything the caller computed -- distance attenuation, a per-event
  // trim -- and is multiplied by the clip's own mix.json gain here. The mix
  // number is never bypassed and never rewritten.
  function start(name, scale, opts) {
    const o = opts || {};
    try {
      if (!enabled) { note('disabled'); return null; }
      const buf = buffers.get(name);
      if (!buf) { note(failures.has(name) ? 'clip-failed' : 'clip-not-loaded'); return null; }
      const c = ensureContext();
      if (!c || !master || !sfxBus || !loopBus) { note('no-context'); return null; }
      if (c.state !== 'running') {
        // Not an error and not worth a warning: the browser has not been given
        // a gesture yet. The request is counted so a test can see it happened.
        note('suspended');
        return null;
      }
      const base = clipGain(name) * (typeof scale === 'number' && isFinite(scale) ? scale : 1);

      // Two independent draws from the deck, keyed apart so the pitch of a play
      // does not predict its level -- correlated jitter reads as one wobble
      // rather than as two different sounds.
      const [rateSpread, gainSpread] = spreadFor(name, !!o.loop);
      const rate = rateSpread > 0 ? 1 + deck(name + '#r') * rateSpread : 1;
      const gainJitter = gainSpread > 0 ? 1 + deck(name + '#g') * gainSpread : 1;

      const g = base * gainJitter;
      // The audibility test runs on the number that will actually be heard, not
      // on the one before jitter: a clip trimmed to the floor must not become
      // audible because its jitter happened to land high.
      if (!(g > A.minAudibleGain)) { note('inaudible'); return null; }
      const src = c.createBufferSource();
      src.buffer = buf;
      try { src.playbackRate.value = rate; } catch (_) { /* pre-AudioParam Safari */ }
      const node = c.createGain();
      let loopWindow = null;
      if (o.loop) {
        src.loop = true;
        // The seam, placed INSIDE the buffer. Every loop ships with a slice of
        // its own tail wrapped onto its front and its head onto its back, and
        // loops.json says which interval is the actual period. Two things fall
        // out of that, and both were real faults:
        //
        //   The wrap can no longer land on a file edge, where an mp3 decoder
        //   gets a vote. Browsers disagree about encoder delay -- Safari has
        //   historically handed back around 1100 samples of leading silence
        //   that Chrome strips -- and a loop whose seam is the file's first and
        //   last sample inherits that disagreement as a tick.
        //
        //   Because the padded region is exactly periodic, a decoder that
        //   shifts the whole buffer shifts loopStart and loopEnd together and
        //   the window is still exactly one period. It stays seamless instead
        //   of merely being seamless on the machine it was built on.
        const lp = loopPoints[name];
        const dur = buf.duration;
        if (lp && typeof lp.loopStart === 'number' && typeof lp.loopEnd === 'number'
            && lp.loopEnd > lp.loopStart && lp.loopEnd <= dur + 1e-6) {
          try {
            src.loopStart = lp.loopStart;
            src.loopEnd = Math.min(lp.loopEnd, dur);
            // Start AT the loop point rather than at sample zero, so the guard
            // at the front is never heard -- it is padding, not an intro.
            loopWindow = { start: lp.loopStart, end: src.loopEnd };
          } catch (_) { loopWindow = null; }
        }
        // A loop is faded in by its owner, so it starts at zero.
        node.gain.value = 0;
      } else {
        node.gain.value = g;
      }
      src.connect(node);

      // Position, if the caller worked one out and the browser has a panner.
      // StereoPannerNode is equal-power and one node; a PannerNode per voice
      // would be an HRTF for a game that does not need one.
      let panNode = null;
      const wantPan = P.enabled > 0 && typeof o.pan === 'number' && isFinite(o.pan) && o.pan !== 0;
      if (wantPan && typeof c.createStereoPanner === 'function') {
        try {
          panNode = c.createStereoPanner();
          panNode.pan.value = Math.max(-1, Math.min(1, o.pan));
        } catch (_) { panNode = null; }
      }
      const dest = o.music ? musicBus : (o.loop ? loopBus : sfxBus);
      if (panNode) { node.connect(panNode); panNode.connect(dest); } else { node.connect(dest); }

      // The reverb send, tapped off the voice's own gain node so it carries the
      // distance attenuation and the mix level with it, and taken PRE-PAN on
      // purpose: a room return is diffuse, and panning the wet with the dry
      // would put the reflections of a sound on your left entirely in your left
      // ear, which is not what a room does.
      let sendNode = null;
      const sendAmount = o.loop || o.music ? 0 : sendFor(o.distance);
      if (sendAmount > 0 && reverbIn) {
        try {
          sendNode = c.createGain();
          sendNode.gain.value = sendAmount;
          node.connect(sendNode);
          sendNode.connect(reverbIn);
        } catch (_) { sendNode = null; }
      }

      if (loopWindow) src.start(0, loopWindow.start);
      else src.start();
      record(name, g, o.loop ? 'loop' : 'one-shot', {
        rate,
        pan: panNode ? panNode.pan.value : 0,
        send: sendNode ? sendNode.gain.value : 0,
        // Read back off the SOURCE NODE, not off loops.json: what the file says
        // and what the graph is looping are two claims, and only the second one
        // is audible.
        loopStart: o.loop ? src.loopStart : undefined,
        loopEnd: o.loop ? src.loopEnd : undefined,
      });
      return {
        source: src,
        gain: node,
        pan: panNode,
        send: sendNode,
        clip: name,
        target: g,
        rate,
        ctx: c,
        loopWindow,
      };
    } catch (err) {
      note('exception');
      return null;
    }
  }

  // The graph itself, for a sound that is generated rather than played back.
  // src/audio/pitsynth.js builds oscillators and needs somewhere to plug them
  // in; it gets the SAME sfx bus every sample goes through, so the player's
  // volume sliders and the master headroom apply to it unchanged. Returns null
  // in exactly the cases start() refuses -- no context, or no gesture yet -- and
  // the caller treats that as silence, never as an error.
  function synthNodes() {
    if (!enabled) { note('disabled'); return null; }
    const c = ensureContext();
    if (!c || !sfxBus) { note('no-context'); return null; }
    if (c.state !== 'running') { note('suspended'); return null; }
    return { ctx: c, destination: sfxBus };
  }

  // The same thing for MUSIC, which is not an effect. src/cutscene.js takes its
  // graph from here so the intro sits on its own bus at its own trim and is
  // governed by the ambience slider -- rather than on the effects bus, 4-12 dB
  // above the game, moved by the slider labelled for gunshots and footsteps.
  function musicNodes() {
    if (!enabled) { note('disabled'); return null; }
    const c = ensureContext();
    if (!c || !musicBus) { note('no-context'); return null; }
    if (c.state !== 'running') { note('suspended'); return null; }
    return { ctx: c, destination: musicBus };
  }

  // --- ducking ---------------------------------------------------------------

  // Dip the loop bus. Called by the pit payoff, which is the sound the whole
  // game is pointed at and which was being played over the top of every machine
  // it made the player buy.
  //
  // Scheduled on the AudioParam rather than stepped per frame, so the shape is
  // exact and does not stutter when a frame runs long -- and so retriggering
  // mid-duck ramps from wherever the gain actually is, instead of snapping.
  function duckLoops(opts) {
    const D = A.duck || {};
    const o = opts || {};
    if (!(D.enabled > 0)) return null;
    const c = ensureContext();
    if (!c || !loopDuck || c.state !== 'running') return null;
    try {
      const depth = Math.max(0.02, Math.min(1, Math.pow(10, num(o.depthDb, num(D.depthDb, -6)) / 20)));
      const atk = Math.max(0.005, num(o.attackSeconds, num(D.attackSeconds, 0.04)));
      const hold = Math.max(0, num(o.holdSeconds, num(D.holdSeconds, 0.35)));
      const rel = Math.max(0.01, num(o.releaseSeconds, num(D.releaseSeconds, 0.55)));
      const t = c.currentTime;
      const g = loopDuck.gain;
      g.cancelScheduledValues(t);
      // Anchor at the CURRENT value, not at 1: a payoff landing while the last
      // one is still recovering must continue from where the bed is, or the
      // bed jumps back to full and drops again, which is a pump.
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(depth, t + atk);
      g.setValueAtTime(depth, t + atk + hold);
      g.linearRampToValueAtTime(1, t + atk + hold + rel);
      duckStats.ducks++;
      duckStats.lastAt = Math.round(timeMs());
      duckStats.depth = Math.round(depth * 1e4) / 1e4;
      return { depth, attack: atk, hold, release: rel, at: t };
    } catch (_) {
      return null;
    }
  }

  // Read off the NODE, and remember the lowest value ever seen. A duck is a
  // shape in time; a single reading cannot show it, and this is what lets a
  // test sample the gain across a pit run and prove the dip happened.
  function duckState() {
    const g = loopDuck ? loopDuck.gain.value : null;
    if (typeof g === 'number' && g < duckStats.minGainSeen) duckStats.minGainSeen = g;
    return {
      present: !!loopDuck,
      enabled: (A.duck || {}).enabled > 0,
      gain: g === null ? null : Math.round(g * 1e5) / 1e5,
      gainDb: g === null || g <= 0 ? null : Math.round(20 * Math.log10(g) * 100) / 100,
      ducks: duckStats.ducks,
      lastAt: duckStats.lastAt,
      scheduledDepth: duckStats.depth,
      minGainSeen: Math.round(duckStats.minGainSeen * 1e5) / 1e5,
      minGainSeenDb: duckStats.minGainSeen > 0
        ? Math.round(20 * Math.log10(duckStats.minGainSeen) * 100) / 100 : null,
      configDepthDb: num((A.duck || {}).depthDb, -6),
    };
  }

  function stop(voice, fadeSeconds) {
    if (!voice) return false;
    try {
      const c = voice.ctx;
      const f = Math.max(0, Number(fadeSeconds) || 0);
      if (f > 0 && c) {
        const t = c.currentTime;
        voice.gain.gain.cancelScheduledValues(t);
        voice.gain.gain.setValueAtTime(voice.gain.gain.value, t);
        voice.gain.gain.linearRampToValueAtTime(0, t + f);
        voice.source.stop(t + f + 0.02);
      } else {
        voice.source.stop();
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function setVoiceGain(voice, value) {
    if (!voice) return false;
    try {
      voice.gain.gain.value = Math.max(0, value);
      return true;
    } catch (_) {
      return false;
    }
  }

  return {
    enabled,
    load,
    resume,
    start,
    synthNodes,
    musicNodes,
    // A synthesized note counts and logs like any other sound, so the played
    // log and debugAudioCounts stay the whole story of what was heard.
    recordSynth(name, gain) { record(name, gain, 'synth'); return true; },
    stop,
    setVoiceGain,
    clipGain,
    timeMs,
    duckLoops,
    duckState,
    // What a voice at this distance would send to the room. A number, so the
    // wet-rises-with-distance claim is checkable without playing anything.
    reverbSendFor: (meters) => sendFor(meters),
    // The reverb as it exists in the GRAPH, including the impulse response that
    // was actually generated -- not the config that asked for it.
    reverb() {
      const R = A.reverb || {};
      return {
        enabled: R.enabled > 0,
        present: !!convolver,
        convolverConnected: !!(convolver && reverbIn && reverbOut),
        normalize: convolver ? convolver.normalize : null,
        bufferSeconds: convolver && convolver.buffer
          ? Math.round(convolver.buffer.duration * 1e4) / 1e4 : null,
        bufferChannels: convolver && convolver.buffer ? convolver.buffer.numberOfChannels : null,
        wetGainNode: reverbOut ? reverbOut.gain.value : null,
        returnsTo: reverbOut ? 'sfxBus' : null,
        impulse: impulseInfo,
        sendCurve: {
          dryMeters: num(R.dryMeters, 3),
          wetMeters: num(R.wetMeters, 26),
          sendMax: num(R.sendMax, 0.85),
          sendUnpositioned: num(R.sendUnpositioned, 0),
          samples: [0, 3, 6, 10, 15, 20, 26, 35, 45].map((m) => ({ meters: m, send: Math.round(sendFor(m) * 1e4) / 1e4 })),
        },
      };
    },
    // The player's three volume sliders. Each one scales a bus and nothing
    // else: config.audio.masterGain stays the headroom it was set to, and the
    // per-clip numbers in mix.json are never touched. Setting a volume before
    // the AudioContext exists is remembered and applied when it is built, so a
    // preference restored at boot does not need a gesture to take effect.
    setMasterVolume(v) {
      volume.master = Math.max(0, Number(v) || 0);
      if (master) master.gain.value = A.masterGain * volume.master;
      return volume.master;
    },
    setSfxVolume(v) {
      volume.sfx = Math.max(0, Number(v) || 0);
      if (sfxBus) sfxBus.gain.value = volume.sfx;
      return volume.sfx;
    },
    setLoopVolume(v) {
      volume.loop = Math.max(0, Number(v) || 0);
      if (loopBus) loopBus.gain.value = volume.loop;
      // Music rides the ambience slider, at its own fixed trim under it.
      if (musicBus) musicBus.gain.value = volume.loop * MUSIC_TRIM;
      return volume.loop;
    },
    // What the deck would deal next, and what the graph is set to. Numbers, so a
    // test can prove the variation rather than be told about it.
    variationFor: (name, isLoop) => {
      const [r, g] = spreadFor(name, !!isLoop);
      return { clip: name, rateSpread: r, gainSpread: g, buckets: Math.max(1, Math.round(num(V.buckets, 7))) };
    },
    // Read back off the GAIN NODES where they exist, never off the stored
    // numbers: what is asked for and what the graph is doing are two claims and
    // only the second one is audible.
    volumes: () => ({
      master: volume.master,
      sfx: volume.sfx,
      loop: volume.loop,
      masterGainNode: master ? master.gain.value : null,
      sfxGainNode: sfxBus ? sfxBus.gain.value : null,
      loopGainNode: loopBus ? loopBus.gain.value : null,
      musicGainNode: musicBus ? musicBus.gain.value : null,
      configMasterGain: A.masterGain,
    }),
    // The master chain as it actually exists in the graph, including how much
    // gain the limiter is taking off RIGHT NOW.
    limiter: () => (limiter ? {
      present: true,
      thresholdDb: limiter.threshold.value,
      kneeDb: limiter.knee.value,
      ratio: limiter.ratio.value,
      attackSeconds: limiter.attack.value,
      releaseSeconds: limiter.release.value,
      reductionDb: typeof limiter.reduction === 'number' ? limiter.reduction : null,
    } : { present: false }),
    setClock(fn) { clock = typeof fn === 'function' ? fn : null; return !!clock; },
    hasClip: (name) => buffers.has(name),
    clipNames: () => CLIPS.slice(),
    loopNames: () => LOOP_CLIPS.slice(),
    mix: () => ({ ...mix }),
    mixLoaded: () => mixLoaded,
    loopPoints: () => ({ ...loopPoints }),
    failures: () => Array.from(failures.entries()).map(([k, v]) => ({ clip: k, reason: v })),
    counts: () => ({ ...counts }),
    denied: () => ({ ...denied }),
    startedTotal: () => started,
    log: () => log.slice(),
    clearLog() { log = []; return 0; },
    state() {
      return {
        enabled,
        contextState: ctx ? ctx.state : 'none',
        contextError,
        gestureSeen,
        resumeAttempts,
        masterGain: master ? master.gain.value : 0,
        sfxGain: sfxBus ? sfxBus.gain.value : 0,
        loopGain: loopBus ? loopBus.gain.value : 0,
        musicGain: musicBus ? musicBus.gain.value : 0,
        loopDuckGain: loopDuck ? Math.round(loopDuck.gain.value * 1e5) / 1e5 : null,
        reverbPresent: !!convolver,
        reverbSeconds: convolver && convolver.buffer
          ? Math.round(convolver.buffer.duration * 1e4) / 1e4 : null,
        loopPointsLoaded: loopsLoaded,
        loopPointClips: Object.keys(loopPoints).length,
        limiterPresent: !!limiter,
        limiterReductionDb: limiter && typeof limiter.reduction === 'number' ? Math.round(limiter.reduction * 100) / 100 : null,
        volumeMaster: volume.master,
        volumeSfx: volume.sfx,
        volumeLoop: volume.loop,
        clipsLoaded: buffers.size,
        clipsExpected: CLIPS.length,
        clipsFailed: failures.size,
        mixLoaded,
        mixEntries: Object.keys(mix).length,
        started,
      };
    },
    dispose() {
      if (typeof window !== 'undefined') {
        for (let i = 0; i < GESTURES.length; i++) window.removeEventListener(GESTURES[i], onGesture);
      }
      try { if (ctx) ctx.close(); } catch (_) { /* nothing to do */ }
    },
  };
}

export default createAudioBus;
