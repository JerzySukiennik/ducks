// Placement maths. resolvePlacement() is the ONLY function that decides where a
// placeable object goes: the hologram renders exactly its output and the placer
// calls it again with the same inputs, so the preview cannot lie about where the
// object will land.
//
// Pure arithmetic. No three.js, no Rapier, no DOM -- src/sim stays renderer
// agnostic, and this file is testable with three numbers and an object literal.

const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;

// Reason codes. The UI maps them to text; nothing here is player-facing.
export const REASONS = {
  NO_SURFACE: 'no_surface',
  TOO_FAR: 'too_far',
  TOO_CLOSE: 'too_close',
  OUT_OF_BOUNDS: 'out_of_bounds',
  PIT: 'pit',
  BOOTH: 'booth',
  OVERLAP: 'overlap',
  NOT_PLACEABLE: 'not_placeable',
};

export function wrapAngle(a) {
  let v = a % TWO_PI;
  if (v < 0) v += TWO_PI;
  return v;
}

// Quantised yaw is computed from the STEP COUNT, never by rounding radians, so
// n steps of 15 degrees is bit-identical however the player got there.
export function quantiseYaw(yawRadians, stepDegrees) {
  const perStep = 360 / stepDegrees;
  let steps = Math.round((yawRadians / TWO_PI) * perStep) % perStep;
  if (steps < 0) steps += perStep;
  return steps * stepDegrees * DEG;
}

export function snapTo(v, grid) {
  return Math.round(v / grid) * grid;
}

export function yawQuaternion(yaw) {
  const h = yaw * 0.5;
  return { x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) };
}

// --- geometry helpers --------------------------------------------------------
// Everything is a yaw-only box, so the whole overlap problem is 2D separating
// axes in XZ plus an interval test in Y.

function obb(x, y, z, yaw, hx, hy, hz) {
  return { x, y, z, yaw, hx, hy, hz, c: Math.cos(yaw), s: Math.sin(yaw) };
}

// World offset -> the box's own axes.
function toLocal(b, dx, dz) {
  return { u: dx * b.c + dz * b.s, v: -dx * b.s + dz * b.c };
}

function overlapsY(a, b, eps) {
  return Math.abs(a.y - b.y) < a.hy + b.hy - eps;
}

// SAT on the four axes of two rotated rectangles.
function overlapsXZ(a, b, eps) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const axes = [
    { x: a.c, z: a.s }, { x: -a.s, z: a.c },
    { x: b.c, z: b.s }, { x: -b.s, z: b.c },
  ];
  for (let i = 0; i < 4; i++) {
    const ax = axes[i];
    const d = Math.abs(dx * ax.x + dz * ax.z);
    const ra = a.hx * Math.abs(a.c * ax.x + a.s * ax.z) + a.hz * Math.abs(-a.s * ax.x + a.c * ax.z);
    const rb = b.hx * Math.abs(b.c * ax.x + b.s * ax.z) + b.hz * Math.abs(-b.s * ax.x + b.c * ax.z);
    if (d >= ra + rb - eps) return false;
  }
  return true;
}

export function boxesOverlap(a, b, eps) {
  const e = eps || 0;
  return overlapsY(a, b, e) && overlapsXZ(a, b, e);
}

// Shortest distance from a point to a yaw-rotated rectangle, in the XZ plane.
export function distanceToBoxXZ(b, px, pz) {
  const l = toLocal(b, px - b.x, pz - b.z);
  const du = Math.max(Math.abs(l.u) - b.hx, 0);
  const dv = Math.max(Math.abs(l.v) - b.hz, 0);
  return Math.hypot(du, dv);
}

// Every corner of the box, for the plate-bounds test.
export function cornersXZ(b) {
  const out = [];
  for (let i = 0; i < 4; i++) {
    const sx = i === 0 || i === 3 ? 1 : -1;
    const sz = i < 2 ? 1 : -1;
    out.push({
      x: b.x + b.c * (sx * b.hx) - b.s * (sz * b.hz),
      z: b.z + b.s * (sx * b.hx) + b.c * (sz * b.hz),
    });
  }
  return out;
}

// --- the world query ---------------------------------------------------------
// One object holding everything resolvePlacement needs to know about the world.
// Built from config once; `objects` is a live array the placer keeps updated.

export function createWorldQuery(config, objects) {
  const b = config.build;
  const p = config.pit;
  const w = config.world;
  const bo = config.booth;

  // The booth is scenery, so its keep-out is a static box like any other.
  const boothBox = obb(
    bo.x + Math.sin(bo.yaw) * bo.colliderLocalZ * bo.scale,
    bo.y + bo.colliderLocalY * bo.scale,
    bo.z + Math.cos(bo.yaw) * bo.colliderLocalZ * bo.scale,
    bo.yaw,
    bo.colliderHalfX * bo.scale + bo.keepout,
    bo.colliderHalfY * bo.scale + bo.keepout,
    bo.colliderHalfZ * bo.scale + bo.keepout
  );

  return {
    build: {
      grid: b.grid,
      yawStepDegrees: b.yawStepDegrees,
      maxDistance: b.maxDistance,
      minDistance: b.minDistance,
      groundY: b.groundY,
      pitMargin: b.pitMargin,
      plateMargin: b.plateMargin,
      overlapEpsilon: b.overlapEpsilon,
    },
    pit: { x: p.centerX, z: p.centerZ, radius: p.radius + b.pitMargin },
    booth: boothBox,
    bounds: { half: w.plateSize / 2 - b.plateMargin },
    objects: objects || [],
  };
}

