// Gargantua: analytic gravitational-lensing shader on a world-fixed quad + far
// starfield.
//
// PORTED 1:1 from ../Gargantua/src/scene/blackhole.js. The shader source below
// is byte-identical to that file: same RS/FLAT/DISK_IN/DISK_OUT/HALO/BEAM
// constants, same hash/vnoise/fbm, same disk, halo, photon ring and star layers.
// It is a verified 207-line artefact and nothing about the physics is ours to
// improve. Only the JS around it differs, and only in three ways, all forced by
// this project rather than chosen:
//
//   1. numbers come from config.sky instead of Gargantua's CONFIG.world;
//   2. the quad and the starfield hang off a rig that is parked on the camera
//      every frame, because the plate here is 120 m wide and a sky fixed at the
//      world origin would visibly parallax as the player walks;
//   3. uTime is driven from the simulation clock, so debugStep() advances the
//      sky exactly as it advances everything else.

import * as THREE from 'three';
import config from '../config.js';

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform float uTime;

const float RS = 0.115;
const float FLAT = 0.20;
const float DISK_IN = 1.8;
const float DISK_OUT = 7.2;
const float HALO_IN = 1.02;
const float HALO_OUT = 1.8;
const float BEAM = 0.42;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.55;
  for (int i = 0; i < 3; i++) {
    v += a * vnoise(p);
    p = p * 2.13 + 17.7;
    a *= 0.5;
  }
  return v;
}

vec3 diskColor(float t) {
  vec3 hot = vec3(1.35, 1.28, 1.15);
  vec3 mid = vec3(1.45, 0.86, 0.42);
  vec3 cool = vec3(0.85, 0.32, 0.10);
  return t < 0.45 ? mix(hot, mid, t / 0.45) : mix(mid, cool, (t - 0.45) / 0.55);
}

float diskStreaks(float r, float theta, float tNorm) {
  float omega = 0.14 / pow(max(r, 0.35), 1.5);
  float n = fbm(vec2(log(r) * 5.5, theta * 3.5 - uTime * omega * 60.0));
  float n2 = fbm(vec2(log(r) * 11.0 + 40.0, theta * 7.0 - uTime * omega * 95.0));
  return 0.45 + 0.75 * n + 0.35 * n2;
}

float starLayer(vec2 p, float density, float bright) {
  vec2 cell = floor(p * density);
  vec2 f = fract(p * density);
  float h = hash21(cell);
  if (h > 0.06) return 0.0;
  vec2 sp = vec2(hash21(cell + 7.1), hash21(cell + 13.7));
  float d = length(f - sp);
  float sz = 0.04 + 0.10 * hash21(cell + 3.3);
  return bright * (0.3 + 0.7 * hash21(cell + 5.5)) * smoothstep(sz, 0.0, d);
}

