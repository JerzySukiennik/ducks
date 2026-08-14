// Other players in the world.
//
// Two decisions here are not negotiable and both were settled earlier in this
// project:
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
//
// All avatars share one InstancedMesh, so four players cost one draw call.

import * as THREE from 'three';
import config from '../config.js';
import { propMaterial } from './props.js';

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

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
  // rather than composed per instance per frame.
  const source = models.avatar && models.avatar.geometry ? models.avatar.geometry : null;
  const geo = source
    ? source.clone()
    : new THREE.BoxGeometry(0.5, 1.8, 0.35);
  if (!source) {
    // A missing avatar.glb must read as "a player is standing there", never as
    // an invisible one. Same rule the model loader follows everywhere else.
    const n = geo.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = 0.55; col[i * 3 + 1] = 0.62; col[i * 3 + 2] = 0.78; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.translate(0, 0.9, 0);
  }
  geo.rotateY(cfg.modelYaw);
  geo.scale(cfg.scale, cfg.scale, cfg.scale);
  geo.translate(0, cfg.yOffset, 0);
  geo.computeBoundingBox();

  const mesh = new THREE.InstancedMesh(geo, material, capacity);
  mesh.name = 'avatars';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // An InstancedMesh is culled by the SOURCE geometry's bounds, which say
  // nothing about where the instances are. Culling it would blink every player.
  mesh.frustumCulled = false;
  mesh.count = 0;
  if (scene) scene.add(mesh);

  // Per-instance tint, so four differently coloured players still cost ONE draw
  // call. It multiplies the model's own vertex colours, so the default is white
  // -- an avatar nobody has given a colour looks exactly as it did before this
  // existed, rather than being flattened to a flat blob.
  const WHITE = '#ffffff';
  const _c = new THREE.Color();
  mesh.setColorAt(0, _c.set(WHITE));
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < capacity; i++) mesh.setColorAt(i, _c.set(WHITE));
  mesh.instanceColor.needsUpdate = true;

  const byId = new Map();       // id -> record
  const order = [];             // slot index -> id, compacted
  let visibleCount = 0;
  let lastRenderTime = 0;

  function makeLabel(nick) {
    const n = document.createElement('div');
    n.className = 'avatar-label';
    n.textContent = nick;
    labelLayer.appendChild(n);
    return n;
  }

  function slotFor(id) {
    const rec = byId.get(id);
    return rec ? rec.slot : -1;
  }

  function add(id, info) {
    if (byId.has(id)) return byId.get(id);
    if (order.length >= capacity) return null;
    const slot = order.length;
    order.push(id);
    const rec = {
      id,
      slot,
      nick: (info && info.nick) || 'player',
      playerSlot: info && typeof info.slot === 'number' ? info.slot : null,
      samples: [],              // { t, x, y, z, yaw }, oldest first
      label: makeLabel((info && info.nick) || 'player'),
      shown: false,
      pose: null,
      color: (info && info.color) || WHITE,
    };
    byId.set(id, rec);
    mesh.count = order.length;
    writeColor(rec);
    return rec;
  }

  // The tint lives on the RECORD and is written to whatever instance slot that
  // record currently occupies. Compaction moves records between slots, so a
  // colour written once to a slot index would end up on whoever inherits it.
  function writeColor(rec) {
    try { _c.set(rec.color || WHITE); } catch (_) { _c.set(WHITE); }
    mesh.setColorAt(rec.slot, _c);
    mesh.instanceColor.needsUpdate = true;
    return rec.color;
  }

  function remove(id) {
    const rec = byId.get(id);
    if (!rec) return false;
    const last = order.length - 1;
    const slot = rec.slot;
    if (slot !== last) {
      const moved = order[last];
      order[slot] = moved;
      byId.get(moved).slot = slot;
      // The record that just moved into this slot takes its colour with it.
      writeColor(byId.get(moved));
    }
    order.pop();
    mesh.setMatrixAt(last, HIDDEN);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = order.length;
    if (rec.label.parentNode) rec.label.parentNode.removeChild(rec.label);
    byId.delete(id);
    return true;
  }

  // The network layer owns who is in the room; this only mirrors it. Anyone in
  // the list who is not here is added, anyone here who is not in the list goes.
  function setPlayers(list) {
    const want = new Map();
    (Array.isArray(list) ? list : []).forEach((p) => {
      if (p && p.id !== undefined && p.id !== null) want.set(String(p.id), p);
    });
    Array.from(byId.keys()).forEach((id) => { if (!want.has(id)) remove(id); });
    want.forEach((p, id) => {
      const rec = byId.get(id) || add(id, p);
      if (!rec) return;
      const nick = p.nick || 'player';
      if (nick !== rec.nick) {
        rec.nick = nick;
        rec.label.textContent = nick;
      }
      if (typeof p.slot === 'number') rec.playerSlot = p.slot;
      if (p.color && p.color !== rec.color) { rec.color = p.color; writeColor(rec); }
    });
    return order.length;
  }

  // A stamped sample. `t` is milliseconds on whatever clock the caller also
  // passes to update(); mixing two clocks here would show up as permanent
  // stutter, so there is deliberately no default of Date.now().
  function pushPose(id, pose, t) {
    if (!pose || typeof t !== 'number') return false;
    const rec = byId.get(String(id)) || add(String(id), { nick: (pose && pose.nick) || undefined });
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
    });
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
      return { x: a.x, y: a.y, z: a.z, yaw: a.yaw, extrapolated: rt > a.t };
    }
    const newest = s[s.length - 1];
    if (rt >= newest.t) {
      // No later sample yet. Hold the last known pose rather than sliding the
      // avatar across the plate on a stale velocity -- a player standing still
      // looks like a player standing still, and a lagged one stops instead of
      // running through a wall.
      return { x: newest.x, y: newest.y, z: newest.z, yaw: newest.yaw, extrapolated: true };
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
        extrapolated: false,
      };
    }
    const first = s[0];
    return { x: first.x, y: first.y, z: first.z, yaw: first.yaw, extrapolated: false };
  }

  function hideLabel(rec) {
    if (!rec.shown) return;
    rec.shown = false;
    rec.label.classList.remove('on');
  }

  // Called once per rendered frame, including inside debugStep. `now` is the
  // same clock pushPose was stamped with.
  function update(now, camera) {
    const rt = now - config.net.interpDelayMs;
    lastRenderTime = rt;
    let drawn = 0;
    let matrixDirty = false;

    for (let i = 0; i < order.length; i++) {
      const rec = byId.get(order[i]);
      if (!rec) continue;
      const p = sampleAt(rec, rt);
      const newest = rec.samples.length ? rec.samples[rec.samples.length - 1] : null;
      const stale = !newest || (now - newest.t) > config.net.interpHoldMs + config.net.interpDelayMs;
      if (!p || stale) {
        mesh.setMatrixAt(rec.slot, HIDDEN);
        matrixDirty = true;
        rec.pose = null;
        hideLabel(rec);
        continue;
      }
      rec.pose = p;

      const near = camera
        ? Math.hypot(p.x - camera.position.x, p.y - camera.position.y, p.z - camera.position.z)
        : Infinity;
      // Inside hideRadius the avatar is a wall of polygons over the whole
      // screen and tells the player nothing, so it is not drawn -- but the
      // label still is, because "someone is right on top of me" is exactly when
      // knowing who matters most.
      if (near < cfg.hideRadius) {
        mesh.setMatrixAt(rec.slot, HIDDEN);
      } else {
        _p.set(p.x, p.y, p.z);
        _q.setFromAxisAngle(UP, p.yaw);
        _s.set(1, 1, 1);
        _m.compose(_p, _q, _s);
        mesh.setMatrixAt(rec.slot, _m);
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

    if (matrixDirty) mesh.instanceMatrix.needsUpdate = true;
    visibleCount = drawn;
    return drawn;
  }

  function clear() {
    Array.from(byId.keys()).forEach((id) => remove(id));
  }

  return {
    mesh,
    labelLayer,
    setPlayers,
    add: (id, info) => add(String(id), info),
    remove: (id) => remove(String(id)),
    pushPose,
    update,
    clear,
    setColor(id, color) {
      const rec = byId.get(String(id));
      if (!rec) return null;
      rec.color = color || WHITE;
      return writeColor(rec);
    },
    colorOf(id) {
      const rec = byId.get(String(id));
      return rec ? rec.color : null;
    },
    count: () => order.length,
    drawn: () => visibleCount,
    usedFallbackModel: !source,
    renderTime: () => lastRenderTime,
    poseOf(id) {
      const rec = byId.get(String(id));
      return rec && rec.pose ? { ...rec.pose } : null;
    },
    // What is actually on screen, read back out of the DOM and the instance
    // buffer rather than from a flag that claims it.
    state: () => order.map((id) => {
      const rec = byId.get(id);
      mesh.getMatrixAt(rec.slot, _m);
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
          mesh.instanceColor.array[rec.slot * 3],
          mesh.instanceColor.array[rec.slot * 3 + 1],
          mesh.instanceColor.array[rec.slot * 3 + 2],
        ],
        samples: rec.samples.length,
        drawn: _s.x > 0,
        world: { x: _p.x, y: _p.y, z: _p.z },
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
      if (scene) scene.remove(mesh);
      geo.dispose();
      material.dispose();
      mesh.dispose();
      if (labelLayer.parentNode) labelLayer.parentNode.removeChild(labelLayer);
      if (style.parentNode) style.parentNode.removeChild(style);
    },
  };
}

export default createAvatarsView;
