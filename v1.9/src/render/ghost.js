// The placement hologram. It renders resolvePlacement()'s output and nothing
// else: no offset of its own, no second opinion about where the object goes.
// pose() reads the transform back out of the scene graph, so verification
// compares what is actually on screen against what physics actually received.
//
// It also draws what the thing will DO once it is down -- see the hint section
// at the bottom. Same rule as the pose: the hint is drawn from the row's own
// data and, for a fan, in the frame the FORCE uses, so aiming a fan is reading
// rather than guessing.

import * as THREE from 'three';
import config from '../config.js';
import { seatOffset, scaleOf, ensureRotor } from './placed.js';
import { shapeOf, outlineGeometry, blowDirection, setBlowQuaternion } from './airflow.js';

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _hintQ = new THREE.Quaternion();
const DEG = Math.PI / 180;

export function createGhost({ scene, models }) {
  const root = new THREE.Group();
  root.name = 'ghost';
  root.visible = false;
  root.renderOrder = 3;
  // A hologram of a wall that has not been built yet must not drop a shadow of
  // a wall that has not been built yet. Flagged rather than merely left at
  // three's default, so a later shadow sweep over the scene cannot pick it up.
  root.userData.noShadow = true;
  scene.add(root);

  // The hint lives in its own group in WORLD space rather than under the
  // hologram. The two frames now agree -- the sim was corrected to three's own
  // Y-rotation, so blowers.js drives the force off (sin yaw, cos yaw) and the
  // mesh is yawed the same way -- but the hint still takes its pose from
  // blowDirection() rather than from the model's parent, because the ONE
  // failure this hint exists to prevent is a cone that agrees with the picture
  // and disagrees with the physics. Inheriting the model's transform would make
  // that failure undetectable; asking for the physics frame keeps it a test.
  // See streamCheck() in placed.js for the same test on a placed fan.
  const hints = new THREE.Group();
  hints.name = 'ghostHints';
  hints.visible = false;
  hints.renderOrder = 3;
  hints.userData.noShadow = true;
  scene.add(hints);

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
  const hintMat = new THREE.LineBasicMaterial({
    color: config.build.ghostValidColor,
    transparent: true,
    opacity: config.render.hint.opacity,
    depthTest: false,
    fog: false,
  });

  const holder = new THREE.Group();
  root.add(holder);
  let mesh = null;
  let outline = null;
  let currentModel = null;
  let currentItem = null;
  let hint = null;          // { lines, kind, place(placement) }

  function setItem(item) {
    if (item === currentItem) return;
    currentItem = item;
    if (mesh) { holder.remove(mesh); mesh = null; }
    if (outline) { root.remove(outline); outline.geometry.dispose(); outline = null; }
    clearHint();
    if (!item) { root.visible = false; hints.visible = false; currentModel = null; return; }

    // Split the blades out before the geometry is read, so a fan that has never
    // been placed yet still ends up with a body pool that has no blades in it.
    // The hologram itself draws the model WHOLE -- one mesh, blades included --
    // because a hologram is a picture of the object, not of its parts.
    ensureRotor(models, item);
    const m = models[item.model];
    const geo = m && (m.fullGeometry || m.geometry);
    if (geo) {
      mesh = new THREE.Mesh(geo, bodyMat);
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
    buildHint(item);
  }

  // The whole contract of this file: copy the resolved pose in, change nothing.
  function show(item, placement) {
    setItem(item);
    if (!item || !placement) { root.visible = false; hints.visible = false; return; }
    root.position.set(placement.position.x, placement.position.y, placement.position.z);
    root.quaternion.set(
      placement.quaternion.x, placement.quaternion.y, placement.quaternion.z, placement.quaternion.w
    );
    const col = placement.valid ? config.build.ghostValidColor : config.build.ghostInvalidColor;
    bodyMat.color.setHex(col);
    lineMat.color.setHex(col);
    hintMat.color.setHex(col);
    root.visible = true;
    root.updateMatrixWorld(true);
    if (hint) {
      hint.place(placement);
      hints.visible = true;
      hints.updateMatrixWorld(true);
    } else {
      hints.visible = false;
    }
  }

  function hide() {
    root.visible = false;
    // The hint goes with it, in the same call: a cone left hanging in the air
    // over a spot the player is no longer aiming at is worse than no hint.
    hints.visible = false;
  }

  // --- what the thing will do --------------------------------------------------
  //
  // One branch per KIND, and every branch reads the row it was handed: the
  // blower's cone is `blow`, the conveyor's path is `belt`, the collector's
  // circle is `collect.radius`. A row with none of those simply gets no hint,
  // which is why adding a hint for a new kind is one entry here and nothing
  // anywhere else.

  function clearHint() {
    if (!hint) return;
    hints.remove(hint.lines);
    hint.lines.geometry.dispose();
    hint = null;
  }

  function addLines(geometry) {
    const lines = new THREE.LineSegments(geometry, hintMat);
    lines.frustumCulled = false;
    hints.add(lines);
    return lines;
  }

  // A blower: the cone the wind actually occupies, in the frame the FORCE uses.
  function blowerHint(item) {
    const shape = shapeOf(item);
    if (!shape) return null;
    const lines = addLines(outlineGeometry(shape));
    return {
      lines,
      kind: 'blow',
      place(placement) {
        lines.position.set(placement.position.x, placement.position.y, placement.position.z);
        setBlowQuaternion(_hintQ, placement.yaw, shape.pitch);
        lines.quaternion.copy(_hintQ);
      },
      // For verification: the axis this hint is drawn along.
      direction: (yaw) => blowDirection(yaw, shape.pitch),
      shape,
    };
  }

  // A conveyor: the path a duck takes across it. Sampled the way
  // conveyors.beltVelocity() computes the drive direction -- yaw plus the row's
  // `turn` scaled by how far across the piece the duck has got -- so a corner
  // hint bends exactly as a corner carries.
  function conveyorHint(item) {
    const H = config.render.hint;
    const belt = item.belt;
    const hz = item.collider.half[2];
    // A hand's width above the belt surface, not on it: at the buffer's 480 px
    // a line lying exactly on the deck disappears into the hologram's own
    // wireframe, which is the one thing this hint must not do.
    const hy = item.collider.half[1] + H.pathLift;
    const turn = (belt.turn || 0) * DEG;
    const samples = Math.max(2, Math.round(H.pathSamples));
    const pos = [];
    // The path, in the belt's own frame: start at the back edge and step
    // forward, turning as the belt turns.
    const pts = [];
    let x = 0;
    let z = -hz;
    for (let i = 0; i <= samples; i++) {
      pts.push([x, z]);
      const t = i / samples;
      const a = turn * t;
      const step = (2 * hz) / samples;
      x += Math.sin(a) * step;
      z += Math.cos(a) * step;
    }
    for (let i = 0; i < pts.length - 1; i++) {
      pos.push(pts[i][0], hy, pts[i][1], pts[i + 1][0], hy, pts[i + 1][1]);
    }
    // Chevrons along it: an arrow says which END, a line does not.
    const n = Math.max(1, Math.round(H.chevrons));
    for (let c = 1; c <= n; c++) {
      const i = Math.min(pts.length - 2, Math.round((c / (n + 1)) * (pts.length - 1)));
      const dx = pts[i + 1][0] - pts[i][0];
      const dz = pts[i + 1][1] - pts[i][1];
      const l = Math.hypot(dx, dz) || 1;
      const fx = dx / l, fz = dz / l;
      const sx = -fz, sz = fx;
      const k = H.chevronSize;
      const px = pts[i][0], pz = pts[i][1];
      pos.push(px + fx * k, hy, pz + fz * k, px + sx * k * 0.8, hy, pz + sz * k * 0.8);
      pos.push(px + fx * k, hy, pz + fz * k, px - sx * k * 0.8, hy, pz - sz * k * 0.8);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    const lines = addLines(g);
    return {
      lines,
      kind: 'belt',
      place(placement) {
        lines.position.set(placement.position.x, placement.position.y, placement.position.z);
        // Belt travel is (-sin yaw, cos yaw) -- conveyors.beltVelocity() -- and
        // this geometry is authored along +Z, so it takes the same
        // sign-corrected turn the airstream does.
        setBlowQuaternion(_hintQ, placement.yaw, 0);
        lines.quaternion.copy(_hintQ);
      },
    };
  }

  // A collector: the circle it pulls ducks out of, on the floor where the ducks
  // are rather than at the hub height where the machine is.
  function collectorHint(item) {
    const H = config.render.hint;
    const r = item.collect.radius;
    if (!(r > 0)) return null;
    const segs = Math.max(8, Math.round(H.circleSegments));
    const pos = [];
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      pos.push(Math.cos(a0) * r, 0, Math.sin(a0) * r, Math.cos(a1) * r, 0, Math.sin(a1) * r);
    }
    // Four ticks pointing inwards: the circle is a catchment, not a fence.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r,
        Math.cos(a) * r * 0.78, 0, Math.sin(a) * r * 0.78);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    const lines = addLines(g);
    const hy = item.collider.half[1];
    return {
      lines,
      kind: 'collect',
      place(placement) {
        // On the floor: the placement Y is the box centre, so drop by its own
        // half-height and lift a few centimetres clear of z-fighting.
        lines.position.set(
          placement.position.x,
          placement.position.y - hy + config.render.hint.circleLift,
          placement.position.z
        );
        lines.quaternion.set(0, 0, 0, 1);
      },
    };
  }

  function buildHint(item) {
    if (!item) return;
    if (item.kind === 'blower' && item.blow) hint = blowerHint(item);
    else if (item.kind === 'conveyor' && item.belt) hint = conveyorHint(item);
    else if (item.collect && item.collect.radius) hint = collectorHint(item);
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

  // The hint as it stands on screen, for verification: what it is, whether it
  // is drawn, and -- for a blower -- the axis it is drawn along read back out of
  // the scene graph against the axis blowers.js pushes along.
  function hintPose() {
    if (!hint) return { kind: null, visible: false };
    hints.updateMatrixWorld(true);
    hint.lines.updateMatrixWorld(true);
    hint.lines.matrixWorld.decompose(_p, _q, _s);
    const drawn = new THREE.Vector3(0, 0, 1).applyQuaternion(_q);
    const out = {
      kind: hint.kind,
      visible: hints.visible,
      position: { x: _p.x, y: _p.y, z: _p.z },
      drawn: { x: drawn.x, y: drawn.y, z: drawn.z },
    };
    if (hint.kind === 'blow') {
      out.shape = {
        range: hint.shape.range,
        coneDegrees: hint.shape.cone / DEG,
        aperture: hint.shape.aperture,
        pitchDegrees: hint.shape.pitch / DEG,
        hubHeight: hint.shape.hubHeight,
      };
      // The far end of the drawn outline, in world space -- what "the length
      // shown" actually is, read back out of the scene graph rather than
      // recomputed.
      const tip = new THREE.Vector3(0, 0, hint.shape.range).applyMatrix4(hint.lines.matrixWorld);
      out.tip = { x: tip.x, y: tip.y, z: tip.z };
    }
    return out;
  }

  return {
    root,
    hints,
    show,
    hide,
    pose,
    hintPose,
    item: () => currentItem,
    visible: () => root.visible,
    hintVisible: () => hints.visible,
    dispose() {
      if (outline) outline.geometry.dispose();
      clearHint();
      bodyMat.dispose();
      lineMat.dispose();
      hintMat.dispose();
      scene.remove(root);
      scene.remove(hints);
    },
  };
}

export default createGhost;