void main() {
  vec2 u = vUv;
  float b = length(u);
  float rN = b / RS;

  float edgeFade = 1.0 - smoothstep(0.88, 0.995, b);

  float shadow = smoothstep(1.02, 0.94, rN);

  float photon = exp(-abs(rN - 1.06) * 16.0) * 1.6;

  float defl = 0.55 * RS / max(b, 1e-4);
  float swirl = defl * defl * 90.0;
  float ca = cos(swirl); float sa = sin(swirl);
  vec2 wu = mat2(ca, -sa, sa, ca) * u;
  wu *= (1.0 - 0.35 * defl);
  float stars = starLayer(wu * 6.0, 9.0, 1.0) + starLayer(wu * 6.0 + 31.7, 21.0, 0.55);
  stars *= smoothstep(0.94, 1.35, rN);

  vec3 diskCol = vec3(0.0);
  float diskI = 0.0;
  {
    vec2 q = vec2(u.x, u.y / FLAT);
    float rq = length(q) / RS;
    float theta = atan(q.y, q.x);
    float inEdge = smoothstep(DISK_IN, DISK_IN + 0.45, rq);
    if (inEdge > 0.001) {
      float tR = clamp((rq - DISK_IN) / (DISK_OUT - DISK_IN), 0.0, 1.0);
      float st = diskStreaks(rq * 0.3, theta, tR);
      float doppler = pow(1.0 + BEAM * cos(theta + 3.14159), 3.0);
      float inGlow = 1.0 + 2.2 * exp(-(rq - DISK_IN) * 1.2);
      float fall = exp(-tR * tR * 4.2);
      diskI = inEdge * st * doppler * fall * inGlow;
      diskCol = diskColor(tR) * diskI * 1.35;
    }
  }
  float front = smoothstep(0.25, -0.6, u.y / RS);

  vec3 haloCol = vec3(0.0);
  float haloI = 0.0;
  {
    float band = smoothstep(HALO_IN, HALO_IN + 0.07, rN) * (1.0 - smoothstep(HALO_IN + 0.22, HALO_OUT, rN));
    if (band > 0.001) {
      float theta = atan(u.y, u.x);
      float tR = clamp((rN - HALO_IN) / (HALO_OUT - HALO_IN), 0.0, 1.0);
      float st = diskStreaks(rN * 0.55 + 1.7, theta * 0.5, tR);
      float doppler = pow(1.0 + BEAM * 0.8 * cos(theta + 3.14159), 3.0);
      float vertBoost = 0.45 + 0.95 * abs(sin(theta));
      haloI = band * st * doppler * vertBoost * exp(-tR * 2.6) * 0.95;
      haloCol = diskColor(tR * 0.65) * haloI;
    }
  }

  vec3 col = vec3(0.75, 0.82, 1.0) * stars + haloCol + vec3(1.5, 1.25, 0.95) * photon + diskCol * (1.0 - front);
  float lum = haloI + photon + diskI * (1.0 - front);
  col *= (1.0 - shadow);
  lum *= (1.0 - shadow);
  col += diskCol * front;
  lum += diskI * front;

  float alpha = max(max(shadow, clamp(lum * 2.0, 0.0, 1.0)), clamp(stars * 1.5, 0.0, 1.0) * (1.0 - shadow));
  alpha = max(alpha, smoothstep(1.35, 0.94, rN) * max(1.0 - front, shadow));
  alpha = max(alpha, clamp(diskI * front * 2.0, 0.0, 1.0));
  alpha *= edgeFade;

  gl_FragColor = vec4(col * edgeFade, alpha);
}
`;

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The rig is parked on the camera every frame, so the sky is at infinity as far
// as the player is concerned. Render order puts the starfield behind the quad
// and both behind everything the game draws; depthWrite is off on both, so
// nothing in the sky can occlude a duck.
export function createBlackHole(scene) {
  const s = config.sky;

  const uniforms = { uTime: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const rig = new THREE.Group();
  rig.name = 'skyRig';
  scene.add(rig);

  const dir = new THREE.Vector3(s.dirX, s.dirY, s.dirZ).normalize();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(s.holeSize, s.holeSize), mat);
  quad.position.copy(dir).multiplyScalar(s.holeDistance);
  quad.lookAt(0, 0, 0);
  quad.renderOrder = s.holeRenderOrder;
  quad.frustumCulled = false;
  quad.name = 'blackHole';
  rig.add(quad);

  const count = Math.max(0, Math.round(s.starCount));
  const pos = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const rng = mulberry(s.starSeed);
  for (let i = 0; i < count; i++) {
    const t = rng() * Math.PI * 2;
    const z = rng() * 2 - 1;
    const r = Math.sqrt(1 - z * z);
    pos[i * 3] = r * Math.cos(t) * s.starRadius;
    pos[i * 3 + 1] = z * s.starRadius;
    pos[i * 3 + 2] = r * Math.sin(t) * s.starRadius;
    const br = 0.25 + rng() * 0.75;
    const warm = rng() < 0.25 ? 0.85 : 1.0;
    colors[i * 3] = br;
    colors[i * 3 + 1] = br * (0.9 + 0.1 * warm);
    colors[i * 3 + 2] = br * warm * (0.95 + 0.25 * (1 - warm));
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const starMat = new THREE.PointsMaterial({
    size: s.starSize,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: s.starOpacity,
    depthWrite: false,
    fog: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.renderOrder = s.starRenderOrder;
  stars.frustumCulled = false;
  stars.name = 'starfield';
  rig.add(stars);

  return {
    rig,
    quad,
    stars,
    direction: { x: dir.x, y: dir.y, z: dir.z },
    // Called with the camera position every frame; the sky never parallaxes.
    follow(p) { rig.position.set(p.x, p.y, p.z); },
    update(t) { uniforms.uTime.value = t * config.sky.timeScale; },
    time: () => uniforms.uTime.value,
    dispose() {
      quad.geometry.dispose();
      mat.dispose();
      starGeo.dispose();
      starMat.dispose();
      scene.remove(rig);
    },
  };
}

export default createBlackHole;
