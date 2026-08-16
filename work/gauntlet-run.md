# Gauntlet run

- Run ID: 2026-08-14-ducks-10
- Status: ACTIVE
- Mode: FULL MULTI-AGENT
- Objective: land ten requested changes in Ducks so each is observable in the running game and none regresses a measured behaviour from v1.6.
- Artifact: the Ducks repo at `/Users/jurek/Downloads/Claude/Projects/Ducks`, deployed as vNEXT.
- Reference mode: PROXY (benchmark profile; there is no external build of this game to A/B against)
- Rubric version: v1
- Budget: rounds <= 3; stop early on diminishing returns
- Approval boundaries: no deploy without Jurek's word; no external services; no spending.

## Benchmark profile (proxy, observable attributes)

1. Every one of the ten items is demonstrable by a measurement or a rendered
   frame, not by reading the diff.
2. Frame budget holds: 300 ducks + 40 objects, frame <= 16 ms, draw calls <= 120,
   physics <= 4 ms (the gate this project has used since G0).
3. `src/sim/**` and `src/data/**` still import nothing from three.js.
4. Single player and multiplayer both still boot with zero frame errors.

## Rubric (weights total 100; floors are out of 5)

| # | Dimension | Weight | Critical floor | Anchor |
|---|---|---:|---|---|
| 1 | Requested behaviour present | 30 | 4 | each item observable in the running game by a stated measurement |
| 2 | No regression | 25 | 4 | crank, tools, containers, pit payout, multiplayer sync still measure as before |
| 3 | Performance | 15 | 4 | the G0 frame budget above, measured on the overlay |
| 4 | Architecture kept | 15 | 4 | sim/data free of three.js; new state host-authoritative; no `if (id === ...)` |
| 5 | Feel and looks | 15 | 3 | rendered frames and audio actually read as the asked-for change |

## Acceptance gates (binary, cannot be averaged away)

- G1: all ten items implemented or explicitly reported as blocked with the reason.
- G2: `grep -rn "from 'three'" src/sim/ src/data/` is empty.
- G3: game boots single player, zero errors in `debugStats().errors`.
- G4: host + client both boot, client sees the host's world.
- G5: frame budget met with 300 ducks.
- G6: nothing user-facing removed that was working in v1.6.

## Pass rule

>= 85/100, every critical floor met, all six gates pass, final review by a
fresh-context Critic that did not build the candidate.

## Baseline (v1.6, measured this session)

- grain: `render.grainAmount` already 0 (overlay off since the third request); the
  remaining noise is the concrete material, which Jurek previously asked to KEEP.
  Item 9 therefore means the concrete, and that is a reversal of an earlier
  instruction -- flagged, not assumed.
- shadows: `renderer.shadowMap.enabled = false` -- shadows have never been on.
- duck mass: `config.ducks.mass = 0.16`.
- map: `config.world.plateSize = 120`.
- Gargantua: `RS 0.115`, `DISK_IN 1.8`, `DISK_OUT 7.2`, `BEAM 0.42` in
  `src/render/blackhole.js`.
- neon_ducks model: 240 tris, five identical bars instead of letters.
- avatars: one capsule per player, no hands, no limbs, no animation.
- new audio supplied by Jurek: `new audio/cashgetting.mp3`, `new audio/manualgearclick.mp3`.

## Round 1

- Builder A: audio swap + synthesized pit sound + tuning page (items 1, 4)
- Builder B: map, shadows/ambient, Gargantua, grain (items 5, 6, 8, 9)
- Builder C: hold-to-crank with fill bar and spinning wheel (item 2)
- Builder D: better models (item 7)
- Orchestrator: duck mass (item 10), then gambling box (item 3) after C frees main.js

### Item 10 (Orchestrator) — lighter ducks / sweepable ducks: DONE, measured

