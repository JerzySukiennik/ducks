// The item in the player's hands.
//
// A view-space model: the group is written from the camera's pose every frame
// and the item hangs off it at the offset its row declares, so what you carry
// is on screen instead of only being a line of hotbar text.
//
// It is NOT parented to the camera object. The renderer traverses the scene,
// and the camera is not in the scene graph in this project, so a child of the
// camera would exist, update, and never be drawn -- which is the same symptom
// as having no model at all and would be diagnosed twice.

import * as THREE from 'three';
import config from '../config.js';
import { propMaterial } from './props.js';

const DEG = Math.PI / 180;

function numOr(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

// The row states pos/rotDeg/scale; anything it leaves out comes from config, so
// a carryable row can be one short line and still be posed sanely.
export function handPose(row) {
  const c = config.hand;
  const h = (row && row.hand) || {};
  const p = Array.isArray(h.pos) ? h.pos : [];
  const r = Array.isArray(h.rotDeg) ? h.rotDeg : [];
  return {
    x: numOr(p[0], c.modelX),
    y: numOr(p[1], c.modelY),
    z: numOr(p[2], c.modelZ),
    pitch: numOr(r[0], c.modelPitchDegrees) * DEG,
    yaw: numOr(r[1], c.modelYawDegrees) * DEG,
    roll: numOr(r[2], c.modelRollDegrees) * DEG,
    scale: numOr(h.scale, c.modelScale),
  };
}

export function createHandView({ scene, models }) {
  const material = propMaterial();
  const group = new THREE.Group();
  group.name = 'hand';
  // The held item is posed in VIEW space, a hand's width in front of the eye.
  // Casting from there would paint a bucket-shaped shadow that swings across
  // the whole plate every time the player turns their head.
  group.userData.noShadow = true;
  scene.add(group);

  let currentId = null;
  let item = null;      // pivot at the model's bounding-box centre
  let mesh = null;

  function clear() {
    if (item) {
      group.remove(item);
      item = null;
      mesh = null;
    }
    currentId = null;
  }

  // Models are authored around their own origins, so the offset in a row would
  // mean something different per model unless the pivot is normalised first.
  // Centring on the bounding box makes `hand.pos` "where the middle of the thing
  // sits", which is the only reading a content author can predict.
  function build(row) {
    const m = models[row.model];
    if (!m || !m.geometry) return false;
    const pose = handPose(row);
    m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox;
    mesh = new THREE.Mesh(m.geometry, material);
    mesh.position.set(
      -(b.min.x + b.max.x) / 2,
      -(b.min.y + b.max.y) / 2,
      -(b.min.z + b.max.z) / 2
    );
    mesh.frustumCulled = false;
    item = new THREE.Group();
    item.add(mesh);
    item.position.set(pose.x, pose.y, pose.z);
    item.rotation.set(pose.pitch, pose.yaw, pose.roll);
    item.scale.setScalar(pose.scale);
    item.frustumCulled = false;
    group.add(item);
    return true;
  }

  // Idempotent: called every frame with whatever is in hand, and does nothing at
  // all while that does not change.
  function set(row) {
    const id = row ? row.id : null;
    if (id === currentId) return currentId;
    clear();
    if (row && build(row)) currentId = row.id;
    return currentId;
  }

  function update(camera) {
    if (!item) return;
    group.position.copy(camera.position);
    group.quaternion.copy(camera.quaternion);
    group.updateMatrixWorld(true);
  }

  return {
    group,
    set,
    clear,
    update,
    current: () => currentId,
    visible: () => !!item,
    // The world pose the model actually got, read back out of the scene graph.
    // A flag saying "held" proves nothing; this is what a screenshot is checked
    // against.
    pose() {
      if (!item) return null;
      item.updateMatrixWorld(true);
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      item.matrixWorld.decompose(p, q, s);
      const box = new THREE.Box3().setFromObject(item);
      return {
        id: currentId,
        world: { x: p.x, y: p.y, z: p.z },
        quaternion: { x: q.x, y: q.y, z: q.z, w: q.w },
        scale: s.x,
        box: {
          min: { x: box.min.x, y: box.min.y, z: box.min.z },
          max: { x: box.max.x, y: box.max.y, z: box.max.z },
        },
      };
    },
    dispose() {
      clear();
      scene.remove(group);
      material.dispose();
    },
  };
}

export default createHandView;
