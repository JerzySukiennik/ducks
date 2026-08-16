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
  // The limiter. 24 voices summing at 0.9 headroom with nothing catching the
  // peaks means the loudest moments of the game -- a crate in the pit while a
  // machine jams -- were the moments it clipped.
  let limiter = null;
  const volume = { master: 1, sfx: 1, loop: 1 };
  let contextError = enabled ? null : (CTOR ? 'disabled by config.audio.enabled' : 'no AudioContext');

  const buffers = new Map();     // name -> AudioBuffer
  const failures = new Map();    // name -> reason string
  let mix = {};
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
      loopBus.connect(master);
      musicBus = ctx.createGain();
      musicBus.gain.value = volume.loop * MUSIC_TRIM;
      musicBus.connect(master);
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
      if (o.loop) {
        src.loop = true;
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

      src.start();
      record(name, g, o.loop ? 'loop' : 'one-shot', {
        rate,
        pan: panNode ? panNode.pan.value : 0,
      });
      return { source: src, gain: node, pan: panNode, clip: name, target: g, rate, ctx: c };
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
