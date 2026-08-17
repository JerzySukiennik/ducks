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
import { createGambleSynth } from './gamblesynth.js';
import { createTruckSynth } from './trucksynth.js';

// Sounds that are GENERATED, not played back, and therefore deliberately absent
// from CLIPS. coverage() reports them separately so "no file" reads as a design
// decision rather than a hole.
export const SYNTH_MAP = {
  duck_pit: "pit.consumeEvents() returned a 'duck', or containers.consumeEvents() "
    + "returned a 'score' -- synthesized in pitsynth.js, one scale step higher per "
    + 'duck of the run, sliding back down when scoring stops',
  gamble_box: 'the gambling box shaking, opening and settling -- synthesized in '
    + 'gamblesynth.js, because the shake lasts exactly config.gamble.shakeSeconds '
    + 'and the payout arpeggio is as long as the prize was big',
};

// Clips that are on disk and deliberately NOT fetched. Reported by coverage() so
// an unused file reads as a decision with a reason rather than as an orphan.
export const UNFETCHED = {
  radio: '826 KB and 103 s -- 36% of everything the page downloads -- for a loop '
    + 'held permanently off ("remove the background song totally"). Fetching and '
    + 'decoding it on every load bought the player a wait and no sound. Putting the '
    + "string back in CLIPS and restoring the setAmbient('radio') line brings it back.",
  duck_pit: 'superseded by the pit synth; its mix.json gain is still the level of '
    + 'the pit sound',
  'cash.legacy': 'the previous cash register, kept',
  'crank_click.legacy': 'the previous ratchet, kept',
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
  cash: 'economy.onChange() with a positive delta, at most one ring per '
    + 'audio.cashMinSeconds with the deltas in between summed into it',
  crank_click: 'one click of the Manual Duck Workbench',
  duck_impact: 'a duck moving faster than audio.impact.minSpeed lost most of its speed in one frame',
  // duck_pit is NOT here: it is synthesized. See SYNTH_MAP above.
  duck_rare: 'the same pit event with tier >= audio.rareTier',
  duck_squeak: 'ducks.onSpawn() -- a duck arrived in the world; also a duck '
    + 'leaking out of a holed container, and a duck absorbed into one',
  footstep: "steps.update() crossed a stride of the player's own travel",
  grab: 'hold.onGrab() -- something was picked up with LMB, or taken from the '
    + 'chute with E, or a carried item was set down without being thrown',
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
  throw: "hold.onThrow(), Q threw a carried item back into the world, or a hose "
    + "or scoop tool was fired",
  tube_drop: 'a purchase fell out of the overhead tube',
  ui_click: 'a shop button or a hotbar slot was clicked',
  ui_hover: 'the pointer entered a shop row',
  // --- loops -----------------------------------------------------------------
  machine_loop: 'producers.info() -- one voice for every running producer',
  fan_loop: 'blowers.info() -- one voice for every placed fan',
  conveyor_loop: 'conveyors.info() -- one voice for every placed belt',
  vacuum_loop: 'collectors.info(), or a beam tool equipped in the hand',
  cart_loop: 'a container prop rolling faster than audio.loops.cartSpeed',
  world_ambient: 'the world bed, always on',
  pit_ambient: 'the pit mouth, always on, attenuated by distance',
};

