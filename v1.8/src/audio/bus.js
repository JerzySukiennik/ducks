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
export const CLIPS = [
  'achievement', 'box_spill', 'broom', 'build_demolish', 'build_invalid',
  'build_place', 'build_rotate', 'buy_fail', 'buy_ok', 'cart_loop', 'cash',
  'conveyor_loop', 'crank_click', 'duck_impact', 'duck_rare',
  'duck_squeak', 'fan_loop', 'footstep', 'grab', 'jump_land', 'machine_eject',
  'machine_jam', 'machine_loop', 'pit_ambient', 'pit_burp', 'player_fall',
  'player_join', 'prestige', 'radio', 'session_end', 'shop_close', 'shop_open',
  'tab_switch', 'throw', 'tube_drop', 'ui_click', 'ui_hover', 'vacuum_loop',
  'world_ambient',
];

// Which of them are meant to be held open rather than fired once. Named here so
// the wiring cannot accidentally one-shot a two-second ambience.
export const LOOP_CLIPS = [
  'machine_loop', 'fan_loop', 'conveyor_loop', 'vacuum_loop', 'cart_loop',
  'radio', 'world_ambient', 'pit_ambient',
];

const GESTURES = ['pointerdown', 'mousedown', 'keydown', 'touchstart', 'wheel'];

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
  let sfxBus = null;
  let loopBus = null;
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
      master.connect(ctx.destination);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = volume.sfx;
      sfxBus.connect(master);
      loopBus = ctx.createGain();
      loopBus.gain.value = volume.loop;
      loopBus.connect(master);
    } catch (err) {
      ctx = null;
      master = null;
      sfxBus = null;
      loopBus = null;
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

  function record(name, gain, kind) {
    counts[name] = (counts[name] || 0) + 1;
    started++;
    log.push({ n: logSeq++, clip: name, gain: Math.round(gain * 1e4) / 1e4, kind, t: Math.round(timeMs()) });
    if (log.length > A.logMax) log = log.slice(log.length - A.logMax);
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
      const g = clipGain(name) * (typeof scale === 'number' && isFinite(scale) ? scale : 1);
      if (!(g > A.minAudibleGain)) { note('inaudible'); return null; }
      const src = c.createBufferSource();
      src.buffer = buf;
      const node = c.createGain();
      if (o.loop) {
        src.loop = true;
        // A loop is faded in by its owner, so it starts at zero.
        node.gain.value = 0;
      } else {
        node.gain.value = g;
      }
      src.connect(node);
      node.connect(o.loop ? loopBus : sfxBus);
      src.start();
      record(name, g, o.loop ? 'loop' : 'one-shot');
      return { source: src, gain: node, clip: name, target: g, ctx: c };
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
      return volume.loop;
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
      configMasterGain: A.masterGain,
    }),
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
