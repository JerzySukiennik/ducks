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
  // A PHOTOGRAPH UNDER THE PAINTING, not instead of it.
  //
  // Everything else this function draws -- the blotches, the cracks, the grain,
  // the scuffs -- is authored and tuned, and it is what makes this floor belong
  // to this game rather than to a texture pack. What a canvas cannot draw is
  // MATERIAL: the fine irregular tooth of real concrete.
  //
  // IT IS DRAWN AT A SIZE IN METRES, which is the whole fix. One canvas covers
  // floorTileMeters (30 m) of plate, so a 256 px photograph drawn once fills
  // thirty metres with a single 256-pixel image -- every blemish in it becomes
  // a stain several metres across, and the dark ones read as black patches on
  // the yard. Drawn at floorPhotoMeters instead, one tile of it is about a
  // metre and a half of floor and it reads as concrete.
  const photo = new Image();
  photo.onload = () => {
    try {
      // A FULL REDRAW, in order: colour, photograph, then every authored pass
      // exactly once. Compositing onto the already-painted canvas would run
      // the paint passes twice and double the density of everything in them.
      ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
      ctx.fillRect(0, 0, S, S);
      const px = Math.max(8, Math.round(S * (w.floorPhotoMeters / w.floorTileMeters)));
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = w.floorPhotoStrength;
      for (let ty = 0; ty < S; ty += px) {
        for (let tx = 0; tx < S; tx += px) ctx.drawImage(photo, tx, ty, px, px);
      }
      ctx.restore();
      const rnd2 = seeded(w.floorTextureSeed);
      paintBlotches(ctx, S, rnd2, w.floorBlotches);
      paintCracks(ctx, S, rnd2, w.floorCracks);
      paintGrain(ctx, S, rnd2, w.floorGrain);
      paintScuffs(ctx, S, rnd2);
      if (floorTex) floorTex.needsUpdate = true;
    } catch (e) { /* the canvas is already a floor; keep it */ }
  };
  photo.src = w.floorPhoto;
  paintBlotches(ctx, S, rnd, w.floorBlotches);
  // NO paintJoints. It drew the slab grid across the whole yard, and the yard
  // is meant to be concrete rather than paving: asked for and removed. The
  // function stays -- nothing else calls it, but deleting a tuned drawing pass
  // to turn it off is how it comes back wrong when somebody wants it again.
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
  // NO NORMAL MAP ON THE PLATE, and it was tried.
  //
  // The plate is a ShapeGeometry: one square with holes cut in it, triangulated
  // into a handful of very large, very skinny triangles fanning around each
  // hole. A normal map needs tangents, this geometry has none, and three.js
  // then derives them from screen-space derivatives -- which on triangles that
  // size is degenerate in places and flips the normal. A flipped normal under a
  // single directional light is a black patch, and a black patch on a concrete
  // floor reads exactly like a hole in it, appearing and disappearing as the
  // camera moves. Reported as holes in the floor at random places.
  //
  // The relief is worth having and this is not the geometry to have it on. The
  // photograph in the colour map stays; the file stays on disk for the day the
  // plate is rebuilt out of tiles that have tangents.
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

// --- contact shadow ---------------------------------------------------------
//
// THE ONE THING THAT SEPARATES A PLACED OBJECT FROM THE CONCRETE.
//
// The defect this exists to fix, measured in the real 480 px backbuffer with a
// Duck Press and a Machine standing on clean plate at 10 m: the floor around
// the object read luminance 88 and the machine's own grey body read 80. That is
// a contrast ratio of 1.10:1 across the boundary the eye is supposed to use to
// find the object's edge -- so the only thing doing the separating was the thin
// amber trim, which at this resolution is ONE pixel. A critic put it exactly
// that way ("my placed Duck Press separated from the floor only by its edging")
// and the number agrees with him.
//
// Why a fake contact shadow rather than more hue, a brighter trim, or a value
// shift on the plate:
//
//   * More hue does not help. The failure is a VALUE failure, and two colours
//     of equal value do not separate at 480 px however different their hue.
//   * A brighter trim is still one pixel wide. Silhouette separation has to
//     come from area, not from an outline the resolution cannot draw.
//   * Shifting the plate's value alone cannot finish the job. Machine bodies
//     measure 53 to 76 in the backbuffer, so ANY single plate value merges with
//     something at one end of that band. The plate did move -- see
//     config.world.plateColor for the numbers and for the known cost -- but it
//     is the other half of the fix, not this one.
//
// A contact darkening under the object is the lever that is INDEPENDENT of the
// body's own value: it darkens the FLOOR, right at the boundary, so a light body
// and a dark body both gain the same separation, and it costs the same whichever
// it is. The two levers do different jobs and both are needed: the plate
// separates the silhouette from the floor BEHIND it, and this separates the
// object from the floor it is STANDING on.
//
// That second job is the half nothing else was doing. Placed objects had no
// grounding at all -- the real shadow map throws its shadow off to one side
// (sunDir 0.45, 1.0, 0.3), so the lit side of every object met the concrete with
// nothing in between and read as pasted on.
//
// This is NOT the shadow map and does not pretend to be. It is an ambient
// occlusion patch: the darkening that belongs under anything sitting on
// anything, which a single directional light plus a hemisphere cannot produce.
// It neither casts nor receives.

let contactTex = null;

