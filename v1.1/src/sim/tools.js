// Handheld tools: the `tool` behaviour block (Broom, Handheld Vacuum).
//
// While a tool is equipped it TAKES OVER the grab button. The rule the rest of
// the game needs is one function: takesGrabButton(). When it is true the caller
// routes the button here instead of into the grab controller; when the tool
// leaves the hand the state machine resets to idle in the same call, so the
// button always comes back. A stuck input mode is the failure this file is
// written to make impossible: unequip() is unconditional and clears everything.
//
// Which behaviour a tool has is DATA, never its id, and it is STATED rather than
// inferred: the row carries `tool.mode` and src/data/index.js makes an unknown
// mode a boot error.
//
//   sweep  pushes everything in the arc. Broom: arc 110 / reach 1.8.
//   beam   takes one duck at a time. Vacuum: arc 20 / reach 4.0.
//   scoop  lifts `tool.capacity` ducks in one use and needs no container.
//
// The arc is still data -- it is the cone half-angle every mode tests against --
// it just does not decide the mode. `tool.pull` inverts the sign of the force
// in whichever mode the row names, so the same three behaviours cover pulling
// tools without a fourth code path.
//
// No three.js, no Rapier import. Every impulse goes through ducks.wakeDuck()
// first, because Rapier does not wake a body when force is applied to it.

// Tunables. The authoritative copy of every value below now lives in the `tools`
// block of src/config.js, and every key is in REQUIRED_CONFIG_KEYS, so a deleted
// key is fatal at boot instead of silently falling back here. This table remains
// as the module's own fallback and is merged key-by-key under config.tools.
export const TOOL_DEFAULTS = {
  // Broom. The arc is measured on the FLOOR, around the player's heading:
  // `reach` is a horizontal distance, because a broom that spent most of its
  // 1.8 m on the 1.6 m drop from the eye to the floor would sweep nothing.
  sweepLift: 0.25,          // fraction of the push that goes upward
  sweepFalloff: 0.5,        // impulse at maximum reach, as a fraction
  sweepMaxAccel: 40,        // m/s2 the bristles may add; floor friction is 13.2
  sweepBelow: 2.2,          // how far under the aim origin the bristles reach
  sweepAbove: 0.6,          // and how far above it
  sweepMaxTargets: 64,
  // Vacuum.
  suckHoldDistance: 1.1,    // where a sucked duck is held, metres along the aim
  suckKp: 60,
  suckKdScale: 2,
  suckMaxSpeed: 12,
  hoseSpeedScale: 1,        // hose impulse = tool.force * this * mass
  // Scoop: a beam that holds tool.capacity ducks instead of one. scoopSpread is
  // the radius of the ring the held ducks sit in around the nozzle; the band is
  // how far under and over the aim origin a scoop reaches, exactly as the broom
  // has one, because a scoop is a floor tool and its reach is horizontal.
  scoopSpread: 0.28,
  scoopBelow: 2.2,
  scoopAbove: 0.6,
  // Only used if config.ducks.mass is missing, which assertConfig makes fatal.
  duckMassFallback: 0.16,
};

const DEG = Math.PI / 180;

