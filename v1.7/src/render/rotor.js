// Finding the blades of a fan in a baked model, without knowing which model it
// is.
//
// The fans are single meshes: one node, one mesh, four material groups. There is
// no "blades" object to look up. But a rotor is not a name, it is a SHAPE
// PROPERTY -- k identical parts, all the same distance from one axis, spaced
// evenly around it -- and that property is measurable. This file measures it.
//
// The axis is not guessed either. It is the row's own blow direction in model
// space: local +Z tilted by `blow.pitchDegrees`, which is exactly what
// src/sim/blowers.js turns into the force vector. So the Updraft Fan's blades
// are found spinning about local +Y for the same reason its wind goes up, and
// nothing here mentions a model name or an item id.
//
// What comes back is the blade geometry re-centred on the axis point, so the
// caller can spin it with a plain rotation about that axis, plus the pivot in
// model-local metres.

import { components, subGeometry } from './models.js';

// A rotor has at least this many blades. Two parts facing each other are as
// likely to be a pair of legs as a propeller, so a pair is not enough evidence.
const MIN_BLADES = 3;
const MAX_BLADES = 24;

// Two parts count as "the same part, turned" when their triangle counts match
// and their surface areas agree to this fraction. Area is used because it does
// not change when a part is rotated -- a bounding box does, which is why the
// obvious signature would find four different blades on a five-blade fan.
//
// The tolerance is TIGHT on purpose, and 2% was measured to be too loose: the
// Heavy Fan's motor block is a 0.22 m cube with surface area 0.290, and its
// blade is a 0.21 x 0.06 x 0.50 slab with area 0.295 -- 1.7% apart. At 2% the
// motor joined the five blades, the six of them were not evenly spaced, the
// whole group was rejected, and the fan span its cage ring instead. Identical
// parts in a baked mesh agree to floating-point noise, so 0.2% is generous.
const AREA_TOLERANCE = 0.002;

// How equal the radii and the angular spacing have to be. Both are fractions of
// the group's own mean, so they scale with the model.
const RADIUS_TOLERANCE = 0.06;
const ANGLE_TOLERANCE = 0.10;

function axisFrame(axis) {
  const l = Math.hypot(axis.x, axis.y, axis.z) || 1;
  const a = { x: axis.x / l, y: axis.y / l, z: axis.z / l };
  // Any vector not parallel to the axis makes a usable pair of side axes.
  const t = Math.abs(a.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  let ux = t.y * a.z - t.z * a.y;
  let uy = t.z * a.x - t.x * a.z;
  let uz = t.x * a.y - t.y * a.x;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul; uy /= ul; uz /= ul;
  const vx = a.y * uz - a.z * uy;
  const vy = a.z * ux - a.x * uz;
  const vz = a.x * uy - a.y * ux;
  return { a, u: { x: ux, y: uy, z: uz }, v: { x: vx, y: vy, z: vz } };
}

// Groups of parts that are congruent to each other.
function congruentGroups(parts) {
  const groups = new Map();
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    // Bucket on triangle count and a coarse area, then merge buckets whose
    // areas are within tolerance of each other.
    const n = p.tris.length;
    let placedIn = null;
    groups.forEach((g, key) => {
      if (placedIn) return;
      if (g.n !== n) return;
      if (Math.abs(g.area - p.area) <= AREA_TOLERANCE * Math.max(g.area, p.area)) placedIn = key;
    });
    if (placedIn) groups.get(placedIn).members.push(p);
    else groups.set(i, { n, area: p.area, members: [p] });
  }
  return Array.from(groups.values()).map((g) => g.members);
}

