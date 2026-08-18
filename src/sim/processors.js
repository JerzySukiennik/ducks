// Two machines that act on ducks that are ALREADY MADE: the Sorter and the
// Refiner. Everything else in the game either creates ducks or moves them; a
// processor looks at one and decides something about it.
//
// They live in one file because they are the same loop -- find the ducks inside
// my box, do something to each -- and differ only in what that something is.
// Behaviour comes from `kind`, never from a row id.
//
// THE SORTER is the machine that makes the rarity ladder mean something. Before
// it, a yard full of ducks worth 1 and ducks worth 5623 was one undifferentiated
// stream: you could see the colours and you could do nothing about them. It
// takes a stream and splits it in two by value, so "send the good ones to the
// far pit and the rest to the near one" becomes a thing you can build rather
// than a thing you do by hand with a broom.
//
// THE REFINER is what makes the bottom of the ladder worth having. It eats a
// fixed number of ducks and hands back one a rung higher, so a heap of ones is
// a route to the top instead of litter. It refuses to mix rungs: the ducks it
// eats must all be at or above the rung it is working on, which is what stops
// it being a laundry that turns rubbish into treasure at no cost.
//
// No three.js, no Rapier. Impulses go through the same applyImpulse every other
// pusher uses, and nothing here wakes a body without going through ducks.wakeDuck.

const SORTER_KIND = 'sorter';
const REFINER_KIND = 'refiner';
// A duck put in comes out a rung better after a while, one at a time. It is
// the Refiner's opposite trade: the Refiner charges you four ducks and is
// instant, this one charges you nothing but time.
const INCUBATOR_KIND = 'incubator';
// Alternates its output side every duck, so one stream feeds two lines. It is
// the Sorter with the value test taken out, which is why it lives here.
const DIVERTER_KIND = 'diverter';
// Two of them are a pair: a duck that goes into one comes out of the other,
// however far apart they are.
const PIPE_KIND = 'pipe_link';

function num(v, name) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error(`[processors] config.${name} is missing or not a finite number`);
  }
  return v;
}

