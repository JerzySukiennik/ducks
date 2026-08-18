// Upgrades tab: no model, no collider, no placement. An upgrade is a price and
// a list of effects, each naming a stat from src/data/stats.js. A stat that is
// not on that closed list is a boot error.
//
// netId block: 120-159.
//
// repeat.times  -- how many levels can be bought (1 means one-shot).
// repeat.curve  -- price multiplier per level already owned.
// Effects are applied once per owned level, so a x1.15 upgrade at level 3 is
// x1.15^3. That is a runtime rule, not per-row data.

export const UPGRADES = [
  {
    id: 'far_pit_deal', netId: 128, name: 'Haulage Contract',
    desc: 'The far pit pays 20% more per level. Only the far one -- it is the one you have to reach.',
    // Priced against the thing it improves rather than against the other
    // upgrades: a level is worth 20% of everything you carry all the way out
    // there, so it is only worth buying once you have transport that goes,
    // and it is worth a great deal the moment you do.
    cost: 2400, kind: 'upgrade',
    repeat: { times: 4, curve: 1.6 },
    effects: [{ stat: 'pit2PayMul', op: 'mul', value: 1.2 }],
    tags: [],
  },
  {
    id: 'long_arms', netId: 120, name: 'Long Arms',
    desc: 'Grab ducks from half a metre further away.',
    cost: 1350, kind: 'upgrade',
    repeat: { times: 3, curve: 1.5 },
    effects: [{ stat: 'grabRangeAdd', op: 'add', value: 0.5 }],
    tags: ['cheap'],
  },
  {
    id: 'swift_hands', netId: 121, name: 'Swift Hands',
    desc: 'Each level cuts crank clicks per duck by 15%.',
    cost: 1900, kind: 'upgrade',
    repeat: { times: 4, curve: 1.7 },
    effects: [{ stat: 'clicksPerDuckMul', op: 'mul', value: 0.85 }],
    tags: [],
  },
  {
    id: 'sturdy_boots', netId: 122, name: 'Sturdy Boots',
    desc: 'Walk 10% faster per level.',
    cost: 2300, kind: 'upgrade',
    repeat: { times: 4, curve: 1.55 },
    effects: [{ stat: 'moveSpeedMul', op: 'mul', value: 1.1 }],
    tags: [],
  },
  {
    id: 'salvage_permit', netId: 123, name: 'Salvage Permit',
    desc: 'Demolishing returns 5 more percentage points per level.',
    cost: 3050, kind: 'upgrade',
    repeat: { times: 2, curve: 2.0 },
    effects: [{ stat: 'refundFractionAdd', op: 'add', value: 0.05 }],
    tags: [],
  },
  {
    id: 'market_valuation', netId: 124, name: 'Market Valuation',
    desc: 'Every duck is worth 15% more per level.',
    cost: 3800, kind: 'upgrade',
    repeat: { times: 8, curve: 1.55 },
    effects: [{ stat: 'duckValueMul', op: 'mul', value: 1.15 }],
    tags: [],
  },
  {
    id: 'lucky_rubber', netId: 125, name: 'Lucky Rubber',
    desc: 'Rare tiers become 20% more likely per level.',
    cost: 6100, kind: 'upgrade',
    repeat: { times: 5, curve: 1.7 },
    effects: [{ stat: 'rarityLuckMul', op: 'mul', value: 1.2 }],
    tags: ['bigticket'],
  },
  {
    id: 'strong_arm', netId: 126, name: 'Strong Arm',
    desc: 'Throw ducks 25% harder. One-off.',
    cost: 1700, kind: 'upgrade',
    repeat: { times: 1, curve: 1 },
    effects: [{ stat: 'throwImpulseMul', op: 'mul', value: 1.25 }],
    tags: [],
  },
  {
    id: 'reinforced_crates', netId: 127, name: 'Reinforced Crates',
    desc: 'Every crate, bucket and container holds 30% more per level.',
    cost: 4950, kind: 'upgrade',
    repeat: { times: 3, curve: 1.8 },
    effects: [{ stat: 'storageCapacityMul', op: 'mul', value: 1.3 }],
    tags: [],
  },
];

export default UPGRADES;
