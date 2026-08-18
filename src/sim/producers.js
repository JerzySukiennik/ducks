// Automatic duck producers -- the `producer_auto` kind (Duck Press, Duck
// Assembler). Each placed copy emits one duck every produce.secondsPerDuck
// seconds, scaled by the machineRateMul stat, at a mouth derived from the row's
// footprint and the placed pose.
//
// No three.js, no Rapier types, no DOM: this module is handed a duck pool, an
// impulse function and a list of placed records, and knows nothing else.
//
// Two rules from the contract are load-bearing here and are implemented in one
// place each:
//   * At the duck cap the producer STOPS and raises a jam flag. Nothing is
//     deleted to make room, and the pending interval is not banked, so
//     unjamming does not fire a burst of ducks that were "owed".
//   * Every impulse goes through ducks.wakeDuck() before it is applied. Rapier
//     silently discards a force on a sleeping body, which would make a freshly
//     spawned duck sit in the machine's mouth forever.
//
// Behaviour is selected by `kind` and by data blocks on the row. Nothing here
// may ever look at a row's id.

const PRODUCER_KIND = 'producer_auto';

// Deterministic RNG so a verification run is repeatable head-down.
function seeded(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function num(v, fallbackName) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error(`[producers] config.${fallbackName} is missing or not a finite number`);
  }
  return v;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

// Named rarity weight sets live in config.rarity.sets. A row naming a set that
// does not exist is fatal at wire-up: a silent fallback to the plain curve would
// make "a better rarity roll" a tuning number nobody could ever see move.
export function resolveWeightSet(config, name) {
  const sets = config && config.rarity && config.rarity.sets;
  if (!sets || typeof sets !== 'object') {
    throw new Error('[producers] config.rarity.sets is missing; producer rows name their weights by set');
  }
  const w = sets[name];
  if (!Array.isArray(w) || w.length !== config.rarity.multipliers.length) {
    throw new Error(
      `[producers] unknown rarity weight set '${name}'. Known sets: ${Object.keys(sets).join(', ')}. ` +
      `Each set must have exactly ${config.rarity.multipliers.length} weights, one per tier.`
    );
  }
  for (let i = 0; i < w.length; i++) {
    if (typeof w[i] !== 'number' || !isFinite(w[i]) || w[i] < 0) {
      throw new Error(`[producers] rarity weight set '${name}'[${i}] is not a finite weight >= 0`);
    }
  }
  return w;
}

// rarityLuckMul multiplies the weight of every tier ABOVE the first, which is
// exactly what src/data/stats.js says the stat does.
export function luckWeights(base, luck, out) {
  const dst = out && out.length === base.length ? out : new Array(base.length);
  dst[0] = base[0];
  for (let i = 1; i < base.length; i++) dst[i] = base[i] * luck;
  return dst;
}

