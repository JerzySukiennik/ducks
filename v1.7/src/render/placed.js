// Placed buildings and dropped physics props.
//
// Both live in per-model InstancedMesh pools, so draw calls scale with the
// number of distinct MODELS on the plate, not with the number of objects: a
// hundred walls is still one draw call.
//
// A placed building is a static collider on the existing plate body -- the same
// trick the workbench uses -- so the boot-constant rigid-body count is untouched
// by building. A dropped prop is a real dynamic body, because a container has to
// land like a container.

import * as THREE from 'three';
import config from '../config.js';
import { propMaterial } from './props.js';
import { detectRotor } from './rotor.js';
import {
  shapeOf, blowDirection, setBlowQuaternion, streamGeometry, createAirMaterial,
} from './airflow.js';

// Rapier is imported lazily and only for dropped props. A static import here
// would put the physics CDN back on the boot critical path, and G0's whole
// robustness case is that a failed physics load degrades instead of blanking
// the screen.
let RAPIER = null;
export async function initDropPhysics() {
  if (RAPIER) return true;
  try {
    const mod = await import('@dimforge/rapier3d-compat');
    RAPIER = mod.default || mod;
    return true;
  } catch (err) {
    console.warn('[placed] physics props unavailable:', err && err.message);
    return false;
  }
}

const _m = new THREE.Matrix4();
const _off = new THREE.Matrix4();
const _scaleM = new THREE.Matrix4();
const _wheelM = new THREE.Matrix4();
const _spin = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
// Blades and airstreams. Module-scope like everything above, because both are
// written every frame for every fan on the plate and a `new` in there is 40
// allocations a frame that the garbage collector has to answer for.
const _rotorM = new THREE.Matrix4();
const _rotorQ = new THREE.Quaternion();
const _rotorAxis = new THREE.Vector3();
const _streamM = new THREE.Matrix4();
const _streamQ = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

const BLOWER_KIND = 'blower';

// The blades of a blower, found by measuring the mesh (see rotor.js) and split
// out of it once per MODEL, not per object. The body geometry loses them, so
// nothing draws a blade twice; the untouched original is kept as `fullGeometry`
// for the hologram, which wants the whole fan in one piece.
//
// Exported because the hologram has to run it before it reads `geometry`: split
// first, draw second, or a pool would be built around a mesh that still has its
// blades welded on.
export function ensureRotor(models, item) {
  if (!item || item.kind !== BLOWER_KIND || !item.blow) return null;
  const m = models && models[item.model];
  if (!m || !m.geometry) return null;
  if (m.rotor !== undefined) return m.rotor;
  const pitch = (typeof item.blow.pitchDegrees === 'number' ? item.blow.pitchDegrees : 0)
    * (Math.PI / 180);
  // The spin axis IS the blow axis: local +Z tilted by the row's pitch, the
  // same vector blowers.describe() builds the force out of.
  const found = detectRotor(m.geometry, { x: 0, y: Math.sin(pitch), z: Math.cos(pitch) });
  if (!found) {
    m.rotor = null;
    console.warn('[placed] no rotor found in model', item.model, '- its blades will not turn');
    return null;
  }
  m.fullGeometry = m.geometry;
  m.geometry = found.rest;
  if (!m.parts) m.parts = {};
  m.parts.blades = found.geometry;
  m.rotor = {
    pivot: found.pivot,
    axis: found.axis,
    blades: found.count,
    radius: found.radius,
    tris: found.tris,
  };
  return m.rotor;
}

// The model's own bounding box decides where the mesh sits inside the collider
// box: bottom on the collider's bottom face, centred in XZ. Measured, never
// assumed -- an authoring origin that drifts would otherwise sink the object
// into the floor with nothing on screen to explain it.
//
// `scale` is the row's modelScale: the mesh is drawn that many times its
// authored size, so the bounding box that decides the seating has to be
// measured at that size too. The returned offset is in WORLD metres.
export function modelOffset(geometry, halfY, scale) {
  const s = scaleOf(scale);
  geometry.computeBoundingBox();
  const b = geometry.boundingBox;
  return {
    x: -((b.min.x + b.max.x) / 2) * s,
    y: -b.min.y * s - halfY,
    z: -((b.min.z + b.max.z) / 2) * s,
  };
}

// A row may be drawn larger than its authored model: `modelScale`. The crank is
// the one model deliberately left off the 0.25 m grid, because config.machine.*
// holds a dozen hand-tuned model-local coordinates measured against that exact
// mesh -- so the purchased workbench is made to match the starter one by drawing
// the same geometry 1.6x, never by rescaling the geometry. The row's footprint
// and collider.half are authored in the resulting WORLD metres, which is what
// placement, overlap and physics read.
export function scaleOf(v) {
  const s = Number(typeof v === 'object' && v !== null ? v.modelScale : v);
  return isFinite(s) && s > 0 ? s : 1;
}