export function createProcessors({ ducks, applyImpulse, list, byId, config, economy }) {
  const P = {
    sortPush: num(config.processors.sortPush, 'processors.sortPush'),
    sortLift: num(config.processors.sortLift, 'processors.sortLift'),
    sortMaxSpeed: num(config.processors.sortMaxSpeed, 'processors.sortMaxSpeed'),
    sortHeight: num(config.processors.sortHeight, 'processors.sortHeight'),
    refineSeconds: num(config.processors.refineSeconds, 'processors.refineSeconds'),
    refineMouthClear: num(config.processors.refineMouthClear, 'processors.refineMouthClear'),
    refineEjectSpeed: num(config.processors.refineEjectSpeed, 'processors.refineEjectSpeed'),
    pipeExitSpeed: num(config.processors.pipeExitSpeed, 'processors.pipeExitSpeed'),
  };
  const rungs = config.rarity.multipliers;

  // key -> unit. Rebuilt from the placed list every update, exactly like
  // producers and collectors do, so a demolished machine takes its state with it.
  const units = new Map();
  let sorted = 0;
  let refined = 0;
  let events = [];
  let running = true;

  const KINDS = [SORTER_KIND, REFINER_KIND, INCUBATOR_KIND, DIVERTER_KIND, PIPE_KIND];

  function isProcessor(row) {
    return !!row && KINDS.indexOf(row.kind) >= 0;
  }

  function sync() {
    const objs = list() || [];
    const seen = new Set();
    for (let i = 0; i < objs.length; i++) {
      const rec = objs[i];
      const row = byId(rec.id);
      if (!isProcessor(row)) continue;
      seen.add(rec.key);
      let u = units.get(rec.key);
      if (!u) {
        // `threshold` is the rung the player set it to, and it starts in the
        // middle of the ladder rather than at either end: at 0 a sorter sends
        // everything one way and looks broken, and at the top it does the same
        // in the other direction.
        u = { key: rec.key, id: rec.id, threshold: Math.floor(rungs.length / 2), eaten: [], timer: 0, side: 1, holding: null, hold: 0 };
        units.set(rec.key, u);
      }
      u.rec = rec;
      u.row = row;
    }
    if (units.size !== seen.size) {
      for (const key of Array.from(units.keys())) if (!seen.has(key)) units.delete(key);
    }
  }

  // The box a processor acts inside, in world space: its own footprint, at the
  // height a duck rides a belt. Derived from the row rather than authored, so a
  // bigger machine has a bigger throat with no second number to keep in step.
  function zoneOf(u) {
    const f = u.row.footprint;
    const baseY = u.rec.hy === undefined ? u.rec.y : u.rec.y - u.rec.hy;
    return {
      x: u.rec.x, z: u.rec.z,
      yaw: u.rec.yaw || 0,
      hx: f[0] * 0.5, hz: f[2] * 0.5,
      y0: baseY, y1: baseY + P.sortHeight,
    };
  }

  function inZone(z, x, y, dz) {
    if (y < z.y0 || y > z.y1) return false;
    const c = Math.cos(z.yaw);
    const s = Math.sin(z.yaw);
    const ex = x - z.x;
    const ez = dz - z.z;
    const lx = ex * c - ez * s;
    const lz = ex * s + ez * c;
    return Math.abs(lx) <= z.hx && Math.abs(lz) <= z.hz;
  }

  // The other end of this pipe: the nearest pipe that is not this one. Nearest
  // rather than an id the player types, because two pipes in a yard is the
  // common case and a channel number is a thing to get wrong. A third pipe
  // joins whichever pair it is closest to.
  function pipeMate(u) {
    let best = null;
    let bestD = Infinity;
    for (const other of units.values()) {
      if (other === u || other.row.kind !== PIPE_KIND) continue;
      const d = (other.rec.x - u.rec.x) ** 2 + (other.rec.z - u.rec.z) ** 2;
      if (d < bestD) { bestD = d; best = other; }
    }
    return best;
  }

  function update(dt) {
    if (!(dt > 0) || !isFinite(dt)) return 0;
    sync();
    if (units.size === 0) return 0;
    let acted = 0;

    for (const u of units.values()) {
      const z = zoneOf(u);
      const isSorter = u.row.kind === SORTER_KIND;

      if (isSorter) {
        // Local +X is "high value", local -X is "low". Which way round that is
        // in the world follows the machine's own yaw, so turning it swaps the
        // outputs -- which is the only control it needs beyond the threshold.
        const c = Math.cos(z.yaw);
        const s = Math.sin(z.yaw);
        ducks.forEach((id, x, y, dz) => {
          if (!inZone(z, x, y, dz)) return;
          const tier = ducks.tier(id) || 0;
          const dir = tier >= u.threshold ? 1 : -1;
          ducks.wakeDuck(id);
          const body = ducks.body(id);
          if (!body) return;
          const mass = (typeof ducks.massOf === 'function' && ducks.massOf(id)) || 0.11;
          // ALREADY GOING THAT WAY FAST ENOUGH: leave it alone. The shove is
          // applied every frame a duck is in the throat, and without a cap
          // that is an accelerator: measured, six ducks left the machine 6 to
          // 11 m away, which is a sorter that fires its output over the wall
          // it was sorting towards.
          const v = body.linvel();
          const sideways = (v.x * c + v.z * -s) * dir;
          if (sideways >= P.sortMaxSpeed) return;
          // Sideways, and a little up: a duck shoved flat along a belt is a duck
          // the belt drags straight back, which is the whole reason the first
          // version of this did nothing at all.
          applyImpulse(body, {
            x: dir * c * P.sortPush * mass,
            y: P.sortLift * mass,
            z: dir * -s * P.sortPush * mass,
          });
          sorted++;
          acted++;
        });
        continue;
      }

      // --- the diverter -------------------------------------------------------
      // The Sorter's mechanism with the value test removed: it simply alternates
      // which way it throws, so one belt feeds two. A duck is counted once as it
      // leaves, which is what makes the alternation even rather than a function
      // of how long each duck happened to sit in the throat.
      if (u.row.kind === DIVERTER_KIND) {
        const c = Math.cos(z.yaw);
        const s = Math.sin(z.yaw);
        ducks.forEach((id, x, y, dz) => {
          if (!inZone(z, x, y, dz)) return;
          const body = ducks.body(id);
          if (!body) return;
          const v = body.linvel();
          const dir = u.side;
          if ((v.x * c + v.z * -s) * dir >= P.sortMaxSpeed) return;
          ducks.wakeDuck(id);
          const mass = (typeof ducks.massOf === 'function' && ducks.massOf(id)) || 0.11;
          applyImpulse(body, {
            x: dir * c * P.sortPush * mass,
            y: P.sortLift * mass,
            z: dir * -s * P.sortPush * mass,
          });
          u.side = -u.side;
          sorted++;
          acted++;
        });
        continue;
      }

      // --- the pneumatic pipe -------------------------------------------------
      // Two pipes with the same `channel` are one pipe. A duck in the throat of
      // either is moved to the other and shot out of its mouth. Distance costs
      // nothing, which is the entire product: a factory on the far side of the
      // yard stops being a factory you have to walk to.
      if (u.row.kind === PIPE_KIND) {
        const mate = pipeMate(u);
        if (!mate) continue;
        const mz = zoneOf(mate);
        const c2 = Math.cos(mz.yaw);
        const s2 = Math.sin(mz.yaw);
        const lz = mate.row.footprint[2] * 0.5 + P.refineMouthClear;
        ducks.forEach((id, x, y, dz) => {
          if (!inZone(z, x, y, dz)) return;
          const body = ducks.body(id);
          if (!body) return;
          if (!running) return;
          ducks.wakeDuck(id);
          body.setTranslation({
            x: mate.rec.x + s2 * lz, y: mz.y0 + P.sortHeight, z: mate.rec.z + c2 * lz,
          }, true);
          body.setLinvel({ x: s2 * P.pipeExitSpeed, y: 0, z: c2 * P.pipeExitSpeed }, true);
          body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          events.push({ type: 'pipeSend', from: u.key, to: mate.key, id });
          acted++;
        });
        continue;
      }

      // --- the incubator ------------------------------------------------------
      // One duck at a time, and TIME is the whole price. It holds a rung, waits,
      // and hands back a duck one better. Nothing is stored as a body: the duck
      // that went in is released the moment it is accepted, so an incubator
      // that has been sitting there for a minute is not holding the yard's pool
      // hostage.
      if (u.row.kind === INCUBATOR_KIND) {
        if (u.holding === null) {
          ducks.forEach((id, x, y, dz) => {
            if (u.holding !== null) return;
            if (!inZone(z, x, y, dz)) return;
            const tier = ducks.tier(id) || 0;
            if (tier < u.threshold) return;
            if (!running) return;
            u.holding = tier;
            u.hold = 0;
            ducks.release(id);
            events.push({ type: 'incubateIn', key: u.key, tier });
            acted++;
          });
          continue;
        }
        u.hold += dt;
        if (u.hold < u.row.incubate.seconds) continue;
        if (!running) continue;
        const out = Math.min(rungs.length - 1, u.holding + (u.row.incubate.rungs || 1));
        u.holding = null;
        u.hold = 0;
        const c3 = Math.cos(z.yaw);
        const s3 = Math.sin(z.yaw);
        const lz3 = u.row.footprint[2] * 0.5 + P.refineMouthClear;
        const id = ducks.spawn({ x: u.rec.x + s3 * lz3, y: z.y0 + P.sortHeight, z: u.rec.z + c3 * lz3 }, out);
        if (id !== null && id !== undefined && id >= 0) {
          const body = ducks.body(id);
          if (body) body.setLinvel({ x: s3 * P.refineEjectSpeed, y: 0, z: c3 * P.refineEjectSpeed }, true);
          refined++;
          events.push({ type: 'incubateOut', key: u.key, tier: out, id });
          acted++;
        }
        continue;
      }

      // --- the refiner --------------------------------------------------------
      // It eats what is in its throat and, when it has enough, hands back one
      // duck a rung higher. `eaten` holds the RUNGS rather than the ids: the
      // bodies go back to the pool the instant they are swallowed, so a refiner
      // full of ducks costs the yard nothing.
      const need = u.row.refine.count;
      ducks.forEach((id, x, y, dz) => {
        if (u.eaten.length >= need) return;
        if (!inZone(z, x, y, dz)) return;
        const tier = ducks.tier(id) || 0;
        // Below the working rung it is not swallowed. A refiner that ate
        // anything would be a bin with a good reputation.
        if (tier < u.threshold) return;
        if (!running) return;
        u.eaten.push(tier);
        ducks.release(id);
        events.push({ type: 'refineEat', key: u.key, tier, have: u.eaten.length, need });
        acted++;
      });

      if (u.eaten.length < need) { u.timer = 0; continue; }
      u.timer += dt;
      if (u.timer < P.refineSeconds) continue;
      u.timer = 0;
      if (!running) { continue; }
      // One rung above the WORST thing it swallowed, so feeding it a mix does
      // not launder the bad ones -- the result is what the weakest input earned.
      let worst = rungs.length - 1;
      for (const t of u.eaten) if (t < worst) worst = t;
      u.eaten.length = 0;
      const out = Math.min(rungs.length - 1, worst + (u.row.refine.rungs || 1));
      const c2 = Math.cos(z.yaw);
      const s2 = Math.sin(z.yaw);
      const lz = u.row.footprint[2] * 0.5 + P.refineMouthClear;
      const px = u.rec.x + s2 * lz;
      const pz = u.rec.z + c2 * lz;
      const id = ducks.spawn({ x: px, y: z.y0 + P.sortHeight, z: pz }, out);
      if (id !== null && id !== undefined && id >= 0) {
        const body = ducks.body(id);
        if (body) body.setLinvel({ x: s2 * P.refineEjectSpeed, y: 0, z: c2 * P.refineEjectSpeed }, true);
        refined++;
        events.push({ type: 'refineOut', key: u.key, tier: out, id });
        acted++;
      }
    }
    return acted;
  }

  return {
    update,
    count: () => units.size,
    sortedTotal: () => sorted,
    refinedTotal: () => refined,
    setRunning(v) { running = !!v; return running; },
    consumeEvents() {
      if (!events.length) return [];
      const out = events;
      events = [];
      return out;
    },
    // The one control both machines share: which rung they are working at. The
    // player cycles it with the interact key, so it is a number on the machine
    // and not a panel.
    threshold(key) {
      const u = units.get(key);
      return u ? u.threshold : null;
    },
    stepThreshold(key, dir) {
      const u = units.get(key);
      if (!u) return null;
      const n = rungs.length;
      u.threshold = ((u.threshold + (dir >= 0 ? 1 : -1)) % n + n) % n;
      return u.threshold;
    },
    info: () => Array.from(units.values()).map((u) => ({
      key: u.key, id: u.id, kind: u.row.kind, threshold: u.threshold,
      thresholdValue: rungs[u.threshold], have: u.eaten.length,
      need: u.row.refine ? u.row.refine.count : 0,
      x: u.rec.x, y: u.rec.y, z: u.rec.z, yaw: u.rec.yaw,
    })),
    reset() { units.clear(); sorted = 0; refined = 0; events = []; },
  };
}

export default createProcessors;
