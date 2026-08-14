// GLB loading with a hard timeout and a procedural fallback for every model.
// A missing or slow asset must degrade to a visible shape, never to a blank
// screen, and the loader module itself is imported dynamically so a CDN outage
// cannot take the boot down with it.

import * as THREE from 'three';
import config from '../config.js';

const WHITE = new THREE.Color(1, 1, 1);

function timeout(ms, label) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
}

// Concatenates non-indexed position/normal/color into one geometry, so a
// multi-material GLB collapses to a single draw call.
function concat(chunks) {
  let total = 0;
  for (let i = 0; i < chunks.length; i++) total += chunks[i].attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (let i = 0; i < chunks.length; i++) {
    const g = chunks[i];
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    const c = g.attributes.color.array;
    pos.set(p, o * 3);
    nor.set(n, o * 3);
    col.set(c, o * 3);
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

function paint(geometry, color) {
  const n = geometry.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = color.r;
    col[i * 3 + 1] = color.g;
    col[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geometry;
}

function prepare(geometry, matrix, color) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  if (matrix) g.applyMatrix4(matrix);
  if (!g.attributes.normal) g.computeVertexNormals();
  return paint(g, color);
}

// Flattens a loaded glTF scene into one vertex-coloured geometry. `remap` gets
// the material colour and name and may rewrite the colour in place. Materials
// listed in `drop` are skipped entirely -- that is how the tube loses its
// ground plinth without editing the asset.
function bake(root, remap, drop) {
  const chunks = [];
  root.updateWorldMatrix(true, true);
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    const name = mat && mat.name ? mat.name : '';
    if (drop && drop.indexOf(name) !== -1) return;
    const color = new THREE.Color();
    if (mat && mat.color) color.copy(mat.color); else color.copy(WHITE);
    if (remap) remap(color, name);
    chunks.push(prepare(o.geometry, o.matrixWorld, color));
  });
  if (!chunks.length) return null;
  return concat(chunks);
}

