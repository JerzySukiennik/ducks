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
    // How far the hub stands above the ground the fan is standing on. For a
    // floor-anchored row the placement Y is the box centre, so this is exactly
    // the box's own half-height -- the same number blowers.describe() puts in
    // f.y. It is what lets the hint draw the wind's FOOTPRINT rather than a
    // cone half-buried in the concrete.
    hubHeight: halfY,
    floorAnchored: row.anchor === 'floor',
  };
}

export function shapeOf(item) {
  if (!item || !item.collider || !item.collider.half) return null;
  return blowShape(item, item.collider.half[0], item.collider.half[1]);
}

// The blow direction in world space. Character for character the expression in
// blowers.describe(), so the drawing and the pushing cannot drift apart.
//
// +sin, and that sign is NOT free. When this file was written the physics used
// (-sin yaw, cos yaw) and this matched it. The sim has since been corrected to
// three's own Y-rotation, (sin yaw, cos yaw) -- the frame the MESH is already
// in -- and until this line moved with it every hint and every placed airstream
// was MIRRORED IN X at every yaw except 0 and 180. Measured before the fix, on
// a fan at yaw 90: physics forward (+1, 0, 0), hint drawn (-1, 0, 0). Yaw 0 is
// exactly the one angle at which the bug is invisible, which is why it survived.
export function blowDirection(yaw, pitch, out) {
  const cp = Math.cos(pitch);
  const o = out || { x: 0, y: 0, z: 0 };
  o.x = Math.sin(yaw) * cp;
  o.y = Math.sin(pitch);
  o.z = Math.cos(yaw) * cp;
  return o;
}

// A quaternion whose local +Z is that direction: Ry(+yaw) * Rx(-pitch). The
// sign is not a convention chosen here -- it is whatever makes the drawn axis
// equal blowDirection(), which is verified at call time by debugAirflowCheck().
// At pitch 0 this is build.yawQuaternion(yaw) exactly, i.e. the hint now stands
// in the same frame as the model it is drawn around.
export function setBlowQuaternion(q, yaw, pitch) {
  _qy.setFromAxisAngle(_axisY, yaw);
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

// --- the outline: the wind where the ducks actually are ----------------------
//
// The first version of this drew the cone itself -- four full rings and eight
// full spokes, with depthTest off so all of it showed. That is honest about the
// FIELD and dishonest about the PICTURE, for a reason that only shows up in a
// frame: a fan's hub stands 0.815 m up and its cone opens to a 4.83 m radius by
// the far end, so from d = 0.17 m onwards the entire lower half of the drawn
// cone is inside the concrete, and the upper half is over the player's head.
// Screen-filling, no visible terminus, and almost none of it is a place a duck
// can be. "The length shown is wrong" is what that looks like from the inside.
//
// So the outline is now drawn in the plane the test actually happens in: the
// duck's own centre height. The contour there is exactly {fieldAt() > 0} sliced
// by that plane, plus the axis with its barb, plus two vertical arcs (the mouth
// and the far end) clipped at the ground so the jet still reads as a volume in
// the air rather than a decal.
//
// WHAT WAS NOT CHANGED, and why. The reported complaint was that the six metres
// promised by the cone are not six metres of effect, and that is measurably not
// true. A duck settled asleep on the concrete on the axis, one second of wind:
//   5.4 m -> 1.835    5.7 m -> 0.855    5.90 m -> 0.201
//   5.5 m -> 1.528    5.8 m -> 0.512    5.95 m -> 0.074    6.00 m -> 0.000
// and laterally at 5 m downstream the duck stops responding at 3.97 m off axis
// against a drawn 4.07 m. Stiction explains it exactly: the wind lifts as well
// as pushes, so a duck breaks free when force*f > mu*(m*g - lift*f), i.e. at
// f > 0.030 for the stock fan -- and axialField hits 0.030 at 5.99 m of 6.00.
// The cone's LENGTH was already honest to a centimetre. What was not honest was
// the picture: mirrored in X at every yaw but 0 and 180 (see blowDirection),
// half of it buried in the plate, and no terminus anywhere. Shortening the drawn
// cone would have been a second lie on top of a fixed one. If the fan should
// reach less far, that is `blow.range` on the row, not a number in here.

// The vertical drop from the hub to the plane a duck's centre sits in. Only
// meaningful for a floor-standing fan; anything else gets the fallback cone.
function duckPlaneDrop(shape) {
  return Math.max(0, shape.hubHeight - config.ducks.halfExtentY);
}

// Half-width of the jet ON THE DUCK PLANE at distance d. Sliced out of
// fieldAt() rather than approximated: the field's support is perp < rmax(d),
// and the half-width across the ground is the leg of the right triangle whose
// hypotenuse is that perp and whose other leg is the fan's own height. This is
// why a floor-standing fan has a small dead patch right at its feet -- at
// d < (drop - aperture)/spread the floor is below the cone entirely.
function halfWidthAt(shape, d, drop) {
  const rmax = shape.aperture + d * shape.spread;
  const q = rmax * rmax - drop * drop;
  return q > 0 ? Math.sqrt(q) : 0;
}

// One contour: the two rails, ribs across it, and a bar closing the far end.
// The bar is the point of the whole exercise -- a cone with no end cap is a
// tunnel, and a tunnel has no length.
function pushContour(pos, shape, drop, endD, y) {
  const H = config.render.hint;
  const n = Math.max(4, Math.round(H.footprintSamples));
  const ribs = Math.max(0, Math.round(H.footprintRibs));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const d = (i / n) * endD;
    pts.push([d, halfWidthAt(shape, d, drop)]);
  }
  let lastW = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [d0, w0] = pts[i];
    const [d1, w1] = pts[i + 1];
    if (w0 <= 0 && w1 <= 0) continue;
    pos.push(w0, y, d0, w1, y, d1);
    pos.push(-w0, y, d0, -w1, y, d1);
    lastW = w1;
  }
  // The terminus, and two ticks turned back down the jet so it reads as a wall
  // rather than a stray line.
  if (lastW > 0) {
    pos.push(-lastW, y, endD, lastW, y, endD);
    const tick = Math.min(H.footprintTick, endD);
    pos.push(lastW, y, endD, lastW, y, endD - tick);
    pos.push(-lastW, y, endD, -lastW, y, endD - tick);
  }
  for (let k = 1; k <= ribs; k++) {
    const d = (k / (ribs + 1)) * endD;
    const w = halfWidthAt(shape, d, drop);
    if (w > 0) pos.push(-w, y, d, w, y, d);
  }
}

