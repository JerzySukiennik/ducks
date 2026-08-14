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

export const MACHINES = [
  {
    id: 'crank', netId: 1, tab: 'machines', name: 'Manual Duck Workbench',
    desc: 'Ten turns of the wheel, one duck. The only duck source you start with.',
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
    // at machine.useRange, which is the same sphere the crank CLICK tests.
    interact: { part: 'wheel', hint: 'click the wheel' },
    produce: { clicksPerDuck: 10, rarityWeights: 'w_basic' },
    collider: { shape: 'cuboid', half: [1.0496, 1.128, 0.736], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: ['starter', 'placed'],
  },
  {
    id: 'press', netId: 2, tab: 'machines', name: 'Duck Press',
    desc: 'Stamps out a duck every few seconds without you.',
    cost: 200, model: 'press', footprint: [1.00, 1.80, 0.75], anchor: 'floor',
    kind: 'producer_auto',
    repeat: { times: 16, curve: 1.28 },
    produce: { secondsPerDuck: 4.5, rarityWeights: 'w_basic' },
    collider: { shape: 'cuboid', half: [0.50, 0.90, 0.375], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'machine', netId: 3, tab: 'machines', name: 'Duck Assembler',
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
    id: 'vacuum_station', netId: 4, tab: 'machines', name: 'Vacuum Station',
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
    id: 'conveyor', netId: 10, tab: 'machines', name: 'Conveyor',
    desc: 'Two metres of belt. Carries ducks along its length.',
    cost: 110, model: 'conveyor', footprint: [1.00, 0.65, 2.00], anchor: 'floor',
    kind: 'conveyor',
    repeat: { times: 60, curve: 1.035 },
    belt: { speed: 1.6, turn: 0, rise: 0 },
    collider: { shape: 'cuboid', half: [0.50, 0.325, 1.00], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'conveyor_corner', netId: 11, tab: 'machines', name: 'Conveyor Corner',
    desc: 'Turns the belt ninety degrees.',
    cost: 130, model: 'conveyor_corner', footprint: [1.50, 0.66, 1.50], anchor: 'floor',
    kind: 'conveyor',
    repeat: { times: 12, curve: 1.05 },
    belt: { speed: 1.6, turn: 90, rise: 0 },
    collider: { shape: 'cuboid', half: [0.75, 0.33, 0.75], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'conveyor_slope', netId: 12, tab: 'machines', name: 'Conveyor Ramp',
    desc: 'Carries ducks up or down two thirds of a metre. Turn it to choose.',
    cost: 150, model: 'conveyor_slope', footprint: [1.00, 1.555, 2.00], anchor: 'floor',
    kind: 'conveyor',
    repeat: { times: 8, curve: 1.05 },
    // rise MEASURED off the mesh, not taken from the footprint height: the belt
    // surface sits at y 1.55 at the -Z end and 0.86 at +Z, so it climbs 0.69 m
    // across the piece, not the 1.55 previously authored here. 1.55 is how tall
    // the whole housing is, which is a different number that happens to look
    // like a plausible one.
    //
    // The sign is placement-dependent and therefore CANNOT live in this row:
    // driving along local +Z on this mesh goes DOWNhill, and rotating the piece
    // 180 degrees makes the same drive direction go up. A scalar here is right
    // half the time. The belt's climb has to be read off the collider's own
    // tilt. Tracked as an open G3 defect; until then this piece moves ducks
    // along but does not change their height.
    belt: { speed: 1.4, turn: 0, rise: 0.69 },
    collider: { shape: 'cuboid', half: [0.50, 0.7775, 1.00], blockDucks: true },
    snap: { grid: 0.25, yawStep: 15, freeRotate: true },
    tags: [],
  },
  {
    id: 'fan', netId: 13, tab: 'machines', name: 'Fan',
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
];

export default MACHINES;
