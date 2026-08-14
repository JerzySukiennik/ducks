// Belt drive for the `conveyor` kind: straight belt, corner, ramp.
//
// A belt does NOT move a duck. It moves the SURFACE the duck is standing on, and
// friction does the rest -- modelled here as a surface-velocity impulse that
// pulls the duck's velocity towards the belt's velocity. Nothing is teleported,
// nothing follows a spline, no position is ever written: a duck that is thrown,
// bumped or blown off the side simply leaves the footprint and stops being
// driven. That is the whole reason belts read as physical.
//
// Behaviour comes from the row's `kind` and its `belt` block (speed / turn /
// rise). Nothing here may look at a row id, and nothing here may import three.
//
// This file also owns two primitives that blowers.js reuses rather than
// duplicating: the config reader and the uniform spatial hash.

const DEG = Math.PI / 180;

// --- config access -----------------------------------------------------------
// Same contract as src/sim/world.js: a missing key is a loud boot error, never a
// silent default, so a renamed tunable cannot quietly stop being read.

export function readNum(root, path) {
  let node = root;
  const parts = path.split('.');
  for (let i = 0; i < parts.length; i++) {
    if (node === null || typeof node !== 'object') node = undefined;
    else node = node[parts[i]];
    if (node === undefined) break;
  }
  if (typeof node !== 'number' || !isFinite(node)) {
    throw new Error(`[sim] config.${path} is missing or not a finite number`);
  }
  return node;
}

// --- broad phase -------------------------------------------------------------
// 300 ducks against 40 machines is 12000 tests a substep. Instead the ducks are
// bucketed into a uniform XZ grid once, and each machine only visits the cells
// its own reach overlaps.
//
// Positions are copied into flat arrays during the rebuild so the narrow phase
// never touches a Rapier body until it has decided to push something.

export function createDuckHash(cellSize, capacity) {
  const inv = 1 / cellSize;
  const cells = new Map();
  const px = new Float32Array(capacity);
  const py = new Float32Array(capacity);
  const pz = new Float32Array(capacity);
  // Visit stamps: two different cells can hash to the same bucket, so without
  // this a duck could be pushed twice by one machine in one substep.
  const stamp = new Int32Array(capacity);
  let token = 0;
  let live = 0;

  function key(ix, iz) {
    return (Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663)) | 0;
  }

  return {
    rebuild(ducks) {
      cells.clear();
      live = 0;
      ducks.forEach((id, x, y, z) => {
        if (id >= capacity) return;
        px[id] = x; py[id] = y; pz[id] = z;
        live++;
        const k = key(Math.floor(x * inv), Math.floor(z * inv));
        const a = cells.get(k);
        if (a) a.push(id);
        else cells.set(k, [id]);
      });
      return live;
    },
    // visit(id, x, y, z) for every duck whose cell overlaps the XZ rectangle.
    query(minX, minZ, maxX, maxZ, visit) {
      token++;
      const i0 = Math.floor(minX * inv), i1 = Math.floor(maxX * inv);
      const j0 = Math.floor(minZ * inv), j1 = Math.floor(maxZ * inv);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const a = cells.get(key(i, j));
          if (!a) continue;
          for (let n = 0; n < a.length; n++) {
            const id = a[n];
            if (stamp[id] === token) continue;
            stamp[id] = token;
            visit(id, px[id], py[id], pz[id]);
          }
        }
      }
    },
    cellCount: () => cells.size,
    liveCount: () => live,
    cellSize: () => cellSize,
  };
}

// --- the belt system ---------------------------------------------------------