export function rollTier(weights, rnd) {
  let total = 0;
  for (let i = 0; i < weights.length; i++) total += weights[i];
  if (!(total > 0)) return 0;
  let r = rnd() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

// The output mouth in world space, derived from the row's footprint [x, height,
// depth] and the placed pose. Local +Z is the front of a placed row (the same
// convention resolvePlacement uses for yaw), so the mouth is mouthClear metres
// in front of the front face. There is deliberately no per-machine offset table:
// a new producer row gets a working mouth from its footprint alone.
export function mouthOf(row, rec, P) {
  const f = row.footprint;
  const c = Math.cos(rec.yaw || 0);
  const s = Math.sin(rec.yaw || 0);
  const lz = f[2] * P.mouthDepthFrac + P.mouthClear;
  const baseY = rec.hy === undefined ? rec.y : rec.y - rec.hy;
  return {
    x: rec.x + s * lz,
    y: baseY + f[1] * P.mouthHeightFrac,
    z: rec.z + c * lz,
    // Outward direction of the mouth, used for the eject impulse.
    dx: s,
    dz: c,
  };
}

export function createProducers({ ducks, applyImpulse, list, byId, config, statsOf, rng, rungBonus }) {
  if (!ducks) throw new Error('[producers] a duck pool is required');
  if (typeof list !== 'function') throw new Error('[producers] list() is required');
  if (typeof byId !== 'function') throw new Error('[producers] byId() is required');

  const P = {
    mouthDepthFrac: num(config.producers.mouthDepthFrac, 'producers.mouthDepthFrac'),
    mouthClear: num(config.producers.mouthClear, 'producers.mouthClear'),
    mouthHeightFrac: num(config.producers.mouthHeightFrac, 'producers.mouthHeightFrac'),
    ejectSpeed: num(config.producers.ejectSpeed, 'producers.ejectSpeed'),
    ejectDrop: num(config.producers.ejectDrop, 'producers.ejectDrop'),
    ejectSpread: num(config.producers.ejectSpread, 'producers.ejectSpread'),
    minSecondsPerDuck: num(config.producers.minSecondsPerDuck, 'producers.minSecondsPerDuck'),
    maxSpawnsPerUpdate: num(config.producers.maxSpawnsPerUpdate, 'producers.maxSpawnsPerUpdate'),
    rateMulMin: num(config.producers.rateMulMin, 'producers.rateMulMin'),
    rateMulMax: num(config.producers.rateMulMax, 'producers.rateMulMax'),
    jamSeconds: num(config.producers.jamSeconds, 'producers.jamSeconds'),
    luckMin: num(config.producers.luckMin, 'producers.luckMin'),
    luckMax: num(config.producers.luckMax, 'producers.luckMax'),
    spawnSeed: num(config.producers.spawnSeed, 'producers.spawnSeed'),
  };
  const fallbackMass = num(config.ducks.mass, 'ducks.mass');

  const rnd = typeof rng === 'function' ? rng : seeded(P.spawnSeed);
  const stats = typeof statsOf === 'function' ? statsOf : () => ({});

  // key -> { key, id, timer, produced, jammed, weights, scratch }
  const units = new Map();
  let produced = 0;
  let refusedAtCap = 0;
  let jammedCount = 0;
  // Two things a machine does that are worth hearing: it spits out a duck, and
  // it stops because there is nowhere to put one. Both are announced in the
  // same style as ducks.onCapRefusal and shop.onPurchase -- the simulation
  // emits, and whoever cares listens. src/sim/** never learns that a renderer
  // or a speaker exists.
  const emitListeners = [];
  const jamListeners = [];

  function announce(list, a, b) {
    for (let i = 0; i < list.length; i++) {
      try { list[i](a, b); } catch (e) { /* a broken listener never stops a machine */ }
    }
  }

  function isProducer(row) {
    return !!row && row.kind === PRODUCER_KIND && !!row.produce;
  }

  // Rebuild the working set from the live placed list. Placement and demolition
  // happen elsewhere; this is the only place that notices.
  function sync() {
    const objs = list() || [];
    const seen = new Set();
    for (let i = 0; i < objs.length; i++) {
      const rec = objs[i];
      const row = byId(rec.id);
      if (!isProducer(row)) continue;
      seen.add(rec.key);
      let u = units.get(rec.key);
      if (!u) {
        u = {
          key: rec.key,
          id: rec.id,
          timer: 0,
          produced: 0,
          jammed: false,
          // The pity counter, for a row with `produce.guarantee`. It counts
          // emissions since the last one at or above the promised rung, and
          // the promise is kept by FORCING the roll rather than by weighting
          // it -- a weight is a hope, and a machine that says 'guaranteed'
          // must not be hoping.
          sinceGood: 0,
          // Seconds left stuck, for a row with `produce.jamChance`. A jammed
          // machine is not slower, it is STOPPED until somebody walks over.
          stuck: 0,
          base: resolveWeightSet(config, row.produce.rarityWeights),
          scratch: new Array(config.rarity.multipliers.length),
        };
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

  function emit(u) {
    const m = mouthOf(u.row, u.rec, P);
    const luck = clamp(
      typeof stats().rarityLuckMul === 'number' ? stats().rarityLuckMul : 1,
      P.luckMin, P.luckMax
    );
    const w = luckWeights(u.base, luck, u.scratch);
    let tier = rollTier(w, rnd);
    // THE GUARANTEE. `produce.guarantee: { every, rung }` means: at most
    // `every` emissions can pass without one at `rung` or better. It is a
    // floor placed under the roll, not a thumb on it, so the machine's promise
    // is true rather than likely -- which is the only reason to print it on a
    // shop row at all.
    const g = u.row.produce.guarantee;
    if (g) {
      if (tier >= g.rung) u.sinceGood = 0;
      else if (++u.sinceGood >= g.every) { tier = g.rung; u.sinceGood = 0; }
    }
    // And the Golden Minute, or whatever the world clock is running. It nudges
    // the rung as the duck is MADE, so it lifts everything a factory produces
    // during the window and nothing it produced before.
    const bonus = typeof rungBonus === 'function' ? rungBonus() : 0;
    if (bonus > 0) tier = Math.min(config.rarity.multipliers.length - 1, tier + bonus);
    const id = ducks.spawn({
      x: m.x + (rnd() - 0.5) * P.ejectSpread,
      y: m.y,
      z: m.z + (rnd() - 0.5) * P.ejectSpread,
    }, tier);
    if (id === null) return null;
    const body = ducks.body(id);
    if (body && typeof applyImpulse === 'function') {
      // Rapier discards forces on a sleeping body, so the wake comes first and
      // the impulse second. Never the other way round.
      ducks.wakeDuck(id);
      const mass = (typeof ducks.massOf === 'function' && ducks.massOf(id)) || fallbackMass;
      applyImpulse(body, {
        x: m.dx * P.ejectSpeed * mass,
        y: P.ejectDrop * P.ejectSpeed * mass,
        z: m.dz * P.ejectSpeed * mass,
      });
    }
    u.produced++;
    produced++;
    announce(emitListeners, { key: u.key, id: u.id, duck: id, tier, x: m.x, y: m.y, z: m.z });
    return id;
  }

  // How many ducks this machine puts out in one emission. `produce.count` is an
  // integer, or a [min, max] pair rolled fresh every time; absent means 1, which
  // is why every row written before the field behaves exactly as it did.
  function countFor(u) {
    const c = u.row.produce.count;
    if (c === undefined) return 1;
    if (Array.isArray(c)) {
      const lo = c[0];
      const hi = c[1];
      const n = lo + Math.floor(rnd() * (hi - lo + 1));
      return n > hi ? hi : n;      // rnd() is [0,1) but never trust the edge
    }
    return c;
  }

  // The average of the above, for expectedPerMinute(). A range machine has no
  // single output rate, so the number a measured run is compared against has to
  // be the mean or the comparison is meaningless.
  function meanCount(u) {
    const c = u.row.produce.count;
    if (c === undefined) return 1;
    return Array.isArray(c) ? (c[0] + c[1]) / 2 : c;
  }

  function intervalOf(u) {
    const raw = typeof stats().machineRateMul === 'number' ? stats().machineRateMul : 1;
    const rate = clamp(raw, P.rateMulMin, P.rateMulMax);
    return Math.max(P.minSecondsPerDuck, u.row.produce.secondsPerDuck / rate);
  }

  function update(dt) {
    if (!(dt > 0) || !isFinite(dt)) return 0;
    sync();
    let made = 0;
    jammedCount = 0;
    for (const u of units.values()) {
      const interval = intervalOf(u);
      u.interval = interval;
      u.timer += dt;
      // The budget counts EMISSIONS, not ducks: it exists so one very long dt
      // cannot pay out a whole minute of missed intervals at once, and a machine
      // whose row says `count: 10` has to be able to deliver its ten in the one
      // emission it is owed. Counting ducks here would silently truncate every
      // batch larger than the budget, which would look like a balance bug.
      let budget = P.maxSpawnsPerUpdate;
      // STUCK. A machine with `produce.jamChance` seizes now and then and does
      // nothing at all until a player walks over and presses E on it. That is
      // the trade its row is sold on: faster than the machine beside it, and
      // it needs you in the building.
      if (u.stuck > 0) {
        u.stuck = Math.max(0, u.stuck - dt);
        if (u.stuck === 0) announce(jamListeners, { key: u.key, id: u.id, jammed: false, stuck: false });
        continue;
      }
      let jam = false;
      while (u.timer >= interval && budget > 0) {
        const want = countFor(u);
        let capped = false;
        for (let k = 0; k < want; k++) {
          // STOP, do not delete and do not bank the debt. What FITS is emitted
          // and the remainder of the batch is dropped on the floor: a backlog
          // released after the jam clears would dump the whole thing in one
          // frame, which is the burst this rule exists to prevent.
          if (ducks.atCap() || emit(u) === null) { capped = true; break; }
          made++;
        }
        if (capped) {
          // Hold the timer one interval short so the first duck after the jam
          // clears is immediate, and never longer, so nothing is owed.
          u.timer = interval;
          refusedAtCap++;
          jam = true;
          break;
        }
        u.timer -= interval;
        budget--;
        // The seize is rolled AFTER a successful batch, never before: a
        // machine that jams on the cycle it was about to produce would eat a
        // duck the player watched it start, and that reads as the game
        // cheating rather than as a machine breaking.
        const jc = u.row.produce.jamChance;
        if (jc && rnd() < jc) {
          u.stuck = P.jamSeconds;
          announce(jamListeners, { key: u.key, id: u.id, jammed: false, stuck: true });
          break;
        }
      }
      // A dt so long that the budget ran out must not bank an ever-growing
      // debt either; clamp what is carried into the next update.
      if (u.timer > interval) u.timer = interval;
      // The EDGE, not the state: a jammed machine grinding for a minute must
      // announce itself once, not sixty times a second.
      const wasJammed = !!u.jammed;
      u.jammed = jam;
      if (jam && !wasJammed) announce(jamListeners, { key: u.key, id: u.id, x: u.rec.x, y: u.rec.y, z: u.rec.z });
      if (jam) jammedCount++;
    }
    return made;
  }

  function info() {
    sync();
    const out = [];
    for (const u of units.values()) {
      const m = mouthOf(u.row, u.rec, P);
      out.push({
        key: u.key,
        id: u.id,
        kind: PRODUCER_KIND,
        x: u.rec.x, y: u.rec.y, z: u.rec.z, yaw: u.rec.yaw,
        mouth: { x: m.x, y: m.y, z: m.z },
        secondsPerDuck: u.row.produce.secondsPerDuck,
        count: u.row.produce.count === undefined ? 1 : u.row.produce.count,
        meanCount: meanCount(u),
        intervalSeconds: intervalOf(u),
        timer: u.timer,
        produced: u.produced,
        jammed: !!u.jammed,
        weightSet: u.row.produce.rarityWeights,
      });
    }
    return out;
  }

  // Restore one unit's lifetime counter. The only other way to move this number
  // is to emit real ducks, which would take bodies out of the fixed pool that
  // the snapshot has already accounted for -- so a restore cannot use it.
  //
  // The module-wide total moves by the same delta, so the per-unit numbers and
  // the total stay consistent WITH EACH OTHER. It is not the sum of the live
  // units and never was: `produced` counts every duck this module ever made,
  // including ones made by producers since demolished, and a snapshot restore
  // clears the placed list before rebuilding it. Measured: three units restored
  // to 100/101/102 in a world that had already made 27 ducks read a total of
  // 330, not 303. producedTotal() is a debug figure only (nothing on the wire
  // and nothing on screen reads it); the per-unit counters are what the snapshot
  // carries and what round-trips exactly.
  function setProduced(key, n) {
    sync();
    const u = units.get(key);
    if (!u) return false;
    const v = Number(n);
    if (!isFinite(v) || v < 0) return false;
    const want = Math.round(v);
    produced += want - u.produced;
    u.produced = want;
    return true;
  }

  function jamState() {
    const c = ducks.count();
    return {
      producers: units.size,
      jammed: jammedCount,
      anyJammed: jammedCount > 0,
      atCap: ducks.atCap(),
      refusedAtCap,
      ducksLive: c.live,
      ducksMax: c.max,
    };
  }

  return {
    update,
    info,
    setProduced,
    jamState,
    onEmit(cb) { if (typeof cb === 'function') emitListeners.push(cb); },
    onJam(cb) { if (typeof cb === 'function') jamListeners.push(cb); },
    // Somebody walked over and hit it. Returns false when that machine was not
    // stuck, so the caller can tell 'fixed it' from 'pressed E at a wall'.
    unjam(key) {
      const u = units.get(key);
      if (!u || u.stuck <= 0) return false;
      u.stuck = 0;
      announce(jamListeners, { key: u.key, id: u.id, jammed: false, stuck: false });
      return true;
    },
    isStuck: (key) => { const u = units.get(key); return !!(u && u.stuck > 0); },
    stuckKeys: () => Array.from(units.values()).filter((u) => u.stuck > 0).map((u) => u.key),
    count: () => units.size,
    producedTotal: () => produced,
    refusedAtCap: () => refusedAtCap,
    // Expected steady-state output in ducks per minute, for verification: the
    // number a measured run is compared against.
    expectedPerMinute() {
      sync();
      let total = 0;
      for (const u of units.values()) total += (60 / intervalOf(u)) * meanCount(u);
      return total;
    },
    reset() { units.clear(); produced = 0; refusedAtCap = 0; jammedCount = 0; },
  };
}

export default createProducers;
