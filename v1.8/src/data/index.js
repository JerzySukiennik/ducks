// The content layer. Loads every row file, merges them, validates them, and
// exposes CATALOG / byId / byTab / byNetId.
//
// Validation runs at MODULE EVALUATION -- importing this file is the boot check.
// A typo in a row throws here with the offending id and field, because the only
// failure worse than a crash is a row that silently does nothing while a later
// phase tunes its numbers and watches the game not change.
//
// No three.js, no Rapier, no DOM. src/data/** stays renderer-agnostic.

import { STATS, STAT_NAMES, OPS, isStat, baseStats, applyEffects } from './stats.js';
import { MACHINES } from './machines.js';
import { BUILDINGS } from './buildings.js';
import { TOOLS } from './tools.js';
import { UPGRADES } from './upgrades.js';
import { VENDOR_LINES, VENDOR_SHORT, TAB_LABELS } from './vendor-lines.js';

export class DataError extends Error {
  constructor(msg) { super('[data] ' + msg); this.name = 'DataError'; }
}

// --- the model manifest ------------------------------------------------------
// The authoritative list of finished GLBs. All 32 exist in
// tools/model-picker/models/blender/; `staged: true` marks the ones currently
// copied into assets/models/ and therefore loadable at runtime today.
// A row naming a model that is not in this manifest is a boot error. A row
// naming a manifest model that is not staged is NOT an error -- the model
// loader has a procedural fallback per model and staging assets belongs to the
// render layer -- but it is reported by unstagedModels() so it cannot be lost.

