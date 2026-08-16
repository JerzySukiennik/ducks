// The pit payoff, SYNTHESIZED. No sample file: a duck falling in is oscillators
// and envelopes, built here so the pitch can be a function of how well the run
// is going. duck_pit.mp3 is still on disk and is no longer referenced by
// anything -- one fixed sample can never rise, and rising is the whole point.
//
// What it does, in one sentence: every duck the pit swallows plays a note one
// scale step higher than the duck before it, up to a ceiling, and the run slides
// back down to the bottom once the player stops scoring.
//
// Three rules this module obeys, all of them borrowed from bus.js:
//
//   1. Nothing in here throws. No AudioContext, a suspended context, a stupid
//      parameter -- all of it is a no-op that still returns the numbers, because
//      the audio layer hangs off the frame loop.
//   2. The clock is the SIMULATED one. The caller passes `now` in simulation
//      seconds; the streak decay is measured against it, so ninety frames of
//      debugStep behave exactly like a second and a half of playing.
//   3. The knobs live in config.audio.pit.synth, not here. This file only says
//      what each knob means, what range a slider may take, and what it is called
//      in Polish -- work/pit-lab.html is a view of THIS list, so a knob cannot
//      exist in the game and be missing from the lab.

// The knobs, in the order the lab shows them. `label` is Polish because the lab
// is for Jurek; `key` is the config key under config.audio.pit.synth.
export const PIT_SYNTH_KNOBS = [
  // --- the run ---------------------------------------------------------------
  { key: 'baseHz', label: 'Częstotliwość bazowa (pierwsza kaczka)', unit: 'Hz', min: 80, max: 900, step: 1, group: 'Bieg w górę' },
  { key: 'semitonesPerDuck', label: 'Krok na kaczkę (półtony; przy pentatonice = stopnie skali)', unit: 'st', min: 0, max: 6, step: 0.05, group: 'Bieg w górę' },
  { key: 'ceilingSemitones', label: 'Sufit (ile półtonów maksymalnie w górę)', unit: 'st', min: 0, max: 48, step: 1, group: 'Bieg w górę' },
  { key: 'quantize', label: 'Skala pentatoniczna (0 = ciągła, 1 = w skali)', unit: '', min: 0, max: 1, step: 1, group: 'Bieg w górę' },
  { key: 'holdSeconds', label: 'Trzymanie biegu po ostatniej kaczce', unit: 's', min: 0, max: 15, step: 0.1, group: 'Bieg w górę' },
  { key: 'decayPerSecond', label: 'Spadek biegu (kaczek na sekundę)', unit: '1/s', min: 0.1, max: 30, step: 0.1, group: 'Bieg w górę' },
  // --- the burst -------------------------------------------------------------
  { key: 'spacingSeconds', label: 'Odstęp między nutami przy zrzucie', unit: 's', min: 0.01, max: 0.3, step: 0.005, group: 'Zrzut' },
  { key: 'maxAheadSeconds', label: 'Ile sekund nut wolno zakolejkować', unit: 's', min: 0.1, max: 4, step: 0.05, group: 'Zrzut' },
  // --- the note --------------------------------------------------------------
  { key: 'attackSeconds', label: 'Atak', unit: 's', min: 0.001, max: 0.08, step: 0.001, group: 'Nuta' },
  { key: 'decaySeconds', label: 'Wybrzmienie nuty', unit: 's', min: 0.03, max: 1.2, step: 0.01, group: 'Nuta' },
  { key: 'glideSemitones', label: 'Zjazd/podjazd wysokości w nucie', unit: 'st', min: -12, max: 12, step: 0.1, group: 'Nuta' },
  { key: 'glideSeconds', label: 'Czas tego zjazdu', unit: 's', min: 0.005, max: 0.4, step: 0.005, group: 'Nuta' },
  { key: 'level', label: 'Głośność (mnożnik na mix.json)', unit: '×', min: 0, max: 2, step: 0.01, group: 'Nuta' },
  { key: 'highTrim', label: 'Ściszanie wysokich nut', unit: '0-1', min: 0, max: 1, step: 0.01, group: 'Nuta' },
  // --- the layers ------------------------------------------------------------
  { key: 'harmonicRatio', label: 'Krotność drugiego oscylatora', unit: '×', min: 0.5, max: 6, step: 0.01, group: 'Warstwy' },
  { key: 'harmonicGain', label: 'Poziom drugiego oscylatora (blask)', unit: '×', min: 0, max: 1.5, step: 0.01, group: 'Warstwy' },
  { key: 'detuneCents', label: 'Rozstrojenie blasku', unit: 'cent', min: -50, max: 50, step: 1, group: 'Warstwy' },
  { key: 'subGain', label: 'Poziom oktawy w dół (ciężar)', unit: '×', min: 0, max: 1.5, step: 0.01, group: 'Warstwy' },
  { key: 'clickGain', label: 'Poziom stuknięcia (szum na starcie)', unit: '×', min: 0, max: 1.5, step: 0.01, group: 'Warstwy' },
  { key: 'clickSeconds', label: 'Długość stuknięcia', unit: 's', min: 0.005, max: 0.15, step: 0.005, group: 'Warstwy' },
  // --- the filter ------------------------------------------------------------
  { key: 'cutoffMul', label: 'Filtr dolnoprzepustowy (× częstotliwość nuty)', unit: '×', min: 1, max: 24, step: 0.1, group: 'Filtr' },
  { key: 'cutoffMinHz', label: 'Filtr — dolny limit', unit: 'Hz', min: 200, max: 4000, step: 10, group: 'Filtr' },
  { key: 'cutoffMaxHz', label: 'Filtr — górny limit', unit: 'Hz', min: 2000, max: 20000, step: 100, group: 'Filtr' },
  { key: 'resonance', label: 'Rezonans filtra (Q)', unit: 'Q', min: 0.1, max: 12, step: 0.1, group: 'Filtr' },
  // --- voice safety ----------------------------------------------------------
  { key: 'maxVoices', label: 'Maks. nut brzmiących naraz (rozciąga odstęp, nie gubi nut)', unit: '', min: 1, max: 32, step: 1, group: 'Limity' },
];

