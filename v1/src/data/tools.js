// Items tab: things you carry, fill, push or hold. netId block: 100-119.
//
// `storage` rows hold ducks; `carry` rows are pushed; `tool` rows take over the
// grab button while held. Capacity numbers here are raw -- the runtime scales
// them by the storageCapacityMul stat, so an upgrade never has to edit a row.
//
// A `tool` row states its behaviour in `tool.mode`: 'sweep' pushes everything in
// the arc, 'beam' takes one duck at a time. It is a declared field and not
// inferred from the arc width, so a wide-arc beam or a narrow sweep is simply a
// row someone may write; an unknown mode is a boot error (src/data/index.js).
//
// `footprint` is the EXPORTED GLB bounding box, measured back out of
// assets/models/*.glb, in the game's Y-up order [x, height, depth]; both
// horizontal numbers are exact multiples of config.build.grid and
// `collider.half` is exactly half of them (the contract at the top of
// machines.js). `storage.interior` is the row's INNER CAVITY: the half-extents
// and centre offset of the space that actually holds ducks, which is not the
// bounding box for anything with handles, legs or a wheel. Both come from
// tools/blender-models.py, which prints the cavity through the same grid-snap
// scale it puts the mesh through -- authoring either by hand is how they drift.
//
// The sizes are what they are because a duck is 0.178 x 0.386 x 0.146 m and
// src/sim/containers.js will not pack two of them closer than that. The old
// bucket was 0.50 x 0.601 x 0.50: exactly one duck tall and two wide, so it
// showed two of the eight it claimed. Places each cavity offers, against the
// capacity on the row:
//
//   bucket   12 places, capacity  8      box_big  32 places, capacity 30
//   box      20 places, capacity 16      cart     28 places, capacity 24
//   container 576 places, capacity 200 (25 physical, the rest virtual)
//
// A `hand` block is what makes a row CARRYABLE: it may be picked up off the
// floor with E, it occupies a hotbar slot, it is drawn in the player's hands
// while selected, and Q throws it back out as a physical prop. The block is the
// model's pose in view space -- right/up/forward from the camera, degrees, and
// a scale -- because "what does it look like in my hands" is content, not code.
// Anything the block omits comes from config.hand, so a new carryable needs one
// line, and a row with no block cannot be carried at all.

