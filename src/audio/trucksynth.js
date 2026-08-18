// The tipper truck, SYNTHESIZED -- for the same reason the pit payoff and the
// gambling box are.
//
// The truck was silent. It is the loudest-looking object in the game: three and
// a half metres of it, a bed that lifts, a tailgate that drops and a load that
// falls out. None of that reached the ears.
//
// Why not samples, and this is the whole argument: AN ENGINE IS NOT AN EVENT.
// Every other sound in this game happens at a moment -- a duck squeaks, a lid
// pops, a till rings -- and a moment is what a clip is good at. An engine is a
// continuous thing whose PITCH IS THE SPEEDOMETER, and the speed is a number
// that changes sixty times a second between 0 and config.vehicle.topSpeed. A
// recording can only be looped and pitch-shifted, which is a seam plus a lie;
// two oscillators told what the speed is cannot be out of step with the truck,
// because they are being handed the same number the wheels are.
//
// Three rules, borrowed from pitsynth.js unchanged: nothing here throws, the
// clock passed in is the SIMULATION clock, and the knobs live in
// config.audio.truck rather than here.

const FALLBACK = {
  // The engine: a low saw for the body of it and a sub an octave down for the
  // weight. Idle is what you hear parked; the span is what full throttle adds.
  idleHz: 42,
  revHz: 96,
  engineGain: 0.16,
  subGain: 0.12,
  // How fast the heard pitch chases the real speed. A truck whose note snapped
  // to its speed would chirp on every kerb; this is the flywheel.
  revLerpPerSecond: 3.5,
  // The tailgate: a short metallic clang, two partials a fifth apart.
  gateHz: 320,
  gateGain: 0.5,
  gateDecaySeconds: 0.32,
  // The bed's ram: a hydraulic whine that only sounds while the bed is MOVING,
  // so letting go of the lever stops it -- which is how the player hears that
  // the lever is a lever and not a button.
  ramHz: 180,
  ramHzEnd: 300,
  ramGain: 0.18,
  // The load going out: filtered noise, as long as the pour lasts.
  dumpGain: 0.5,
  dumpDecaySeconds: 0.7,
  maxVoices: 8,
};