// Every event type the simulation hands the audio layer, and what this file
// makes of it. The VALUE is the consumer; a null value is an event nobody hears,
// and coverage() fails on one. This is the direction of the gate that was
// missing: the old check compared files against the clip map and passed happily
// while a scored crate, the gambling box, the scoop and the beam made no sound
// at all, because none of those is a missing file -- each is a live event
// falling out of the bottom of a switch.
//
// Adding an emit to the simulation therefore means adding a line here, and if
// the line has no consumer the boot-time gate says so by name.
export const SIM_EVENTS = {
  // pit.consumeEvents()
  'pit:duck': 'payoff() -- the pit synth, one scale step up, plus the burp counter',
  'pit:player': 'player_fall',
  // containers.consumeEvents()
  'containers:spill': 'box_spill, once per batch',
  'containers:leak': 'duck_squeak',
  'containers:score': 'payoff() -- the SAME rising run and burp as a duck that '
    + 'physically fell in; a crate tipped over the pit scores virtually and never '
    + 'reaches pit.consumeEvents()',
  'containers:absorb': 'duck_squeak, trimmed and rate-limited into a texture',
  'containers:refuse': 'machine_jam, rate-limited -- a full container turning a duck away. '
    + 'The same sound a jammed machine makes, because it is the same fact: something '
    + 'upstream is still delivering and this thing cannot take it',
  // tools.onUse()
  'tools:sweep': 'broom, throttled',
  'tools:hose': 'throw',
  'tools:scoop': 'throw, plus duck_squeak when it actually caught something',
  'tools:beam': 'duck_squeak, throttled, over the vacuum loop',
  // gamble.drainEvents(), routed through main.js -- see api.gambleStarted() etc.
  'gamble:gambleStart': 'gamblesynth rattle, accelerating for the whole shake',
  'gamble:gambleOpen': 'gamblesynth pop plus an arpeggio as long as the prize was big',
  'gamble:gambleDone': 'gamblesynth thump -- the box is ready again',
  // the rest, subscribed directly
  'ducks:spawn': 'duck_squeak',
  'ducks:capRefusal': 'machine_jam',
  'hold:grab': 'grab',
  'hold:throw': 'throw',
  'economy:change': 'cash, batched to one ring per audio.cashMinSeconds',
  'producers:emit': 'machine_eject',
  'producers:jam': 'machine_jam',
  'shop:purchase': 'buy_ok',
  'shop:refusal': 'buy_fail',
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
  // The facing the pan is measured against. Everything the game plays is placed
  // relative to where the player is LOOKING, not where they are standing, so the
  // stereo image turns with the camera the way it should. Null in a world with
  // no player (the kinematic fallback), and panFor() then returns dead centre.
  const facing = () => {
    if (!player || typeof player.look !== 'function') return 0;
    const l = player.look();
    return l && typeof l.yaw === 'number' ? l.yaw : 0;
  };
  const sfx = createSfx({ bus, config, listener: ear, facing });
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
  // The gambling box. Same arrangement: the sfx bus, a mix.json level, and the
  // simulation clock.
  const gambleSynth = createGambleSynth({
    params: A.gamble,
    audio: {
      nodes: () => bus.synthNodes(),
      gain: () => bus.clipGain('gamble_box'),
      note: (info) => bus.recordSynth(info.kind || 'gamble_box', info.gain),
    },
  });

  // The truck. Its engine is a running note rather than a clip, so unlike every
  // other sound in this file it has an on and an off rather than a play().
  const truckSynth = createTruckSynth({
    params: A.truck,
    audio: {
      nodes: () => bus.synthNodes(),
      gain: () => bus.clipGain('truck_engine'),
      note: (info) => bus.recordSynth(info.kind || 'truck_engine', info.gain),
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
  // The cash register, BATCHED. It is a 0.9 s clip and it used to fire once per
  // duck with no cooldown of its own: a steady stream off a conveyor put four
  // overlapping tills in the mix at once, which is the sound of a mixer falling
  // over rather than the sound of getting rich. The deltas between rings are
  // summed and carried into the next one, so nothing is lost -- the money reads
  // as one till instead of a pile-up. The retrigger window in sfx.js would have
  // dropped these anyway; the difference is that a DROPPED ring is money you
  // were never told about, where a batched one is money you hear about slightly
  // later.
  let cashPending = 0;
  let cashLastAt = -1e9;
  if (world && world.economy && typeof world.economy.onChange === 'function') {
    world.economy.onChange((money, delta) => { if (delta > 0) cashPending += delta; });
  }
  function pumpCash() {
    if (cashPending <= 0) return 0;
    if (simClock - cashLastAt < A.cashMinSeconds) return 0;
    const paid = cashPending;
    cashPending = 0;
    cashLastAt = simClock;
    // A bigger batch is a slightly louder till, capped: the sound carries how
    // much arrived without a windfall blowing the mix apart.
    const heft = Math.min(1.35, 0.85 + Math.log10(1 + paid) * 0.22);
    sfx.play('cash', { gain: heft, force: true });
    return paid;
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
  // Every tool mode, throttled. `scoop` and `beam` used to reach this switch and
  // fall out of the bottom of it: the events were being emitted and consumed and
  // then nothing happened, which is the quietest kind of bug there is. All four
  // modes fire every substep the button is held, so all four are spaced.
  const toolCooldown = { sweep: 0, scoop: 0, beam: 0 };
  if (tools && typeof tools.onUse === 'function') {
    tools.onUse((ev) => {
      if (ev.mode === 'sweep') {
        // A sweep fires every substep for as long as the button is down. The
        // sample is one stroke, so it is spaced out into strokes.
        if (toolCooldown.sweep > 0) return;
        toolCooldown.sweep = A.sweepIntervalSeconds;
        sfx.play('broom', at(ev, undefined));
      } else if (ev.mode === 'hose') {
        sfx.play('throw', at(ev, undefined));
      } else if (ev.mode === 'scoop') {
        // A scoop takes an armful off the floor. The throw sample is the
        // gathering swing; the squeak is what it gathered, and only when it
        // actually got something.
        if (toolCooldown.scoop > 0) return;
        toolCooldown.scoop = A.scoopIntervalSeconds;
        sfx.play('throw', at(ev, undefined));
        if ((ev.affected || 0) > 0) sfx.play('duck_squeak', at(ev, undefined));
      } else if (ev.mode === 'beam') {
        // The beam already has the vacuum LOOP under it while the button is
        // held; this is the moment a duck actually comes off the floor, which
        // the loop cannot express.
        if (toolCooldown.beam > 0) return;
        toolCooldown.beam = A.beamIntervalSeconds;
        sfx.play('duck_squeak', at(ev, undefined));
      }
    });
  }

  // --- the events that arrive as drained lists -------------------------------

  let scoredSinceBurp = 0;
  let lastBurpAt = -1e9;

  // THE PAYOFF, in one place, because it must be one sound however the duck got
  // there. Called from notePitEvents() for a duck that physically fell in, and
  // from noteContainerEvents() for a duck a container scored over the pit mouth.
  //
  // The second path is the whole automation fantasy and it was SILENT. Tipping a
  // full crate over the pit does not drop bodies through the shaft -- containers
  // score their contents virtually, straight to economy, and emit their own
  // 'score' event -- so it never reached pit.consumeEvents(), never reached the
  // synth, and never counted towards the burp. The most efficient way to score in
  // the game was quieter than dropping the same ducks one at a time, which is
  // exactly backwards: the reward for building the machine was less feedback than
  // doing it by hand.
  function payoff(tier) {
    // Not sfx.play(): this one is built out of oscillators so it can climb. The
    // distance gain is computed the way a sample's would be, and the retrigger
    // window is deliberately NOT applied -- twelve ducks in a frame must be
    // twelve notes going up, which is exactly the case the sample limiter exists
    // to collapse. pitsynth has its own voice cap and spaces the notes out.
    pitSynth.duck(simClock, { attenuation: sfx.attenuation(pitAt.x, pitAt.y, pitAt.z) });
    // Dip the FACTORY under it. Every machine, fan, conveyor and cart the
    // player bought runs on the loop bus, and the sound they bought them for
    // was arriving on top of that rather than through it -- the better the
    // automation, the more thoroughly the payoff was buried by it. The dip is
    // scheduled on a node after the loop bus, so it never touches the ambience
    // slider's own value; see bus.duckLoops().
    bus.duckLoops();
    if ((tier || 0) >= A.rareTier) sfx.play('duck_rare', pitAt);
    scoredSinceBurp++;
  }

  // The pit's digestion, checked after any batch of scoring from either path.
  function pumpBurp() {
    if (scoredSinceBurp >= A.pit.burpEveryDucks && simClock - lastBurpAt >= A.pit.burpMinSeconds) {
      scoredSinceBurp = 0;
      lastBurpAt = simClock;
      sfx.play('pit_burp', pitAt);
      return true;
    }
    return false;
  }

  // Fed the SAME array main.js hands to sessionStats: pit.consumeEvents()
  // drains, so there is exactly one consumer and the audio reads what the
  // summary reads rather than racing it for the same events.
  function notePitEvents(list) {
    if (!list || !list.length) return 0;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const ev = list[i];
      if (ev.type === 'duck') {
        payoff(ev.tier);
        n++;
      } else if (ev.type === 'player') {
        sfx.play('player_fall', {});
      }
    }
    pumpBurp();
    return n;
  }

  let lastAbsorbAt = -1e9;
  let lastRefuseAt = -1e9;

  function noteContainerEvents() {
    if (!containers || typeof containers.consumeEvents !== 'function') return 0;
    const list = containers.consumeEvents();
    if (!list.length) return 0;
    let spills = 0;
    let leaks = 0;
    let scores = 0;
    let absorbs = 0;
    let refusals = 0;
    for (let i = 0; i < list.length; i++) {
      const ev = list[i];
      const t = ev.type;
      if (t === 'spill') spills++;
      else if (t === 'leak') leaks++;
      else if (t === 'score') { payoff(ev.tier); scores++; }
      else if (t === 'absorb') absorbs++;
      else if (t === 'refuse') refusals++;
    }
    // A FULL container turning a duck away. It used to be silent: a belt feeding
    // a full box went on delivering, the ducks piled up at the intake, and the
    // only record was a counter. Same clip as a jammed machine, on the same
    // rate limit as absorb, because a belt pushing at a full box emits one of
    // these every step and it must read as a state rather than a machine gun.
    if (refusals > 0 && simClock - lastRefuseAt >= A.absorbMinSeconds) {
      lastRefuseAt = simClock;
      sfx.play('machine_jam', {});
    }
    // A crate emptied over the pit is now the SAME rising run as the same ducks
    // dropped in by hand, note for note, plus the same burp on the same counter.
    if (scores > 0) pumpBurp();
    // A duck disappearing into a crate had no sound at all -- a collector running
    // flat out swallowed several a second in silence, and the only way to know it
    // was working was to watch a number. It is the duck's own squeak, quiet and
    // rate-limited, because a texture is what this wants to be and not an event.
    if (absorbs > 0 && simClock - lastAbsorbAt >= A.absorbMinSeconds) {
      lastAbsorbAt = simClock;
      sfx.play('duck_squeak', { gain: A.absorbGain });
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
    return spills + leaks + scores + absorbs + refusals;
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
    // The vendor's radio is OFF -- asked for flatly: "remove the background song
    // totally" -- and it is now off at the DOWNLOAD as well as at the mixer. It
    // used to be killed here alone, which meant the player still fetched and
    // decoded 826 KB (36% of the page) of a track that was never scheduled: the
    // wait without the song. It is off the CLIPS list in bus.js now, so this line
    // has nothing left to do. Restoring it means putting 'radio' back into CLIPS
    // and LOOP_CLIPS, back into EVENT_MAP, and calling
    // loops.setAmbient('radio', true, boothAt) here. boothAt is still computed
    // above and is still where it would play from.
  }

  // --- per-frame -------------------------------------------------------------

  function update(dt, ctx) {
    const step = Math.max(0, Number(dt) || 0);
    simClock += step;
    for (const k of Object.keys(toolCooldown)) {
      if (toolCooldown[k] > 0) toolCooldown[k] = Math.max(0, toolCooldown[k] - step);
    }
    sfx.update();
    pumpCash();
    // The shake is a DURATION, so its ticks are laid down per frame rather than
    // by the event that started it.
    gambleSynth.update(simClock);
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
    gambleSynth,
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
    // --- the gambling box ---------------------------------------------------
    // Three calls, matching the three events sim/gamble.js already emits. They
    // are here rather than subscribed because gamble.drainEvents() DRAINS and
    // main.js is its one consumer -- a second consumer in this file would eat
    // the prize before the world could hand it out.
    //
    // `at` is the box's position, so the roll pans and attenuates from where the
    // box actually is; omit it and it plays at the listener.
    // --- the truck -----------------------------------------------------------
    // Driven from the frame loop in main.js, because that is where the truck's
    // speed and the two lever positions are known.
    truckEngineOn: () => truckSynth.engineOn(),
    truckEngineOff: () => truckSynth.stopAll(),
    truckSpeed: (frac, dt) => truckSynth.setSpeed(frac, dt),
    truckGate: (open) => truckSynth.gate(open),
    truckRam: (active, frac) => truckSynth.ram(active, frac),
    truckDump: () => truckSynth.dump(),
    truckState: () => ({ running: truckSynth.running(), rev: truckSynth.rev(), voices: truckSynth.voices() }),
    gambleStarted: (seconds) => gambleSynth.start(simClock, seconds),
    // `size` is 0..1: how big the prize was against the best the table can pay.
    // It makes the arpeggio longer and start higher -- the only sound in the game
    // that carries the VALUE of what happened.
    gambleOpened(size, at) {
      return gambleSynth.open(simClock, {
        size,
        attenuation: at ? sfx.attenuation(at.x, at.y === undefined ? 0 : at.y, at.z) : 1,
      });
    },
    gambleDone(at) {
      return gambleSynth.done(simClock, {
        attenuation: at ? sfx.attenuation(at.x, at.y === undefined ? 0 : at.y, at.z) : 1,
      });
    },

    // --- the small silent ones ----------------------------------------------
    // Picking something up with E was silent while grabbing the SAME object with
    // the mouse played `grab`, which reads as one of the two being broken.
    itemPickedUp: (at) => sfx.play('grab', at || {}),
    // Setting a carried thing down. The same sound a touch quieter and pitched
    // by the deck, so put-down and pick-up are recognisably the same gesture
    // without being the same sound.
    itemDropped: (at) => sfx.play('grab', { ...(at || {}), gain: 0.7 }),
    // Every "you cannot do that", one sound. Five of the seven refusal paths in
    // the game showed a caption and made no noise, so a refusal you were not
    // looking at the top of the screen for did not exist.
    refused: () => sfx.play('build_invalid', {}),

    achievement: () => sfx.play('achievement', {}),
    playerJoined: () => sfx.play('player_join', {}),
    sessionEnded: () => sfx.play('session_end', {}),
    prestiged: () => sfx.play('prestige', {}),

    // --- verification -------------------------------------------------------

    // Gate F-D, both directions, as numbers.
    //
    // Extended with a THIRD direction, because two were not enough. The original
    // gate compared files against the clip map, and passed while the gambling
    // box, a scored crate, the scoop and the beam were all silent -- every one of
    // those is an event the simulation emits that no line in this file consumes,
    // and a file-to-map check cannot see it. SIM_EVENTS below is every event type
    // the audio layer is fed, each named with what it makes; anything listed with
    // no consumer fails the gate.
    coverage() {
      const mapped = Object.keys(EVENT_MAP);
      const synth = Object.keys(SYNTH_MAP);
      const unconsumed = Object.keys(SIM_EVENTS).filter((k) => !SIM_EVENTS[k]);
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
        simEvents: { ...SIM_EVENTS },
        unconsumed,
        unfetched: { ...UNFETCHED },
        // The gate: no orphan file, no event pointing at a clip that is not
        // there, and every mapped clip actually decoded.
        pass: orphanFiles.length === 0
          && eventsWithNoFile.length === 0
          && mappedButNotLoaded.length === 0
          // An event the simulation emits and nothing here hears is a silent
          // hole, and silent holes are what this dimension was losing points for.
          && unconsumed.length === 0
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
        gambleSynth: gambleSynth.state(),
        limiter: bus.limiter(),
        reverb: bus.reverb(),
        duck: bus.duckState(),
        cashPending: Math.round(cashPending * 100) / 100,
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
    // The gambling box, through the real path. Sizes are 0..1.
    //
    // NOT `debugGamble`: main.js already owns that name for STARTING a roll, and
    // audio.debugHooks() is spread last in main.js, so a hook called debugGamble
    // here silently replaces the one that rolls the box. Caught by listing the
    // hooks after wiring; a name collision between two debug surfaces is exactly
    // the kind of thing that is invisible until somebody needs the shadowed one.
    debugGambleSound: (what, size) => {
      if (what === 'open') return gambleSynth.open(simClock, { size: size === undefined ? 0.5 : size });
      if (what === 'done') return gambleSynth.done(simClock, {});
      return gambleSynth.start(simClock, size === undefined ? config.gamble.shakeSeconds : size);
    },
    debugGambleNotes: (n) => gambleSynth.notes(n === undefined ? 16 : n),
    // What variation a clip is set up for, and what the last plays of it
    // actually applied. The evidence that the same sound is never twice the
    // same sound.
    debugAudioVariation: (clip) => {
      const spread = bus.variationFor(clip, LOOP_CLIPS.indexOf(clip) >= 0);
      const plays = bus.log().filter((r) => r.clip === clip);
      const rates = plays.map((r) => r.rate).filter((r) => typeof r === 'number');
      const uniq = new Set(rates.map((r) => Math.round(r * 1e5)));
      let repeats = 0;
      for (let i = 1; i < rates.length; i++) if (rates[i] === rates[i - 1]) repeats++;
      return {
        ...spread,
        plays: plays.length,
        distinctRates: uniq.size,
        consecutiveIdentical: repeats,
        rateMin: rates.length ? Math.min(...rates) : null,
        rateMax: rates.length ? Math.max(...rates) : null,
        gainMin: plays.length ? Math.min(...plays.map((p) => p.gain)) : null,
        gainMax: plays.length ? Math.max(...plays.map((p) => p.gain)) : null,
        rates,
      };
    },
    // The master chain, including how much the limiter is pulling down now.
    debugAudioLimiter: () => bus.limiter(),
    // The room, as it exists in the graph: the convolver, the impulse response
    // that was generated for it, and the send curve as numbers at fixed
    // distances. Nothing here is read back off config.
    debugAudioReverb: () => bus.reverb(),
    debugAudioSend: (meters) => bus.reverbSendFor(meters),
    // The loop bus duck: what the gain node is RIGHT NOW, how many times it has
    // been triggered, and the lowest value seen since boot. Sample it across a
    // pit run and the dip is a measurement rather than a claim.
    debugAudioDuck: () => bus.duckState(),
    // Trigger one directly, through the same call the payoff makes. Only for
    // measuring; the game never calls this.
    debugAudioDuckNow: (opts) => bus.duckLoops(opts || {}),
    // Where every loop's seam actually is, in seconds into its buffer.
    debugAudioLoopPoints: () => bus.loopPoints(),
    // Where a world position lands in the stereo image from where the player is
    // currently looking. -1 hard left, +1 hard right.
    debugAudioPan: (x, y, z) => sfx.panFor(x, y === undefined ? 0 : y, z),
  });

  return api;
}

export default createGameAudio;
