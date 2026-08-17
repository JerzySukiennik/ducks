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

import { mouthOf } from './producers.js';

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
    feedCooldown: num(config.collectors.feedCooldownSeconds, 'collectors.feedCooldownSeconds'),
    outletClear: num(config.collectors.outletClear, 'collectors.outletClear'),
    outletCos: num(config.collectors.outletCos, 'collectors.outletCos'),
  };
  // The mouth is a MACHINE-WIDE convention, not a collector one: these are the
  // producers' own numbers, read here so that a Vacuum Station's outlet and a
  // press's outlet are the same point on the same face of the same footprint.
  // Two copies of that geometry would drift the first time either was tuned.
  const M = {
    mouthDepthFrac: num(config.producers.mouthDepthFrac, 'producers.mouthDepthFrac'),
    mouthClear: num(config.producers.mouthClear, 'producers.mouthClear'),
    mouthHeightFrac: num(config.producers.mouthHeightFrac, 'producers.mouthHeightFrac'),
    ejectSpeed: num(config.producers.ejectSpeed, 'producers.ejectSpeed'),
  };
  let fedTotal = 0;
  // Sim-clock seconds, advanced by update() itself. Used only for the re-entry
  // cooldown below, so nothing here depends on wall time.
  let clock = 0;
  // When each duck last came OUT of a station, by duck id. A station whose
  // suction radius is 3.5 m delivers at 1.4 m, so without this it pulls its own
  // output straight back in and one duck bounces in and out forever -- measured,
  // six ducks were fed twenty-five times in six seconds. The cooldown is what
  // gives the belt in front of the station time to carry the duck away, and a
  // station with nothing in front of it simply stops rather than juggling.
  const fedAt = new Map();
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
  // The ducks that have already arrived at this station and are waiting to be
  // fed out of its mouth. Refilled per station per update, like the two above.
  const arrivedIds = [];

  // How far in front of the station a fed duck is put down. Whichever is
  // further: the machine-wide mouth (footprint x mouthDepthFrac + mouthClear)
  // or just outside this station's own arrival column -- because a duck
  // delivered inside that column reads as "arrived" and is delivered again on
  // the next frame, forever.
  function outAtOf(row, arrive) {
    return Math.max(row.footprint[2] * M.mouthDepthFrac + M.mouthClear, arrive + C.arriveRadius);
  }

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
        u = { key: rec.key, id: rec.id, tokens: 0, pulled: 0, out: 0, fed: 0 };
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
    clock += dt;
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
      arrivedIds.length = 0;
      // The outlet's own cone, and the reason the station is not a juggler. It
      // reaches 3.5 m in every direction and delivers at 1.4 m, so the patch of
      // floor it feeds ducks onto is INSIDE its own suction -- it was pulling
      // its output straight back in, and one duck would go round that loop
      // forever. Measured: six ducks fed twenty-five times in six seconds.
      //
      // A real extractor has an intake and an outlet and does not breathe
      // through both. Anything lying in front of the mouth, out to the distance
      // the station itself throws, is DOWNSTREAM and is left alone -- so a belt
      // laid in front collects a steady stream, and a duck that wanders back in
      // from the side is collected again like any other.
      const mdx = Math.sin(u.rec.yaw || 0);
      const mdz = Math.cos(u.rec.yaw || 0);
      const outletKeep = outAtOf(u.row, arrive) + C.outletClear;
      ducks.forEach((id, x, y, z) => {
        if (busy(id)) return;
        const t = fedAt.get(id);
        if (t !== undefined && clock - t < C.feedCooldown) return;
        const ox = x - u.rec.x;
        const oz = z - u.rec.z;
        const od = Math.hypot(ox, oz);
        if (od > 1e-4 && od < outletKeep && (ox * mdx + oz * mdz) / od > C.outletCos) return;
        const dx = intake.x - x;
        const dy = intake.y - y;
        const dz = intake.z - z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r2) return;
        // Range is a sphere; arrival is a column, because a duck resting
        // against the housing is at floor level and never reaches the intake.
        if (dx * dx + dz * dz < arrive2) { arrivedIds.push(id); return; }
        candIds.push(id);
        candD2.push(d2);
      });

      // THE DUCKS THAT HAVE ARRIVED, and what happens to them. This used to be
      // nothing at all: the row's own description says the station "feeds them
      // onward", and onward did not exist in the code. A duck was pulled in,
      // crossed the arrival radius, stopped consuming suction and lay there
      // forever -- so the machine looked broken, and the only reason it did not
      // look broken sooner is that the ducks it pulled in were still ducks and
      // the player could pick them up by hand. Measured before this block: a
      // duck came to rest 0.68 m from a station whose arrival radius is 1.06,
      // and nothing else ever happened to it.
      //
      // A station is a PUMP: in at the intake, out at the mouth. The mouth is
      // the same mouth every producer has (src/sim/producers.js mouthOf), so a
      // belt laid in front of a Vacuum Station catches its output exactly as it
      // catches a press's, and the player has one rule to learn instead of two.
      u.out = Math.min(u.out + spec.perSecond * dt, spec.perSecond * C.burstSeconds);
      if (arrivedIds.length) {
        const mouth = mouthOf(u.row, u.rec, M);
        // BEYOND ITS OWN ARRIVAL RADIUS, and that is not a detail. A press's
        // mouth sits 0.78 m out (footprint 1.00 x mouthDepthFrac 0.5, plus
        // mouthClear 0.28) and this station's arrival column has a radius of
        // 1.06. Put the duck at the bare mouth and it lands back inside the
        // zone that says "arrived", is fed again on the very next frame, and
        // the station spends the rest of the session flicking one duck in
        // place. The delivery point is therefore whichever is further out.
        const outAt = outAtOf(u.row, arrive);
        for (let k = 0; k < arrivedIds.length && u.out >= 1; k++) {
          const id = arrivedIds[k];
          const body = ducks.body(id);
          if (!body) continue;
          ducks.wakeDuck(id);
          body.setTranslation({
            x: u.rec.x + mouth.dx * outAt,
            y: mouth.y,
            z: u.rec.z + mouth.dz * outAt,
          }, true);
          // Out and slightly down, the same shape of throw a machine's own
          // eject uses -- a duck posted out horizontally at head height sails
          // over the belt it was aimed at.
          body.setLinvel({
            x: mouth.dx * M.ejectSpeed,
            y: -Math.abs(M.ejectSpeed * 0.2),
            z: mouth.dz * M.ejectSpeed,
          }, true);
          body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          fedAt.set(id, clock);
          u.out -= 1;
          u.fed++;
          fedTotal++;
        }
      }

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
        fed: u.fed,
        outlet: (() => { const m = mouthOf(u.row, u.rec, M); return { x: m.x, y: m.y, z: m.z }; })(),
      });
    }
    return out;
  }

  return {
    update,
    info,
    count: () => units.size,
    pulledTotal: () => pulledTotal,
    // How many ducks this station has actually fed onward, which is the number
    // that says whether it is doing its job -- `pulled` only says it is sucking.
    fedTotal: () => fedTotal,
    impulses: () => impulses,
    reset() { units.clear(); pulledTotal = 0; impulses = 0; fedTotal = 0; fedAt.clear(); clock = 0; },
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
