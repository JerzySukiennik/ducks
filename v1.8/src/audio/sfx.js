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

export function createSfx({ bus, config, listener }) {
  const A = config.audio;

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
      return p && isFinite(p.x) ? p : null;
    } catch (_) {
      return null;
    }
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

      const voice = bus.start(name, scale, { loop: false });
      if (!voice) return null;

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