export const MODEL_MANIFEST = {
  duck:            { file: 'duck.glb',            staged: true,  role: 'duck' },
  crank:           { file: 'crank.glb',           staged: true,  role: 'machine' },
  tube:            { file: 'tube.glb',            staged: true,  role: 'world' },
  pit_rim:         { file: 'pit_rim.glb',         staged: true,  role: 'world' },
  machine:         { file: 'machine.glb',         staged: true , role: 'machine' },
  press:           { file: 'press.glb',           staged: true , role: 'machine' },
  vacuum_station:  { file: 'vacuum_station.glb',  staged: true , role: 'machine' },
  // The Auto-Cranker. NOT staged: the GLB is with the models builder, and this
  // is exactly the case the staged flag was invented for -- the row is real, the
  // manifest knows the name, unstagedModels() reports it, and src/render/
  // models.js draws its procedural fallback box (sized from the row footprint)
  // until crank_bot.glb lands in assets/models/. Nothing else changes when it
  // does: staged goes true and the box becomes the model.
  crank_bot:       { file: 'crank_bot.glb',       staged: true , role: 'machine' },
  conveyor:        { file: 'conveyor.glb',        staged: true , role: 'machine' },
  conveyor_corner: { file: 'conveyor_corner.glb', staged: true , role: 'machine' },
  conveyor_slope:  { file: 'conveyor_slope.glb',  staged: true , role: 'machine' },
  fan:             { file: 'fan.glb',             staged: true , role: 'machine' },
  wall:            { file: 'wall.glb',            staged: true , role: 'building' },
  wall_high:       { file: 'wall_high.glb',       staged: true , role: 'building' },
  rail:            { file: 'rail.glb',            staged: true , role: 'building' },
  corner:          { file: 'corner.glb',          staged: true , role: 'building' },
  ramp:            { file: 'ramp.glb',            staged: true , role: 'building' },
  chute:           { file: 'chute.glb',           staged: true , role: 'building' },
  bridge:          { file: 'bridge.glb',          staged: true , role: 'building' },
  pillar:          { file: 'pillar.glb',          staged: true , role: 'building' },
  box:             { file: 'box.glb',             staged: true , role: 'item' },
  box_big:         { file: 'box_big.glb',         staged: true , role: 'item' },
  container:       { file: 'container.glb',       staged: true , role: 'item' },
  bucket:          { file: 'bucket.glb',          staged: true , role: 'item' },
  cart:            { file: 'cart.glb',            staged: true , role: 'item' },
  broom:           { file: 'broom.glb',           staged: true , role: 'item' },
  vacuum:          { file: 'vacuum.glb',          staged: true , role: 'item' },
  shop:            { file: 'shop.glb',            staged: true , role: 'world' },
  vendor:          { file: 'vendor.glb',          staged: true , role: 'world' },
  floor:           { file: 'floor.glb',           staged: true , role: 'world' },
  marking:         { file: 'marking.glb',         staged: true , role: 'world' },
  lamp:            { file: 'lamp.glb',            staged: true , role: 'world' },
  avatar:          { file: 'avatar.glb',          staged: true , role: 'player' },

  // --- phase 1 catalog ------------------------------------------------------
  // Geometry for the 49 catalog entries that need no new engine code
  // (work/catalog-phase1.md, groups "pure data" and "one field"). The GLBs
  // exist and are staged; the ROWS that will name them are a separate pass,
  // because their balance numbers are frozen by Phase E (work/economy.md).
  // A manifest model that no row references yet is legal and silent -- only the
  // reverse (a row naming an unknown model) is a boot error.
  //
  // group 1: machines that emit N ducks per cycle (produce.count)
  hive:             { file: 'hive.glb',             staged: true, role: 'machine' },
  incubator_double: { file: 'incubator_double.glb', staged: true, role: 'machine' },
  press_belt:       { file: 'press_belt.glb',       staged: true, role: 'machine' },
  feeder_vibe:      { file: 'feeder_vibe.glb',      staged: true, role: 'machine' },
  slot_machine:     { file: 'slot_machine.glb',     staged: true, role: 'machine' },
  factory:          { file: 'factory.glb',          staged: true, role: 'machine' },
  geyser:           { file: 'geyser.glb',           staged: true, role: 'machine' },
  pipe_endless:     { file: 'pipe_endless.glb',     staged: true, role: 'machine' },
  // group 2: producers that are pure data -- producer_auto, no new code at all
  machine_slow:     { file: 'machine_slow.glb',     staged: true, role: 'machine' },
  condenser:        { file: 'condenser.glb',        staged: true, role: 'machine' },
  duckomat:         { file: 'duckomat.glb',         staged: true, role: 'machine' },
  hatchery:         { file: 'hatchery.glb',         staged: true, role: 'machine' },
  printer3d:        { file: 'printer3d.glb',        staged: true, role: 'machine' },
  press_gold:       { file: 'press_gold.glb',       staged: true, role: 'machine' },
  reactor:          { file: 'reactor.glb',          staged: true, role: 'machine' },
  // group 3: buildings. The four fence pieces deliberately share wall's exact
  // 2.00 x 0.25 footprint so they chain with it and with each other seamlessly.
  wall_glass:       { file: 'wall_glass.glb',       staged: true, role: 'building' },
  wall_soft:        { file: 'wall_soft.glb',        staged: true, role: 'building' },
  fence_mesh:       { file: 'fence_mesh.glb',       staged: true, role: 'building' },
  neon_ducks:       { file: 'neon_ducks.glb',       staged: true, role: 'building' },
  slide:            { file: 'slide.glb',            staged: true, role: 'building' },
  fan_strong:       { file: 'fan_strong.glb',       staged: true, role: 'building' },
  fan_vertical:     { file: 'fan_vertical.glb',     staged: true, role: 'building' },
  vibe_floor:       { file: 'vibe_floor.glb',       staged: true, role: 'building' },
  platform:         { file: 'platform.glb',         staged: true, role: 'building' },
  stairs:           { file: 'stairs.glb',           staged: true, role: 'building' },
  roof:             { file: 'roof.glb',             staged: true, role: 'building' },
  ice_slide:        { file: 'ice_slide.glb',        staged: true, role: 'building' },
  pit_kerb:         { file: 'pit_kerb.glb',         staged: true, role: 'building' },
  lamp_post:        { file: 'lamp_post.glb',        staged: true, role: 'building' },
  sign_dir:         { file: 'sign_dir.glb',         staged: true, role: 'building' },
  bumper:           { file: 'bumper.glb',           staged: true, role: 'building' },
  trampoline:       { file: 'trampoline.glb',       staged: true, role: 'building' },
  // group 4: tools and containers. The storage ones (sack, crate_wood,
  // bucket_leaky, dumper) are sized by what they hold, not by what looks tidy --
  // see the note in the FOOTPRINT table of tools/blender-models.py.
  sack:             { file: 'sack.glb',             staged: true, role: 'item' },
  crate_wood:       { file: 'crate_wood.glb',       staged: true, role: 'item' },
  bucket_leaky:     { file: 'bucket_leaky.glb',     staged: true, role: 'item' },
  dumper:           { file: 'dumper.glb',           staged: true, role: 'item' },
  pallet_jack:      { file: 'pallet_jack.glb',      staged: true, role: 'item' },
  broom_wide:       { file: 'broom_wide.glb',       staged: true, role: 'item' },
  vacuum_industrial:{ file: 'vacuum_industrial.glb',staged: true, role: 'item' },
  leaf_blower:      { file: 'leaf_blower.glb',      staged: true, role: 'item' },
  pusher:           { file: 'pusher.glb',           staged: true, role: 'item' },
  lasso:            { file: 'lasso.glb',            staged: true, role: 'item' },
  fire_hose:        { file: 'fire_hose.glb',        staged: true, role: 'item' },
  fan_handheld:     { file: 'fan_handheld.glb',     staged: true, role: 'item' },
  plank:            { file: 'plank.glb',            staged: true, role: 'item' },
  horn:             { file: 'horn.glb',             staged: true, role: 'item' },
  rake:             { file: 'rake.glb',             staged: true, role: 'item' },
  magnet:           { file: 'magnet.glb',           staged: true, role: 'item' },
  dustpan:          { file: 'dustpan.glb',          staged: true, role: 'item' },
  // The gambling box, in two pieces because the lid MOVES. They are separate
  // models rather than one mesh split at load (the way the crank's wheel is)
  // because the lid is authored as its own object with its own origin: it sits
  // at the body's top, y = 0.64, with identity rotation, and its hinge is its
  // own rear bottom edge. A split predicate would have to rediscover both facts
  // by measuring, and get them wrong the first time somebody re-exports.
  gamble_box:       { file: 'gamble_box.glb',       staged: true, role: 'machine' },
  gamble_box_lid:   { file: 'gamble_box_lid.glb',   staged: true, role: 'machine' },
};

// --- the closed set of behaviours -------------------------------------------
// A row's `kind` selects one of these. Adding a kind means writing its
// behaviour once in code; adding an item means adding a row and nothing else.