// The two non-numeric knobs. Kept apart because config.js registers NUMBERS as
// required keys, and a waveform name is not a number.
export const PIT_SYNTH_WAVES = [
  { key: 'waveform', label: 'Kształt fali — korpus', group: 'Nuta' },
  { key: 'shineWave', label: 'Kształt fali — blask', group: 'Warstwy' },
];

export const WAVE_CHOICES = ['sine', 'triangle', 'square', 'sawtooth'];

// Used only if config.audio.pit.synth is missing a key -- the real defaults live
// in config.js. Keeping a fallback here means a half-written config is a
// slightly-off sound rather than NaN into an AudioParam.
export const PIT_SYNTH_FALLBACK = {
  baseHz: 300, semitonesPerDuck: 1, ceilingSemitones: 31, quantize: 1,
  holdSeconds: 2.5, decayPerSecond: 3, spacingSeconds: 0.055, maxAheadSeconds: 1,
  attackSeconds: 0.004, decaySeconds: 0.26, glideSemitones: 0.6, glideSeconds: 0.05,
  level: 1, highTrim: 0.35, harmonicRatio: 2, harmonicGain: 0.32, detuneCents: 6,
  subGain: 0.22, clickGain: 0.16, clickSeconds: 0.03, cutoffMul: 6,
  cutoffMinHz: 900, cutoffMaxHz: 12000, resonance: 0.9, maxVoices: 12,
  waveform: 'triangle', shineWave: 'sine',
};

