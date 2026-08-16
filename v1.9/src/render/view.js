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

// The boundary: a ring of plain slabs standing beyond the plate's far corner,
// merged into ONE geometry so the whole horizon is one draw call.
//
// Why geometry at all, when there is fog: fog softens the plate's edge but it
// cannot remove it. However faint that last row of concrete gets, it is still
// concrete with sky above it, and a straight line across the frame is the first
// thing the eye locks onto. The only cure is to put something behind it.
//
// The slabs are deliberately dumb -- axis-aligned boxes, no tops, no detail. At
// 132 m through 88% fog they are 2-3 px wide each and detail would be a lie;
// what carries is the varied SKYLINE, so only the heights and widths are
// randomised. Seeded, so it is the same horizon every session and does not
// shimmer differently for the host and the client.
function horizonGeometry() {
  const h = config.world.horizon;
  const R = h.radius;
  const segs = Math.max(8, Math.round(h.segments));
  const pos = [];
  // The same xorshift the model generator uses, so "seeded" means seeded and
  // not "whatever Math.random did this boot".
  let s = (h.seed >>> 0) || 1;
  const rnd = () => {
    s ^= (s << 13) >>> 0; s >>>= 0;
    s ^= s >>> 17;
    s ^= (s << 5) >>> 0; s >>>= 0;
    return s / 4294967296;
  };

  // Two triangles per visible face. Only the INWARD face is built: the player
  // can never get outside the ring, so the other three are triangles nobody can
  // see and the vertex shader would still pay for.
  function quad(ax, az, bx, bz, y0, y1) {
    pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz);
    pos.push(ax, y0, az, bx, y1, bz, ax, y1, az);
  }

  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    // Shrink each slab towards its own centre so the ring has gaps in it and
    // reads as separate structures rather than as one continuous wall.
    const pad = (1 - h.fill) * 0.5;
    const s0 = a0 + (a1 - a0) * pad;
    const s1 = a1 - (a1 - a0) * pad;
    // Squared, so short slabs are common and tall ones are rare -- a flat
    // distribution gives an evenly bumpy rim that reads as noise, not skyline.
    const t = rnd() * rnd();
    const top = h.minHeight + (h.maxHeight - h.minHeight) * t;
    // A little depth variation, so the rim is not one clean arc.
    const r = R * (0.985 + rnd() * 0.03);
    quad(Math.cos(s0) * r, Math.sin(s0) * r, Math.cos(s1) * r, Math.sin(s1) * r, 0, top);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  return g;
}

// Shared by view.add() and by the render modules that put their meshes in the
// scene themselves (props.js, placed.js, avatars.js). An InstancedMesh casts
// per instance, so setting the flag on the pool covers every duck in it.
export function applyShadowFlags(root, opts = {}) {
  const cast = opts.cast !== false;
  const receive = opts.receive !== false;
  // A flagged ROOT excuses its whole subtree, which is how the ghost and the
  // held-item rig opt out with one line at the group they already build.
  if (root.userData && root.userData.noShadow) {
    root.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      o.castShadow = false;
      o.receiveShadow = false;
    });
    return root;
  }
  root.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    if (o.userData && o.userData.noShadow) {
      o.castShadow = false;
      o.receiveShadow = false;
      return;
    }
    o.castShadow = cast;
    o.receiveShadow = receive;
  });
  return root;
}