export const KINDS = {
  producer_manual: { placeable: true,  needsModel: true,  block: 'produce',  effects: false },
  producer_auto:   { placeable: true,  needsModel: true,  block: 'produce',  effects: false },
  collector_auto:  { placeable: true,  needsModel: true,  block: 'collect',  effects: false },
  conveyor:        { placeable: true,  needsModel: true,  block: 'belt',     effects: false },
  blower:          { placeable: true,  needsModel: true,  block: 'blow',     effects: false },
  wall:            { placeable: true,  needsModel: true,  block: null,       effects: false },
  ramp:            { placeable: true,  needsModel: true,  block: 'slope',    effects: false },
  storage:         { placeable: true,  needsModel: true,  block: 'storage',  effects: false },
  carry:           { placeable: true,  needsModel: true,  block: 'storage',  effects: false },
  // Works a manual workbench's wheel for you. `block: null` is the whole point:
  // it declares no rate and no output, because it HAS none -- it registers as one
  // more holder on the nearest wheel and that wheel's own numbers (fill rate,
  // flywheel, Swift Hands, the pool cap) decide everything that happens. A
  // `produce` block here would be a second, drifting copy of the crank's rate.
  crank_bot:       { placeable: true,  needsModel: true,  block: null,       effects: false },
  // Pay it, watch it rattle, take whatever falls out. NOT `producer_auto` and
  // not a collector: it produces nothing on a clock, it eats nothing off the
  // floor, and what it hands over is a CATALOG ROW rather than a duck -- three
  // ways in which forcing it into an existing behaviour would have meant lying
  // in the data and then branching on the id in the code to un-lie.
  //
  // `block: null` for the same reason crank_bot has none: every number this
  // thing obeys -- the shake, the odds, the price of a roll -- is one shared
  // config.gamble table, not a per-row rate. A `produce` block here would be a
  // second, drifting copy of it. Behaviour lives in src/sim/gamble.js, selected
  // by this kind.
  gamble:          { placeable: true,  needsModel: true,  block: null,       effects: false },
  // `modes` closes the set of behaviours a block's `mode` field may name. It is
  // how "broom sweeps, vacuum beams" is expressed as declared data instead of
  // being inferred from the arc width, and an unknown mode is a boot error.
  tool:            { placeable: true,  needsModel: true,  block: 'tool',     effects: false, modes: ['sweep', 'beam', 'scoop'] },
  upgrade:         { placeable: false, needsModel: false, block: 'effects',  effects: true },
};

export const TABS = ['machines', 'buildings', 'items', 'upgrades'];
export const ANCHORS = ['floor', 'wall', 'none'];
export const COLLIDER_SHAPES = ['cuboid'];

const SOURCES = [
  ['machines.js', MACHINES],
  ['buildings.js', BUILDINGS],
  ['tools.js', TOOLS],
  ['upgrades.js', UPGRADES],
];

// --- validation --------------------------------------------------------------

function num(v) { return typeof v === 'number' && isFinite(v); }
function posNum(v) { return num(v) && v > 0; }

function checkTriple(where, name, v) {
  if (!Array.isArray(v) || v.length !== 3) {
    throw new DataError(`${where}: ${name} must be an array of 3 numbers, got ${JSON.stringify(v)}`);
  }
  for (let i = 0; i < 3; i++) {
    if (!posNum(v[i])) throw new DataError(`${where}: ${name}[${i}] must be a positive number, got ${JSON.stringify(v[i])}`);
  }
}

function checkSnap(where, snap) {
  if (typeof snap !== 'object' || snap === null || Array.isArray(snap)) {
    throw new DataError(`${where}: snap must be an object {grid, yawStep, freeRotate}, got ${JSON.stringify(snap)}`);
  }
  if (!posNum(snap.grid)) throw new DataError(`${where}: snap.grid must be a positive number, got ${JSON.stringify(snap.grid)}`);
  if (!posNum(snap.yawStep)) throw new DataError(`${where}: snap.yawStep must be a positive number of degrees, got ${JSON.stringify(snap.yawStep)}`);
  if (Math.abs(360 / snap.yawStep - Math.round(360 / snap.yawStep)) > 1e-9) {
    throw new DataError(`${where}: snap.yawStep ${snap.yawStep} does not divide 360, so rotation would not close the circle`);
  }
  if (typeof snap.freeRotate !== 'boolean') {
    throw new DataError(`${where}: snap.freeRotate must be a boolean, got ${JSON.stringify(snap.freeRotate)}`);
  }
  for (const k of Object.keys(snap)) {
    if (k !== 'grid' && k !== 'yawStep' && k !== 'freeRotate') {
      throw new DataError(`${where}: snap has unknown field '${k}'`);
    }
  }
}

