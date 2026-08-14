// Manual workbenches the player has BOUGHT and placed, as opposed to the one
// standing on the plate at boot. Each placed copy gets its own createMachine()
// state, keyed by the placement record's key, so two benches hold their charge
// separately and the starter one is unaffected.
//
// Behaviour is selected by `kind` (producer_manual), never by a row id, and how
// long a bench takes comes from the row's own produce block. No three.js, no
// Rapier, no DOM: this module is handed a list of placed records, a row lookup
// and the tuning numbers (main.js reads config; src/sim/** does not).

import { createMachine } from './machine.js';

const MANUAL_KIND = 'producer_manual';

export function createBenches({ list, byId, machine }) {
  if (typeof list !== 'function') throw new Error('[benches] list() is required');
  if (typeof byId !== 'function') throw new Error('[benches] byId() is required');
  const tuning = machine || {};

  const units = new Map();   // placement key -> { machine, rec, row, produced }
  let clicksMul = 1;
  let produced = 0;

  function isManual(row) {
    return !!row && row.kind === MANUAL_KIND && !!row.produce;
  }

  // A bought bench still declares its cost in CLICKS in the catalog, because the
  // catalog is not this builder's to edit and a row saying `clicksPerDuck: 10`
  // is a rate, not a control scheme. It is read as a RATIO against the standard
  // wheel: a row asking for twice the clicks takes twice the seconds. A row that
  // matches the standard (which every current one does) is exactly the starter
  // bench's five seconds.
  function secondsFor(row) {
    const nominal = Math.max(1, Math.round(Number(tuning.clicksPerTurn) || 10));
    const base = Number(tuning.secondsPerDuck);
    const seconds = isFinite(base) && base > 0 ? base : 5;
    const rowClicks = Number(row && row.produce && row.produce.clicksPerDuck);
    const factor = isFinite(rowClicks) && rowClicks > 0 ? rowClicks / nominal : 1;
    return seconds * factor;
  }

  // Rebuild the working set from the live placed list, exactly as producers.js
  // does: placement and demolition happen elsewhere and this is the only place
  // that notices. A demolished bench takes its charge with it.
  function sync() {
    const objs = list() || [];
    const seen = new Set();
    for (let i = 0; i < objs.length; i++) {
      const rec = objs[i];
      const row = byId(rec.id);
      if (!isManual(row)) continue;
      seen.add(rec.key);
      let u = units.get(rec.key);
      if (!u) {
        u = {
          machine: createMachine({ ...tuning, secondsPerDuck: secondsFor(row) }),
          produced: 0,
        };
        u.machine.setClicksPerDuck(clicksMul);
        units.set(rec.key, u);
      }
      u.rec = rec;
      u.row = row;
    }
    if (units.size !== seen.size) {
      for (const key of Array.from(units.keys())) if (!seen.has(key)) units.delete(key);
    }
  }

  function unitOf(rec) {
    if (!rec) return null;
    sync();
    return units.get(rec.key) || null;
  }

  return {
    sync,
    has: (rec) => !!unitOf(rec),
    // One step of held time on ONE bench. Same shape as machine.hold().
    hold(rec, dt, holders) {
      const u = unitOf(rec);
      if (!u) return null;
      const r = u.machine.hold(dt, holders);
      if (r.pops) { u.produced += r.pops; produced += r.pops; }
      return r;
    },
    // The pool was at the cap, so the bar is handed back full rather than eaten
    // -- the same contract the starter bench keeps.
    refund(rec) {
      const u = unitOf(rec);
      if (!u) return 0;
      u.produced = Math.max(0, u.produced - 1);
      produced = Math.max(0, produced - 1);
      return u.machine.refund();
    },
    angle(rec) {
      const u = unitOf(rec);
      return u ? u.machine.angle() : 0;
    },
    omega(rec) {
      const u = unitOf(rec);
      return u ? u.machine.omega() : 0;
    },
    progress(rec) {
      const u = unitOf(rec);
      return u ? u.machine.progress() : 0;
    },
    momentum(rec) {
      const u = unitOf(rec);
      return u ? u.machine.momentum() : 1;
    },
    secondsPerDuck(rec) {
      const u = unitOf(rec);
      return u ? u.machine.secondsPerDuck() : 0;
    },
    // clicksPerDuckMul (Swift Hands) reaches every bench, not only the starter.
    setClicksPerDuck(mul) {
      clicksMul = typeof mul === 'number' && isFinite(mul) && mul > 0 ? mul : 1;
      sync();
      units.forEach((u) => u.machine.setClicksPerDuck(clicksMul));
      return clicksMul;
    },
    count: () => { sync(); return units.size; },
    producedTotal: () => produced,
    info() {
      sync();
      const out = [];
      units.forEach((u, key) => out.push({
        key,
        id: u.rec.id,
        x: u.rec.x, y: u.rec.y, z: u.rec.z, yaw: u.rec.yaw,
        progress: u.machine.progress(),
        momentum: u.machine.momentum(),
        secondsPerDuck: u.machine.secondsPerDuck(),
        omega: u.machine.omega(),
        turns: u.machine.turns(),
        angleDegrees: u.machine.angleDegrees(),
        produced: u.produced,
      }));
      return out;
    },
    reset() { units.clear(); produced = 0; },
  };
}

export default createBenches;