function numOr(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

export function resolveToolConfig(config) {
  const src = (config && config.tools) || {};
  const out = {};
  for (const k of Object.keys(TOOL_DEFAULTS)) out[k] = numOr(src[k], TOOL_DEFAULTS[k]);
  out.duckMass = numOr(config && config.ducks && config.ducks.mass, out.duckMassFallback);
  return out;
}

// The closed list, and it must stay identical to KINDS.tool.modes in
// src/data/index.js: the validator refuses an unknown mode at boot and this
// function refuses one at equip time, so the two disagreeing would mean a row
// that boots and then throws in somebody's hands.
export const TOOL_MODES = ['sweep', 'beam', 'scoop'];

export function isToolRow(row) {
  return !!(row && row.kind === 'tool' && row.tool && typeof row.tool.reach === 'number');
}

// Data decides the behaviour, not the id -- and it says so outright. There is
// deliberately no arc-width fallback: every `tool` row is validated at boot to
// carry a known mode, so a row without one cannot reach this function, and a
// fallback would be unreachable code that quietly disagreed with the validator.
export function toolModeOf(row) {
  if (!isToolRow(row)) return null;
  const m = row.tool.mode;
  if (TOOL_MODES.indexOf(m) < 0) {
    throw new Error(
      `[tools] row '${row.id}' has tool.mode ${JSON.stringify(m)}; expected one of ${TOOL_MODES.join(', ')}`
    );
  }
  return m;
}

export function createTools({ ducks, applyImpulse, getAim, config, stepWorld }) {
  if (!ducks) throw new Error('[tools] ducks pool is required');
  const cfg = resolveToolConfig(config);

  let row = null;          // equipped tool row
  let mode = null;         // 'sweep' | 'beam' | 'scoop'
  let pressed = false;
  let heldDuck = null;     // beam tools hold one duck at a time
  let heldMany = [];       // a scoop holds tool.capacity of them
  let scooped = 0;
  let sweeps = 0;
  let sweptDucks = 0;
  let sucked = 0;
  let hosed = 0;
  let lastAffected = 0;
  // What the tool is DOING, announced on the frames it does it. The audio layer
  // needs "the broom just swept" and "the hose is running"; asking it to diff
  // counters every frame would make it guess.
  const useListeners = [];
  function announce(ev) {
    for (let i = 0; i < useListeners.length; i++) {
      try { useListeners[i](ev); } catch (e) { /* ignore */ }
    }
  }

  function aim() {
    const a = typeof getAim === 'function' ? getAim() : null;
    if (!a || !a.dir) return null;
    const l = Math.hypot(a.dir.x, a.dir.y, a.dir.z);
    if (!(l > 1e-6)) return null;
    return {
      origin: a.origin,
      dir: { x: a.dir.x / l, y: a.dir.y / l, z: a.dir.z / l },
    };
  }

  function equip(r) {
    if (!isToolRow(r)) return false;
    if (row && row.id !== r.id) unequip();
    row = r;
    mode = toolModeOf(r);
    pressed = false;
    return true;
  }

  // Unconditional. Whatever the tool was doing stops here, the duck it was
  // holding is dropped where it is, and the grab button goes back to the game.
  function unequip() {
    const had = row !== null;
    if (heldDuck !== null) {
      ducks.wakeDuck(heldDuck);
      heldDuck = null;
    }
    for (let i = 0; i < heldMany.length; i++) ducks.wakeDuck(heldMany[i]);
    heldMany = [];
    row = null;
    mode = null;
    pressed = false;
    return had;
  }

  function takesGrabButton() { return row !== null; }

  function grabDown() {
    if (!row) return false;
    pressed = true;
    if (mode === 'sweep') sweeps++;
    return true;
  }

  // The up edge is what fires a beam tool: hold to suck, let go to hose. A scoop
  // is the same edge with a load instead of a single duck.
  function grabUp() {
    if (!row) return false;
    pressed = false;
    if (mode === 'beam' && heldDuck !== null) hose();
    if (mode === 'scoop' && heldMany.length) hoseAll();
    return true;
  }

  // `tool.pull` inverts the sign of the force: the tool draws ducks towards the
  // player instead of shoving them away. It is one number, applied in one place
  // per mode, and absent means +1 -- which is why the broom and the vacuum
  // behave exactly as they did before the field existed.
  function pullSign() {
    return row && row.tool && row.tool.pull ? -1 : 1;
  }

  function massOf(id) {
    const b = ducks.body(id);
    const m = b && typeof b.mass === 'function' ? b.mass() : cfg.duckMass;
    return m || cfg.duckMass;
  }

  function push(id, dir, speed) {
    const b = ducks.body(id);
    if (!b) return false;
    const m = massOf(id);
    // Wake FIRST. Rapier silently discards an impulse on a sleeping body.
    ducks.wakeDuck(id);
    applyImpulse(b, { x: dir.x * speed * m, y: dir.y * speed * m, z: dir.z * speed * m });
    return true;
  }

  // --- broom -----------------------------------------------------------------

  function sweepStep(dt, a) {
    const reach = row.tool.reach;
    const half = Math.cos((row.tool.arc * 0.5) * DEG);
    const force = row.tool.force;
    // The push is horizontal (a broom does not lift), with a small lift so
    // ducks skip rather than grind along the floor.
    const fl = Math.hypot(a.dir.x, a.dir.z) || 1;
    const heading = { x: a.dir.x / fl, z: a.dir.z / fl };
    // The DRIVE direction may be inverted by `tool.pull`; the cone below is not.
    // You still aim at the ducks you want -- a rake that could only pull what
    // was behind you would be a tool nobody could point.
    const s = pullSign();
    const dir = { x: heading.x * s, y: cfg.sweepLift, z: heading.z * s };
    const dl = Math.hypot(dir.x, dir.y, dir.z);
    dir.x /= dl; dir.y /= dl; dir.z /= dl;

    let hits = 0;
    ducks.forEach((id, x, y, z) => {
      if (hits >= cfg.sweepMaxTargets) return;
      const dx = x - a.origin.x, dy = y - a.origin.y, dz = z - a.origin.z;
      if (dy > cfg.sweepAbove || dy < -cfg.sweepBelow) return;
      const d = Math.hypot(dx, dz);
      if (!(d > 1e-4) || d > reach) return;
      const dot = (dx * heading.x + dz * heading.z) / d;
      if (dot < half) return;
      const t = d / reach;
      const falloff = 1 - (1 - cfg.sweepFalloff) * t;
      // `force` is the speed the bristles drive a duck to, not an acceleration.
      // Read as acceleration it loses to floor friction (0.6 * 22 = 13.2 m/s2)
      // and the duck does not move at all -- measured, 0.000 m over half a
      // second. Driving towards a target speed, capped by sweepMaxAccel, both
      // beats friction and stops the duck from being accelerated forever.
      const b = ducks.body(id);
      if (!b) return;
      const v = b.linvel();
      const along = v.x * dir.x + v.y * dir.y + v.z * dir.z;
      const need = force * falloff - along;
      if (need <= 0) return;
      push(id, dir, Math.min(need, cfg.sweepMaxAccel * dt));
      hits++;
    });
    sweptDucks += hits;
    lastAffected = hits;
    announce({ mode: 'sweep', id: row.id, affected: hits, x: a.origin.x, y: a.origin.y, z: a.origin.z });
    return hits;
  }

  // --- vacuum ----------------------------------------------------------------

  function nearestInBeam(a, exclude) {
    const reach = row.tool.reach;
    const half = Math.cos((row.tool.arc * 0.5) * DEG);
    let best = null;
    let bestD = reach;
    ducks.forEach((id, x, y, z) => {
      if (exclude && exclude.indexOf(id) >= 0) return;
      const dx = x - a.origin.x, dy = y - a.origin.y, dz = z - a.origin.z;
      const d = Math.hypot(dx, dy, dz);
      if (!(d > 1e-4) || d > reach || d >= bestD) return;
      if ((dx * a.dir.x + dy * a.dir.y + dz * a.dir.z) / d < half) return;
      bestD = d;
      best = id;
    });
    return best;
  }

  function nozzle(a) {
    return {
      x: a.origin.x + a.dir.x * cfg.suckHoldDistance,
      y: a.origin.y + a.dir.y * cfg.suckHoldDistance,
      z: a.origin.z + a.dir.z * cfg.suckHoldDistance,
    };
  }

  // Drive one duck towards a point with the critically damped spring both the
  // beam and the scoop use. Wakes first, every time.
  function springTo(id, target, dt) {
    const KD = cfg.suckKdScale * Math.sqrt(cfg.suckKp);
    const b = ducks.body(id);
    if (!b) return false;
    const p = b.translation();
    const v = b.linvel();
    const m = massOf(id);
    const ix = (cfg.suckKp * (target.x - p.x) - KD * v.x) * m * dt;
    const iy = (cfg.suckKp * (target.y - p.y) - KD * v.y) * m * dt;
    const iz = (cfg.suckKp * (target.z - p.z) - KD * v.z) * m * dt;
    ducks.wakeDuck(id);
    applyImpulse(b, { x: ix, y: iy, z: iz });
    const nx = v.x + ix / m, ny = v.y + iy / m, nz = v.z + iz / m;
    const s = Math.hypot(nx, ny, nz);
    if (s > cfg.suckMaxSpeed) {
      const k = cfg.suckMaxSpeed / s;
      b.setLinvel({ x: nx * k, y: ny * k, z: nz * k }, true);
    }
    return true;
  }

  function beamStep(dt, a) {
    if (heldDuck !== null && !ducks.isActive(heldDuck)) heldDuck = null;
    if (heldDuck === null) {
      const id = nearestInBeam(a);
      if (id === null) { lastAffected = 0; return 0; }
      heldDuck = id;
      sucked++;
    }
    const target = nozzle(a);
    if (!springTo(heldDuck, target, dt)) { heldDuck = null; lastAffected = 0; return 0; }
    lastAffected = 1;
    announce({ mode: 'beam', id: row.id, affected: 1, x: target.x, y: target.y, z: target.z });
    return 1;
  }

  // --- scoop -----------------------------------------------------------------
  //
  // A scoop is a beam that takes a LOAD: it lifts up to `tool.capacity` ducks in
  // one use and needs no container to do it. The capacity comes off the row and
  // is required there by src/data/index.js, so there is no default here to
  // disagree with the data.

  // An orthonormal pair perpendicular to the aim, so the load can be held in a
  // ring around the nozzle rather than all at one point -- N ducks sharing one
  // target would fight each other for it forever.
  function perpBasis(dir) {
    const up = Math.abs(dir.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    let rx = dir.y * up.z - dir.z * up.y;
    let ry = dir.z * up.x - dir.x * up.z;
    let rz = dir.x * up.y - dir.y * up.x;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    return {
      r: { x: rx, y: ry, z: rz },
      u: {
        x: ry * dir.z - rz * dir.y,
        y: rz * dir.x - rx * dir.z,
        z: rx * dir.y - ry * dir.x,
      },
    };
  }

  // What a scoop can reach. Measured the way the BROOM's reach is measured --
  // horizontal distance around the player's heading, inside a vertical band --
  // and deliberately not the way the beam's is, for the reason already written
  // at the top of sweepStep: the aim origin is the eye, 1.62 m up, so a floor
  // duck is never closer than ~1.44 m in 3D. A scoop is a floor tool (a dustpan
  // held at arm's length); measured in 3D, `reach: 1.2` would describe a tool
  // that can literally never touch the ground, and the row would look like a
  // balance mistake rather than a geometry one. Measured horizontally, 1.2 m
  // means 1.2 m of floor in front of you, which is what the number reads as.
  function scoopTargets(a, exclude, want) {
    const reach = row.tool.reach;
    const half = Math.cos((row.tool.arc * 0.5) * DEG);
    const fl = Math.hypot(a.dir.x, a.dir.z) || 1;
    const hx = a.dir.x / fl;
    const hz = a.dir.z / fl;
    const found = [];
    ducks.forEach((id, x, y, z) => {
      if (exclude && exclude.indexOf(id) >= 0) return;
      const dx = x - a.origin.x, dy = y - a.origin.y, dz = z - a.origin.z;
      if (dy > cfg.scoopAbove || dy < -cfg.scoopBelow) return;
      const d = Math.hypot(dx, dz);
      if (!(d > 1e-4) || d > reach) return;
      if ((dx * hx + dz * hz) / d < half) return;
      found.push({ id, d });
    });
    // Nearest first: a scoop takes what is under it before what is at its rim.
    found.sort((p, q) => p.d - q.d);
    return found.slice(0, want).map((f) => f.id);
  }

  function scoopCapacity() {
    const c = row && row.tool ? row.tool.capacity : undefined;
    return Math.max(1, Math.round(typeof c === 'number' ? c : 1));
  }

  function scoopStep(dt, a) {
    const cap = scoopCapacity();
    for (let i = heldMany.length - 1; i >= 0; i--) {
      if (!ducks.isActive(heldMany[i])) heldMany.splice(i, 1);
    }
    // ONE USE takes a full load: the whole capacity is filled on the step the
    // button goes down, from whatever is inside the arc, rather than one duck
    // per frame.
    if (heldMany.length < cap) {
      const take = scoopTargets(a, heldMany, cap - heldMany.length);
      for (let i = 0; i < take.length; i++) {
        heldMany.push(take[i]);
        sucked++;
        scooped++;
      }
    }
    if (!heldMany.length) { lastAffected = 0; return 0; }
    const base = nozzle(a);
    const b = perpBasis(a.dir);
    const ring = Math.max(1, heldMany.length - 1);
    let hits = 0;
    for (let i = 0; i < heldMany.length; i++) {
      let target = base;
      if (i > 0) {
        const ang = ((i - 1) / ring) * Math.PI * 2;
        const cx = Math.cos(ang) * cfg.scoopSpread;
        const cy = Math.sin(ang) * cfg.scoopSpread;
        target = {
          x: base.x + b.r.x * cx + b.u.x * cy,
          y: base.y + b.r.y * cx + b.u.y * cy,
          z: base.z + b.r.z * cx + b.u.z * cy,
        };
      }
      if (springTo(heldMany[i], target, dt)) hits++;
    }
    lastAffected = hits;
    announce({ mode: 'scoop', id: row.id, affected: hits, x: base.x, y: base.y, z: base.z });
    return hits;
  }

  // The force sign applies here too: a `pull` beam draws its duck back in
  // instead of firing it away when the button comes up.
  function hose() {
    if (heldDuck === null) return false;
    const a = aim();
    const id = heldDuck;
    heldDuck = null;
    if (!a) { ducks.wakeDuck(id); return false; }
    push(id, a.dir, row.tool.force * cfg.hoseSpeedScale * pullSign());
    hosed++;
    announce({ mode: 'hose', id: row.id, affected: 1, x: a.origin.x, y: a.origin.y, z: a.origin.z });
    return true;
  }

  // A scoop puts its whole load down at once. `force` 0 is a legal row and means
  // exactly what it says: the ducks are released where they are held, and they
  // fall, rather than being thrown.
  function hoseAll() {
    if (!heldMany.length) return 0;
    const a = aim();
    const load = heldMany;
    heldMany = [];
    const speed = row.tool.force * cfg.hoseSpeedScale * pullSign();
    for (let i = 0; i < load.length; i++) {
      if (a && speed !== 0) push(load[i], a.dir, speed);
      else ducks.wakeDuck(load[i]);
    }
    hosed += load.length;
    if (a) announce({ mode: 'hose', id: row.id, affected: load.length, x: a.origin.x, y: a.origin.y, z: a.origin.z });
    return load.length;
  }

  // Runs BEFORE world.step(), with the other impulse sources.
  function stepTool(dt) {
    if (!row || !pressed) { if (!pressed) lastAffected = 0; return 0; }
    const a = aim();
    if (!a) return 0;
    if (mode === 'sweep') return sweepStep(dt, a);
    if (mode === 'scoop') return scoopStep(dt, a);
    return beamStep(dt, a);
  }

  // debugUse() drives the tool by hand AND pumps the caller's physics step, and
  // that step is the same one the game subscribes this module to. Without this
  // guard every debug substep would apply the tool twice -- once from the loop,
  // once from debugUse -- and every measured number would be off by 2x.
  let inDebugUse = false;
  function fixedUpdate(dt) {
    if (inDebugUse) return 0;
    return stepTool(dt);
  }

  function state() {
    return {
      equipped: row ? row.id : null,
      kind: row ? row.kind : null,
      mode,
      pressed,
      takesGrabButton: takesGrabButton(),
      heldDuck,
      held: heldMany.slice(),
      heldCount: heldMany.length,
      capacity: row && row.tool && typeof row.tool.capacity === 'number' ? row.tool.capacity : null,
      pull: !!(row && row.tool && row.tool.pull),
      reach: row ? row.tool.reach : null,
      arc: row ? row.tool.arc : null,
      force: row ? row.tool.force : null,
      sweeps,
      sweptDucks,
      sucked,
      scooped,
      hosed,
      lastAffected,
    };
  }

  const api = {
    equip,
    unequip,
    takesGrabButton,
    grabDown,
    grabUp,
    hose,
    hoseAll,
    onUse(cb) { if (typeof cb === 'function') useListeners.push(cb); },
    state,
    equipped: () => row,
    mode: () => mode,
    heldDuck: () => heldDuck,
    config: cfg,

    // Debug: run the tool's action for `seconds` with the button held, without
    // needing a hand on the mouse. `stepWorld` is the caller's physics step: the
    // impulses have to be integrated between substeps or they just pile up in
    // one solver call and the measurement means nothing.
    debugUse(seconds, step, fixedDt) {
      if (!row) return { ok: false, reason: 'no tool equipped' };
      const pump = typeof step === 'function' ? step : stepWorld;
      const dt = numOr(fixedDt, numOr(config && config.loop && config.loop.fixedDt, 1 / 60));
      const n = Math.max(1, Math.round(numOr(seconds, dt) / dt));
      const wasPressed = pressed;
      grabDown();
      let affected = 0;
      inDebugUse = true;
      try {
        for (let i = 0; i < n; i++) {
          affected += stepTool(dt);
          if (typeof pump === 'function') pump(dt);
        }
      } finally {
        inDebugUse = false;
      }
      if (!wasPressed) grabUp();
      return { ok: true, steps: n, affected, state: state() };
    },

    _fixedUpdate: fixedUpdate,
  };

  // The two hooks this phase owes window.GAME.
  api.debugHooks = () => ({
    debugToolState: () => api.state(),
    debugSweep: (seconds, step) => api.debugUse(seconds, step),
  });

  return api;
}

export default createTools;