function checkCollider(where, c) {
  if (typeof c !== 'object' || c === null || Array.isArray(c)) {
    throw new DataError(`${where}: collider must be an object, got ${JSON.stringify(c)}`);
  }
  if (COLLIDER_SHAPES.indexOf(c.shape) < 0) {
    throw new DataError(`${where}: collider.shape '${c.shape}' is not one of ${COLLIDER_SHAPES.join(', ')}`);
  }
  checkTriple(where, 'collider.half', c.half);
  if (typeof c.blockDucks !== 'boolean') {
    throw new DataError(`${where}: collider.blockDucks must be a boolean (this is how "ducks pass through the fan" is expressed as data), got ${JSON.stringify(c.blockDucks)}`);
  }
  // Surface response. Both are optional and both are 0..2: below 0 is not a
  // physical material and above 2 is a solver artefact rather than a bouncier
  // wall. Omitting them means "whatever the world does today" -- friction 0.9 on
  // a static box, Rapier's own restitution -- which is why the 31 rows that name
  // neither behave exactly as they always have.
  for (const k of ['restitution', 'friction']) {
    if (c[k] === undefined) continue;
    if (!num(c[k]) || c[k] < 0 || c[k] > 2) {
      throw new DataError(
        `${where}: collider.${k} must be a number in 0..2, got ${JSON.stringify(c[k])}`
      );
    }
  }
  // `half` is the placement box: grid snapping, the overlap test and the model
  // seating all read it. `surface` optionally overrides the PHYSICS shape only,
  // which is how a ramp gets a thin sloped slab while still occupying an upright
  // box on the grid. Without the split, giving a ramp its real collider silently
  // changed where the mesh sits and how far the next piece has to stand.
  if (c.surface !== undefined) {
    const s = c.surface;
    if (typeof s !== 'object' || s === null || Array.isArray(s)) {
      throw new DataError(`${where}: collider.surface must be an object {half, pitchDegrees, offsetY}`);
    }
    checkTriple(where, 'collider.surface.half', s.half);
    if (s.pitchDegrees !== undefined && !num(s.pitchDegrees)) {
      throw new DataError(`${where}: collider.surface.pitchDegrees must be a number, got ${JSON.stringify(s.pitchDegrees)}`);
    }
    if (s.offsetY !== undefined && !num(s.offsetY)) {
      throw new DataError(`${where}: collider.surface.offsetY must be a number, got ${JSON.stringify(s.offsetY)}`);
    }
  }
}

// `hand` is what makes a row carryable: pick it up with E, hold it in a hotbar
// slot, see it in your hands, throw it back out with Q. The block is the model's
// view-space pose, so it is checked here rather than trusted -- a bad number
// puts the model behind the camera, where "nothing is rendered" looks exactly
// like the bug this whole mechanic was written to fix.
function checkSignedTriple(where, name, v) {
  if (!Array.isArray(v) || v.length !== 3) {
    throw new DataError(`${where}: ${name} must be an array of 3 numbers, got ${JSON.stringify(v)}`);
  }
  for (let i = 0; i < 3; i++) {
    if (!num(v[i])) throw new DataError(`${where}: ${name}[${i}] must be a finite number, got ${JSON.stringify(v[i])}`);
  }
}

function checkHand(where, h) {
  if (typeof h !== 'object' || h === null || Array.isArray(h)) {
    throw new DataError(`${where}: hand must be an object {pos, rotDeg, scale}, got ${JSON.stringify(h)}`);
  }
  if (h.pos !== undefined) checkSignedTriple(where, 'hand.pos', h.pos);
  if (h.rotDeg !== undefined) checkSignedTriple(where, 'hand.rotDeg', h.rotDeg);
  if (h.scale !== undefined && !posNum(h.scale)) {
    throw new DataError(`${where}: hand.scale must be a positive number, got ${JSON.stringify(h.scale)}`);
  }
  for (const k of Object.keys(h)) {
    if (k !== 'pos' && k !== 'rotDeg' && k !== 'scale') {
      throw new DataError(`${where}: hand has unknown field '${k}'`);
    }
  }
}

// `interact` names the ONE part of a row's model that a player can point at and
// press. Everything that draws a focus outline reads it, so a typo in `part`
// must be a boot error rather than a machine that silently stops responding to
// the crosshair -- the failure mode would be invisible, because "no outline" is
// also what correct scenery looks like.
function checkInteract(where, it) {
  if (typeof it !== 'object' || it === null || Array.isArray(it)) {
    throw new DataError(`${where}: interact must be an object {part, hint}, got ${JSON.stringify(it)}`);
  }
  if (typeof it.part !== 'string' || !it.part) {
    throw new DataError(`${where}: interact.part must be a non-empty model part name, got ${JSON.stringify(it.part)}`);
  }
  if (it.hint !== undefined && typeof it.hint !== 'string') {
    throw new DataError(`${where}: interact.hint must be a string, got ${JSON.stringify(it.hint)}`);
  }
  for (const k of Object.keys(it)) {
    if (k !== 'part' && k !== 'hint') {
      throw new DataError(`${where}: interact has unknown field '${k}'`);
    }
  }
}

function checkEffects(where, effects) {
  if (!Array.isArray(effects) || effects.length === 0) {
    throw new DataError(`${where}: effects must be a non-empty array`);
  }
  effects.forEach((e, i) => {
    const at = `${where}: effects[${i}]`;
    if (typeof e !== 'object' || e === null) throw new DataError(`${at} must be an object {stat, op, value}`);
    if (typeof e.stat !== 'string' || !e.stat) throw new DataError(`${at}.stat must be a non-empty string`);
    if (!isStat(e.stat)) {
      throw new DataError(
        `${at} targets unknown stat '${e.stat}'. Legal stats are: ${STAT_NAMES.join(', ')}. ` +
        `Add it to src/data/stats.js or fix the typo -- an effect on an unknown stat would be a silent no-op.`
      );
    }
    if (OPS.indexOf(e.op) < 0) throw new DataError(`${at}.op '${e.op}' is not one of ${OPS.join(', ')}`);
    if (STATS[e.stat].ops.indexOf(e.op) < 0) {
      throw new DataError(`${at}: stat '${e.stat}' does not accept op '${e.op}' (accepts ${STATS[e.stat].ops.join(', ')})`);
    }
    if (!num(e.value)) throw new DataError(`${at}.value must be a finite number, got ${JSON.stringify(e.value)}`);
    if (e.op === 'mul' && e.value === 0) throw new DataError(`${at}: mul by 0 zeroes the stat forever; use 'set' if that is the intent`);
  });
}