export function createView(aspect) {
  const w = config.world;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(w.skyColor);
  // FogExp2, not Fog. A linear fog does nothing at all inside its near plane and
  // then ramps at a fixed rate, which over a square plate means the fade depends
  // on which way you are facing -- 27% at the edge dead ahead, 76% at a corner.
  // The exponential curve has no planes in it, so distance reads as distance
  // everywhere, including across the 35 m walk. Density is set in config.render.
  scene.fog = new THREE.FogExp2(config.render.fogColor, config.render.fogDensity);

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

  // The boundary. Unlit and unfogged on purpose, both for the same reason as
  // the pit shaft: it is a painted backdrop, not an object in the world. Lit, it
  // would flicker as the shadow box slid past it; fogged, it would dissolve into
  // exactly the colour it is supposed to stand out from. Its darkness is its
  // own, and it is drawn before everything so it can never occlude anything.
  let horizon = null;
  if (config.world.horizon.enabled) {
    horizon = new THREE.Mesh(horizonGeometry(), new THREE.MeshBasicMaterial({
      color: config.world.horizon.color,
      side: THREE.DoubleSide,
      fog: false,
      depthWrite: false,
    }));
    horizon.name = 'horizon';
    horizon.renderOrder = -9;   // after the sky dome (-10), before the plate
    horizon.frustumCulled = false;
    horizon.userData.noShadow = true;
    scene.add(horizon);
  }

  const plate = new THREE.Mesh(plateGeometry(), concrete());
  plate.name = 'plate';
  // The plate is the shadow catcher. It never casts: it is a flat slab whose
  // only face points at the light, so a cast pass over it draws 180 m of
  // geometry that can shadow nothing.
  plate.receiveShadow = true;
  scene.add(plate);

  // decalMaterial() builds the atlas and fills DECAL_UV, so it must run before
  // the geometry that reads those rects.
  const decalMat = decalMaterial();
  const decals = new THREE.Mesh(decalGeometry(), decalMat);
  decals.name = 'decals';
  decals.renderOrder = 1;
  // The paint is on the floor, so it darkens with the floor. Without this the
  // hazard ring stays fully lit inside a shadow and reads as a light source.
  decals.receiveShadow = true;
  scene.add(decals);

  // The fill light, and therefore the COLOUR OF EVERY SHADOW in the game: a
  // shadowed surface is lit by this and nothing else. Both colours used to be
  // literals here; they are config now because they are a palette decision, not
  // a renderer detail. See world.hemiSkyColor for why the sky half stopped being
  // blue.
  const hemi = new THREE.HemisphereLight(w.hemiSkyColor, w.hemiGroundColor, w.hemiIntensity);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(w.sunColor, w.sunIntensity);
  sun.position.set(w.sunDir.x, w.sunDir.y, w.sunDir.z).multiplyScalar(60);
  scene.add(sun);
  scene.add(sun.target);

  // --- the fitted shadow camera ---------------------------------------------
  //
  // A directional light shadows through an ORTHOGRAPHIC camera, and the whole
  // question is how much world that camera is asked to cover. Stretched over
  // the 180 m plate it would be 180 m / 1024 texels = 18 cm per texel and a
  // duck's entire shadow would be one texel. So it covers world.shadowRadius
  // metres around the PLAYER and travels with them: 68 m across 1024 texels is
  // 6.6 cm, a duck is three texels wide, and nothing outside that box casts --
  // which at a 480 px backbuffer is invisible anyway.
  //
  // The price of a moving shadow camera is crawling edges: slide the frustum by
  // a third of a texel and every shadow edge in the world re-rasterises. The
  // fix is to snap the frustum's centre to its own texel grid, and that grid is
  // in LIGHT space, not world space -- sunDir is (0.45, 1, 0.3), so snapping to
  // world X/Z would snap along axes the shadow map does not use. The basis is
  // built once below and the centre is projected onto it every frame.
  const shadowsOn = !!w.shadowsEnabled;
  const shadowSize = Math.max(256, Math.round(w.shadowMapSize));
  const shadowRadius = Math.max(1, w.shadowRadius);
  const shadowTexel = (shadowRadius * 2) / shadowSize;
  const lightDir = new THREE.Vector3(w.sunDir.x, w.sunDir.y, w.sunDir.z).normalize();

  // Light-space basis. zAxis points from the target back at the light, which is
  // the direction an ortho shadow camera looks down.
  const lsZ = lightDir.clone();
  const lsX = new THREE.Vector3(0, 1, 0).cross(lsZ);
  if (lsX.lengthSq() < 1e-6) lsX.set(1, 0, 0);
  lsX.normalize();
  const lsY = lsZ.clone().cross(lsX).normalize();

  if (shadowsOn) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    const sc = sun.shadow.camera;
    sc.left = -shadowRadius;
    sc.right = shadowRadius;
    sc.top = shadowRadius;
    sc.bottom = -shadowRadius;
    sc.near = 0.5;
    // The box is centred on the player and the camera sits shadowDistance up
    // the light direction, so the far plane has to clear the far corner of the
    // box as well as the shaft the ducks fall into.
    sc.far = w.shadowDistance + shadowRadius * 2 + 40;
    sc.updateProjectionMatrix();
    sun.shadow.bias = w.shadowBias;
    sun.shadow.normalBias = w.shadowNormalBias;
    // No blur radius on purpose. PSX means hard edges, and three's PCF radius
    // is a per-texel cost on every shadowed fragment on screen.
    sun.shadow.radius = 1;
  }

  const _centre = new THREE.Vector3();
  function fitShadow(x, z) {
    if (!shadowsOn) return;
    _centre.set(x, 0, z);
    const px = Math.round(_centre.dot(lsX) / shadowTexel) * shadowTexel;
    const py = Math.round(_centre.dot(lsY) / shadowTexel) * shadowTexel;
    const pz = _centre.dot(lsZ);
    _centre.set(0, 0, 0)
      .addScaledVector(lsX, px)
      .addScaledVector(lsY, py)
      .addScaledVector(lsZ, pz);
    sun.target.position.copy(_centre);
    sun.position.copy(_centre).addScaledVector(lightDir, w.shadowDistance);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
  }
  fitShadow(config.player.spawn.x, config.player.spawn.z);

  const dynamic = new Map();

  function setAspect(a) {
    camera.aspect = a;
    camera.updateProjectionMatrix();
  }

  function addBox(id, size, color) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), flat(color));
    if (shadowsOn) applyShadowFlags(mesh);
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
    // The shadow box follows the eye, not the camera's aim: turning on the spot
    // must not move a single shadow.
    fitShadow(eye.x, eye.z);
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

  // Anything handed to the scene through here casts and receives by default.
  // A caller that must not (a hologram, a view-space held model, the inside of
  // the pit shaft) sets object.userData.noShadow and says so where it is built,
  // which keeps the exception next to its reason instead of in a list here.
  function add(object) {
    if (shadowsOn) applyShadowFlags(object);
    scene.add(object);
    return object;
  }

  function dispose() {
    scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    dynamic.clear();
  }

  return {
    scene, camera, setAspect, updateCamera, addBox, setPose, add, aim,
    plate, decals, sky, horizon, blackHole, dispose,
    sun, hemi,
    shadowsEnabled: shadowsOn,
    shadowInfo: () => ({
      enabled: shadowsOn,
      mapSize: shadowSize,
      radius: shadowRadius,
      metresPerTexel: +shadowTexel.toFixed(4),
      centerX: sun.target.position.x,
      centerZ: sun.target.position.z,
    }),
  };
}
