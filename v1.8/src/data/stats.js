// The closed list of stat names an upgrade effect may target.
// Anything not in here is a boot error, never a silent no-op: a stat that does
// nothing is invisible, and a later phase would tune its value forever without
// ever seeing the game change.
//
// base   -- the identity value with zero upgrades owned.
// ops    -- which operations are legal on this stat. A multiplier stat refuses
//           'add' and an additive stat refuses 'mul', because mixing the two
//           silently changes what a tuning number means.
// reads  -- the config key the runtime should seed the stat from, or null when
//           the stat is a pure modifier the consumer folds in itself.

export const STATS = {
  duckValueMul:      { base: 1,   ops: ['mul', 'set'], reads: 'economy.duckValueMul', desc: 'Multiplies the money a duck pays when it enters the pit.' },
  rarityLuckMul:     { base: 1,   ops: ['mul', 'set'], reads: null,                   desc: 'Multiplies the weight of every rarity tier above the first.' },
  clicksPerDuckMul:  { base: 1,   ops: ['mul', 'set'], reads: null,                   desc: 'Scales the crank clicks needed for one duck. Below 1 is faster.' },
  machineRateMul:    { base: 1,   ops: ['mul', 'set'], reads: null,                   desc: 'Multiplies the output rate of automatic producers.' },
  storageCapacityMul:{ base: 1,   ops: ['mul', 'set'], reads: null,                   desc: 'Multiplies how many ducks a storage item holds.' },
  throwImpulseMul:   { base: 1,   ops: ['mul', 'set'], reads: 'hold.throwImpulse',    desc: 'Multiplies throw impulse.' },
  moveSpeedMul:      { base: 1,   ops: ['mul', 'set'], reads: 'player.walkSpeed',     desc: 'Multiplies walk speed.' },
  grabRangeAdd:      { base: 0,   ops: ['add', 'set'], reads: 'hold.grabRange',       desc: 'Metres added to grab range.' },
  refundFractionAdd: { base: 0,   ops: ['add', 'set'], reads: 'shop.refundFraction',  desc: 'Added to the demolish refund fraction.' },
};

export const STAT_NAMES = Object.keys(STATS);
export const OPS = ['add', 'mul', 'set'];

export function isStat(name) {
  return Object.prototype.hasOwnProperty.call(STATS, name);
}

// Identity table: every stat at its base value.
export function baseStats() {
  const out = {};
  for (const k of STAT_NAMES) out[k] = STATS[k].base;
  return out;
}

// Fold a list of {stat, op, value} onto a stat table. Order inside a stat is
// add, then mul, then set -- so a 'set' always wins and the result of a list
// does not depend on the order rows happen to be authored in.
export function applyEffects(effects, into) {
  const out = into || baseStats();
  const byStat = new Map();
  for (const e of effects) {
    if (!byStat.has(e.stat)) byStat.set(e.stat, []);
    byStat.get(e.stat).push(e);
  }
  const rank = { add: 0, mul: 1, set: 2 };
  for (const [stat, list] of byStat) {
    list.sort((a, b) => rank[a.op] - rank[b.op]);
    for (const e of list) {
      if (e.op === 'add') out[stat] += e.value;
      else if (e.op === 'mul') out[stat] *= e.value;
      else out[stat] = e.value;
    }
  }
  return out;
}

export default STATS;
