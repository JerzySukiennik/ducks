// The `collector_auto` kind (Vacuum Station), plus the attention/jam readout
// the HUD reads.
//
// A collector pulls loose ducks within collect.radius towards its intake with
// collect.force, spending a budget of collect.perSecond duck-seconds of suction
// per second. It never moves a duck by hand: every metre a duck travels is the
// result of an impulse on an awake body, and every impulse is preceded by
// ducks.wakeDuck().
//
// No three.js, no Rapier types, no DOM. Behaviour comes from `kind` and data
// blocks; nothing here looks at a row id.

const COLLECTOR_KIND = 'collector_auto';

function num(v, name) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error(`[collectors] config.${name} is missing or not a finite number`);
  }
  return v;
}

// The intake in world space, derived from the row's footprint [x, height, depth]
// and the placed pose. Centred in XZ, at intakeHeightFrac of the footprint
// height -- no per-machine offset table.
// A duck this close (measured horizontally) has arrived: it is up against the
// machine and cannot get nearer, so it stops consuming suction budget. Without
// this the nearest few ducks pin themselves to the housing and eat the whole
// budget forever while everything else in range is never touched -- measured,
// not theorised: a station with four ducks against it pulled nothing else in
// ten seconds. The radius is derived from the row's own footprint, so a bigger
// machine has a bigger dead zone with no per-machine number anywhere.
export function arrivalRadiusOf(row, C) {
  return Math.hypot(row.footprint[0], row.footprint[2]) * 0.5 + C.arriveRadius;
}

export function intakeOf(row, rec, C) {
  const baseY = rec.hy === undefined ? rec.y : rec.y - rec.hy;
  return {
    x: rec.x,
    y: baseY + row.footprint[1] * C.intakeHeightFrac,
    z: rec.z,
  };
}

export function createCollectors({ ducks, applyImpulse, list, byId, config, isBusy }) {
  if (!ducks) throw new Error('[collectors] a duck pool is required');
  if (typeof list !== 'function') throw new Error('[collectors] list() is required');
  if (typeof byId !== 'function') throw new Error('[collectors] byId() is required');

  const C = {
    intakeHeightFrac: num(config.collectors.intakeHeightFrac, 'collectors.intakeHeightFrac'),
    arriveRadius: num(config.collectors.arriveRadius, 'collectors.arriveRadius'),
    maxSpeed: num(config.collectors.maxSpeed, 'collectors.maxSpeed'),
    burstSeconds: num(config.collectors.burstSeconds, 'collectors.burstSeconds'),
    minRadius: num(config.collectors.minRadius, 'collectors.minRadius'),
    liftGravityFrac: num(config.collectors.liftGravityFrac, 'collectors.liftGravityFrac'),
  };
  // A duck lying on concrete is held by friction worth mu * g = 0.6 * 22 =
  // 13.2 m/s^2, which is MORE than the Vacuum Station's own pull of 12. Sucking
  // sideways therefore moves nothing at all: measured, 2745 impulses over ten
  // seconds shifted one duck out of twelve. The station lifts as well as pulls,
  // and the lift is expressed as a multiple of gravity rather than as a raw
  // number, because "must beat gravity" is the actual requirement.
  const gravity = Math.abs(num(config.world.gravity.y, 'world.gravity.y'));
  const fallbackMass = num(config.ducks.mass, 'ducks.mass');
  const busy = typeof isBusy === 'function' ? isBusy : () => false;

  // key -> { key, id, tokens, pulled, row, rec }
  const units = new Map();
  let pulledTotal = 0;
  let impulses = 0;

  // Scratch buffers reused every update so a 300-duck sweep allocates nothing.
  const candIds = [];
  const candD2 = [];

  function isCollector(row) {
    return !!row && row.kind === COLLECTOR_KIND && !!row.collect;
  }

  function sync() {
    const objs = list() || [];
    const seen = new Set();
    for (let i = 0; i < objs.length; i++) {
      const rec = objs[i];
      const row = byId(rec.id);
      if (!isCollector(row)) continue;
      seen.add(rec.key);
      let u = units.get(rec.key);
      if (!u) {
        u = { key: rec.key, id: rec.id, tokens: 0, pulled: 0 };
        units.set(rec.key, u);
      }
      u.rec = rec;
      u.row = row;
    }
    if (units.size !== seen.size) {
      for (const key of Array.from(units.keys())) {
        if (!seen.has(key)) units.delete(key);
      }
    }
  }

  function update(dt) {
    if (!(dt > 0) || !isFinite(dt)) return 0;
    sync();
    if (units.size === 0) return 0;
    let pulls = 0;

    for (const u of units.values()) {
      const spec = u.row.collect;
      const radius = Math.max(C.minRadius, spec.radius);
      const r2 = radius * radius;
      const intake = intakeOf(u.row, u.rec, C);
      const arrive = arrivalRadiusOf(u.row, C);
      const arrive2 = arrive * arrive;

      // perSecond is spent as duck-seconds of suction: perSecond ducks may be
      // under the beam continuously, and a short burst may exceed that by up to
      // burstSeconds' worth of saved budget.
      u.tokens = Math.min(u.tokens + spec.perSecond * dt, spec.perSecond * C.burstSeconds);

      candIds.length = 0;
      candD2.length = 0;
      ducks.forEach((id, x, y, z) => {
        if (busy(id)) return;
        const dx = intake.x - x;
        const dy = intake.y - y;
        const dz = intake.z - z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r2) return;
        // Range is a sphere; arrival is a column, because a duck resting
        // against the housing is at floor level and never reaches the intake.
        if (dx * dx + dz * dz < arrive2) return;
        candIds.push(id);
        candD2.push(d2);
      });

      // Nearest first: a station under load finishes the ducks it has almost
      // landed rather than tugging at everything in range at once.
      const order = candIds.map((_, i) => i).sort((a, b) => candD2[a] - candD2[b]);

      for (let k = 0; k < order.length; k++) {
        if (u.tokens < dt) break;
        const id = candIds[order[k]];
        const body = ducks.body(id);
        if (!body) continue;
        const p = ducks.pose(id);
        if (!p) continue;
        let dx = intake.x - p.x;
        let dy = intake.y - p.y;
        let dz = intake.z - p.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        dx /= d; dy /= d; dz /= d;

        // Already travelling into the intake fast enough: stop pushing rather
        // than accelerating a duck into (and through) the machine.
        const v = body.linvel();
        const closing = v.x * dx + v.y * dy + v.z * dz;
        if (closing >= C.maxSpeed) { u.tokens -= dt; continue; }

        // Wake first. Rapier throws away impulses on a sleeping body and does
        // NOT wake it, so this order is the whole reason the vacuum works.
        ducks.wakeDuck(id);
        const mass = (typeof ducks.massOf === 'function' && ducks.massOf(id)) || fallbackMass;
        // spec.force is an acceleration in the project's convention (the same
        // one hold.throwImpulse uses: the number is multiplied by mass, so it
        // reads as a velocity change per second).
        const j = mass * dt;
        // Lift only while the duck is BELOW the intake, so the station is a
        // servo and not a rocket: at intake height the lift stops and gravity
        // takes over again.
        const lift = dy > 0 ? gravity * C.liftGravityFrac : 0;
        applyImpulse(body, {
          x: dx * spec.force * j,
          y: (dy * spec.force + lift) * j,
          z: dz * spec.force * j,
        });
        impulses++;
        u.tokens -= dt;
        u.pulled++;
        pulledTotal++;
        pulls++;
      }
    }
    return pulls;
  }

  function info() {
    sync();
    const out = [];
    for (const u of units.values()) {
      const intake = intakeOf(u.row, u.rec, C);
      out.push({
        key: u.key,
        id: u.id,
        kind: COLLECTOR_KIND,
        x: u.rec.x, y: u.rec.y, z: u.rec.z, yaw: u.rec.yaw,
        intake,
        radius: u.row.collect.radius,
        arrivalRadius: arrivalRadiusOf(u.row, C),
        force: u.row.collect.force,
        perSecond: u.row.collect.perSecond,
        tokens: u.tokens,
        pulled: u.pulled,
      });
    }
    return out;
  }

  return {
    update,
    info,
    count: () => units.size,
    pulledTotal: () => pulledTotal,
    impulses: () => impulses,
    reset() { units.clear(); pulledTotal = 0; impulses = 0; },
  };
}

