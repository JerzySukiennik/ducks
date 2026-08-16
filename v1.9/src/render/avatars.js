// Other players in the world.
//
// Four decisions here are not negotiable and the first two were settled earlier
// in this project:
//
// 1. Remote poses are INTERPOLATED, never simulated. The host owns every body;
//    a client that ran its own capsule physics for someone else would disagree
//    with the host within a second and then fight it. This file takes stamped
//    samples and plays them back net.interpDelayMs in the past, which is why
//    there is almost always a later sample to interpolate towards.
// 2. A nickname is a DOM element positioned by PROJECTING the head point, never
//    a texture in the world. The game renders into a 480 px backbuffer and
//    upscales it with image-rendering: pixelated, so world-space text is mush.
//    This was decided in G0 and it applies to every label, not just the one
//    under the crosshair.
// 3. There is NO skeleton and NO animation clip. avatar.glb is one baked mesh.
//    The limbs are FOUND by measuring it -- connected components classified by
//    where they sit in the model's own bounding box -- exactly the way
//    src/render/rotor.js finds the blades of a fan that has no "blades" object
//    either. The parts are then rotated with numbers. If the measurement does
//    not validate, the avatar degrades to the single rigid mesh it was before
//    this file grew limbs; it never draws a person with one arm.
// 4. The gait is driven by MEASURED speed, differentiated from the same
//    interpolated pose the body is drawn at. Never by a free-running clock. A
//    clock-driven walk keeps striding while a player stands still, and that one
//    detail is the difference between a character and a puppet. Standing still
//    settles to the rest pose because the amplitude decays to zero, and the rest
//    pose is all-angles-zero -- i.e. bit for bit the mesh this file used to draw.
//
// COST: one InstancedMesh per PART, not per player. Six draw calls covers any
// number of avatars, plus one more per distinct model somebody is holding.

import * as THREE from 'three';
import config from '../config.js';
import { propMaterial } from './props.js';
import { components, subGeometry } from './models.js';
import { byId } from '../data/index.js';

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _root = new THREE.Matrix4();
const _torso = new THREE.Matrix4();
const _joint = new THREE.Matrix4();
const _back = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);
const XA = new THREE.Vector3(1, 0, 0);
const YA = new THREE.Vector3(0, 1, 0);
const ZA = new THREE.Vector3(0, 0, 1);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const DEG = Math.PI / 180;
// Module scope like everything above: these are touched once per avatar per
// frame, and a `new` in there is allocation the garbage collector has to answer
// for at 60 Hz.
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _touched = new Set();

// The six parts, in the order they are built and reported. `torso` is the root
// of the upper body: head and both arms hang off it, so one lean and one bob
// move all four together and the legs stay planted.
const PARTS = ['torso', 'head', 'armR', 'armL', 'legR', 'legL'];

const CSS = `
#avatar-labels { position: fixed; inset: 0; z-index: 11; pointer-events: none;
  font: 700 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; }
.avatar-label { position: absolute; transform: translate(-50%, -100%);
  padding: 2px 7px; white-space: nowrap; display: none;
  background: rgba(8,12,26,0.72); border: 1px solid rgba(120,150,220,0.45);
  color: #dfe7fb; text-shadow: 0 2px 0 rgba(0,0,0,0.6); }
.avatar-label.on { display: block; }
`;

// Shortest-arc angle lerp: without it a player crossing the +/-PI seam spins
// the long way round, once, every time they turn past south.
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// Frame-rate independent smoothing. dt in seconds, tau the time constant.
function approach(current, target, dt, tau) {
  if (!(tau > 0)) return target;
  const k = 1 - Math.exp(-dt / tau);
  return current + (target - current) * k;
}

function bboxOf(geometry) {
  geometry.computeBoundingBox();
  return geometry.boundingBox;
}