export const TOOLS = [
  {
    id: 'bucket', netId: 100, tab: 'items', name: 'Bucket',
    desc: 'Holds about ten ducks. Tip it into the pit.',
    cost: 25, model: 'bucket', footprint: [0.75, 0.95, 0.75], anchor: 'floor',
    kind: 'storage',
    storage: {
      capacity: 8, tipToEmpty: true,
      // Square INSCRIBED in the pail's inner radius: the lattice is rectangular
      // and the bucket is round, so a corner slot sized off the diameter would
      // stand its duck in the wall.
      interior: { half: [0.2411, 0.4225, 0.2411], offset: [0, -0.0075, 0] },
    },
    collider: { shape: 'cuboid', half: [0.375, 0.475, 0.375], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    // Scale trails the model: the pail grew 1.5x on every axis, so holding it at
    // the old 0.65 would fill half the screen.
    hand: { pos: [0.54, -0.40, -0.98], rotDeg: [4, 0, -10], scale: 0.40 },
    tags: ['cheap', 'carryable'],
  },
  {
    id: 'box', netId: 101, tab: 'items', name: 'Crate',
    desc: 'Holds about twenty five ducks.',
    cost: 45, model: 'box', footprint: [1.00, 0.75, 1.00], anchor: 'floor',
    kind: 'storage',
    storage: {
      capacity: 16, tipToEmpty: true,
      // Inside the slats, floor to wall top. The corner posts run 0.05 above
      // the walls and set the bounding box, so the cavity is shorter than half
      // the footprint height by exactly that much.
      interior: { half: [0.4333, 0.3225, 0.4333], offset: [0, 0.0025, 0] },
    },
    collider: { shape: 'cuboid', half: [0.50, 0.375, 0.50], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: ['carryable'],
  },
  {
    id: 'box_big', netId: 102, tab: 'items', name: 'Large Crate',
    desc: 'Holds about sixty ducks. Heavy.',
    cost: 120, model: 'box_big', footprint: [1.25, 1.10, 1.25], anchor: 'floor',
    kind: 'storage',
    storage: {
      capacity: 30, tipToEmpty: true,
      interior: { half: [0.5426, 0.49, 0.5426], offset: [0, 0.01, 0] },
    },
    collider: { shape: 'cuboid', half: [0.625, 0.55, 0.625], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'container', netId: 103, tab: 'items', name: 'Container',
    desc: 'Two hundred ducks in one box. The first thing worth saving for.',
    cost: 1200, model: 'container', footprint: [2.25, 2.00, 4.50], anchor: 'floor',
    kind: 'storage',
    // The only storage row NOT resized: 2.25 x 2.00 x 4.50 already offers 576
    // places, and only containers.physicalLimit (25) of the 200 it holds are
    // ever real bodies. It was never short of room; it was short of a lattice
    // that knew how big a duck is.
    storage: {
      capacity: 200, tipToEmpty: false,
      interior: { half: [0.9825, 0.90, 2.1047], offset: [0, 0, 0] },
    },
    collider: { shape: 'cuboid', half: [1.125, 1.00, 2.25], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: ['bigticket'],
  },
  {
    id: 'cart', netId: 110, tab: 'items', name: 'Cart',
    desc: 'Push it. Whatever is in it comes along.',
    cost: 180, model: 'cart', footprint: [1.25, 1.01, 2.25], anchor: 'floor',
    kind: 'carry',
    storage: {
      capacity: 24, tipToEmpty: true,
      // THE row this block exists for. The barrow's bounding box is mostly
      // shafts reaching 1.5 m behind it and a wheel 0.3 m in front; its ducks
      // belong in the tray, which is a third of that box and sits well above
      // its centre. Sized off the box, the lattice hung two thirds of a
      // cartload in the air beside the barrow.
      interior: { half: [0.4605, 0.28, 0.7074], offset: [0, 0.225, -0.2131] },
    },
    collider: { shape: 'cuboid', half: [0.625, 0.505, 1.125], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'broom', netId: 111, tab: 'items', name: 'Broom',
    desc: 'Sweeps a wide arc of ducks in front of you.',
    cost: 90, model: 'broom', footprint: [0.50, 1.52, 0.25], anchor: 'floor',
    kind: 'tool',
    tool: { mode: 'sweep', reach: 1.8, arc: 110, force: 6 },
    collider: { shape: 'cuboid', half: [0.25, 0.76, 0.125], blockDucks: false },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    // Held like a broom is held: butt of the handle up and to the right, head
    // down and forward into the sweep arc the tool actually pushes along.
    hand: { pos: [0.42, 0.04, -0.78], rotDeg: [28, -18, -35], scale: 0.5 },
    tags: ['handheld'],
  },
  {
    id: 'vacuum', netId: 112, tab: 'items', name: 'Handheld Vacuum',
    desc: 'Sucks ducks up one at a time, then hoses them where you point.',
    cost: 260, model: 'vacuum', footprint: [0.25, 0.728, 1.00], anchor: 'floor',
    kind: 'tool',
    tool: { mode: 'beam', reach: 4.0, arc: 20, force: 14 },
    collider: { shape: 'cuboid', half: [0.125, 0.364, 0.50], blockDucks: false },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    // The nozzle points where the beam does: down the camera's forward axis.
    hand: { pos: [0.44, -0.16, -0.78], rotDeg: [-14, 200, 10], scale: 0.6 },
    tags: ['handheld'],
  },
];

export default TOOLS;
