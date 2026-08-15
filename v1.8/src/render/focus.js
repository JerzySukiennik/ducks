// What the crosshair is on: an outline around it and its name under it.
//
// Two rules from G0 shape this file, and neither is negotiable.
//
//   The LABEL is a DOM element positioned by projecting a world point. The game
//   renders into a 480-pixel backbuffer, so any text drawn into the world -- a
//   sprite, a canvas texture, a plane -- arrives on screen as mush. The avatar
//   nicknames already work this way; this is the same mechanism.
//
//   The OUTLINE is an inverted hull, not a post-processing pass. There is no
//   composer in this project and there is not going to be one. The target's own
//   geometry is drawn back-faces-only, pushed out along its normals in CLIP
//   space so the rim is a fixed number of screen pixels wide however far away
//   the object is; the object's own front faces then depth-reject everything but
//   that rim. It costs exactly one draw call while something is focused and
//   zero when nothing is.
//
// Picking is deliberately NOT one big Raycaster sweep of the scene. Placed
// buildings and dropped props already have exact oriented-box ray tests in
// placed.js, and re-testing 300 instanced duck triangles every frame to find out
// what a player is looking at would be the most expensive thing in the frame.
// Each source is asked the cheapest question that answers it and the nearest
// hit wins.

import * as THREE from 'three';
import config from '../config.js';

const OUTLINE_VERT = /* glsl */`
uniform float uWidth;
uniform vec2 uResolution;
void main() {
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vec2 nc = (projectionMatrix * vec4(n, 0.0)).xy;
  float len = length(nc);
  if (len > 1e-5) {
    // clip.w restores the perspective divide, so the offset is uWidth pixels on
    // screen at any depth instead of shrinking with distance.
    clip.xy += (nc / len) * uWidth * 2.0 * clip.w / uResolution;
  }
  gl_Position = clip;
}
`;

const OUTLINE_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
void main() { gl_FragColor = vec4(uColor, uOpacity); }
`;

const CSS = `
#focus-label { position: fixed; left: 0; top: 0; z-index: 11; pointer-events: none;
  display: none; transform: translate(-50%, -50%); white-space: nowrap;
  padding: 3px 9px; background: rgba(8,12,26,0.72);
  border: 1px solid rgba(255,225,74,0.5); color: #ffe9a8;
  font: 700 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-shadow: 0 2px 0 rgba(0,0,0,0.6); }
