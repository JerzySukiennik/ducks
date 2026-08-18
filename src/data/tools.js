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
// The phase 1 containers, derived the same way (see the block above their
// rows): sack 4 places / capacity 5, bucket_leaky 2 / 10, crate_wood 20 / 22,
// dumper 42 / 34, pallet_jack 36 / 44.
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
    id: 'bucket', netId: 100, name: 'Bucket',
    desc: 'Holds eight ducks. Tip it into the pit.',
    cost: 190, model: 'bucket', footprint: [0.75, 0.95, 0.75], anchor: 'floor',
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
    id: 'box', netId: 101, name: 'Crate',
    desc: 'Holds sixteen ducks.',
    cost: 340, model: 'box', footprint: [1.00, 0.75, 1.00], anchor: 'floor',
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
    id: 'box_big', netId: 102, name: 'Large Crate',
    desc: 'Holds thirty ducks. Heavy.',
    cost: 920, model: 'box_big', footprint: [1.25, 1.10, 1.25], anchor: 'floor',
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
    id: 'container', netId: 103, name: 'Container',
    desc: 'Two hundred ducks in one box. The first thing worth saving for.',
    cost: 9150, model: 'container', footprint: [2.25, 2.00, 4.50], anchor: 'floor',
    kind: 'storage',
    // The only storage row NOT resized: 2.25 x 2.00 x 4.50 already offers 576
    // places, and only containers.physicalLimit (25) of the 200 it holds are
    // ever real bodies. It was never short of room; it was short of a lattice
    // that knew how big a duck is.
    storage: {
      capacity: 200, tipToEmpty: false,
      interior: { half: [0.9825, 0.90, 2.1047], offset: [0, 0, 0] },
    },
    // THE row the aperture block exists for. The model has a doorway cut into
    // its +Z face and, until this was written, nothing but the mesh knew: the
    // collider was one solid brick across the whole opening, so a belt aimed at
    // the mouth pushed ducks into a wall the player could see straight through.
    //
    // Every number is measured off the exported GLB, in the collider box's own
    // frame (origin at the box centre, so 1.00 above the floor):
    //   clear span   0.9825 wide x 0.900 tall -- x -0.4913..+0.4913,
    //                floor y 0.340..1.240, i.e. local y -0.660..-0.240+0.450
    //   centre       (0, 0.790) off the floor -> local up -0.21
    //   mouth plane  the +Z face of the collider, z = +2.25
    //
    // `depth` is how far the recess is bored in, and it is 0.35 rather than the
    // 0.1002 the wall is actually thick for a measured reason: a duck is 0.146 m
    // deep, so a recess only as deep as the wall could never hold one clear of
    // the mouth plane, and a duck the box refuses (because it is full) would be
    // left half inside a solid face. At 0.35 a refused duck comes to rest on the
    // sill, in the doorway, where the player can see the box is full.
    collider: {
      shape: 'cuboid', half: [1.125, 1.00, 2.25], blockDucks: true,
      aperture: { face: '+z', center: [0, -0.21], half: [0.49125, 0.45], depth: 0.35 },
    },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: ['bigticket'],
  },
  {
    id: 'cart', netId: 110, name: 'Cart',
    desc: 'Push it. Whatever is in it comes along.',
    cost: 1350, model: 'cart', footprint: [1.25, 1.01, 2.25], anchor: 'floor',
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
    id: 'broom', netId: 111, name: 'Broom',
    desc: 'Sweeps a wide arc of ducks in front of you.',
    cost: 690, model: 'broom', footprint: [0.50, 1.52, 0.25], anchor: 'floor',
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
    id: 'vacuum', netId: 112, name: 'Handheld Vacuum',
    desc: 'Sucks ducks up one at a time, then hoses them where you point.',
    cost: 2000, model: 'vacuum', footprint: [0.25, 0.728, 1.00], anchor: 'floor',
    kind: 'tool',
    tool: { mode: 'beam', reach: 4.0, arc: 20, force: 14 },
    collider: { shape: 'cuboid', half: [0.125, 0.364, 0.50], blockDucks: false },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    // The nozzle points where the beam does: down the camera's forward axis.
    hand: { pos: [0.44, -0.16, -0.78], rotDeg: [-14, 200, 10], scale: 0.6 },
    tags: ['handheld'],
  },

  // --- phase 1 catalog: seventeen items --------------------------------------
  //
  // netIds: the 100-119 block had thirteen free numbers (104-109, 113-119) and
  // this pass needs seventeen, so the four that did not fit open a CONTINUATION
  // BLOCK at 160-179, immediately after the upgrades' 120-159. Numbers are
  // assigned once and never recycled, so a continuation block is the correct
  // answer to a full block -- renumbering the tab to make it tidy would break
  // every save and every wire format that ever carried the old numbers.
  //
  // The four storage rows do NOT come with a measured cavity, because
  // tools/blender-models.py does not call cavity() for them. Each
  // storage.interior below is therefore DERIVED from the builder's own
  // literals through the same centring and grid-snap scale finish() applies,
  // and checked against the exported bounding box that tools/measure-glb.py
  // reports. The method was validated first against the two rows that DO have
  // measured cavities: it reproduces the bucket's 12 places and the crate's 20
  // exactly. Where it matters the number of places each cavity offers is
  // written next to the capacity, because a container claiming more than it
  // can show is the defect the whole storage family was resized to fix.
  {
    id: 'bucket_leaky', netId: 104, name: 'Leaky Bucket',
    desc: 'Holds ten, but dribbles ducks onto the floor whenever you move it.',
    cost: 150, model: 'bucket_leaky', footprint: [0.75, 0.8629, 0.75], anchor: 'floor',
    kind: 'storage',
    storage: {
      capacity: 10, tipToEmpty: true,
      // storage.leakPerSecond. It only leaks while CARRIED OR PUSHED, and the
      // ducks it loses come out as real bodies you can see and pick up -- so
      // this is a tax on long trips, not invisible money evaporating.
      // 0.2/s against an 11 s round trip is about two ducks a run: a fifth of
      // the load for two fifths of the bucket's price.
      leakPerSecond: 0.35,
      // Square inscribed at the pail's mid radius (it tapers, so the bottom
      // would be pessimistic and the rim optimistic). 2 physical places -- the
      // one row here whose geometry is smaller than its number, and it is a
      // deliberate trade: the model IS a small pail and the alternative was a
      // capacity nobody would ever buy.
      interior: { half: [0.1732, 0.23, 0.216], offset: [0, -0.1715, 0] },
    },
    collider: { shape: 'cuboid', half: [0.375, 0.43145, 0.375], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    hand: { pos: [0.54, -0.40, -0.98], rotDeg: [4, 0, -10], scale: 0.42 },
    tags: ['cheap', 'carryable'],
  },
  {
    id: 'sack', netId: 105, name: 'Sack',
    desc: 'Holds five ducks and does not spill any of them. The cheapest thing that beats your arms.',
    cost: 140, model: 'sack', footprint: [0.75, 1.0442, 0.75], anchor: 'floor',
    kind: 'storage',
    storage: {
      capacity: 5, tipToEmpty: true,
      // Inscribed square at the belly radius, floor to the tie. 4 places.
      interior: { half: [0.195, 0.38, 0.195], offset: [0, -0.102, 0] },
    },
    collider: { shape: 'cuboid', half: [0.375, 0.5221, 0.375], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    hand: { pos: [0.50, -0.42, -0.92], rotDeg: [6, 0, -8], scale: 0.42 },
    tags: ['cheap', 'carryable'],
  },
  {
    id: 'crate_wood', netId: 106, name: 'Wooden Crate',
    desc: 'Holds twenty two. The slats let a duck out now and then while you carry it.',
    cost: 570, model: 'crate_wood', footprint: [1.00, 0.70, 1.00], anchor: 'floor',
    kind: 'storage',
    storage: {
      capacity: 22, tipToEmpty: true,
      leakPerSecond: 0.25,
      // Inside the boards, floor to the top rail. 20 places, same lattice the
      // steel crate gets from the same interior dimensions.
      interior: { half: [0.4134, 0.295, 0.407], offset: [0, -0.005, 0] },
    },
    collider: { shape: 'cuboid', half: [0.50, 0.35, 0.50], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'dumper', netId: 107, name: 'Tipper',
    desc: 'Push it. Holds thirty four and tips the lot in one go.',
    cost: 2000, model: 'dumper', footprint: [1.25, 0.985, 1.75], anchor: 'floor',
    kind: 'carry',
    storage: {
      capacity: 34, tipToEmpty: true,
      // The TROUGH, not the bounding box: the box is half wheels, legs and
      // handles. Same correction the barrow needed. 42 places.
      interior: { half: [0.5374, 0.2075, 0.5542], offset: [0, 0.26, 0.1361] },
    },
    collider: { shape: 'cuboid', half: [0.625, 0.4925, 0.875], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'pallet_jack', netId: 108, name: 'Pallet Jack',
    desc: 'Forty four ducks on the forks. Slow to turn, and it does not tip.',
    cost: 4250, model: 'pallet_jack', footprint: [0.75, 1.2871, 2.00], anchor: 'floor',
    kind: 'carry',
    storage: {
      // tipToEmpty false, like the container: you unload it a duck at a time.
      // That is the trade against the tipper -- more per trip, slower to empty.
      capacity: 44, tipToEmpty: false,
      // The load space over the forks, clear of the mast and the pump. 36
      // places; the rest are virtual, as they are in the container.
      interior: { half: [0.36, 0.30, 0.7268], offset: [0, -0.2336, -0.1971] },
    },
    collider: { shape: 'cuboid', half: [0.375, 0.64355, 1.00], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: ['bigticket'],
  },
  {
    id: 'plank', netId: 109, name: 'Plank',
    desc: 'Two metres of board. Drop it over a gap and carry it to the next one.',
    cost: 110, model: 'plank', footprint: [0.25, 0.115, 2.00], anchor: 'floor',
    kind: 'ramp',
    slope: { rise: 0, run: 2.00 },
    collider: { shape: 'cuboid', half: [0.125, 0.0575, 1.00], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    // The only placeable surface in the game you can pick back up and take
    // with you: the bridge costs ten times as much and stays where you put it.
    hand: { pos: [0.46, -0.30, -1.00], rotDeg: [0, 12, -6], scale: 0.5 },
    tags: ['cheap', 'carryable'],
  },

  // --- handhelds -------------------------------------------------------------
  // `tool.force` in sweep mode is a TARGET SPEED in m/s, not an acceleration:
  // sweepStep drives a duck towards `force` and caps the impulse by
  // sweepMaxAccel, which is what lets a broom at 6 beat a friction floor of
  // 13.2 m/s^2. The mu * g rule that governs blow.force and collect.force does
  // NOT apply here, and reading these numbers as accelerations would produce a
  // broom that fires ducks at 20 m/s.
  //
  // The four pushers below are the catalog's own warning made concrete: it
  // says outright that blower, bulldozer, hose and fan differ "only in reach,
  // arc and force". They earn separate rows by being separated hard -- price,
  // reach and arc all pull apart, from a $40 wide puff at 3 m to a $480 jet
  // that reaches 8. Anything closer together than this would be one item
  // wearing four models.
  {
    id: 'fan_handheld', netId: 113, name: 'Handheld Fan',
    desc: 'A wide gentle puff a few metres ahead. Nudges ducks; will not move a pile.',
    cost: 310, model: 'fan_handheld', footprint: [0.50, 0.825, 0.25], anchor: 'floor',
    kind: 'tool',
    tool: { mode: 'sweep', reach: 3.0, arc: 55, force: 3 },
    collider: { shape: 'cuboid', half: [0.25, 0.4125, 0.125], blockDucks: false },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    hand: { pos: [0.42, -0.22, -0.72], rotDeg: [-8, 0, 6], scale: 0.55 },
    tags: ['handheld', 'cheap'],
  },
  {
    id: 'pusher', netId: 114, name: 'Push Blade',
    desc: 'A blade nearly two metres wide. Shoves everything right in front of you a short way.',
    cost: 1150, model: 'pusher', footprint: [1.25, 1.005, 0.50], anchor: 'floor',
    kind: 'tool',
    // The widest arc in the game and the shortest reach: this is the tool for
    // clearing a jam at your feet, where the broom's 110 degrees leaves ducks
    // on both sides.
    tool: { mode: 'sweep', reach: 1.4, arc: 170, force: 5 },
    collider: { shape: 'cuboid', half: [0.625, 0.5025, 0.25], blockDucks: false },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    hand: { pos: [0.30, -0.46, -0.90], rotDeg: [10, 0, 0], scale: 0.55 },
    tags: ['handheld'],
  },
  {
    id: 'broom_wide', netId: 115, name: 'Wide Broom',
    desc: 'The broom with half again the reach and a much wider sweep.',
    cost: 1700, model: 'broom_wide', footprint: [1.00, 1.57, 0.25], anchor: 'floor',
    kind: 'tool',
    tool: { mode: 'sweep', reach: 2.4, arc: 150, force: 7 },
    collider: { shape: 'cuboid', half: [0.50, 0.785, 0.125], blockDucks: false },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    hand: { pos: [0.40, 0.02, -0.80], rotDeg: [28, -18, -35], scale: 0.5 },
    tags: ['handheld'],
  },
  {
    id: 'leaf_blower', netId: 116, name: 'Leaf Blower',
    desc: 'A narrow jet five metres long. Drives a line of ducks ahead of you.',
    cost: 2300, model: 'leaf_blower', footprint: [0.25, 0.7291, 1.00], anchor: 'floor',
    kind: 'tool',
    tool: { mode: 'sweep', reach: 5.0, arc: 35, force: 9 },
    collider: { shape: 'cuboid', half: [0.125, 0.36455, 0.50], blockDucks: false },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    hand: { pos: [0.46, -0.20, -0.80], rotDeg: [-10, 190, 8], scale: 0.6 },
    tags: ['handheld'],
  },
  {
    id: 'fire_hose', netId: 117, name: 'Fire Hose',
    desc: 'Eight metres of hard, narrow water. The longest push in the game.',
    cost: 3650, model: 'fire_hose', footprint: [0.75, 0.5662, 0.75], anchor: 'floor',
    kind: 'tool',
    tool: { mode: 'sweep', reach: 8.0, arc: 18, force: 12 },
    collider: { shape: 'cuboid', half: [0.375, 0.2831, 0.375], blockDucks: false },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    hand: { pos: [0.48, -0.26, -0.84], rotDeg: [-12, 0, 10], scale: 0.6 },
    tags: ['handheld'],
  },
  {
    id: 'vacuum_industrial', netId: 118, name: 'Industrial Vacuum',
    desc: 'The handheld vacuum with seven metres of reach and a harder hose.',
    cost: 4750, model: 'vacuum_industrial', footprint: [0.75, 1.2332, 0.75], anchor: 'floor',
    kind: 'tool',
    tool: { mode: 'beam', reach: 7.0, arc: 26, force: 20 },
    collider: { shape: 'cuboid', half: [0.375, 0.6166, 0.375], blockDucks: false },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    hand: { pos: [0.46, -0.30, -0.82], rotDeg: [-10, 0, 8], scale: 0.5 },
    tags: ['handheld', 'bigticket'],
  },

  // --- the three rows that use tool.pull and the scoop mode -------------------
  {
    id: 'rake', netId: 119, name: 'Rake',
    desc: 'Drags ducks towards you instead of pushing them away.',
    cost: 990, model: 'rake', footprint: [0.75, 1.5409, 0.25], anchor: 'floor',
    kind: 'tool',
    // tool.pull inverts the direction the sweep drives towards. Everything
    // else about it is the broom, which is the point: pulling is the missing
    // half of a game where the pit is behind you as often as in front.
    tool: { mode: 'sweep', reach: 2.2, arc: 100, force: 5, pull: true },
    collider: { shape: 'cuboid', half: [0.375, 0.77045, 0.125], blockDucks: false },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    hand: { pos: [0.42, 0.00, -0.80], rotDeg: [26, -16, -32], scale: 0.5 },
    tags: ['handheld'],
  },
  {
    id: 'magnet', netId: 160, name: 'Duck Magnet',
    desc: 'Pulls a narrow line of ducks in from five metres away.',
    cost: 2600, model: 'magnet', footprint: [0.50, 0.8504, 0.25], anchor: 'floor',
    kind: 'tool',
    // The rake pulls wide and near, this pulls narrow and far -- the same axis
    // the broom and the leaf blower are separated along, in the other
    // direction.
    tool: { mode: 'sweep', reach: 5.0, arc: 30, force: 6, pull: true },
    collider: { shape: 'cuboid', half: [0.25, 0.4252, 0.125], blockDucks: false },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    hand: { pos: [0.44, -0.18, -0.76], rotDeg: [-6, 0, 12], scale: 0.6 },
    tags: ['handheld'],
  },
  {
    id: 'horn', netId: 161, name: 'Air Horn',
    desc: 'One blast shoves every duck around you outward. The only tool that works behind your back.',
    cost: 340, model: 'horn', footprint: [0.25, 0.685, 0.50], anchor: 'floor',
    kind: 'tool',
    // arc 360 makes the cone test pass everywhere, which is how "all round
    // you" is expressed without a new mode: cos(180 deg) = -1 and every dot
    // product clears it.
    tool: { mode: 'sweep', reach: 2.5, arc: 360, force: 4 },
    collider: { shape: 'cuboid', half: [0.125, 0.3425, 0.25], blockDucks: false },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    hand: { pos: [0.40, -0.24, -0.68], rotDeg: [-14, 0, 8], scale: 0.6 },
    tags: ['handheld', 'cheap'],
  },
  {
    id: 'dustpan', netId: 162, name: 'Dustpan',
    desc: 'Scoops up to five ducks off the floor in one movement. No container needed.',
    cost: 460, model: 'dustpan', footprint: [0.50, 0.7447, 0.75], anchor: 'floor',
    kind: 'tool',
    // The 'scoop' mode. force 0 on purpose: a scoop does not push, it takes.
    tool: { mode: 'scoop', reach: 1.2, arc: 90, force: 0, capacity: 5 },
    collider: { shape: 'cuboid', half: [0.25, 0.37235, 0.375], blockDucks: false },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    hand: { pos: [0.44, -0.44, -0.80], rotDeg: [18, 0, -12], scale: 0.55 },
    tags: ['handheld'],
  },
  {
    id: 'lasso', netId: 163, name: 'Lasso',
    desc: 'Scoops three ducks from four metres off. Range instead of volume.',
    cost: 2150, model: 'lasso', footprint: [0.50, 0.2361, 0.50], anchor: 'floor',
    kind: 'tool',
    tool: { mode: 'scoop', reach: 4.0, arc: 20, force: 0, capacity: 3 },
    collider: { shape: 'cuboid', half: [0.25, 0.11805, 0.25], blockDucks: false },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    hand: { pos: [0.48, -0.34, -0.74], rotDeg: [-6, 0, 14], scale: 0.6 },
    tags: ['handheld'],
  },
];

export default TOOLS;