// Is this group a ring of k identical parts around the axis? Returns the mean
// radius and the point on the axis they turn about, or null.
function rotorFit(group, frame) {
  const k = group.length;
  if (k < MIN_BLADES || k > MAX_BLADES) return null;
  let cx = 0; let cy = 0; let cz = 0;
  for (let i = 0; i < k; i++) {
    cx += group[i].centroid.x; cy += group[i].centroid.y; cz += group[i].centroid.z;
  }
  cx /= k; cy /= k; cz /= k;

  const radii = [];
  const angles = [];
  for (let i = 0; i < k; i++) {
    const dx = group[i].centroid.x - cx;
    const dy = group[i].centroid.y - cy;
    const dz = group[i].centroid.z - cz;
    const pu = dx * frame.u.x + dy * frame.u.y + dz * frame.u.z;
    const pv = dx * frame.v.x + dy * frame.v.y + dz * frame.v.z;
    radii.push(Math.hypot(pu, pv));
    let ang = Math.atan2(pv, pu);
    if (ang < 0) ang += Math.PI * 2;
    angles.push(ang);
  }
  let mean = 0;
  for (let i = 0; i < k; i++) mean += radii[i];
  mean /= k;
  if (!(mean > 1e-3)) return null;
  for (let i = 0; i < k; i++) {
    if (Math.abs(radii[i] - mean) > RADIUS_TOLERANCE * mean) return null;
  }
  // Evenly spaced: sorted, every gap is 2pi/k.
  angles.sort((a, b) => a - b);
  const step = (Math.PI * 2) / k;
  for (let i = 0; i < k; i++) {
    const gap = i === k - 1 ? angles[0] + Math.PI * 2 - angles[i] : angles[i + 1] - angles[i];
    if (Math.abs(gap - step) > ANGLE_TOLERANCE * step) return null;
  }
  // Also require the parts to sit at roughly one station along the axis: a
  // rotor is a disc, not a tripod running the length of the model. Measured
  // against the group's own radius so it scales.
  let spread = 0;
  for (let i = 0; i < k; i++) {
    const dx = group[i].centroid.x - cx;
    const dy = group[i].centroid.y - cy;
    const dz = group[i].centroid.z - cz;
    const along = Math.abs(dx * frame.a.x + dy * frame.a.y + dz * frame.a.z);
    if (along > spread) spread = along;
  }
  if (spread > 0.5 * mean) return null;
  return { blades: k, radius: mean, pivot: { x: cx, y: cy, z: cz } };
}

// The rotor of a baked geometry, or null if it has none.
//
//   geometry  the baked model
//   axis      spin axis in MODEL-LOCAL space -- for a blower row this is the
//             blow direction, (0, sin pitch, cos pitch)
//
// Returns { blades, geometry, pivot, radius, count } where `geometry` is the
// blades re-centred on the pivot, `count` is how many of them there are, and
// `rest` is everything else.
export function detectRotor(geometry, axis) {
  if (!geometry || !geometry.attributes || !geometry.attributes.position) return null;
  const frame = axisFrame(axis);
  const parts = components(geometry);
  if (parts.length < MIN_BLADES + 1) return null;
  const totalTris = geometry.attributes.position.count / 3;

  let best = null;
  const groups = congruentGroups(parts);
  for (let i = 0; i < groups.length; i++) {
    const fit = rotorFit(groups[i], frame);
    if (!fit) continue;
    let tris = 0;
    for (let j = 0; j < groups[i].length; j++) tris += groups[i][j].tris.length;
    // A rotor cannot be most of the model: that would be a cage or a floor
    // pattern rather than the thing that turns.
    if (tris > 0.5 * totalTris) continue;
    // Of everything that turns cleanly about this axis, the blades are the set
    // closest to it. On every fan in the catalog the runners-up are the cage
    // rings (radius 0.58 against the blades' 0.27 on the Fan, 0.68 and 0.55
    // against 0.31 on the Heavy Fan) and the Updraft's three support struts
    // (0.36 against 0.22) -- all of them further out than the blades bolted to
    // the hub, which is what "bolted to the hub" means geometrically.
    if (!best || fit.radius < best.fit.radius) best = { fit, group: groups[i], tris };
  }
  if (!best) return null;

  const bladeTris = [];
  for (let i = 0; i < best.group.length; i++) {
    for (let j = 0; j < best.group[i].tris.length; j++) bladeTris.push(best.group[i].tris[j]);
  }
  bladeTris.sort((a, b) => a - b);
  const bladeSet = new Set(bladeTris);
  const restTris = [];
  for (let t = 0; t < totalTris; t++) if (!bladeSet.has(t)) restTris.push(t);

  const blades = subGeometry(geometry, bladeTris);
  // Re-centred on the axis point, so spinning it is one rotation about the
  // origin and the caller only has to know where to put it back.
  blades.translate(-best.fit.pivot.x, -best.fit.pivot.y, -best.fit.pivot.z);
  return {
    geometry: blades,
    rest: subGeometry(geometry, restTris),
    pivot: best.fit.pivot,
    radius: best.fit.radius,
    count: best.fit.blades,
    tris: bladeTris.length,
    axis: frame.a,
  };
}

export default detectRotor;