// Where a row's mesh sits inside its placement box, in WORLD metres.
//
// The default is the measured bounding box: bottom on the box floor, centred in
// XZ. A manual workbench is the exception, and not a special case invented here:
// config.machine.colliderLocalY/Z is the model-local anchor the STARTER bench
// already stands on, so a bought one uses the same numbers and ends up in the
// same relationship to its collider. Centring its bounding box instead put the
// cabinet 0.19 m off, because the crank's authored origin is not its centre and
// the wheel hangs off one side.
//
// Both the hologram and the placed object read this one function, which is the
// same rule resolvePlacement() follows for the pose.
export function seatOffset(models, item) {
  const halfY = item.collider.half[1];
  const scale = scaleOf(item);
  const model = models[item.model];
  const hasWheel = !!(model && model.parts && model.parts.wheel);
  if (item.kind === MANUAL_KIND && hasWheel) {
    const m = config.machine;
    return { x: 0, y: -m.colliderLocalY * scale, z: -m.colliderLocalZ * scale };
  }
  if (!model || !model.geometry) return { x: 0, y: 0, z: 0 };
  // The WHOLE model decides the seating, even after its blades have been split
  // off into their own pool: the object standing on the floor is the fan, not
  // the fan minus its rotor. On all three fans the two boxes happen to be
  // identical -- the cage is wider and taller than the blades either way --
  // but the rule must not depend on that staying true for the next fan.
  return modelOffset(model.fullGeometry || model.geometry, halfY, scale);
}

function createPool(scene, geometry, material, capacity, options) {
  const o = options || {};
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.frustumCulled = false;
  // Same deal as the duck pool: one flag, one extra instanced draw in the shadow
  // pass, however many walls are standing. These DO receive -- a wall is big
  // enough for the shadow of the wall next to it to be the thing that tells you
  // they are two separate objects.
  //
  // An airstream opts out of both: it is unlit additive glow with no solidity,
  // so a shadow of it would be a cone of darkness cast by moving air.
  mesh.castShadow = !!config.world.shadowsEnabled && !o.noShadow;
  mesh.receiveShadow = !!config.world.shadowsEnabled && !o.noShadow;
  if (o.renderOrder) mesh.renderOrder = o.renderOrder;
  // Named so a pool can be found in the scene graph and its instance matrices
  // read back. Verification that reads the numbers that went IN proves nothing;
  // this is how the blade angle actually on screen gets measured.
  if (o.name) mesh.name = o.name;
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);
  const free = new Set();
  let high = 0;

  return {
    mesh,
    capacity,
    alloc() {
      if (free.size) {
        const i = free.values().next().value;
        free.delete(i);
        return i;
      }
      if (high >= capacity) return -1;
      const i = high++;
      mesh.count = high;
      return i;
    },
    // Freeing the top of the pool shrinks the draw range. Without this an
    // emptied pool still costs a full draw call for a mesh nobody can see.
    release(i) {
      if (i < 0) return;
      mesh.setMatrixAt(i, HIDDEN);
      mesh.instanceMatrix.needsUpdate = true;
      free.add(i);
      while (high > 0 && free.has(high - 1)) { free.delete(high - 1); high--; }
      mesh.count = high;
    },
    set(i, matrix) {
      if (i < 0) return;
      mesh.setMatrixAt(i, matrix);
      mesh.instanceMatrix.needsUpdate = true;
    },
    get(i, out) { mesh.getMatrixAt(i, out); return out; },
    used: () => high - free.size,
  };
}

// The kind whose model carries a wheel you turn by hand. A behaviour is
// selected by kind, never by a row id.
const MANUAL_KIND = 'producer_manual';