// Major pentatonic. A chromatic run of forty ducks is a siren; the same run on
// five notes per octave is a tune, and that is the difference between "it works"
// and the payoff sound of the game.
//
// With quantize on, the step count is read as SCALE DEGREES, not semitones --
// degree 3 is the fourth note of the scale, full stop. The other way round (pick
// a semitone, snap it to the nearest scale note) was tried first and is wrong:
// at one semitone per duck it snapped consecutive ducks onto the same note, so
// half the run was a repeated pitch instead of a climb.
const PENTATONIC = [0, 2, 4, 7, 9];

function degreeToSemis(d) {
  const n = Math.round(d);
  const oct = Math.floor(n / PENTATONIC.length);
  const idx = n - oct * PENTATONIC.length;
  return PENTATONIC[idx] + 12 * oct;
}

function num(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

// audio: {
//   nodes()  -> { ctx, destination } or null when there is no running context
//   gain()   -> the clip gain for this sound (mix.json), a number
//   note(info) -> optional; called once per note actually STARTED, for the log
// }
export function createPitSynth({ params, audio }) {
  const P = { ...PIT_SYNTH_FALLBACK };
  setParams(params);

  const sink = audio || {};
  let streak = 0;        // ducks in the current run, fractional while decaying
  let lastAt = -1e9;     // simulation seconds of the last duck
  let nextSlot = 0;      // audio-context time the next queued note may start
  let live = 0;          // notes currently sounding
  let started = 0;
  let dropped = 0;
  let silent = 0;        // notes computed but not sounded (no context yet)
  let peakStreak = 0;
  let noiseBuf = null;
  let noiseCtx = null;
  const recent = [];     // ring of the last notes, for verification

  function setParams(next) {
    if (!next || typeof next !== 'object') return P;
    for (const k of Object.keys(PIT_SYNTH_FALLBACK)) {
      if (!(k in next)) continue;
      const v = next[k];
      if (typeof PIT_SYNTH_FALLBACK[k] === 'string') {
        if (WAVE_CHOICES.indexOf(v) >= 0) P[k] = v;
      } else {
        P[k] = num(v, P[k]);
      }
    }
    return P;
  }

  // How far up the run is RIGHT NOW, in ducks. Held for holdSeconds after the
  // last duck, then slides back to zero at decayPerSecond ducks a second, which
  // is what makes a pause reset the tune instead of freezing it high.
  function stepAt(now) {
    const t = num(now, 0);
    const idle = t - lastAt;
    if (idle <= 0) return streak;
    if (idle <= P.holdSeconds) return streak;
    const lost = (idle - P.holdSeconds) * Math.max(0, P.decayPerSecond);
    return Math.max(0, streak - lost);
  }

  function semitonesForStep(step) {
    const raw = Math.max(0, step) * P.semitonesPerDuck;
    const semis = P.quantize >= 0.5 ? degreeToSemis(raw) : raw;
    // The ceiling is in SEMITONES either way, so it means the same thing however
    // the run is spelled: this far above the base and no further.
    return Math.min(semis, Math.max(0, P.ceilingSemitones));
  }

  function freqForStep(step) {
    const hz = Math.max(20, P.baseHz) * Math.pow(2, semitonesForStep(step) / 12);
    return Math.min(hz, 16000);
  }

  function noise(ctx) {
    if (noiseBuf && noiseCtx === ctx) return noiseBuf;
    try {
      const n = Math.max(1, Math.round(ctx.sampleRate * 0.2));
      const b = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      noiseBuf = b; noiseCtx = ctx;
      return b;
    } catch (_) { return null; }
  }

  // One note. Everything is scheduled ahead on the context clock and stops
  // itself; nothing here is polled per frame.
  function schedule(ctx, destination, freq, at, amp) {
    const dur = Math.max(0.03, P.decaySeconds);
    const out = ctx.createGain();
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    const cut = Math.min(Math.max(freq * P.cutoffMul, P.cutoffMinHz), P.cutoffMaxHz);
    filt.frequency.setValueAtTime(Math.min(cut, ctx.sampleRate * 0.45), at);
    filt.Q.setValueAtTime(Math.max(0.0001, P.resonance), at);
    filt.connect(out);
    out.connect(destination);

    // The envelope, once, on the shared output: attack to amp, then an
    // exponential fall. Exponential because a linear fade off a plink sounds
    // like somebody pulling a fader down.
    const a = Math.max(0.001, P.attackSeconds);
    out.gain.setValueAtTime(0.0001, at);
    out.gain.linearRampToValueAtTime(amp, at + a);
    out.gain.exponentialRampToValueAtTime(0.0001, at + a + dur);

    const stopAt = at + a + dur + 0.05;
    const sources = [];

    function osc(type, hz, gain, glide, life) {
      if (!(gain > 0)) return;
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(Math.max(20, hz), at);
      if (glide) {
        // A touch of pitch movement inside the note. This is what stops it
        // sounding like a test tone: real things that get hit bend.
        const to = Math.max(20, hz * Math.pow(2, P.glideSemitones / 12));
        o.frequency.exponentialRampToValueAtTime(to, at + Math.max(0.005, P.glideSeconds));
      }
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, at);
      if (life > 0 && life < dur) g.gain.exponentialRampToValueAtTime(0.0001, at + a + life);
      o.connect(g); g.connect(filt);
      o.start(at);
      o.stop(stopAt);
      sources.push(o);
    }

    osc(P.waveform, freq, 1, true, 0);
    if (P.harmonicGain > 0) {
      const h = ctx.createOscillator();
      h.type = P.shineWave;
      h.frequency.setValueAtTime(Math.max(20, freq * P.harmonicRatio), at);
      try { h.detune.setValueAtTime(P.detuneCents, at); } catch (_) { /* older Safari */ }
      const hg = ctx.createGain();
      hg.gain.setValueAtTime(P.harmonicGain, at);
      // The shine dies first, so the note opens bright and settles.
      hg.gain.exponentialRampToValueAtTime(0.0001, at + a + dur * 0.45);
      h.connect(hg); hg.connect(filt);
      h.start(at); h.stop(stopAt);
      sources.push(h);
    }
    // Weight underneath, an octave down, gone almost immediately: this is the
    // duck's body hitting, not part of the tune.
    osc('sine', freq * 0.5, P.subGain, false, dur * 0.3);

    if (P.clickGain > 0) {
      const b = noise(ctx);
      if (b) {
        const s = ctx.createBufferSource();
        s.buffer = b;
        s.playbackRate.value = 1;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.setValueAtTime(Math.min(freq * 2, 6000), at);
        const cg = ctx.createGain();
        cg.gain.setValueAtTime(P.clickGain, at);
        cg.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(0.005, P.clickSeconds));
        s.connect(hp); hp.connect(cg); cg.connect(filt);
        s.start(at);
        s.stop(at + Math.max(0.01, P.clickSeconds) + 0.02);
        sources.push(s);
      }
    }

    live++;
    const last = sources[0];
    try {
      last.onended = () => {
        live = Math.max(0, live - 1);
        try { out.disconnect(); filt.disconnect(); } catch (_) { /* already gone */ }
      };
    } catch (_) { live = Math.max(0, live - 1); }
    return stopAt;
  }

  // One duck went in. `now` is SIMULATION seconds; `opts.attenuation` is the
  // distance gain the caller already computed. Always returns the numbers it
  // computed, whether or not a sound could be made, so a head-down test can
  // measure the pitch progression without an audio context.
  function duck(now, opts) {
    const o = opts || {};
    let info = null;
    try {
      const t = num(now, 0);
      const step = Math.floor(stepAt(t));
      streak = step + 1;
      lastAt = t;
      if (streak > peakStreak) peakStreak = streak;
      const freq = freqForStep(step);
      info = { step, freq: Math.round(freq * 100) / 100, semitones: Math.round(semitonesForStep(step) * 100) / 100, t: Math.round(t * 1000) / 1000, played: false };

      const att = num(o.attenuation, 1);
      const base = num(typeof sink.gain === 'function' ? sink.gain() : 0.4, 0.4);
      // Higher notes read louder than lower ones at the same amplitude, so the
      // top of a run would shout. This bends the level back down with pitch.
      const tilt = Math.pow(Math.max(20, P.baseHz) / freq, Math.max(0, P.highTrim));
      const amp = base * att * Math.max(0, P.level) * tilt;
      info.gain = Math.round(amp * 1e4) / 1e4;

      const nodes = typeof sink.nodes === 'function' ? sink.nodes() : null;
      if (!nodes || !nodes.ctx || !nodes.destination) { silent++; return push(info); }
      if (!(amp > 0.0005)) { silent++; return push(info); }

      const ctx = nodes.ctx;
      const at = Math.max(ctx.currentTime + 0.005, nextSlot);
      // A crate emptying delivers a dozen ducks in ONE frame. Playing them at
      // the same instant is a chord, not a run, so they are laid out in time --
      // and a dump longer than maxAheadSeconds stops queueing rather than
      // playing a minute of notes after the player has walked away.
      if (at - ctx.currentTime > P.maxAheadSeconds) { dropped++; return push(info); }
      // The voice cap is enforced by SPACING, not by refusing notes. A crate
      // spilling a dozen ducks in one frame queues a dozen notes at once, and
      // counting those as live voices threw away the top of the run -- measured:
      // sixteen ducks in, four dropped, the last four notes silent, which is
      // exactly the part that is supposed to pay off. Stretching the gap so no
      // more than maxVoices notes ever overlap keeps every note and costs a
      // slightly slower run instead.
      const noteLife = Math.max(0.001, P.attackSeconds) + Math.max(0.03, P.decaySeconds);
      const spacing = Math.max(Math.max(0.005, P.spacingSeconds), noteLife / Math.max(1, P.maxVoices));
      nextSlot = at + spacing;
      schedule(ctx, nodes.destination, freq, at, amp);
      started++;
      info.played = true;
      info.at = Math.round((at - ctx.currentTime) * 1000) / 1000;
      if (typeof sink.note === 'function') { try { sink.note(info); } catch (_) { /* never break a frame */ } }
      return push(info);
    } catch (_) {
      dropped++;
      return info;
    }
  }

  function push(info) {
    recent.push(info);
    if (recent.length > 64) recent.shift();
    return info;
  }

  return {
    duck,
    stepAt,
    freqForStep,
    semitonesForStep,
    params: () => ({ ...P }),
    setParams,
    setParam(k, v) { const o = {}; o[k] = v; return setParams(o); },
    knobs: () => PIT_SYNTH_KNOBS.slice(),
    reset() { streak = 0; lastAt = -1e9; nextSlot = 0; return true; },
    // "Pretend n ducks have already gone in." Only the tuning page uses this --
    // the game never sets the run, it earns it.
    setStreak(n, now) {
      streak = Math.max(0, Math.round(num(n, 0)));
      lastAt = num(now, 0);
      return streak;
    },
    notes: (n) => {
      const k = Math.max(0, Math.round(Number(n) || 0));
      return k > 0 ? recent.slice(Math.max(0, recent.length - k)) : recent.slice();
    },
    state: (now) => ({
      streak,
      stepNow: Math.round(stepAt(num(now, lastAt)) * 100) / 100,
      peakStreak,
      lastAt: Math.round(lastAt * 1000) / 1000,
      live,
      started,
      dropped,
      silent,
      nextFreq: Math.round(freqForStep(Math.floor(stepAt(num(now, lastAt)))) * 100) / 100,
    }),
  };
}

export default createPitSynth;
