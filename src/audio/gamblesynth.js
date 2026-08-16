// The gambling box, SYNTHESIZED -- for the same reason the pit payoff is.
//
// The box was completely silent. It shakes for config.gamble.shakeSeconds, hops,
// cycles hue, throws its lid and pays out an item or a pile of ducks, and none of
// that reached the ears. It is the most theatrical object in the game and it was
// mime.
//
// Why not samples. Two reasons, both structural rather than stylistic:
//
//   1. The shake lasts exactly as long as config.gamble.shakeSeconds says, which
//      is a number Jurek can change. A fixed-length recording either runs out
//      early or gets cut off, and a loop of a rattle is a rattle with a seam in
//      it. Generated ticks fill whatever duration they are given and can
//      ACCELERATE towards the lid, so the box winds up instead of idling.
//   2. The payout is the only place in the game where the sound can tell you the
//      SIZE of what you won. The chime is an arpeggio whose length and starting
//      note come from the prize's value, which no single file can do.
//
// Three rules, borrowed from pitsynth.js unchanged: nothing here throws, the
// clock passed in is the SIMULATION clock, and the knobs live in
// config.audio.gamble rather than here.

const FALLBACK = {
  rattleHz: 9, rattleHzEnd: 26, rattleGain: 0.5, rattleHzStart: 900,
  rattleHzSpread: 700, rattleDecaySeconds: 0.035,
  popHz: 150, popGain: 0.9,
  chimeBaseHz: 523.25, chimeNotes: 4, chimeMaxNotes: 7,
  chimeSpacingSeconds: 0.085, chimeGain: 0.42, chimeDecaySeconds: 0.5,
  doneHz: 110, doneGain: 0.4, doneDecaySeconds: 0.2,
  maxVoices: 10,
};

// Major pentatonic again, and for the same reason pitsynth uses one: a chromatic
// run is a siren, five notes to the octave is a tune. Sharing the scale also
// means the box and the pit sound like they come from the same game.
const PENTATONIC = [0, 2, 4, 7, 9];

function degreeToSemis(d) {
  const n = Math.max(0, Math.round(d));
  const oct = Math.floor(n / PENTATONIC.length);
  return PENTATONIC[n - oct * PENTATONIC.length] + 12 * oct;
}