function num(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

export function createTruckSynth({ params, audio }) {
  const P = {};
  for (const k of Object.keys(FALLBACK)) P[k] = num(params && params[k], FALLBACK[k]);

  const nodes = () => (audio && typeof audio.nodes === 'function' ? audio.nodes() : null);
  const gainOf = () => (audio && typeof audio.gain === 'function' ? audio.gain() : 1);
  const note = (info) => { if (audio && typeof audio.note === 'function') audio.note(info); };

  // The running engine, or null. One per game: only the local player drives.
  let engine = null;
  let ramVoice = null;
  let voices = 0;
  let revNow = 0;      // 0..1, the heard rev, chasing the real one
  let revWant = 0;

  function ctxOf() {
    const n = nodes();
    if (!n || !n.ctx || !n.destination) return null;
    return n;
  }

  // --- the engine -------------------------------------------------------------

  function engineOn() {
    if (engine) return false;
    const n = ctxOf();
    if (!n) return false;
    try {
      const ctx = n.ctx;
      const out = ctx.createGain();
      out.gain.value = 0;
      out.connect(n.destination);
      // Sawtooth for the body, sine an octave down for the weight. Two
      // oscillators rather than one because a lone saw at 42 Hz is a buzz and a
      // lone sine is a hum; together they are an engine.
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = P.idleHz;
      const oscGain = ctx.createGain();
      oscGain.gain.value = P.engineGain;
      // A lowpass that opens with the revs, which is most of what makes a real
      // engine sound like it is working rather than just going up in pitch.
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 400;
      filter.Q.value = 0.7;
      osc.connect(oscGain).connect(filter).connect(out);
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.value = P.idleHz / 2;
      const subGain = ctx.createGain();
      subGain.gain.value = P.subGain;
      sub.connect(subGain).connect(out);
      osc.start();
      sub.start();
      // Faded in over a fifth of a second: an engine that appears at full
      // volume is a click.
      out.gain.setTargetAtTime(gainOf(), ctx.currentTime, 0.07);
      engine = { ctx, out, osc, sub, filter };
      revNow = 0;
      revWant = 0;
      note({ kind: 'truck_engine', gain: P.engineGain });
      return true;
    } catch (e) {
      engine = null;
      return false;
    }
  }

  function engineOff() {
    if (!engine) return false;
    const e = engine;
    engine = null;
    try {
      e.out.gain.setTargetAtTime(0, e.ctx.currentTime, 0.08);
      // Stopped a moment after the fade, not with it: stopping an oscillator
      // whose gain has not reached zero is the click this is avoiding.
      const t = e.ctx.currentTime + 0.4;
      e.osc.stop(t);
      e.sub.stop(t);
    } catch (err) { /* the context went away; nothing to stop */ }
    return true;
  }

  // `speedFrac` is 0..1 of the truck's own top speed, and `dt` is how long since
  // the last call. Both come from the frame loop, so the note is driven by the
  // same number the wheels are.
  function setSpeed(speedFrac, dt) {
    revWant = Math.max(0, Math.min(1, num(speedFrac, 0)));
    if (!engine) return revNow;
    const k = Math.min(1, Math.max(0, num(dt, 0)) * P.revLerpPerSecond);
    revNow += (revWant - revNow) * k;
    try {
      const hz = P.idleHz + (P.revHz - P.idleHz) * revNow;
      const t = engine.ctx.currentTime;
      engine.osc.frequency.setTargetAtTime(hz, t, 0.05);
      engine.sub.frequency.setTargetAtTime(hz / 2, t, 0.05);
      engine.filter.frequency.setTargetAtTime(400 + 1600 * revNow, t, 0.08);
      engine.out.gain.setTargetAtTime(gainOf() * (0.7 + 0.3 * revNow), t, 0.1);
    } catch (e) { /* leave the note where it is */ }
    return revNow;
  }

  // --- one-shots --------------------------------------------------------------

  function ping(hz, gain, decay, type) {
    const n = ctxOf();
    if (!n || voices >= P.maxVoices) return false;
    try {
      const ctx = n.ctx;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = type || 'square';
      osc.frequency.setValueAtTime(hz, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, hz * 0.55), t + decay);
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain * gainOf(), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      osc.connect(g).connect(n.destination);
      osc.start(t);
      osc.stop(t + decay + 0.02);
      voices++;
      osc.onended = () => { voices = Math.max(0, voices - 1); };
      return true;
    } catch (e) {
      return false;
    }
  }

  // The tailgate. Two partials a fifth apart struck together, which is what
  // makes a steel flap sound like steel rather than like a beep.
  function gate(open) {
    const hz = open ? P.gateHz : P.gateHz * 0.8;
    const a = ping(hz, P.gateGain, P.gateDecaySeconds, 'square');
    ping(hz * 1.5, P.gateGain * 0.45, P.gateDecaySeconds * 0.7, 'triangle');
    note({ kind: 'truck_gate', gain: P.gateGain });
    return a;
  }

  // The ram, while the bed is moving and only while it is moving. `frac` is how
  // far up the bed is, so the whine RISES as it lifts and falls as it drops --
  // the player can hear which way the lever is going without looking.
  function ram(active, frac) {
    const n = ctxOf();
    if (!n) return false;
    if (!active) {
      if (ramVoice) {
        try {
          ramVoice.out.gain.setTargetAtTime(0, n.ctx.currentTime, 0.05);
          ramVoice.osc.stop(n.ctx.currentTime + 0.25);
        } catch (e) { /* already gone */ }
        ramVoice = null;
      }
      return false;
    }
    const f = Math.max(0, Math.min(1, num(frac, 0)));
    if (!ramVoice) {
      try {
        const ctx = n.ctx;
        const out = ctx.createGain();
        out.gain.value = 0;
        out.connect(n.destination);
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = P.ramHz;
        osc.connect(out);
        osc.start();
        out.gain.setTargetAtTime(P.ramGain * gainOf(), ctx.currentTime, 0.04);
        ramVoice = { ctx, out, osc };
        note({ kind: 'truck_ram', gain: P.ramGain });
      } catch (e) {
        ramVoice = null;
        return false;
      }
    }
    try {
      ramVoice.osc.frequency.setTargetAtTime(
        P.ramHz + (P.ramHzEnd - P.ramHz) * f, ramVoice.ctx.currentTime, 0.06
      );
    } catch (e) { /* leave it */ }
    return true;
  }

  // The load leaving the bed: a short burst of filtered noise, which is what a
  // pile of anything sliding down steel sounds like.
  function dump() {
    const n = ctxOf();
    if (!n || voices >= P.maxVoices) return false;
    try {
      const ctx = n.ctx;
      const t = ctx.currentTime;
      const len = Math.max(0.05, P.dumpDecaySeconds);
      const frames = Math.max(1, Math.floor(ctx.sampleRate * len));
      const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
      const data = buf.getChannelData(0);
      // Deterministic noise: a fixed recurrence rather than Math.random, so two
      // dumps in the same session sound the same and a recording of the game is
      // reproducible.
      let seed = 20260817;
      for (let i = 0; i < frames; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        data[i] = ((seed / 0x7fffffff) * 2 - 1) * (1 - i / frames);
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(900, t);
      filter.frequency.exponentialRampToValueAtTime(220, t + len);
      filter.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.value = P.dumpGain * gainOf();
      src.connect(filter).connect(g).connect(n.destination);
      src.start(t);
      voices++;
      src.onended = () => { voices = Math.max(0, voices - 1); };
      note({ kind: 'truck_dump', gain: P.dumpGain });
      return true;
    } catch (e) {
      return false;
    }
  }

  // --- the contract siren -----------------------------------------------------
  //
  // Two tones alternating, three times. It is the only sound in the game that
  // is not caused by something the player just did, so it is the only one
  // allowed to be an interruption -- and a two-tone alternation is what an
  // alarm is, where a single repeated note is a doorbell.
  function alarm() {
    const n = ctxOf();
    if (!n) return false;
    const P2 = P;
    try {
      const ctx = n.ctx;
      const t0 = ctx.currentTime;
      for (let i = 0; i < 6; i++) {
        const hz = i % 2 === 0 ? 740 : 554;
        const at = t0 + i * 0.19;
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(hz, at);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.30 * gainOf(), at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.17);
        osc.connect(g).connect(n.destination);
        osc.start(at);
        osc.stop(at + 0.2);
      }
      note({ kind: 'contract_alarm', gain: 0.30 });
      return true;
    } catch (e) {
      return false;
    }
  }

  // One duck into the lorry. The pitch CLIMBS with the load, so a player
  // shovelling ducks in hears how close the order is without reading the bar.
  function load(done, of) {
    const t = of > 0 ? Math.max(0, Math.min(1, done / of)) : 0;
    return ping(440 + 660 * t, 0.22, 0.12, 'triangle');
  }

  // The result: a rising pair for a full lorry, a falling one for a lost order.
  function result(ok) {
    if (ok) {
      ping(523, 0.34, 0.24, 'triangle');
      ping(784, 0.30, 0.42, 'triangle');
    } else {
      ping(392, 0.30, 0.30, 'square');
      ping(262, 0.28, 0.50, 'square');
    }
    note({ kind: ok ? 'contract_done' : 'contract_failed', gain: 0.3 });
    return true;
  }

  return {
    alarm,
    load,
    result,
    engineOn,
    engineOff,
    setSpeed,
    gate,
    ram,
    dump,
    running: () => !!engine,
    rev: () => Math.round(revNow * 1000) / 1000,
    voices: () => voices,
    stopAll() { engineOff(); ram(false, 0); },
  };
}

export default createTruckSynth;
