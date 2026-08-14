// What the vendor actually HAS on the shelf right now.
//
// Pure bookkeeping: no DOM, no three.js, no Rapier, no imports from the render
// or net layers. It is handed the catalog rows and a config block and it owns
// exactly two facts -- how many units of each row are left in the current
// period, and how far into that period we are.
//
// The rule the whole model exists to serve: RARER THINGS RESTOCK LESS OFTEN,
// and rare enough means sometimes not at all (0 units, the row is simply not
// for sale until the shelf turns over). "Rarer" is DERIVED, never listed:
// a hand-written table of ids would have to be edited every time a row is added
// and would silently disagree with the catalog the first time a price moved.
// Three facts the rows already carry decide it:
//
//   cost          the catalog's own price ladder, on a log scale between the
//                 cheapest and the dearest row that exists. $10 and $1200 are
//                 the ends; everything else lands between them.
//   repeat.times  how many copies the game will EVER let you own. A row capped
//                 at 1 is a one-off permit; a row capped at 60 is bulk stock.
//                 A row with no repeat block is unlimited and therefore not
//                 scarce by design, so it scores 0 here.
//   tab           a per-tab bias, four numbers in config. Buildings are
//                 construction material and always plentiful; upgrades are
//                 paperwork the vendor gets a few of. This is the same shape as
//                 config.prestige.keep -- a flag per tab, not a branch on an id.
//
// Both ends of the cost and limit scales are read off the catalog itself, so
// adding a $5000 row re-normalises everything instead of pinning the top of the
// scale to a number written down in 2026.

function clamp01(v) {
  return v < 0 ? 0 : (v > 1 ? 1 : v);
}