// --- attention / jam readout -------------------------------------------------
//
// What the HUD needs in order to say "your track has stalled": how many ducks
// exist, and how many of them are asleep somewhere no transport can reach. A
// duck asleep inside a belt's or a fan's reach is fine -- something will get to
// it. A duck asleep in a corner of the plate is player work.
//
// Reach is read from the row's own data block, per kind. Adding a transport
// kind means one entry here, never a list of ids.

export const TRANSPORT_REACH = {
  collector_auto: (row, cfg) => (row.collect ? row.collect.radius : 0),
  blower: (row, cfg) => (row.blow ? row.blow.range : 0),
  // A belt only reaches what is lying on it, so its reach is its own footprint
  // plus a small margin for a duck resting against the side.
  conveyor: (row, cfg) => (
    Math.hypot(row.footprint[0], row.footprint[2]) * 0.5 + cfg.attention.beltMargin
  ),
};

export function createAttention({ ducks, list, byId, config, pit }) {
  const pitCfg = config.pit;

  function transports() {
    const objs = list() || [];
    const out = [];
    for (let i = 0; i < objs.length; i++) {
      const rec = objs[i];
      const row = byId(rec.id);
      if (!row) continue;
      const reachFn = TRANSPORT_REACH[row.kind];
      if (!reachFn) continue;
      const r = reachFn(row, config);
      if (!(r > 0)) continue;
      out.push({ x: rec.x, y: rec.y, z: rec.z, r2: r * r, kind: row.kind });
    }
    return out;
  }

  // Ducks total, asleep, and asleep beyond every transport's reach. The last
  // number is the one that means "go and pick these up yourself".
  function report() {
    const t = transports();
    let live = 0;
    let sleeping = 0;
    let stranded = 0;
    let nearestStranded = null;
    let bestD2 = Infinity;
    const pitR = pitCfg.radius + config.attention.pitMargin;
    ducks.forEach((id, x, y, z, qx, qy, qz, qw, tier, asleep) => {
      live++;
      if (!asleep) return;
      sleeping++;
      // A duck asleep over the pit mouth is already scored or about to be; it
      // is not player work.
      const pdx = x - pitCfg.centerX;
      const pdz = z - pitCfg.centerZ;
      if (pdx * pdx + pdz * pdz < pitR * pitR) return;
      for (let i = 0; i < t.length; i++) {
        const dx = x - t[i].x;
        const dy = y - t[i].y;
        const dz = z - t[i].z;
        if (dx * dx + dy * dy + dz * dz <= t[i].r2) return;
      }
      stranded++;
      const d2 = x * x + z * z;
      if (d2 < bestD2) { bestD2 = d2; nearestStranded = { id, x, y, z }; }
    });
    const c = ducks.count();
    return {
      live,
      max: c.max,
      sleeping,
      awake: live - sleeping,
      stranded,
      transports: t.length,
      atCap: ducks.atCap(),
      // One boolean the HUD can hang a warning on.
      needsAttention: ducks.atCap() || stranded > 0,
      nearestStranded,
    };
  }

  return { report, transportCount: () => transports().length };
}

export default createCollectors;