// The connected PARTS of a baked geometry. Vertices are welded by position and
// the three corners of every triangle are joined, so what comes back is the set
// of separate solids the model is built out of -- the four blades of a fan, the
// sixteen segments of its cage, the pole, the base.
//
// Whole parts are the unit every caller here works in, never single triangles:
// the crank's spokes are long bars that straddle any plane you would cut on, so
// a per-triangle test would leave half a spoke welded to the cabinet while the
// rest turned.
//
// Returns [{ tris: [triangleIndex], centroid: {x,y,z}, area }]. `area` is the
// summed triangle area, which is invariant under rotation and is therefore the
// one cheap way to say "these two parts are the same part, turned" -- the test
// rotor.js uses to find a set of identical blades.
export function components(geometry) {
  const p = geometry.attributes.position.array;
  const count = geometry.attributes.position.count;
  const tris = count / 3;

  const parent = new Int32Array(count);
  for (let i = 0; i < count; i++) parent[i] = i;
  function find(a) {
    let r = a;
    while (parent[r] !== r) { parent[r] = parent[parent[r]]; r = parent[r]; }
    return r;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  const seen = new Map();
  for (let i = 0; i < count; i++) {
    const k = Math.round(p[i * 3] * 1e4) + ',' +
      Math.round(p[i * 3 + 1] * 1e4) + ',' + Math.round(p[i * 3 + 2] * 1e4);
    const prev = seen.get(k);
    if (prev === undefined) seen.set(k, i); else union(i, prev);
  }
  for (let t = 0; t < tris; t++) { union(t * 3, t * 3 + 1); union(t * 3 + 1, t * 3 + 2); }

  const byRoot = new Map();
  for (let t = 0; t < tris; t++) {
    const r = find(t * 3);
    let c = byRoot.get(r);
    if (!c) { c = { tris: [], sx: 0, sy: 0, sz: 0, n: 0, area: 0 }; byRoot.set(r, c); }
    c.tris.push(t);
    const o = t * 9;
    for (let k = 0; k < 3; k++) {
      c.sx += p[o + k * 3];
      c.sy += p[o + k * 3 + 1];
      c.sz += p[o + k * 3 + 2];
      c.n += 1;
    }
    const ax = p[o + 3] - p[o], ay = p[o + 4] - p[o + 1], az = p[o + 5] - p[o + 2];
    const bx = p[o + 6] - p[o], by = p[o + 7] - p[o + 1], bz = p[o + 8] - p[o + 2];
    c.area += 0.5 * Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
  }
  const out = [];
  byRoot.forEach((c) => {
    out.push({
      tris: c.tris,
      centroid: { x: c.sx / c.n, y: c.sy / c.n, z: c.sz / c.n },
      area: c.area,
    });
  });
  return out;
}

// A new geometry holding just the listed triangles of `geometry`.
export function subGeometry(geometry, triangles) {
  const p = geometry.attributes.position.array;
  const n = geometry.attributes.normal.array;
  const c = geometry.attributes.color.array;
  const pos = new Float32Array(triangles.length * 9);
  const nor = new Float32Array(triangles.length * 9);
  const col = new Float32Array(triangles.length * 9);
  for (let i = 0; i < triangles.length; i++) {
    const src = triangles[i] * 9;
    pos.set(p.subarray(src, src + 9), i * 9);
    nor.set(n.subarray(src, src + 9), i * 9);
    col.set(c.subarray(src, src + 9), i * 9);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// Splits a baked geometry in two, asking the predicate about whole parts.
function partition(geometry, predicate) {
  const parts = components(geometry);
  const inside = [];
  const outside = [];
  for (let i = 0; i < parts.length; i++) {
    const c = parts[i].centroid;
    const list = predicate(c.x, c.y, c.z) ? inside : outside;
    for (let t = 0; t < parts[i].tris.length; t++) list.push(parts[i].tris[t]);
  }
  inside.sort((a, b) => a - b);
  outside.sort((a, b) => a - b);
  return [subGeometry(geometry, inside), subGeometry(geometry, outside)];
}

// Per-vertex colour tweak in model-local space. The tube uses it to dissolve
// into the dark sky at its far end.
function shade(geometry, fn) {
  const p = geometry.attributes.position.array;
  const c = geometry.attributes.color.array;
  for (let i = 0; i < geometry.attributes.position.count; i++) {
    const k = fn(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    c[i * 3] *= k;
    c[i * 3 + 1] *= k;
    c[i * 3 + 2] *= k;
  }
  geometry.attributes.color.needsUpdate = true;
  return geometry;
}

function box(w, h, d, x, y, z, color) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return prepare(g, null, color);
}

function cyl(rt, rb, h, seg, x, y, z, color) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  g.translate(x, y, z);
  return prepare(g, null, color);
}

// Cylinder lying along +Z, for the workbench's output pipe.
function cylZ(r, h, seg, x, y, z, color) {
  const g = new THREE.CylinderGeometry(r, r, h, seg);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return prepare(g, null, color);
}

// Procedural stand-ins. They keep the same footprint and the same origin
// convention as the GLBs (standing on y=0, centred in XY) so nothing downstream
// has to know which one it got.
const FALLBACKS = {
  // The duck's colours are ratios against the body, matching duckColorRemap:
  // white body, relative beak, absolute dark eye.
  duck() {
    const body = new THREE.Color(1, 1, 1);
    const beak = new THREE.Color(0.97, 0.63, 0.6);
    const eye = new THREE.Color(0.1, 0.1, 0.12);
    return concat([
      box(0.18, 0.16, 0.26, 0, 0.08, 0, body),
      box(0.12, 0.16, 0.11, 0, 0.24, 0.05, body),
      box(0.09, 0.06, 0.09, 0, 0.32, 0.09, body),
      box(0.06, 0.04, 0.08, 0, 0.31, 0.16, beak),
      box(0.11, 0.03, 0.03, 0, 0.34, 0.08, eye),
    ]);
  },
  pit_rim() {
    const concreteC = new THREE.Color(0.55, 0.55, 0.57);
    const hazard = new THREE.Color(0.95, 0.75, 0.08);
    return concat([
      cyl(1.77, 1.77, 0.2, 32, 0, 0.1, 0, concreteC),
      cyl(1.62, 1.62, 0.09, 32, 0, 0.23, 0, hazard),
    ]);
  },
  // No plinth: the tube hangs from above and must not look supported.
  tube() {
    const steel = new THREE.Color(0.28, 0.3, 0.34);
    const dark = new THREE.Color(0.13, 0.13, 0.16);
    return concat([
      cyl(1.85, 1.85, 6.33, 16, 0, 3.165, 0, steel),
      cyl(1.97, 1.97, 0.26, 16, 0, 6.2, 0, dark),
    ]);
  },
  // Teal cabinet, wheel on the local +X side, output pipe out of the local +Z
  // face. The wheel is placed exactly where config.machine says it is, so the
  // split predicate finds it in the stand-in too.
  crank() {
    const teal = new THREE.Color(0.16, 0.55, 0.55);
    const dark = new THREE.Color(0.13, 0.13, 0.16);
    const steel = new THREE.Color(0.45, 0.47, 0.5);
    const hazard = new THREE.Color(0.85, 0.7, 0.12);
    const m = config.machine;
    const wheel = [];
    const R = m.wheelRadius;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const g = new THREE.BoxGeometry(0.07, 0.16, R * 0.55);
      g.rotateX(-a);
      g.translate(
        m.wheelLocalX,
        m.wheelLocalY + Math.sin(a) * R * 0.78,
        m.wheelLocalZ + Math.cos(a) * R * 0.78
      );
      wheel.push(prepare(g, null, i % 2 === 0 ? hazard : steel));
    }
    wheel.push(box(0.12, 0.16, 0.16, m.wheelLocalX, m.wheelLocalY, m.wheelLocalZ, dark));
    return concat([
      box(1.0, 1.15, 0.8, -0.116, 0.575, -0.225, teal),
      box(1.2, 0.14, 0.94, -0.116, 0.07, -0.225, dark),
      box(1.02, 0.26, 0.84, -0.116, 1.28, -0.225, steel),
      cylZ(0.18, 0.52, 10, -0.043, 0.42, 0.4, steel),
    ].concat(wheel));
  },
};

// A model with no hand-written stand-in falls back to a box of its own
// footprint, so a failed download reads as "the right size, wrong shape"
// instead of a duck wearing a container's name.
function footprintBox(size) {
  const grey = new THREE.Color(0.42, 0.45, 0.5);
  const stripe = new THREE.Color(0.62, 0.5, 0.16);
  const w = size[0];
  const h = size[1];
  const d = size[2];
  return concat([
    box(w, h * 0.92, d, 0, h * 0.46, 0, grey),
    box(w * 1.02, h * 0.06, d * 1.02, 0, h * 0.95, 0, stripe),
  ]);
}

function fallbackFor(name, spec) {
  if (FALLBACKS[name]) return FALLBACKS[name]();
  if (spec && Array.isArray(spec.fallbackBox) && spec.fallbackBox.length === 3) {
    return footprintBox(spec.fallbackBox);
  }
  return FALLBACKS.duck();
}

let loaderPromise = null;
function getLoader() {
  if (!loaderPromise) {
    loaderPromise = Promise.race([
      import('three/addons/loaders/GLTFLoader.js').then((m) => new m.GLTFLoader()),
      timeout(config.models.timeoutMs, 'GLTFLoader import'),
    ]);
  }
  return loaderPromise;
}

function loadGLB(url) {
  return getLoader().then((loader) => Promise.race([
    new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject)),
    timeout(config.models.timeoutMs, url),
  ]));
}