// --- finding the limbs -------------------------------------------------------
//
// `geo` is the BAKED geometry: modelYaw, scale and yOffset already applied, so
// the character faces -Z (a player's yaw 0 looks down -Z) and its own right hand
// is at +X. Everything below is expressed in that frame, which is also the frame
// the animation rotates in -- no second convention to keep straight.
//
// The rule, in one sentence: a component far enough out to the SIDE is an arm;
// of what is left, anything below the hip line is a leg and anything above the
// neck line is the head; the rest is the torso. All three lines are fractions of
// the model's own bounding box (config.avatars.part*Frac), so nothing here is a
// metre measured off one particular export.
function splitRig(geo, cfg) {
  const parts = components(geo);
  // Six groups cannot come out of fewer than six solids, and the real model has
  // 34. A fan-shaped or box-shaped mesh drops straight through to the fallback.
  if (parts.length < 12) return null;
  const bb = bboxOf(geo);
  const halfX = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x));
  const baseY = bb.min.y;
  const height = bb.max.y - bb.min.y;
  if (!(halfX > 0) || !(height > 0)) return null;

  const lateral = cfg.partLateralFrac * halfX;
  const hipY = baseY + cfg.partHipFrac * height;
  const headY = baseY + cfg.partHeadFrac * height;
  const groups = {};
  PARTS.forEach((n) => { groups[n] = []; });

  for (let i = 0; i < parts.length; i++) {
    const c = parts[i];
    const ax = Math.abs(c.centroid.x);
    const side = c.centroid.x >= 0 ? 'R' : 'L';
    let name;
    // Order matters: a hand sits at the same height as a hip and is told apart
    // from it by how far out it is, never by how low it is.
    if (ax > lateral) name = 'arm' + side;
    else if (c.centroid.y < hipY && ax > 0.06 * halfX) name = 'leg' + side;
    else if (c.centroid.y > headY) name = 'head';
    else name = 'torso';
    groups[name].push(c);
  }

  // The validator, and it is the point of the exercise: the split is only
  // trusted if it produced a plausible BODY. Arms and legs are mirror pairs in
  // this model, so an off threshold shows up immediately as a left arm with a
  // different triangle count from the right. A near-miss like the fan builder's
  // (its motor block joining the blades) fails here rather than on screen.
  let total = 0;
  for (let i = 0; i < PARTS.length; i++) {
    const g = groups[PARTS[i]];
    if (!g.length) return null;
    for (let j = 0; j < g.length; j++) total += g[j].tris.length;
  }
  if (total !== geo.attributes.position.count / 3) return null;
  const triCount = (g) => g.reduce((n, c) => n + c.tris.length, 0);
  const areaOf = (g) => g.reduce((n, c) => n + c.area, 0);
  const pairOk = (a, b) => triCount(groups[a]) === triCount(groups[b])
    && Math.abs(areaOf(groups[a]) - areaOf(groups[b]))
      <= 0.01 * Math.max(areaOf(groups[a]), areaOf(groups[b]));
  if (!pairOk('armL', 'armR') || !pairOk('legL', 'legR')) return null;
  // A leg that outweighs the torso, or a head bigger than the body, means the
  // lines landed somewhere silly.
  if (triCount(groups.legR) > triCount(groups.torso)) return null;

  const rig = { parts: {}, pivots: {}, hand: {}, tris: {} };
  for (let i = 0; i < PARTS.length; i++) {
    const name = PARTS[i];
    const g = groups[name];
    const tris = [];
    for (let j = 0; j < g.length; j++) for (let k = 0; k < g[j].tris.length; k++) tris.push(g[j].tris[k]);
    tris.sort((a, b) => a - b);
    rig.parts[name] = subGeometry(geo, tris);
    rig.tris[name] = tris.length;

    // The pivot is a JOINT, and every joint in this model is the ball that
    // bridges two segments, so it is found by picking the extreme component of
    // the group rather than by averaging the group (which would put a shoulder
    // halfway down the upper arm).
    let hi = g[0];
    let lo = g[0];
    for (let j = 1; j < g.length; j++) {
      if (g[j].centroid.y > hi.centroid.y) hi = g[j];
      if (g[j].centroid.y < lo.centroid.y) lo = g[j];
    }
    if (name === 'head') {
      // The neck base, not the neck's middle: a head that pivots about its own
      // centre shears off the shoulders.
      const b = bboxOf(rig.parts[name]);
      rig.pivots[name] = new THREE.Vector3(0, b.min.y, (b.min.z + b.max.z) / 2);
    } else if (name === 'torso') {
      // The pelvis: the lean and the bob hinge at the waist.
      rig.pivots[name] = new THREE.Vector3(0, lo.centroid.y, lo.centroid.z);
    } else {
      // Shoulder for an arm, hip for a leg -- the topmost ball of the chain.
      rig.pivots[name] = new THREE.Vector3(hi.centroid.x, hi.centroid.y, hi.centroid.z);
      if (name === 'armR' || name === 'armL') {
        // And the hand is the bottom of the same chain. This is where a held
        // item is drawn, so it is measured, not typed in.
        rig.hand[name] = new THREE.Vector3(lo.centroid.x, lo.centroid.y, lo.centroid.z);
      }
    }
  }
  rig.height = height;
  rig.measured = {
    lateral, hipY, headY, halfX, height, components: parts.length,
  };
  return rig;
}

// The rig when there is no avatar.glb at all. Same six parts, same pivots, built
// out of boxes -- a missing model must read as "a player is standing there", and
// after this round it must also read as a player who WALKS, or the fallback
// would quietly lose the thing this round added.
function fallbackRig(cfg) {
  const col = new THREE.Color(0.55, 0.62, 0.78);
  const paint = (g) => {
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  };
  const box = (w, h, d, x, y, z) => {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    g.translate(x, y, z);
    return paint(g);
  };
  const rig = { parts: {}, pivots: {}, hand: {}, tris: {}, height: 1.8, measured: null };
  rig.parts.torso = box(0.46, 0.60, 0.28, 0, 1.12, 0);
  rig.pivots.torso = new THREE.Vector3(0, 0.82, 0);
  rig.parts.head = box(0.26, 0.26, 0.26, 0, 1.55, 0);
  rig.pivots.head = new THREE.Vector3(0, 1.42, 0);
  [['armR', 1], ['armL', -1]].forEach(([n, s]) => {
    rig.parts[n] = box(0.13, 0.66, 0.16, s * 0.29, 1.09, 0);
    rig.pivots[n] = new THREE.Vector3(s * 0.29, 1.42, 0);
    rig.hand[n] = new THREE.Vector3(s * 0.29, 0.78, 0);
  });
  [['legR', 1], ['legL', -1]].forEach(([n, s]) => {
    rig.parts[n] = box(0.16, 0.82, 0.20, s * 0.12, 0.41, 0);
    rig.pivots[n] = new THREE.Vector3(s * 0.12, 0.82, 0);
  });
  PARTS.forEach((n) => { rig.tris[n] = rig.parts[n].attributes.position.count / 3; });
  // The measured rig is baked before it is split; this one is built in "feet on
  // y = 0" space, so it takes the same bake afterwards.
  const bake = new THREE.Matrix4()
    .makeTranslation(0, cfg.yOffset, 0)
    .multiply(new THREE.Matrix4().makeScale(cfg.scale, cfg.scale, cfg.scale))
    .multiply(new THREE.Matrix4().makeRotationY(cfg.modelYaw));
  PARTS.forEach((n) => {
    rig.parts[n].applyMatrix4(bake);
    rig.pivots[n].applyMatrix4(bake);
    if (rig.hand[n]) rig.hand[n].applyMatrix4(bake);
  });
  return rig;
}

