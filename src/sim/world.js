// Rapier simulation layer: fixed-timestep world, ground plate, duck pool, pit,
// grab controller and money. Renderer-agnostic on purpose -- nothing here, or
// anywhere under src/sim, may import three.js.

import RAPIER from '@dimforge/rapier3d-compat';
import { createPlayer } from './player.js';
import { createDucks } from './ducks.js';
import { createPit } from './pit.js';
import { createHold } from './hold.js';
import { createEconomy } from './economy.js';

// Collision groups (Rapier packs membership in the high 16 bits, filter in the low 16).
export const GROUP_WORLD = 0x0001;
export const GROUP_PROP = 0x0002;
export const GROUP_PLAYER = 0x0004;

export function interactionGroups(membership, filter) {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

// A sleeping body ignores forces/impulses; every push path must wake it first.
export function wakeBody(body) {
  if (body) body.wakeUp();
  return body;
}

// The sim reads config.js directly, with no defaults: a missing key is a bug in
// the config, and a silent fallback would make later tuning a dead letter.
export const SIM_CONFIG_KEYS = [
  'world.gravity.y',
  'world.plateSize',
  'world.plateThickness',
  'world.plateFriction',
  'loop.fixedDt',
  'loop.maxSubsteps',
  'player.radius',
  'player.height',
  'player.eyeHeight',
  'player.walkSpeed',
  'player.sprintMultiplier',
  'player.jumpSpeed',
  'ducks.max',
  'ducks.halfExtentX',
  'ducks.halfExtentY',
  'ducks.halfExtentZ',
  'ducks.mass',
  'ducks.sleepAfter',
  'pit.radius',
  'pit.segments',
  'pit.shaftDepth',
  'pit.scoreDepth',
  'hold.kp',
  'hold.breakDistance',
  'hold.distanceMin',
  'hold.distanceMax',
  'hold.throwImpulse',
  'economy.duckBaseValue',
];

function num(root, path) {
  let node = root;
  const parts = path.split('.');
  for (let i = 0; i < parts.length; i++) {
    if (node === null || typeof node !== 'object' || !(parts[i] in node)) node = undefined;
    else node = node[parts[i]];
    if (node === undefined) break;
  }
  if (typeof node !== 'number' || !isFinite(node)) {
    throw new Error(`[sim] config.${path} is missing or not a finite number`);
  }
  return node;
}

function numArray(root, path, length) {
  let node = root;
  const parts = path.split('.');
  for (let i = 0; i < parts.length; i++) {
    if (node === null || typeof node !== 'object') node = undefined;
    else node = node[parts[i]];
    if (node === undefined) break;
  }
  if (!Array.isArray(node) || node.length !== length) {
    throw new Error(`[sim] config.${path} must be an array of ${length} numbers`);
  }
  for (let i = 0; i < length; i++) {
    if (typeof node[i] !== 'number' || !isFinite(node[i])) {
      throw new Error(`[sim] config.${path}[${i}] is not a finite number`);
    }
  }
  return node.slice();
}

function resolveCfg(cfg) {
  const c = cfg || {};
  const missing = SIM_CONFIG_KEYS.filter((k) => {
    try { num(c, k); return false; } catch (e) { return true; }
  });
  if (missing.length) {
    throw new Error('[sim] config keys missing: ' + missing.join(', '));
  }
  const walkSpeed = num(c, 'player.walkSpeed');
  return {
    gravity: num(c, 'world.gravity.y'),
    fixedDt: num(c, 'loop.fixedDt'),
    maxSubsteps: num(c, 'loop.maxSubsteps'),
    radius: num(c, 'player.radius'),
    height: num(c, 'player.height'),
    eyeHeight: num(c, 'player.eyeHeight'),
    walkSpeed,
    sprintSpeed: walkSpeed * num(c, 'player.sprintMultiplier'),
    jumpSpeed: num(c, 'player.jumpSpeed'),
    plateSize: num(c, 'world.plateSize'),
    plateFriction: num(c, 'world.plateFriction'),
    plateThickness: num(c, 'world.plateThickness'),
  };
}

function resolveDucks(c) {
  return {
    max: Math.max(1, Math.round(num(c, 'ducks.max'))),
    hx: num(c, 'ducks.halfExtentX'),
    hy: num(c, 'ducks.halfExtentY'),
    hz: num(c, 'ducks.halfExtentZ'),
    // Second cuboid for the head; see the profile table in config.js.
    headHalfX: num(c, 'ducks.headHalfX'),
    headHalfY: num(c, 'ducks.headHalfY'),
    headHalfZ: num(c, 'ducks.headHalfZ'),
    headOffsetX: num(c, 'ducks.headOffsetX'),
    headOffsetY: num(c, 'ducks.headOffsetY'),
    mass: num(c, 'ducks.mass'),
    restitution: num(c, 'ducks.restitution'),
    friction: num(c, 'ducks.friction'),
    linearDamping: num(c, 'ducks.linearDamping'),
    angularDamping: num(c, 'ducks.angularDamping'),
    sleepAfter: num(c, 'ducks.sleepAfter'),
    sleepLinearEps: num(c, 'ducks.sleepLinearEps'),
    sleepAngularEps: num(c, 'ducks.sleepAngularEps'),
    parkY: num(c, 'ducks.parkY'),
    useConvexHull: num(c, 'ducks.useConvexHull') !== 0,
    multipliers: numArray(c, 'rarity.multipliers', 25),
    weights: numArray(c, 'rarity.weights', 25),
  };
}

function resolvePit(c, plateThickness) {
  return {
    center: { x: num(c, 'pit.centerX'), y: num(c, 'pit.centerY'), z: num(c, 'pit.centerZ') },
    radius: num(c, 'pit.radius'),
    segments: Math.max(3, Math.round(num(c, 'pit.segments'))),
    wallThickness: num(c, 'pit.wallThickness'),
    wallFriction: num(c, 'pit.wallFriction'),
    wallRestitution: num(c, 'pit.wallRestitution'),
    shaftDepth: num(c, 'pit.shaftDepth'),
    scoreDepth: num(c, 'pit.scoreDepth'),
    captureMargin: num(c, 'pit.captureMargin'),
    rimReach: num(c, 'pit.rimReach'),
    plateHoleHalf: num(c, 'pit.plateHoleHalf'),
    playerFallDepth: num(c, 'pit.playerFallDepth'),
    playerFallSeconds: num(c, 'pit.playerFallSeconds'),
    playerRespawn: { x: num(c, 'pit.respawnX'), y: num(c, 'pit.respawnY'), z: num(c, 'pit.respawnZ') },
    plateThickness,
  };
}

function resolveHold(c) {
  return {
    kp: num(c, 'hold.kp'),
    kdScale: num(c, 'hold.kdScale'),
    maxSpeed: num(c, 'hold.maxSpeed'),
    breakDistance: num(c, 'hold.breakDistance'),
    distanceDefault: num(c, 'hold.distanceDefault'),
    distanceMin: num(c, 'hold.distanceMin'),
    distanceMax: num(c, 'hold.distanceMax'),
    distanceStep: num(c, 'hold.distanceStep'),
    grabRange: num(c, 'hold.grabRange'),
    throwImpulse: num(c, 'hold.throwImpulse'),
    heldLinearDamping: num(c, 'hold.heldLinearDamping'),
    heldAngularDamping: num(c, 'hold.heldAngularDamping'),
    ccdOnThrow: num(c, 'hold.ccdOnThrow') !== 0,
    fallbackMass: num(c, 'hold.fallbackMass'),
  };
}

// The second pit's shape is the FIRST pit's, with only the handful of things
// config.pit2 actually states overridden. Two copies of a shaft's geometry
// would drift apart the first time either was tuned, and the drift would show
// up as a hole that eats ducks slightly differently from the other hole.
//
// `edge` is which side of the plate it sits on, 0..3, and `along` is where it
// sits on that side, -1..1. Both come from the caller -- the host rolls them
// and tells its clients -- because a hole that is somewhere else on every
// machine is not the same world.
// Where the second pit MAY be: the middle of each of the four plate edges,
// out at config.pit2.distance from the middle -- see that key for why it is a
// distance and not an inset. Four ends of the map, which is how the choice is
// described to the player, so there is no position along an edge to get wrong.
export function pit2Sockets(cfg) {
  const d = num(cfg, 'pit2.distance');
  //  0 north (-z)   1 east (+x)   2 south (+z)   3 west (-x)
  return [
    { x: 0, z: -d }, { x: d, z: 0 }, { x: 0, z: d }, { x: -d, z: 0 },
  ];
}

function resolvePit2(cfg, base, edge, along) {
  const c2 = cfg.pit2;
  if (!c2 || !c2.enabled) return null;
  const e = ((Math.round(edge) % 4) + 4) % 4;
  const centre = pit2Sockets(cfg)[e];
  return {
    ...base,
    center: { x: centre.x, y: base.center.y, z: centre.z },
    radius: num(cfg, 'pit2.radius'),
    plateHoleHalf: num(cfg, 'pit2.plateHoleHalf'),
    payMul: num(cfg, 'pit2.payMul'),
    name: 'pit2',
    edge: e,
  };
}

export async function createWorld(cfg, opts) {
  await RAPIER.init();
  const P = resolveCfg(cfg);
  const DCFG = resolveDucks(cfg);
  const PITCFG = resolvePit(cfg, P.plateThickness * 0.5);
  const o = opts || {};
  const PIT2CFG = resolvePit2(cfg, PITCFG,
    o.pit2Edge === undefined ? 0 : o.pit2Edge,
    o.pit2Along === undefined ? 0 : o.pit2Along);
  const HCFG = resolveHold(cfg);

  const world = new RAPIER.World({ x: 0, y: P.gravity, z: 0 });
  world.timestep = P.fixedDt;

  const GROUPS = { GROUP_WORLD, GROUP_PROP, GROUP_PLAYER, interactionGroups };
  const worldGroups = interactionGroups(
    GROUP_WORLD, GROUP_WORLD | GROUP_PROP | GROUP_PLAYER
  );

  // Ground plate: four static slabs leaving a square opening around the pit.
  // The opening is then narrowed to an exact 32-gon by the pit's rim slabs;
  // a single cuboid could not have a hole at all.
  const plateHalfThickness = P.plateThickness * 0.5;
  const plateBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -plateHalfThickness, 0)
  );
  const S = P.plateSize / 2;
  const h = PITCFG.plateHoleHalf;
  const cx = PITCFG.center.x;
  const cz = PITCFG.center.z;

  function plateSlab(x0, x1, z0, z1) {
    if (!(x1 > x0) || !(z1 > z0)) return null;
    return world.createCollider(
      RAPIER.ColliderDesc.cuboid((x1 - x0) / 2, plateHalfThickness, (z1 - z0) / 2)
        .setTranslation((x0 + x1) / 2, 0, (z0 + z1) / 2)
        .setFriction(P.plateFriction)
        .setCollisionGroups(worldGroups),
      plateBody
    );
  }
  // THE PLATE IS A GRID CUT AROUND EVERY HOLE, not four bands around one.
  //
  // It used to be exactly four slabs: two full-width bands north and south of
  // the pit and two fillers either side of it. That is the smallest possible
  // description of a floor with ONE hole in it, and it stops working the moment
  // there are two -- which there now are, because the second pit lands at a
  // randomly chosen edge every run and could be anywhere along it.
  //
  // So the cut lines of every hole are collected on each axis, the plate is
  // divided into the grid those lines make, and any cell whose centre falls
  // inside a hole is simply not built. One hole gives back the same four bands
  // (as a 3x3 grid with the middle missing); two give at most twenty-four
  // cells. They are colliders on one static body either way, so the cost is a
  // handful of boxes and not a rigid body each.
  const plateHoles = [{ x: cx, z: cz, h }];
  // ALL FOUR SOCKETS ARE CUT, and three of them are lidded.
  //
  // The second pit lands on one of the four edges and the choice is rolled
  // every run -- but the plate is built once, at boot, before anyone has
  // rolled anything or joined a room. Cutting the hole where the pit turned
  // out to be would mean rebuilding the floor mid-session. So every candidate
  // is cut, a LID is dropped into each, and the run simply lifts one. Moving
  // the pit is then two collider flags and sixty-four translations, with no
  // geometry built or destroyed at all.
  const sockets = PIT2CFG ? pit2Sockets(cfg) : [];
  for (const sk of sockets) plateHoles.push({ x: sk.x, z: sk.z, h: PIT2CFG.plateHoleHalf });

  function cutLines(axis) {
    const set = [-S, S];
    for (const hole of plateHoles) {
      const c = axis === 'x' ? hole.x : hole.z;
      // A hole that runs off the plate edge contributes only the cut that is
      // actually on the plate; clamping keeps the grid inside its own bounds.
      set.push(Math.max(-S, Math.min(S, c - hole.h)));
      set.push(Math.max(-S, Math.min(S, c + hole.h)));
    }
    return Array.from(new Set(set.map((v) => Math.round(v * 1e6) / 1e6))).sort((a, b) => a - b);
  }

  const xs = cutLines('x');
  const zs = cutLines('z');
  let plateSlabCount = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < zs.length - 1; j++) {
      const mx = (xs[i] + xs[i + 1]) / 2;
      const mz = (zs[j] + zs[j + 1]) / 2;
      let inHole = false;
      for (const hole of plateHoles) {
        if (Math.abs(mx - hole.x) < hole.h && Math.abs(mz - hole.z) < hole.h) { inHole = true; break; }
      }
      if (inHole) continue;
      if (plateSlab(xs[i], xs[i + 1], zs[j], zs[j + 1])) plateSlabCount++;
    }
  }

  // One lid per socket, filling its hole exactly. All four start solid; the
  // run opens the one it rolled.
  const socketLids = sockets.map((sk) => world.createCollider(
    RAPIER.ColliderDesc.cuboid(PIT2CFG.plateHoleHalf, plateHalfThickness, PIT2CFG.plateHoleHalf)
      .setTranslation(sk.x, 0, sk.z)
      .setFriction(P.plateFriction)
      .setCollisionGroups(worldGroups),
    plateBody
  ));

  // Machine registration. A machine is scenery with a solid box: it gets a
  // collider on the EXISTING plate body rather than a body of its own, so the
  // boot-constant rigid-body count stays exactly what it was.
  // `yaw` is the box's rotation about Y. A collider carries its OWN rotation
  // relative to its parent body, so a rotated wall gets a rotated collider and
  // not the axis-aligned box drawn around it. Without this every wall placed at
  // an angle blocked a wider footprint than it drew -- invisible at 0 and 90
  // degrees, worst at 45, and exactly the kind of mismatch that makes a player
  // think the tunnel they built is haunted.
  // `pitch` tilts the box about its own X after the yaw, which is what turns a
  // ramp into something a duck can roll down. Without it a ramp is a solid
  // upright block: a duck can only ever be on top of it, there is no bottom of
  // the slope to climb from, and the piece silently does nothing at all.
  function addStaticBox(box) {
    const desc = RAPIER.ColliderDesc.cuboid(box.hx, box.hy, box.hz)
      .setTranslation(box.x, box.y + plateHalfThickness, box.z)
      .setFriction(typeof box.friction === 'number' ? box.friction : 0.9)
      .setCollisionGroups(typeof box.groups === 'number' ? box.groups : worldGroups);
    // Bounce is opt-in and stays UNSET when the caller says nothing, so a box
    // that names no restitution keeps whatever Rapier's default is rather than
    // being pinned to a number this function invented. That is what lets a
    // trampoline row be a bouncy wall and every wall written before it be
    // untouched.
    if (typeof box.restitution === 'number') desc.setRestitution(box.restitution);
    const yaw = typeof box.yaw === 'number' ? box.yaw : 0;
    const pitch = typeof box.pitch === 'number' ? box.pitch : 0;
    if (yaw !== 0 || pitch !== 0) {
      // q = qYaw * qPitch, so the pitch is taken about the already-yawed X axis
      // and a ramp rotated 90 degrees still slopes along its own length.
      const cy = Math.cos(yaw * 0.5), sy = Math.sin(yaw * 0.5);
      const cp = Math.cos(pitch * 0.5), sp = Math.sin(pitch * 0.5);
      desc.setRotation({ x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp });
    }
    return world.createCollider(desc, plateBody);
  }

  const controller = world.createCharacterController(0.02);
  controller.setApplyImpulsesToDynamicBodies(false);
  controller.enableAutostep?.(0.3, 0.1, true);
  controller.enableSnapToGround?.(0.3);
  controller.setMaxSlopeClimbAngle?.((50 * Math.PI) / 180);
  controller.setMinSlopeSlideAngle?.((35 * Math.PI) / 180);

  const players = [];
  let accumulator = 0;
  let simTime = 0;
  let physMs = 0;
  let disposed = false;

  // Debug counter for the one rule that silently breaks physics: Rapier ignores
  // impulses on a sleeping body, and applying one does NOT wake it. Every
  // impulse goes through applyImpulse(), which counts any body that was still
  // asleep when it arrived. In a correct build this must read 0.
  const counters = { impulsesOnSleeping: 0, impulses: 0 };

  function applyImpulse(body, imp) {
    if (!body) return;
    if (typeof body.isSleeping === 'function' && body.isSleeping()) {
      counters.impulsesOnSleeping++;
    }
    wakeBody(body);
    body.applyImpulse(imp, true);
    counters.impulses++;
  }

  const economy = createEconomy({
    start: num(cfg, 'economy.startMoney'),
    duckBaseValue: num(cfg, 'economy.duckBaseValue'),
    duckValueMul: num(cfg, 'economy.duckValueMul'),
  });

  const ducks = createDucks({ RAPIER, world, cfg: DCFG, groups: GROUPS, counters });

  const pit = createPit({
    RAPIER, world, cfg: PITCFG, groups: GROUPS, ducks, economy, players,
    plate: { halfThickness: plateHalfThickness, friction: 0.9 },
  });
  // The same module again. It was already parameterised by its cfg, so a second
  // hole needed no new code inside it -- only a payout multiplier, which is the
  // one thing the two holes genuinely disagree about.
  let pit2Edge = PIT2CFG ? PIT2CFG.edge : null;
  const pit2 = PIT2CFG ? createPit({
    RAPIER, world, cfg: PIT2CFG, groups: GROUPS, ducks, economy, players,
    plate: { halfThickness: plateHalfThickness, friction: 0.9 },
  }) : null;

  // Aim defaults to the first player's eye and look direction, so the grab
  // controller works headlessly and needs nothing from the UI layer.
  let aimOverride = null;
  function getAim() {
    if (aimOverride) return aimOverride;
    const p = players[0];
    if (!p) return null;
    const eye = p.eyePosition();
    const l = p.look();
    const cp = Math.cos(l.pitch);
    return {
      origin: eye,
      dir: { x: -Math.sin(l.yaw) * cp, y: Math.sin(l.pitch), z: -Math.cos(l.yaw) * cp },
      body: world.getRigidBody(p.handle) || null,
    };
  }

  // One hold controller per player slot, all sharing one claim registry. Slot 0
  // is created here and is the same object `world.hold` has always been, driven
  // by the same getAim and stepped first in the same substep loop -- single
  // player is one entry in a list of one.
  const holdClaims = new Map();      // rigid-body handle -> owning slot
  const holds = [];
  const holdBySlot = new Map();

  function makeHold(slot, aimFn) {
    const h = createHold({
      RAPIER, world, cfg: HCFG, groups: GROUPS, ducks, applyImpulse,
      getAim: aimFn, claims: holdClaims, owner: slot,
    });
    holds.push(h);
    holdBySlot.set(slot, h);
    return h;
  }

  const hold = makeHold(0, getAim);

  // A controller for a player who is not the one at this keyboard. The aim is a
  // FUNCTION, not a vector: a remote player keeps looking around while they
  // carry, and a spring that kept pulling towards wherever they were aiming when
  // they pressed the button would drag the duck out of their hands sideways.
  function holdFor(slot, aimFn) {
    const s = slot | 0;
    const existing = holdBySlot.get(s);
    if (existing) return existing;
    if (typeof aimFn !== 'function') return null;
    return makeHold(s, aimFn);
  }

  // Somebody left. Their controller goes with them AND lets go first: a claim
  // outliving its owner is a duck nobody can ever pick up again.
  function dropHold(slot) {
    const s = slot | 0;
    if (s === 0) return false;
    const h = holdBySlot.get(s);
    if (!h) return false;
    h.release();
    const i = holds.indexOf(h);
    if (i >= 0) holds.splice(i, 1);
    holdBySlot.delete(s);
    return true;
  }

  // Who, if anyone, is holding this duck. Read by the vacuum and by the roster;
  // both used to ask slot 0's controller, which in a room is the wrong question.
  function holderOfDuck(id) {
    for (let i = 0; i < holds.length; i++) {
      if (holds[i].heldDuck() === id) return holds[i].owner;
    }
    return null;
  }

  function setAim(origin, dir, body) {
    aimOverride = origin && dir ? { origin, dir, body: body || null } : null;
  }
  hold.setAim = setAim;

  const bootBodies = countBodies();

  function countBodies() {
    let n = 0;
    world.bodies.forEach(() => { n++; });
    return n;
  }

  function step(dt) {
    return run(dt, P.maxSubsteps);
  }

  // Deterministic batch advance: runs every substep dt buys, ignoring the
  // realtime substep cap. Use for headless/debug stepping (e.g. debugStep(1.0)
  // must move stats().simTime by 1.0); never for per-frame rendering.
  function advance(seconds, maxSteps = 100000) {
    return run(seconds, maxSteps);
  }

  // Per-substep subscribers. Anything that pushes a body has to run inside the
  // substep loop, and the loop lives here; without this every new system would
  // have to grow its own branch in run().
  const fixedHooks = [];
  function onFixedUpdate(fn) {
    if (typeof fn !== 'function') return () => {};
    fixedHooks.push(fn);
    return () => {
      const i = fixedHooks.indexOf(fn);
      if (i >= 0) fixedHooks.splice(i, 1);
    };
  }

  function run(dt, limit) {
    if (disposed) return;
    if (!(dt > 0) || !isFinite(dt)) return;
    accumulator += dt;

    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    let n = 0;
    for (let i = 0; i < players.length; i++) players[i]._beginFrame();
    while (accumulator >= P.fixedDt && n < limit) {
      for (let i = 0; i < players.length; i++) players[i]._fixedUpdate(P.fixedDt);
      // Slot 0 is holds[0] and is stepped first, so with one player this is the
      // same call in the same place in the substep it always was.
      for (let i = 0; i < holds.length; i++) holds[i]._fixedUpdate(P.fixedDt);
      // Automation (belts, fans, ...) pushes here, inside the substep loop and
      // before the solver runs: an impulse applied after world.step() would be
      // integrated a whole substep late and read as mushy.
      for (let i = 0; i < fixedHooks.length; i++) fixedHooks[i](P.fixedDt);
      world.step();
      for (let i = 0; i < holds.length; i++) holds[i]._postStep();
      ducks._postStep(P.fixedDt);
      pit._postStep(P.fixedDt);
      if (pit2) pit2._postStep(P.fixedDt);
      for (let i = 0; i < players.length; i++) players[i]._postStep();
      accumulator -= P.fixedDt;
      simTime += P.fixedDt;
      n++;
    }
    // Drop the backlog so a long stall cannot spiral into a substep avalanche.
    if (accumulator >= P.fixedDt) accumulator = 0;
    const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (n > 0) physMs = t1 - t0;
  }

  function addPlayer(spawn) {
    const p = createPlayer({ RAPIER, world, controller, params: P, spawn });
    players.push(p);
    return p;
  }

  function addTestBody(pos) {
    const p = pos || { x: 0, y: 3, z: 0 };
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setCanSleep(true)
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.25, 0.25, 0.25)
        .setDensity(1.0)
        .setRestitution(0.1)
        .setFriction(0.8)
        .setCollisionGroups(interactionGroups(GROUP_PROP, GROUP_WORLD | GROUP_PROP)),
      body
    );
    wakeBody(body);
    return body.handle;
  }

  function bodyPose(id) {
    // Rapier handles are numbers but not integers (a u64 reinterpreted as f64),
    // so identity is the only valid check here.
    if (typeof id !== 'number' || !isFinite(id)) return null;
    const body = world.getRigidBody(id);
    // An unknown handle can resolve to an unrelated body -- verify identity.
    if (!body || body.handle !== id) return null;
    const t = body.translation();
    const r = body.rotation();
    return { x: t.x, y: t.y, z: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w };
  }

  function stats() {
    let bodies = 0;
    let sleeping = 0;
    world.bodies.forEach((b) => {
      bodies++;
      if (b.isSleeping()) sleeping++;
    });
    const d = ducks.count();
    return {
      bodies,
      awake: bodies - sleeping,
      sleeping,
      physMs,
      simTime,
      bootBodies,
      ducksLive: d.live,
      ducksSleeping: d.sleeping,
      ducksFree: d.free,
      ducksAtCap: ducks.atCap(),
      money: economy.money(),
      heldId: hold.heldId(),
      holdDistance: hold.distance(),
      impulsesOnSleeping: counters.impulsesOnSleeping,
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    players.length = 0;
    ducks.dispose();
    try { world.free(); } catch (e) { /* already freed */ }
  }

  return {
    step,
    advance,
    addPlayer,
    addTestBody,
    addStaticBox,
    bodyPose,
    stats,
    dispose,
    wakeBody,
    // G1 additions
    ducks,
    pit,
    // The second hole, or null when config.pit2.enabled is 0.
    pit2,
    pitAll: () => (pit2 ? [pit, pit2] : [pit]),
    // WHICH END OF THE MAP the second hole is at this run. Every caller goes
    // through here -- the host rolls it and tells its clients, and both sides
    // land on the same floor because the floor is the same four sockets on
    // every machine.
    pit2Edge: () => (pit2 ? pit2Edge : null),
    pit2Sockets: () => sockets.slice(),
    setPit2Edge(edge) {
      if (!pit2 || !sockets.length) return null;
      const e = ((Math.round(Number(edge) || 0) % 4) + 4) % 4;
      pit2Edge = e;
      pit2.relocate(sockets[e]);
      for (let i = 0; i < socketLids.length; i++) socketLids[i].setEnabled(i !== e);
      return e;
    },
    plateSlabs: () => plateSlabCount,
    hold,
    // G4: the hold is per player. `hold` above stays what it was (slot 0, this
    // keyboard); everything below exists so a second player can carry a duck.
    holdFor,
    holdIfAny: (slot) => holdBySlot.get(slot | 0) || null,
    dropHold,
    holderOfDuck,
    holdSlots: () => Array.from(holdBySlot.keys()),
    holdClaimCount: () => holdClaims.size,
    // Is this rigid body currently in somebody's hands? Asked by the audio
    // layer, which reads impacts off motion and would otherwise hear the hold
    // spring as a stream of collisions.
    isHeldHandle: (h) => holdClaims.has(h),
    economy,
    setAim,
    applyImpulse,
    onFixedUpdate,
    fixedHookCount: () => fixedHooks.length,
    wakeDuck: ducks.wakeDuck,
    counters: () => ({ ...counters }),
    bootBodyCount: () => bootBodies,
    countBodies,
    players,
    params: P,
    _raw: world,
  };
}
