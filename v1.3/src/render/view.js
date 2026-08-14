// Scene contents and the first-person camera. Draw calls are the ceiling here,
// so the whole world is a handful of meshes and every duck is one instanced mesh.

import * as THREE from 'three';
import config from '../config.js';
import { concrete, flat, skyMaterial, decalMaterial, DECAL_UV } from './materials.js';
import { createBlackHole } from './blackhole.js';

// Floor markings: three placed decals, merged into one mesh so the whole set is
// a single draw call. Everything else on the plate stays bare concrete.
function decalGeometry() {
  const d = config.decals;
  const pos = [];
  const uv = [];
  const nor = [];

  // corners: bottom-left, bottom-right, top-right, top-left in UV order.
  function quad(p0, p1, p2, p3, rect) {
    const [u0, v0, u1, v1] = rect;
    const c = [p0, p1, p2, p3];
    const t = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    const tri = [0, 1, 2, 0, 2, 3];
    for (let i = 0; i < 6; i++) {
      const k = tri[i];
      pos.push(c[k][0], d.y, c[k][1]);
      uv.push(t[k][0], t[k][1]);
      nor.push(0, 1, 0);
    }
  }

  // 1. Hazard ring around the pit mouth. One tile per segment, so the stripes
  //    come out evenly spaced with no seam to match.
  const segs = Math.max(6, Math.round(d.ringSegments));
  const cx = config.pit.centerX;
  const cz = config.pit.centerZ;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    quad(
      [cx + Math.cos(a0) * d.ringInner, cz + Math.sin(a0) * d.ringInner],
      [cx + Math.cos(a1) * d.ringInner, cz + Math.sin(a1) * d.ringInner],
      [cx + Math.cos(a1) * d.ringOuter, cz + Math.sin(a1) * d.ringOuter],
      [cx + Math.cos(a0) * d.ringOuter, cz + Math.sin(a0) * d.ringOuter],
      DECAL_UV.hazard
    );
  }

  // 2. Arrow path: from the player spawn towards the pit. v = 1 is the tip, so
  //    the quad's +v edge points at the pit (-Z from a +Z spawn).
  const sx = config.player.spawn.x;
  const hw = d.arrowWidth / 2;
  const dir = config.player.spawn.z > cz ? -1 : 1;
  for (let i = 0; i < Math.round(d.arrowCount); i++) {
    const zNear = d.arrowStartZ + dir * i * d.arrowStepZ;
    const zTip = zNear + dir * d.arrowLength;
    quad(
      [sx - hw, zNear], [sx + hw, zNear], [sx + hw, zTip], [sx - hw, zTip],
      DECAL_UV.arrow
    );
  }

  // 3. Drop zone under the overhead tube, where purchases land.
  const h = d.dropZoneSize / 2;
  quad(
    [config.tube.x - h, config.tube.z + h],
    [config.tube.x + h, config.tube.z + h],
    [config.tube.x + h, config.tube.z - h],
    [config.tube.x - h, config.tube.z - h],
    DECAL_UV.drop
  );

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
  return g;
}

// The ground is a square with a polygon hole punched at the pit, matching the
// 32-gon the colliders leave. A solid slab would hide the pit completely.
function plateGeometry() {
  const w = config.world;
  const S = w.plateSize / 2;
  const p = config.pit;
  const segs = Math.max(3, Math.round(p.segments));
  // Circumradius of the polygon whose apothem is pit.radius: the collider walls
  // sit on the apothem, so the visual hole must reach the corners.
  const R = p.radius / Math.cos(Math.PI / segs);

  const shape = new THREE.Shape();
  shape.moveTo(-S, -S);
  shape.lineTo(S, -S);
  shape.lineTo(S, S);
  shape.lineTo(-S, S);
  shape.closePath();

  const hole = new THREE.Path();
  for (let i = 0; i <= segs; i++) {
    const a = -(i / segs) * Math.PI * 2;
    const x = p.centerX + Math.cos(a) * R;
    const y = -p.centerZ + Math.sin(a) * R;
    if (i === 0) hole.moveTo(x, y); else hole.lineTo(x, y);
  }
  shape.holes.push(hole);

  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);

  // ShapeGeometry writes shape-space UVs; the concrete texture expects the same
  // 0..1 span across the plate that the previous box top face had.
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / w.plateSize + 0.5;
    uv[i * 2 + 1] = pos.getZ(i) / w.plateSize + 0.5;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

export function createView(aspect) {
  const w = config.world;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(w.skyColor);
  scene.fog = new THREE.Fog(config.render.fogColor, config.render.fogNear, config.render.fogFar);

  const camera = new THREE.PerspectiveCamera(
    config.render.fov,
    aspect,
    config.render.near,
    config.render.far
  );
  camera.rotation.order = 'YXZ';

  // The gradient dome is the backdrop the black hole hangs in front of. It is
  // opaque with depthWrite off, so it draws first and writes no depth: the
  // starfield and the lensing quad, which are transparent and therefore drawn
  // after every opaque object, are not depth-rejected by it and are still
  // occluded by the plate and by anything standing on it.
  const sky = new THREE.Mesh(new THREE.SphereGeometry(config.render.far * 0.9, 16, 10), skyMaterial());
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);

  const blackHole = createBlackHole(scene);

  const plate = new THREE.Mesh(plateGeometry(), concrete());
  plate.name = 'plate';
  scene.add(plate);

  // decalMaterial() builds the atlas and fills DECAL_UV, so it must run before
  // the geometry that reads those rects.
  const decalMat = decalMaterial();
  const decals = new THREE.Mesh(decalGeometry(), decalMat);
  decals.name = 'decals';
  decals.renderOrder = 1;
  scene.add(decals);

  const hemi = new THREE.HemisphereLight(0x9fb4d8, 0x2a2a2c, w.hemiIntensity);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(w.sunColor, w.sunIntensity);
  sun.position.set(w.sunDir.x, w.sunDir.y, w.sunDir.z).multiplyScalar(60);
  scene.add(sun);
  scene.add(sun.target);

  const dynamic = new Map();

  function setAspect(a) {
    camera.aspect = a;
    camera.updateProjectionMatrix();
  }

  function addBox(id, size, color) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), flat(color));
    scene.add(mesh);
    dynamic.set(id, mesh);
    return mesh;
  }

  function setPose(id, pose) {
    const mesh = dynamic.get(id);
    if (!mesh || !pose) return;
    mesh.position.set(pose.x, pose.y, pose.z);
    mesh.quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw);
  }

  // Takes an eye position (player.eyePosition()), not the capsule centre.
  function updateCamera(eye, yaw, pitch) {
    camera.position.set(eye.x, eye.y, eye.z);
    camera.rotation.set(pitch, yaw, 0);
    sky.position.copy(camera.position);
    blackHole.follow(camera.position);
  }

  // Camera-space aim, so the grab ray is exactly what the crosshair points at.
  const _dir = new THREE.Vector3();
  function aim() {
    camera.getWorldDirection(_dir);
    return {
      origin: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      dir: { x: _dir.x, y: _dir.y, z: _dir.z },
    };
  }

  function add(object) {
    scene.add(object);
    return object;
  }

  function dispose() {
    scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    dynamic.clear();
  }

  return {
    scene, camera, setAspect, updateCamera, addBox, setPose, add, aim,
    plate, decals, sky, blackHole, dispose,
  };
}
