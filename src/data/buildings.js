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
    id: 'wall', netId: 60, name: 'Wall',
    desc: 'Two metres of low wall. Stops ducks rolling away.',
    cost: 35, model: 'wall', footprint: [2.00, 1.065, 0.25], anchor: 'floor',
    kind: 'wall',
    collider: { shape: 'cuboid', half: [1.00, 0.5325, 0.125], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: ['cheap'],
  },
  {
    id: 'wall_high', netId: 61, name: 'High Wall',
    desc: 'Same footprint, two and a half times the height.',
    cost: 70, model: 'wall_high', footprint: [2.00, 2.665, 0.25], anchor: 'floor',
    kind: 'wall',
    collider: { shape: 'cuboid', half: [1.00, 1.3325, 0.125], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'rail', netId: 62, name: 'Rail',
    desc: 'Knee-high kerb. The cheapest way to fence a run.',
    cost: 15, model: 'rail', footprint: [2.00, 0.35, 0.25], anchor: 'floor',
    kind: 'wall',
    collider: { shape: 'cuboid', half: [1.00, 0.175, 0.125], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: ['cheap'],
  },
  {
    id: 'corner', netId: 63, name: 'Corner',
    desc: 'Closes a ninety degree join without leaving a gap.',
    cost: 40, model: 'corner', footprint: [1.00, 1.10, 1.00], anchor: 'floor',
    kind: 'wall',
    collider: { shape: 'cuboid', half: [0.50, 0.55, 0.50], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'pillar', netId: 64, name: 'Pillar',
    desc: 'Vertical support. Holds a bridge up.',
    cost: 55, model: 'pillar', footprint: [0.50, 2.46, 0.50], anchor: 'floor',
    kind: 'wall',
    collider: { shape: 'cuboid', half: [0.25, 1.23, 0.25], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'ramp', netId: 65, name: 'Ramp',
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
    // The id and the model file stay `chute` (they are wiring, and renaming them
    // would rename a netId's meaning), but the NAME the player reads does not.
    // "Chute" was already taken, by the delivery chute over the booth -- the
    // tube every purchase falls out of, which the onboarding line, the gambling
    // box's payout message and the shop's own help all point at by that name. A
    // player told to collect a purchase "from the chute" while a buyable object
    // called Chute sits in the shop has been given one word for two objects.
    // This one is a trough, and that is also what it looks like.
    id: 'chute', netId: 66, name: 'Duck Trough',
    desc: 'Half-pipe trough. Keeps a stream of ducks on one line.',
    cost: 80, model: 'chute', footprint: [0.75, 0.53, 2.00], anchor: 'floor',
    kind: 'ramp',
    slope: { rise: 0, run: 2.00 },
    collider: { shape: 'cuboid', half: [0.375, 0.265, 1.00], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'bridge', netId: 67, name: 'Bridge',
    desc: 'Spans three metres. Walk over the pit instead of around it.',
    cost: 140, model: 'bridge', footprint: [1.00, 1.455, 3.00], anchor: 'floor',
    kind: 'ramp',
    slope: { rise: 0, run: 3.00 },
    collider: { shape: 'cuboid', half: [0.50, 0.7275, 1.50], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },

  // --- phase 1 catalog: sixteen buildings, netId 68-83 -----------------------
  //
  // Every row below either does something no row above it does, or does the
  // same thing at a different price with a real trade. A shop entry is a
  // promise that this is a DIFFERENT decision; a second wall that is only a
  // different texture costs the player attention every time they open the
  // panel, so it does not get a row. That is why fence_mesh.glb is in the
  // manifest and named by nothing: it is wall.glb's exact footprint, wall.glb's
  // kind, and there is no field that would make it behave differently -- the
  // fan's cone is a geometric test, not a collision, so "lets the wind through"
  // is something EVERY wall already does. The model costs nothing sitting
  // unused. A duplicate row would not be free.
  //
  // Four of these use collider.friction / collider.restitution, one uses
  // blow.pitchDegrees, and four (canopy, lamp post, sign, neon) are openly
  // decoration and say so in their desc rather than pretending otherwise.
  {
    id: 'pit_kerb', netId: 68, name: 'Kerb',
    // The only one-metre fence piece in the game. The rail is 2.00 long and
    // the corner is 1.00 square, so a 1 m straight gap could not be closed
    // flush by anything -- and on this grid an unclosable gap is a duck that
    // rolls out of the run forever.
    desc: 'One metre of low kerb, for the gaps a two metre rail cannot close.',
    cost: 12, model: 'pit_kerb', footprint: [1.00, 0.38, 0.50], anchor: 'floor',
    kind: 'wall',
    collider: { shape: 'cuboid', half: [0.50, 0.19, 0.25], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: ['cheap'],
  },
  {
    id: 'wall_glass', netId: 69, name: 'Glass Wall',
    desc: 'Ducks slide along it instead of piling up against it.',
    cost: 55, model: 'wall_glass', footprint: [2.00, 1.065, 0.25], anchor: 'floor',
    kind: 'wall',
    // friction 0.08 against the world's 0.9. THE reason this row exists rather
    // than being a texture on the wall: a duck shoved into an ordinary wall
    // stops dead there and the next fan in the lane cannot restart it, because
    // mu * g on a 0.9 wall beats what the fan has left. Along glass it keeps
    // travelling. A corridor of glass is a corridor that does not clog.
    collider: { shape: 'cuboid', half: [1.00, 0.5325, 0.125], blockDucks: true, friction: 0.08 },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'wall_soft', netId: 70, name: 'Padded Wall',
    desc: 'Ducks hit it and drop at its foot instead of bouncing back into the lane.',
    cost: 50, model: 'wall_soft', footprint: [2.00, 1.065, 0.25], anchor: 'floor',
    kind: 'wall',
    collider: {
      shape: 'cuboid', half: [1.00, 0.5325, 0.125], blockDucks: true,
      restitution: 0.02, friction: 1.3,
    },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'bumper', netId: 71, name: 'Bumper',
    desc: 'Throws back whatever hits it, harder than it arrived.',
    cost: 65, model: 'bumper', footprint: [1.00, 0.885, 1.00], anchor: 'floor',
    kind: 'wall',
    collider: { shape: 'cuboid', half: [0.50, 0.4425, 0.50], blockDucks: true, restitution: 1.3 },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'trampoline', netId: 72, name: 'Trampoline',
    desc: 'Ducks that land on it go back up. So do you.',
    cost: 130, model: 'trampoline', footprint: [1.50, 0.5141, 1.50], anchor: 'floor',
    kind: 'wall',
    // 1.6, not 2.0. Above about 1.7 a duck gains height every bounce and the
    // pile never settles, which reads as a physics bug rather than a toy.
    collider: { shape: 'cuboid', half: [0.75, 0.25705, 0.75], blockDucks: true, restitution: 1.6 },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'ice_slide', netId: 73, name: 'Ice Slab',
    desc: 'Two metres square of almost no friction. Whatever crosses it keeps going.',
    cost: 85, model: 'ice_slide', footprint: [2.00, 0.15, 2.00], anchor: 'floor',
    kind: 'ramp',
    slope: { rise: 0, run: 2.00 },
    collider: { shape: 'cuboid', half: [1.00, 0.075, 1.00], blockDucks: true, friction: 0.02 },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'fan_strong', netId: 74, name: 'Heavy Fan',
    desc: 'Ten metres of wind instead of six, and it pushes harder.',
    cost: 240, model: 'fan_strong', footprint: [1.50, 1.8811, 1.00], anchor: 'floor',
    kind: 'blower',
    repeat: { times: 6, curve: 1.18 },
    // Same friction floor as the fan and the vacuum station: mu * g = 13.2 is
    // where a number starts meaning anything. 42 leaves 28.8 m/s^2, which is
    // what buys the longer throw -- the cone's falloff means the far end of a
    // 10 m range needs far more at the nozzle than a 6 m one does.
    //
    // Deliberately NOT strictly better than the fan: 190 for 10 m is $19/m
    // against the fan's $10/m. You buy it to cross a distance with four
    // objects instead of six, not to save money.
    blow: { force: 42, range: 10, cone: 30 },
    collider: { shape: 'cuboid', half: [0.75, 0.94055, 0.50], blockDucks: false },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'fan_vertical', netId: 75, name: 'Updraft Fan',
    desc: 'Blows straight up. Lifts a duck about three metres instead of pushing it along the floor.',
    cost: 110, model: 'fan_vertical', footprint: [1.00, 0.895, 1.00], anchor: 'floor',
    kind: 'blower',
    repeat: { times: 12, curve: 1.10 },
    // blow.pitchDegrees, measured off the PLACED pose exactly as a ramp's
    // surface pitch is. Straight up has to beat gravity, not floor friction:
    // the world runs at -22, so 30 leaves 8 m/s^2 of climb, enough to put a
    // duck on the 0.60 m platform deck and not enough to lose it over a wall.
    // MEASURED, and the measurement moved the wrong knob first: the height a
    // duck reaches is set by the RANGE, not the force. Inside the cone it is
    // dragged towards automation.fan.airSpeed (7 m/s) and then coasts, so it
    // clears the top of the field by v^2/2g ~ 1.1 m whatever the force is.
    // force 30 / range 5 threw a duck from 0.9 m to 5.9 m; range 2 tops out
    // just over the platform deck, which is what this fan is for.
    blow: { force: 26, range: 2, cone: 45, pitchDegrees: 90 },
    collider: { shape: 'cuboid', half: [0.50, 0.4475, 0.50], blockDucks: false },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'vibe_floor', netId: 76, name: 'Vibrating Floor',
    desc: 'A belt with no height. Slower than a conveyor, and you can walk over it.',
    cost: 85, model: 'vibe_floor', footprint: [1.00, 0.1412, 2.00], anchor: 'floor',
    kind: 'conveyor',
    repeat: { times: 12, curve: 1.04 },
    // The conveyor is 0.65 m tall, so a belt run is a wall across your yard
    // that ducks have to be lifted onto. This is the same two metres of carry
    // at 14 cm: cheaper, slower, and it does not cut the floor in half.
    belt: { speed: 1.0, turn: 0, rise: 0 },
    collider: { shape: 'cuboid', half: [0.50, 0.0706, 1.00], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'slide', netId: 77, name: 'Slide',
    desc: 'Three metres of channel dropping seventy centimetres. Ducks arrive at the bottom moving.',
    cost: 120, model: 'slide', footprint: [1.00, 1.4546, 3.00], anchor: 'floor',
    kind: 'ramp',
    // MEASURED off the mesh, not read off the footprint height: the bed is a
    // 2.92 m plank at 14 degrees, so it drops 0.706 m across a 2.90 m run
    // while the whole piece stands 1.45 m tall because of the back wall and
    // the legs. Same trap the conveyor ramp fell into.
    slope: { rise: 0.706, run: 2.90 },
    collider: {
      shape: 'cuboid', half: [0.50, 0.7273, 1.50], blockDucks: true,
      // Sloped slab, high end at +Z like the ramp's, so the pitch is negative.
      surface: { half: [0.4667, 0.06, 1.4917], pitchDegrees: -13.7, offsetY: 0.0527 },
    },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'platform', netId: 78, name: 'Platform',
    desc: 'Two metres square of deck at knee height. Stack machines above the floor.',
    cost: 95, model: 'platform', footprint: [2.00, 0.63, 2.00], anchor: 'floor',
    kind: 'ramp',
    slope: { rise: 0, run: 2.00 },
    collider: {
      shape: 'cuboid', half: [1.00, 0.315, 1.00], blockDucks: true,
      // The physics is the DECK, not the box: a full-height block would make
      // the legs solid and the platform a cube. offsetY lifts a thin slab to
      // the deck's own height, which is 0.60 -- the same 0.60 the stairs climb.
      surface: { half: [0.97, 0.05, 0.97], pitchDegrees: 0, offsetY: 0.235 },
    },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'stairs', netId: 79, name: 'Stairs',
    desc: 'Climbs sixty centimetres over two metres. Gentler than the ramp and half as wide.',
    cost: 70, model: 'stairs', footprint: [1.00, 0.6025, 2.00], anchor: 'floor',
    kind: 'ramp',
    // 4 x 0.15 = 0.60, which is the platform deck exactly. The two pieces were
    // modelled to meet.
    slope: { rise: 0.60, run: 1.96 },
    collider: {
      shape: 'cuboid', half: [0.50, 0.30125, 1.00], blockDucks: true,
      surface: { half: [0.47, 0.06, 1.0248], pitchDegrees: -17.0, offsetY: 0 },
    },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'roof', netId: 80, name: 'Canopy',
    desc: 'A sheet of roof on two posts. Decoration; nothing falls out of this sky.',
    cost: 75, model: 'roof', footprint: [2.00, 1.805, 2.00], anchor: 'floor',
    kind: 'wall',
    collider: {
      shape: 'cuboid', half: [1.00, 0.9025, 1.00], blockDucks: true,
      // Only the sheet is solid. Without this the canopy would be a 2 m cube
      // of invisible wall you cannot walk under, which is the opposite of what
      // a canopy is for.
      surface: { half: [1.00, 0.07, 1.00], pitchDegrees: 0, offsetY: 0.8175 },
    },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: ['decor'],
  },
  {
    id: 'lamp_post', netId: 81, name: 'Lamp Post',
    desc: 'A post with a lamp on it. Decoration.',
    cost: 25, model: 'lamp_post', footprint: [0.50, 2.17, 0.50], anchor: 'floor',
    kind: 'wall',
    collider: { shape: 'cuboid', half: [0.25, 1.085, 0.25], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: ['decor', 'cheap'],
  },
  {
    id: 'sign_dir', netId: 82, name: 'Direction Sign',
    desc: 'Points somewhere. Decoration; the ducks cannot read.',
    cost: 18, model: 'sign_dir', footprint: [0.75, 1.38, 0.25], anchor: 'floor',
    kind: 'wall',
    collider: { shape: 'cuboid', half: [0.375, 0.69, 0.125], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: ['decor', 'cheap'],
  },
  {
    id: 'neon_ducks', netId: 83, name: 'DUCKS Sign',
    desc: 'A lit sign that says DUCKS. Decoration.',
    cost: 40, model: 'neon_ducks', footprint: [2.00, 1.455, 0.25], anchor: 'floor',
    kind: 'wall',
    collider: { shape: 'cuboid', half: [1.00, 0.7275, 0.125], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: ['decor'],
  },
];

export default BUILDINGS;