// A ring around the jet at distance d, drawn only where it is above the ground.
function pushArc(pos, shape, d, drop, segs) {
  const r = shape.aperture + d * shape.spread;
  const floorY = -shape.hubHeight;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const y0 = Math.sin(a0) * r;
    const y1 = Math.sin(a1) * r;
    if (y0 < floorY && y1 < floorY) continue;
    pos.push(Math.cos(a0) * r, y0, d, Math.cos(a1) * r, y1, d);
  }
}

function pushAxis(pos, shape) {
  pos.push(0, 0, 0, 0, 0, shape.range);
  const barb = Math.min(0.5, shape.range * 0.12);
  const tipR = (shape.aperture + shape.range * shape.spread) * 0.35;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    pos.push(0, 0, shape.range, Math.cos(a) * tipR, Math.sin(a) * tipR, shape.range - barb);
  }
}

// The old full cone. Still the right picture when there is no ground plane to
// project onto: a tilted jet, or a blower that is not floor-standing.
function pushFullCone(pos, shape) {
  const H = config.render.hint;
  const segs = Math.max(6, Math.round(H.coneSegments));
  const rings = Math.max(1, Math.round(H.coneRings));
  const spokes = Math.max(2, Math.round(H.coneSpokes));
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
}

export function outlineGeometry(shape) {
  const H = config.render.hint;
  const pos = [];
  const flat = shape.floorAnchored && Math.abs(shape.pitch) < 1e-6;
  if (!flat) {
    pushFullCone(pos, shape);
    pushAxis(pos, shape);
  } else {
    const segs = Math.max(6, Math.round(H.coneSegments));
    const drop = duckPlaneDrop(shape);
    const y = -drop + H.footprintLift;
    pushContour(pos, shape, drop, shape.range, y);
    pushArc(pos, shape, 0, drop, segs);
    pushArc(pos, shape, shape.range, drop, segs);
    pushAxis(pos, shape);
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

// --- the wind, as streaks ------------------------------------------------------
//
// Ported from Jurek's own fan_wind_shader.gdshader. The Godot original is a
// spatial shader with nothing Godot-specific in the maths at all -- it reads UV
// and TIME and writes ALBEDO and ALPHA -- so the port is a rename of four
// identifiers and a wrapper. The logic below is his, comment for comment:
// N trails, each at a pseudo-random x from a hash of its index, flowing along
// v, each with its own width, length and brightness, under a capsule-shaped
// fade so the stream does not end in a rectangle.
//
// It replaces a scrolling band texture. The bands said "something is moving
// this way" and nothing else; streaks say how FAST, because a streak has a
// length and a band does not.
const WIND_VERT = `
varying vec2 vUvW;
varying vec3 vColW;
void main() {
  vUvW = uv;
  vColW = color;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const WIND_FRAG = `
precision mediump float;
uniform float uTime;
uniform float uSpeed;
uniform float uStrength;
uniform vec3  uColor;
uniform float uTrails;
uniform float uWidth;
uniform float uLength;
uniform float uRandom;
uniform float uSpawn;
varying vec2 vUvW;
varying vec3 vColW;

float hash(float n) { return fract(sin(n) * 43758.5453123); }

void main() {
  vec2 uv = vUvW;
  float trails = 0.0;
  for (int i = 0; i < 30; i++) {
    if (float(i) >= uTrails) break;
    float id = float(i);
    vec2 seed = vec2(id * 12.345, id * 67.891);

    float rx = hash(seed.x + seed.y);
    float tv = hash(seed.x * 3.14159) * 0.2;
    rx = fract(rx + tv * sin(uTime * uSpawn * 0.3));
    rx = mix(id / uTrails, rx, uRandom);

    float toff = hash(seed.y * 19.753) * 3.0;
    float anim = fract(uv.y - uTime * uSpeed + toff);

    float w = uWidth * (0.7 + 0.6 * hash(seed.x * 7.321));
    float line = smoothstep(w, 0.0, abs(uv.x - rx));

    float len = uLength * (0.8 + 0.4 * hash(seed.y * 5.123));
    float vis = smoothstep(0.0, 0.1, anim) * smoothstep(len, 0.0, anim);

    float fade = smoothstep(0.5, 0.7, uv.y);
    line *= vis * (1.0 - fade) * (0.6 + 0.5 * hash(seed.x * 13.579));
    trails += line;
  }

  // The capsule fade: away at the edges and away at the far end, so a stream
  // stops looking like a billboard with a hard border.
  float cx = (uv.x - 0.5) * 2.0;
  float radial = (1.0 - smoothstep(0.7, 1.0, abs(cx))) * (1.0 - smoothstep(0.7, 1.0, uv.y));

  float a = trails * radial * uStrength;
  // vColW is the per-vertex tint the stream geometry already carries, which is
  // how one material draws every fan on the plate at its own strength.
  gl_FragColor = vec4(uColor * vColW, a);
  if (a < 0.002) discard;
}
`;

export function createAirMaterial() {
  const A = config.render.airflow;
  const map = bandTexture();
  const W = A.wind;
  const uniforms = {
    uTime: { value: 0 },
    uSpeed: { value: W.speed },
    uStrength: { value: W.strength * A.opacity },
    uColor: { value: new THREE.Color(A.color) },
    uTrails: { value: W.trails },
    uWidth: { value: W.width },
    uLength: { value: W.length },
    uRandom: { value: W.randomness },
    uSpawn: { value: W.spawnRate },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: WIND_VERT,
    fragmentShader: WIND_FRAG,
    vertexColors: true,
    transparent: true,
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
      // ONE clock for every fan on the plate. The streaks are generated in the
      // fragment shader from uv and this number, so a hundred fans cost one
      // uniform write a frame and no per-object work at all -- which is the
      // same property the scrolling band texture had and the reason the port
      // was worth doing rather than switching to particles.
      scroll = (scroll + dt * config.render.airflow.wind.speed) % 1000;
      mat.uniforms.uTime.value = scroll;
      return scroll;
    },
    scroll: () => scroll,
    dispose() { mat.dispose(); },
  };
}

export default streamGeometry;