// --- the five optional fields that unlock the phase 1 catalog ----------------
// Every one of them is optional and every default reproduces today's behaviour,
// which is the condition for the rows that predate them needing no edit. What is
// NOT optional is the shape: a machine that says `count: '3'` would emit one
// duck and look like a balance mistake for a week, so a wrong shape is a boot
// error exactly like every other field here.

// How many ducks leave a producer per emission. An integer, or a [min, max]
// pair rolled fresh each time. Absent means 1.
function checkProduceCount(where, v) {
  const bad = (why) => new DataError(
    `${where}: produce.count must be an integer >= 1 or a [min, max] pair of them, ` +
    `got ${JSON.stringify(v)}${why ? ` -- ${why}` : ''}`
  );
  if (Array.isArray(v)) {
    if (v.length !== 2) throw bad('a range has exactly two entries');
    for (let i = 0; i < 2; i++) {
      if (!Number.isInteger(v[i]) || v[i] < 1) throw bad(`count[${i}] is not an integer >= 1`);
    }
    if (v[0] > v[1]) throw bad('the minimum is larger than the maximum');
    return;
  }
  if (!Number.isInteger(v) || v < 1) throw bad('');
}

function checkBlow(where, b) {
  if (b.pitchDegrees === undefined) return;
  if (!num(b.pitchDegrees) || b.pitchDegrees < -90 || b.pitchDegrees > 90) {
    throw new DataError(
      `${where}: blow.pitchDegrees must be a number in -90..90 (positive is up), ` +
      `got ${JSON.stringify(b.pitchDegrees)}`
    );
  }
}

function checkStorageLeak(where, s) {
  if (s.leakPerSecond === undefined) return;
  if (!num(s.leakPerSecond) || s.leakPerSecond < 0) {
    throw new DataError(
      `${where}: storage.leakPerSecond must be a finite number >= 0 (ducks per second lost while ` +
      `the container is carried or pushed), got ${JSON.stringify(s.leakPerSecond)}`
    );
  }
}

// `pull` inverts the sign of the force, so a tool draws ducks in instead of
// shoving them away. `capacity` is how many ducks one scoop lifts, and it is
// REQUIRED by that mode: a scoop with no stated capacity has no behaviour at
// all, and defaulting it silently would make the number nobody wrote the number
// that matters.
function checkTool(where, t) {
  if (t.pull !== undefined && typeof t.pull !== 'boolean') {
    throw new DataError(`${where}: tool.pull must be a boolean, got ${JSON.stringify(t.pull)}`);
  }
  if (t.capacity !== undefined && (!Number.isInteger(t.capacity) || t.capacity < 1)) {
    throw new DataError(`${where}: tool.capacity must be an integer >= 1, got ${JSON.stringify(t.capacity)}`);
  }
  if (t.mode === 'scoop' && t.capacity === undefined) {
    throw new DataError(`${where}: tool.mode 'scoop' requires tool.capacity -- how many ducks one scoop lifts`);
  }
}

// `lid` is a SECOND MODEL that belongs to this row and moves relative to it.
// The gambling box is the row that needs one, and the three facts here are all
// measured off the exported GLBs rather than guessed by the renderer:
//
//   model     the lid's own manifest entry -- it is a separate export, not a
//             part split out of the body at load time like the crank's wheel
//   localY    how high a SHUT lid sits in the body's model frame (0.64)
//   hingeZ    where the hinge is: the lid's rear bottom edge, at z = +0.375 in
//             its own frame, which is what it swings about
//   footprint the lid's bounding box, for the procedural stand-in if the GLB
//             fails to load
//
// A renderer that had to rediscover any of these by measuring would get them
// wrong the first time somebody re-exported the model, and the failure would
// be a lid hovering in mid-air rather than an error.
function checkLid(where, l) {
  if (typeof l !== 'object' || l === null || Array.isArray(l)) {
    throw new DataError(`${where}: lid must be an object {model, localY, hingeZ, footprint}`);
  }
  if (typeof l.model !== 'string' || !Object.prototype.hasOwnProperty.call(MODEL_MANIFEST, l.model)) {
    throw new DataError(
      `${where}: lid.model ${JSON.stringify(l.model)} is not in MODEL_MANIFEST (src/data/index.js)`
    );
  }
  if (!num(l.localY)) throw new DataError(`${where}: lid.localY must be a finite number`);
  if (!num(l.hingeZ)) throw new DataError(`${where}: lid.hingeZ must be a finite number`);
  checkTriple(where, 'lid.footprint', l.footprint);
  for (const k of Object.keys(l)) {
    if (['model', 'localY', 'hingeZ', 'footprint'].indexOf(k) < 0) {
      throw new DataError(`${where}: lid has unknown field '${k}'`);
    }
  }
}