// A soft-edged rounded rectangle in alpha. Square texture, mapped onto a quad
// that gets scaled to the object's footprint, so a long conveyor and a square
// press both get a patch of their own shape.
//
// The falloff is on the distance to an inset core rather than radial: a radial
// blob under a 3 m bridge is a circle with two bright ends, which reads as a
// puddle rather than as contact.
export function contactTexture() {
  if (contactTex) return contactTex;
  const c = config.render.contact;
  const S = Math.max(8, Math.round(c.textureSize));
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  // `core` is the fraction of the half-extent that stays at full darkness; the
  // remainder is the penumbra. At core 0 the patch is all falloff and reads as
  // a smudge; at core 1 it is a hard rectangle with a visible corner.
  const core = Math.min(0.999, Math.max(0, c.core));
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // -1..1 across the quad.
      const u = (x + 0.5) / S * 2 - 1;
      const v = (y + 0.5) / S * 2 - 1;
      // Distance outside the inset core, per axis, normalised to the penumbra.
      const du = Math.max(0, Math.abs(u) - core) / (1 - core);
      const dv = Math.max(0, Math.abs(v) - core) / (1 - core);
      const t = Math.min(1, Math.hypot(du, dv));
      // smoothstep, then squared: the darkening is strongest hard against the
      // object and gives up quickly, which is what contact looks like.
      const s = 1 - (t * t * (3 - 2 * t));
      const a = Math.round(255 * s * s);
      const i = (y * S + x) * 4;
      // THE RAMP GOES IN THE COLOUR CHANNELS, NOT IN ALPHA, and this is not a
      // style choice -- THREE.alphaMap samples the texture's GREEN channel and
      // ignores its alpha entirely. Written the obvious way round (RGB 0, alpha
      // = ramp) the map is green 0 everywhere, so every fragment comes out
      // fully transparent and the patch is invisible with no error anywhere.
      d[i] = a; d[i + 1] = a; d[i + 2] = a; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  // LINEAR, and it is the one texture in the game that is allowed to be. The
  // PSX rule is nearest everywhere, but this is a gradient, not an image: at
  // nearest the penumbra comes out as four or five visible steps and reads as a
  // stack of rectangles, which is worse than no shadow at all.
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = config.render.floorAnisotropy;
  tex.needsUpdate = true;
  contactTex = tex;
  return contactTex;
}

let contactMat = null;

export function contactMaterial() {
  if (contactMat) return contactMat;
  const c = config.render.contact;
  contactMat = new THREE.MeshBasicMaterial({
    // BASIC, not Lambert. This is occlusion -- light that never arrived. Lighting
    // it would make the patch brightest where the sun is strongest, which is
    // exactly backwards.
    color: 0x000000,
    alphaMap: contactTexture(),
    transparent: true,
    opacity: c.opacity,
    depthWrite: false,
    // Same belt and braces as the markings: a lift in metres AND a polygon
    // offset. Either alone still z-fights against the plate at a grazing angle.
    polygonOffset: true,
    polygonOffsetFactor: c.polygonOffsetFactor,
    polygonOffsetUnits: c.polygonOffsetUnits,
    side: THREE.FrontSide,
    fog: true,
  });
  return contactMat;
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

// THREE stops, not two, and the middle one is the whole point.
//
// The old dome went horizonColor -> skyColor over the full hemisphere. That
// cannot produce a horizon, because the plate fades into render.fogColor and the
// dome's bottom band is whatever it is: match it and the horizon is a dead flat
// join, miss it and the horizon is a hard line. It missed -- 0x2b3350 of dome
// against a 0x0a0f1e fog -- and the line it drew is what made the opening shot
// read as "grey rectangle, black rectangle".
//
// Now: `bottom` IS the fog colour, so the join is invisible by construction; a
// dim warm `glow` band sits a couple of degrees above it, which is what the
// boundary silhouettes bite into; and `top` returns to near-black for the black
// hole and the starfield. The band is added rather than mixed so it can never
// darken the sky below it, only lift it.
export function skyMaterial() {
  const w = config.world;
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(w.skyColor) },
      // Bound to the FOG colour, not to a sky colour of its own. These two being
      // one value is the contract; config.world.horizonColor documents it.
      bottom: { value: new THREE.Color(config.render.fogColor) },
      glow: { value: new THREE.Color(w.skyGlowColor) },
      glowCenter: { value: w.skyGlowCenter },
      glowWidth: { value: w.skyGlowWidth },
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
      uniform vec3 glow;
      uniform float glowCenter;
      uniform float glowWidth;
      varying float vH;
      void main() {
        // The base ramp. Slower than the old 1.4x: the bottom colour has to
        // survive several degrees of sky for the fogged plate to have anything
        // to meet, otherwise the "invisible join" is one pixel wide.
        vec3 c = mix(bottom, top, clamp(vH * 0.9 + 0.10, 0.0, 1.0));
        // The band. smoothstep either side of glowCenter, so it has soft edges
        // at both ends and never draws a second line of its own.
        float d = abs(vH - glowCenter) / max(glowWidth, 1e-4);
        float band = 1.0 - smoothstep(0.0, 1.0, d);
        gl_FragColor = vec4(c + glow * band, 1.0);
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
  if (contactMat) { contactMat.dispose(); contactMat = null; }
  if (contactTex) { contactTex.dispose(); contactTex = null; }
}