#focus-label.show { display: block; }
#focus-label em { font-style: normal; color: rgba(232,238,255,0.6); font-weight: 500; }
`;

const _ray = new THREE.Raycaster();
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _anchor = new THREE.Vector3();
const _box = new THREE.Box3();

export function createFocus({ scene, container, sources }) {
  const f = config.focus;

  const style = document.createElement('style');
  style.id = 'focus-style';
  style.textContent = CSS;
  document.head.appendChild(style);

  const label = document.createElement('div');
  label.id = 'focus-label';
  (container || document.body).appendChild(label);

  const material = new THREE.ShaderMaterial({
    vertexShader: OUTLINE_VERT,
    fragmentShader: OUTLINE_FRAG,
    uniforms: {
      uWidth: { value: f.outlineWidth },
      uResolution: { value: new THREE.Vector2(480, 270) },
      uColor: { value: new THREE.Color(f.outlineColor) },
      uOpacity: { value: f.outlineOpacity },
    },
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    fog: false,
  });

  // One mesh, reused: its geometry is swapped to whatever is focused. A pool of
  // outline meshes would be a draw call each; this is always one or none.
  const outline = new THREE.Mesh(new THREE.BufferGeometry(), material);
  outline.name = 'focusOutline';
  outline.frustumCulled = false;
  outline.matrixAutoUpdate = false;
  outline.renderOrder = 6;
  outline.visible = false;
  // The rim is the target's own back faces pushed out in VIEW space, so it is a
  // different shape from every angle and is not a solid object at all. It must
  // never reach the shadow pass -- the target standing inside it already casts.
  outline.userData.noShadow = true;
  scene.add(outline);

  let current = null;      // { key, name, sub, distance }
  let stable = 0;
  let lastKey = '';

  // --- picking ---------------------------------------------------------------

  // A placed object. Most of them ARE the interactive thing -- a wall is a wall
  // and demolishing it acts on the whole wall -- so the whole model outlines.
  //
  // A row that declares `interact` is the exception and it is handled here
  // rather than in placed.js, because it is the same rule as the starter
  // workbench's: only the named PART of the model may light up. A bought
  // workbench is an instance of the same crank model, and outlining its cabinet
  // promises a button the cabinet does not have.
  //
  // The box hit is therefore DROPPED for such a row -- never softened to "outline
  // the whole model anyway", which is precisely the wrong promise this exists to
  // stop -- and the part is offered separately by `sources.placedInteract`, which
  // runs the part's own aim test (for the workbench, the same `placed.crankAim`
  // sphere the crank click uses) and hands back the part's geometry and pose.
  // While that seam is absent the machine simply never outlines, which is the
  // safe end of the trade.
  function pickPlaced(a, range) {
    if (!sources.placed) return null;
    const hit = sources.placed.raycast(a.origin, a.dir, range);
    if (!hit) return null;
    const rec = hit.object;
    const row = sources.rowOf ? sources.rowOf(rec.id) : null;
    if (row && row.interact) return null;
    rec.pool.get(rec.slot, _m);
    return {
      key: 'b' + rec.key,
      name: rec.name,
      sub: 'built',
      distance: hit.distance,
      geometry: rec.pool.mesh.geometry,
      matrix: _m.clone(),
    };
  }

  // The interactive PART of a placed machine, offered independently of the
  // object's collider box because the part can stand proud of it.
  function pickPlacedPart(a, range) {
    if (!sources.placedInteract) return null;
    const p = sources.placedInteract(a, range);
    if (!p || !p.pool || !(p.slot >= 0) || !(p.distance >= 0)) return null;
    p.pool.get(p.slot, _m);
    return {
      key: 'i' + p.key,
      name: p.name,
      sub: p.hint || null,
      distance: p.distance,
      geometry: p.pool.mesh.geometry,
      matrix: _m.clone(),
      // A bought workbench's wheel spins exactly like the starter one's, so it
      // needs the same still point to hang its name on.
      anchor: p.anchor || null,
    };
  }

  function pickProp(a, range) {
    if (!sources.placed) return null;
    const hit = sources.placed.raycastProps(a.origin, a.dir, range);
    if (!hit) return null;
    const rec = hit.prop;
    rec.pool.get(rec.slot, _m);
    return {
      key: 'p' + rec.key,
      name: rec.name,
      sub: 'press E',
      distance: hit.distance,
      geometry: rec.pool.mesh.geometry,
      matrix: _m.clone(),
    };
  }

  // Ducks are instanced, and three.js's own InstancedMesh.raycast is the wrong
  // tool here for a reason worth writing down: it culls against
  // `mesh.boundingSphere`, which it computes ONCE and never invalidates. The
  // duck pool's instance matrices are rewritten every frame, and at boot the
  // mesh has count 0, so that sphere is computed empty and every later ray is
  // rejected before a triangle is ever tested. The symptom is not an error, it
  // is a duck you can stand on top of and never name.
  //
  // So the test is done here: one ray/sphere against each live instance, read
  // straight off the instance matrix that is on screen this frame. 300 sphere
  // tests cost less than one triangle pass and there is no cached bound to go
  // stale.
  function pickDuck(a, camera, range) {
    const mesh = sources.duckMesh;
    if (!mesh || !mesh.count) return null;
    const geo = mesh.geometry;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const baseRadius = geo.boundingSphere.radius * f.duckPickRadiusScale;
    const dl = Math.hypot(a.dir.x, a.dir.y, a.dir.z) || 1;
    const dx = a.dir.x / dl;
    const dy = a.dir.y / dl;
    const dz = a.dir.z / dl;
    let bestT = range;
    let bestSlot = -1;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, _m);
      const e = _m.elements;
      // A hidden slot is scaled to zero; its radius collapses with it.
      const scale = Math.hypot(e[0], e[1], e[2]);
      if (!(scale > 0)) continue;
      const r = baseRadius * scale;
      const mx = e[12] - a.origin.x;
      const my = e[13] - a.origin.y;
      const mz = e[14] - a.origin.z;
      const t = mx * dx + my * dy + mz * dz;
      if (t < 0 || t >= bestT) continue;
      const px = mx - dx * t;
      const py = my - dy * t;
      const pz = mz - dz * t;
      if (px * px + py * py + pz * pz > r * r) continue;
      bestT = t;
      bestSlot = i;
    }
    if (bestSlot < 0) return null;
    const id = sources.duckOfSlot ? sources.duckOfSlot(bestSlot) : -1;
    const pose = id >= 0 && sources.duckPose ? sources.duckPose(id) : null;
    const tier = pose ? pose.tier : 0;
    const mul = sources.tierMultiplier ? sources.tierMultiplier(tier) : 1;
    mesh.getMatrixAt(bestSlot, _m);
    return {
      key: 'd' + id,
      name: 'Duck',
      sub: 'x' + mul,
      distance: bestT,
      geometry: geo,
      matrix: _m.clone(),
    };
  }

  // Scenery: the workbench, the booth, the vendor, the chute, the lamp. A
  // handful of plain meshes, so a Raycaster over that short list costs nothing
  // and gives the exact mesh whose geometry the outline needs.
  //
  // An outline is a PROMISE that the thing under the crosshair will answer a
  // key. Most of this list answers nothing -- you cannot press anything at a
  // lamp, a chute or the vendor's kiosk -- so every row declares `focusable`
  // and this function reads that field. It never asks which row it is looking
  // at. A row that is not focusable is still traced, because it is scenery you
  // cannot see through: it becomes an OCCLUDER, and the nearest occluder hit
  // is returned alongside the target so `pick` can throw away anything hiding
  // behind it. Skipping those meshes entirely would outline the vendor through
  // the front of his own booth.
  //
  // A row may also declare its own `aim(origin, dir)` in place of a mesh
  // raycast, returning a distance in metres or -1. The workbench wheel uses it
  // so the rim that lights up is exactly the sphere the crank click tests --
  // one test, not two that agree until they do not.
  function pickScenery(a, camera, range) {
    const out = { target: null, block: Infinity };
    const list = sources.sceneryMeshes ? sources.sceneryMeshes() : null;
    if (!list || !list.length) return out;
    _ray.set(_origin.set(a.origin.x, a.origin.y, a.origin.z),
      _dir.set(a.dir.x, a.dir.y, a.dir.z).normalize());
    _ray.far = range;
    _ray.near = 0;
    _ray.camera = camera;
    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      if (!entry.mesh || !entry.mesh.geometry) continue;
      let distance = -1;
      if (typeof entry.aim === 'function') {
        distance = entry.aim(a.origin, _dir);
      } else {
        const hits = _ray.intersectObject(entry.mesh, false);
        if (hits.length) distance = hits[0].distance;
      }
      if (!(distance >= 0) || distance > range) continue;
      if (!entry.focusable) {
        if (distance < out.block) out.block = distance;
        continue;
      }
      if (out.target && distance >= out.target.distance) continue;
      entry.mesh.updateWorldMatrix(true, false);
      out.target = {
        key: 's' + entry.name,
        name: entry.name,
        sub: entry.sub || null,
        distance,
        geometry: entry.mesh.geometry,
        matrix: entry.mesh.matrixWorld.clone(),
        // A spinning part hangs its label on a still one; see update().
        anchor: entry.anchor || null,
      };
    }
    return out;
  }

  function pick(a, camera) {
    let best = null;
    const take = (t) => { if (t && (!best || t.distance < best.distance)) best = t; };
    const scenery = pickScenery(a, camera, f.range);
    take(pickPlaced(a, f.range));
    take(pickPlacedPart(a, f.range));
    take(pickProp(a, f.range));
    take(scenery.target);
    take(pickDuck(a, camera, f.duckRange));
    // Solid scenery in front of the winner means the player is looking at the
    // scenery, not at what is behind it.
    if (best && scenery.block < best.distance) return null;
    return best;
  }

  // --- drawing ---------------------------------------------------------------

  function hide() {
    outline.visible = false;
    label.classList.remove('show');
    current = null;
    lastKey = '';
    stable = 0;
  }

  // The rim is authored in BACKBUFFER pixels, which means its thickness on the
  // player's screen changes with the buffer -- at 320 into a 2560 px window one
  // buffer pixel is an 8 px block, so a 2.6 px rim drew a 21 px slab. That is
  // the "very thick outlines" half of the host-only complaint. Scaling the width
  // with the buffer keeps the rim the SAME thickness on screen at every
  // resolution, which is what a constant in the config is supposed to mean.
  const REFERENCE_WIDTH = 480;
  function setResolution(w, h) {
    const bw = Math.max(1, w);
    material.uniforms.uResolution.value.set(bw, Math.max(1, h));
    material.uniforms.uWidth.value = f.outlineWidth * (bw / REFERENCE_WIDTH);
  }

  // `enabled` is how the shop, the build hologram and the demolish mode switch
  // the whole thing off: naming a wall you are about to delete is noise on top
  // of the mode's own colour.
  function update(camera, aim, enabled) {
    if (enabled === false || !aim) { hide(); return null; }
    const target = pick(aim, camera);
    if (!target) { hide(); return null; }

    // Sticky: a target has to survive a couple of frames before its name goes
    // up, so sweeping the crosshair over a crowd of ducks does not strobe.
    if (target.key === lastKey) stable++;
    else { lastKey = target.key; stable = 0; }

    outline.geometry = target.geometry;
    outline.matrix.copy(target.matrix);
    outline.matrixWorldNeedsUpdate = true;
    outline.visible = true;

    if (stable < f.stickyFrames) {
      label.classList.remove('show');
      current = target;
      return target;
    }

    // The anchor is the top of the thing, in world space, taken from its own
    // geometry rather than from a per-source height field: the three sources
    // put their origin in three different places (a placed box is centred, a
    // scenery mesh stands on its base, a duck hangs off its collider centre) and
    // a single number could only ever be right for one of them.
    //
    // EXCEPT when the target ANIMATES. That bounding box is the geometry's, run
    // through the target's live world matrix, so a part that SPINS drags its own
    // label up and down with it once per revolution -- which is exactly what the
    // workbench wheel did the moment the crank became a hold and the wheel
    // started turning fast (reported from a playtest: "the label jumps up and
    // down while cranking"). A source that knows its part moves may therefore
    // declare a FIXED world point to hang the name on, and this prefers it. It
    // is a point, not an offset: the source is the only thing that knows which
    // part of itself stands still.
    const fixed = typeof target.anchor === 'function' ? target.anchor() : target.anchor;
    if (fixed) {
      _anchor.set(fixed.x, fixed.y, fixed.z);
    } else {
      if (!target.geometry.boundingBox) target.geometry.computeBoundingBox();
      _box.copy(target.geometry.boundingBox).applyMatrix4(target.matrix);
      _anchor.set((_box.min.x + _box.max.x) / 2, _box.max.y + f.labelClearance,
        (_box.min.z + _box.max.z) / 2);
    }
    _anchor.project(camera);
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (_anchor.z > 1 || Math.abs(_anchor.x) > 1.2 || Math.abs(_anchor.y) > 1.2) {
      label.classList.remove('show');
    } else {
      label.style.left = ((_anchor.x * 0.5 + 0.5) * w).toFixed(1) + 'px';
      label.style.top = ((-_anchor.y * 0.5 + 0.5) * h).toFixed(1) + 'px';
      const t = Math.min(1, target.distance / f.labelMaxDistance);
      label.style.opacity = (1 - t * (1 - f.labelMinOpacity)).toFixed(3);
      label.innerHTML = target.sub
        ? escapeHtml(target.name) + ' <em>' + escapeHtml(target.sub) + '</em>'
        : escapeHtml(target.name);
      label.classList.add('show');
    }
    current = target;
    return target;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
    ));
  }

  return {
    outline,
    update,
    setResolution,
    hide,
    labelVisible: () => label.classList.contains('show'),
    labelText: () => (label.classList.contains('show') ? label.textContent : ''),
    labelRect: () => label.getBoundingClientRect(),
    outlineVisible: () => outline.visible,
    target: () => (current ? { name: current.name, sub: current.sub, key: current.key, distance: current.distance } : null),
    dispose() {
      scene.remove(outline);
      material.dispose();
      if (label.parentNode) label.parentNode.removeChild(label);
      if (style.parentNode) style.parentNode.removeChild(style);
    },
  };
}

export default createFocus;
