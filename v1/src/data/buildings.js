// Buildings tab: static geometry the player places to shape where ducks go.
// netId block: 60-99.
//
// Footprints obey the grid contract described at the top of machines.js: both
// horizontal numbers are exact multiples of config.build.grid (0.25 m). Wall is
// 2.00 and not 2.25 on purpose -- both tile, but 2.00 is an EVEN multiple, so
// its half-extent (1.00) is itself on the grid and a wall closes flush against
// another wall AND against the 1.00 m corner. A fence has no holes any more; it
// used to have one of 0.19 m every 2.25 m, and a duck is 0.20 x 0.18 x 0.14.

export const BUILDINGS = [
  {
    id: 'wall', netId: 60, tab: 'buildings', name: 'Wall',
    desc: 'Two metres of low wall. Stops ducks rolling away.',
    cost: 35, model: 'wall', footprint: [2.00, 1.065, 0.25], anchor: 'floor',
    kind: 'wall',
    collider: { shape: 'cuboid', half: [1.00, 0.5325, 0.125], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: ['cheap'],
  },
  {
    id: 'wall_high', netId: 61, tab: 'buildings', name: 'High Wall',
    desc: 'Same footprint, two and a half times the height.',
    cost: 70, model: 'wall_high', footprint: [2.00, 2.665, 0.25], anchor: 'floor',
    kind: 'wall',
    collider: { shape: 'cuboid', half: [1.00, 1.3325, 0.125], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'rail', netId: 62, tab: 'buildings', name: 'Rail',
    desc: 'Knee-high kerb. The cheapest way to fence a run.',
    cost: 15, model: 'rail', footprint: [2.00, 0.35, 0.25], anchor: 'floor',
    kind: 'wall',
    collider: { shape: 'cuboid', half: [1.00, 0.175, 0.125], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: ['cheap'],
  },
  {
    id: 'corner', netId: 63, tab: 'buildings', name: 'Corner',
    desc: 'Closes a ninety degree join without leaving a gap.',
    cost: 40, model: 'corner', footprint: [1.00, 1.10, 1.00], anchor: 'floor',
    kind: 'wall',
    collider: { shape: 'cuboid', half: [0.50, 0.55, 0.50], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'pillar', netId: 64, tab: 'buildings', name: 'Pillar',
    desc: 'Vertical support. Holds a bridge up.',
    cost: 55, model: 'pillar', footprint: [0.50, 2.46, 0.50], anchor: 'floor',
    kind: 'wall',
    collider: { shape: 'cuboid', half: [0.25, 1.23, 0.25], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'ramp', netId: 65, tab: 'buildings', name: 'Ramp',
    desc: 'Ducks roll down it. So do you.',
    cost: 60, model: 'ramp', footprint: [1.50, 0.92, 2.00], anchor: 'floor',
    kind: 'ramp',
    slope: { rise: 0.92, run: 2.00 },
    // `half` is the PLACEMENT box: what the grid, the overlap test and the model
    // seating use. `surface` is the PHYSICS collider and may be a different
    // shape entirely -- here a thin sloped slab instead of the upright block the
    // footprint describes. As a block there is no bottom of the ramp to climb
    // from, so a duck can only ever be on top of it: it looks like a ramp and
    // acts like a wall. pitchDegrees is negative because the model's high end is
    // at +Z, measured off the mesh (max Y is 0.00 at -Z and 0.92 at +Z) rather
    // than guessed from the name.
    //
    // BOTH surface numbers were recomputed when the ramp went from 1.66 x 2.04
    // to 1.50 x 2.00. The height (0.92) did not change -- the grid snap scales
    // only the two horizontal axes -- so the slab got steeper, not shorter:
    //   half[0] = 1.50 / 2                       = 0.75   (was 0.83)
    //   half[2] = hypot(run 2.00, rise 0.92) / 2 = 1.1007 (was 1.119)
    //   pitch   = -atan2(0.92, 2.00)             = -24.703 deg (was -24.27)
    // half[1] (0.06, the slab's thickness) is a physics choice, not a measured
    // dimension, so it stays put.
    collider: {
      shape: 'cuboid', half: [0.75, 0.46, 1.00], blockDucks: true,
      surface: { half: [0.75, 0.06, 1.1007], pitchDegrees: -24.703, offsetY: 0 },
    },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'chute', netId: 66, tab: 'buildings', name: 'Chute',
    desc: 'Half-pipe channel. Keeps a stream of ducks on one line.',
    cost: 80, model: 'chute', footprint: [0.75, 0.53, 2.00], anchor: 'floor',
    kind: 'ramp',
    slope: { rise: 0, run: 2.00 },
    collider: { shape: 'cuboid', half: [0.375, 0.265, 1.00], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'bridge', netId: 67, tab: 'buildings', name: 'Bridge',
    desc: 'Spans three metres. Walk over the pit instead of around it.',
    cost: 140, model: 'bridge', footprint: [1.00, 1.455, 3.00], anchor: 'floor',
    kind: 'ramp',
    slope: { rise: 0, run: 3.00 },
    collider: { shape: 'cuboid', half: [0.50, 0.7275, 1.50], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
];

export default BUILDINGS;
