// Static props: the pit mouth and the duck tube. Each is one vertex-coloured
// mesh, so the whole set costs four draw calls.
//
// The pit has to read as a hole rather than a dark disc. That needs three
// things a flat circle cannot give: a rim standing proud of the floor, an
// interior wall whose perspective you can see down, and a shaft that darkens
// with depth so the bottom never resolves.

import * as THREE from 'three';
import config from '../config.js';

export function propMaterial() {
  return new THREE.MeshLambertMaterial({
    color: 0xffffff,
    vertexColors: true,
    flatShading: true,
  });
}

// Open cylinder seen from the inside, shaded from the rim down to black. Three
// depth cues are baked into the vertex colours, because from standing height
// only the top metre or so of the far wall is ever visible: a fast fade to
// black, vertical ribs whose perspective convergence says "cylinder", and
// horizontal grooves that read as courses of concrete going down.
function shaftGeometry() {
  const p = config.pitRender;
  const segs = Math.max(8, Math.round(p.shaftSegments));
  const depth = p.shaftDepth;
  const rings = 22;
  const positions = [];
  const colors = [];

  function inGroove(y) {
    if (!(p.ringEveryMeters > 0) || -y < 0.05) return false;
    return ((-y + 1e-4) % p.ringEveryMeters) < 0.06;
  }

  function shadeAt(y) {
    const t = Math.min(1, -y / p.fadeMeters);
    const k = p.topShade * Math.pow(1 - t, p.fadeExponent);
    return inGroove(y) ? k * p.ringShade : k;
  }

  const levels = [];
  for (let r = 0; r <= rings; r++) levels.push(-Math.pow(r / rings, 2.4) * depth);
  for (let d = p.ringEveryMeters; d < p.fadeMeters * 1.5; d += p.ringEveryMeters) {
    levels.push(-d, -d - 0.06);
  }
  levels.sort((a, b) => b - a);

  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const x0 = Math.cos(a0) * p.shaftRadius, z0 = Math.sin(a0) * p.shaftRadius;
    const x1 = Math.cos(a1) * p.shaftRadius, z1 = Math.sin(a1) * p.shaftRadius;
    // Alternating panels: without them a smooth cylinder reads as a flat disc.
    const rib = i % 2 === 0 ? 1 : 1 - p.ribContrast;
    for (let r = 0; r < levels.length - 1; r++) {
      const y0 = levels[r];
      const y1 = levels[r + 1];
      if (y1 >= y0) continue;
      const c0 = shadeAt(y0) * rib;
      const c1 = shadeAt(y1) * rib;
      // Wound so the visible face is the inside of the cylinder.
      positions.push(x0, y0, z0, x1, y0, z1, x1, y1, z1);
      colors.push(c0, c0, c0, c0, c0, c0, c1, c1, c1);
      positions.push(x0, y0, z0, x1, y1, z1, x0, y1, z0);
      colors.push(c0, c0, c0, c1, c1, c1, c1, c1, c1);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  g.computeVertexNormals();
  return g;
}

// The floor of the shaft is pure black at the far end of the fade, so it reads
// as "no bottom" rather than "a floor down there".
function shaftFloorGeometry() {
  const p = config.pitRender;
  const g = new THREE.CircleGeometry(p.shaftRadius * 1.02, Math.max(8, Math.round(p.shaftSegments)));
  g.rotateX(-Math.PI / 2);
  g.translate(0, -p.shaftDepth, 0);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export function createProps({ scene, models, pitCenter }) {
  const material = propMaterial();
  const group = new THREE.Group();
  group.name = 'props';
  scene.add(group);

  const c = pitCenter || { x: 0, y: 0, z: 0 };
  const pr = config.pitRender;

  const shaft = new THREE.Mesh(shaftGeometry(), new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.DoubleSide, fog: false,
  }));
  shaft.position.set(c.x, c.y, c.z);
  shaft.name = 'pitShaft';
  group.add(shaft);

  const shaftFloor = new THREE.Mesh(shaftFloorGeometry(), new THREE.MeshBasicMaterial({
    vertexColors: true, fog: false,
  }));
  shaftFloor.position.set(c.x, c.y, c.z);
  shaftFloor.name = 'pitFloor';
  group.add(shaftFloor);

  // No raised rim. The pit is a hole in a concrete floor, and a kerb standing
  // proud of the slab made it read as a garden pond rather than something the
  // building was poured around. The only thing marking the edge is the painted
  // hazard ring in the decal atlas, which is how a real industrial floor does
  // it. `pitRender.showRim` exists so the ring can be brought back for a
  // purchasable kerb later without resurrecting this code.
  let rim = null;
  if (pr.showRim && models.pit_rim && models.pit_rim.geometry) {
    rim = new THREE.Mesh(models.pit_rim.geometry, material);
    rim.scale.setScalar(pr.rimScale);
    rim.position.set(c.x, c.y + pr.rimY, c.z);
    rim.name = 'pitRim';
    group.add(rim);
  }

  // The tube hangs out of the darkness overhead. The model is authored standing
  // on y=0 with its open rim at the top, so it is flipped 180 degrees about X
  // and hung from a pivot high enough to put that rim at tube.mouthWorldY.
  // Nothing touches the ground: the plinth is dropped at load time.
  let tube = null;
  const t = config.tube;
  const pivotY = t.mouthWorldY + t.mouthY * t.scale + t.y;
  const tubeYaw = new THREE.Group();
  tubeYaw.name = 'tubeRig';
  tubeYaw.position.set(t.x, pivotY, t.z);
  tubeYaw.rotation.y = t.yaw;
  group.add(tubeYaw);
  if (models.tube && models.tube.geometry) {
    tube = new THREE.Mesh(models.tube.geometry, material);
    tube.scale.setScalar(t.scale);
    tube.rotation.x = t.pitchX;
    tube.name = 'tube';
    tubeYaw.add(tube);
  }
  const mouth = new THREE.Vector3(t.x, t.mouthWorldY, t.z);
  const eject = new THREE.Vector3(t.ejectX, t.ejectY, t.ejectZ).normalize();

  // Manual Duck Workbench. The wheel is a separate mesh pivoted on its hub so it
  // can turn; everything else is one static mesh.
  const m = config.machine;
  const machineGroup = new THREE.Group();
  machineGroup.name = 'machine';
  machineGroup.position.set(m.x, m.y, m.z);
  machineGroup.rotation.y = m.yaw;
  machineGroup.scale.setScalar(m.scale);
  group.add(machineGroup);

  let machineBody = null;
  let wheel = null;
  if (models.crank && models.crank.geometry) {
    machineBody = new THREE.Mesh(models.crank.geometry, material);
    machineBody.name = 'machineBody';
    machineGroup.add(machineBody);
  }
  if (models.crank && models.crank.parts && models.crank.parts.wheel) {
    const wg = models.crank.parts.wheel;
    wg.translate(-m.wheelLocalX, -m.wheelLocalY, -m.wheelLocalZ);
    wheel = new THREE.Mesh(wg, material);
    wheel.name = 'machineWheel';
    wheel.position.set(m.wheelLocalX, m.wheelLocalY, m.wheelLocalZ);
    machineGroup.add(wheel);
  }

  // Two lamp posts flanking the workbench, and an unlit amber head on each.
  //
  // This is a COMPOSITION fix, not decoration. From the player's spawn the bench
  // is 29 m away and was a dark grey box on a dark plate under a dark sky --
  // about 20 backbuffer pixels of nothing, in the one shot that has to say what
  // the game is about. The posts do three things at once: they put two verticals
  // either side of the objective, they give the eye a scale reference at that
  // distance, and their heads are the only warm points on that half of the
  // frame.
  //
  // The head is deliberately NOT lit. models.lamp_post's shade is already the
  // hazard yellow from the shared palette, but a Lambert surface 29 m away and
  // pointing at nothing in particular is just another dark shape. Swapping the
  // head to MeshBasic makes it hold its value at any distance and through any
  // amount of fog, which is what a lamp does and what a destination has to do.
  // Two extra draw calls for the pair of heads; the posts share the vertex-
  // coloured prop material with everything else in this group.
  const bl = config.world.benchLamps;
  const benchLamps = [];
  if (bl.enabled && models.lamp_post && models.lamp_post.geometry) {
    // The lamp head sits at the top of the post. Measured off the mesh rather
    // than hardcoded, so a re-authored lamp_post cannot silently leave the glow
    // floating in the air above it or buried in the pole.
    const lg = models.lamp_post.geometry;
    if (!lg.boundingBox) lg.computeBoundingBox();
    const headY = lg.boundingBox.max.y * bl.scale;

    const headMat = new THREE.MeshBasicMaterial({ color: config.world.markingColor });
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const g = new THREE.Group();
      g.name = 'benchLamp' + i;
      // Offsets are in the workbench's own frame, so moving or turning the bench
      // takes its lamps with it.
      const lx = m.x + Math.cos(m.yaw) * (side * bl.offsetX) + Math.sin(m.yaw) * bl.offsetZ;
      const lz = m.z - Math.sin(m.yaw) * (side * bl.offsetX) + Math.cos(m.yaw) * bl.offsetZ;
      g.position.set(lx, m.y, lz);
      g.rotation.y = m.yaw;
      g.scale.setScalar(bl.scale);

      const post = new THREE.Mesh(lg, material);
      post.name = 'benchLampPost' + i;
      g.add(post);

      // A small solid block where the bulb is. Octahedron rather than a sphere:
      // it is four triangles a side, it is unmistakably faceted, and at 29 m it
      // is a 2 px point of amber either way -- which is all it has to be.
      const head = new THREE.Mesh(new THREE.OctahedronGeometry(0.20), headMat);
      head.name = 'benchLampHead' + i;
      head.position.set(0, headY / bl.scale, 0);
      // It emits; it must not receive its own darkness, and a 40 cm blob casting
      // a shadow onto the bench beneath it buys nothing at this distance.
      head.userData.noShadow = true;
      g.add(head);

      group.add(g);
      benchLamps.push(g);
    }
  }

  // The vendor's booth: kiosk, the vendor standing in front of it, and a lamp.
  // Scenery only -- its solid box is registered by main.js as a collider on the
  // plate body, exactly like the workbench.
  const bo = config.booth;
  const boothGroup = new THREE.Group();
  boothGroup.name = 'booth';
  boothGroup.position.set(bo.x, bo.y, bo.z);
  boothGroup.rotation.y = bo.yaw;
  boothGroup.scale.setScalar(bo.scale);
  group.add(boothGroup);

  if (models.shop && models.shop.geometry) {
    const kiosk = new THREE.Mesh(models.shop.geometry, material);
    kiosk.name = 'boothKiosk';
    boothGroup.add(kiosk);
  }
  if (models.vendor && models.vendor.geometry) {
    const vendor = new THREE.Mesh(models.vendor.geometry, material);
    vendor.name = 'boothVendor';
    vendor.position.set(bo.vendorLocalX, bo.vendorLocalY, bo.vendorLocalZ);
    vendor.rotation.y = bo.vendorYaw;
    boothGroup.add(vendor);
  }
  if (models.lamp && models.lamp.geometry) {
    const lamp = new THREE.Mesh(models.lamp.geometry, material);
    lamp.name = 'boothLamp';
    lamp.position.set(bo.lampLocalX, bo.lampLocalY, bo.lampLocalZ);
    boothGroup.add(lamp);
  }

  // Shadows. Everything in this group is real scenery standing on the plate, so
  // it all casts and receives -- except the pit. The shaft is an inside-out
  // cylinder and its floor is a black disc 8 m down; asked to cast, the shaft
  // would drop a solid 3 m blob of shadow across the plate beside the hole,
  // which is the opposite of what a hole looks like. They are also unlit
  // (MeshBasicMaterial with baked vertex shade), so there is nothing for a
  // received shadow to darken either.
  shaft.userData.noShadow = true;
  shaftFloor.userData.noShadow = true;
  // And not the chute either, for the same kind of reason. Its vertex colours
  // fade the far end into the dark sky so it reads as coming out of somewhere
  // unseen -- but a shadow does not fade, so casting from it painted a hard
  // 20 m stain on the plate cast by a pipe whose top half is invisible.
  // MEASURED, not guessed: it was the largest thing on screen in the first
  // frame after shadows went on.
  if (tube) tube.userData.noShadow = true;
  if (config.world.shadowsEnabled) {
    group.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      const off = !!(o.userData && o.userData.noShadow);
      o.castShadow = !off;
      o.receiveShadow = !off;
    });
  }

  boothGroup.updateWorldMatrix(true, true);
  const boothCounter = new THREE.Vector3(bo.vendorLocalX, bo.vendorLocalY, bo.vendorLocalZ)
    .applyMatrix4(boothGroup.matrixWorld);

  machineGroup.updateWorldMatrix(true, true);
  const wheelWorld = new THREE.Vector3(m.wheelLocalX, m.wheelLocalY, m.wheelLocalZ)
    .applyMatrix4(machineGroup.matrixWorld);
  const pipeWorld = new THREE.Vector3(m.pipeLocalX, m.pipeLocalY, m.pipeLocalZ)
    .applyMatrix4(machineGroup.matrixWorld);
  // Local +Z is the machine's front, which is where the pipe points.
  const machineForward = new THREE.Vector3(Math.sin(m.yaw), 0, Math.cos(m.yaw)).normalize();
  // World direction of the model's local +X, i.e. the side the wheel is on.
  const machineRight = new THREE.Vector3(Math.cos(m.yaw), 0, -Math.sin(m.yaw)).normalize();
  const wheelHitRadius = m.wheelRadius * m.scale * m.hitRadiusScale;

  return {
    group,
    material,
    rim,
    tube,
    shaft,
    machine: machineGroup,
    benchLamps,
    wheel,
    tubeMouth: () => ({ x: mouth.x, y: mouth.y, z: mouth.z }),
    tubeEject: () => ({ x: eject.x, y: eject.y, z: eject.z }),
    tubeBase: () => ({ x: t.x, y: t.y, z: t.z }),
    machineBase: () => ({ x: m.x, y: m.y, z: m.z }),
    booth: boothGroup,
    boothBase: () => ({ x: bo.x, y: bo.y, z: bo.z }),
    boothCounter: () => ({ x: boothCounter.x, y: boothCounter.y, z: boothCounter.z }),
    // Distance from a point to the booth counter, in the XZ plane. main.js uses
    // it for the "press E" prompt and for the open/close range test.
    boothDistance: (p) => Math.hypot(p.x - boothCounter.x, p.z - boothCounter.z),
    wheelCenter: () => ({ x: wheelWorld.x, y: wheelWorld.y, z: wheelWorld.z }),
    wheelHitRadius: () => wheelHitRadius,
    // Ray/sphere against the wheel hub: the distance in metres, or -1 for a
    // miss. This is THE wheel aim test. The crank click and the crosshair
    // outline both read it, so the rim the player sees light up and the thing
    // the button acts on cannot drift apart -- which is exactly what happened
    // when the outline came from a raycast over the whole cabinet mesh and the
    // click came from this sphere.
    wheelAimDistance(origin, dir) {
      if (!wheel) return -1;
      // Stand-in for an occlusion test: the wheel is on one side of the
      // cabinet, so the eye has to be on that side. Without it you could crank
      // through the machine from the front, where the wheel is not visible.
      if ((origin.x - wheelWorld.x) * machineRight.x
        + (origin.z - wheelWorld.z) * machineRight.z <= 0) return -1;
      const mx = origin.x - wheelWorld.x;
      const my = origin.y - wheelWorld.y;
      const mz = origin.z - wheelWorld.z;
      const b = mx * dir.x + my * dir.y + mz * dir.z;
      const q = mx * mx + my * my + mz * mz - wheelHitRadius * wheelHitRadius;
      const disc = b * b - q;
      if (disc < 0) return -1;
      const root = Math.sqrt(disc);
      let t = -b - root;
      if (t < 0) t = -b + root;
      return (t >= 0 && t <= m.useRange) ? t : -1;
    },
    // Z, not X, and negated: the wheel moved from the machine's side to its
    // front face, so its axis moved with it. Turning the old axis now spins the
    // wheel about a line lying IN its own plane, which reads as a wobble.
    wheelAngle: () => (wheel ? -wheel.rotation.z : 0),
    setWheelAngle(a) { if (wheel) wheel.rotation.z = -a; },
    machineMouth: () => ({
      x: pipeWorld.x + machineForward.x * m.ejectOffset,
      y: pipeWorld.y,
      z: pipeWorld.z + machineForward.z * m.ejectOffset,
    }),
    machineEject: () => {
      const v = new THREE.Vector3(machineForward.x, m.ejectDrop, machineForward.z).normalize();
      return { x: v.x, y: v.y, z: v.z };
    },
    machineForward: () => ({ x: machineForward.x, y: 0, z: machineForward.z }),
    machineRight: () => ({ x: machineRight.x, y: 0, z: machineRight.z }),
    dispose() {
      group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      material.dispose();
      scene.remove(group);
    },
  };
}

export default createProps;