function checkRepeat(where, r) {
  if (typeof r !== 'object' || r === null || Array.isArray(r)) {
    throw new DataError(`${where}: repeat must be an object {times, curve}`);
  }
  if (!Number.isInteger(r.times) || r.times < 1) {
    throw new DataError(`${where}: repeat.times must be an integer >= 1, got ${JSON.stringify(r.times)}`);
  }
  if (!posNum(r.curve) || r.curve < 1) {
    throw new DataError(`${where}: repeat.curve must be a number >= 1, got ${JSON.stringify(r.curve)}`);
  }
}

export function validateRows(rows) {
  const seenId = new Map();
  const seenNet = new Map();

  for (const { file, row, index } of rows) {
    const idText = row && typeof row.id === 'string' && row.id ? row.id : `<row #${index} of ${file}>`;
    const where = `${file} [${idText}]`;

    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      throw new DataError(`${file}: row #${index} is not an object`);
    }
    if (typeof row.id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(row.id)) {
      throw new DataError(`${file}: row #${index} has invalid id ${JSON.stringify(row.id)} (expected lower_snake_case)`);
    }
    if (seenId.has(row.id)) {
      throw new DataError(`duplicate id '${row.id}' in ${file} and ${seenId.get(row.id)}`);
    }
    seenId.set(row.id, file);

    if (!Number.isInteger(row.netId) || row.netId < 1) {
      throw new DataError(`${where}: netId must be a positive integer, got ${JSON.stringify(row.netId)}`);
    }
    if (seenNet.has(row.netId)) {
      const other = seenNet.get(row.netId);
      throw new DataError(
        `duplicate netId ${row.netId}: '${row.id}' (${file}) collides with '${other.id}' (${other.file}). ` +
        `netIds are assigned once and never recycled; pick an unused number instead of reordering rows.`
      );
    }
    seenNet.set(row.netId, { id: row.id, file });

    if (TABS.indexOf(row.tab) < 0) {
      throw new DataError(`${where}: tab '${row.tab}' is not one of ${TABS.join(', ')}`);
    }
    if (typeof row.name !== 'string' || !row.name) throw new DataError(`${where}: name must be a non-empty string`);
    if (typeof row.desc !== 'string' || !row.desc) throw new DataError(`${where}: desc must be a non-empty string`);
    if (!Array.isArray(row.tags)) throw new DataError(`${where}: tags must be an array (use [] for none)`);

    const spec = KINDS[row.kind];
    if (!spec) {
      throw new DataError(
        `${where}: unknown kind '${row.kind}'. Known kinds are: ${Object.keys(KINDS).join(', ')}. ` +
        `A kind is a behaviour implemented once in code -- add the behaviour before the row.`
      );
    }

    // Cost. Free is legal only for a row tagged 'starter' (the workbench, which
    // is already placed at boot); everything else must carry a real price.
    if (!num(row.cost) || row.cost < 0) {
      throw new DataError(`${where}: cost must be a finite number >= 0, got ${JSON.stringify(row.cost)}`);
    }
    const isStarter = row.tags.indexOf('starter') >= 0;
    if (row.cost <= 0 && !isStarter) {
      throw new DataError(`${where}: cost must be > 0 unless the row is tagged 'starter' (got ${row.cost})`);
    }

    if (spec.needsModel) {
      if (typeof row.model !== 'string' || !row.model) {
        throw new DataError(`${where}: kind '${row.kind}' requires a model name`);
      }
      if (!Object.prototype.hasOwnProperty.call(MODEL_MANIFEST, row.model)) {
        throw new DataError(
          `${where}: model '${row.model}' is not in MODEL_MANIFEST (src/data/index.js). ` +
          `Known models: ${Object.keys(MODEL_MANIFEST).join(', ')}.`
        );
      }
    } else if (row.model !== undefined) {
      throw new DataError(`${where}: kind '${row.kind}' must not carry a model`);
    }

    if (spec.placeable) {
      checkTriple(where, 'footprint', row.footprint);
      if (ANCHORS.indexOf(row.anchor) < 0) {
        throw new DataError(`${where}: anchor '${row.anchor}' is not one of ${ANCHORS.join(', ')}`);
      }
      checkCollider(where, row.collider);
      checkSnap(where, row.snap);
      // A collider larger than the footprint would let an object block space the
      // hologram never showed. 1 cm of slack absorbs authoring rounding of the
      // model bounding boxes; anything past that is a real mismatch.
      for (let i = 0; i < 3; i++) {
        if (row.collider.half[i] > row.footprint[i] / 2 + 0.01) {
          throw new DataError(
            `${where}: collider.half[${i}] ${row.collider.half[i]} exceeds half the footprint ` +
            `${row.footprint[i] / 2}; the placed object would block more space than the hologram showed`
          );
        }
      }
    } else {
      for (const k of ['footprint', 'anchor', 'collider', 'snap']) {
        if (row[k] !== undefined) throw new DataError(`${where}: kind '${row.kind}' is not placeable and must not carry '${k}'`);
      }
    }

    // modelScale: how many times its authored size the MESH is drawn. It exists
    // for the crank, whose model-local coordinates in config.machine forbid
    // re-exporting the asset at another size, and it changes nothing else: the
    // footprint and collider.half above are already the world-metre numbers that
    // placement and physics read, so a row whose modelScale disagrees with them
    // draws a machine that does not fill its own box. Optional, positive, and a
    // boot error otherwise -- a bad size is exactly the kind of defect that
    // looks like a content mistake for a week.
    if (row.modelScale !== undefined) {
      if (!posNum(row.modelScale)) {
        throw new DataError(`${where}: modelScale must be a positive number, got ${JSON.stringify(row.modelScale)}`);
      }
      if (!row.model) {
        throw new DataError(`${where}: modelScale needs a model to scale`);
      }
    }

    // Carryable is data, not a kind: any row that says how it looks in your
    // hands can be carried. It needs a model for exactly that reason, and a
    // collider because Q puts it back in the world as a physical prop.
    if (row.hand !== undefined) {
      checkHand(where, row.hand);
      if (!row.model) {
        throw new DataError(`${where}: a row with a 'hand' block must have a model -- there would be nothing to draw in the player's hands`);
      }
      if (!row.collider || !Array.isArray(row.collider.half)) {
        throw new DataError(`${where}: a row with a 'hand' block must have collider.half -- throwing it puts a physical prop back in the world`);
      }
    }

    // Which part of this model answers the crosshair. A row that names one must
    // have a model for the part to be split out of.
    if (row.interact !== undefined) {
      checkInteract(where, row.interact);
      if (!row.model) {
        throw new DataError(`${where}: a row with an 'interact' block must have a model -- there would be no part to point at`);
      }
    }

    if (spec.effects) {
      checkEffects(where, row.effects);
    } else if (row.effects !== undefined) {
      throw new DataError(`${where}: kind '${row.kind}' does not support effects`);
    }

    // `repeat` means two different things and both are legal. On an upgrade it
    // is levels of one effect; on a placeable it is how many copies you may own
    // and how the price climbs per copy -- the lever Phase E uses to stop a
    // player buying sixteen presses the moment they can afford the first.
    // What is never legal is a placeable that also carries effects, because
    // then the two meanings would be live on the same row at once.
    if (row.repeat !== undefined) {
      checkRepeat(where, row.repeat);
      if (!spec.effects && row.effects !== undefined) {
        throw new DataError(`${where}: a repeating placeable may not carry effects`);
      }
    }

    // The kind's required behaviour block must be present.
    if (spec.block && row[spec.block] === undefined) {
      throw new DataError(`${where}: kind '${row.kind}' requires a '${spec.block}' block`);
    }

    // The optional fields on those blocks. Checked wherever the block appears,
    // not only on the kind that requires it, so a `blow` block on the wrong row
    // still cannot carry a broken pitch.
    const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
    if (isObj(row.produce) && row.produce.count !== undefined) {
      checkProduceCount(where, row.produce.count);
    }
    if (row.lid !== undefined) {
      checkLid(where, row.lid);
      if (!row.model) {
        throw new DataError(`${where}: a row with a 'lid' block must have a model for the lid to sit on`);
      }
    }
    if (isObj(row.blow)) checkBlow(where, row.blow);
    if (isObj(row.storage)) checkStorageLeak(where, row.storage);
    if (isObj(row.tool)) checkTool(where, row.tool);

    // storage.interior: the row's INNER CAVITY, where its ducks actually live,
    // when that is not simply its collider box. A cart's collider spans the
    // handles, the legs and the wheel; its ducks belong in the tray, and
    // without this block the packing lattice hangs them in the air beside the
    // barrow. Optional -- omitted means "the cavity is the collider".
    //
    // A cavity that pokes OUT of the collider is refused: it would let a
    // container swallow ducks through a wall the player can see is solid.
    if (row.storage && row.storage.interior !== undefined) {
      const inter = row.storage.interior;
      if (!inter || typeof inter !== 'object') {
        throw new DataError(`${where}: storage.interior must be an object with 'half' and optional 'offset'`);
      }
      checkTriple(`${where} storage.interior`, 'half', inter.half);
      if (inter.offset !== undefined) {
        if (!Array.isArray(inter.offset) || inter.offset.length !== 3
            || inter.offset.some((v) => typeof v !== 'number' || !isFinite(v))) {
          throw new DataError(`${where}: storage.interior.offset must be three finite numbers`);
        }
      }
      const off = inter.offset || [0, 0, 0];
      const half = row.collider && row.collider.half;
      if (half) {
        for (let i = 0; i < 3; i++) {
          if (Math.abs(off[i]) + inter.half[i] > half[i] + 1e-6) {
            throw new DataError(
              `${where}: storage.interior reaches ${(Math.abs(off[i]) + inter.half[i]).toFixed(4)} on axis ${i}, ` +
              `outside collider.half ${half[i]}; the cavity must be inside the box that holds it`
            );
          }
        }
      }
    }

    // A kind whose behaviour splits into named variants declares them in
    // KINDS[kind].modes, and the row must name one. Missing or unknown is fatal:
    // the runtime picks the code path from this field alone, so a silent default
    // would be a broom that quietly behaves like a vacuum.
    if (spec.modes && row[spec.block] !== undefined) {
      const m = row[spec.block].mode;
      if (spec.modes.indexOf(m) < 0) {
        throw new DataError(
          `${where}: ${spec.block}.mode ${JSON.stringify(m)} is not one of ${spec.modes.join(', ')}. ` +
          `Kind '${row.kind}' selects its behaviour from this field; it must be declared, not inferred.`
        );
      }
    }
  }

  return { count: rows.length };
}