The request was "make ducks lighter, it is very hard to sweep them". Mass alone
would not have fixed sweeping and the measurement says so: the broom and the
belts scale their impulse BY MASS (they target a velocity), so a lighter duck
takes a proportionally weaker shove and slides exactly as far. Slide distance is
v^2 / (2 mu g) -- no mass in it.

What actually pinned the ducks was friction, and the bigger half of it was the
concrete: Rapier averages the two contact frictions, and the plate had 0.9
hardcoded in src/sim/world.js. Dropping only the duck (0.6 -> 0.32) moved the
pair to 0.61 and bought almost nothing.

| sweep impulse | before | after |
|---|---:|---:|
| 2.0 m/s | 0.116 m | 0.230 m |
| 3.0 m/s | 0.264 m | 0.520 m |

Changed: `ducks.mass` 0.16 -> 0.11, `ducks.friction` 0.6 -> 0.32,
`ducks.linearDamping` 0.06 -> 0.04, and the plate's friction lifted out of
world.js into `world.plateFriction` = 0.45.

Regression checks: 21 ducks spawned, all 21 asleep after 15 s (they still
settle), `errors` 0.

FLAG FOR JUREK / ECONOMY: fans apply a real FORCE, so their acceleration is F/m.
A duck at 0.11 kg instead of 0.16 is pushed by the wind about 45% harder, and the
fan chain was tuned in phase E against the old mass with force 26. The economy
curve should be re-run before this is called balanced.

### Builder A (audio, items 1 + 4) — RETURNED

- cash.mp3 <- cashgetting.mp3, crank_click.mp3 <- manualgearclick.mp3; old files kept
  as *.legacy.mp3; loudness matched so the by-ear mix gain still lands.
- NEW src/audio/pitsynth.js: the pit payoff is now synthesized. Pitch climbs a
  major pentatonic, one degree per duck, capped +31 st; the run holds 2.5 s after
  the last duck then slides back at 3 ducks/s.
- NEW work/pit-lab.html with 27 live controls, single/20/60-duck bursts, a streak
  preset, snippet export and a reset. Imports the SAME module the game uses.
- Measured in the running game: 300 -> 336.7 -> 378 -> 449.5 ... -> 1798 Hz over
  14 ducks, then flat at the ceiling; 16 started, 0 dropped, 0 silent. Decay
  measured on the SIM clock: 16 -> 0 after 8 simulated seconds.
- Found and fixed a real bug mid-run: the voice cap counted scheduled notes as
  live and dropped the last 4 of a 16-duck dump -- i.e. exactly the payoff.
- Coverage gate passes; 39/39 clips load; errors 0; sim/data still three-free.

NOT VERIFIED: how it SOUNDS. Jurek judges that in the lab. Also unverified:
client-side pit events in multiplayer, mobile Safari.

Cross-builder observation worth keeping: while Builder C's edit was mid-flight the
frame loop threw, and a dead frame silently freezes the audio clock -- the first
decay measurement was invalid because of it and had to be re-run.

### Builder D (models, item 7) — RETURNED, PARTIAL

Blender MCP was NOT reachable; the builder ran Blender headless instead and said
so. It first proved the pipeline: rebuilding the UNMODIFIED neon_ducks produced a
byte-identical GLB, so the generator really is the source of truth and its
rebuilds can be trusted. It rendered all 81 models to a contact sheet and ranked
by what it saw.

Fixed: neon_ducks (the named gate -- real stroke-built letters, readable when
downsampled to 72 px, 240 -> 300 tris), lasso (loop now vertical; all its shape
was in a top-down view the player never sees; 580 -> 408 tris), ramp (24 -> 120),
wall_high (72 -> 132), bucket (colour only -- its cavity is a contract with
src/data/tools.js and was verified unchanged).

Near-miss caught by the builder: its first ramp pushed the model 16 mm past the
0.92 height that buildings.js hard-codes in three places. It fixed the MODEL to
fit the data rather than asking to change the data. Exactly the right call.

