// Hybrid containers: the `storage` behaviour block (bucket, crate, large crate,
// container, cart).
//
// A container holds at most `physicalLimit` REAL duck bodies plus a virtual
// count. The physical ones are the ones you can see moving in the box; every
// duck past the limit is absorbed -- its body goes back to the fixed 300-body
// pool and only its rarity tier is remembered. Nothing is ever created or
// destroyed: absorbing releases to the pool, spilling spawns from it.
//
// Three rules this file exists to enforce:
//   1. A full crate is HEAVY. The body carries additional mass proportional to
//      what is inside, so it is heavy to push and heavy to knock over.
//   2. Tipping empties it: the up-axis more than `tipAngleDegrees` off vertical
//      for `tipHoldSeconds` starts a spill.
//   3. A spill converts at most `maxConvertPerStep` ducks per step.
//      Materialising 200 bodies in one frame freezes the game.
//
// No three.js, no Rapier import: this module only ever touches rigid bodies it
// was handed. Behaviour is selected by `kind` and by data fields on the row,
// never by the row's id.

// Tunables. The authoritative copy of every value below now lives in the
// `containers` block of src/config.js, and every key is in REQUIRED_CONFIG_KEYS,
// so a deleted key is fatal at boot instead of silently falling back here. This
// table remains as the module's own fallback (it keeps containers.js usable
// standalone, e.g. in a test harness) and is merged key-by-key under
// config.containers. No number below appears inline in the logic.
export const CONTAINER_DEFAULTS = {
  // At most this many real bodies live inside one container.
  physicalLimit: 25,
  // Ducks converted (either direction) per step during a spill.
  maxConvertPerStep: 6,
  // Tipping.
  tipAngleDegrees: 60,
  tipHoldSeconds: 0.25,
  // Capture zone: the box footprint, shrunk, extended this far above the lid.
  captureShrink: 0.92,
  mouthHeight: 0.5,
  // Where spilled ducks leave from, measured out from the box centre along the
  // container's own up axis, as a multiple of its half-height plus a margin.
  mouthMargin: 0.18,
  spillSpeed: 1.4,
  spillSpread: 0.35,
  spillSeed: 20260816,
  // Packing of the physical contents inside the box. slotSpacing is the widest
  // spacing tried; it shrinks by slotSpacingDecay until the lattice offers
  // physicalLimit places or hits slotSpacingMin. Neither number can push two
  // slots closer than a duck is wide on that axis -- see buildSlots.
  slotSpacing: 0.24,
  slotSpacingMin: 0.08,
  slotSpacingDecay: 0.9,
  // Breathing room between a duck and the interior wall it is nearest to. This
  // is a margin on top of the duck's own half-extent, not instead of it.
  slotInset: 0.02,
  // Critically damped spring that keeps a physical content at its slot.
  slotKp: 80,
  slotKdScale: 2,
  slotMaxSpeed: 9,
  slotRestEpsilon: 0.02,
  // Mass added per duck inside. Deliberately larger than a loose duck's 0.16 kg:
  // a duck you can throw one-handed has to be light, and a crate of sixteen of
  // them has to be something you shove rather than flick. This is the knob for
  // "the full crate feels empty".
  massPerDuck: 0.6,
};

const UP_LOCAL_Y = 1;
const DEG = Math.PI / 180;

function rotate(q, x, y, z, out) {
  // out = q * v * q^-1, expanded.
  const ix = q.w * x + q.y * z - q.z * y;
  const iy = q.w * y + q.z * x - q.x * z;
  const iz = q.w * z + q.x * y - q.y * x;
  const iw = -q.x * x - q.y * y - q.z * z;
  out.x = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y;
  out.y = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z;
  out.z = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x;
  return out;
}