function validateVendorLines() {
  const required = [
    'ok', 'unknown_item', 'not_for_sale', 'insufficient', 'already_owned', 'max_level', 'nothing_owned',
    // The shelf. A row can now be refused for a reason that resolves itself by
    // waiting, and a blank message on that path would read as a broken shop
    // rather than as a full one.
    'out_of_stock', 'no_stock', 'reroll_ok',
  ];
  for (const r of required) {
    const line = VENDOR_LINES[r];
    if (typeof line !== 'string' || !line) {
      throw new DataError(`vendor-lines.js: missing line for refusal reason '${r}'`);
    }
  }
  // Every short form must name a refusal that actually exists. Without this a
  // renamed code leaves a short label pointing at nothing, and the button
  // silently falls back to the long line that does not fit -- which is the
  // exact defect the short forms were added to fix.
  for (const r of Object.keys(VENDOR_SHORT)) {
    if (typeof VENDOR_LINES[r] !== 'string') {
      throw new DataError(`vendor-lines.js: VENDOR_SHORT names '${r}', which has no VENDOR_LINES entry`);
    }
    if (typeof VENDOR_SHORT[r] !== 'string' || !VENDOR_SHORT[r]) {
      throw new DataError(`vendor-lines.js: empty VENDOR_SHORT entry for '${r}'`);
    }
  }
  for (const t of TABS) {
    if (typeof TAB_LABELS[t] !== 'string' || !TAB_LABELS[t]) {
      throw new DataError(`vendor-lines.js: missing TAB_LABELS entry for tab '${t}'`);
    }
  }
}

