// Manual workbenches the player has BOUGHT and placed, as opposed to the one
// standing on the plate at boot. Each placed copy gets its own createMachine()
// state, keyed by the placement record's key, so two benches count their clicks
// separately and the starter one is unaffected.
//
// Behaviour is selected by `kind` (producer_manual), never by a row id, and the
// clicks per duck come from the row's own produce block. No three.js, no Rapier,
// no DOM: this module is handed a list of placed records and a row lookup.

import { createMachine } from './machine.js';

const MANUAL_KIND = 'producer_manual';

export function createBenches({ list, byId }) {
  if (typeof list !== 'function') throw new Error('[benches] list() is required');
  if (typeof byId !== 'function') throw new Error('[benches] byId() is required');

  const units = new Map();   // placement key -> { machine, rec, row }
  let clicksMul = 1;
  let produced = 0;

  function isManual(row) {
    return !!row && row.kind === MANUAL_KIND && !!row.produce;
  }

  // Rebuild the working set from the live placed list, exactly as producers.js
  // does: placement and demolition happen elsewhere and this is the only place
  // that notices. A demolished bench takes its click count with it.
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
        u = { machine: createMachine({ clicksPerTurn: row.produce.clicksPerDuck }), produced: 0 };
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
    // Returns the same shape as machine.crank(): { clicks, angle, complete }.
    crank(rec) {
      const u = unitOf(rec);
      if (!u) return null;
      const r = u.machine.crank();
      if (r.complete) { u.produced++; produced++; }
      return r;
    },
    // The pool was at the cap, so the turn is handed back one click short rather
    // than eaten -- the same contract the starter bench keeps.
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
    progress(rec) {
      const u = unitOf(rec);
      return u ? u.machine.progress() : 0;
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
        clicks: u.machine.clicks(),
        clicksPerTurn: u.machine.clicksPerTurn(),
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
