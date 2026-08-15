// Where the game's events become sounds. This is the ONLY file that knows both
// halves: src/sim/** emits and knows nothing about a speaker, and src/audio/bus
// plays and knows nothing about a duck.
//
// EVENT_MAP below is the contract, and it is machine-checked in both directions
// by coverage() -- gate F-D. A clip in assets/audio/ that no event names is an
// orphan; an event naming a clip that is not on disk is a silent hole. Both are
// reported as failures rather than discovered by a player noticing nothing
// happened.

import { createAudioBus, CLIPS, LOOP_CLIPS } from './bus.js';
import { createSfx } from './sfx.js';
import { createLoops } from './loops.js';
import { createSteps } from './steps.js';
import { createPitSynth } from './pitsynth.js';

// Sounds that are GENERATED, not played back, and therefore deliberately absent
// from CLIPS. coverage() reports them separately so "no file" reads as a design
// decision rather than a hole.
export const SYNTH_MAP = {
  duck_pit: "pit.consumeEvents() returned a 'duck' -- synthesized in pitsynth.js, "
    + 'one scale step higher per duck of the run, sliding back down when scoring stops',
};

// clip -> the event that fires it. One line each, in the words of the thing
// that actually happens, so a reader can check the claim against the code.
export const EVENT_MAP = {
  // --- one-shots -------------------------------------------------------------
  achievement: 'hud.completeStep() advanced an onboarding step',
  box_spill: "containers.consumeEvents() returned a 'spill'",
  // duck_squeak is mapped twice on purpose: contact, and a duck leaking out of
  // a holed container. Both are the same physical event -- a duck being let go.
  broom: "tools.onUse() with mode 'sweep', throttled to audio.sweepIntervalSeconds",
  build_demolish: 'a placed object was demolished (main.doDemolish succeeded)',
  build_invalid: 'a placement was refused (main.doPlace returned a reason)',
  build_place: 'an object was placed (main.doPlace succeeded)',
  build_rotate: 'MMB / [ ] moved the build rotation',
  buy_fail: 'shop.onRefusal() -- a purchase was refused',
  buy_ok: 'shop.onPurchase() -- a purchase went through',
  cash: 'economy.onChange() with a positive delta',
  crank_click: 'one click of the Manual Duck Workbench',
  duck_impact: 'a duck moving faster than audio.impact.minSpeed lost most of its speed in one frame',
  // duck_pit is NOT here: it is synthesized. See SYNTH_MAP above.
  duck_rare: 'the same pit event with tier >= audio.rareTier',
  duck_squeak: 'ducks.onSpawn() -- a duck arrived in the world',
  footstep: "steps.update() crossed a stride of the player's own travel",
  grab: 'hold.onGrab() -- something was picked up with LMB',
  jump_land: 'the player touched down after being airborne',
  machine_eject: 'producers.onEmit() -- a machine spat out a duck',
  machine_jam: 'producers.onJam(), or ducks.onCapRefusal() at the 300 cap',
  pit_burp: 'every audio.pit.burpEveryDucks ducks swallowed, at most one per audio.pit.burpMinSeconds',
  player_fall: "pit.consumeEvents() returned a 'player' -- somebody fell in",
  player_join: 'the net roster grew by a player',
  prestige: 'sessionStats.setPrestige() raised the prestige count',
  session_end: 'endSession() showed the summary screen',
  shop_close: 'the vendor panel closed',
  shop_open: 'the vendor panel opened',
  tab_switch: 'a shop tab was selected',
  throw: 'hold.onThrow(), or Q threw a carried item back into the world',
  tube_drop: 'a purchase fell out of the overhead tube',
  ui_click: 'a shop button or a hotbar slot was clicked',
  ui_hover: 'the pointer entered a shop row',
  // --- loops -----------------------------------------------------------------
  machine_loop: 'producers.info() -- one voice for every running producer',
  fan_loop: 'blowers.info() -- one voice for every placed fan',
  conveyor_loop: 'conveyors.info() -- one voice for every placed belt',
  vacuum_loop: 'collectors.info(), or a beam tool equipped in the hand',
  cart_loop: 'a container prop rolling faster than audio.loops.cartSpeed',
  radio: "the vendor's booth, always on, attenuated by distance",
  world_ambient: 'the world bed, always on',
  pit_ambient: 'the pit mouth, always on, attenuated by distance',
};