Also built for the gambling box: gamble_box (144 tris) + gamble_box_lid (60),
0.75 x 0.75, lid sits at y = 0.64, hinge at the lid's rear bottom edge
(y=0, z=+0.375). The body's hue field is one large block so a colour swing reads
as flashing rather than mud.

ITEM 7 IS PARTIAL. Untouched and named as the next-worst tier: fire_hose, geyser,
the three near-identical fans, lamp vs lamp_post, ice_slide, sign_dir. "Ten times
better on all models" is NOT met yet -- five were fixed, not eighty.

### Builder B (world & graphics, items 5, 6, 8, 9) — RETURNED

- Map: plateSize 120 -> 180. Checked all SEVEN call sites first. Half is 90.0 m,
  an exact multiple of build.grid, and 180 is exactly 6 concrete tiles, so the
  edge lands on a painted joint. `machine.z` stays 35: the opening walk is
  unchanged, there is simply 55 m of plate behind the bench instead of 25.
  Fog retuned so the far edge fades rather than ending in a line.
- Shadows: one directional light, BasicShadowMap, 1024 map over a 68 m box that
  FOLLOWS the player and is snapped to its texel grid IN LIGHT SPACE (6.6 cm per
  texel; a duck is 3 texels wide). Two casters deliberately opted out, both found
  by looking at the first frame: the pit shaft (an inside-out cylinder dropping a
  solid blob beside the hole) and the chute (whose vertex colours fade it into
  the sky while its shadow did not, painting a 20 m stain).
- Gargantua: RS 0.115 -> 0.190 is the ONLY statement of scale; the shader works
  in b/RS so the photon ring and halo grow with it and stay welded to the shadow
  edge. DISK_OUT had to come down to 4.6 or the disk would have been cut off by
  the quad's own edge. Shadow disc 5.3 deg -> 16.4 deg apparent.
- Grain: `world.floorGrain` 4 -> 2, the only knob moved. Measured on the
  generated tile: high-frequency energy -46%, overall std dev -6% -- i.e. the
  speckle halved while the blotches, joints and cracks are untouched.

Independently re-checked by the Orchestrator: RS 0.190, DISK_OUT 4.6, BEAM 0.52
in the shader; shadows now read from config; sim/data still import zero three.js.

Performance, shadow cost isolated back-to-back on identical world state:
render 0.090 -> 0.198 ms, draw calls 9 -> 16, tris 161k -> 324k. Inside the gate.

CAVEAT the builder raised itself: the machine hit load average 32.7 with six game
tabs open (the other builders), and under that contention physMs read 16-20 ms
for THREE awake ducks, which is impossible and is contention, not the change.
The frame budget deserves one clean re-measure once the tabs are closed. G4
(multiplayer) untested by this builder, deliberately.

### Builder C (hold-to-crank, item 2) — RETURNED, RE-VERIFICATION REQUESTED

Reported: charge in SECONDS, 1 s per second per holder; release drains at 0.5 s/s
(a full bar survives 10 s away, a finger slip costs almost nothing); the pop
carries the remainder over so a continuous hold is a perfect 5.00 s loop; after
each pop the wheel is forced to coast to a stop for 0.45 s even while held, so
every duck is punctuated by a visible spin-down and the charge keeps filling
through it.

Its own measurements: 1 duck at t=5.017 s; omega 0.16 -> 28.46 rad/s during the
fill and back to 0 at 1.18 s after release; ONE press held 11 s produced ducks at
5.017 and 10.017 without a release; 30 rapid one-frame clicks produced ZERO ducks
(the anti-autoclicker point); co-op measured host+client, one holder 5.017 s vs
two holders 2.500 s; and -- the rule-6 proof -- with only the CLIENT holding, the
host's wheel filled and popped while the host's own button was up.

Swift Hands remapped from clicks-per-duck to seconds-per-duck: same stat, same
direction, floored at 0.5 s, and no more rounding to a whole click.