export function createConveyors({ config, ducks, applyImpulse, list, byId }) {
  if (!ducks) throw new Error('[conveyors] a duck pool is required');
  if (typeof list !== 'function') throw new Error('[conveyors] list() is required');
  if (typeof byId !== 'function') throw new Error('[conveyors] byId() is required');
  const cellSize = readNum(config, 'automation.cellSize');
  const B = {
    grip: readNum(config, 'automation.belt.grip'),
    maxAccel: readNum(config, 'automation.belt.maxAccel'),
    marginXZ: readNum(config, 'automation.belt.marginXZ'),
    surfaceBelow: readNum(config, 'automation.belt.surfaceBelow'),
    surfaceAbove: readNum(config, 'automation.belt.surfaceAbove'),
    liftScale: readNum(config, 'automation.belt.liftScale'),
  };
  const hash = createDuckHash(cellSize, ducks.max);

  const belts = [];

  // Committed once per frame from the OR-accumulator below. Reading a flag
  // mid-substep would give whichever substep happened to run last.
  let flags = { driving: false };
  let accFlags = { driving: false };
  let counts = { driven: 0, impulses: 0 };
  let accCounts = { driven: 0, impulses: 0 };
  let totalImpulses = 0;

  // A row becomes a belt because its kind says so. `turn` and `rise` are data;
  // a corner is not a special case in code, it is a row with turn: 90.
  function accepts(row) {
    return !!row && row.kind === 'conveyor' && !!row.belt;
  }

  function describe(rec, row) {
    const yaw = rec.yaw;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const hx = rec.hx + B.marginXZ;
    const hz = rec.hz + B.marginXZ;
    const reach = Math.hypot(hx, hz);
    return {
      key: rec.key,
      id: rec.id,
      x: rec.x, y: rec.y, z: rec.z, yaw,
      hx: rec.hx, hy: rec.hy, hz: rec.hz,
      c, s,
      // Accept box, in the belt's own frame.
      ax: hx, az: hz,
      speed: row.belt.speed,
      turn: (row.belt.turn || 0) * DEG,
      rise: row.belt.rise || 0,
      // The whole rise is delivered across the piece's own length.
      slope: row.belt.rise ? (row.belt.rise / (2 * rec.hz)) * B.liftScale : 0,
      surfaceY: rec.y + rec.hy,
      minX: rec.x - reach, maxX: rec.x + reach,
      minZ: rec.z - reach, maxZ: rec.z + reach,
    };
  }

  // Rebuilt from the live placed-object list. The list is owned by the placer;
  // this is a projection of it, not a second source of truth, so placing or
  // demolishing a belt turns it on and off with no registration step. A
  // descriptor is only recomputed when its key is new, so the steady state is a
  // pointer walk, not 40 allocations a substep.
  const byKey = new Map();
  function sync() {
    const objs = list() || [];
    let changed = false;
    let n = 0;
    for (let i = 0; i < objs.length; i++) {
      const rec = objs[i];
      const row = byId(rec.id);
      if (!accepts(row)) continue;
      n++;
      if (!byKey.has(rec.key)) {
        byKey.set(rec.key, describe(rec, row));
        changed = true;
      }
    }
    if (n !== byKey.size) {
      const live = new Set();
      for (let i = 0; i < objs.length; i++) live.add(objs[i].key);
      for (const key of Array.from(byKey.keys())) {
        if (!live.has(key)) { byKey.delete(key); changed = true; }
      }
    }
    if (changed || belts.length !== byKey.size) {
      belts.length = 0;
      byKey.forEach((b) => belts.push(b));
    }
    return belts.length;
  }

  // Where on the belt is this point, in belt-local metres? Returns null when the
  // point is not resting on the belt at all.
  function contact(b, x, y, z) {
    if (y > b.surfaceY + B.surfaceAbove || y < b.surfaceY - B.surfaceBelow) return null;
    const dx = x - b.x;
    const dz = z - b.z;
    const u = dx * b.c + dz * b.s;
    const v = -dx * b.s + dz * b.c;
    if (u < -b.ax || u > b.ax || v < -b.az || v > b.az) return null;
    return v;
  }

  // Belt surface velocity at local depth v. The corner turns the drive direction
  // progressively across the piece, so a duck entering straight leaves rotated.
  function beltVelocity(b, v, out) {
    const t = b.az > 0 ? (v + b.az) / (2 * b.az) : 0;
    const driveYaw = b.yaw + b.turn * (t < 0 ? 0 : t > 1 ? 1 : t);
    // +sin for the same reason blowers.js uses it: the belt's MESH is rotated by
    // yawQuaternion(), so its local +Z is (sin yaw, 0, cos yaw). With -sin a belt
    // placed at 90 or 270 degrees carried ducks the opposite way to the
    // direction its own arrows pointed.
    out.x = Math.sin(driveYaw) * b.speed;
    out.z = Math.cos(driveYaw) * b.speed;
    out.y = b.slope * b.speed;
    return out;
  }

  const _bv = { x: 0, y: 0, z: 0 };

  function fixedUpdate(dt) {
    sync();
    if (belts.length === 0) return;
    hash.rebuild(ducks);
    const k = Math.min(1, B.grip * dt);
    const cap = B.maxAccel * dt;
    // Substep-local. Accumulated into accFlags with OR at the bottom, so a quiet
    // substep can never erase what a busy one found.
    let drove = false;

    for (let i = 0; i < belts.length; i++) {
      const b = belts[i];
      hash.query(b.minX, b.minZ, b.maxX, b.maxZ, (id, x, y, z) => {
        const v = contact(b, x, y, z);
        if (v === null) return;
        const body = ducks.body(id);
        if (!body) return;
        beltVelocity(b, v, _bv);
        const lv = body.linvel();

        let dvx = (_bv.x - lv.x) * k;
        let dvz = (_bv.z - lv.z) * k;
        // The belt lifts a duck but never presses it down: pushing down would
        // let a ramp pin a duck into the floor instead of carrying it up.
        let dvy = _bv.y > 0 ? Math.max(0, _bv.y - lv.y) * k : 0;

        const mag = Math.sqrt(dvx * dvx + dvy * dvy + dvz * dvz);
        if (mag < 1e-6) return;
        if (mag > cap) {
          const f = cap / mag;
          dvx *= f; dvy *= f; dvz *= f;
        }

        // Rapier does NOT wake a body when an impulse arrives, so a duck that
        // fell asleep on a stopped belt would stay asleep forever once it
        // started again. Every push in this file goes through here first.
        ducks.wakeDuck(id);
        const m = body.mass() || 0;
        if (!(m > 0)) return;
        applyImpulse(body, { x: dvx * m, y: dvy * m, z: dvz * m });

        drove = true;
        accCounts.driven++;
        accCounts.impulses++;
        totalImpulses++;
      });
    }

    accFlags.driving = accFlags.driving || drove;
  }

  // Called once after the whole substep loop: flags accumulated with OR inside
  // the loop are assigned here, never inside it.
  function endFrame() {
    flags = { driving: accFlags.driving };
    counts = { driven: accCounts.driven, impulses: accCounts.impulses };
    accFlags = { driving: false };
    accCounts = { driven: 0, impulses: 0 };
  }

  // Does the chain reach this spot? Deliberately NOT the same test as contact():
  // the coverage probe walks the run at duck height on the FLOOR, and a belt's
  // surface is half a metre up, so an exact contact test would report a fully
  // built belt line as covering nothing. A belt claims its whole footprint from
  // the floor up to the top of its carrying band; what it does not claim is the
  // air above it.
  function covers(x, y, z) {
    sync();
    for (let i = 0; i < belts.length; i++) {
      const b = belts[i];
      if (y > b.surfaceY + B.surfaceAbove) continue;
      const dx = x - b.x;
      const dz = z - b.z;
      const u = dx * b.c + dz * b.s;
      const v = -dx * b.s + dz * b.c;
      if (u < -b.ax || u > b.ax || v < -b.az || v > b.az) continue;
      return b;
    }
    return null;
  }

  function info() {
    sync();
    return belts.map((b) => {
      // A duck travels from -az (upstream edge) to +az, so those are the entry
      // and exit ends. Sampling the middle instead reports a corner as already
      // half-turned before a duck has entered it.
      beltVelocity(b, -b.az, _bv);
      const entry = { x: _bv.x, y: _bv.y, z: _bv.z };
      beltVelocity(b, b.az, _bv);
      return {
        key: b.key,
        id: b.id,
        position: { x: b.x, y: b.y, z: b.z },
        yawDegrees: (b.yaw * 180) / Math.PI,
        half: { x: b.hx, y: b.hy, z: b.hz },
        surfaceY: b.surfaceY,
        speed: b.speed,
        turnDegrees: (b.turn * 180) / Math.PI,
        rise: b.rise,
        slope: b.slope,
        driveEntry: entry,
        driveExit: { x: _bv.x, y: _bv.y, z: _bv.z },
      };
    });
  }

  return {
    sync,
    covers,
    info,
    count: () => { sync(); return belts.length; },
    flags: () => ({ ...flags }),
    counts: () => ({ ...counts }),
    totalImpulses: () => totalImpulses,
    hashStats: () => ({
      cells: hash.cellCount(),
      ducks: hash.liveCount(),
      cellSize: hash.cellSize(),
    }),
    _fixedUpdate: fixedUpdate,
    endFrame,
  };
}

export default createConveyors;