export function createAvatarsView(opts) {
  const o = opts || {};
  const scene = o.scene;
  const models = o.models || {};
  const cfg = config.avatars;
  const capacity = Math.max(1, Math.round(cfg.max));

  const style = document.createElement('style');
  style.id = 'avatar-label-style';
  style.textContent = CSS;
  document.head.appendChild(style);

  const labelLayer = document.createElement('div');
  labelLayer.id = 'avatar-labels';
  (o.container || document.body).appendChild(labelLayer);

  const material = propMaterial();

  // The model stands on y = 0 and the pose it is given is the capsule centre,
  // so the mesh is lifted by avatars.yOffset. Baked into the geometry once
  // rather than composed per instance per frame -- and baked BEFORE the split,
  // so the parts and their pivots come out already in the frame the animation
  // works in.
  const source = models.avatar && models.avatar.geometry ? models.avatar.geometry : null;
  let baked = null;
  if (source) {
    baked = source.clone();
    baked.rotateY(cfg.modelYaw);
    baked.scale(cfg.scale, cfg.scale, cfg.scale);
    baked.translate(0, cfg.yOffset, 0);
    baked.computeBoundingBox();
  }

  let rig = baked ? splitRig(baked, cfg) : null;
  const rigged = !!rig;
  if (baked && !rig) {
    console.warn('[avatars] the avatar mesh did not split into a body; '
      + 'drawing it rigid and unanimated');
  }
  if (!rig) {
    // Two different ways to end up here and they want different bodies: a model
    // that loaded but would not split is still the right SHAPE and is drawn
    // whole; no model at all gets the procedural stand-in.
    if (baked) {
      rig = { parts: { torso: baked }, pivots: { torso: new THREE.Vector3() }, hand: {},
        tris: { torso: baked.attributes.position.count / 3 }, height: 1.8, measured: null };
    } else {
      rig = fallbackRig(cfg);
    }
  }
  const partNames = Object.keys(rig.parts);
  const animated = rigged || (!baked && partNames.length === PARTS.length);

  // One InstancedMesh per part. Four players is four instances in each of six
  // meshes -- six draw calls, not twenty-four, and not one per player either.
  const meshes = {};
  partNames.forEach((name) => {
    const m = new THREE.InstancedMesh(rig.parts[name], material, capacity);
    m.name = 'avatars:' + name;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // An InstancedMesh is culled by the SOURCE geometry's bounds, which say
    // nothing about where the instances are. Culling it would blink every player.
    m.frustumCulled = false;
    m.count = 0;
    m.castShadow = !!config.world.shadowsEnabled;
    m.receiveShadow = !!config.world.shadowsEnabled;
    meshes[name] = m;
    if (scene) scene.add(m);
  });

  // Per-instance tint, so four differently coloured players still cost one draw
  // call per part. It multiplies the model's own vertex colours, so the default
  // is white -- an avatar nobody has given a colour looks exactly as it did
  // before this existed, rather than being flattened to a flat blob.
  const WHITE = '#ffffff';
  const _c = new THREE.Color();
  partNames.forEach((name) => {
    const m = meshes[name];
    m.setColorAt(0, _c.set(WHITE));
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < capacity; i++) m.setColorAt(i, _c.set(WHITE));
    m.instanceColor.needsUpdate = true;
  });

  // --- held items --------------------------------------------------------
  //
  // Same machinery src/render/placed.js uses for props: one pool per MODEL, so
  // four players carrying four brooms is one draw call and four players carrying
  // four different tools is four. The pool is built the first time somebody
  // actually picks that thing up, never at boot for all 80 models.
  const heldPools = new Map();   // model name -> { mesh, geo, pivot }
  function heldPool(row) {
    if (!row || !row.model) return null;
    const key = row.model;
    let pool = heldPools.get(key);
    if (pool !== undefined) return pool;
    const m = models[key];
    if (!m || !m.geometry) {
      heldPools.set(key, null);
      return null;
    }
    const geo = m.geometry.clone();
    const b = bboxOf(geo);
    // Where up its own height the hand grips it. A broom is held near the top of
    // the handle; a bucket is held near its middle. One fraction covers both
    // well enough that no row needs a third-person hand block of its own.
    const gy = b.min.y + (b.max.y - b.min.y) * cfg.heldGripFrac;
    geo.translate(-(b.min.x + b.max.x) / 2, -gy, -(b.min.z + b.max.z) / 2);
    const mesh = new THREE.InstancedMesh(geo, material, capacity);
    mesh.name = 'avatars:held:' + key;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.castShadow = !!config.world.shadowsEnabled;
    pool = { mesh, geo, used: 0 };
    heldPools.set(key, pool);
    if (scene) scene.add(mesh);
    return pool;
  }

  const byIdSafe = (id) => {
    if (!id) return null;
    try { return byId(id); } catch (_) { return null; }
  };

  const byIdMap = new Map();    // id -> record
  const order = [];             // slot index -> id, compacted
  let visibleCount = 0;
  let lastRenderTime = 0;
  let animCount = 0;

  function makeLabel(nick) {
    const n = document.createElement('div');
    n.className = 'avatar-label';
    n.textContent = nick;
    labelLayer.appendChild(n);
    return n;
  }

  function add(id, info) {
    if (byIdMap.has(id)) return byIdMap.get(id);
    if (order.length >= capacity) return null;
    const slot = order.length;
    order.push(id);
    const rec = {
      id,
      slot,
      nick: (info && info.nick) || 'player',
      playerSlot: info && typeof info.slot === 'number' ? info.slot : null,
      samples: [],              // { t, x, y, z, yaw, pitch }, oldest first
      label: makeLabel((info && info.nick) || 'player'),
      shown: false,
      pose: null,
      color: (info && info.color) || WHITE,
      // What the roster says is in their hands, and what they picked up. Both
      // arrive through setPlayers; see the note there about absent vs null.
      hand: (info && info.hand) || null,
      hold: (info && info.hold) || null,
      using: (info && info.using) || null,
      gesture: null,
      gesturePhase: 0,
      // Animation state. All of it is derived from the poses this record is
      // given; nothing is fed in from outside.
      lastRt: 0,
      prev: null,
      speed: 0,
      vy: 0,
      phase: 0,
      amp: 0,
      air: 0,
      angles: { legR: 0, legL: 0, armR: 0, armL: 0, bob: 0, lean: 0 },
    };
    byIdMap.set(id, rec);
    partNames.forEach((n) => { meshes[n].count = order.length; });
    writeColor(rec);
    return rec;
  }

  // The tint lives on the RECORD and is written to whatever instance slot that
  // record currently occupies. Compaction moves records between slots, so a
  // colour written once to a slot index would end up on whoever inherits it.
  function writeColor(rec) {
    try { _c.set(rec.color || WHITE); } catch (_) { _c.set(WHITE); }
    partNames.forEach((n) => {
      meshes[n].setColorAt(rec.slot, _c);
      meshes[n].instanceColor.needsUpdate = true;
    });
    return rec.color;
  }

  function hideAll(slot) {
    partNames.forEach((n) => { meshes[n].setMatrixAt(slot, HIDDEN); });
  }

  function remove(id) {
    const rec = byIdMap.get(id);
    if (!rec) return false;
    const last = order.length - 1;
    const slot = rec.slot;
    if (slot !== last) {
      const moved = order[last];
      order[slot] = moved;
      byIdMap.get(moved).slot = slot;
      // The record that just moved into this slot takes its colour with it.
      writeColor(byIdMap.get(moved));
    }
    order.pop();
    hideAll(last);
    partNames.forEach((n) => {
      meshes[n].instanceMatrix.needsUpdate = true;
      meshes[n].count = order.length;
    });
    if (rec.label.parentNode) rec.label.parentNode.removeChild(rec.label);
    byIdMap.delete(id);
    return true;
  }

  // The network layer owns who is in the room; this only mirrors it. Anyone in
  // the list who is not here is added, anyone here who is not in the list goes.
  //
  // `hand`, `hold` and `using` follow one rule: a field the caller did NOT
  // mention is left alone, and only an explicit null clears it. main.js's
  // syncAvatars runs every frame and currently forwards neither, so without that
  // rule a per-frame roster push would wipe anything set through setHand().
  function setPlayers(list) {
    const want = new Map();
    (Array.isArray(list) ? list : []).forEach((p) => {
      if (p && p.id !== undefined && p.id !== null) want.set(String(p.id), p);
    });
    Array.from(byIdMap.keys()).forEach((id) => { if (!want.has(id)) remove(id); });
    want.forEach((p, id) => {
      const rec = byIdMap.get(id) || add(id, p);
      if (!rec) return;
      const nick = p.nick || 'player';
      if (nick !== rec.nick) {
        rec.nick = nick;
        rec.label.textContent = nick;
      }
      if (typeof p.slot === 'number') rec.playerSlot = p.slot;
      if (p.color && p.color !== rec.color) { rec.color = p.color; writeColor(rec); }
      if ('hand' in p) rec.hand = p.hand || null;
      if ('hold' in p) rec.hold = p.hold || null;
      if ('using' in p) rec.using = p.using || null;
    });
    return order.length;
  }

  // A stamped sample. `t` is milliseconds on whatever clock the caller also
  // passes to update(); mixing two clocks here would show up as permanent
  // stutter, so there is deliberately no default of Date.now().
  function pushPose(id, pose, t) {
    if (!pose || typeof t !== 'number') return false;
    const rec = byIdMap.get(String(id)) || add(String(id), { nick: (pose && pose.nick) || undefined });
    if (!rec) return false;
    const s = rec.samples;
    // Out-of-order arrival is normal on an unreliable channel: a sample older
    // than the newest one is dropped rather than inserted, because a buffer
    // that is not monotonic makes the bracket search lie.
    if (s.length && t <= s[s.length - 1].t) return false;
    s.push({
      t,
      x: pose.x, y: pose.y, z: pose.z,
      yaw: typeof pose.yaw === 'number' ? pose.yaw : 0,
      // The wire already carries pitch (src/net/game.js playerPose); the head
      // is the one part that can show it, and a remote player looking down at
      // the ducks they are sweeping is free information.
      pitch: typeof pose.pitch === 'number' ? pose.pitch : 0,
    });
    // A hand that rides on the pose is honoured, so a caller with no roster --
    // the cutscene, a test -- can still put something in an avatar's hands.
    if (pose.hand !== undefined) rec.hand = pose.hand || null;
    const cutoff = t - cfg.bufferMs;
    while (s.length > 2 && s[0].t < cutoff) s.shift();
    return true;
  }

  // Where a player should be drawn at render time `rt`.
  function sampleAt(rec, rt) {
    const s = rec.samples;
    if (!s.length) return null;
    if (s.length === 1 || rt <= s[0].t) {
      const a = s[0];
      return { x: a.x, y: a.y, z: a.z, yaw: a.yaw, pitch: a.pitch, extrapolated: rt > a.t };
    }
    const newest = s[s.length - 1];
    if (rt >= newest.t) {
      // No later sample yet. Hold the last known pose rather than sliding the
      // avatar across the plate on a stale velocity -- a player standing still
      // looks like a player standing still, and a lagged one stops instead of
      // running through a wall.
      return {
        x: newest.x, y: newest.y, z: newest.z, yaw: newest.yaw, pitch: newest.pitch,
        extrapolated: true,
      };
    }
    for (let i = s.length - 2; i >= 0; i--) {
      const a = s[i];
      const b = s[i + 1];
      if (rt < a.t) continue;
      const span = b.t - a.t;
      const k = span > 0 ? (rt - a.t) / span : 0;
      return {
        x: a.x + (b.x - a.x) * k,
        y: a.y + (b.y - a.y) * k,
        z: a.z + (b.z - a.z) * k,
        yaw: lerpAngle(a.yaw, b.yaw, k),
        pitch: a.pitch + (b.pitch - a.pitch) * k,
        extrapolated: false,
      };
    }
    const first = s[0];
    return { x: first.x, y: first.y, z: first.z, yaw: first.yaw, pitch: first.pitch, extrapolated: false };
  }

  function hideLabel(rec) {
    if (!rec.shown) return;
    rec.shown = false;
    rec.label.classList.remove('on');
  }

  // --- the animation -----------------------------------------------------

  // Speed, straight off the drawn pose. THIS is the load-bearing line of the
  // whole round: the phase below is advanced by metres travelled, so an avatar
  // that is not travelling does not stride, and no clock is consulted anywhere.
  function measure(rec, p, rt) {
    const dtMs = rt - rec.lastRt;
    rec.lastRt = rt;
    // A frame that did not advance (two update() calls at one instant, or the
    // very first frame for this record) cannot be differentiated.
    if (!rec.prev || !(dtMs > 1e-3) || dtMs > 500) {
      rec.prev = { x: p.x, y: p.y, z: p.z };
      return;
    }
    const dt = dtMs / 1000;
    const dx = p.x - rec.prev.x;
    const dy = p.y - rec.prev.y;
    const dz = p.z - rec.prev.z;
    rec.prev.x = p.x; rec.prev.y = p.y; rec.prev.z = p.z;

    rec.speed = approach(rec.speed, Math.hypot(dx, dz) / dt, dt, cfg.speedTau);
    rec.vy = approach(rec.vy, dy / dt, dt, cfg.speedTau);

    // Airborne: the roster carries no grounded flag, so it is derived from
    // vertical speed. Held through the apex by airTau, where the sign flips and
    // the speed passes through zero.
    const wantAir = Math.abs(rec.vy) > cfg.airborneSpeed ? 1 : 0;
    rec.air = approach(rec.air, wantAir, dt, cfg.airTau);

    // Amplitude first, then phase, and the phase only advances while there is
    // real ground speed: at a dead stop the phase FREEZES and the amplitude
    // decays, so the limbs come to rest instead of being caught mid-stride.
    rec.amp = approach(rec.amp, Math.min(1, rec.speed / Math.max(0.01, cfg.walkRefSpeed)),
      dt, cfg.ampTau);
    if (rec.speed > cfg.minWalkSpeed) {
      rec.phase += (rec.speed / Math.max(0.05, cfg.strideMetres)) * Math.PI * 2 * dt;
      if (rec.phase > Math.PI * 2) rec.phase -= Math.PI * 2;
    }
  }

  // The arm rotation for whatever this player is doing with it. `s` is +1 for
  // the right arm (which is at +X: the character faces -Z), -1 for the left.
  // Returns pitch (swing, +forward), yaw (across the body) and roll (out to the
  // side) in radians -- see the quaternion note in writeAvatar.
  function armPose(rec, s, walk, now, out) {
    const cfgA = cfg;
    let pitch = walk;
    let yaw = 0;
    let roll = cfgA.armRest * s;

    // Airborne overrides the swing but not the gesture: the arms come up.
    if (rec.air > 0.01) {
      pitch = pitch * (1 - rec.air) + (-cfgA.airArmLift) * rec.air;
      roll += s * 0.35 * rec.air;
    }
    // Carrying a duck off the floor: both arms out in front, cradling it. The
    // duck itself is a world body somebody else already draws.
    if (rec.hold) {
      pitch = cfgA.carryArmPitch;
      roll = s * cfgA.carryArmRoll;
    }
    // Something in the hands. Only the right arm holds it; the left keeps
    // walking, which is what a person carrying a broom one-handed looks like.
    const holdingItem = !!rec.hand && s > 0;
    if (holdingItem) {
      pitch = cfgA.heldArmPitch;
      roll = s * cfgA.heldArmRoll;
      // ...and using it. A sweep is a free-running action for as long as the
      // button is down, so this one IS clocked -- unlike the walk.
      const mode = rec.using;
      if (mode === 'sweep') {
        const k = Math.sin((now / 1000) * Math.PI * 2 / Math.max(0.05, cfgA.sweepSeconds));
        pitch = cfgA.sweepArmPitch;
        yaw = k * cfgA.sweepArmYaw * s;
      } else if (mode === 'beam') {
        pitch = cfgA.beamArmPitch;
      } else if (mode === 'scoop') {
        pitch = cfgA.scoopArmPitch;
      }
    }
    // The wave wins over everything, on the arm that waves. It is the gesture
    // the intro asked for and the phase is supplied by the caller, so the
    // cutscene can put it on the beat.
    if (rec.gesture === 'wave' && s > 0) {
      const ph = rec.gesturePhase * Math.PI * 2;
      pitch = cfgA.waveArmPitch;
      yaw = 0;
      roll = s * (cfgA.waveArmRoll + Math.sin(ph) * cfgA.waveArmSwing);
    }
    out.pitch = pitch;
    out.yaw = yaw;
    out.roll = roll;
    return out;
  }

  // parent * T(pivot) * R(q) * T(-pivot), written into `out`.
  function joint(out, parent, pivot, q) {
    _joint.compose(pivot, q, ONE);
    _back.makeTranslation(-pivot.x, -pivot.y, -pivot.z);
    _joint.multiply(_back);
    out.multiplyMatrices(parent, _joint);
    return out;
  }

  // Composed right-to-left on a vector: swing forward about X first, then across
  // about Y, then out about Z. Doing it the other way round makes a raised arm
  // swing round the body instead of up beside the head.
  function armQuat(q, pitch, yaw, roll) {
    q.setFromAxisAngle(ZA, roll);
    _qa.setFromAxisAngle(YA, yaw);
    q.multiply(_qa);
    _qa.setFromAxisAngle(XA, pitch);
    q.multiply(_qa);
    return q;
  }

  const _arm = { pitch: 0, yaw: 0, roll: 0 };

  function writeAvatar(rec, p, now) {
    const a = rec.angles;
    // A leg swinging forward is a POSITIVE rotation about +X in this frame:
    // (0,-1,0) goes to (0,-cos,-sin), and -Z is forward. Nothing here has to
    // know about modelYaw, because modelYaw was baked before the split.
    const swing = Math.sin(rec.phase) * cfg.legSwing * rec.amp;
    a.legR = swing;
    a.legL = -swing;
    if (rec.air > 0.01) {
      a.legR = a.legR * (1 - rec.air) + cfg.airLegFront * rec.air;
      a.legL = a.legL * (1 - rec.air) + cfg.airLegBack * rec.air;
    }
    // Twice per cycle, because both feet plant.
    a.bob = -Math.abs(Math.cos(rec.phase)) * cfg.bobAmount * rec.amp;
    a.lean = cfg.leanAmount * rec.amp * (1 - rec.air);

    _root.compose(_p.set(p.x, p.y, p.z), _q.setFromAxisAngle(UP, p.yaw), ONE);

    // Torso: bob, then lean at the pelvis. Head and arms hang off it.
    _m2.makeTranslation(0, a.bob, 0);
    _torso.multiplyMatrices(_root, _m2);
    joint(_torso, _torso, rig.pivots.torso, _q.setFromAxisAngle(XA, a.lean));
    meshes.torso.setMatrixAt(rec.slot, _torso);

    // Head: the pitch already on the wire, minus the lean so looking straight
    // ahead stays straight ahead while walking.
    joint(_m, _torso, rig.pivots.head,
      _q.setFromAxisAngle(XA, Math.max(-0.9, Math.min(0.9, (p.pitch || 0) - a.lean))));
    meshes.head.setMatrixAt(rec.slot, _m);

    // Arms counter-swing against the legs.
    const armWalk = -swing * (cfg.armSwing / Math.max(0.01, cfg.legSwing));
    armPose(rec, 1, armWalk, now, _arm);
    a.armR = _arm.pitch;
    a.armRyaw = _arm.yaw;
    a.armRroll = _arm.roll;
    joint(_m, _torso, rig.pivots.armR, armQuat(_q, _arm.pitch, _arm.yaw, _arm.roll));
    meshes.armR.setMatrixAt(rec.slot, _m);
    // Kept: the right arm's world matrix is where a held item hangs.
    const armRWorld = _m2.copy(_m);

    armPose(rec, -1, -armWalk, now, _arm);
    a.armL = _arm.pitch;
    joint(_m, _torso, rig.pivots.armL, armQuat(_q, _arm.pitch, _arm.yaw, _arm.roll));
    meshes.armL.setMatrixAt(rec.slot, _m);

    // Legs hang off the ROOT, not the torso: a leaning body must not take its
    // own feet with it.
    joint(_m, _root, rig.pivots.legR, _q.setFromAxisAngle(XA, a.legR));
    meshes.legR.setMatrixAt(rec.slot, _m);
    joint(_m, _root, rig.pivots.legL, _q.setFromAxisAngle(XA, a.legL));
    meshes.legL.setMatrixAt(rec.slot, _m);

    return armRWorld;
  }

  // The item in their hand, drawn at the measured hand point of the animated
  // right arm -- so it sweeps when the arm sweeps, for free.
  function writeHeld(rec, armWorld, pools) {
    if (!rec.hand || !rig.hand.armR) return null;
    const row = byIdSafe(rec.hand);
    if (!row) return null;
    const pool = heldPool(row);
    if (!pool) return null;
    const slot = pool.used;
    if (slot >= capacity) return null;
    pool.used += 1;
    pools.add(pool);
    _m.copy(armWorld);
    _m2.makeTranslation(
      rig.hand.armR.x + cfg.heldOffsetX,
      rig.hand.armR.y + cfg.heldOffsetY,
      rig.hand.armR.z + cfg.heldOffsetZ
    );
    _m.multiply(_m2);
    _euler.set(cfg.heldPitchDeg * DEG, cfg.heldYawDeg * DEG, cfg.heldRollDeg * DEG, 'YXZ');
    _q.setFromEuler(_euler);
    const sc = cfg.heldScale * cfg.scale;
    _m2.compose(_p.set(0, 0, 0), _q, _s.set(sc, sc, sc));
    _m.multiply(_m2);
    pool.mesh.setMatrixAt(slot, _m);
    return row.model;
  }

  // Called once per rendered frame, including inside debugStep. `now` is the
  // same clock pushPose was stamped with.
  function update(now, camera) {
    const rt = now - config.net.interpDelayMs;
    lastRenderTime = rt;
    let drawn = 0;
    let matrixDirty = false;
    let moving = 0;
    heldPools.forEach((pool) => { if (pool) pool.used = 0; });
    const touched = _touched;
    touched.clear();

    for (let i = 0; i < order.length; i++) {
      const rec = byIdMap.get(order[i]);
      if (!rec) continue;
      const p = sampleAt(rec, rt);
      const newest = rec.samples.length ? rec.samples[rec.samples.length - 1] : null;
      const stale = !newest || (now - newest.t) > config.net.interpHoldMs + config.net.interpDelayMs;
      if (!p || stale) {
        hideAll(rec.slot);
        matrixDirty = true;
        rec.pose = null;
        rec.prev = null;
        rec.speed = 0;
        rec.amp = 0;
        rec.air = 0;
        hideLabel(rec);
        continue;
      }
      rec.pose = p;
      // The measurement runs whether or not the body is drawn this frame: an
      // avatar that walks behind the camera and comes back must not restart its
      // gait from a standstill.
      measure(rec, p, rt);
      if (rec.amp > 0.02) moving++;

      const near = camera
        ? Math.hypot(p.x - camera.position.x, p.y - camera.position.y, p.z - camera.position.z)
        : Infinity;
      // Inside hideRadius the avatar is a wall of polygons over the whole
      // screen and tells the player nothing, so it is not drawn -- but the
      // label still is, because "someone is right on top of me" is exactly when
      // knowing who matters most.
      if (near < cfg.hideRadius) {
        hideAll(rec.slot);
      } else if (animated) {
        const armWorld = writeAvatar(rec, p, now);
        writeHeld(rec, armWorld, touched);
        drawn++;
      } else {
        // The unsplittable-model path: exactly what this file drew before.
        _m.compose(_p.set(p.x, p.y, p.z), _q.setFromAxisAngle(UP, p.yaw), ONE);
        meshes.torso.setMatrixAt(rec.slot, _m);
        drawn++;
      }
      matrixDirty = true;

      if (!camera) { hideLabel(rec); continue; }
      // The label is a DOM element placed by projecting the head point. Nothing
      // about it lives in the 480 px backbuffer.
      _v.set(p.x, p.y + cfg.labelHeight, p.z);
      _v.project(camera);
      const behind = _v.z > 1 || _v.z < -1;
      if (behind || near > cfg.labelMaxDistance
        || _v.x < -1.4 || _v.x > 1.4 || _v.y < -1.4 || _v.y > 1.4) {
        hideLabel(rec);
        continue;
      }
      rec.label.style.left = ((_v.x * 0.5 + 0.5) * 100).toFixed(3) + '%';
      rec.label.style.top = ((-_v.y * 0.5 + 0.5) * 100).toFixed(3) + '%';
      const fade = 1 - Math.min(1, near / cfg.labelMaxDistance);
      rec.label.style.opacity = (cfg.labelMinOpacity + (1 - cfg.labelMinOpacity) * fade).toFixed(3);
      if (!rec.shown) {
        rec.shown = true;
        rec.label.classList.add('on');
      }
    }

    if (matrixDirty) partNames.forEach((n) => { meshes[n].instanceMatrix.needsUpdate = true; });
    // A pool nobody used this frame draws nothing: count 0 costs no draw call,
    // which is why a dropped broom does not leave one hanging in the air.
    heldPools.forEach((pool) => {
      if (!pool) return;
      if (pool.mesh.count !== pool.used) pool.mesh.count = pool.used;
      if (touched.has(pool)) pool.mesh.instanceMatrix.needsUpdate = true;
    });
    visibleCount = drawn;
    animCount = moving;
    return drawn;
  }

  function clear() {
    Array.from(byIdMap.keys()).forEach((id) => remove(id));
  }

  // The world direction of a limb, read back OUT of the instance buffer rather
  // than off the record: the record is what was asked for, this is what the GPU
  // will draw. Returns the signed swing angle in radians about the body's own
  // right axis, which is directly comparable to the angle that was written.
  function limbSwing(name, rec) {
    const mesh = meshes[name];
    if (!mesh || !rig.pivots[name] || !rec.pose) return null;
    mesh.getMatrixAt(rec.slot, _m);
    _v.copy(rig.pivots[name]).applyMatrix4(_m);
    _v2.copy(rig.pivots[name]).add(_p.set(0, -0.5, 0)).applyMatrix4(_m);
    _v2.sub(_v);                                  // world direction of the limb
    // Into the body's own frame: undo the yaw the root applied.
    const c = Math.cos(-rec.pose.yaw);
    const s = Math.sin(-rec.pose.yaw);
    const lx = _v2.x * c + _v2.z * s;
    const lz = -_v2.x * s + _v2.z * c;
    return { angle: Math.atan2(-lz, -_v2.y), lateral: Math.atan2(lx, -_v2.y) };
  }

  return {
    // The torso mesh keeps the old single-mesh name, so anything that reached
    // for `.mesh` still gets a real InstancedMesh.
    mesh: meshes.torso,
    meshes,
    labelLayer,
    setPlayers,
    add: (id, info) => add(String(id), info),
    remove: (id) => remove(String(id)),
    pushPose,
    update,
    clear,
    setColor(id, color) {
      const rec = byIdMap.get(String(id));
      if (!rec) return null;
      rec.color = color || WHITE;
      return writeColor(rec);
    },
    colorOf(id) {
      const rec = byIdMap.get(String(id));
      return rec ? rec.color : null;
    },
    // What is in this player's hands, and what they picked up off the floor.
    // Both are roster facts (src/net/game.js: `hand`, `hold`); this is the
    // setter for a caller that has them and is not going through setPlayers.
    setHand(id, itemId) {
      const rec = byIdMap.get(String(id));
      if (!rec) return null;
      rec.hand = itemId || null;
      return rec.hand;
    },
    setHold(id, hold) {
      const rec = byIdMap.get(String(id));
      if (!rec) return null;
      rec.hold = hold || null;
      return rec.hold;
    },
    // 'sweep' | 'beam' | 'scoop' | null -- the mode of the tool this player is
    // USING right now, which is the one fact the roster does not yet carry. See
    // the note at the top of the return block in src/net/game.js buildRoster.
    setUsing(id, mode) {
      const rec = byIdMap.get(String(id));
      if (!rec) return null;
      rec.using = mode || null;
      return rec.using;
    },
    // The hook the intro cutscene asked for. `phase01` is 0..1 through one
    // wave; the caller owns the clock, so the wave can be put on the beat.
    setGesture(id, gesture, phase01) {
      const rec = byIdMap.get(String(id));
      if (!rec) return null;
      rec.gesture = gesture || null;
      rec.gesturePhase = typeof phase01 === 'number' ? phase01 : 0;
      return rec.gesture;
    },
    count: () => order.length,
    drawn: () => visibleCount,
    moving: () => animCount,
    usedFallbackModel: !source,
    // Whether the mesh actually split into a body. False means every avatar is
    // the old rigid capsule and nothing below animates -- worth knowing before
    // reading a limb angle of zero as "standing still".
    rigged: animated,
    rig: () => ({
      rigged: animated,
      parts: partNames.slice(),
      tris: { ...rig.tris },
      pivots: partNames.reduce((o2, n) => {
        o2[n] = rig.pivots[n] ? rig.pivots[n].toArray() : null; return o2;
      }, {}),
      hand: rig.hand.armR ? rig.hand.armR.toArray() : null,
      measured: rig.measured,
    }),
    heldModels: () => Array.from(heldPools.entries())
      .filter(([, pool]) => pool)
      .map(([name, pool]) => ({ model: name, drawn: pool.mesh.count })),
    renderTime: () => lastRenderTime,
    poseOf(id) {
      const rec = byIdMap.get(String(id));
      return rec && rec.pose ? { ...rec.pose } : null;
    },
    // The animation state of one player: what was measured, and what was
    // written. `legRDrawn` is read back out of the instance buffer.
    animOf(id) {
      const rec = byIdMap.get(String(id));
      if (!rec) return null;
      const rd = limbSwing('legR', rec);
      const ld = limbSwing('legL', rec);
      const ar = limbSwing('armR', rec);
      return {
        id: rec.id,
        speed: rec.speed,
        vy: rec.vy,
        phase: rec.phase,
        amp: rec.amp,
        air: rec.air,
        hand: rec.hand,
        hold: rec.hold,
        using: rec.using,
        gesture: rec.gesture,
        written: { ...rec.angles },
        drawn: {
          legR: rd ? rd.angle : null,
          legL: ld ? ld.angle : null,
          armR: ar ? ar.angle : null,
          armRlateral: ar ? ar.lateral : null,
        },
      };
    },
    // What is actually on screen, read back out of the DOM and the instance
    // buffer rather than from a flag that claims it.
    state: () => order.map((id) => {
      const rec = byIdMap.get(id);
      meshes.torso.getMatrixAt(rec.slot, _m);
      _m.decompose(_p, _q, _s);
      return {
        id,
        nick: rec.nick,
        slot: rec.playerSlot,
        instance: rec.slot,
        color: rec.color,
        // Read back out of the instance buffer, not off the record: the record
        // is what was asked for and this is what the GPU will draw.
        instanceColor: [
          meshes.torso.instanceColor.array[rec.slot * 3],
          meshes.torso.instanceColor.array[rec.slot * 3 + 1],
          meshes.torso.instanceColor.array[rec.slot * 3 + 2],
        ],
        samples: rec.samples.length,
        drawn: _s.x > 0,
        world: { x: _p.x, y: _p.y, z: _p.z },
        hand: rec.hand,
        hold: rec.hold,
        using: rec.using,
        gesture: rec.gesture,
        speed: rec.speed,
        amp: rec.amp,
        air: rec.air,
        legR: rec.angles.legR,
        legL: rec.angles.legL,
        armR: rec.angles.armR,
        label: {
          visible: rec.shown,
          text: rec.label.textContent,
          left: rec.label.style.left,
          top: rec.label.style.top,
        },
      };
    }),
    dispose() {
      clear();
      partNames.forEach((n) => {
        if (scene) scene.remove(meshes[n]);
        meshes[n].geometry.dispose();
        meshes[n].dispose();
      });
      heldPools.forEach((pool) => {
        if (!pool) return;
        if (scene) scene.remove(pool.mesh);
        pool.geo.dispose();
        pool.mesh.dispose();
      });
      heldPools.clear();
      material.dispose();
      if (labelLayer.parentNode) labelLayer.parentNode.removeChild(labelLayer);
      if (style.parentNode) style.parentNode.removeChild(style);
    },
  };
}

export default createAvatarsView;
