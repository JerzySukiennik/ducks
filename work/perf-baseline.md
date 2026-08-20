# Ducks — performance baseline

Every number below was measured with the instrumentation added in this pass, on
the frozen load scenario in `work/perf-scenario.js`. Nothing has been optimised
yet: this file is the "before" column that every later change has to beat.

## How to reproduce

```
python3 serve.py 8124
# open http://localhost:8124/?v=NNN  (a NEW ?v= each time -- reload is not enough)
const s = await import('/work/perf-scenario.js?v=NNN');
s.setup();      // idle case: 300 ducks settled, all asleep
s.measure(240);
// or
s.setupBusy();  // busy case: the same 300 ducks still in the air
s.measure(120);
```

**One page load per measurement.** `setup()` clears placed objects, but dropped
props and trucks accumulate across runs in the same page: a second `setup()` on
a page that had already run one reported 322 bodies where the first reported 304,
and 30 placed objects where the first reported 10. Two runs on one page are not
two runs of the same scenario.

**The measuring instrument is `window.GAME.debugPerfSample(frames)`.** It steps
the real `frame()` by hand `frames` times and averages the breakdown over all of
them, plus the p95 and max of the per-frame wall clock. It exists because rAF is
frozen in a hidden tab, which is where all of this was measured — so `fps` and
`frameMs` read 0 throughout and the honest per-frame total is `wallMeanMs`.

## The scenario

4 presses, 6 fans, 300 ducks, single player. Positions are frozen in
`perf-scenario.js`; moving one changes how many ducks sit in a fan cone and
therefore changes the cost of the automation hooks, which is one of the things
being measured.

Two cases, and the gap between them is the whole story:

| | idle | busy |
|---|---|---|
| what | 300 ducks settled for 10 s | the same 300 still falling |
| awake bodies | 4 | 304 |
| ducks asleep | 300 | 0 |

## Baseline (hidden tab, this Mac)

All figures are ms per frame, averaged over the sample. `phys` is what the
adaptive scaler subtracts, and it is `pre + sim`.

| | idle (240 fr) | idle repeat (240 fr) | busy (120 fr) |
|---|---|---|---|
| **wall mean** | **18.90** | **22.80** | **75.94** |
| wall p95 | 20.10 | 31.50 | 98.90 |
| wall max | 29.40 | 33.40 | 99.10 |
| phys | 13.06 | 14.18 | 66.74 |
| &nbsp;&nbsp;pre-sim | 0.04 | — | 0.12 |
| &nbsp;&nbsp;sim (`world.step`) | 13.02 | — | 66.62 |
| &nbsp;&nbsp;&nbsp;&nbsp;solver (`world.step()`) | 4.84 | 4.33 | **58.74** |
| &nbsp;&nbsp;&nbsp;&nbsp;hooks (automation) | 3.24 | 5.22 | 2.29 |
| &nbsp;&nbsp;&nbsp;&nbsp;ctrl (players + holds) | 1.77 | 2.11 | 1.59 |
| &nbsp;&nbsp;&nbsp;&nbsp;post (`_postStep`) | 3.16 | 2.33 | 3.99 |
| view (step → draw) | 3.17 | 5.49 | 5.11 |
| draw (`renderer.render`) | 2.54 | 2.98 | 3.76 |
| net (host tick) | 0 (single player) | 0 | 0 |
| draw calls | 23 | 30 | 16 |
| triangles | 52 561 | 63 357 | 36 803 |
| shader programs | 20 | 20 | 20 |
| geometries / textures | 39 / 4 | — | 28 / 4 |

The breakdown reconciles: idle `13.06 + 3.17 + 2.54 = 18.77` against a measured
`18.90` wall mean. A breakdown that did not add back up would not be worth
having.

**Run-to-run variance is ±15–20 %** (the two idle columns are the same world
measured twice). No change may be called a win on less than that.

## What the baseline says

**1. Busy is the solver, and almost nothing else.** 58.74 of 66.74 ms — 88 % of
the simulation — is `world.step()` alone with 304 awake bodies. Task 4's lever
(solver iteration count) is pointed at the right thing. Nothing else in the busy
column is worth touching by comparison.

**2. Idle is NOT the solver.** With four awake bodies the solver costs 4.84 ms
and the other 8.2 ms goes to hooks (3.24), post-step (3.16) and controllers
(1.77) — bookkeeping that runs over all 300 duck slots whether or not anything is
moving. On an idle factory two thirds of the "physics" cost is not physics. This
is the Task 6 target and it is bigger than it looks, because an idle-ish factory
is what a player actually sits in for hours.

**3. Pixels are still free, and the measurement in `config.render` still holds.**
`draw` is 2.5–3.8 ms across a fourfold change in awake bodies and a doubling of
triangles. It is never the bottleneck in any column. Do not touch the buffer.

**4. The ducks all go to sleep, so Task 5's feared bug is not present.** After
10 s of settling, 300 of 300 ducks are asleep and the world holds 4 awake bodies.
Nothing is waking the pile every frame.

There is a related trap worth writing down, found while trying to build the busy
case: **`wakeDuck()` on a motionless duck does not keep it awake.**
`ducks.postStep()` keeps its own `idle[]` timer, and a duck that has been asleep
has that timer pinned at `cfg.sleepAfter`. A `wakeUp()` with no velocity behind
it therefore falls straight through the 10-second backstop and is put back to
sleep in the same substep. Measured: 304 awake immediately after waking all 300,
4 awake one frame later. That is correct for gameplay (a real impulse arrives
with velocity) but it means the busy case has to be built from ducks that are
genuinely moving, which is why `setupBusy()` skips the settle rather than waking
a settled pile.

**5. Shaders are not warmed, and it costs a fifth of a second.** On the very
first frame of a fresh boot, `draw` measured **223.90 ms** against the 2.5–3.8 ms
it costs once running. The program count climbs from 13 at boot to 20–21 as more
of the world appears, so materials are still being compiled well after the first
frame. Task 7 has real work in it; this is the number it has to move.

## Caveats

- **Hidden tab.** All of this is measured with the browser pane hidden, which
  inflates the absolute numbers. They are internally comparable — same harness,
  same scenario, before and after — but they are not the frame times a player
  sees.
- **A concurrent editor was writing this repo mid-session.** A separate change
  (`world.plateSeamOverlap`, plus edits to `src/sim/pit.js`) landed in the working
  tree while these measurements were being taken, and it is present in the build
  every number above came from. It also produced one transient
  `recursive use of an object detected` crash from Rapier when a page loaded half
  its modules either side of the write; that fault did not reproduce on a
  consistent tree and is not a defect in the instrumentation. Any "after" column
  has to be measured against this same tree, not against `HEAD`.

## Changes measured so far

| change | before | after | verdict |
|---|---|---|---|
| instrumentation only (this pass) | — | — | no logic changed |

Nothing has been optimised yet. Task 1 stops here by instruction.
