// One-shots, with the two limits that separate a soundscape from a wall of
// noise:
//
//   VOICE LIMITING. Three hundred ducks can land in a single frame. Three
//   hundred simultaneous squeaks is not louder, it is a burst of clipping that
//   costs three hundred buffer sources. The cap is per clip and global, and the
//   retrigger window means a clip fired twenty times in one frame sounds once.
//
//   DISTANCE. A press forty metres away is not the same sound as the one you
//   are standing next to. Attenuation is inverse-distance, computed here rather
//   than through a PannerNode per voice: the game is first person, the scene is
//   forty metres across, and one multiply beats a spatialiser.
//
// Nothing in here throws. A clip that is missing, still loading, or refused by
// the limiter returns null and the caller carries on.

export function createSfx({ bus, config, listener, facing }) {
  const A = config.audio;
  const P = A.pan || {};

  const live = [];              // active one-shot voices
  const perClip = Object.create(null);
  const lastAt = Object.create(null);
  let dropped = 0;
  let droppedByCap = 0;
  let droppedByRetrigger = 0;
  let peakVoices = 0;

  function ear() {
    try {
      const p = typeof listener === 'function' ? listener() : null;
      // All three axes, not just x. A builder measured player.position() coming
      // back with y = NaN after a failed boot; the distance maths then produced
      // a NaN gain for every positional sound and the ENTIRE world went silent
      // with nothing in the console. Checking one axis let exactly that through.
      return (p && isFinite(p.x) && isFinite(p.y) && isFinite(p.z)) ? p : null;
    } catch (_) {
      return null;
    }
  }

  // How far away the event is, or null when it has no position (a menu click is
  // not anywhere). The reverb send needs the metres, not just the attenuation
  // they produce -- two different distances can attenuate the same after the
  // curve flattens and they are not the same amount of room.
  function distanceTo(x, y, z) {
    const e = ear();
    if (!e || x === undefined) return null;
    return Math.hypot(x - e.x, (y === undefined ? 0 : y) - e.y, z - e.z);
  }

  // Inverse-distance with a hard cut. Returns 0 past maxDistance so a far-away
  // event costs nothing at all -- not even a voice.
  function attenuation(x, y, z) {
    const e = ear();
    if (!e || x === undefined) return 1;
    const d = Math.hypot(x - e.x, y - e.y, z - e.z);
    if (d >= A.maxDistance) return 0;
    if (d <= A.refDistance) return 1;
    return A.refDistance / (A.refDistance + A.rolloff * (d - A.refDistance));
  }

  // Left/right, from the azimuth between where the player is LOOKING and where
  // the sound is. The convention is stated in src/sim/player.js and taken from
  // there rather than guessed: "Yaw 0 looks down -Z; right is +X", which its
  // movement code spells as dx = right*cos, dz = -right*sin -- so the RIGHT unit
  // vector is (cos yaw, 0, -sin yaw). The pan is the component of the offset
  // along that vector, normalised by horizontal distance -- the sine of the
  // azimuth, exactly 0 dead ahead and dead behind and +/-1 at the sides.
  //
  // Sign matters and was wrong first time round: derived from the camera instead
  // of from the movement code, it put every sound in the opposite ear, which is
  // worse than mono and which no amount of listening in one direction reveals.
  // Measured against a point at +X with yaw 0, which must be HARD RIGHT.
  //
  // Front and back therefore pan identically, and that is correct for a
  // StereoPannerNode: two speakers cannot express front/back, and pretending
  // otherwise with a filter is a bigger lie than leaving it.
  function panFor(x, y, z) {
    if (!(P.enabled > 0)) return 0;
    if (x === undefined || typeof facing !== 'function') return 0;
    const e = ear();
    if (!e) return 0;
    let yaw;
    try {
      yaw = facing();
    } catch (_) { return 0; }
    if (typeof yaw !== 'number' || !isFinite(yaw)) return 0;
    const dx = x - e.x;
    const dz = z - e.z;
    const flat = Math.hypot(dx, dz);
    // Something at your feet has no direction worth naming, and panning it
    // makes it swing wildly across the head as you turn on the spot.
    const near = Math.max(0.001, P.nearMeters);
    if (flat < 1e-4) return 0;
    const right = (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / flat;
    const fade = Math.min(1, flat / near);
    const w = Math.max(0, Math.min(1, P.width));
    const p = right * fade * w;
    return Math.max(-1, Math.min(1, p));
  }

  function reap() {
    for (let i = live.length - 1; i >= 0; i--) {
      if (live[i].done) {
        perClip[live[i].clip] = Math.max(0, (perClip[live[i].clip] || 1) - 1);
        live.splice(i, 1);
      }
    }
  }

  // opts: { x, y, z } world position (omit for a sound at the listener),
  //       { gain } an extra trim on top of the mix.json gain,
  //       { force } skip the retrigger window (used by nothing that repeats).
  function play(name, opts) {
    const o = opts || {};
    try {
      reap();
      const now = bus.timeMs();
      const since = now - (lastAt[name] === undefined ? -1e9 : lastAt[name]);
      if (!o.force && since < A.minRetriggerMs) { dropped++; droppedByRetrigger++; return null; }
      if ((perClip[name] || 0) >= A.maxVoicesPerClip) { dropped++; droppedByCap++; return null; }
      if (live.length >= A.maxVoices) { dropped++; droppedByCap++; return null; }

      const att = o.x === undefined ? 1 : attenuation(o.x, o.y === undefined ? 0 : o.y, o.z);
      if (att <= 0) { dropped++; return null; }
      const scale = att * (typeof o.gain === 'number' ? o.gain : 1);
      const pan = o.x === undefined ? 0 : panFor(o.x, o.y === undefined ? 0 : o.y, o.z);
      // Metres to the ear, handed to the bus so it can decide how much of this
      // voice goes to the room. Undefined for a sound with no position, which
      // the bus reads as "not in the room" rather than as "zero metres away".
      const distance = o.x === undefined ? undefined : distanceTo(o.x, o.y, o.z);

      const voice = bus.start(name, scale, { loop: false, pan, distance });
      if (!voice) return null;

      // PITCH. A clip played at a different playback rate is the cheapest
      // musical instrument there is, and it is the only way one recording can
      // say 'this is the fourteenth one in a row'. Applied after start rather
      // than passed through the bus because it is a property of THIS voice,
      // not of the clip or of the room.
      if (typeof o.rate === 'number' && isFinite(o.rate) && o.rate > 0) {
        try { voice.source.playbackRate.value = o.rate; } catch (_) { /* no rate on this node */ }
      }
      const rec = { clip: name, voice, done: false, at: now };
      perClip[name] = (perClip[name] || 0) + 1;
      lastAt[name] = now;
      live.push(rec);
      if (live.length > peakVoices) peakVoices = live.length;
      try { voice.source.onended = () => { rec.done = true; }; } catch (_) { rec.done = true; }
      return rec;
    } catch (_) {
      dropped++;
      return null;
    }
  }

  return {
    play,
    attenuation,
    distanceTo,
    panFor,
    // Called once a frame so ended voices are released even when nothing is
    // firing: onended is not guaranteed to run in a backgrounded tab.
    update() { reap(); return live.length; },
    voices: () => live.length,
    state() {
      reap();
      const byClip = {};
      for (let i = 0; i < live.length; i++) byClip[live[i].clip] = (byClip[live[i].clip] || 0) + 1;
      return {
        voices: live.length,
        peakVoices,
        maxVoices: A.maxVoices,
        maxVoicesPerClip: A.maxVoicesPerClip,
        dropped,
        droppedByCap,
        droppedByRetrigger,
        byClip,
      };
    },
    resetStats() {
      dropped = 0; droppedByCap = 0; droppedByRetrigger = 0; peakVoices = live.length;
      return true;
    },
    stopAll() {
      for (let i = 0; i < live.length; i++) bus.stop(live[i].voice, 0);
      live.length = 0;
      for (const k of Object.keys(perClip)) perClip[k] = 0;
      return true;
    },
  };
}

export default createSfx;
