// The machine loops: one voice per machine TYPE, never per instance.
//
// Sixteen presses playing sixteen copies of the same recording is not a
// factory, it is one press through a flanger -- identical samples started at
// different phases comb-filter each other, and it costs sixteen voices to sound
// worse than one. So a type has ONE looping voice whose gain is the nearest
// instance's distance attenuation times count^exponent, capped. More machines
// read as more factory without ever reading as more copies.
//
// Loops fade. A machine starting is a fade in over fadeInSeconds and a machine
// stopping is a fade out; a loop that snaps on reads as a click, and at the
// volumes Jurek set by ear -- 0.05 to 0.1, deliberately under the action -- a
// click would be the loudest thing in the mix.

export function createLoops({ bus, config, listener, attenuation }) {
  const A = config.audio;
  const L = A.loops;

  // name -> { voice, gain, target, units, count, nearest }
  const tracks = new Map();

  function track(name) {
    let t = tracks.get(name);
    if (!t) {
      t = { name, voice: null, gain: 0, target: 0, count: 0, nearest: Infinity, starts: 0, stops: 0 };
      tracks.set(name, t);
    }
    return t;
  }

  function att(x, y, z) {
    if (x === undefined || x === null) return 1;
    return typeof attenuation === 'function' ? attenuation(x, y === undefined ? 0 : y, z) : 1;
  }

  function ear() {
    try {
      const p = typeof listener === 'function' ? listener() : null;
      return p && isFinite(p.x) ? p : null;
    } catch (_) { return null; }
  }

  // units: an array of { x, y, z } for every RUNNING instance of this type, or
  // a count with no positions for a global bed (world_ambient). Called every
  // poll; a type absent from a poll is a type that stopped.
  function set(name, units) {
    const t = track(name);
    const list = units || [];
    t.count = list.length;
    if (t.count === 0) {
      t.target = 0;
      t.nearest = Infinity;
      return t.target;
    }
    let best = 0;
    let nearest = Infinity;
    const e = ear();
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      const a = u && u.x !== undefined ? att(u.x, u.y, u.z) : 1;
      if (a > best) best = a;
      if (e && u && u.x !== undefined) {
        const d = Math.hypot(u.x - e.x, (u.y === undefined ? 0 : u.y) - e.y, u.z - e.z);
        if (d < nearest) nearest = d;
      } else {
        nearest = 0;
      }
    }
    t.nearest = nearest;
    const scale = Math.min(L.maxCountScale, Math.pow(t.count, L.countExponent));
    t.target = best * scale;
    return t.target;
  }

  // A bed that is simply on, at a fixed place or everywhere.
  function setAmbient(name, on, at) {
    return set(name, on ? [at || {}] : []);
  }

  function update(dt) {
    const step = Math.max(0, Number(dt) || 0);
    const upRate = step / Math.max(1e-3, L.fadeInSeconds);
    const downRate = step / Math.max(1e-3, L.fadeOutSeconds);
    let audible = 0;
    tracks.forEach((t) => {
      if (t.gain < t.target) t.gain = Math.min(t.target, t.gain + upRate);
      else if (t.gain > t.target) t.gain = Math.max(t.target, t.gain - downRate);

      if (t.gain > A.minAudibleGain) {
        if (!t.voice) {
          t.voice = bus.start(t.name, 1, { loop: true });
          if (t.voice) t.starts++;
        }
        if (t.voice) {
          bus.setVoiceGain(t.voice, bus.clipGain(t.name) * t.gain);
          audible++;
        }
      } else if (t.voice) {
        // Fully faded: the voice is stopped rather than left running at zero,
        // so an idle factory costs nothing.
        bus.stop(t.voice, 0);
        t.voice = null;
        t.gain = 0;
        t.stops++;
      }
    });
    return audible;
  }

  function state() {
    const out = {};
    tracks.forEach((t) => {
      out[t.name] = {
        count: t.count,
        target: Math.round(t.target * 1e4) / 1e4,
        gain: Math.round(t.gain * 1e4) / 1e4,
        // What actually reaches the bus: the mix.json number times the fade.
        appliedGain: Math.round(bus.clipGain(t.name) * t.gain * 1e5) / 1e5,
        mixGain: bus.clipGain(t.name),
        playing: !!t.voice,
        nearestMeters: isFinite(t.nearest) ? Math.round(t.nearest * 100) / 100 : null,
        starts: t.starts,
        stops: t.stops,
      };
    });
    return out;
  }

  return {
    set,
    setAmbient,
    update,
    state,
    names: () => Array.from(tracks.keys()),
    playing: () => {
      let n = 0;
      tracks.forEach((t) => { if (t.voice) n++; });
      return n;
    },
    stopAll() {
      tracks.forEach((t) => {
        if (t.voice) bus.stop(t.voice, 0);
        t.voice = null;
        t.gain = 0;
        t.target = 0;
      });
      return true;
    },
  };
}

export default createLoops;
