// Measurement harness for storage interiors. Dev-only, loaded by hand from the
// console: import('/work/measure-storage.js').
//
// Answers one question with numbers instead of opinion: how many duck-sized
// bodies actually fit inside a storage row's collider box today. It fills the
// real container through the real debug surface, reads the resulting duck
// poses out of the running world, transforms them into the container's own
// frame and counts the ones that are (a) wholly inside the box and (b) not
// overlapping each other.
import { byId } from '/src/data/index.js';

function duckAabb(D) {
  return {
    lo: [
      Math.min(-D.halfExtentX, D.headOffsetX - D.headHalfX),
      -D.halfExtentY,
      -D.halfExtentZ,
    ],
    hi: [
      Math.max(D.halfExtentX, D.headOffsetX + D.headHalfX),
      Math.max(D.halfExtentY, D.headOffsetY + D.headHalfY),
      D.halfExtentZ,
    ],
  };
}

function rotateInv(q, v) {
  const c = { x: -q.x, y: -q.y, z: -q.z, w: q.w };
  const ix = c.w * v.x + c.y * v.z - c.z * v.y;
  const iy = c.w * v.y + c.z * v.x - c.x * v.z;
  const iz = c.w * v.z + c.x * v.y - c.y * v.x;
  const iw = -c.x * v.x - c.y * v.y - c.z * v.z;
  return {
    x: ix * c.w + iw * -c.x + iy * -c.z - iz * -c.y,
    y: iy * c.w + iw * -c.y + iz * -c.x - ix * -c.z,
    z: iz * c.w + iw * -c.z + ix * -c.y - iy * -c.x,
  };
}

export function clean(g) {
  for (let i = g.placed.props.length - 1; i >= 0; i--) g.placed.despawnProp(g.placed.props[i]);
  const ids = [];
  g.world.ducks.forEach((id) => ids.push(id));
  for (const id of ids) g.world.ducks.release(id);
  g.debugStep(0.2);
}

// Naive shelf packing of duck cells into the box, ignoring the game's lattice:
// the ceiling the geometry allows, which is what a resize has to move.
export function gridFit(half, duck) {
  const w = duck.hi[0] - duck.lo[0];
  const h = duck.hi[1] - duck.lo[1];
  const d = duck.hi[2] - duck.lo[2];
  const nx = Math.floor((2 * half[0]) / w);
  const ny = Math.floor((2 * half[1]) / h);
  const nz = Math.floor((2 * half[2]) / d);
  return { nx, ny, nz, total: nx * ny * nz, cell: [w, h, d] };
}

export function measureRow(g, id, capOverride) {
  const row = byId(id);
  const duck = duckAabb(g.config.ducks);
  const rec = g.placed.dropProp(row, { x: 0, y: row.collider.half[1] + 0.02, z: -14 }, { x: 0, y: 0, z: 0 });
  if (!rec) return { id, err: 'dropProp refused' };
  // Frozen for the duration of the measurement: a box that rolls or tips while
  // it is being filled is measuring the roll, not the interior.
  if (typeof rec.body.setBodyType === 'function') rec.body.setBodyType(1, true);
  g.debugStep(0.2);
  const before = g.debugContainerInfo().filter((c) => c.key === rec.key)[0];
  if (!before) { g.placed.despawnProp(rec); return { id, err: 'not registered as a container' }; }
  const cap = capOverride === undefined ? before.capacity : capOverride;
  g.debugFillContainer(rec.key, cap);
  g.debugStep(2.0);
  const info = g.debugContainerInfo().filter((c) => c.key === rec.key)[0];
  const c = g.containers.get(rec.key);
  const t = rec.body.translation();
  const q = rec.body.rotation();
  const half = c.half;

  const boxes = [];
  for (const did of c.physical) {
    const p = g.world.ducks.pose(did);
    if (!p) continue;
    const l = rotateInv(q, { x: p.x - t.x, y: p.y - t.y, z: p.z - t.z });
    boxes.push({
      lo: [l.x + duck.lo[0], l.y + duck.lo[1], l.z + duck.lo[2]],
      hi: [l.x + duck.hi[0], l.y + duck.hi[1], l.z + duck.hi[2]],
    });
  }
  const EPS = 1e-4;
  const inside = boxes.filter((b) => {
    for (let a = 0; a < 3; a++) if (b.lo[a] < -half[a] - EPS || b.hi[a] > half[a] + EPS) return false;
    return true;
  });
  const kept = [];
  for (const b of inside) {
    let ok = true;
    for (const k of kept) {
      let sep = false;
      for (let a = 0; a < 3; a++) if (b.hi[a] <= k.lo[a] + EPS || b.lo[a] >= k.hi[a] - EPS) { sep = true; break; }
      if (!sep) { ok = false; break; }
    }
    if (ok) kept.push(b);
  }
  const out = {
    id,
    capacity: cap,
    half: [half[0], half[1], half[2]],
    outer: [half[0] * 2, half[1] * 2, half[2] * 2],
    slots: info.slots,
    physicalLimit: info.physicalLimit,
    physical: info.physical,
    virtual: info.virtual,
    insideBox: inside.length,
    fits: kept.length,
    gridFit: gridFit(half, duck),
  };
  g.placed.despawnProp(rec);
  clean(g);
  return out;
}

export function measureAll(g, rows) {
  const list = rows || ['bucket', 'box', 'box_big', 'cart', 'container'];
  clean(g);
  const out = [];
  for (const id of list) out.push(measureRow(g, id));
  return out;
}

export default { measureRow, measureAll, clean, gridFit };
