// The repeatable load scenario every number in work/perf-baseline.md is measured
// on. It exists as a file rather than as a paragraph of instructions because a
// performance comparison between two builds is worthless unless both builds were
// carrying exactly the same world, down to where each fan is standing.
//
// Load it from the page (the dev server serves the repo root):
//   const s = await import('/work/perf-scenario.js'); await s.setup(); s.measure(300)
//
// It never touches rAF: the whole thing runs through window.GAME.debugStep and
// debugPerfSample, both of which pump the real frame by hand, because a hidden
// tab freezes requestAnimationFrame and every measurement taken here is taken in
// a hidden tab.

// Four presses and six fans, at fixed coordinates. The positions are arbitrary
// but they are FROZEN: moving one changes the number of ducks inside a fan cone
// and therefore changes the cost of the automation hooks, which is one of the
// things being measured.
export const PRESSES = [
  { x: -6, y: 6, z: -10 },
  { x: -2, y: 6, z: -10 },
  { x: 2, y: 6, z: -10 },
  { x: 6, y: 6, z: -10 },
];

export const FANS = [
  { x: -7, y: 6, z: -5 },
  { x: -4, y: 6, z: -5 },
  { x: -1, y: 6, z: -5 },
  { x: 2, y: 6, z: -5 },
  { x: 5, y: 6, z: -5 },
  { x: 8, y: 6, z: -5 },
];

const DOWN = { x: 0, y: -1, z: 0 };

export function setup(opts) {
  const o = opts || {};
  const ducks = o.ducks === undefined ? 300 : o.ducks;
  const settleSeconds = o.settle === undefined ? 10 : o.settle;
  const g = window.GAME;
  const out = { placed: [], failed: [] };

  if (!g.debugStats().inRoom) g.debugPlaySolo();
  // START FROM AN EMPTY PLATE, ALWAYS. A run that begins on top of whatever the
  // last run left standing measures a different factory each time, and the whole
  // point of this file is that it does not. Measured the hard way: a second
  // setup() on the same page reported 30 placed objects where the first reported
  // 10, and the two frame times were not comparable.
  g.debugClearPlaced();
  g.debugGiveMoney(500000);
  g.debugStep(0.5);

  const put = (id, at) => {
    const res = g.debugPlace(id, at, DOWN, 0);
    if (res && res.placed) out.placed.push(id);
    else out.failed.push({ id, at, reason: res && res.reason });
  };
  for (const p of PRESSES) put('press', p);
  for (const f of FANS) put('fan', f);

  g.debugSpawnDucks(ducks);
  // Let the pile find the floor before anything is measured. A world still
  // resolving 300 fresh interpenetrations is a different world from a factory
  // that has been running, and it is the running one the player sits in.
  g.debugStep(settleSeconds);

  const s = g.debugStats();
  out.bodies = s.bodies;
  out.awake = s.awake;
  out.ducksLive = s.ducksLive;
  out.ducksSleeping = s.ducksSleeping;
  out.placedObjects = s.placedObjects;
  out.money = s.money;
  return out;
}

// Frames, not seconds: the sampler steps the loop by hand at fixedDt, so 300
// frames is 5 s of simulated time however long it takes to run.
export function measure(frames) {
  return window.GAME.debugPerfSample(frames === undefined ? 300 : frames);
}

// TWO CASES, AND THE GAP BETWEEN THEM IS THE WHOLE STORY.
//
//   idle  the same 300 ducks after they have settled -- Rapier has put them all
//         to sleep and the solver has almost nothing left to integrate
//   busy  the same 300 ducks in the air, every one of them awake
//
// A host pays for awake bodies and for nothing else, so measuring only one of
// these would answer half the question. setup() leaves the world in `idle`;
// wake() puts it back into `busy` without respawning anything, so both numbers
// come off an identical world.
// WAKING A STILL DUCK DOES NOT MAKE IT BUSY, and finding that out cost an hour.
// ducks.postStep() keeps its own idle timer, and a duck that has been asleep has
// that timer pinned at cfg.sleepAfter -- so a wakeUp() with no velocity behind it
// falls straight through the backstop and is put back to sleep in the SAME
// substep. Measured: 304 awake immediately after waking all 300, 4 awake one
// frame later. That is correct behaviour (a real impulse comes with velocity),
// but it means the busy case has to be made of ducks that are actually moving.
export function wake() {
  const g = window.GAME;
  let n = 0;
  g.world.ducks.forEach((id) => { g.world.wakeDuck(id); n++; });
  return n;
}

// The busy world: the same factory with the ducks still in the air. settle 0
// leaves them mid-fall and mid-collision, which is what a running factory looks
// like and is the case a host actually pays for.
export function setupBusy(opts) {
  const o = opts || {};
  return setup({ ducks: o.ducks, settle: 0 });
}