function num(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

// rows: the catalog (id, cost, tab, repeat). config: the whole config object.
// random: injectable so a test can measure the distribution against a known
// stream; defaults to Math.random because only the HOST ever rolls and the
// result travels to everyone else as data.
export function createStock({ rows, config, random }) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('[stock] rows are required');
  const cfg = (config && config.shop) || {};
  const s = cfg.stock || {};
  const rng = typeof random === 'function' ? random : Math.random;

  const period = num(cfg.stockSeconds, 180);
  const rerollCost = num(cfg.rerollCost, 100);
  const costWeight = num(s.costWeight, 0.6);
  const limitWeight = num(s.limitWeight, 0.25);
  const zeroMax = num(s.zeroMax, 0.55);
  const zeroShape = num(s.zeroShape, 2.2);
  const unitsMax = num(s.unitsMax, 14);
  const unitsShape = num(s.unitsShape, 1.4);
  const tabBias = s.tabBias || {};

  // --- the two scales, read off the catalog ---------------------------------
  const sellable = rows.filter((r) => num(r.cost, 0) > 0);
  if (!sellable.length) throw new Error('[stock] no row in the catalog has a price');
  let minCost = Infinity;
  let maxCost = 0;
  let maxTimes = 1;
  for (let i = 0; i < sellable.length; i++) {
    const c = sellable[i].cost;
    if (c < minCost) minCost = c;
    if (c > maxCost) maxCost = c;
    const t = sellable[i].repeat ? sellable[i].repeat.times : 0;
    if (t > maxTimes) maxTimes = t;
  }
  // A one-row catalog, or one where every row costs the same, has no ladder to
  // climb; the span falls back to 1 so the score is 0 for everything rather
  // than NaN for everything.
  const costSpan = maxCost > minCost ? Math.log(maxCost / minCost) : 1;
  const timeSpan = maxTimes > 1 ? Math.log(maxTimes) : 1;

  function rarityOf(row) {
    const cost = num(row.cost, 0);
    if (cost <= 0) return 0;
    const costScore = clamp01(Math.log(cost / minCost) / costSpan);
    // No repeat block means unlimited copies: the game never rations it, so
    // neither does the vendor.
    const limitScore = row.repeat && row.repeat.times > 0
      ? clamp01(1 - Math.log(row.repeat.times) / timeSpan)
      : 0;
    const bias = num(tabBias[row.tab], 0);
    return clamp01(costWeight * costScore + limitWeight * limitScore + bias);
  }

  // The chance this row simply is not on the shelf this period. It is the whole
  // "rarer things restock less often" rule in one line: a power curve, so the
  // cheap end stays near zero (a starter item must almost never be missing --
  // work/economy.md's opening depends on the bucket being buyable at 2:24)
  // while the expensive end climbs steeply.
  function zeroChanceOf(rarity) {
    return clamp01(zeroMax * Math.pow(rarity, zeroShape));
  }

  // How many units the shelf can hold for this row when it is stocked at all.
  // Never below 1: a row that is present is present in at least one unit, and
  // "present but unbuyable" is a state with no meaning.
  function capOf(rarity) {
    return Math.max(1, Math.round(unitsMax * Math.pow(1 - rarity, unitsShape)));
  }

  const meta = new Map();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rarity = rarityOf(row);
    meta.set(row.id, {
      id: row.id,
      cost: num(row.cost, 0),
      tab: row.tab,
      rarity,
      zeroChance: num(row.cost, 0) > 0 ? zeroChanceOf(rarity) : 0,
      cap: capOf(rarity),
    });
  }

  // `rolled` is what the period STARTED with, `units` is what is left. Both are
  // kept because a refund puts a unit back on the shelf and must not be able to
  // push it above what was rolled -- otherwise demolish/rebuy would be a way to
  // farm stock out of nothing.
  const rolled = new Map();
  const units = new Map();
  let elapsed = 0;
  let periodNo = 0;
  const listeners = [];

  function notify(cause) {
    for (let i = 0; i < listeners.length; i++) {
      try { listeners[i]({ cause, period: periodNo, elapsed }); } catch (e) { /* ignore */ }
    }
  }

  function rollOne(id) {
    const m = meta.get(id);
    if (!m) return 0;
    // A row with no price is never sold through the shop at all; giving it a
    // unit count would be inventing a state nothing reads.
    if (m.cost <= 0) return 0;
    if (rng() < m.zeroChance) return 0;
    return 1 + Math.floor(rng() * m.cap);
  }

  // Roll the whole shelf and start a fresh period. The ONE place units are ever
  // created; both the timer running out and a paid reroll come through here.
  function roll(cause) {
    rolled.clear();
    units.clear();
    meta.forEach((m, id) => {
      const n = rollOne(id);
      rolled.set(id, n);
      units.set(id, n);
    });
    elapsed = 0;
    periodNo++;
    notify(cause || 'roll');
    return unitTable();
  }

  function unitTable() {
    const out = {};
    units.forEach((v, k) => { out[k] = v; });
    return out;
  }

  function rolledTable() {
    const out = {};
    rolled.forEach((v, k) => { out[k] = v; });
    return out;
  }

  // dt seconds of simulation time. `allowRoll` is the multiplayer rule made
  // explicit: the HOST owns the shelf, so a client ticks the same clock for its
  // countdown but never rolls -- its units arrive from the host like every other
  // world fact. Clamped at the period end there rather than wrapping, because a
  // client whose timer silently restarted would show a full shelf that does not
  // exist.
  function advance(dt, allowRoll) {
    const d = num(dt, 0);
    if (d <= 0) return false;
    elapsed += d;
    if (elapsed < period) return false;
    if (allowRoll === false) { elapsed = period; return false; }
    // One roll per call however far behind the clock is: a tab that was hidden
    // for an hour should find a fresh shelf, not sixty of them.
    roll('period');
    return true;
  }

  function unitsOf(id) {
    const v = units.get(id);
    return typeof v === 'number' ? v : 0;
  }

  function take(id, n) {
    const want = Math.max(1, Math.round(num(n, 1)));
    const have = unitsOf(id);
    if (have < want) return false;
    units.set(id, have - want);
    notify('take');
    return true;
  }

  // A refund puts the unit back where it came from, capped at what this period
  // rolled. Without the cap, buy-and-demolish would print shelf space.
  function give(id, n) {
    if (!meta.has(id)) return false;
    const want = Math.max(1, Math.round(num(n, 1)));
    const max = rolled.has(id) ? rolled.get(id) : 0;
    const next = Math.min(max, unitsOf(id) + want);
    if (next === unitsOf(id)) return false;
    units.set(id, next);
    notify('give');
    return true;
  }

  // Restore wholesale from a snapshot or a host broadcast. Like shop.setLevels()
  // this is the ONLY way a client's shelf changes: it writes the tables and
  // nothing else, and it never rolls.
  function setTable(t) {
    const table = t || {};
    const u = table.units || {};
    const r = table.rolled || u;
    rolled.clear();
    units.clear();
    meta.forEach((m, id) => {
      const rv = Math.max(0, Math.round(num(r[id], 0)));
      const uv = Math.max(0, Math.min(rv, Math.round(num(u[id], 0))));
      rolled.set(id, rv);
      units.set(id, uv);
    });
    elapsed = Math.max(0, Math.min(period, num(table.elapsed, 0)));
    periodNo = Math.max(0, Math.round(num(table.period, periodNo)));
    notify('set');
    return units.size;
  }

  // The first shelf. Called at boot so the vendor is never empty on frame one.
  roll('boot');

  return {
    period,
    rerollCost,
    advance,
    roll,
    reroll() { return roll('reroll'); },
    units: unitsOf,
    has: (id) => unitsOf(id) > 0,
    take,
    give,
    // Everything the UI and the tests want to know about one row, without any
    // of them recomputing a rarity of their own.
    info(id) {
      const m = meta.get(id);
      if (!m) return null;
      return {
        id, rarity: m.rarity, zeroChance: m.zeroChance, cap: m.cap,
        units: unitsOf(id), rolled: rolled.has(id) ? rolled.get(id) : 0,
      };
    },
    rarity: (id) => (meta.has(id) ? meta.get(id).rarity : 0),
    zeroChance: (id) => (meta.has(id) ? meta.get(id).zeroChance : 0),
    secondsLeft: () => Math.max(0, period - elapsed),
    secondsInto: () => elapsed,
    periodNo: () => periodNo,
    table: () => ({ elapsed, period: periodNo, units: unitTable(), rolled: rolledTable() }),
    setTable,
    onChange(cb) {
      if (typeof cb === 'function') listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    // The signature the host's reconciler diffs and the UI re-renders on. It
    // deliberately excludes `elapsed`, which changes every frame and would make
    // a 20 Hz broadcast out of a shelf that turns over every three minutes.
    signature() {
      let sig = periodNo + ':';
      meta.forEach((m, id) => { sig += id + '=' + unitsOf(id) + ','; });
      return sig;
    },
  };
}

export default createStock;