// --- the one function --------------------------------------------------------
//
//   item       a catalog row (footprint, collider, snap, anchor)
//   rayOrigin  {x,y,z} eye position
//   rayDir     {x,y,z} look direction, normalised or not
//   rotation   {yaw, free} -- free means the player chose an arbitrary angle, so
//              positional snapping is switched OFF for this object. Snapping to
//              a grid while rotating freely leaves gaps a duck escapes through,
//              so the two modes are exclusive by construction.
//   worldQuery from createWorldQuery()
//
// Returns { position, quaternion, valid, reason, yaw, free, snapped, box }.
// A pose is ALWAYS returned, including for a refused spot, because the red
// hologram has to be drawn somewhere.

export function resolvePlacement(item, rayOrigin, rayDir, rotation, worldQuery) {
  const q = worldQuery;
  const B = q.build;

  if (!item || !item.collider || !item.snap) {
    return {
      position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 },
      valid: false, reason: REASONS.NOT_PLACEABLE, yaw: 0, free: false, snapped: false, box: null,
    };
  }

  const free = !!(rotation && rotation.free);
  const rawYaw = rotation && isFinite(rotation.yaw) ? rotation.yaw : 0;
  const yaw = free ? wrapAngle(rawYaw) : quantiseYaw(rawYaw, item.snap.yawStep);

  // Normalise the ray here rather than trusting the caller: the ghost and the
  // placer must agree even if one of them hands over an unnormalised vector.
  const dl = Math.hypot(rayDir.x, rayDir.y, rayDir.z) || 1;
  const dx = rayDir.x / dl;
  const dy = rayDir.y / dl;
  const dz = rayDir.z / dl;

  const hx = item.collider.half[0];
  const hy = item.collider.half[1];
  const hz = item.collider.half[2];

  // Ray against the ground plane. Looking up, or aiming past the reach, still
  // produces a pose -- clamped to the reach and dropped onto the plate -- so the
  // refusal is something the player can see rather than a hologram that vanishes.
  let reason = null;
  let t;
  if (dy < -1e-6) {
    t = (B.groundY - rayOrigin.y) / dy;
    if (t > B.maxDistance) { t = B.maxDistance; reason = REASONS.TOO_FAR; }
    else if (t < B.minDistance) { t = B.minDistance; reason = REASONS.TOO_CLOSE; }
  } else {
    t = B.maxDistance;
    reason = REASONS.NO_SURFACE;
  }

  let px = rayOrigin.x + dx * t;
  let pz = rayOrigin.z + dz * t;

  const snapped = !free;
  if (snapped) {
    px = snapTo(px, item.snap.grid);
    pz = snapTo(pz, item.snap.grid);
  }
  const py = B.groundY + hy;

  const box = obb(px, py, pz, yaw, hx, hy, hz);

  if (reason === null) {
    const corners = cornersXZ(box);
    const lim = q.bounds.half;
    for (let i = 0; i < corners.length; i++) {
      if (Math.abs(corners[i].x) > lim || Math.abs(corners[i].z) > lim) {
        reason = REASONS.OUT_OF_BOUNDS;
        break;
      }
    }
  }

  if (reason === null && distanceToBoxXZ(box, q.pit.x, q.pit.z) < q.pit.radius) {
    reason = REASONS.PIT;
  }

  if (reason === null && boxesOverlap(box, q.booth, B.overlapEpsilon)) {
    reason = REASONS.BOOTH;
  }

  if (reason === null) {
    for (let i = 0; i < q.objects.length; i++) {
      const o = q.objects[i];
      const other = o.c === undefined ? obb(o.x, o.y, o.z, o.yaw, o.hx, o.hy, o.hz) : o;
      if (boxesOverlap(box, other, B.overlapEpsilon)) { reason = REASONS.OVERLAP; break; }
    }
  }

  return {
    position: { x: px, y: py, z: pz },
    quaternion: yawQuaternion(yaw),
    valid: reason === null,
    reason,
    yaw,
    free,
    snapped,
    box: { x: px, y: py, z: pz, yaw, hx, hy, hz },
  };
}

// --- rotation state ----------------------------------------------------------
// Held here rather than in the UI so the rule "an arbitrary angle means free
// placement" lives next to the code that acts on it.

export function createRotationState(config) {
  const stepDeg = config.build.yawStepDegrees;
  let steps = 0;
  let freeYaw = 0;
  let free = false;

  return {
    // MMB: one detent. Stays on the grid.
    step(dir) {
      const n = 360 / stepDeg;
      steps = (steps + (dir >= 0 ? 1 : -1) + n) % n;
      free = false;
      freeYaw = steps * stepDeg * DEG;
      return this.get();
    },
    // Any angle that is not a whole detent switches the object to free place.
    setFree(yawRadians) {
      freeYaw = wrapAngle(yawRadians);
      const n = 360 / stepDeg;
      const k = (freeYaw / TWO_PI) * n;
      free = Math.abs(k - Math.round(k)) > 1e-9;
      if (!free) steps = Math.round(k) % n;
      return this.get();
    },
    nudge(deltaRadians) {
      return this.setFree(freeYaw + deltaRadians);
    },
    reset() { steps = 0; freeYaw = 0; free = false; return this.get(); },
    get: () => ({ yaw: free ? freeYaw : steps * stepDeg * DEG, free }),
    isFree: () => free,
    degrees: () => ((free ? freeYaw : steps * stepDeg * DEG) * 180) / Math.PI,
  };
}

export default resolvePlacement;
