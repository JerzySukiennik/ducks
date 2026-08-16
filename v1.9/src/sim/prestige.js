// Prestige: trade the factory for a permanent multiplier on what a duck pays.
//
// THE RULE, AND THE TRAP IT AVOIDS
// The multiplier is a function of LIFETIME session earnings and is ASSIGNED,
// never compounded:
//
//     multiplier = 1 + (totalEarned / threshold) ^ exponent
//
// The compounding version -- multiply the current multiplier by a fresh factor
// on every run -- was measured in tools/economy-sim.py and is a runaway: once
// income is large the threshold is crossed every tick, each run stands on the
// last, and the simulator recorded 1592 prestiges and a multiplier of `inf`
// inside a minute. Asked instead as one question about the whole session --
// "what has this save earned in total?" -- the curve has a natural ceiling
// (earning 100x as much is only 10x the multiplier) and nothing to farm. Phase E
// measures 2 prestiges and a final x6.25 over a 2-4 hour session.
//
// `totalEarned` is therefore NEVER reset by a prestige. It is the input to the
// formula, not a score of the current run; zeroing it would make every prestige
// after the first arrive at multiplier 1 and the curve would collapse.
//
// WHAT IT COSTS
// Machines, upgrades and money go; buildings stay. That is a frozen product
// decision. Items (bucket, crates, cart) stay too -- the Phase E judgement call
// recorded in work/economy.md. None of it is spelled out here: this module asks
// config.prestige.keep about the row's TAB, so flipping the items decision is a
// 1 to a 0 in config.js and no code change at all. Nothing here branches on a
// row id.
//
// WHAT THIS MODULE DOES NOT DO
// It does not touch the world. Removing the machines standing on the plate is
// the renderer's business, so `onWipe` is handed the predicate and the caller
// does the surgery. That keeps this file free of three.js like the rest of
// src/sim.

import { TABS, STATS } from '../data/index.js';

// The stat prestige feeds. Not a tunable -- it is WHICH existing stat this is,
// and it is verified against the closed list in src/data/stats.js so a typo is a
// boot error rather than a multiplier that silently multiplies nothing.
const PRESTIGE_STAT = 'duckValueMul';
const PRESTIGE_OP = 'mul';

function num(root, path) {
  let node = root;
  const parts = path.split('.');
  for (let i = 0; i < parts.length; i++) {
    if (node === null || typeof node !== 'object' || !(parts[i] in node)) { node = undefined; break; }
    node = node[parts[i]];
  }
  if (typeof node !== 'number' || !isFinite(node)) {
    throw new Error(`[prestige] config.${path} is missing or not a finite number`);
  }
  return node;
}

