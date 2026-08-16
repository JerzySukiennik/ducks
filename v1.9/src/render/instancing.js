// Every duck in one InstancedMesh. Draw calls, not triangles, are this
// project's ceiling: 300 separate meshes would be 300 draw calls, so the pool
// renders as a single instanced draw with per-instance rarity colour.
//
// Two costs are avoided per frame: a sleeping duck's matrix is not rewritten
// (it cannot have moved), and instances are packed into the low slots so
// mesh.count is the live duck count, not the pool size.

import * as THREE from 'three';
import config from '../config.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export function createDuckInstances({ geometry, max, ducks }) {
  const d = config.duckRender;

  // Model space -> collider space is baked into the geometry once: the model's
  // long axis is +Z, the collider's is +X, and the model stands on y=0 while the
  // body origin is its centre.
  const geo = geometry.clone();
  geo.rotateY(d.yaw);
  geo.scale(d.scale, d.scale, d.scale);
  geo.translate(0, d.yOffset, 0);
  geo.computeBoundingSphere();

  const material = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    vertexColors: true,
    flatShading: true,
  });

  // Whatever an instance colour has above 1.0 is added after lighting, which
  // makes the top tier self-luminous instead of just "a lighter yellow" that
  // the diffuse term immediately eats. Every other tier stays <= 1 and is
  // untouched, so this costs one clamped add for the whole pool.
  material.onBeforeCompile = (shader) => {
    const anchor = shader.fragmentShader.indexOf('#include <dithering_fragment>') >= 0
      ? '#include <dithering_fragment>'
      : '#include <opaque_fragment>';
    shader.fragmentShader = shader.fragmentShader.replace(
      anchor,
      anchor + '\n\tgl_FragColor.rgb += max(vColor - vec3(1.0), vec3(0.0)) * 0.9;'
    );
  };

  const mesh = new THREE.InstancedMesh(geo, material, max);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  // An InstancedMesh is culled by the source geometry's bounds, which say
  // nothing about where the instances are; culling it would blink every duck.
  mesh.frustumCulled = false;
  mesh.name = 'ducks';
  // An InstancedMesh casts PER INSTANCE from one flag, which is the whole reason
  // 300 duck shadows are affordable: the shadow pass is one more instanced draw,
  // not 300. receiveShadow is deliberately off -- a duck is 20 cm tall and the
  // shadow it would receive is at most a couple of backbuffer pixels, so it buys
  // nothing and costs a shadow lookup on every duck fragment on screen.
  mesh.castShadow = !!config.world.shadowsEnabled;
  mesh.receiveShadow = false;

  const tierColors = [];
  for (let i = 0; i < 7; i++) tierColors.push(new THREE.Color(config.tierColors[i]));
  const topTier = tierColors.length - 1;

  const slotOfDuck = new Int32Array(max).fill(-1);
  const duckOfSlot = new Int32Array(max).fill(-1);
  const wasSleeping = new Uint8Array(max);
  const lastTier = new Int8Array(max).fill(-1);
  const seen = new Int32Array(max).fill(-1);
  let live = 0;
  let generation = 0;
  let matrixWrites = 0;
  let skipped = 0;
  let pulse = 0;

  function tierScale(tier) {
    if (tier >= topTier) return d.topTierScale;
    return 1 + tier * d.tierScaleStep;
  }

  function writeMatrix(slot, x, y, z, qx, qy, qz, qw, tier) {
    const s = tierScale(tier);
    _p.set(x, y, z);
    _q.set(qx, qy, qz, qw);
    _s.set(s, s, s);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(slot, _m);
    matrixWrites++;
  }

  const _tmpColor = new THREE.Color();
  function writeColor(slot, tier, boost) {
    const c = tierColors[Math.max(0, Math.min(topTier, tier))];
    const k = boost || 1;
    mesh.setColorAt(slot, _tmpColor.setRGB(c.r * k, c.g * k, c.b * k));
  }

  function hide(slot) {
    _m.makeScale(0, 0, 0);
    mesh.setMatrixAt(slot, _m);
  }

  // Called once per rendered frame, including inside debugStep.
  function sync(time) {
    generation++;
    let matrixDirty = false;
    let colorDirty = false;
    // Never dips to plain: the top tier is always over-bright, and breathes.
    pulse = 1 + d.topTierPulseAmp * (0.65 + 0.35 * Math.sin(time * Math.PI * 2 * d.topTierPulseHz));

    ducks.forEach((id, x, y, z, qx, qy, qz, qw, tier, sleeping) => {
      let slot = slotOfDuck[id];
      let fresh = false;
      if (slot < 0) {
        slot = live++;
        slotOfDuck[id] = slot;
        duckOfSlot[slot] = id;
        fresh = true;
      }
      seen[id] = generation;

      const asleep = sleeping ? 1 : 0;
      // A sleeping duck that was already asleep last frame cannot have moved.
      if (fresh || !asleep || !wasSleeping[id]) {
        writeMatrix(slot, x, y, z, qx, qy, qz, qw, tier);
        matrixDirty = true;
      } else {
        skipped++;
      }
      wasSleeping[id] = asleep;

      if (fresh || lastTier[id] !== tier || tier >= topTier) {
        writeColor(slot, tier, tier >= topTier ? pulse : 1);
        lastTier[id] = tier;
        colorDirty = true;
      }
    });

    // Compact: any slot whose duck did not report this frame is gone. The last
    // live slot is swapped down, which is the only matrix a despawn dirties.
    for (let slot = live - 1; slot >= 0; slot--) {
      const id = duckOfSlot[slot];
      if (id < 0 || seen[id] === generation) continue;
      slotOfDuck[id] = -1;
      lastTier[id] = -1;
      wasSleeping[id] = 0;
      const last = live - 1;
      if (slot !== last) {
        const moved = duckOfSlot[last];
        duckOfSlot[slot] = moved;
        slotOfDuck[moved] = slot;
        const p = ducks.pose(moved);
        if (p) {
          writeMatrix(slot, p.x, p.y, p.z, p.qx, p.qy, p.qz, p.qw, p.tier);
          writeColor(slot, p.tier, p.tier >= topTier ? pulse : 1);
          matrixDirty = true;
          colorDirty = true;
        }
      }
      duckOfSlot[last] = -1;
      live = last;
      hide(last);
      matrixDirty = true;
    }

    mesh.count = live;
    if (matrixDirty) mesh.instanceMatrix.needsUpdate = true;
    if (colorDirty && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return live;
  }

  return {
    mesh,
    sync,
    geometry: geo,
    liveInstances: () => live,
    slotOf: (id) => slotOfDuck[id],
    // Inverse of slotOf. The crosshair picker gets an instanceId back from the
    // raycaster and has to turn it into a duck before it can name one.
    duckOf: (slot) => (slot >= 0 && slot < live ? duckOfSlot[slot] : -1),
    stats: () => ({ matrixWrites, skippedWrites: skipped, instances: live }),
    resetStats() { matrixWrites = 0; skipped = 0; },
    tierColor: (t) => tierColors[Math.max(0, Math.min(topTier, t))].getHex(),
    dispose() {
      geo.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}

export default createDuckInstances;
