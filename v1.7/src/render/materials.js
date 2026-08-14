// Flat-shaded Lambert only. MeshStandardMaterial without an environment map
// renders as black metal, so it is deliberately not used anywhere. The floor
// texture is generated into a canvas at boot; nothing here fetches an asset.

import * as THREE from 'three';
import config from '../config.js';

const cache = new Map();

export function flat(color, opts = {}) {
  const key = `${color}:${JSON.stringify(opts)}`;
  if (cache.has(key)) return cache.get(key);
  const mat = new THREE.MeshLambertMaterial({
    color,
    flatShading: true,
    side: opts.side || THREE.FrontSide,
    transparent: !!opts.transparent,
    opacity: opts.opacity === undefined ? 1 : opts.opacity,
  });
  cache.set(key, mat);
  return mat;
}

function seeded(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function css(hex) {
  return '#' + (hex >>> 0).toString(16).padStart(6, '0');
}

function rgbOf(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

// Offsets needed so a shape near an edge repeats correctly across the seam.
function wrapOffsets(x, y, r, S) {
  const xs = [0];
  const ys = [0];
  if (x - r < 0) xs.push(S);
  if (x + r > S) xs.push(-S);
  if (y - r < 0) ys.push(S);
  if (y + r > S) ys.push(-S);
  const out = [];
  for (let i = 0; i < xs.length; i++) for (let j = 0; j < ys.length; j++) out.push([xs[i], ys[j]]);
  return out;
}

// Blotches are low frequency, so they are painted at a quarter of the texture
// size and scaled up: large radial gradients at 1024 cost hundreds of ms.
function paintBlotches(target, size, rnd, count) {
  const S = Math.max(64, Math.round(size / 4));
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext('2d');
  for (let i = 0; i < count; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = (0.015 + rnd() * 0.11) * S;
    const dark = rnd() < 0.62;
    const a = 0.04 + rnd() * 0.11;
    const tint = dark ? '0,0,0' : '255,255,255';
    const offs = wrapOffsets(x, y, r, S);
    for (let k = 0; k < offs.length; k++) {
      const cx = x + offs[k][0];
      const cy = y + offs[k][1];
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `rgba(${tint},${a})`);
      g.addColorStop(1, `rgba(${tint},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  target.drawImage(cv, 0, 0, size, size);
}

function paintJoints(ctx, S) {
  const cells = 3;
  ctx.lineWidth = Math.max(2, S / 340);
  for (let i = 0; i < cells; i++) {
    const p = Math.round((i * S) / cells) + 0.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.42)';
    ctx.beginPath();
    ctx.moveTo(p, 0); ctx.lineTo(p, S);
    ctx.moveTo(0, p); ctx.lineTo(S, p);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.moveTo(p + ctx.lineWidth, 0); ctx.lineTo(p + ctx.lineWidth, S);
    ctx.moveTo(0, p + ctx.lineWidth); ctx.lineTo(S, p + ctx.lineWidth);
    ctx.stroke();
  }
}

function paintCracks(ctx, S, rnd, count) {
  ctx.strokeStyle = 'rgba(0,0,0,0.30)';
  for (let i = 0; i < count; i++) {
    let x = rnd() * S;
    let y = rnd() * S;
    let ang = rnd() * Math.PI * 2;
    const segs = 4 + ((rnd() * 7) | 0);
    ctx.lineWidth = 1 + rnd() * 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < segs; s++) {
      ang += (rnd() - 0.5) * 1.1;
      const len = (0.01 + rnd() * 0.05) * S;
      x += Math.cos(ang) * len;
      y += Math.sin(ang) * len;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// Grey noise centred on 128. One 32-bit write per pixel; a per-channel loop over
// a 1024x1024 canvas costs hundreds of milliseconds at boot, which is a stall.
export function noiseCanvas(w, h, strength, rand) {
  const rnd = rand || Math.random;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  const u32 = new Uint32Array(img.data.buffer);
  const SIZE = 4096;
  const table = new Uint32Array(SIZE);
  for (let i = 0; i < SIZE; i++) {
    let v = 128 + (((rnd() * 2 - 1) * strength) | 0);
    if (v < 0) v = 0; else if (v > 255) v = 255;
    table[i] = (255 << 24) | (v << 16) | (v << 8) | v;
  }
  let s = ((rnd() * 0xffffffff) >>> 0) || 1;
  for (let i = 0; i < u32.length; i++) {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    u32[i] = table[s & (SIZE - 1)];
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

function paintGrain(ctx, S, rnd, amp) {
  const n = noiseCanvas(S, S, amp * 3.2, rnd);
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.8;
  ctx.drawImage(n, 0, 0);
  ctx.restore();
}

// Scuffs are plain wear, not markings: they are the one dirt pass that is
// allowed to repeat across the whole plate.
function paintScuffs(ctx, S, rnd) {
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.20)';
  for (let i = 0; i < 90; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    ctx.lineWidth = 1 + rnd() * 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * S * 0.05, y + (rnd() - 0.5) * S * 0.05);
    ctx.stroke();
  }
}

let floorTex = null;

export function floorTexture() {
  if (floorTex) return floorTex;
  const w = config.world;
  const S = w.floorTextureSize;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const rnd = seeded(w.floorTextureSeed);
  const base = rgbOf(w.plateColor);

  ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  ctx.fillRect(0, 0, S, S);
  paintBlotches(ctx, S, rnd, w.floorBlotches);
  paintJoints(ctx, S);
  paintCracks(ctx, S, rnd, w.floorCracks);
  paintGrain(ctx, S, rnd, w.floorGrain);
  paintScuffs(ctx, S, rnd);

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  // Nearest inside each mip level keeps texels crisp into the distance.
  // Trilinear blurs everything past a few metres, which reads as fog, not PSX.
  tex.minFilter = THREE.NearestMipmapNearestFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = config.render.floorAnisotropy;
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  const rep = w.plateSize / w.floorTileMeters;
  tex.repeat.set(rep, rep);
  tex.needsUpdate = true;
  floorTex = tex;
  return floorTex;
}

let concreteMat = null;

export function concrete() {
  if (concreteMat) return concreteMat;
  concreteMat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    map: floorTexture(),
    flatShading: true,
  });
  return concreteMat;
}

// --- floor decals -----------------------------------------------------------
//
// Markings are placed, not tiled. The three shapes the plate is allowed to carry
// live in one 2x2 atlas so every decal in the world is a single draw call.
// Tiles are padded with transparency and the UV rects are inset by the same
// amount, so mip levels never bleed one tile into another.

const TILES = { hazard: [0, 0], arrow: [1, 0], drop: [0, 1] };

export const DECAL_UV = {};

function tileRect(name) {
  const S = config.decals.textureSize;
  const T = S / 2;
  const pad = config.decals.tilePadding;
  const [tx, ty] = TILES[name];
  const u0 = (tx * T + pad) / S;
  const u1 = ((tx + 1) * T - pad) / S;
  // Canvas y runs down, texture v runs up: the top canvas row is v = 1.
  const v0 = 1 - ((ty + 1) * T - pad) / S;
  const v1 = 1 - (ty * T + pad) / S;
  return [u0, v0, u1, v1];
}

function paintHazardTile(ctx, T, pad, color) {
  // One bar per tile: each ring segment maps the tile once, so the ring comes
  // out as one stripe per segment with no seam to match.
  ctx.fillStyle = css(color);
  ctx.globalAlpha = 1;
  ctx.fillRect(pad, pad, (T - pad * 2) * 0.5, T - pad * 2);
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = '#000000';
  ctx.fillRect(pad, pad, (T - pad * 2) * 0.5, (T - pad * 2) * 0.09);
  ctx.fillRect(pad, T - pad - (T - pad * 2) * 0.09, (T - pad * 2) * 0.5, (T - pad * 2) * 0.09);
  ctx.globalAlpha = 1;
}

function paintArrowTile(ctx, T, pad, color) {
  const a = pad;
  const b = T - pad;
  const w = b - a;
  ctx.fillStyle = css(color);
  ctx.globalAlpha = 1;
  // Chevron pointing towards canvas-up, which is +v.
  const head = a + w * 0.42;
  const th = w * 0.20;
  ctx.beginPath();
  ctx.moveTo(a + w * 0.5, a);
  ctx.lineTo(b, head);
  ctx.lineTo(b - th, head);
  ctx.lineTo(b - th, b);
  ctx.lineTo(a + th, b);
  ctx.lineTo(a + th, head);
  ctx.lineTo(a, head);
  ctx.closePath();
  ctx.fill();
}

function paintDropTile(ctx, T, pad, color) {
  const a = pad;
  const b = T - pad;
  const w = b - a;
  const arm = w * 0.30;
  const th = w * 0.075;
  ctx.fillStyle = css(color);
  ctx.globalAlpha = 1;
  const corners = [[a, a, 1, 1], [b, a, -1, 1], [a, b, 1, -1], [b, b, -1, -1]];
  for (let i = 0; i < corners.length; i++) {
    const [cx, cy, sx, sy] = corners[i];
    ctx.fillRect(Math.min(cx, cx + sx * arm), Math.min(cy, cy + sy * th), arm, th);
    ctx.fillRect(Math.min(cx, cx + sx * th), Math.min(cy, cy + sy * arm), th, arm);
  }
  ctx.globalAlpha = 0.42;
  ctx.strokeStyle = css(color);
  ctx.lineWidth = w * 0.035;
  ctx.save();
  ctx.beginPath();
  ctx.rect(a + arm * 0.6, a + arm * 0.6, w - arm * 1.2, w - arm * 1.2);
  ctx.clip();
  for (let x = a - w; x < b + w; x += w * 0.16) {
    ctx.beginPath();
    ctx.moveTo(x, a);
    ctx.lineTo(x + w, b);
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

let decalTex = null;

export function decalTexture() {
  if (decalTex) return decalTex;
  const S = config.decals.textureSize;
  const T = S / 2;
  const pad = config.decals.tilePadding;
  const color = config.world.markingColor;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, S, S);

  const painters = { hazard: paintHazardTile, arrow: paintArrowTile, drop: paintDropTile };
  Object.keys(TILES).forEach((name) => {
    const [tx, ty] = TILES[name];
    ctx.save();
    ctx.translate(tx * T, ty * T);
    painters[name](ctx, T, pad, color);
    ctx.restore();
    DECAL_UV[name] = tileRect(name);
  });

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapNearestFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = config.render.floorAnisotropy;
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  decalTex = tex;
  return decalTex;
}

let decalMat = null;

// Decals sit 2 cm above the plate AND carry a polygon offset: either alone can
// still z-fight at a grazing angle across 120 m.
export function decalMaterial() {
  if (decalMat) return decalMat;
  decalMat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    map: decalTexture(),
    transparent: true,
    opacity: config.decals.opacity,
    alphaTest: 0.35,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: config.decals.polygonOffsetFactor,
    polygonOffsetUnits: config.decals.polygonOffsetUnits,
    side: THREE.FrontSide,
  });
  return decalMat;
}

export function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(config.world.skyColor) },
      bottom: { value: new THREE.Color(config.world.horizonColor) },
    },
    vertexShader: `
      varying float vH;
      void main() {
        vH = normalize(position).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 top;
      uniform vec3 bottom;
      varying float vH;
      void main() {
        gl_FragColor = vec4(mix(bottom, top, clamp(vH * 1.4 + 0.25, 0.0, 1.0)), 1.0);
      }
    `,
  });
}

export function disposeMaterials() {
  cache.forEach((m) => m.dispose());
  cache.clear();
  if (concreteMat) { concreteMat.dispose(); concreteMat = null; }
  if (floorTex) { floorTex.dispose(); floorTex = null; }
  if (decalMat) { decalMat.dispose(); decalMat = null; }
  if (decalTex) { decalTex.dispose(); decalTex = null; }
}