function rotateInv(q, x, y, z, out) {
  return rotate({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, x, y, z, out);
}

function seeded(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function numOr(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

// Merge CONTAINER_DEFAULTS with config.containers (when it exists) and pull the
// duck's mass AND its size out of the duck block, so the two never drift apart.
//
// The size half is what this module got wrong for a week. The lattice numbers
// above were authored against a 0.20 x 0.18 x 0.14 duck; the duck then grew to
// 0.178 x 0.386 x 0.146 (two colliders -- config.ducks.head* added the head and
// neck, which had no collision at all). Nothing in here noticed, so a bucket
// went on packing its contents on a 0.08 m lattice: eight ducks reported, two
// visible, six wedged through the walls. Deriving the cell from config.ducks
// means the next time the duck changes size, every container resizes its
// packing with it.
function duckMetrics(config) {
  const d = (config && config.ducks) || {};
  const hx = numOr(d.halfExtentX, 0.089);
  const hy = numOr(d.halfExtentY, 0.13);
  const hz = numOr(d.halfExtentZ, 0.073);
  // headHalfY 0 disables the head collider, exactly as config.ducks documents.
  const headY = numOr(d.headHalfY, 0);
  const headX = headY > 0 ? numOr(d.headHalfX, 0) : 0;
  const headZ = headY > 0 ? numOr(d.headHalfZ, 0) : 0;
  const offX = numOr(d.headOffsetX, 0);
  const offY = numOr(d.headOffsetY, 0);
  // The body's own origin is the BODY collider's centre, so the reach up and
  // the reach down are not the same number and must not be averaged into one.
  const up = Math.max(hy, offY + headY);
  const down = Math.max(hy, -(offY - headY));
  const right = Math.max(hx, offX + headX);
  const left = Math.max(hx, -(offX - headX));
  return {
    duckUp: up,
    duckDown: down,
    duckRight: right,
    duckLeft: left,
    duckHalfZ: Math.max(hz, headZ),
    // One duck-shaped cell: the closest two contents may ever be placed.
    duckCellX: right + left,
    duckCellY: up + down,
    duckCellZ: 2 * Math.max(hz, headZ),
  };
}

export function resolveContainerConfig(config) {
  const src = (config && config.containers) || {};
  const out = {};
  for (const k of Object.keys(CONTAINER_DEFAULTS)) {
    out[k] = numOr(src[k], CONTAINER_DEFAULTS[k]);
  }
  out.tipAngleRad = out.tipAngleDegrees * DEG;
  out.tipCos = Math.cos(out.tipAngleRad);
  out.duckMass = numOr(config && config.ducks && config.ducks.mass, out.massPerDuck);
  Object.assign(out, duckMetrics(config));
  return out;
}

// The inner cavity a storage row actually holds ducks in, in the row's own
// frame: half-extents plus an offset from the body centre.
//
// It defaults to the collider box, which is right for a crate -- the crate IS
// its bounding box. It is badly wrong for a cart, whose collider spans handles,
// legs and a wheel, and whose ducks belong in the tray: without this the
// lattice hung two thirds of a cartload in the air beside the barrow. A row
// states its own cavity in `storage.interior` when the two differ; validation
// (src/data/index.js) refuses one that sticks out of the collider.
export function interiorOf(row, half) {
  const src = row && row.storage && row.storage.interior;
  const h = src && Array.isArray(src.half) ? src.half : half;
  const o = src && Array.isArray(src.offset) ? src.offset : null;
  return {
    half: [numOr(h[0], half[0]), numOr(h[1], half[1]), numOr(h[2], half[2])],
    offset: o ? [numOr(o[0], 0), numOr(o[1], 0), numOr(o[2], 0)] : [0, 0, 0],
  };
}

// A row carries a storage block when its behaviour is storage-shaped. `kind`
// selects the behaviour; the block carries the numbers.
export function isStorageRow(row) {
  return !!(row && row.storage && typeof row.storage.capacity === 'number');
}

export function createContainers({
  ducks, pit, economy, applyImpulse, config, getStats, groups,
}) {
  if (!ducks) throw new Error('[containers] ducks pool is required');
  const cfg = resolveContainerConfig(config);
  const rnd = seeded(cfg.spillSeed);

  const list = [];                 // live containers
  const byKey = new Map();
  const containedBy = new Map();   // duck id -> container key
  let events = [];
  let nextKey = 1;
  let absorbed = 0;
  let spilled = 0;
  let scoredVirtual = 0;
  let refusedFull = 0;

  const _v = { x: 0, y: 0, z: 0 };
  const _w = { x: 0, y: 0, z: 0 };
  const _up = { x: 0, y: 0, z: 0 };
  const dirSpill = { x: 0, y: 0, z: 0 };

  // Contained ducks must not collide with anything: the container's collider is
  // a solid box, so a body inside it would be interpenetrating from the first
  // step. Group 0 is the same trick the pool uses for parked ducks, and it
  // preserves mass (setEnabled(false) does not).
  const CONTAINED_GROUPS = 0;
  const LOOSE_GROUPS = groups
    ? groups.interactionGroups(groups.GROUP_PROP, groups.GROUP_WORLD | groups.GROUP_PROP)
    : null;

  // EVERY collider on the duck, not the first one.
  //
  // A duck is two cuboids since the head and neck got collision (src/sim/ducks.js,
  // config.ducks.head*). This used to read collider(0) and hand back the body
  // box alone, so a duck taken into a crate went on colliding through its HEAD:
  // it fought the box it was inside, rode 0.2 m up out of its slot, and sat
  // there being pushed by a wall it was supposed to be ignoring. Anything that
  // counts a body-and-its-colliders has to count all of them.
  function duckColliders(id) {
    const b = ducks.body(id);
    if (!b || typeof b.collider !== 'function') return [];
    const n = typeof b.numColliders === 'function' ? b.numColliders() : 1;
    const out = [];
    for (let i = 0; i < n; i++) {
      try {
        const c = b.collider(i);
        if (c) out.push(c);
      } catch (e) { /* handle went away mid-frame */ }
    }
    return out;
  }

  // The groups each of a duck's colliders had before it was taken in are
  // remembered, per collider and in order, and put back verbatim: guessing them
  // on release would silently leave a duck that falls through the floor if the
  // pool's filter ever changes.
  const savedGroups = new Map();

  function setDuckCollision(id, on) {
    const list = duckColliders(id);
    if (!list.length) return;
    if (on) {
      const saved = savedGroups.has(id) ? savedGroups.get(id) : null;
      savedGroups.delete(id);
      for (let i = 0; i < list.length; i++) {
        if (typeof list[i].setCollisionGroups !== 'function') continue;
        const g = saved && saved[i] !== undefined ? saved[i] : LOOSE_GROUPS;
        if (g !== null && g !== undefined) list[i].setCollisionGroups(g);
      }
    } else {
      const before = [];
      for (let i = 0; i < list.length; i++) {
        before.push(typeof list[i].collisionGroups === 'function' ? list[i].collisionGroups() : undefined);
      }
      savedGroups.set(id, before);
      for (let i = 0; i < list.length; i++) {
        if (typeof list[i].setCollisionGroups === 'function') list[i].setCollisionGroups(CONTAINED_GROUPS);
      }
    }
  }

  // Slots are derived from the cavity, not authored: the lattice is the box's
  // own inner volume, spaced as widely as it can be while still offering
  // `physicalLimit` places. A bucket therefore packs its ducks tighter than a
  // container does, with no second number to keep in sync.
  //
  // A slot is A PLACE FOR A DUCK, and that is now enforced on both ends:
  //
  //   * two slots are never closer than one duck-shaped cell on that axis
  //     (cfg.duckCell*), so slotSpacingMin can no longer stack three ducks in
  //     the space of one;
  //   * a slot centre is never closer to a wall than the duck's own reach on
  //     that axis plus cfg.slotInset, so the duck standing in it is wholly
  //     inside the cavity rather than half through the lid.
  //
  // The vertical reach is asymmetric on purpose: the duck's origin is its BODY
  // collider's centre and its head sticks 0.256 up against 0.13 down, so the
  // lattice's vertical centre sits below the cavity's. Averaging the two put a
  // duck's beak through the lid of every box in the game.
  //
  // The consequence worth stating: the number of slots IS the number of ducks
  // that physically fit. `physLimit` is min(physicalLimit, slots.length), so a
  // box that offers ten places holds ten bodies and absorbs the rest as virtual
  // count -- it can no longer claim to be showing you what it is not.
  function buildSlots(interior) {
    const want = Math.max(1, Math.round(cfg.physicalLimit));
    const half = interior.half;
    const m = cfg.slotInset;
    // Travel available to a slot CENTRE on each axis.
    const lo = [
      -half[0] + m + cfg.duckLeft,
      -half[1] + m + cfg.duckDown,
      -half[2] + m + cfg.duckHalfZ,
    ];
    const hi = [
      half[0] - m - cfg.duckRight,
      half[1] - m - cfg.duckUp,
      half[2] - m - cfg.duckHalfZ,
    ];
    const cell = [cfg.duckCellX, cfg.duckCellY, cfg.duckCellZ];
    const span = [
      Math.max(0, hi[0] - lo[0]),
      Math.max(0, hi[1] - lo[1]),
      Math.max(0, hi[2] - lo[2]),
    ];
    // A cavity too small for even one duck still gets one slot, at its middle:
    // the content is visibly too big for the box, which is a data problem to
    // see rather than a crash to debug.
    const mid = [
      span[0] > 0 ? (lo[0] + hi[0]) / 2 : (cfg.duckLeft - cfg.duckRight) / 2,
      span[1] > 0 ? (lo[1] + hi[1]) / 2 : (cfg.duckDown - cfg.duckUp) / 2,
      span[2] > 0 ? (lo[2] + hi[2]) / 2 : 0,
    ];
    const n = [1, 1, 1];
    let s = cfg.slotSpacing;
    for (let guard = 0; guard < 64; guard++) {
      for (let a = 0; a < 3; a++) {
        // 1 + floor(span / step): n points at that step need (n-1) steps of
        // travel, not n. The old form dropped a whole row off every axis.
        n[a] = 1 + Math.floor(span[a] / Math.max(s, cell[a]));
      }
      if (n[0] * n[1] * n[2] >= want || s <= cfg.slotSpacingMin) break;
      s = Math.max(cfg.slotSpacingMin, s * cfg.slotSpacingDecay);
    }
    const at = (a, i) => (n[a] === 1 ? mid[a] : lo[a] + (span[a] * i) / (n[a] - 1))
      + interior.offset[a];
    const slots = [];
    for (let iy = 0; iy < n[1]; iy++) {
      for (let iz = 0; iz < n[2]; iz++) {
        for (let ix = 0; ix < n[0]; ix++) {
          slots.push({ x: at(0, ix), y: at(1, iy), z: at(2, iz) });
        }
      }
    }
    return slots;
  }

  function storageMul() {
    const s = typeof getStats === 'function' ? getStats() : null;
    const m = s && typeof s.storageCapacityMul === 'number' ? s.storageCapacityMul : 1;
    return m > 0 ? m : 1;
  }

  function capacityOf(c) {
    return Math.max(1, Math.round(c.baseCapacity * storageMul()));
  }

  // A container is registered from whatever created its body (a dropped prop, a
  // placed object): this module never creates bodies of its own.
  function register(row, body, opts) {
    if (!row || !body) return null;
    if (!isStorageRow(row)) return null;
    // Every placeable row is validated to carry a collider at boot; a row
    // without one is a data bug, not something to paper over with a default box.
    if (!row.collider || !row.collider.half) {
      throw new Error(`[containers] row '${row.id}' has a storage block but no collider.half`);
    }
    const half = row.collider.half;
    const interior = interiorOf(row, half);
    const o = opts || {};
    const c = {
      key: o.key === undefined ? nextKey++ : o.key,
      id: row.id,
      netId: row.netId,
      name: row.name,
      kind: row.kind,
      row,
      body,
      half: [half[0], half[1], half[2]],
      interior,
      baseCapacity: row.storage.capacity,
      // Data, not code: a row that says it does not empty when tipped does not.
      tipToEmpty: row.storage.tipToEmpty !== false,
      slots: buildSlots(interior),
      physical: [],        // duck ids with a real body inside
      virtualTiers: [],    // tiers of the absorbed ducks; length is virtualCount
      tipTimer: 0,
      spilling: false,
      tiltDegrees: 0,
      appliedMass: -1,
      pin: null,
    };
    list.push(c);
    byKey.set(c.key, c);
    syncMass(c);
    return c;
  }

  function unregister(key) {
    const c = byKey.get(key);
    if (!c) return false;
    for (let i = 0; i < c.physical.length; i++) freePhysical(c.physical[i]);
    c.physical.length = 0;
    byKey.delete(key);
    const i = list.indexOf(c);
    if (i >= 0) list.splice(i, 1);
    return true;
  }

  function freePhysical(id) {
    containedBy.delete(id);
    if (ducks.isActive(id)) {
      setDuckCollision(id, true);
      const b = ducks.body(id);
      if (b && typeof b.setGravityScale === 'function') b.setGravityScale(1, false);
      ducks.wakeDuck(id);
    }
  }

  function countOf(c) { return c.physical.length + c.virtualTiers.length; }

  // Additional mass is what makes a full crate heavy. Rapier does not
  // recompute it for us, so it is written whenever the count changes.
  function syncMass(c) {
    const n = countOf(c);
    const extra = n * cfg.massPerDuck;
    if (Math.abs(extra - c.appliedMass) < 1e-6) return;
    c.appliedMass = extra;
    if (typeof c.body.setAdditionalMass === 'function') {
      c.body.setAdditionalMass(extra, false);
    } else if (typeof c.body.setAdditionalMassProperties === 'function') {
      c.body.setAdditionalMassProperties(
        extra, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, false
      );
    }
  }

  function tierOf(id) {
    const t = ducks.tier(id);
    return typeof t === 'number' ? t : 0;
  }

  function valueOfTier(tier) {
    const base = economy ? numOr(economy.duckBaseValue, 1) : 1;
    const mul = economy ? numOr(economy.duckValueMul, 1) : 1;
    return base * ducks.multiplier(tier) * mul;
  }

  function containPhysical(c, id) {
    setDuckCollision(id, false);
    const b = ducks.body(id);
    if (b && typeof b.setGravityScale === 'function') b.setGravityScale(0, false);
    ducks.wakeDuck(id);
    c.physical.push(id);
    containedBy.set(id, c.key);
  }

  function absorbVirtual(c, id) {
    c.virtualTiers.push(tierOf(id));
    // The body goes straight back to the fixed pool. This is the only reason a
    // container can hold 200 ducks without 200 bodies existing.
    ducks.release(id);
  }

  // One duck leaves the container at `p`, moving along `dir`.
  // Over the pit mouth the duck is scored instead of materialised: the point of
  // tipping a crate into a 3 m hole is the money, and dropping 200 fresh bodies
  // down a shaft is exactly the frame spike the cap exists to prevent.
  function emit(c, tier, physicalId, p, overPit) {
    if (overPit) {
      const value = valueOfTier(tier);
      if (physicalId !== null) { freePhysical(physicalId); ducks.release(physicalId); }
      if (economy) economy.add(value, 'pit');
      scoredVirtual++;
      events.push({ type: 'score', key: c.key, id: c.id, tier, value });
      return true;
    }
    const pos = {
      x: p.x + (rnd() - 0.5) * cfg.spillSpread,
      y: p.y,
      z: p.z + (rnd() - 0.5) * cfg.spillSpread,
    };
    let id = physicalId;
    if (id === null) {
      id = ducks.spawn(pos, tier);
      if (id === null) return false;      // pool full: the duck stays inside
    } else {
      freePhysical(id);
      const prev = ducks.body(id);
      if (prev) prev.setTranslation(pos, true);
    }
    const b = ducks.body(id);
    const m = b && typeof b.mass === 'function' ? b.mass() || cfg.duckMass : cfg.duckMass;
    ducks.wakeDuck(id);
    applyImpulse(b, {
      x: dirSpill.x * cfg.spillSpeed * m,
      y: dirSpill.y * cfg.spillSpeed * m,
      z: dirSpill.z * cfg.spillSpeed * m,
    });
    events.push({ type: 'spill', key: c.key, id: c.id, duck: id, tier });
    spilled++;
    return true;
  }

  function spillStep(c, pose) {
    // The mouth is the top of the CAVITY in the container's own frame, so a
    // tipped box pours sideways, out of where its lid is.
    // Never zero: a zero-length up vector would leave the spill with no
    // direction to travel in at all.
    const d = Math.max(cfg.mouthMargin, c.interior.offset[1] + c.interior.half[1] + cfg.mouthMargin);
    rotate(pose.q, 0, UP_LOCAL_Y * d, 0, _v);
    const p = { x: pose.t.x + _v.x, y: pose.t.y + _v.y, z: pose.t.z + _v.z };
    const l = Math.hypot(_v.x, _v.y, _v.z) || 1;
    dirSpill.x = _v.x / l; dirSpill.y = _v.y / l; dirSpill.z = _v.z / l;
    const overPit = !!(pit && typeof pit.contains === 'function' && pit.contains(p.x, p.z));

    let budget = Math.max(1, Math.round(cfg.maxConvertPerStep));
    while (budget > 0) {
      if (c.physical.length) {
        const id = c.physical[c.physical.length - 1];
        if (!ducks.isActive(id)) { c.physical.pop(); containedBy.delete(id); continue; }
        if (!emit(c, tierOf(id), id, p, overPit)) break;
        c.physical.pop();
      } else if (c.virtualTiers.length) {
        const tier = c.virtualTiers[c.virtualTiers.length - 1];
        if (!emit(c, tier, null, p, overPit)) break;
        c.virtualTiers.pop();
      } else {
        break;
      }
      budget--;
    }
    syncMass(c);
  }

  // Keeps one physical content at its slot with a critically damped spring, the
  // same shape as the grab controller. Every impulse wakes the body first.
  const kd = () => cfg.slotKdScale * Math.sqrt(cfg.slotKp);

  function holdContents(c, pose, dt) {
    const KD = kd();
    const containerAsleep = typeof c.body.isSleeping === 'function' && c.body.isSleeping();
    for (let i = c.physical.length - 1; i >= 0; i--) {
      const id = c.physical[i];
      if (!ducks.isActive(id) || containedBy.get(id) !== c.key) {
        c.physical.splice(i, 1);
        containedBy.delete(id);
        continue;
      }
      const b = ducks.body(id);
      if (!b) { c.physical.splice(i, 1); containedBy.delete(id); continue; }
      const slot = c.slots[i % c.slots.length];
      rotate(pose.q, slot.x, slot.y, slot.z, _w);
      const tx = pose.t.x + _w.x;
      const ty = pose.t.y + _w.y;
      const tz = pose.t.z + _w.z;
      const p = b.translation();
      const ex = tx - p.x, ey = ty - p.y, ez = tz - p.z;
      const err = Math.hypot(ex, ey, ez);
      const asleep = typeof b.isSleeping === 'function' && b.isSleeping();
      // A settled duck in a settled box costs nothing: no impulse, no wake.
      if (asleep && containerAsleep && err < cfg.slotRestEpsilon) continue;
      const v = b.linvel();
      const m = (typeof b.mass === 'function' ? b.mass() : cfg.duckMass) || cfg.duckMass;
      const ix = (cfg.slotKp * ex - KD * v.x) * m * dt;
      const iy = (cfg.slotKp * ey - KD * v.y) * m * dt;
      const iz = (cfg.slotKp * ez - KD * v.z) * m * dt;
      ducks.wakeDuck(id);
      applyImpulse(b, { x: ix, y: iy, z: iz });
      let nx = v.x + ix / m, ny = v.y + iy / m, nz = v.z + iz / m;
      const s = Math.hypot(nx, ny, nz);
      if (s > cfg.slotMaxSpeed) {
        const k = cfg.slotMaxSpeed / s;
        b.setLinvel({ x: nx * k, y: ny * k, z: nz * k }, true);
      }
    }
  }

  // Ducks that fall into the mouth are taken in: physically while there is room
  // for a body, virtually after that.
  function capture(c, pose, live) {
    const cap = capacityOf(c);
    const physLimit = Math.min(Math.round(cfg.physicalLimit), c.slots.length);
    for (let i = 0; i < live.length; i++) {
      const d = live[i];
      if (containedBy.has(d.id)) continue;
      const dx = d.x - pose.t.x, dy = d.y - pose.t.y, dz = d.z - pose.t.z;
      rotateInv(pose.q, dx, dy, dz, _v);
      // The mouth is the CAVITY's mouth, not the bounding box's: a duck rolling
      // past a cart's handles is beside the barrow, not in it.
      const ih = c.interior.half;
      const io = c.interior.offset;
      if (Math.abs(_v.x - io[0]) > ih[0] * cfg.captureShrink) continue;
      if (Math.abs(_v.z - io[2]) > ih[2] * cfg.captureShrink) continue;
      if (_v.y < io[1] - ih[1] || _v.y > io[1] + ih[1] + cfg.mouthHeight) continue;
      // Full: stop offering ducks to this container for the rest of the step.
      // One refusal per full container per step, not one per duck per step.
      if (countOf(c) >= cap) { refusedFull++; return; }
      if (c.physical.length < physLimit) containPhysical(c, d.id);
      else { absorbVirtual(c, d.id); absorbed++; }
      events.push({ type: 'absorb', key: c.key, id: c.id, duck: d.id });
      d.taken = true;
    }
  }

  function poseOf(c) {
    return { t: c.body.translation(), q: c.body.rotation() };
  }

  function tiltOf(pose) {
    rotate(pose.q, 0, UP_LOCAL_Y, 0, _up);
    return Math.max(-1, Math.min(1, _up.y));
  }

  // Runs BEFORE world.step(), like every other impulse source in the project:
  // the spring has to land in the substep the solver is about to integrate.
  function fixedUpdate(dt) {
    if (!list.length) return;
    const live = [];
    ducks.forEach((id, x, y, z) => { live.push({ id, x, y, z, taken: false }); });

    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.pin) applyPin(c);
      const pose = poseOf(c);
      const cosUp = tiltOf(pose);
      c.tiltDegrees = Math.acos(cosUp) / DEG;

      if (c.tipToEmpty && cosUp < cfg.tipCos) {
        c.tipTimer += dt;
        if (c.tipTimer >= cfg.tipHoldSeconds) c.spilling = true;
      } else {
        c.tipTimer = 0;
        c.spilling = false;
      }

      if (c.spilling) {
        spillStep(c, pose);
        if (countOf(c) === 0) c.spilling = false;
        continue;
      }
      // A box past the tipping angle pours; it does not swallow. Without this a
      // tipped crate re-captures what it just poured out and never empties.
      if (cosUp >= cfg.tipCos) capture(c, pose, live);
      holdContents(c, pose, dt);
      syncMass(c);
    }

    // A duck taken by one container must not be offered to the next.
    for (let i = live.length - 1; i >= 0; i--) if (live[i].taken) live.splice(i, 1);
  }

  // Debug-only: hold a container at a fixed tilt so tipping can be measured
  // head-down. Gameplay never calls this.
  function applyPin(c) {
    const p = c.pin;
    c.body.setRotation(p.q, true);
    if (p.pos) c.body.setTranslation(p.pos, true);
    c.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
    c.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
  }

  function info(key) {
    const c = byKey.get(key);
    if (!c) return null;
    return {
      key: c.key,
      id: c.id,
      name: c.name,
      kind: c.kind,
      physical: c.physical.length,
      virtual: c.virtualTiers.length,
      total: countOf(c),
      capacity: capacityOf(c),
      baseCapacity: c.baseCapacity,
      storageCapacityMul: storageMul(),
      physicalLimit: Math.min(Math.round(cfg.physicalLimit), c.slots.length),
      slots: c.slots.length,
      half: [c.half[0], c.half[1], c.half[2]],
      interiorHalf: c.interior.half.slice(),
      interiorOffset: c.interior.offset.slice(),
      additionalMass: c.appliedMass,
      bodyMass: typeof c.body.mass === 'function' ? c.body.mass() : null,
      tiltDegrees: c.tiltDegrees,
      tipTimer: c.tipTimer,
      spilling: c.spilling,
      tipToEmpty: c.tipToEmpty,
      pinned: !!c.pin,
    };
  }

  function consumeEvents() {
    if (!events.length) return [];
    const out = events;
    events = [];
    return out;
  }

  const api = {
    register,
    unregister,
    get: (key) => byKey.get(key) || null,
    list,
    keys: () => list.map((c) => c.key),
    info,
    infoAll: () => list.map((c) => info(c.key)),
    consumeEvents,
    isContained: (duckId) => containedBy.has(duckId),
    containerOf: (duckId) => (containedBy.has(duckId) ? containedBy.get(duckId) : null),
    containedCount: () => containedBy.size,
    counters: () => ({
      absorbed, spilled, scoredVirtual, refusedFull, containers: list.length,
    }),
    config: cfg,

    // --- debug surface (drivable with rAF dead) --------------------------------

    // Force `n` ducks into a container. Physical while bodies are available,
    // virtual after that. Deliberately ignores capacity: this is the harness,
    // not gameplay -- gameplay capture always respects capacityOf().
    fill(key, n, opts) {
      const c = byKey.get(key);
      if (!c) return null;
      const o = opts || {};
      const tier = o.tier === undefined ? 0 : Math.max(0, Math.round(o.tier));
      const want = Math.max(0, Math.round(n || 0));
      const physLimit = Math.min(Math.round(cfg.physicalLimit), c.slots.length);
      const pose = poseOf(c);
      let madePhysical = 0;
      let madeVirtual = 0;
      for (let i = 0; i < want; i++) {
        if (c.physical.length < physLimit) {
          const slot = c.slots[c.physical.length % c.slots.length];
          rotate(pose.q, slot.x, slot.y, slot.z, _w);
          const id = ducks.spawn(
            { x: pose.t.x + _w.x, y: pose.t.y + _w.y, z: pose.t.z + _w.z }, tier
          );
          if (id === null) { c.virtualTiers.push(tier); madeVirtual++; continue; }
          containPhysical(c, id);
          madePhysical++;
        } else {
          c.virtualTiers.push(tier);
          madeVirtual++;
        }
      }
      syncMass(c);
      return { key, physical: c.physical.length, virtual: c.virtualTiers.length, madePhysical, madeVirtual };
    },

    // Pin a container at `degrees` off vertical (about +Z). 0 unpins.
    tip(key, degrees, pos) {
      const c = byKey.get(key);
      if (!c) return null;
      const deg = degrees === undefined ? 90 : Number(degrees);
      if (!isFinite(deg) || deg === 0) {
        c.pin = null;
        return info(key);
      }
      const h = deg * DEG * 0.5;
      c.pin = {
        q: { x: 0, y: 0, z: Math.sin(h), w: Math.cos(h) },
        pos: pos ? { x: pos.x, y: pos.y, z: pos.z } : null,
      };
      applyPin(c);
      return info(key);
    },

    _fixedUpdate: fixedUpdate,

  };

  // The three hooks this phase owes window.GAME, ready to Object.assign onto
  // it. Named here so the names cannot drift from the module that serves them.
  api.debugHooks = () => ({
    debugContainerInfo: (key) => (key === undefined ? api.infoAll() : api.info(key)),
    debugFillContainer: (key, n, opts) => api.fill(key, n, opts),
    debugTipContainer: (key, degrees, pos) => api.tip(key, degrees, pos),
  });

  return api;
}

export default createContainers;