export function createGameAudio(deps) {
  const {
    config, world, producers, collectors, conveyors, blowers, containers,
    tools, shop, placed, props, byId, player, listener,
  } = deps;

  const A = config.audio;
  const bus = createAudioBus({ config });
  const ear = typeof listener === 'function'
    ? listener
    : () => (player ? player.eyePosition() : { x: 0, y: 0, z: 0 });
  // Seconds of SIMULATED time. Everything time-based in the audio layer reads
  // this, never the wall clock, so a head-down debugStep run and a real played
  // minute limit voices identically.
  let simClock = 0;
  bus.setClock(() => simClock * 1000);
  const sfx = createSfx({ bus, config, listener: ear });
  const loops = createLoops({ bus, config, listener: ear, attenuation: sfx.attenuation });
  const steps = createSteps({ sfx, config, clock: () => simClock * 1000 });
  // The pit payoff. It plugs into the SAME sfx bus as every sample, takes its
  // level from the duck_pit line in mix.json that Jurek set by ear, and is
  // driven by the simulation clock like everything else in this file.
  const pitSynth = createPitSynth({
    params: A.pit.synth,
    audio: {
      nodes: () => bus.synthNodes(),
      gain: () => bus.clipGain('duck_pit'),
      note: (info) => bus.recordSynth('duck_pit', info.gain),
    },
  });

  let loadReport = null;
  let loadError = null;
  // Loading is deliberately NOT awaited by the caller: the game boots and plays
  // while the clips arrive, and if they never arrive the game is silent.
  const loadPromise = bus.load()
    .then((r) => { loadReport = r; return r; })
    .catch((err) => { loadError = err && err.message ? err.message : String(err); return null; });

  // --- one-shot wiring -------------------------------------------------------

  function at(ev, fallback) {
    if (ev && typeof ev.x === 'number') return { x: ev.x, y: ev.y === undefined ? 0 : ev.y, z: ev.z };
    return fallback;
  }

  const pitAt = { x: config.pit.centerX, y: config.pit.centerY, z: config.pit.centerZ };
  const boothAt = { x: config.booth.x, y: config.booth.y + 1, z: config.booth.z };

  if (world && world.ducks && typeof world.ducks.onSpawn === 'function') {
    world.ducks.onSpawn((id, x, y, z) => sfx.play('duck_squeak', { x, y, z }));
  }
  if (world && world.ducks && typeof world.ducks.onCapRefusal === 'function') {
    world.ducks.onCapRefusal(() => sfx.play('machine_jam', {}));
  }
  if (world && world.hold && typeof world.hold.onGrab === 'function') {
    world.hold.onGrab((ev) => sfx.play('grab', at(ev, undefined)));
    world.hold.onThrow((ev) => sfx.play('throw', at(ev, undefined)));
  }
  if (world && world.economy && typeof world.economy.onChange === 'function') {
    world.economy.onChange((money, delta) => { if (delta > 0) sfx.play('cash', {}); });
  }
  if (producers && typeof producers.onEmit === 'function') {
    producers.onEmit((ev) => sfx.play('machine_eject', at(ev, undefined)));
    producers.onJam((ev) => sfx.play('machine_jam', at(ev, undefined)));
  }
  if (shop && typeof shop.onPurchase === 'function') {
    shop.onPurchase(() => sfx.play('buy_ok', {}));
  }
  if (shop && typeof shop.onRefusal === 'function') {
    shop.onRefusal(() => sfx.play('buy_fail', {}));
  }
  let sweepCooldown = 0;
  if (tools && typeof tools.onUse === 'function') {
    tools.onUse((ev) => {
      if (ev.mode === 'sweep') {
        // A sweep fires every substep for as long as the button is down. The
        // sample is one stroke, so it is spaced out into strokes.
        if (sweepCooldown > 0) return;
        sweepCooldown = A.sweepIntervalSeconds;
        sfx.play('broom', at(ev, undefined));
      } else if (ev.mode === 'hose') {
        sfx.play('throw', at(ev, undefined));
      }
    });
  }

  // --- the events that arrive as drained lists -------------------------------

  let scoredSinceBurp = 0;
  let lastBurpAt = -1e9;

  // Fed the SAME array main.js hands to sessionStats: pit.consumeEvents()
  // drains, so there is exactly one consumer and the audio reads what the
  // summary reads rather than racing it for the same events.
  function notePitEvents(list) {
    if (!list || !list.length) return 0;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const ev = list[i];
      if (ev.type === 'duck') {
        // Not sfx.play(): this one is built out of oscillators so it can climb.
        // The distance gain is computed the same way a sample's would be, and
        // the retrigger window is deliberately NOT applied -- twelve ducks in a
        // frame must be twelve notes going up, which is exactly the case the
        // sample limiter exists to collapse. pitsynth has its own voice cap and
        // spaces the notes out in time instead.
        pitSynth.duck(simClock, { attenuation: sfx.attenuation(pitAt.x, pitAt.y, pitAt.z) });
        if ((ev.tier || 0) >= A.rareTier) sfx.play('duck_rare', pitAt);
        scoredSinceBurp++;
        n++;
      } else if (ev.type === 'player') {
        sfx.play('player_fall', {});
      }
    }
    if (scoredSinceBurp >= A.pit.burpEveryDucks && simClock - lastBurpAt >= A.pit.burpMinSeconds) {
      scoredSinceBurp = 0;
      lastBurpAt = simClock;
      sfx.play('pit_burp', pitAt);
    }
    return n;
  }

  function noteContainerEvents() {
    if (!containers || typeof containers.consumeEvents !== 'function') return 0;
    const list = containers.consumeEvents();
    if (!list.length) return 0;
    let spills = 0;
    let leaks = 0;
    for (let i = 0; i < list.length; i++) {
      const t = list[i].type;
      if (t === 'spill') spills++;
      else if (t === 'leak') leaks++;
    }
    // A spill converts up to six ducks per step; that is one crate emptying,
    // not six. The retrigger window in sfx would collapse them anyway -- this
    // just says so out loud.
    if (spills > 0) sfx.play('box_spill', {});
    // A LEAK is one duck falling out of a holed container, not a crate tipping,
    // so it gets the duck's own squeak rather than the spill clatter. Without
    // this a leaking bucket was completely silent: the row promises the player
    // is losing ducks, and the only feedback was noticing later that the count
    // had dropped. `leak` is a separate event type from `spill` and this branch
    // is the only thing that hears it.
    if (leaks > 0) sfx.play('duck_squeak', {});
    return spills + leaks;
  }

  // --- duck impacts ----------------------------------------------------------
  // Rapier does not hand out contact events for the duck pool (nothing else
  // needs them and turning them on for 300 bodies is not free), so an impact is
  // read off the motion: a duck that was moving fast and is suddenly not hit
  // something.
  const maxDucks = (world && world.ducks && world.ducks.max) || config.ducks.max;
  const prevX = new Float32Array(maxDucks);
  const prevY = new Float32Array(maxDucks);
  const prevZ = new Float32Array(maxDucks);
  const prevSpeed = new Float32Array(maxDucks);
  const seen = new Uint8Array(maxDucks);

  // True while something other than physics is driving this duck: a player's
  // hands, or a container's packing spring. Both look identical to a motion
  // based impact test and neither is a contact.
  // Set by main.js once the network layer exists, because a client has no local
  // hold claims to inspect: its duck is held in the HOST's world and the only
  // record this side of the wire is the roster. Null in single player, where the
  // world's own claims are already the whole truth.
  let heldSource = null;

  function isHeld(id) {
    if (heldSource) { try { if (heldSource(id)) return true; } catch (_) { /* audio never breaks a frame */ } }
    if (!world || !world.ducks) return false;
    const h = typeof world.ducks.handleOf === 'function' ? world.ducks.handleOf(id) : null;
    if (h === null || h === undefined) return false;
    return typeof world.isHeldHandle === 'function' ? world.isHeldHandle(h) : false;
  }

  // When each duck may squeak again, in simulation seconds.
  const nextAt = new Float32Array(maxDucks);
  let clockS = 0;
  let impactCount = 0;

  function noteImpacts(dt) {
    if (!(dt > 0) || !world || !world.ducks || typeof world.ducks.forEach !== 'function') return 0;
    // The simulation clock, not the wall clock. debugStep runs 90 frames in a
    // few milliseconds of real time, so a wall-clock cooldown would swallow
    // almost every squeak in a head-down test and disagree with played
    // behaviour -- the same trap the retrigger window fell into once already.
    clockS += dt;
    let fired = 0;
    world.ducks.forEach((id, x, y, z) => {
      if (id >= maxDucks) return;
      if (!seen[id]) {
        seen[id] = 1;
        prevX[id] = x; prevY[id] = y; prevZ[id] = z; prevSpeed[id] = 0;
        return;
      }
      const speed = Math.hypot(x - prevX[id], y - prevY[id], z - prevZ[id]) / dt;
      const was = prevSpeed[id];
      prevX[id] = x; prevY[id] = y; prevZ[id] = z; prevSpeed[id] = speed;
      if (fired >= A.impact.maxPerFrame) return;
      if (clockS < nextAt[id]) return;
      // A carried duck is not hitting anything. The hold is a critically damped
      // spring, so a duck in your hands is permanently accelerating and
      // decelerating towards the aim point -- which this motion test reads as a
      // collision several times a second. Jurek heard it as a duck squeaking
      // non-stop while being carried. The same applies to a duck packed in a
      // container, which is held to its lattice slot by the same kind of spring.
      if (isHeld(id)) return;
      // Something stopped it: it was moving and most of that is gone in one
      // frame. The threshold is low enough that an ordinary landing counts.
      if (was >= A.impact.minSpeed && speed < was * 0.45) {
        // The squeak is the contact sound. A hard slam also gets the thud
        // underneath it, so a duck dropped from height reads heavier than one
        // nudged along the floor.
        const squeaked = sfx.play('duck_squeak', { x, y, z });
        if (was >= A.impact.hardSpeed) sfx.play('duck_impact', { x, y, z });
        if (squeaked) {
          nextAt[id] = clockS + A.impact.perDuckSeconds;
          fired++; impactCount++;
        }
      }
    });
    return fired;
  }

  // --- loops -----------------------------------------------------------------

  let pollCounter = 0;
  let cartUnits = [];

  function activeProducers() {
    if (!producers || typeof producers.info !== 'function') return [];
    const out = [];
    const units = producers.info();
    for (let i = 0; i < units.length; i++) {
      // A jammed machine has stopped; it should stop sounding like it has not.
      if (units[i].jammed) continue;
      out.push({ x: units[i].x, y: units[i].y, z: units[i].z });
    }
    return out;
  }

  function positionsOf(list, key) {
    const out = [];
    if (!list) return out;
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      const p = key ? u[key] : u;
      if (p && typeof p.x === 'number') out.push({ x: p.x, y: p.y === undefined ? 0 : p.y, z: p.z });
    }
    return out;
  }

  // A container prop being pushed around. Storage rows are the ones with
  // wheels or without; either way a crate sliding across concrete is the sound,
  // and it is selected by the row carrying a storage block, never by an id.
  function rollingContainers() {
    if (!placed || !placed.props || !byId) return [];
    const out = [];
    const speed = A.loops.cartSpeed;
    for (let i = 0; i < placed.props.length; i++) {
      const rec = placed.props[i];
      const row = byId(rec.id);
      if (!row || !row.storage) continue;
      const b = rec.body;
      if (!b || typeof b.linvel !== 'function') continue;
      const v = b.linvel();
      if (Math.hypot(v.x, v.y, v.z) < speed) continue;
      const t = b.translation();
      out.push({ x: t.x, y: t.y, z: t.z });
    }
    return out;
  }

  function pollLoops() {
    loops.set('machine_loop', activeProducers());
    loops.set('fan_loop', positionsOf(blowers && blowers.info ? blowers.info() : [], 'position'));
    loops.set('conveyor_loop', positionsOf(conveyors && conveyors.info ? conveyors.info() : [], 'position'));
    const stations = positionsOf(collectors && collectors.info ? collectors.info() : [], 'intake');
    // A handheld vacuum in your own hands is a vacuum running at zero metres.
    const st = tools && typeof tools.state === 'function' ? tools.state() : null;
    if (st && st.mode === 'beam' && st.pressed) stations.push(ear());
    loops.set('vacuum_loop', stations);
    cartUnits = rollingContainers();
    loops.set('cart_loop', cartUnits);
    // The beds. On from boot, placed where they belong, under everything.
    loops.setAmbient('world_ambient', true);
    loops.setAmbient('pit_ambient', true, pitAt);
    // The vendor's radio is OFF. Asked for flatly: "remove the background song
    // totally". Killed here rather than by zeroing its gain in mix.json, so the
    // clip is never started, never decoded and never scheduled -- a muted loop is
    // still a loop. The clip stays on disk and this one line brings it back.
    loops.setAmbient('radio', false, boothAt);
  }

  // --- per-frame -------------------------------------------------------------

  function update(dt, ctx) {
    const step = Math.max(0, Number(dt) || 0);
    simClock += step;
    if (sweepCooldown > 0) sweepCooldown = Math.max(0, sweepCooldown - step);
    sfx.update();
    if (pollCounter <= 0) {
      pollLoops();
      pollCounter = Math.max(1, Math.round(A.loops.pollFrames));
    }
    pollCounter--;
    loops.update(step);
    noteContainerEvents();
    noteImpacts(step);
    if (player) {
      steps.update(step, {
        position: player.position(),
        grounded: typeof player.grounded === 'function' ? player.grounded() : true,
      });
    }
    return true;
  }

  // --- the events main.js is the only place that sees ------------------------

  const api = {
    bus,
    sfx,
    loops,
    steps,
    pitSynth,
    update,
    notePitEvents,
    resume: () => bus.resume(),
    // Named one-liners rather than a generic play(): the call site in main.js
    // then says what happened, not which file to open.
    crank: () => sfx.play('crank_click', {}),
    placed: (pose) => sfx.play('build_place', pose),
    demolished: (pose) => sfx.play('build_demolish', pose),
    placementRefused: () => sfx.play('build_invalid', {}),
    rotated: () => sfx.play('build_rotate', {}),
    tubeDrop: () => sfx.play('tube_drop', props && props.tubeMouth ? props.tubeMouth() : {}),
    itemThrown: () => sfx.play('throw', {}),
    shopOpened: () => sfx.play('shop_open', {}),
    shopClosed: () => sfx.play('shop_close', {}),
    ui(kind) {
      if (kind === 'tab') return sfx.play('tab_switch', {});
      if (kind === 'hover') return sfx.play('ui_hover', {});
      return sfx.play('ui_click', {});
    },
    // Set by main.js once the network layer exists; see isHeld() above.
    setHeldDuckSource(fn) { heldSource = typeof fn === 'function' ? fn : null; },
    achievement: () => sfx.play('achievement', {}),
    playerJoined: () => sfx.play('player_join', {}),
    sessionEnded: () => sfx.play('session_end', {}),
    prestiged: () => sfx.play('prestige', {}),

    // --- verification -------------------------------------------------------

    // Gate F-D, both directions, as numbers.
    coverage() {
      const mapped = Object.keys(EVENT_MAP);
      const synth = Object.keys(SYNTH_MAP);
      const orphanFiles = CLIPS.filter((c) => mapped.indexOf(c) < 0);
      const eventsWithNoFile = mapped.filter((c) => CLIPS.indexOf(c) < 0);
      const mappedButNotLoaded = mapped.filter((c) => CLIPS.indexOf(c) >= 0 && !bus.hasClip(c));
      // A synthesized sound has no file by design; it would otherwise read as a
      // silent hole. Named here so the gate can tell the two apart.
      const synthWithFile = synth.filter((c) => CLIPS.indexOf(c) >= 0);
      return {
        clipsOnDisk: CLIPS.length,
        eventsMapped: mapped.length,
        synthesized: synth,
        synthWithFile,
        loops: LOOP_CLIPS.length,
        orphanFiles,
        eventsWithNoFile,
        mappedButNotLoaded,
        // The gate: no orphan file, no event pointing at a clip that is not
        // there, and every mapped clip actually decoded.
        pass: orphanFiles.length === 0
          && eventsWithNoFile.length === 0
          && mappedButNotLoaded.length === 0
          // A generated sound must not ALSO be fetched as a sample: that would
          // be two sounds for one event and a wasted download.
          && synthWithFile.length === 0,
        map: { ...EVENT_MAP },
        synthMap: { ...SYNTH_MAP },
      };
    },

    state() {
      return {
        ...bus.state(),
        load: loadReport,
        loadError,
        sfx: sfx.state(),
        loops: loops.state(),
        loopsPlaying: loops.playing(),
        steps: steps.state(),
        counts: bus.counts(),
        denied: bus.denied(),
        impacts: impactCount,
        cartsRolling: cartUnits.length,
        simClock: Math.round(simClock * 1000) / 1000,
        scoredSinceBurp,
        pitSynth: pitSynth.state(simClock),
      };
    },

    log: () => bus.log(),
    clearLog: () => bus.clearLog(),
    ready: () => loadPromise,
    resetStats() { sfx.resetStats(); bus.clearLog(); return true; },
    dispose() { loops.stopAll(); sfx.stopAll(); bus.dispose(); },
  };

  api.debugHooks = () => ({
    audio: api,
    debugAudioState: () => api.state(),
    debugAudioLog: (n) => {
      const l = bus.log();
      const k = Math.max(0, Math.round(Number(n) || 0));
      return k > 0 ? l.slice(Math.max(0, l.length - k)) : l;
    },
    debugAudioCounts: () => bus.counts(),
    debugAudioCoverage: () => api.coverage(),
    debugAudioResume: () => bus.resume(),
    debugAudioReady: () => api.ready(),
    debugAudioReset: () => api.resetStats(),
    // Fire a clip through the real one-shot path, limiter and all. Used to
    // prove the limiter, never to fake an event.
    debugAudioPlay: (clip, opts) => !!sfx.play(clip, opts || {}),
    // The pit payoff, inspectable as numbers: what pitch each duck computed,
    // where the run is, and what it would sound at a given step. Used to PROVE
    // the rise rather than assert it.
    debugPitSynth: () => ({ ...pitSynth.state(simClock), params: pitSynth.params(), simClock }),
    debugPitNotes: (n) => pitSynth.notes(n === undefined ? 24 : n),
    debugPitFreq: (step) => pitSynth.freqForStep(Number(step) || 0),
    // Fire the synth directly, through the real path. Only for tuning; the game
    // never calls this.
    debugPitDuck: (opts) => pitSynth.duck(simClock, opts || {}),
    debugPitParams: (obj) => pitSynth.setParams(obj || {}),
    debugPitReset: () => pitSynth.reset(),
  });

  return api;
}

export default createGameAudio;