// A spec is either a colour remap function or an options object:
//   { remap, drop: [materialName], shade: (x,y,z) => factor, parts: { name: fn } }
// Post-processing runs on the GLB and on the procedural stand-in alike, so a
// CDN outage cannot leave the wheel welded to the cabinet.
function normalizeSpec(spec) {
  if (typeof spec === 'function') return { remap: spec };
  return spec || {};
}

function postProcess(geometry, spec) {
  let geo = geometry;
  const parts = {};
  if (spec.parts) {
    Object.keys(spec.parts).forEach((key) => {
      const [inside, outside] = partition(geo, spec.parts[key]);
      geo.dispose();
      parts[key] = inside;
      geo = outside;
    });
  }
  if (spec.shade) {
    shade(geo, spec.shade);
    Object.keys(parts).forEach((k) => shade(parts[k], spec.shade));
  }
  return { geometry: geo, parts };
}

// Returns { geometry, parts, fallback, error } and never rejects.
export async function loadModel(name, spec) {
  const s = normalizeSpec(spec);
  const url = config.models.basePath + name + '.glb';
  try {
    const gltf = await loadGLB(url);
    const geo = bake(gltf.scene || gltf.scenes[0], s.remap, s.drop);
    if (!geo) throw new Error('glTF contained no meshes');
    const out = postProcess(geo, s);
    return { geometry: out.geometry, parts: out.parts, fallback: false, error: null };
  } catch (err) {
    console.warn(`[models] ${url} unavailable, using procedural fallback:`, err && err.message);
    const out = postProcess(fallbackFor(name, s), s);
    return { geometry: out.geometry, parts: out.parts, fallback: true, error: err };
  }
}

export async function loadModels(specs) {
  const names = Object.keys(specs);
  const results = await Promise.all(names.map((n) => loadModel(n, specs[n])));
  const out = {};
  for (let i = 0; i < names.length; i++) out[names[i]] = results[i];
  return out;
}

// The duck is tinted per instance, so its baked vertex colours are ratios
// against the body colour: the body becomes white and everything else keeps its
// relation to it, which lets one instanceColor drive all seven rarity tiers.
export function duckColorRemap(color, name) {
  if (name === 'black' || name === 'eye' || name === 'eyes') {
    color.setRGB(0.1, 0.1, 0.12);
    return;
  }
  // glTF baseColorFactor is already linear, which is the working space, so the
  // body factor is used as the divisor exactly as authored.
  const r = Math.min(2, color.r / 0.98);
  const g = Math.min(2, color.g / 0.8);
  const b = Math.min(2, color.b / 0.1);
  color.setRGB(Math.min(r, 1.6), Math.min(g, 1.6), Math.min(b, 1.6));
}

export default loadModels;
