// Machines tab: everything that makes, moves or eats ducks on its own.
// Rows only. A row's `kind` selects a behaviour implemented once in code; no
// consumer may ever branch on `id`.
//
// netId block for this tab: 1-59. Assigned once, never recycled, never derived
// from array position -- rows below may be reordered or appended freely.
//
// Footprints are the exported GLB bounding boxes, in the game's Y-up order
// [x, height, depth], measured off assets/models/*.glb rather than copied from
// the generator's inputs.
//
// CONTRACT: both horizontal numbers (x and depth) are exact multiples of
// config.build.grid (0.25 m), and `collider.half` is exactly half of them.
// Placement snaps an object's CENTRE to that grid, so two neighbours are flush
// only when their half-extents also land on it -- a 2.22 m belt against a
// 1.45 m corner could not be, which is how ducks used to stall in a 0.165 m
// seam that neither piece drove. The sizes are authored in the FOOTPRINT table
// at the top of tools/blender-models.py; a new row must go through that table,
// not straight into this file.

import config from '../config.js';

export const MACHINES = [
  {
    id: 'crank', netId: 1, name: 'Manual Duck Workbench',
    // NOT "ten turns of the wheel" any more. Cranking stopped being a count of
    // clicks and became a HELD charge (config.machine.holdSecondsPerDuck, 2.5 s
    // a duck) some time ago, and this line went on describing the mechanic it
    // replaced -- so the shop was teaching a player to click ten times at a
    // thing that only answers to a hold. clicksPerTurn survives in the sim, but
    // only as the wheel's gear-click grain for the sound; it is not a quota.
    desc: 'Hold the wheel and it fills; a duck drops out every few seconds. The only duck source you start with.',
    // 10, not 0. You are GIVEN one at spawn; this price is for a second bench,
    // and a cost of 0 made the shop refuse the row outright as 'not for sale'.
    cost: 10, model: 'crank', footprint: [2.096, 2.256, 2.128], anchor: 'floor',
    kind: 'producer_manual',
    // The starter workbench is drawn at config.machine.scale = 1.6, and a bought
    // one has to be the same machine: same size, same crank, same wheel. The
    // MESH is scaled, never the asset -- config.machine.* holds a dozen
    // hand-tuned model-local coordinates measured against crank.glb exactly as
    // exported, and re-exporting it at another size would invalidate all of them
    // silently (see the note in tools/blender-models.py).
    //
    // footprint and collider.half are therefore authored in WORLD metres: the
    // model bounding box 1.31 x 1.41 x 1.33 and the cabinet half-extents
    // 0.656 / 0.705 / 0.46 from config.machine, each multiplied by 1.6. That is
    // also why this row is the one placeable whose footprint is not a multiple
    // of the 0.25 m grid: the crank is the model deliberately left off it.
    modelScale: 1.6,
    // THE declaration of what a player can point at on this machine, and the
    // only home for that fact.
    //
    // An outline under the crosshair is a promise that the thing answers a
    // button. On this machine only the WHEEL does; the cabinet is scenery you
    // happen to be able to walk into. Saying so on the row rather than in a
    // renderer is what makes the rule survive the two completely different
    // paths this model travels: the starter bench is a pair of split meshes in
    // src/render/props.js, a bought one is an instance in src/render/placed.js.
    // Anything that draws a focus outline reads THIS field, resolves `part`
    // against the model's own part split (models.js, config.machine.split*) and
    // against whatever pose that particular instance has, and outlines nothing
    // at all when it cannot resolve it. A row with no `interact` is scenery and
    // never outlines -- which is the safe default, because a wrong promise is
    // worse than no promise.
    //
    // `hint` is the grey text under the name. The hit sphere itself is not
    // repeated here: it is config.machine.wheelRadius * hitRadiusScale, cut off
    // at machine.useRange, which is the same sphere the crank HOLD tests.
    interact: { part: 'wheel', hint: 'hold to crank' },
    produce: { clicksPerDuck: 10, rarityWeights: 'w_basic' },
    collider: { shape: 'cuboid', half: [1.0496, 1.128, 0.736], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    // noGamble: the box may not award the bench you already own and cannot sell.
    // src/sim/gamble.js has always filtered on this tag and NO row carried it,
    // so the only exclusion the gacha had excluded nothing. This is the data
    // half that was never written.
    tags: ['starter', 'placed', 'noGamble'],
  },
  {
    id: 'press', netId: 2, name: 'Duck Press',
    desc: 'Stamps out a duck every few seconds without you.',
    cost: 200, model: 'press', footprint: [1.00, 1.80, 0.75], anchor: 'floor',
    kind: 'producer_auto',
    repeat: { times: 16, curve: 1.28 },
    produce: { secondsPerDuck: 4.5, rarityWeights: 'w_basic' },
    // The ram, and it presses when a duck actually comes out rather than on a
    // clock of its own -- one pulse per emission, so a press that is jammed or
    // switched off is visibly still. 0.090 m is the gap between the ram's face
    // and the anvil in assets/models/press_ram.glb: a full stroke touches down
    // and no further, which is what makes it look like it did the stamping.
    moving: [{
      model: 'press_ram', motion: 'slide',
      axis: [0, -1, 0], travel: 0.090, seconds: 0.45, drive: 'stroke',
    }],
    collider: { shape: 'cuboid', half: [0.50, 0.90, 0.375], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'crank_bot', netId: 5, name: 'Auto-Cranker',
    desc: 'Sits on a workbench wheel and cranks it for you. Stacks with you and with itself.',
    // PRICE, against the existing curve rather than invented:
    //   Duck Press        200   a duck every 4.5 s, standing on its own
    //   Auto-Cranker      340   a duck every 5.0 s, and only on a wheel you own
    //   Duck Assembler    650   a duck every 2.0 s, standing on its own
    // It is slower than a press and needs a workbench under it, which argues
    // DOWN; but unlike a press it inherits every crank upgrade (Swift Hands
    // takes it to 4.25 s and below), it winds the wheel's flywheel up to
    // config.machine.momentumMax on its own -- 2.5 s a duck unattended, 1.25 s
    // with a second one -- and it stacks with the player instead of replacing
    // them. That compounding is worth more than the 4.5 s a press gives once,
    // so it sits above the press and well below the assembler. The repeat curve
    // is steeper than the press's 1.28 for the same reason: copies on one wheel
    // multiply against a shared flywheel.
    cost: 340, model: 'crank_bot', footprint: [0.75, 1.00, 0.75], anchor: 'floor',
    // A KIND OF ITS OWN, and deliberately not `producer_auto`: this thing makes
    // no ducks. It puts a hand on a wheel, and the wheel makes the ducks under
    // exactly the rules a player's hand obeys. Behaviour is in main.js
    // (botHolders), selected by this kind and never by the id.
    kind: 'crank_bot',
    repeat: { times: 12, curve: 1.4 },
    collider: { shape: 'cuboid', half: [0.375, 0.50, 0.375], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: ['noGamble'],
  },
  {
    id: 'machine', netId: 3, name: 'Duck Assembler',
    desc: 'Faster automatic producer with a better rarity roll.',
    cost: 650, model: 'machine', footprint: [1.50, 2.10, 1.25], anchor: 'floor',
    kind: 'producer_auto',
    repeat: { times: 16, curve: 1.32 },
    produce: { secondsPerDuck: 2.0, rarityWeights: 'w_good' },
    collider: { shape: 'cuboid', half: [0.75, 1.05, 0.625], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'vacuum_station', netId: 4, name: 'Vacuum Station',
    desc: 'Pulls loose ducks in from a few metres and feeds them onward.',
    cost: 450, model: 'vacuum_station', footprint: [1.00, 1.28, 1.00], anchor: 'floor',
    kind: 'collector_auto',
    repeat: { times: 4, curve: 1.55 },
    // force must beat static friction on concrete or the station does nothing
    // at all: mu * g = 0.6 * 22 = 13.2 m/s^2. The authored 12 was below that
    // floor, so it sucked at 2745 impulses over 10 s and moved one duck in
    // twelve -- a number that looks like tuning and is actually zero.
    collect: { radius: 3.5, force: 18, perSecond: 4 },
    collider: { shape: 'cuboid', half: [0.50, 0.64, 0.50], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'conveyor', netId: 10, name: 'Conveyor',
    desc: 'Two metres of belt. Carries ducks along its length.',
    cost: 110, model: 'conveyor', footprint: [1.00, 0.65, 2.00], anchor: 'floor',
    kind: 'conveyor',
    repeat: { times: 60, curve: 1.035 },
    belt: { speed: 1.6, turn: 0, rise: 0 },
    // The cleats. Measured off assets/models/conveyor_belt.glb: eight of them
    // over the piece's 1.78 m of band, so one eighth of it -- 0.2225 m -- puts
    // each cleat exactly where its neighbour started and the loop closes.
    moving: [{ model: 'conveyor_belt', motion: 'slide', axis: [0, 0, 1], period: 0.2225, drive: 'belt' }],
    collider: { shape: 'cuboid', half: [0.50, 0.325, 1.00], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'conveyor_corner', netId: 11, name: 'Conveyor Corner',
    desc: 'Turns the belt ninety degrees.',
    cost: 130, model: 'conveyor_corner', footprint: [1.50, 0.66, 1.50], anchor: 'floor',
    kind: 'conveyor',
    repeat: { times: 12, curve: 1.05 },
    belt: { speed: 1.6, turn: 90, rise: 0 },
    // A corner's cleats go round rather than along, about the inner corner at
    // (-0.75, +0.75) -- and the arc's radius is exactly 1.00 m, which is why
    // the belt's speed in metres per second is also its rate in radians per
    // second and no conversion appears anywhere. Eight cleats over the quarter
    // turn: 90 / 8 = 11.25 degrees per period.
    moving: [{
      model: 'conveyor_corner_belt', motion: 'turn',
      axis: [0, 1, 0], pivot: [-0.75, 0, 0.75], period: 11.25, drive: 'belt',
    }],
    collider: { shape: 'cuboid', half: [0.75, 0.33, 0.75], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'conveyor_slope', netId: 12, name: 'Conveyor Ramp',
    desc: 'Runs ducks down seven tenths of a metre. Turn it to aim the descent.',
    cost: 150, model: 'conveyor_slope', footprint: [1.00, 1.555, 2.00], anchor: 'floor',
    kind: 'conveyor',
    repeat: { times: 8, curve: 1.05 },
    // THE NUMBERS BELOW ARE MEASURED OFF assets/models/conveyor_slope.glb, off
    // the belt band itself (the primitive with the `dark` material) rather than
    // off the model's overall bounding box. The band is a straight slab spanning
    // the full length, and its TOP face runs:
    //
    //     z = -1.00   y = 1.192          (the high end, under the tall pillar)
    //     z = +1.00   y = 0.474          (the low end)
    //
    // so: drop 0.718 m over 2.00 m, gradient 0.359, pitch 19.741 deg, and the
    // surface passes through y = 0.833 at the piece's centre.
    //
    // What was here before, and why all three were wrong:
    //
    //   rise: 0.69, POSITIVE. Positive means "climbs along local +Z", and this
    //   mesh descends along local +Z -- the tall end is at -Z. conveyors.js
    //   applies the vertical drive UP-ONLY, so a positive rise here meant the
    //   belt spent its lift fighting the slope it was standing on.
    //
    //   The old comment claimed the sign was placement-dependent and could not
    //   live in a row: "rotating the piece 180 degrees makes the same drive
    //   direction go up". It does not. Yaw rotates the MESH with the drive
    //   direction, so the high end travels with local -Z whatever the yaw is;
    //   which way the descent points in the WORLD changes, which is the thing
    //   the player turns the piece to choose, and the row's sign is fixed.
    //
    //   collider: an upright cuboid, half-height 0.7775 -- a flat lid at y 1.555
    //   over the whole piece. That is the defect the description was really
    //   describing: a duck could not reach the belt at all, only stand on an
    //   invisible shelf 1.08 m above the low end. It looked like a ramp and
    //   acted like a wall, which is the exact trap src/data/buildings.js already
    //   documents on the `ramp` row.
    //
    // `surface` fixes it the same way the ramp does: the placement box stays
    // upright (the grid, the overlap test and the model seating all need it) and
    // the PHYSICS is a thin slab tilted to match the band. half[2] is the slab's
    // length along its own tilt, hypot(2.00, 0.718) / 2 = 1.0625. offsetY is the
    // band's centre relative to the placement box's centre (which sits at
    // 1.555 / 2 = 0.7775 above the floor): 0.833 - 0.7775 = 0.0555.
    // pitchDegrees is POSITIVE here and negative on the ramp building, for the
    // one reason that matters: a positive pitch lowers the +Z end, and this
    // mesh's low end is at +Z while the ramp's is at -Z.
    belt: {
      speed: 1.4, turn: 0,
      // Signed, and it means metres of CLIMB along local +Z, so a descent is
      // negative. Read by src/sim/conveyors.js for both the drive's vertical
      // component and -- since this piece's surface is not level -- for where
      // that surface actually is at each point along the run.
      rise: -0.718,
      // Where the belt surface sits at the piece's CENTRE, relative to the
      // placement box's centre. Every other belt in the game is a flat-topped
      // box whose surface is the top of that box, which is what conveyors.js
      // assumes when this is absent; a sloped piece has to say.
      surfaceOffsetY: 0.0555,
    },
    // The cleats run DOWN the slope, not along the floor: normalize(0, -0.718,
    // 2.00) is the band's own direction, the same two numbers as `rise` and the
    // piece's length, so the cleats cannot drift out of agreement with the drive
    // that carries the ducks. Period 0.30 m of that slanted travel.
    moving: [{
      model: 'conveyor_slope_belt', motion: 'slide',
      axis: [0, -0.3376, 0.9413], period: 0.30, drive: 'belt',
    }],
    collider: {
      shape: 'cuboid', half: [0.50, 0.7775, 1.00], blockDucks: true,
      surface: { half: [0.50, 0.06, 1.0625], pitchDegrees: 19.741, offsetY: 0.0555 },
    },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'fan', netId: 13, name: 'Fan',
    desc: 'Blows ducks forward. Ducks pass straight through the blades.',
    cost: 60, model: 'fan', footprint: [1.25, 1.63, 0.75], anchor: 'floor',
    kind: 'blower',
    repeat: { times: 24, curve: 1.08 },
    // Same trap as the vacuum station, in a different row: 9 is BELOW the static
    // friction floor of mu * g = 0.6 * 22 = 13.2, so a duck lying on concrete
    // never started moving at all. Only ducks that happened to still be rolling
    // got carried, which is why a fan lane looked like it half-worked -- four
    // presses made 180 ducks in two minutes and the pit scored 2.
    // The number has to be read as "how much acceleration is LEFT after
    // friction": 26 leaves 12.8 m/s^2, which moves a resting duck along briskly
    // without launching it over the corridor walls.
    blow: { force: 26, range: 6, cone: 35 },
    // The fan is the reason blockDucks exists as data. Ducks must pass through
    // it; the player must not walk into the housing. Both are rows, not an
    // `if (id === 'fan')` somewhere in the collision code.
    collider: { shape: 'cuboid', half: [0.625, 0.815, 0.375], blockDucks: false },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },

  // --- phase 1 catalog: fifteen producers, netId 14-28 -----------------------
  //
  // These exist to fill the hole Phase E left between the Duck Press ($200,
  // 4.5 s) and the Duck Assembler ($650, 2.0 s), which was the whole span of
  // the game's first hour with exactly two things to buy in it. Every one is
  // `producer_auto` and needs no new behaviour; eight of them use the
  // `produce.count` field (N ducks per emission) and three use a rarity weight
  // set that removes the common tiers outright.
  //
  // The CATALOG'S seconds were written before the game existed and are treated
  // the way its prices are: as an ORDERING, not as numbers. Its "60 s automat"
  // next to a press that already makes a duck every 4.5 s would have been a
  // machine nobody could ever justify buying. What is preserved is the ranking
  // -- slow automat is the slowest, the pipe is continuous, the reactor makes
  // one duck a minute and it is worth a fortune.
  //
  // Prices come out of tools/economy-sim.py, not out of the air. The ladder
  // they sit on is dollars per equivalent duck/second, where "equivalent"
  // folds in the rarity set's mean value (w_rare is 4.11x a basic duck,
  // w_elite 33.9x). The press is $900 per eq-duck/s and the assembler $1068;
  // the rows below run from ~$990 for the cheap early ones up to ~$1900 for
  // the reactor, which charges a premium for making its money in ducks you
  // barely have to carry.
  {
    id: 'machine_slow', netId: 14, name: 'Slow Automat',
    desc: 'Makes a duck every nine seconds on its own. The cheapest machine that works without you.',
    cost: 165, model: 'machine_slow', footprint: [1.00, 1.315, 1.00], anchor: 'floor',
    kind: 'producer_auto',
    repeat: { times: 6, curve: 1.45 },
    produce: { secondsPerDuck: 9.0, rarityWeights: 'w_basic' },
    collider: { shape: 'cuboid', half: [0.50, 0.6575, 0.50], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: ['cheap'],
  },
  {
    id: 'condenser', netId: 15, name: 'Condensation Tank',
    desc: 'Slow, but the ducks it drips out are worth more than average.',
    cost: 225, model: 'condenser', footprint: [1.00, 1.60, 1.00], anchor: 'floor',
    kind: 'producer_auto',
    repeat: { times: 6, curve: 1.42 },
    // The first w_good source in the game, six hundred dollars before the
    // assembler. Fewer ducks worth more each is a different bargain from more
    // ducks worth less while your legs are still the bottleneck: value per trip
    // to the pit is what you are buying.
    produce: { secondsPerDuck: 8.0, rarityWeights: 'w_good' },
    collider: { shape: 'cuboid', half: [0.50, 0.80, 0.50], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'hive', netId: 16, name: 'Duck Hive',
    desc: 'Quiet for twenty four seconds, then three ducks at once.',
    cost: 195, model: 'hive', footprint: [1.00, 1.23, 1.00], anchor: 'floor',
    kind: 'producer_auto',
    repeat: { times: 6, curve: 1.42 },
    produce: { secondsPerDuck: 24.0, rarityWeights: 'w_basic', count: 3 },
    collider: { shape: 'cuboid', half: [0.50, 0.615, 0.50], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'duckomat', netId: 17, name: 'Duckomat',
    desc: 'Vends one duck every four seconds.',
    cost: 620, model: 'duckomat', footprint: [1.00, 1.78, 0.75], anchor: 'floor',
    kind: 'producer_auto',
    repeat: { times: 8, curve: 1.34 },
    produce: { secondsPerDuck: 4.0, rarityWeights: 'w_basic' },
    collider: { shape: 'cuboid', half: [0.50, 0.89, 0.375], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'incubator_double', netId: 18, name: 'Double Incubator',
    desc: 'Two ducks every seven seconds, out of both doors.',
    cost: 720, model: 'incubator_double', footprint: [1.50, 1.30, 1.00], anchor: 'floor',
    kind: 'producer_auto',
    repeat: { times: 8, curve: 1.34 },
    produce: { secondsPerDuck: 7.0, rarityWeights: 'w_basic', count: 2 },
    collider: { shape: 'cuboid', half: [0.75, 0.65, 0.50], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'hatchery', netId: 19, name: 'Hatchery',
    desc: 'A duck every three seconds, low enough to sit under a belt.',
    cost: 860, model: 'hatchery', footprint: [1.25, 0.855, 1.00], anchor: 'floor',
    kind: 'producer_auto',
    repeat: { times: 8, curve: 1.33 },
    produce: { secondsPerDuck: 3.0, rarityWeights: 'w_basic' },
    collider: { shape: 'cuboid', half: [0.625, 0.4275, 0.50], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'printer3d', netId: 20, name: 'Duck Printer',
    desc: 'Prints one duck every fifteen seconds and never prints a common one.',
    cost: 900, model: 'printer3d', footprint: [1.00, 1.285, 1.00], anchor: 'floor',
    kind: 'producer_auto',
    // w_rare has a zero on tier 0. The cheap way into rare-only output: four
    // ducks a minute, each worth about four normal ones, and almost nothing to
    // carry -- which is the axis this machine competes on, not throughput.
    produce: { secondsPerDuck: 15.0, rarityWeights: 'w_rare' },
    repeat: { times: 6, curve: 1.38 },
    collider: { shape: 'cuboid', half: [0.50, 0.6425, 0.50], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'feeder_vibe', netId: 21, name: 'Vibratory Feeder',
    desc: 'Shakes out five ducks every twelve seconds.',
    cost: 1050, model: 'feeder_vibe', footprint: [1.00, 1.2602, 1.50], anchor: 'floor',
    kind: 'producer_auto',
    repeat: { times: 8, curve: 1.33 },
    produce: { secondsPerDuck: 12.0, rarityWeights: 'w_basic', count: 5 },
    collider: { shape: 'cuboid', half: [0.50, 0.6301, 0.75], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'press_belt', netId: 22, name: 'Belt Press',
    desc: 'Stamps five ducks at a time and rolls them off the end.',
    cost: 1300, model: 'press_belt', footprint: [1.00, 1.50, 2.00], anchor: 'floor',
    kind: 'producer_auto',
    repeat: { times: 8, curve: 1.33 },
    produce: { secondsPerDuck: 10.0, rarityWeights: 'w_basic', count: 5 },
    // A shallower stroke (0.040 m) over a belt rather than an anvil, and a
    // slower one, because this machine stamps five at a time.
    moving: [{
      model: 'press_belt_ram', motion: 'slide',
      axis: [0, -1, 0], travel: 0.040, seconds: 0.60, drive: 'stroke',
    }],
    collider: { shape: 'cuboid', half: [0.50, 0.75, 1.00], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'slot_machine', netId: 23, name: 'Duck Slots',
    desc: 'Every eight seconds it pays out somewhere between one duck and ten.',
    cost: 1680, model: 'slot_machine', footprint: [0.75, 1.52, 0.75], anchor: 'floor',
    kind: 'producer_auto',
    repeat: { times: 6, curve: 1.35 },
    // The [min, max] form of produce.count, rolled fresh every emission. Mean
    // 5.5 per 8 s, priced slightly under the ladder because a machine you
    // cannot plan around is worth less than one you can.
    produce: { secondsPerDuck: 8.0, rarityWeights: 'w_basic', count: [1, 10] },
    // The reels, turning about their shared X axle at (0, 1.020, -0.195). They
    // spin steadily rather than stopping on a result: this machine's payout is a
    // COUNT, not a row of symbols, so a reel coming to rest on something would
    // be promising a meaning the simulation does not have. One period is one
    // symbol -- 120 degrees, three to a reel.
    moving: [{
      model: 'slot_reels', motion: 'turn', axis: [1, 0, 0], pivot: [0, 1.020, -0.195],
      period: 120, rate: 1.2, drive: 'spin',
    }],
    collider: { shape: 'cuboid', half: [0.375, 0.76, 0.375], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'geyser', netId: 24, name: 'Duck Geyser',
    desc: 'Erupts every forty five seconds and thirty ducks come out at once.',
    cost: 2400, model: 'geyser', footprint: [1.50, 1.0043, 1.50], anchor: 'floor',
    kind: 'producer_auto',
    repeat: { times: 4, curve: 1.50 },
    // Thirty at once against a 300-duck yard ceiling. An emission at a full
    // yard drops what will not fit and raises the jam flag, so this machine is
    // a bet that your transport can clear a burst -- priced under the ladder
    // for exactly that reason.
    produce: { secondsPerDuck: 45.0, rarityWeights: 'w_basic', count: 30 },
    collider: { shape: 'cuboid', half: [0.75, 0.50215, 0.75], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'press_gold', netId: 25, name: 'Gold Press',
    desc: 'A duck every six seconds, and never a common one.',
    cost: 2850, model: 'press_gold', footprint: [1.00, 1.645, 0.75], anchor: 'floor',
    kind: 'producer_auto',
    repeat: { times: 6, curve: 1.40 },
    produce: { secondsPerDuck: 6.0, rarityWeights: 'w_rare' },
    // Same mechanism as the Duck Press, its own measured gap: 0.075 m.
    moving: [{
      model: 'press_gold_ram', motion: 'slide',
      axis: [0, -1, 0], travel: 0.075, seconds: 0.50, drive: 'stroke',
    }],
    collider: { shape: 'cuboid', half: [0.50, 0.8225, 0.375], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: ['bigticket'],
  },
  {
    id: 'reactor', netId: 26, name: 'Rarity Reactor',
    desc: 'One duck a minute, from the top four tiers only.',
    cost: 3000, model: 'reactor', footprint: [1.50, 1.53, 1.50], anchor: 'floor',
    kind: 'producer_auto',
    repeat: { times: 4, curve: 1.50 },
    // w_elite: tiers 0-2 weigh nothing, so the worst duck this makes is a 35x
    // and one in eighty is the 1000x. Sixty ducks an hour that need no belt,
    // no fan and one trip -- the only machine in the game whose output is not
    // a transport problem, which is what the price premium buys.
    produce: { secondsPerDuck: 60.0, rarityWeights: 'w_elite' },
    collider: { shape: 'cuboid', half: [0.75, 0.765, 0.75], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: ['bigticket'],
  },
  {
    id: 'factory', netId: 27, name: 'Duck Factory',
    desc: 'Ten ducks every eight seconds. Takes up as much room as it sounds.',
    cost: 4800, model: 'factory', footprint: [2.50, 2.61, 2.00], anchor: 'floor',
    kind: 'producer_auto',
    repeat: { times: 6, curve: 1.40 },
    produce: { secondsPerDuck: 8.0, rarityWeights: 'w_basic', count: 10 },
    collider: { shape: 'cuboid', half: [1.25, 1.305, 1.00], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: ['bigticket'],
  },
  {
    id: 'pipe_endless', netId: 28, name: 'Endless Pipe',
    desc: 'Ducks come out of it continuously. Three a second, forever.',
    cost: 12600, model: 'pipe_endless', footprint: [1.00, 1.4194, 1.00], anchor: 'floor',
    kind: 'producer_auto',
    repeat: { times: 3, curve: 1.60 },
    // "Continuous stream" as data is simply a very small secondsPerDuck. The
    // floor is config.producers.minSecondsPerDuck (0.05), so 0.35 is well clear
    // of it and machineRateMul can still speed it up.
    produce: { secondsPerDuck: 0.35, rarityWeights: 'w_basic' },
    collider: { shape: 'cuboid', half: [0.50, 0.7097, 0.50], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: ['bigticket'],
  },

  // --- the garage, netId 30 ---------------------------------------------------
  {
    id: 'car_spawner', netId: 30, name: 'Truck Garage',
    desc: 'Puts a tipper truck on the plate. Drive it, back it under a belt, tip the load out where you want it.',
    cost: 1450, model: 'car_spawner',
    // Measured off assets/models/car_spawner.glb: a 2.50 x 4.50 pad with a
    // gantry at one end, 2.44 tall. Both horizontal numbers are exact multiples
    // of config.build.grid, which is what lets it butt up against anything else.
    //
    // IT IS THIS BIG BECAUSE THE TRUCK PARKS ON IT. The truck is 3.38 long and
    // 1.74 wide, so a pad it can actually stand on has to beat both -- the first
    // version was 2.00 x 2.50 and the truck could only be put down in FRONT of
    // its own garage, which read as the garage having missed.
    footprint: [2.50, 2.44, 4.50], anchor: 'floor',
    kind: 'spawner',
    // The first truck is FREE and arrives the moment the garage is placed --
    // the player has already paid for it, and a building that asks for more
    // money before it does anything is two purchases for one decision. Every
    // truck after that costs config.vehicle.spawnCost.
    spawn: { what: 'truck', firstFree: true },
    // Three garages is a fleet; more is a frame budget with a button on it.
    repeat: { times: 3, curve: 1.45 },
    // THE PAD, AND ONLY THE PAD. The gantry is 2.44 m of decoration with no
    // collider at all, deliberately: the truck spawns under it and has to be
    // able to drive out through it. A box round the whole building would spawn
    // a 3.4-metre rigid body inside a solid wall, and Rapier's answer to that
    // is to fire it across the yard -- which is exactly what the first version
    // of this row did.
    //
    // 4 cm tall, so it is a low kerb rather than a step: the truck rolls off it
    // and the model carries a shallow ramp at the open end to roll back on.
    collider: { shape: 'cuboid', half: [1.25, 0.02, 2.25], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: ['bigticket'],
  },

  // --- the gambling box, netId 29 --------------------------------------------
  {
    id: 'gamble_box', netId: 29, name: 'Gambling Box',
    desc: 'Pay a fee, watch it rattle itself stupid, and take whatever falls out. Anything in the catalogue can.',
    // THE PRICE IS THE CONFIG KEY, not a copy of it -- but it is the key for
    // THIS price. It used to read config.gamble.cost, which is what a single
    // ROLL costs, so the shop price of the box and the fee to pull its handle
    // were literally the same number: the box paid for itself in one roll, and
    // retuning the fee silently retuned the machine. There are two facts here,
    // so there are two keys (config.gamble.boxPrice and .rollCost), and this row
    // reads the one that is about buying a box. This is the only row in the file
    // that imports config, and it does so for that single reason -- the balance
    // numbers of every other row belong to Phase E and live nowhere else.
    cost: config.gamble.boxPrice, model: 'gamble_box',
    // Measured off assets/models/gamble_box.glb: the body is 0.75 x 0.75 and
    // 0.64 tall, and the LID sits on top of that (its own bbox is 0.21 tall,
    // seated at y = 0.64), so the object a player walks into is 0.85 high. Both
    // horizontal numbers are exact multiples of config.build.grid.
    footprint: [0.75, 0.85, 0.75], anchor: 'floor',
    kind: 'gamble',
    // The moving half of the model. Measured off assets/models/gamble_box_lid.glb
    // and assets/models/gamble_box.glb: the lid is 0.75 x 0.75 x 0.21, it sits
    // shut at the body's top (y = 0.64) with identity rotation, and its hinge is
    // its own REAR BOTTOM EDGE at z = +0.375. The renderer turns it about that
    // edge and knows nothing else about it.
    lid: { model: 'gamble_box_lid', localY: 0.64, hingeZ: 0.375, footprint: [0.75, 0.21, 0.75] },
    // Cheaper than a press and it stacks steeply: six boxes on one plate is
    // already a casino, and the curve is what stops a player carpeting the yard
    // with them the moment they can afford the first.
    repeat: { times: 6, curve: 1.35 },
    collider: { shape: 'cuboid', half: [0.375, 0.425, 0.375], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    // NO `interact` block, deliberately, and it is not an oversight: `interact`
    // means "only this NAMED PART of the model answers the crosshair", which is
    // the workbench's rule because its cabinet is scenery. Here the whole box IS
    // the button, so the row stays silent and src/render/focus.js outlines the
    // entire model -- the promise the player sees and the thing the E key acts
    // on are the same object by construction.
    tags: [],
  },
];

export default MACHINES;
