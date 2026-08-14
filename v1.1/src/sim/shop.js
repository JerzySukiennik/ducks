// Purchase logic. Pure bookkeeping over the data catalog and the economy:
// no three.js, no Rapier, no DOM. The renderer subscribes with onPurchase and
// drops the bought object out of the tube; this module never knows that.
//
// Every refusal is a short functional reason code resolved through
// src/data/vendor-lines.js. Money is deducted only on success.

import { byId, byTab, TABS, computeStats } from '../data/index.js';
import { lineFor } from '../data/vendor-lines.js';

function roundTo(v, step) {
  const s = step > 0 ? step : 1;
  return Math.round(v / s) * s;
}

// extraEffects() supplies stat effects that were not BOUGHT -- prestige is the
// one, and it is handed in as a function because prestige is created after the
// shop (it has to ask the shop what you own). Everything the shop reports
// through stats() therefore already includes it, which is what keeps prestige
// from becoming a second multiplier nobody remembers to apply.
// stock is src/sim/stock.js and it is OPTIONAL: without one the shop behaves
// exactly as it did before the shelf existed, which is what keeps every test
// that builds a bare shop honest. With one, it is the gate in front of the
// money check -- being out of stock is a harder blocker than being short of
// cash, and telling the player the wrong one of the two wastes their time.
export function createShop({ economy, config, extraEffects, stock }) {
  if (!economy) throw new Error('[shop] economy is required');
  const extra = typeof extraEffects === 'function' ? extraEffects : () => [];
  const shelf = stock || null;
  const cfg = (config && config.shop) || {};
  const refundFractionBase = typeof cfg.refundFraction === 'number' ? cfg.refundFraction : 0.6;
  const rounding = typeof cfg.priceRounding === 'number' ? cfg.priceRounding : 1;
  const maxLevelDefault = typeof cfg.maxLevelDefault === 'number' ? cfg.maxLevelDefault : 1;
  const curveDefault = typeof cfg.curveDefault === 'number' ? cfg.curveDefault : 1.6;

  // id -> levels owned. A placeable is owned 0..n times (n copies placed); an
  // upgrade is owned 0..repeat.times.
  const owned = new Map();
  const listeners = [];
  const refusalListeners = [];

  function levelOf(id) { return owned.get(id) || 0; }

  function ownedLevelTable() {
    const o = {};
    owned.forEach((v, k) => { if (v > 0) o[k] = v; });
    return o;
  }

  // The Salvage Permit is an upgrade whose whole effect is this number, so the
  // refund has to read the live stat table rather than the config constant.
  // 1.0 is a bound, not a tunable: refunding more than the price was paid at
  // would turn demolish into a money printer.
  function refundFractionNow() {
    const s = computeStats(ownedLevelTable(), extra());
    const add = typeof s.refundFractionAdd === 'number' ? s.refundFractionAdd : 0;
    return Math.max(0, Math.min(1, refundFractionBase + add));
  }

  function maxLevelOf(row) {
    if (row.repeat) return row.repeat.times;
    // Placeables are unlimited: you can buy as many walls as you can afford.
    if (row.kind !== 'upgrade') return Infinity;
    return maxLevelDefault;
  }

  function curveOf(row) {
    if (row.repeat) return row.repeat.curve;
    return row.kind === 'upgrade' ? curveDefault : 1;
  }

  // Price of the NEXT purchase given how many are already owned. Placeables
  // have a curve of 1, so their price never moves; upgrades climb.
  function priceOf(id, ownedLevel) {
    const row = byId(id);
    if (!row) return null;
    const lvl = ownedLevel === undefined ? levelOf(id) : Math.max(0, Math.round(ownedLevel));
    const curve = curveOf(row);
    if (curve === 1) return row.cost;
    return roundTo(row.cost * Math.pow(curve, lvl), rounding);
  }

  // reason is the player-facing line; code is the stable machine name. Both
  // come from data, so a new refusal path cannot ship as a blank message.
  function refuse(code, price) {
    return { ok: false, reason: lineFor(code), code, price };
  }

  function canBuy(id) {
    const row = byId(id);
    if (!row) return refuse('unknown_item', 0);
    const lvl = levelOf(id);
    const price = priceOf(id, lvl);
    if (row.cost <= 0) return refuse('not_for_sale', price);
    if (lvl >= maxLevelOf(row)) {
      return refuse(row.kind === 'upgrade' && maxLevelOf(row) > 1 ? 'max_level' : 'already_owned', price);
    }
    // Before the money check on purpose: "out of stock" is the refusal the
    // player cannot fix by earning, so it is the one they need to hear first.
    if (shelf && !shelf.has(id)) return refuse('out_of_stock', price);
    if (!economy.canAfford(price)) return refuse('insufficient', price);
    return { ok: true, reason: null, code: null, price };
  }

  // A REFUSED purchase is an event too, and until now it was only a return
  // value -- so the only way to hear "not enough funds" was to be the caller.
  // A refusal reaches every player's screen in a room; it should reach their
  // ears through the same door.
  function refuseNotify(ev) {
    for (let i = 0; i < refusalListeners.length; i++) {
      try { refusalListeners[i](ev); } catch (e) { /* ignore */ }
    }
  }

  function notify(ev) {
    for (let i = 0; i < listeners.length; i++) {
      // A broken listener must never take a purchase down with it.
      try { listeners[i](ev); } catch (e) { /* ignore */ }
    }
  }

  function buy(id) {
    const check = canBuy(id);
    if (!check.ok) {
      const bad = { ok: false, reason: check.reason, code: check.code, price: check.price, netId: null, level: levelOf(id) };
      refuseNotify({ ...bad, id });
      return bad;
    }
    const row = byId(id);
    // The unit is RESERVED before the money moves and handed back if the spend
    // fails, so there is no window in which the shelf is short a unit nobody
    // paid for. canBuy() already ruled stock out; this is the only place that
    // can still lose the race, and it must not lose it by charging.
    if (shelf && !shelf.take(id, 1)) {
      const bad = { ok: false, reason: lineFor('out_of_stock'), code: 'out_of_stock', price: check.price, netId: null, level: levelOf(id) };
      refuseNotify({ ...bad, id });
      return bad;
    }
    // Money leaves only here, and only after every refusal has been ruled out.
    if (!economy.spend(check.price, 'buy:' + id)) {
      if (shelf) shelf.give(id, 1);
      const bad = { ok: false, reason: lineFor('insufficient'), code: 'insufficient', price: check.price, netId: null, level: levelOf(id) };
      refuseNotify({ ...bad, id });
      return bad;
    }
    const level = levelOf(id) + 1;
    owned.set(id, level);
    const ev = {
      ok: true, reason: null, code: 'ok', message: lineFor('ok'),
      id, netId: row.netId, kind: row.kind, tab: row.tab,
      price: check.price, level, money: economy.money(),
    };
    notify(ev);
    return ev;
  }

  // Demolish / sell back one level. Refunds the price of the level being given
  // up, not the base cost, so an upgrade bought at level 4 refunds level 4.
  function refund(id) {
    const row = byId(id);
    if (!row) return 0;
    const lvl = levelOf(id);
    if (lvl <= 0) return 0;
    const paid = priceOf(id, lvl - 1);
    // Read before the level drops: demolishing a Salvage Permit refunds at the
    // rate it was granting, not the rate left afterwards.
    const amount = Math.floor(paid * refundFractionNow());
    owned.set(id, lvl - 1);
    // The unit goes back on the shelf, capped at what this period rolled. It
    // has to: without it, demolishing the last press you were sold means you
    // cannot rebuild it for three minutes, which turns a misplacement into a
    // punishment. The cap is what stops buy-and-demolish printing shelf space.
    if (shelf) shelf.give(id, 1);
    if (amount > 0) economy.add(amount, 'refund:' + id);
    return amount;
  }

  // Skip the wait. The price is config (shop.rerollCost) and the money moves
  // here rather than in src/sim/stock.js, because the economy has exactly one
  // owner in this codebase and the shelf is not it.
  function rerollStock() {
    if (!shelf) return refuse('no_stock', 0);
    const price = shelf.rerollCost;
    if (!economy.canAfford(price)) return refuse('insufficient', price);
    if (!economy.spend(price, 'reroll:stock')) return refuse('insufficient', price);
    shelf.reroll();
    return {
      ok: true, reason: null, code: 'reroll_ok', message: lineFor('reroll_ok'),
      price, money: economy.money(), period: shelf.periodNo(),
    };
  }

  function refundQuote(id) {
    const row = byId(id);
    if (!row) return 0;
    const lvl = levelOf(id);
    if (lvl <= 0) return 0;
    return Math.floor(priceOf(id, lvl - 1) * refundFractionNow());
  }

  // Restore ownership levels wholesale. This is the ONLY way a snapshot can put
  // the shop back: buy() spends money and fires the purchase listeners, which
  // drop a prop out of the tube and fill a hotbar slot, so replaying purchases
  // would rebuild the levels and corrupt everything around them. This setter
  // touches `owned` and nothing else -- no economy, no listeners.
  //
  // Validation is total and happens BEFORE the map is touched, so a bad table
  // leaves the shop exactly as it was rather than half-applied. An unknown id or
  // a level past the row's ceiling is an ERROR: silently clamping would turn a
  // format mismatch into a quiet desync between host and client.
  function setLevels(table) {
    const t = table || {};
    if (typeof t !== 'object') throw new Error('[shop] setLevels() needs a table of id -> level');
    const next = [];
    const ids = Object.keys(t);
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const row = byId(id);
      if (!row) throw new Error(`[shop] setLevels(): unknown item id '${id}'`);
      const lvl = t[id];
      if (typeof lvl !== 'number' || !isFinite(lvl) || lvl < 0 || Math.round(lvl) !== lvl) {
        throw new Error(`[shop] setLevels(): level for '${id}' must be a non-negative integer, got ${lvl}`);
      }
      const max = maxLevelOf(row);
      if (lvl > max) {
        throw new Error(`[shop] setLevels(): level ${lvl} for '${id}' is above its ceiling of ${max}`);
      }
      next.push([id, lvl]);
    }
    owned.clear();
    for (let i = 0; i < next.length; i++) {
      if (next[i][1] > 0) owned.set(next[i][0], next[i][1]);
    }
    return owned.size;
  }

  function onRefusal(cb) {
    if (typeof cb === 'function') refusalListeners.push(cb);
    return () => {
      const i = refusalListeners.indexOf(cb);
      if (i >= 0) refusalListeners.splice(i, 1);
    };
  }

  function onPurchase(cb) {
    if (typeof cb === 'function') listeners.push(cb);
    return () => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  // Everything a shop UI needs for one tab, already priced and affordability-
  // checked, so the UI never recomputes a price of its own.
  //
  // Sorted CHEAPEST FIRST, here rather than in the UI, for the same reason the
  // prices are computed here: the order a list is read in is a property of the
  // list, and two front ends sorting it separately is two chances to disagree.
  // The key is the price actually shown -- the NEXT purchase's price, which
  // climbs with level -- so an upgrade you have levelled four times moves down
  // the list past the things that are now cheaper than it. Ties fall back to
  // the base cost and then the id, so the order is total and never flickers
  // between two rows that happen to cost the same.
  function listTab(tab) {
    const rows = (byTab[tab] || []).slice();
    const out = rows.map((row) => {
      const c = canBuy(row.id);
      const m = maxLevelOf(row);
      const info = shelf ? shelf.info(row.id) : null;
      return {
        id: row.id, netId: row.netId, name: row.name, desc: row.desc,
        kind: row.kind, model: row.model || null, tags: row.tags,
        price: c.price, affordable: c.ok,
        reason: c.reason, code: c.code,
        // null means unlimited copies, so the payload stays JSON-safe.
        level: levelOf(row.id), maxLevel: Number.isFinite(m) ? m : null, unlimited: !Number.isFinite(m),
        // The shelf, as facts rather than as a rendered string. `stock` is null
        // when there is no stock system at all, which is a different statement
        // from 0 and has to stay distinguishable to whatever draws it.
        stock: info ? info.units : null,
        stocked: info ? info.rolled : null,
        rarity: info ? info.rarity : null,
        baseCost: row.cost,
      };
    });
    out.sort((a, b) => (a.price - b.price) || (a.baseCost - b.baseCost) || (a.id < b.id ? -1 : 1));
    return out;
  }

  return {
    canBuy,
    buy,
    refund,
    refundQuote,
    rerollStock,
    // The shelf itself, for the panel's countdown and for the snapshot. Null
    // when the shop was built without one.
    stock: shelf,
    priceOf,
    onPurchase,
    onRefusal,
    listTab,
    tabs: TABS,
    levelOf,
    setLevels,
    ownedIds: () => Array.from(owned.keys()).filter((k) => owned.get(k) > 0),
    ownedLevels: () => { const o = {}; owned.forEach((v, k) => { if (v > 0) o[k] = v; }); return o; },
    // Live stat table from every upgrade level owned. Single source of truth
    // for "what do my upgrades actually do".
    stats: () => computeStats(ownedLevelTable(), extra()),
    // The same table with nothing but what has been BOUGHT in it, so a screen
    // can show "your upgrades" and "your prestige" as two facts rather than one
    // number that quietly contains both.
    upgradeStats: () => computeStats(ownedLevelTable()),
    refundFraction: refundFractionNow,
    refundFractionBase: () => refundFractionBase,
    reset() { owned.clear(); },
  };
}

export default createShop;
