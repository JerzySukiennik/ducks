// Dev-only: how many ducks would a cavity of a given size hold? Runs the REAL
// buildSlots out of src/sim/containers.js against a fake row, so the answer is
// the one the game will give -- not a second formula that can drift from it.
//
//   import('/work/slot-search.js').then(m => console.log(m.slotsFor(GAME.config, [0.375,0.45,0.375])))
import { createContainers, resolveContainerConfig } from '/src/sim/containers.js';

// A rigid body stub: buildSlots runs at register() time and touches nothing else.
function stubBody() {
  return {
    translation: () => ({ x: 0, y: 0, z: 0 }),
    rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
    setAdditionalMass() {},
    mass: () => 1,
    isSleeping: () => true,
  };
}

const ducksStub = {
  body: () => null,
  isActive: () => false,
  tier: () => 0,
  multiplier: () => 1,
  forEach() {},
  release() {},
  spawn: () => null,
  wakeDuck() {},
};

export function slotsFor(config, half, interior) {
  const c = createContainers({ ducks: ducksStub, config, applyImpulse() {} });
  const row = {
    id: 'probe', netId: 0, name: 'probe', kind: 'storage',
    storage: { capacity: 1, interior },
    collider: { half },
  };
  const rec = c.register(row, stubBody(), { key: 1 });
  const info = c.info(1);
  // Axis counts, recovered from the distinct coordinates the lattice produced.
  const uniq = (k) => new Set(rec.slots.map((s) => s[k].toFixed(6))).size;
  return {
    half, interior: interior || null,
    slots: info.slots,
    n: [uniq('x'), uniq('y'), uniq('z')],
    first: rec.slots[0], last: rec.slots[rec.slots.length - 1],
  };
}

export function cell(config) {
  return resolveContainerConfig(config);
}

export default { slotsFor, cell };
