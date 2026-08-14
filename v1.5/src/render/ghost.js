// The placement hologram. It renders resolvePlacement()'s output and nothing
// else: no offset of its own, no second opinion about where the object goes.
// pose() reads the transform back out of the scene graph, so verification
// compares what is actually on screen against what physics actually received.

import * as THREE from 'three';
import config from '../config.js';
import { seatOffset, scaleOf } from './placed.js';

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

export function createGhost({ scene, models }) {
  const root = new THREE.Group();
  root.name = 'ghost';
  root.visible = false;
  root.renderOrder = 3;
  scene.add(root);

  const bodyMat = new THREE.MeshBasicMaterial({
    color: config.build.ghostValidColor,
    transparent: true,
    opacity: config.build.ghostOpacity,
    depthWrite: false,
    fog: false,
  });
  const lineMat = new THREE.LineBasicMaterial({
    color: config.build.ghostValidColor, transparent: true, opacity: 0.95, depthTest: false, fog: false,
  });

  const holder = new THREE.Group();
  root.add(holder);
  let mesh = null;
  let outline = null;
  let currentModel = null;
  let currentItem = null;

  function setItem(item) {
    if (item === currentItem) return;
    currentItem = item;
    if (mesh) { holder.remove(mesh); mesh = null; }
    if (outline) { root.remove(outline); outline.geometry.dispose(); outline = null; }
    if (!item) { root.visible = false; currentModel = null; return; }

    const m = models[item.model];
    if (m && m.geometry) {
      mesh = new THREE.Mesh(m.geometry, bodyMat);
      mesh.frustumCulled = false;
      // The hologram is drawn at the row's modelScale, exactly as placed.js
      // draws the placed object: a preview at a different size to the thing it
      // previews is the same lie as a preview at a different pose.
      const scale = scaleOf(item);
      const off = seatOffset(models, item);
      holder.position.set(off.x, off.y, off.z);
      holder.scale.setScalar(scale);
      holder.add(mesh);
      currentModel = item.model;
    }
    const h = item.collider.half;
    outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(h[0] * 2, h[1] * 2, h[2] * 2)),
      lineMat
    );
    outline.frustumCulled = false;
    root.add(outline);
  }

  // The whole contract of this file: copy the resolved pose in, change nothing.
  function show(item, placement) {
    setItem(item);
    if (!item || !placement) { root.visible = false; return; }
    root.position.set(placement.position.x, placement.position.y, placement.position.z);
    root.quaternion.set(
      placement.quaternion.x, placement.quaternion.y, placement.quaternion.z, placement.quaternion.w
    );
    const col = placement.valid ? config.build.ghostValidColor : config.build.ghostInvalidColor;
    bodyMat.color.setHex(col);
    lineMat.color.setHex(col);
    root.visible = true;
    root.updateMatrixWorld(true);
  }

  function hide() {
    root.visible = false;
  }

  // Read back from the scene graph, not from the arguments we were handed.
  function pose() {
    root.updateMatrixWorld(true);
    root.matrixWorld.decompose(_p, _q, _s);
    return {
      position: { x: _p.x, y: _p.y, z: _p.z },
      quaternion: { x: _q.x, y: _q.y, z: _q.z, w: _q.w },
      visible: root.visible,
      model: currentModel,
    };
  }

  return {
    root,
    show,
    hide,
    pose,
    item: () => currentItem,
    visible: () => root.visible,
    dispose() {
      if (outline) outline.geometry.dispose();
      bodyMat.dispose();
      lineMat.dispose();
      scene.remove(root);
    },
  };
}

export default createGhost;