// --- build the catalog (runs at import time) ---------------------------------

function collect() {
  const flat = [];
  for (const [file, rows] of SOURCES) {
    if (!Array.isArray(rows)) throw new DataError(`${file}: export is not an array`);
    rows.forEach((row, index) => flat.push({ file, row, index }));
  }
  return flat;
}

const flat = collect();
validateRows(flat);
validateVendorLines();

export const CATALOG = Object.freeze(flat.map((f) => Object.freeze(f.row)));

const _byId = new Map();
const _byNetId = new Map();
const _byTab = {};
for (const t of TABS) _byTab[t] = [];
for (const row of CATALOG) {
  _byId.set(row.id, row);
  _byNetId.set(row.netId, row);
  _byTab[row.tab].push(row);
}
for (const t of TABS) Object.freeze(_byTab[t]);

// The one question the pick-up / hold / throw path asks about a row. It reads
// the row's own data and never its id, so a new carryable is a `hand` block and
// nothing else.
export function isHandCarryable(row) {
  return !!(row && row.hand && row.model && row.collider && Array.isArray(row.collider.half));
}

export const byId = (id) => _byId.get(id) || null;
export const byNetId = (netId) => _byNetId.get(netId) || null;
export const byTab = Object.freeze(_byTab);

export const VALIDATION = Object.freeze({
  ok: true,
  rows: CATALOG.length,
  perTab: Object.freeze(TABS.reduce((o, t) => (o[t] = _byTab[t].length, o), {})),
  models: Object.keys(MODEL_MANIFEST).length,
  stats: STAT_NAMES.length,
  kinds: Object.keys(KINDS).length,
});

// Manifest models a row asks for that are not yet copied into assets/models/.
// Not an error: the model loader falls back procedurally per model. Reported so
// the gap is visible instead of silently ugly.
export function unstagedModels() {
  const out = [];
  for (const row of CATALOG) {
    if (row.model && !MODEL_MANIFEST[row.model].staged && out.indexOf(row.model) < 0) out.push(row.model);
  }
  return out;
}

// Stat table for a set of owned upgrade levels: { market_valuation: 2, ... }.
// Effects apply once per level, so this is the single place levels turn into
// numbers -- no consumer multiplies anything itself.
//
// `extra` is a list of effects in the SAME shape a row carries, for a modifier
// that is not something you bought: prestige is one, and it is the reason this
// parameter exists. It is folded by the same applyEffects() as everything else,
// so a prestige multiplier and an upgrade stack exactly the way two upgrades
// stack -- and there is no second multiplier living somewhere else for a
// consumer to read or to forget. Every effect in it is validated by the same
// closed stat list, because it goes through the same fold.
export function computeStats(levels, extra) {
  const list = [];
  for (const id of Object.keys(levels || {})) {
    const row = _byId.get(id);
    if (!row || !row.effects) continue;
    const n = Math.max(0, Math.round(levels[id]));
    for (let i = 0; i < n; i++) for (const e of row.effects) list.push(e);
  }
  if (Array.isArray(extra)) {
    for (const e of extra) {
      if (!e || !isStat(e.stat)) {
        throw new DataError(`computeStats(): extra effect names '${e && e.stat}', which is not a stat`);
      }
      if (STATS[e.stat].ops.indexOf(e.op) < 0) {
        throw new DataError(`computeStats(): stat '${e.stat}' does not accept op '${e.op}'`);
      }
      list.push(e);
    }
  }
  return applyEffects(list, baseStats());
}

export { STATS, STAT_NAMES, baseStats, applyEffects, VENDOR_LINES, VENDOR_SHORT, TAB_LABELS };

export default { CATALOG, byId, byTab, byNetId, TABS, KINDS, MODEL_MANIFEST, VALIDATION };