INTEGRATION PROBLEM: on the merged tree the Orchestrator could NOT reproduce it.
debugCrankState(0) returns holders 0, cranking false, grabHeld false after
debugLookAtWheel + debugCrank(11, {keepHeld:true}); no ducks; errors 0. Sent back
to the builder to re-measure against the integrated tree and say whether this is
harness or regression. NOT counted as done until that returns.

Open risks the builder named itself: a client infers wheel speed from the
percentage stream rather than being sent it, so a wheel pinned at 100% (pool at
cap) coasts down on clients while the host's still spins; looking away does NOT
stop a hold (only releasing or walking out of range does) -- a deliberate rule
change worth Jurek's opinion.

### Playtest round — items 1-4 of Jurek's quick list: DONE, measured

My failed repro was HARNESS, diagnosed by the builder and now provable: the wheel
hub sits at x = -0.75 and `props.wheelAimDistance` refuses an aim from the wrong
side of the cabinet (an occlusion stand-in, present since v1). I stood at +x. New
`debugStandAtWheel(key)` removes the trap for good.

- Label bounce: focus.js anchored to boundingBox x the LIVE matrix -- which for
  the wheel is the spinning one, so the anchor rose and fell once per revolution.
  Targets may now declare a fixed world anchor; the wheel uses its hub.
  Measured over 2 s of cranking: 142.94 px peak-to-peak -> 0.00 px, 120/120
  frames, and it still tracks the world when the player walks.
- Spin: peak 28.46 -> 148.48 rad/s, and it now passes the OLD peak within 1.0 s.
  23.6 rev/s = 142 deg per frame. Ramp curve, floor and ceiling all named in
  config. Duck rate untouched: first duck 5.017 s, gap 5.000 s.
- Bar: 222x12 -> 342x24 px, centred on the crosshair to within (1,1) px, no digit
  in the prompt, pop flash kept, crosshair kept above the bar.
- `interact.hint` 'click the wheel' -> 'hold to crank'.

Orchestrator re-verified independently on the integrated tree: one continuous
hold -> 2 ducks, omega peak 27.4 rad/s at the sample instant, omega 0 after
release, 30 rapid clicks -> 0 ducks, prompt "Hold left click to crank", errors 0.

Builder's own risk, worth Jurek's eyes: 142 deg/frame is aliasing, not blur. If
he wants a smooth smear that is a material job, not a number.

### Models round 2 — crank wheel, workbench, crank_bot: RETURNED

Blender MCP unreachable again; headless Blender again, and the pipeline re-proved
itself: a full 84-model rebuild reproduced every untouched non-textured model
byte-identically.

The builder wrote a VALIDATOR that replays the game's own wheel-split predicate
against the exported GLB before trusting it, and it caught two bugs that would
otherwise have shipped:
  - frame posts that satisfied the split predicate, which would have spun 747
    CABINET triangles with the wheel and dragged the wheel's centre from 0.78 to
    0.6575;
  - a bolt plate that widened the model, moved the bbox centre, and shifted every
    game-space coordinate until the body's own side face crossed the threshold.
That is the right kind of test: executable against the artifact, not a look.

- crank: 300 -> 1026 wheel tris. Open wheel -- 12-segment rim alternating
  hazard/dark, six spokes, exposed hub, crank arm sweeping outside the wheel
  plane. Spin sheet shows the old disc essentially identical at 0/20/40/60 deg
  and the new wheel changing at every step, which was the whole point.
- workbench: teal body -> dark steel with frame members, corner posts, cross
  belts, plinth, bolt plate. Yellow now only on the wheel and pipe mouth. Note
  there are no separate bought-bench variants -- one model serves them all.
- Contracts held exactly: crank still 1.3124 x 1.4100 x 1.3300 and the hub still
  at (0.4685, 0.78, -0.225), verified by the Orchestrator.
