// The wind you can see.
//
// A fan's blast was invisible: a duck slid across the floor and nothing on
// screen said why, or where the next one would go. This file draws it -- and
// the ONE rule it is built on is that every number it draws with is read from
// the same place src/sim/blowers.js reads it. The cone's half-angle, its
// aperture, its length and the brightness curve down its axis are the row's
// `blow.cone`, the object's own half-extents, `blow.range` and
// `automation.fan.falloffExponent`. Nothing here is a shape that was tuned to
// look right; a decorative puff pointing somewhere the wind is not would be
// worse than drawing nothing.
//
// blowers.js, fieldAt():
//     rmax(d) = aperture + d * tan(cone)          <- the surface drawn here
//     axial   = (1 - max(d, minDistance)/range)^falloffExponent
//     edge    = min(1, (1 - perp/rmax) / edgeSoftness)
//
// so a shell drawn at perp = s * rmax is drawn at brightness edge(s) * axial(d).
// The faint outer skin IS the part of the jet that barely pushes, and the bright
// core IS the part that pushes hardest. The picture is the field.

import * as THREE from 'three';
import config from '../config.js';

const DEG = Math.PI / 180;

// --- the cone, from the row and the placed box -------------------------------
//
// `aperture` is min(hx, hy) of the placement box and `pitch` comes off the row,
// exactly as blowers.describe() computes them. Passing the item row and the
// half-extents rather than a placed record means the hologram can ask for the
// same shape before the object exists.
export function blowShape(row, halfX, halfY) {
  if (!row || !row.blow) return null;
  const pitch = (typeof row.blow.pitchDegrees === 'number' ? row.blow.pitchDegrees : 0) * DEG;
  const cone = row.blow.cone * DEG;
  return {
    id: row.id,
    range: row.blow.range,
    cone,
    spread: Math.tan(cone),
    aperture: Math.min(halfX, halfY),
    pitch,
    force: row.blow.force,
  };
}

export function shapeOf(item) {
  if (!item || !item.collider || !item.collider.half) return null;
  return blowShape(item, item.collider.half[0], item.collider.half[1]);
}

// The blow direction in world space. Character for character the expression in
// blowers.describe(), so the drawing and the pushing cannot drift apart.
export function blowDirection(yaw, pitch, out) {
  const cp = Math.cos(pitch);
  const o = out || { x: 0, y: 0, z: 0 };
  o.x = -Math.sin(yaw) * cp;
  o.y = Math.sin(pitch);
  o.z = Math.cos(yaw) * cp;
  return o;
}

// A quaternion whose local +Z is that direction: Ry(-yaw) * Rx(-pitch). The
// sign is not a convention chosen here -- it is whatever makes the drawn axis
// equal blowDirection(), which is verified at call time by debugAirflowCheck().
export function setBlowQuaternion(q, yaw, pitch) {
  _qy.setFromAxisAngle(_axisY, -yaw);
  _qx.setFromAxisAngle(_axisX, -pitch);
  return q.copy(_qy).multiply(_qx);
}

const _axisY = new THREE.Vector3(0, 1, 0);
const _axisX = new THREE.Vector3(1, 0, 0);
const _qy = new THREE.Quaternion();
const _qx = new THREE.Quaternion();

// --- the field, straight out of the physics ----------------------------------

function fanConfig() {
  const a = config.automation.fan;
  return {
    falloffExponent: a.falloffExponent,
    minDistance: a.minDistance,
    edgeSoftness: a.edgeSoftness,
  };
}

// blowers.fieldAt() on the jet's axis at distance d.
export function axialField(shape, d) {
  const F = fanConfig();
  const eff = d < F.minDistance ? F.minDistance : d;
  return Math.pow(Math.max(0, 1 - eff / shape.range), F.falloffExponent);
}

// blowers.fieldAt()'s edge term for a shell at perp = s * rmax.
export function edgeField(s) {
  const F = fanConfig();
  if (!(F.edgeSoftness > 1e-9)) return 1;
  return Math.min(1, (1 - s) / F.edgeSoftness);
}

// --- geometry ----------------------------------------------------------------
//
// Two lateral shells, no caps, merged into one buffer so a fan's airstream is
// ONE instanced draw call however many fans are standing. Built along local +Z
// with the aperture at z = 0, which is where the instance matrix puts the fan's
// own hub.