function num(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

// audio: { nodes() -> { ctx, destination } | null, gain() -> number,
//          note(info) -> optional, for the played log }
export function createGambleSynth({ params, audio }) {
  const P = { ...FALLBACK };
  setParams(params);

  const sink = audio || {};
  let live = 0;
  let started = 0;
  let dropped = 0;
  let silent = 0;
  let rattleUntil = -1;      // simulation seconds the current shake ends
  let rattleFrom = 0;        // and when it began, so the acceleration has a ramp
  let nextTick = 0;          // simulation seconds of the next rattle tick
  let noiseBuf = null;
  let noiseCtx = null;
  const recent = [];
  const counts = { start: 0, open: 0, done: 0, ticks: 0 };

  function setParams(next) {
    if (!next || typeof next !== 'object') return P;
    for (const k of Object.keys(FALLBACK)) {
      if (k in next) P[k] = num(next[k], P[k]);
    }
    return P;
  }

  function nodes() {
    const n = typeof sink.nodes === 'function' ? sink.nodes() : null;
    if (!n || !n.ctx || !n.destination) { silent++; return null; }
    return n;
  }

  function level() {
    return num(typeof sink.gain === 'function' ? sink.gain() : 0.4, 0.4);
  }

  function noise(ctx) {
    if (noiseBuf && noiseCtx === ctx) return noiseBuf;
    try {
      const n = Math.max(1, Math.round(ctx.sampleRate * 0.25));
      const b = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      noiseBuf = b; noiseCtx = ctx;
      return b;
    } catch (_) { return null; }
  }

  function capped() {
    if (live >= Math.max(1, P.maxVoices)) { dropped++; return true; }
    return false;
  }

  function track(node, out, filt) {
    live++;
    try {
      node.onended = () => {
        live = Math.max(0, live - 1);
        try { out.disconnect(); if (filt) filt.disconnect(); } catch (_) { /* already gone */ }
      };
    } catch (_) { live = Math.max(0, live - 1); }
  }

  // One wooden tick: filtered noise, very short. This is the box's contents
  // hitting its walls, not a note.
  function tick(ctx, dest, at, hz, amp, decay) {
    const b = noise(ctx);
    if (!b) return;
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.playbackRate.value = 0.8 + Math.random() * 0.5;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(Math.max(80, hz), at);
    bp.Q.setValueAtTime(2.4, at);
    const g = ctx.createGain();
    const d = Math.max(0.008, decay);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(amp, at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, at + d);
    s.connect(bp); bp.connect(g); g.connect(dest);
    s.start(at);
    s.stop(at + d + 0.02);
    track(s, g, bp);
    started++;
  }

  // One tone with a body and a shine, used for the pop and for the chime.
  function tone(ctx, dest, at, hz, amp, decay, wave, bendTo) {
    const out = ctx.createGain();
    const d = Math.max(0.03, decay);
    out.gain.setValueAtTime(0.0001, at);
    out.gain.linearRampToValueAtTime(amp, at + 0.006);
    out.gain.exponentialRampToValueAtTime(0.0001, at + d);
    out.connect(dest);
    const o = ctx.createOscillator();
    o.type = wave || 'triangle';
    o.frequency.setValueAtTime(Math.max(20, hz), at);
    if (bendTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, bendTo), at + d * 0.8);
    o.connect(out);
    o.start(at);
    o.stop(at + d + 0.05);
    track(o, out, null);
    started++;
  }

  // --- what wire.js calls ------------------------------------------------------

  // The roll started. Opens a rattle window; the ticks themselves are laid down
  // by update(), because a shake is a duration and not an event.
  function start(now, seconds) {
    const t = num(now, 0);
    rattleFrom = t;
    rattleUntil = t + Math.max(0, num(seconds, 0));
    nextTick = t;
    counts.start++;
    push({ type: 'start', t: Math.round(t * 1000) / 1000, seconds: num(seconds, 0) });
    return true;
  }

  // Called every frame with the simulation clock. Lays down rattle ticks at a
  // rate that ACCELERATES from rattleHz to rattleHzEnd across the shake, which
  // is what makes the box sound like it is about to open rather than like it is
  // running.
  function update(now) {
    const t = num(now, 0);
    if (t > rattleUntil) return 0;
    const span = Math.max(1e-3, rattleUntil - rattleFrom);
    let fired = 0;
    const n = nodes();
    // The window still advances with no context: a shake that began before the
    // first gesture must not dump its whole backlog the instant audio wakes up.
    for (let guard = 0; guard < 8 && nextTick <= t; guard++) {
      const u = Math.max(0, Math.min(1, (nextTick - rattleFrom) / span));
      const hz = P.rattleHz + (P.rattleHzEnd - P.rattleHz) * u;
      if (n && !capped()) {
        const at = n.ctx.currentTime + 0.005;
        const centre = P.rattleHzStart + (Math.random() - 0.5) * P.rattleHzSpread;
        // The rattle gets louder as it speeds up, so the wind-up is two cues.
        tick(n.ctx, n.destination, at, centre, level() * P.rattleGain * (0.55 + 0.45 * u), P.rattleDecaySeconds);
        counts.ticks++;
        fired++;
      }
      nextTick += 1 / Math.max(1, hz);
    }
    if (fired && typeof sink.note === 'function') {
      try { sink.note({ kind: 'gamble_rattle', gain: level() * P.rattleGain }); } catch (_) { /* never break a frame */ }
    }
    return fired;
  }

  // The lid flies and something comes out. `size` is 0..1 -- how big the prize
  // was against the best the table can pay -- and it decides both how high the
  // arpeggio starts and how many notes it has. This is the only sound in the
  // game that tells you the VALUE of what you got.
  function open(now, opts) {
    const o = opts || {};
    rattleUntil = -1;
    counts.open++;
    const size = Math.max(0, Math.min(1, num(o.size, 0.35)));
    const notes = Math.max(1, Math.round(P.chimeNotes + (P.chimeMaxNotes - P.chimeNotes) * size));
    const info = { type: 'open', size: Math.round(size * 100) / 100, notes, t: Math.round(num(now, 0) * 1000) / 1000, played: false };
    const n = nodes();
    if (!n) return push(info);
    const att = num(o.attenuation, 1);
    const amp = level() * att;
    if (!(amp > 0.0005)) { silent++; return push(info); }
    const ctx = n.ctx;
    const at = ctx.currentTime + 0.005;
    // The pop: the lid leaving. A short downward thump, so the chime lands on
    // top of something rather than starting in silence.
    if (!capped()) tone(ctx, n.destination, at, P.popHz * 2, amp * P.popGain, 0.16, 'square', P.popHz * 0.6);
    if (!capped()) tick(ctx, n.destination, at, 2600, amp * P.popGain * 0.7, 0.06);
    // The arpeggio. A bigger prize starts further up the scale AND runs longer.
    const from = Math.round(size * 4);
    for (let i = 0; i < notes; i++) {
      if (capped()) break;
      const hz = P.chimeBaseHz * Math.pow(2, degreeToSemis(from + i) / 12);
      const when = at + 0.06 + i * Math.max(0.02, P.chimeSpacingSeconds);
      // Higher notes read louder at equal amplitude; taper them, exactly as the
      // pit synth's highTrim does.
      const trim = Math.pow(P.chimeBaseHz / hz, 0.35);
      tone(ctx, n.destination, when, hz, amp * P.chimeGain * trim, P.chimeDecaySeconds, 'triangle', 0);
    }
    info.played = true;
    info.baseHz = Math.round(P.chimeBaseHz * Math.pow(2, degreeToSemis(from) / 12) * 100) / 100;
    if (typeof sink.note === 'function') { try { sink.note({ kind: 'gamble_open', gain: amp * P.chimeGain }); } catch (_) { /* never break a frame */ } }
    return push(info);
  }

  // The lid comes back down and the box goes idle. One low thump: the sound of
  // the thing being ready again, which is a real piece of information because
  // the box refuses a roll until it is.
  function done(now, opts) {
    const o = opts || {};
    counts.done++;
    const info = { type: 'done', t: Math.round(num(now, 0) * 1000) / 1000, played: false };
    const n = nodes();
    if (!n || capped()) return push(info);
    const amp = level() * num(o.attenuation, 1) * P.doneGain;
    if (!(amp > 0.0005)) { silent++; return push(info); }
    const at = n.ctx.currentTime + 0.005;
    tone(n.ctx, n.destination, at, P.doneHz * 1.6, amp, P.doneDecaySeconds, 'sine', P.doneHz);
    info.played = true;
    if (typeof sink.note === 'function') { try { sink.note({ kind: 'gamble_done', gain: amp }); } catch (_) { /* never break a frame */ } }
    return push(info);
  }

  function push(info) {
    recent.push(info);
    if (recent.length > 32) recent.shift();
    return info;
  }

  return {
    start,
    open,
    done,
    update,
    params: () => ({ ...P }),
    setParams,
    rattling: (now) => num(now, 0) <= rattleUntil,
    notes: (n) => {
      const k = Math.max(0, Math.round(Number(n) || 0));
      return k > 0 ? recent.slice(Math.max(0, recent.length - k)) : recent.slice();
    },
    reset() { rattleUntil = -1; nextTick = 0; return true; },
    state: () => ({
      live, started, dropped, silent,
      rattleUntil: Math.round(rattleUntil * 1000) / 1000,
      ...counts,
    }),
  };
}

export default createGambleSynth;