- crank_bot: 944 tris. Origin IS the wheel hub (no offset to compute), +X is the
  rotation axis pointing outboard, arm along +Y reaching radius 0.285 inside the
  0.34 rim. Reports GRID-FAIL and negative minY BY DESIGN -- it is a mounted
  part, not floor-placed.

Flagged by the builder: crank went 2092 -> 3280 tris (+57%) and the bench is
placeable in quantity; it offered ~400 back from hidden pipe segments.
Still outstanding, tier 3: fire_hose, geyser, the three indistinguishable fans,
lamp vs lamp_post, ice_slide, sign_dir.

### Fan spin, airflow and build hints — RETURNED

- Blades: NO blade object exists in the GLBs, so a new src/render/rotor.js FINDS
  them by measuring the mesh -- connected parts grouped by surface area
  (rotation-invariant), then the group of k>=3 congruent parts at equal radius,
  evenly spaced about the row's OWN blow axis. Matched the generator exactly for
  all three fans (4 @ 0.269 vs 0.27, 5 @ 0.312 vs 0.31, 4 @ 0.239 vs 0.22).
  Near-miss recorded in the file: at a 2% area tolerance the heavy fan's motor
  cube joined its blades and the fan spun its CAGE RING instead; tolerance is now
  0.2%.
- Airstream drawn from blowers.fieldAt() itself, so brightness IS the field.
  Axis agreement between drawn cone and physics: max error 3.4e-8 over 8 yaws.
  The duck test is the good one: at 3 m downstream every duck inside the drawn
  cone moved 4.75-5.00 m and every duck outside moved EXACTLY 0.000 m, with the
  boundary between perp 2.595 and 2.788 against a drawn radius of 2.726.
- Build hints per KIND: blower cone, conveyor path (sampled through the turn so a
  corner curves), collector radius. Appear and vanish exactly with the hologram.
- Cost, isolated A/B in one frame state: +0.17 ms render, draw calls 13 -> 22,
  tris +10.7%. Inside the gate.
- Orchestrator applied its requested main.js hook: placed.syncProps(simTime).

REAL BUG FOUND, NOT YET FIXED: the fan MODEL faces the opposite way to its own
wind. sim/build.js yawQuaternion uses three's Y-rotation (+Z -> (sin, cos)) while
blowers.js and conveyors.js drive movement off (-sin, cos). They agree at yaw
0/180 and are MIRRORED IN X everywhere else. Measured on a fan at yaw 90: wind
and physics both (-1,0,0), model body +Z basis (+1,0,0); a duck on the model's
face side travelled 0.000 m. Every conveyor at 90/270 carries the same way.

### Container side intake — geometry measured, SIM HALF STILL OPEN

The art pass cut the intake and left the cavity, footprint and height untouched,
so nothing in src/data/** moves (tools.js half [0.9825, 0.90, 2.1047] verified
against the rebuild). Numbers, exported Y-up, origin = footprint centre in XZ,
floor y = 0:

- opening centre (0.000, 0.790, +2.1548); outer plane z=+2.2049, inner z=+2.1047
- clear span 0.9825 m wide x 0.900 m tall, x -0.4913..+0.4913, y 0.340..1.240
- belt feed at yaw 0: discharge lip (0, ~0.585, +2.35) travelling -Z; a flat
  conveyor centres at (0, floor, +3.30), same yaw. Sill 0.245, headroom 0.269.
- conveyor_slope's HIGH end (duck crown 1.578) does NOT clear the lintel at
  1.240 -- a slope must feed from its LOW end, or the lintel goes to ~1.62 and
  eats most of a 1.90 m wall.

WHAT IS LEFT: containers.js capture() still only accepts a duck through the top
mouth (interior half/offset plus cfg.mouthHeight ABOVE the rim). A duck arriving
horizontally at belt height is not taken in. Until capture() learns the side
aperture, the intake is geometry only -- it LOOKS like it should work, which is
worse than not having it.