export function createPrestige({ economy, shop, config, listPlaced, byId, onWipe }) {
  if (!economy) throw new Error('[prestige] economy is required');
  if (!shop) throw new Error('[prestige] shop is required');
  if (typeof byId !== 'function') throw new Error('[prestige] byId() is required');

  const stat = STATS[PRESTIGE_STAT];
  if (!stat) throw new Error(`[prestige] '${PRESTIGE_STAT}' is not a stat in src/data/stats.js`);
  if (stat.ops.indexOf(PRESTIGE_OP) < 0) {
    throw new Error(`[prestige] stat '${PRESTIGE_STAT}' does not accept '${PRESTIGE_OP}'`);
  }

  const P = {
    threshold: num(config, 'prestige.threshold'),
    exponent: num(config, 'prestige.exponent'),
    minGain: num(config, 'prestige.minGain'),
  };
  if (!(P.threshold > 0)) throw new Error('[prestige] config.prestige.threshold must be above zero');

  // Every tab must take a side. A tab with no entry would be silently wiped or
  // silently kept depending on how the lookup happened to be written, which is
  // exactly the kind of decision that must not be made by accident.
  const keepTab = {};
  for (let i = 0; i < TABS.length; i++) {
    keepTab[TABS[i]] = num(config, 'prestige.keep.' + TABS[i]) !== 0;
  }

  const list = typeof listPlaced === 'function' ? listPlaced : () => [];
  const wipeWorld = typeof onWipe === 'function' ? onWipe : () => ({});
  const listeners = [];

  let count = 0;
  let multiplier = 1;

  function announce(reason) {
    const s = state();
    for (let i = 0; i < listeners.length; i++) {
      try { listeners[i](s, reason); } catch (e) { /* a broken listener never eats a prestige */ }
    }
  }

  // True when a row SURVIVES. Reads the row's tab and nothing else.
  function keepsRow(row) {
    if (!row) return true;   // unknown rows are left alone rather than destroyed
    return !!keepTab[row.tab];
  }
  function wipesId(id) {
    return !keepsRow(byId(id));
  }

  // The multiplier this much lifetime earning is worth. Pure function of the
  // economy's lifetime counter -- ASSIGNED, so calling it twice with the same
  // earnings gives the same answer both times.
  function candidate() {
    const earned = Math.max(0, Number(economy.totalEarned ? economy.totalEarned() : 0) || 0);
    return 1 + Math.pow(earned / P.threshold, P.exponent);
  }

  // Everything the player must be shown BEFORE they commit: what they gain, and
  // -- itemised -- what they lose. Losing a factory is never allowed to be a
  // surprise, so the panel that asks for confirmation is fed from here rather
  // than counting anything of its own.
  function quote() {
    const earned = Math.max(0, Number(economy.totalEarned ? economy.totalEarned() : 0) || 0);
    const next = candidate();
    const levels = shop.ownedLevels ? shop.ownedLevels() : {};
    const objects = list() || [];

    const lose = [];
    const keep = [];
    const seen = new Map();
    const ids = Object.keys(levels);
    for (let i = 0; i < ids.length; i++) {
      const row = byId(ids[i]);
      const entry = {
        id: ids[i],
        name: (row && row.name) || ids[i],
        tab: row ? row.tab : null,
        level: levels[ids[i]],
      };
      seen.set(ids[i], entry);
      (keepsRow(row) ? keep : lose).push(entry);
    }
    // Placed copies are counted separately from shop levels: a demolished
    // machine is gone from the plate but its purchase level is still owned, and
    // the player cares about the machines they can see.
    let placedLost = 0;
    let placedKept = 0;
    for (let i = 0; i < objects.length; i++) {
      const row = byId(objects[i].id);
      if (keepsRow(row)) placedKept++; else placedLost++;
    }

    const gain = multiplier > 0 ? next / multiplier : Infinity;
    const enough = earned >= P.threshold;
    const better = gain >= P.minGain;
    return {
      count,
      multiplier,
      next,
      gain,
      totalEarned: earned,
      threshold: P.threshold,
      exponent: P.exponent,
      minGain: P.minGain,
      money: economy.money(),
      available: enough && better,
      reason: enough
        ? (better ? null
          : `Not worth it yet - x${next.toFixed(2)} is only ${gain.toFixed(2)}x your x${multiplier.toFixed(2)}`)
        : `Earn $${Math.ceil(P.threshold - earned).toLocaleString('en-US')} more first`,
      lose,
      keep,
      placedLost,
      placedKept,
      // What the shop would be left owning. The same table take() writes, so
      // the preview cannot disagree with what happens.
      levelsAfter: keptLevels(levels),
    };
  }

  function keptLevels(levels) {
    const out = {};
    const ids = Object.keys(levels || {});
    for (let i = 0; i < ids.length; i++) {
      if (keepsRow(byId(ids[i]))) out[ids[i]] = levels[ids[i]];
    }
    return out;
  }

  // Take it. Money and shop levels are this module's to write; the world is not,
  // so the caller is handed the predicate and reports back what it destroyed.
  function take() {
    const q = quote();
    if (!q.available) return { ok: false, reason: q.reason, quote: q };

    const levels = shop.ownedLevels ? shop.ownedLevels() : {};
    const kept = keptLevels(levels);
    shop.setLevels(kept);
    // The lifetime counter is deliberately untouched: it is the input to the
    // formula. economy.set(0) moves the balance through add(), which would raise
    // `earned` if the balance were going UP -- it is going down, so nothing
    // happens to it here either way.
    economy.set(0);

    const wiped = wipeWorld(wipesId) || {};

    // ASSIGNED, not multiplied. This one line is the whole difference between a
    // curve with a ceiling and the `inf` the simulator recorded.
    multiplier = q.next;
    count++;
    announce('take');

    return {
      ok: true,
      count,
      multiplier,
      previous: q.multiplier,
      gain: q.gain,
      totalEarned: q.totalEarned,
      lost: q.lose,
      kept: q.keep,
      placedRemoved: wiped.placed || 0,
      propsRemoved: wiped.props || 0,
      itemsTaken: wiped.items || 0,
      deliveriesDropped: wiped.deliveries || 0,
      levels: kept,
    };
  }

  // The one line that puts prestige into the stat table. It is an EFFECT, in the
  // same shape an upgrade row uses, folded by the same applyEffects() -- so
  // prestige and Market Valuation stack the way two upgrades stack and there is
  // no second multiplier bolted onto the economy for somebody to forget.
  function effects() {
    if (multiplier === 1) return [];
    return [{ stat: PRESTIGE_STAT, op: PRESTIGE_OP, value: multiplier }];
  }

  function state() {
    return { count, multiplier };
  }

  // Snapshot restore. A joining client is TOLD the multiplier; it never
  // recomputes one from its own copy of the lifetime counter, because the
  // formula is evaluated at the instant a prestige is taken and the counter has
  // moved since.
  function setState(s) {
    if (!s || typeof s !== 'object') return state();
    const n = Number(s.count);
    const m = Number(s.multiplier);
    if (isFinite(n) && n >= 0) count = Math.round(n);
    if (isFinite(m) && m >= 1) multiplier = m;
    announce('set');
    return state();
  }

  return {
    quote,
    take,
    effects,
    state,
    setState,
    candidate,
    count: () => count,
    multiplier: () => multiplier,
    keepsTab: (tab) => !!keepTab[tab],
    wipesId,
    threshold: () => P.threshold,
    exponent: () => P.exponent,
    minGain: () => P.minGain,
    stat: () => PRESTIGE_STAT,
    onChange(cb) {
      if (typeof cb === 'function') listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    reset() { count = 0; multiplier = 1; announce('reset'); },
  };
}

export default createPrestige;