function pushShell(pos, col, uv, shape, s, segs, stations, brightness) {
  const bright = brightness * edgeField(s);
  const r = (d) => (shape.aperture + d * shape.spread) * s;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0);
    const c1 = Math.cos(a1), s1 = Math.sin(a1);
    for (let k = 0; k < stations; k++) {
      const d0 = (k / stations) * shape.range;
      const d1 = ((k + 1) / stations) * shape.range;
      const r0 = r(d0), r1 = r(d1);
      const b0 = bright * axialField(shape, d0);
      const b1 = bright * axialField(shape, d1);
      const v0 = d0 / shape.range;
      const v1 = d1 / shape.range;
      const A = [c0 * r0, s0 * r0, d0], B = [c1 * r0, s1 * r0, d0];
      const C = [c1 * r1, s1 * r1, d1], D = [c0 * r1, s0 * r1, d1];
      pos.push(...A, ...B, ...C, ...A, ...C, ...D);
      col.push(b0, b0, b0, b0, b0, b0, b1, b1, b1, b0, b0, b0, b1, b1, b1, b1, b1, b1);
      uv.push(i / segs, v0, (i + 1) / segs, v0, (i + 1) / segs, v1,
        i / segs, v0, (i + 1) / segs, v1, i / segs, v1);
    }
  }
}

export function streamGeometry(shape) {
  const A = config.render.airflow;
  const segs = Math.max(6, Math.round(A.segments));
  const stations = Math.max(2, Math.round(A.stations));
  const pos = [];
  const col = [];
  const uv = [];
  // The skin of the jet -- what the player has to be able to aim -- and its
  // core. Both are shells the field itself puts a brightness on.
  pushShell(pos, col, uv, shape, A.skinShell, segs, stations, A.brightness);
  pushShell(pos, col, uv, shape, A.coreShell, segs, stations, A.brightness);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  g.computeBoundingSphere();
  return g;
}

// The same cone as a wire outline: rings across it and lines down it. This is
// what the build hologram uses, where a translucent volume over the ground you
// are trying to read would hide the very thing you are aiming at.
export function outlineGeometry(shape) {
  const H = config.render.hint;
  const segs = Math.max(6, Math.round(H.coneSegments));
  const rings = Math.max(1, Math.round(H.coneRings));
  const spokes = Math.max(2, Math.round(H.coneSpokes));
  const pos = [];
  const r = (d) => shape.aperture + d * shape.spread;
  for (let k = 1; k <= rings; k++) {
    const d = (k / rings) * shape.range;
    const rr = r(d);
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      pos.push(Math.cos(a0) * rr, Math.sin(a0) * rr, d, Math.cos(a1) * rr, Math.sin(a1) * rr, d);
    }
  }
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    pos.push(c * r(0), s * r(0), 0, c * r(shape.range), s * r(shape.range), shape.range);
  }
  // The axis, with a barb at the end: which way, not just how far.
  pos.push(0, 0, 0, 0, 0, shape.range);
  const barb = Math.min(0.5, shape.range * 0.12);
  const tipR = r(shape.range) * 0.35;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    pos.push(0, 0, shape.range, Math.cos(a) * tipR, Math.sin(a) * tipR, shape.range - barb);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  return g;
}

// --- the material ------------------------------------------------------------
//
// One material for every fan on the plate, so the scroll is one number written
// once a frame and the airstreams cost nothing per object. Additive, unlit and
// depth-write off: a duck inside the jet stays visible, which is the point.

let sharedTexture = null;
function bandTexture() {
  if (sharedTexture) return sharedTexture;
  const A = config.render.airflow;
  const n = 64;
  const data = new Uint8Array(n * 4);
  const duty = Math.min(0.95, Math.max(0.05, A.bandDuty));
  for (let i = 0; i < n; i++) {
    const t = i / n;
    // One soft band per repeat: a hard edge would strobe at 480 px wide.
    const x = t / duty;
    const v = x > 1 ? 0 : Math.sin(Math.PI * x);
    const k = Math.round(255 * Math.pow(v, A.bandSharpness));
    data[i * 4] = k; data[i * 4 + 1] = k; data[i * 4 + 2] = k; data[i * 4 + 3] = k;
  }
  const tex = new THREE.DataTexture(data, 1, n, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  sharedTexture = tex;
  return tex;
}

export function createAirMaterial() {
  const A = config.render.airflow;
  const map = bandTexture();
  const mat = new THREE.MeshBasicMaterial({
    color: A.color,
    map,
    vertexColors: true,
    transparent: true,
    opacity: A.opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  // Every stream shares this material, so the bands are one texture offset for
  // the whole plate: no per-object work, no allocation, one number a frame.
  let scroll = 0;
  return {
    material: mat,
    advance(dt) {
      const bands = config.render.airflow.bands;
      mat.map.repeat.set(1, bands);
      // Bands travel AWAY from the fan (+v), which means the offset goes down.
      scroll = (scroll - dt * config.render.airflow.scrollPerSecond) % 1;
      mat.map.offset.y = scroll;
      return scroll;
    },
    scroll: () => scroll,
    dispose() { mat.dispose(); },
  };
}

export default streamGeometry;