export function createPlaced({ scene, models, world, groups }) {
  const material = propMaterial();
  const air = createAirMaterial();
  const pools = new Map();      // model name -> pool
  const objects = [];           // live placed buildings; also the worldQuery list
  const props = [];             // dropped dynamic props
  const rotors = [];            // placed objects whose blades turn
  const streams = [];           // placed objects drawing an airstream
  const raw = world._raw || null;
  let nextKey = 1;
  let lastAnimTime = null;

  function poolFor(name) {
    let p = pools.get(name);
    if (p) return p;
    const m = models[name];
    if (!m || !m.geometry) return null;
    p = createPool(scene, m.geometry, material, Math.round(config.build.instanceCapacity),
      { name: 'pool:' + name });
    pools.set(name, p);
    return p;
  }

  function offsetFor(name, halfY, scale) {
    const m = models[name];
    if (!m || !m.geometry) return { x: 0, y: 0, z: 0 };
    const s = scaleOf(scale);
    const key = '_off_' + halfY.toFixed(4) + '_' + s.toFixed(4);
    if (!m[key]) m[key] = modelOffset(m.geometry, halfY, s);
    return m[key];
  }

  // T(position) * R(quaternion) * T(seating offset, world metres) * S(modelScale).
  // The offset is applied BEFORE the scale on purpose: it is already in world
  // metres, so scaling it again would move a 1.6x machine off its own collider.
  function writeMatrix(pool, slot, pos, quat, off, scale) {
    const s = scaleOf(scale);
    _off.makeTranslation(off.x, off.y, off.z);
    _m.compose(_p.set(pos.x, pos.y, pos.z), _q.set(quat.x, quat.y, quat.z, quat.w), _s.set(1, 1, 1));
    _m.multiply(_off);
    if (s !== 1) _m.multiply(_scaleM.makeScale(s, s, s));
    pool.set(slot, _m);
    return _m;
  }

  // The collider is the placement box itself, yaw included -- world.addStaticBox
  // rotates the collider on the shared plate body. Earlier this passed an
  // axis-aligned box drawn around the rotated one, so the physics footprint of
  // an angled wall was wider than the wall.
  //
  // A row may override the physics shape with `collider.surface`: a different
  // half-extent, a pitch, and an offset along the placement box's own up axis.
  // That is how a ramp gets a sloped slab while the grid, the overlap test and
  // the model seating keep using the upright box they need.
  //
  // `collider.friction` and `collider.restitution` are the row's SURFACE, and
  // they are carried through here for the same reason the shape is: the row is
  // the only place that knows an ice slide is slippery and a trampoline bounces.
  // Both are optional, and a row naming neither gets exactly the collider it got
  // before the fields existed -- world.addStaticBox leaves restitution unset and
  // falls back to friction 0.9.
  const DEG = Math.PI / 180;
  function colliderBox(item, box) {
    const c = (item && item.collider) || {};
    const s = c.surface;
    const out = s
      ? {
        x: box.x,
        y: box.y + (typeof s.offsetY === 'number' ? s.offsetY : 0),
        z: box.z,
        hx: s.half[0], hy: s.half[1], hz: s.half[2],
        yaw: box.yaw,
        pitch: (typeof s.pitchDegrees === 'number' ? s.pitchDegrees : 0) * DEG,
      }
      : { ...box };
    if (typeof c.friction === 'number') out.friction = c.friction;
    if (typeof c.restitution === 'number') out.restitution = c.restitution;
    return out;
  }

  // --- placed buildings ------------------------------------------------------

  function place(item, pose) {
    // Before the body pool exists, or it would be built around a mesh that
    // still has the blades welded to it.
    ensureRotor(models, item);
    const pool = poolFor(item.model);
    if (!pool) return null;
    const slot = pool.alloc();
    if (slot < 0) return null;
    const box = pose.box;
    const scale = scaleOf(item);
    const off = seatOffset(models, item);
    writeMatrix(pool, slot, pose.position, pose.quaternion, off, scale);

    const collider = world.addStaticBox(colliderBox(item, box));
    const rec = {
      key: nextKey++,
      id: item.id,
      netId: item.netId,
      name: item.name,
      model: item.model,
      slot,
      pool,
      collider,
      position: { x: pose.position.x, y: pose.position.y, z: pose.position.z },
      quaternion: { ...pose.quaternion },
      // worldQuery reads these directly, so a placed object blocks the next one.
      x: box.x, y: box.y, z: box.z, yaw: box.yaw,
      hx: box.hx, hy: box.hy, hz: box.hz,
      c: Math.cos(box.yaw), s: Math.sin(box.yaw),
      free: !!pose.free,
      scale,
      off,
      kind: item.kind,
      wheelPool: null,
      wheelSlot: -1,
      wheelAngle: 0,
      rotorPool: null,
      rotorSlot: -1,
      rotorAngle: 0,
      rotorSpeed: 0,
      rotor: null,
      streamPool: null,
      streamSlot: -1,
    };
    attachWheel(rec, item);
    attachRotor(rec, item);
    attachStream(rec, item);
    objects.push(rec);
    return rec;
  }

  // --- the blades of a fan ----------------------------------------------------
  //
  // Selected by KIND (`blower`) plus the model actually having a rotor, exactly
  // as the workbench wheel is selected by `producer_manual` plus a wheel part.
  // The blades live in their own InstancedMesh, so twenty fans cost one extra
  // draw call between them and not twenty.

  function rotorPoolFor(name) {
    const key = name + ':blades';
    let p = pools.get(key);
    if (p) return p;
    const m = models[name];
    if (!m || !m.parts || !m.parts.blades) return null;
    p = createPool(scene, m.parts.blades, material, Math.round(config.build.instanceCapacity),
      { name: 'pool:' + key });
    pools.set(key, p);
    return p;
  }

  function attachRotor(rec, item) {
    if (!item || item.kind !== BLOWER_KIND) return;
    const m = models[item.model];
    const rotor = m && m.rotor;
    if (!rotor) return;
    const pool = rotorPoolFor(rec.model);
    if (!pool) return;
    const slot = pool.alloc();
    if (slot < 0) return;
    rec.rotorPool = pool;
    rec.rotorSlot = slot;
    rec.rotor = rotor;
    // A stronger fan spins faster, and how much faster is the row's own force
    // against the Fan's -- data, not a table of ids.
    const S = config.render.fanSpin;
    const force = item.blow && item.blow.force > 0 ? item.blow.force : S.referenceForce;
    const scale = Math.pow(force / S.referenceForce, S.forceExponent);
    rec.rotorSpeed = Math.min(S.maxTurnsPerSecond, S.turnsPerSecond * scale) * Math.PI * 2;
    // A blade angle of zero is still a pose: write it now so the fan is not
    // blank for one frame after it is built.
    writeRotor(rec);
    rotors.push(rec);
  }

  function writeRotor(rec) {
    if (!rec.rotorPool || rec.rotorSlot < 0) return;
    const r = rec.rotor;
    _rotorM.copy(bodyMatrix(rec));
    _rotorM.multiply(_off.makeTranslation(r.pivot.x, r.pivot.y, r.pivot.z));
    _rotorAxis.set(r.axis.x, r.axis.y, r.axis.z);
    _rotorQ.setFromAxisAngle(_rotorAxis, rec.rotorAngle);
    _rotorM.multiply(_spin.makeRotationFromQuaternion(_rotorQ));
    rec.rotorPool.set(rec.rotorSlot, _rotorM);
  }

  // --- the visible airstream --------------------------------------------------
  //
  // One instanced mesh per blower ROW (the cone's shape is the row's data, so
  // every Fan shares one geometry), one shared additive material for all of
  // them, and a matrix written once when the object is placed: the animation is
  // a scrolling texture, not moving vertices.

  function streamPoolFor(item) {
    const key = 'stream:' + item.id;
    let p = pools.get(key);
    if (p) return p;
    const shape = shapeOf(item);
    if (!shape || !(shape.range > 0)) return null;
    p = createPool(
      scene, streamGeometry(shape), air.material,
      Math.round(config.render.airflow.instanceCapacity),
      { noShadow: true, renderOrder: 2, name: 'pool:' + key }
    );
    pools.set(key, p);
    return p;
  }

  function attachStream(rec, item) {
    if (!item || item.kind !== BLOWER_KIND || !item.blow) return;
    const pool = streamPoolFor(item);
    if (!pool) return;
    const slot = pool.alloc();
    if (slot < 0) return;
    rec.streamPool = pool;
    rec.streamSlot = slot;
    const pitch = (typeof item.blow.pitchDegrees === 'number' ? item.blow.pitchDegrees : 0)
      * DEG;
    rec.blowPitch = pitch;
    // The apex sits at the object's own centre and the axis is
    // blowDirection(yaw, pitch) -- rec.x/y/z and rec.yaw are the exact fields
    // blowers.describe() reads, so the cone starts where the force starts.
    setBlowQuaternion(_streamQ, rec.yaw, pitch);
    _streamM.compose(_p.set(rec.x, rec.y, rec.z), _streamQ, _one);
    pool.set(slot, _streamM);
    streams.push(rec);
  }

  // What the airstream is DRAWN along, read back out of the instance matrix,
  // against what blowers.js pushes along. Verification compares these two; they
  // are computed by different code from the same two numbers.
  function streamCheck() {
    const out = [];
    for (let i = 0; i < streams.length; i++) {
      const rec = streams[i];
      rec.streamPool.get(rec.streamSlot, _m);
      _m.decompose(_p, _q, _s);
      const drawn = new THREE.Vector3(0, 0, 1).applyQuaternion(_q);
      const want = blowDirection(rec.yaw, rec.blowPitch || 0);
      out.push({
        key: rec.key,
        id: rec.id,
        yawDegrees: (rec.yaw * 180) / Math.PI,
        drawn: { x: drawn.x, y: drawn.y, z: drawn.z },
        physics: want,
        error: Math.hypot(drawn.x - want.x, drawn.y - want.y, drawn.z - want.z),
        apex: { x: _p.x, y: _p.y, z: _p.z },
        origin: { x: rec.x, y: rec.y, z: rec.z },
      });
    }
    return out;
  }

  // Blades turn, bands travel. Both are clocked on whatever time the caller
  // hands in -- the simulation clock when there is one, so debugStep drives
  // them exactly like the rest of the world, and the wall clock only as a
  // fallback so a caller that passes nothing still sees a turning fan.
  function animate(time) {
    const t = typeof time === 'number' && isFinite(time) ? time : performance.now() / 1000;
    if (lastAnimTime === null) lastAnimTime = t;
    let dt = t - lastAnimTime;
    lastAnimTime = t;
    if (!(dt > 0)) return 0;
    if (dt > 0.25) dt = 0.25;   // a paused tab must not spin the blades a lap
    for (let i = 0; i < rotors.length; i++) {
      const rec = rotors[i];
      rec.rotorAngle = (rec.rotorAngle + rec.rotorSpeed * dt) % (Math.PI * 2);
      writeRotor(rec);
    }
    air.advance(dt);
    return dt;
  }

  // --- the turning wheel of a manual workbench --------------------------------
  //
  // Selected by KIND (`producer_manual`) plus the model actually having a wheel
  // part, never by id. models.js splits the crank mesh in two at load; props.js
  // re-centres that wheel geometry on its hub so it can be spun, and both the
  // starter workbench and every purchased one share that one geometry -- hence
  // the pivot below is a plain T(hub) * Rx(angle) in model space.
  //
  // The wheel lives in its own InstancedMesh, so a hundred workbenches still
  // cost two draw calls: one for the bodies, one for the wheels.
  function wheelPoolFor(name) {
    const key = name + ':wheel';
    let p = pools.get(key);
    if (p) return p;
    const m = models[name];
    if (!m || !m.parts || !m.parts.wheel) return null;
    p = createPool(scene, m.parts.wheel, material, Math.round(config.build.instanceCapacity),
      { name: 'pool:' + key });
    pools.set(key, p);
    return p;
  }

  function attachWheel(rec, item) {
    if (!item || item.kind !== MANUAL_KIND) return;
    const pool = wheelPoolFor(rec.model);
    if (!pool) return;
    const slot = pool.alloc();
    if (slot < 0) return;
    rec.wheelPool = pool;
    rec.wheelSlot = slot;
    writeWheel(rec);
  }

  function writeWheel(rec) {
    if (!rec.wheelPool || rec.wheelSlot < 0) return;
    const m = config.machine;
    _wheelM.copy(bodyMatrix(rec));
    _wheelM.multiply(_off.makeTranslation(m.wheelLocalX, m.wheelLocalY, m.wheelLocalZ));
    _wheelM.multiply(_spin.makeRotationX(rec.wheelAngle));
    rec.wheelPool.set(rec.wheelSlot, _wheelM);
  }

  // The record's model matrix, rebuilt from its stored pose. Same composition as
  // writeMatrix, so anything expressed in model-local metres -- the wheel hub,
  // the output pipe -- lands exactly where the drawn mesh has it.
  function bodyMatrix(rec) {
    _m.compose(
      _p.set(rec.position.x, rec.position.y, rec.position.z),
      _q.set(rec.quaternion.x, rec.quaternion.y, rec.quaternion.z, rec.quaternion.w),
      _s.set(1, 1, 1)
    );
    _m.multiply(_off.makeTranslation(rec.off.x, rec.off.y, rec.off.z));
    if (rec.scale !== 1) _m.multiply(_scaleM.makeScale(rec.scale, rec.scale, rec.scale));
    return _m;
  }

  const _lv = new THREE.Vector3();
  function localToWorld(rec, x, y, z) {
    _lv.set(x, y, z).applyMatrix4(bodyMatrix(rec));
    return { x: _lv.x, y: _lv.y, z: _lv.z };
  }

  function setWheelAngle(rec, a) {
    if (!rec) return 0;
    rec.wheelAngle = a;
    writeWheel(rec);
    return rec.wheelAngle;
  }

  function cranks() {
    const out = [];
    for (let i = 0; i < objects.length; i++) if (objects[i].wheelSlot >= 0) out.push(objects[i]);
    return out;
  }

  function wheelCenter(rec) {
    const m = config.machine;
    return localToWorld(rec, m.wheelLocalX, m.wheelLocalY, m.wheelLocalZ);
  }

  function wheelHitRadius(rec) {
    const m = config.machine;
    return m.wheelRadius * rec.scale * m.hitRadiusScale;
  }

  // The nearest purchased workbench wheel under the crosshair, or null. Same
  // ray/sphere test and same one-sided guard as props.wheelAimDistance, on the
  // wheel hub of each placed bench: the eye has to be on the side the wheel is,
  // so a bench cannot be cranked through its own cabinet.
  function crankAim(origin, dir) {
    const range = config.machine.useRange;
    let best = null;
    let bestT = range;
    const list = cranks();
    for (let i = 0; i < list.length; i++) {
      const rec = list[i];
      const c = wheelCenter(rec);
      const R = wheelHitRadius(rec);
      // Model-local +X in world, i.e. the side the wheel is on.
      if ((origin.x - c.x) * rec.c + (origin.z - c.z) * -rec.s <= 0) continue;
      const mx = origin.x - c.x;
      const my = origin.y - c.y;
      const mz = origin.z - c.z;
      const b = mx * dir.x + my * dir.y + mz * dir.z;
      const q = mx * mx + my * my + mz * mz - R * R;
      const disc = b * b - q;
      if (disc < 0) continue;
      const root = Math.sqrt(disc);
      let t = -b - root;
      if (t < 0) t = -b + root;
      if (t >= 0 && t < bestT) { bestT = t; best = rec; }
    }
    return best ? { rec: best, distance: bestT } : null;
  }

  // The output pipe mouth and the eject direction of a placed bench, from the
  // same model-local numbers the starter bench uses. Local +Z is the front.
  function machineMouth(rec) {
    const m = config.machine;
    const p = localToWorld(rec, m.pipeLocalX, m.pipeLocalY, m.pipeLocalZ);
    return { x: p.x + rec.s * m.ejectOffset, y: p.y, z: p.z + rec.c * m.ejectOffset };
  }

  function machineEject(rec) {
    const m = config.machine;
    const l = Math.hypot(rec.s, m.ejectDrop, rec.c) || 1;
    return { x: rec.s / l, y: m.ejectDrop / l, z: rec.c / l };
  }

  function remove(rec) {
    if (!rec) return false;
    const i = objects.indexOf(rec);
    if (i < 0) return false;
    objects.splice(i, 1);
    rec.pool.release(rec.slot);
    if (rec.wheelPool && rec.wheelSlot >= 0) {
      rec.wheelPool.release(rec.wheelSlot);
      rec.wheelPool = null;
      rec.wheelSlot = -1;
    }
    if (rec.rotorPool && rec.rotorSlot >= 0) {
      rec.rotorPool.release(rec.rotorSlot);
      rec.rotorPool = null;
      rec.rotorSlot = -1;
      const ri = rotors.indexOf(rec);
      if (ri >= 0) rotors.splice(ri, 1);
    }
    // The wind stops when the fan does. A demolished fan leaving its airstream
    // behind would be the same silent lie as a demolished fan still pushing.
    if (rec.streamPool && rec.streamSlot >= 0) {
      rec.streamPool.release(rec.streamSlot);
      rec.streamPool = null;
      rec.streamSlot = -1;
      const si = streams.indexOf(rec);
      if (si >= 0) streams.splice(si, 1);
    }
    if (rec.collider && raw) {
      try { raw.removeCollider(rec.collider, true); } catch (e) { /* already gone */ }
    }
    return true;
  }

  // The pose actually on screen, read back out of the instance matrix and with
  // the model offset undone. This is what verification compares against the
  // hologram: the stored numbers prove nothing, the matrix does.
  function renderedPose(rec) {
    rec.pool.get(rec.slot, _m);
    _m.decompose(_p, _q, _s);
    const off = rec.off || offsetFor(rec.model, rec.hy, rec.scale);
    const v = new THREE.Vector3(off.x, off.y, off.z).applyQuaternion(_q);
    return {
      position: { x: _p.x - v.x, y: _p.y - v.y, z: _p.z - v.z },
      quaternion: { x: _q.x, y: _q.y, z: _q.z, w: _q.w },
    };
  }

  // The pose physics actually got, straight off the collider.
  function colliderPose(rec) {
    if (!rec.collider || typeof rec.collider.translation !== 'function') return null;
    const t = rec.collider.translation();
    const r = rec.collider.rotation();
    return {
      position: { x: t.x, y: t.y, z: t.z },
      quaternion: { x: r.x, y: r.y, z: r.z, w: r.w },
    };
  }

  // Slab test in each box's own frame. Used by demolish targeting.
  function raycast(origin, dir, range) {
    const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const d = { x: dir.x / dl, y: dir.y / dl, z: dir.z / dl };
    let best = null;
    let bestT = range;
    for (let i = 0; i < objects.length; i++) {
      const o = objects[i];
      const ox = origin.x - o.x;
      const oy = origin.y - o.y;
      const oz = origin.z - o.z;
      const lo = { x: ox * o.c + oz * o.s, y: oy, z: -ox * o.s + oz * o.c };
      const ld = { x: d.x * o.c + d.z * o.s, y: d.y, z: -d.x * o.s + d.z * o.c };
      let t0 = 0;
      let t1 = bestT;
      let hit = true;
      const h = [o.hx, o.hy, o.hz];
      const lop = [lo.x, lo.y, lo.z];
      const ldp = [ld.x, ld.y, ld.z];
      for (let a = 0; a < 3 && hit; a++) {
        if (Math.abs(ldp[a]) < 1e-9) {
          if (Math.abs(lop[a]) > h[a]) hit = false;
        } else {
          let ta = (-h[a] - lop[a]) / ldp[a];
          let tb = (h[a] - lop[a]) / ldp[a];
          if (ta > tb) { const s = ta; ta = tb; tb = s; }
          if (ta > t0) t0 = ta;
          if (tb < t1) t1 = tb;
          if (t0 > t1) hit = false;
        }
      }
      if (hit && t0 >= 0 && t0 < bestT) { bestT = t0; best = o; }
    }
    return best ? { object: best, distance: bestT } : null;
  }

  function nearest(point, range) {
    let best = null;
    let bestD = range;
    for (let i = 0; i < objects.length; i++) {
      const o = objects[i];
      const d = Math.hypot(o.x - point.x, o.y - point.y, o.z - point.z);
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  }

  function countOf(id) {
    let n = 0;
    for (let i = 0; i < objects.length; i++) if (objects[i].id === id) n++;
    return n;
  }

  // --- dropped physics props -------------------------------------------------

  function dropProp(item, pos, vel) {
    if (!raw || !RAPIER) return null;
    const pool = poolFor(item.model);
    if (!pool) return null;
    // AT THE CAP, REFUSE. This used to despawn the oldest prop to make room,
    // which meant a crate somebody paid for could vanish from the floor with
    // nothing on screen to say so -- the same silent-deletion failure the duck
    // pool is explicitly forbidden from having. Every caller already has a way
    // to report a refusal: the chute queues the delivery and says how many are
    // waiting, a throw is refused with a reason, and a snapshot restore counts
    // what it could not fit.
    if (atCap()) return null;
    const slot = pool.alloc();
    if (slot < 0) return null;

    const d = config.drop;
    const half = item.collider.half;
    // The same surface the row would have if it were built rather than dropped.
    // A crate that bounces on the plate has to bounce lying on the drop zone as
    // well, or the material would be a property of how the object got there.
    const friction = typeof item.collider.friction === 'number' ? item.collider.friction : d.friction;
    const restitution = typeof item.collider.restitution === 'number'
      ? item.collider.restitution : d.restitution;
    const body = raw.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setLinearDamping(d.linearDamping)
        .setAngularDamping(d.angularDamping)
        .setCanSleep(true)
    );
    raw.createCollider(
      RAPIER.ColliderDesc.cuboid(half[0], half[1], half[2])
        .setDensity(d.density)
        .setFriction(friction)
        .setRestitution(restitution)
        .setCollisionGroups(groups.interactionGroups(
          groups.GROUP_PROP, groups.GROUP_WORLD | groups.GROUP_PROP | groups.GROUP_PLAYER
        )),
      body
    );
    if (vel) body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);

    const rec = {
      key: nextKey++, id: item.id, netId: item.netId, name: item.name,
      model: item.model, slot, pool, body,
      half: [half[0], half[1], half[2]], halfY: half[1], mass: body.mass(),
      // A dropped prop is drawn at the row's modelScale for the same reason a
      // placed one is: collider.half is authored in world metres, so the mesh
      // has to be the size of the box it is falling in. Same seating as the
      // placed object, so a workbench looks the same lying on the drop zone as
      // it does once it is built.
      scale: scaleOf(item),
      off: seatOffset(models, item),
    };
    props.push(rec);
    return rec;
  }

  function despawnProp(rec) {
    const i = props.indexOf(rec);
    if (i < 0) return false;
    props.splice(i, 1);
    rec.pool.release(rec.slot);
    if (raw) { try { raw.removeRigidBody(rec.body); } catch (e) { /* gone */ } }
    return true;
  }

  function atCap() { return props.length >= Math.round(config.drop.max); }

  // Called once a frame by the loop. `time` is the simulation clock when the
  // caller has one; see animate().
  function syncProps(time) {
    animate(time);
    for (let i = 0; i < props.length; i++) {
      const r = props[i];
      const t = r.body.translation();
      const q = r.body.rotation();
      writeMatrix(r.pool, r.slot, t, q, r.off || offsetFor(r.model, r.halfY, r.scale), r.scale);
    }
  }

  // What is under the crosshair, among the things lying on the floor. Slab test
  // in each prop's OWN frame, read off its live body pose -- a prop tumbles, so
  // an axis-aligned test would miss a broom lying at any angle but one.
  const _rq = new THREE.Quaternion();
  const _rv = new THREE.Vector3();
  function raycastProps(origin, dir, range) {
    const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const d = { x: dir.x / dl, y: dir.y / dl, z: dir.z / dl };
    let best = null;
    let bestT = range;
    for (let i = 0; i < props.length; i++) {
      const r = props[i];
      const t = r.body.translation();
      const q = r.body.rotation();
      _rq.set(q.x, q.y, q.z, q.w).invert();
      const lo = _rv.set(origin.x - t.x, origin.y - t.y, origin.z - t.z)
        .applyQuaternion(_rq).toArray();
      const ld = _rv.set(d.x, d.y, d.z).applyQuaternion(_rq).toArray();
      const h = r.half;
      let t0 = 0;
      let t1 = bestT;
      let hit = true;
      for (let a = 0; a < 3 && hit; a++) {
        if (Math.abs(ld[a]) < 1e-9) {
          if (Math.abs(lo[a]) > h[a]) hit = false;
        } else {
          let ta = (-h[a] - lo[a]) / ld[a];
          let tb = (h[a] - lo[a]) / ld[a];
          if (ta > tb) { const s = ta; ta = tb; tb = s; }
          if (ta > t0) t0 = ta;
          if (tb < t1) t1 = tb;
          if (t0 > t1) hit = false;
        }
      }
      if (hit && t0 >= 0 && t0 < bestT) { bestT = t0; best = r; }
    }
    return best ? { prop: best, distance: bestT } : null;
  }

  function propByKey(key) {
    for (let i = 0; i < props.length; i++) if (props[i].key === key) return props[i];
    return null;
  }

  function propPose(rec) {
    const t = rec.body.translation();
    const q = rec.body.rotation();
    return { position: { x: t.x, y: t.y, z: t.z }, quaternion: { x: q.x, y: q.y, z: q.z, w: q.w } };
  }

  function dispose() {
    for (let i = props.length - 1; i >= 0; i--) despawnProp(props[i]);
    for (let i = objects.length - 1; i >= 0; i--) remove(objects[i]);
    pools.forEach((p) => { scene.remove(p.mesh); p.mesh.dispose(); });
    pools.clear();
    rotors.length = 0;
    streams.length = 0;
    material.dispose();
    air.dispose();
  }

  return {
    objects,
    props,
    place,
    remove,
    renderedPose,
    colliderPose,
    raycast,
    nearest,
    countOf,
    // Purchased manual workbenches: the same size, the same crank and the same
    // turning wheel as the starter one.
    cranks,
    setWheelAngle,
    localToWorld,
    crankAim,
    wheelCenter,
    wheelHitRadius,
    machineMouth,
    machineEject,
    scaleOf: (rec) => (rec && rec.scale) || 1,
    dropProp,
    despawnProp,
    atCap,
    syncProps,
    propPose,
    raycastProps,
    propByKey,
    // A snapshot restore adopts the HOST's instance keys, which are handed out
    // by this same counter on a different machine and are therefore usually
    // ahead of the local one. Without this, the next locally placed object or
    // dropped prop would be issued a key that is already live, and everything
    // keyed by it -- containers, producer timers, every later net message about
    // that object -- would address two things at once.
    reserveKey(key) {
      const k = Math.round(Number(key));
      if (isFinite(k) && k >= nextKey) nextKey = k + 1;
      return nextKey;
    },
    nextKey: () => nextKey,
    poolCount: () => pools.size,
    // The blades and the wind, for verification: how many are turning, how fast,
    // and where each one is pointing against where the force goes.
    animate,
    streamCheck,
    // The hooks this module owes window.GAME, in the convention the containers,
    // the tools and the audio already use. One line in main.js
    // (`Object.assign(window.GAME, ..., placed.debugHooks())`) publishes them.
    debugHooks: () => ({
      debugRotors: () => rotors.map((r) => ({
        key: r.key,
        id: r.id,
        blades: r.rotor ? r.rotor.blades : 0,
        turnsPerSecond: r.rotorSpeed / (Math.PI * 2),
        degrees: (r.rotorAngle * 180) / Math.PI,
      })),
      debugAirflow: () => ({ streams: streamCheck(), scroll: air.scroll() }),
    }),
    rotorState: () => rotors.map((r) => ({
      key: r.key,
      id: r.id,
      blades: r.rotor ? r.rotor.blades : 0,
      tris: r.rotor ? r.rotor.tris : 0,
      pivot: r.rotor ? r.rotor.pivot : null,
      axis: r.rotor ? r.rotor.axis : null,
      turnsPerSecond: r.rotorSpeed / (Math.PI * 2),
      degrees: (r.rotorAngle * 180) / Math.PI,
    })),
    airScroll: () => air.scroll(),
    stats: () => ({
      placed: objects.length,
      props: props.length,
      pools: pools.size,
      rotors: rotors.length,
      streams: streams.length,
      instances: Array.from(pools.values()).reduce((a, p) => a + p.used(), 0),
    }),
    dispose,
  };
}

export default createPlaced;
