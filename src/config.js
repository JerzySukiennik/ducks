// All tunables for the Ducks harness. Nothing else may hardcode a number.
// assertConfig() is the boot-time contract: a missing key is fatal, never silent.

export const config = {
  version: '0.1.0',

  render: {
    bufferWidth: 480,
    // THE FLOOR IS 480, NOT 320, AND THE REASON IS A MEASUREMENT.
    //
    // The adaptive scaler in src/core/perf.js judges the buffer by the rAF
    // INTERVAL -- the whole frame, physics and net encode included -- and then
    // blames the only thing it can move, which is how many pixels are drawn.
    // In this game that is the wrong lever, and here is the A/B on a host with
    // the intro's set staged (identical world state, awake count matched):
    //
    //   buffer   avg frame   (4x the pixels between the two rows)
    //   320x180    5.77 ms
    //   640x360    5.67 ms
    //
    // Four times the pixels for nothing outside the noise. The renderer is not
    // what costs; the solver and the host's own bookkeeping are. So a host --
    // which pays for everyone's physics and everyone's state stream -- runs
    // long frames, the scaler ratchets the buffer down 80 px at a time, the
    // frames do not get shorter, and it ends up pinned at the minimum while a
    // client doing a fraction of the work sits at the maximum. That is exactly
    // the defect Jurek reported: his brother's picture perfect, his own full of
    // grain with fat jagged outlines round the wheel and the booth. It is one
    // number: at 320 into a 2560 px window every backbuffer pixel is an 8 px
    // block, so focus.outlineWidth (2.6 BACKBUFFER pixels) draws a 21 px rim
    // and the concrete's per-texel noise becomes 8x8 blocks of screen.
    //
    // Raising the floor to the shipped default means the picture can never end
    // up WORSE than a fresh boot, whatever the scaler decides. The valve is
    // kept (480 -> 640 still adapts) because a phone GPU has not been measured
    // here and 4x pixels being free on this Mac is not a promise about an
    // iPhone XR. The real fix is to adapt on the render cost rather than on the
    // frame interval, which lives in src/core/perf.js -- reported, not mine.
    bufferWidthMin: 480,
    bufferWidthMax: 640,
    fallbackAspect: 16 / 9,
    fov: 70,
    near: 0.1,
    far: 400,
    // THE HORIZON COLOUR, and it is one colour in three places on purpose.
    //
    // clearColor, fogColor and world.horizonColor are all 0x141017. The plate
    // fades into the fog, the fog is the same value the sky dome reaches at its
    // bottom, and the buffer clears to it -- so there is no seam anywhere along
    // the horizon for the eye to catch. Splitting these three is how the old
    // hard line got there: the fog went to 0x0a0f1e while the dome's bottom was
    // 0x2b3350, a 3:1 step in luminance drawn across one backbuffer pixel.
    //
    // 0x141017 also is not blue any more. It is CRT.bg (#0b0906, src/ui/theme.js)
    // lifted far enough off black that the plate has somewhere to fade TO, kept
    // barely warm so it belongs to the amber game rather than to the cold-blue
    // one this was a leftover of.
    clearColor: 0x141017,
    fogColor: 0x141017,
    // EXPONENTIAL, not linear, and this is the fix for "the opening shot does
    // not read". THREE.Fog is linear between fogNear and fogFar, which means it
    // does nothing at all inside fogNear and then ramps at a constant rate --
    // so a plate whose edge sits at 90 m dead ahead but 127 m at the corners
    // came out 27% faded in the middle and 76% at the sides. That is not
    // "atmosphere", that is a visible curved boundary painted onto the floor,
    // and dead ahead -- exactly where the workbench is -- it was the weakest.
    //
    // FogExp2 is 1 - exp(-(d*density)^2): no near plane, no far plane, and the
    // falloff is smooth everywhere, so distance reads as distance at every
    // range instead of only past 55 m.
    //
    // 0.011 is picked off the three distances that matter, not by eye:
    //   10 m (a duck at play distance)   1.2% -- untouched, as it must be
    //   35 m (the bench, from the pit)    13% -- separated from its background
    //   90 m (the plate edge dead ahead)  55%
    //  127 m (the plate edge at a corner) 78%
    // The walk is still essentially fog-free, the objective is now sitting in
    // air rather than pasted on, and the edge of the world is most of the way
    // gone before it arrives. What finishes the job is world.horizon, the
    // silhouette band standing BEHIND the plate edge: fog alone cannot hide a
    // boundary, it can only soften one, so something has to occlude it.
    fogDensity: 0.011,
    // Film grain. grainAmount is THE knob: it scales the whole effect and is the
    // only value to touch when the grain reads too strong or too weak.
    // grainOpacity/grainStrength describe the layer's reference shape (a +/-34
    // grey noise field at 7% layer opacity) and are left alone.
    // 0 = the film-grain overlay is OFF. Asked for three times, each time
    // lighter, and finally "usun totalnie grain". At 0 the noise layer is not
    // drawn at all, so it costs nothing rather than costing a composite per
    // frame at invisible strength.
    //
    // This knob is the OVERLAY only. The other noise source on screen is
    // world.floorGrain, the speckle baked into the concrete tile. That one has
    // now been HALVED (4 -> 2) because the request for less grain came back
    // with this knob already at 0, so it could not have meant this one. The
    // reasoning and the exact reversal it represents are written where the
    // number lives, in world.floorGrain. They are still two separate knobs and
    // must not be folded together.
    grainAmount: 0,
    grainOpacity: 0.07,
    grainFrames: 6,
    grainStrength: 34,
    floorAnisotropy: 16,
    // Vignette. A static radial darkening composited by CSS over the upscaled
    // backbuffer -- one element, painted once, zero per-frame cost, and no
    // post-processing composer (which is the settled PSX approach here: see the
    // inverted-hull outline in focus.js for the same rule).
    //
    // 0 turns it off entirely and the element is not drawn. vignetteInner is
    // where the darkening starts and vignetteOuter where it reaches full
    // strength, both as a fraction of the distance from the screen centre to
    // the corner, so the shape is resolution independent.
    vignetteAmount: 0.38,
    vignetteInner: 0.45,
    vignetteOuter: 1.05,

    // The fan's rotor. src/render/rotor.js finds the blades in the baked mesh
    // by measuring the model (k congruent parts, equal radius, evenly spaced
    // about the blow axis) rather than by naming one, so these numbers apply to
    // every blower row there will ever be.
    //
    // turnsPerSecond is picked against the frame, not against realism: the Fan
    // has four blades, so its picture repeats every 90 degrees and it starts
    // reading as a wagon wheel at 15 rev/s on a 60 Hz frame. 2.2 rev/s is
    // 13 degrees of blade a frame -- unmistakably turning, nowhere near the
    // alias. The Updraft Fan's own spin is scaled by its force against the
    // Fan's, so a stronger fan visibly runs faster.
    fanSpin: {
      turnsPerSecond: 2.2,
      referenceForce: 26,     // the Fan's blow.force; the unit the scaling is in
      forceExponent: 0.5,     // sub-linear, so the Heavy Fan is faster, not silly
      maxTurnsPerSecond: 4.0,
    },

    // The visible airstream. Read src/render/airflow.js: the SHAPE is the row's
    // own cone and the BRIGHTNESS is blowers.fieldAt() evaluated on the shell,
    // so nothing in here changes where the wind is -- only how legible it is.
    airflow: {
      // THE WIND, ported from Jurek's fan_wind_shader.gdshader. Streaks rather
      // than bands: a band says "something is moving this way", a streak also
      // says how fast, because a streak has a length.
      wind: {
        speed: 1.5,
        strength: 0.8,
        trails: 8,
        width: 0.012,
        length: 0.2,
        randomness: 0.7,
        spawnRate: 2.0,
      },

      color: 0x9ad8ff,
      // Two knobs, and they were set by looking at the frame, not by taste: at
      // 0.5 the cone was a solid tunnel of smoke you could not see the plate
      // through, which is a worse lie than an invisible fan -- it hides the
      // ducks it is supposed to explain. 0.16 additive over the concrete reads
      // as moving air and leaves every duck inside it visible.
      opacity: 0.16,
      brightness: 1.0,
      // The two shells, as fractions of the cone's local radius. The skin is
      // where the field has almost died (the edge term makes it faint by
      // itself) and the core is where it is at full strength.
      skinShell: 0.94,
      coreShell: 0.46,
      segments: 12,
      stations: 8,
      // Bands of moving air along the jet, and how fast they travel down it.
      bands: 7,
      scrollPerSecond: 1.6,
      bandDuty: 0.34,
      bandSharpness: 1.5,
      instanceCapacity: 64,
    },

    // Build hints: what a thing will DO, drawn while the hologram is up. Lines
    // rather than volumes, because the player is aiming at the ground the
    // volume would cover.
    hint: {
      opacity: 0.85,
      coneSegments: 16,
      // Only the fallback cone uses these now -- a tilted or non-floor blower,
      // where there is no ground plane to project the wind onto.
      coneRings: 4,
      coneSpokes: 8,
      // A floor-standing blower's hint is drawn in the plane a duck's centre
      // sits in: the wind's FOOTPRINT, closed by a bar at its far end, instead
      // of a cone whose lower half is inside the concrete. See the long note in
      // src/render/airflow.js for the measurements that say the length itself
      // was never the lie.
      footprintSamples: 24,
      footprintRibs: 3,
      footprintTick: 0.35,
      // The contour is drawn at the duck's centre height; this lifts it clear
      // of the duck meshes themselves.
      footprintLift: 0.02,
      // A conveyor's travel path, sampled across the piece so a corner's turn
      // is drawn as the curve a duck actually takes.
      pathSamples: 16,
      chevrons: 4,
      chevronSize: 0.30,
      pathLift: 0.12,
      // A collector's pull radius, drawn on the floor.
      circleSegments: 32,
      circleLift: 0.03,
    },

    // THE CONTACT SHADOW under every placed object and every dropped prop.
    //
    // The measurement that put it here, taken in this 480 px backbuffer with a
    // Machine standing on clean plate at 10 m: floor luminance 88, machine body
    // luminance 80 -- 1.10:1 across the edge the eye uses to find the object.
    // The full argument for darkening the FLOOR rather than repainting the
    // object or moving the plate is written where the material is built, in
    // src/render/materials.js.
    //
    // One InstancedMesh for every contact patch in the world, so this is ONE
    // extra draw call however many objects are standing.
    contact: {
      enabled: 1,
      // Peak darkening straight under the object, and it was tuned by walking
      // the floor away from a placed Machine and reading the backbuffer, not by
      // taste. At the shipped 0.62/2.10/0.30 the floor 0.7 m from the base
      // measures luminance 55 against an undarkened 88 -- and back to 90 by
      // 1.0 m, so the darkening is local to the contact rather than a stain the
      // object sits in. The first pass at 0.55/1.45/0.42 measured 87 at the
      // same point on the smaller models, i.e. it did nothing outside the
      // footprint at all, which is the failure mode `spread` exists to avoid.
      opacity: 0.62,
      // How far the patch spreads past the object's own footprint, as a
      // multiplier on its collider half-extents. Comfortably over 1, because a
      // patch that stopped at the footprint would be entirely hidden by the
      // object standing on it and would do nothing from a standing camera --
      // measured, see the note on `opacity`.
      spread: 2.10,
      // Metres above the plate. Belt and braces with the polygon offset below;
      // see the markings for the same pairing and the same reason.
      lift: 0.012,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      // The alpha ramp. `core` is the fraction of the half-extent held at full
      // darkness before the penumbra starts.
      textureSize: 64,
      core: 0.30,
      // Capacity of the single shared pool. build.instanceCapacity is per
      // MODEL; this one pool has to hold a patch for every placed object of
      // every model at once, so it is sized independently.
      capacity: 512,
    },
  },

  perf: {
    bufferWidthStep: 80,
    sampleWindowMs: 2000,
    downMs: 22,
    upMs: 17,
    cooldownMs: 4000,
    maxSampleMs: 100,
    visibilityGraceMs: 1200,
  },

  loop: {
    fixedDt: 1 / 60,
    maxFrameDt: 0.25,
    maxSubsteps: 5,
    maxLoggedErrors: 1,
  },

  // The tipper truck. Geometry lives in src/data/vehicles.js (it is measured off
  // the models); everything here is FEEL and cost, which is the split every
  // other block in this file keeps.
  vehicle: {
    // What one truck costs at the garage. The garage itself is priced on the
    // row in src/data/machines.js, and the first truck comes free with it --
    // buying a garage that then asks for more money before it does anything
    // would be two purchases for one decision.
    spawnCost: 20,
    // How many trucks one garage will keep alive. A garage that spawned an
    // unbounded queue of 3.4-metre rigid bodies is a frame-budget hole with a
    // button on it.
    maxPerSpawner: 3,
    // Where the truck appears, in the garage's local metres: out through the
    // gantry, nose first.
    //
    // ON THE PAD, not in front of it. The garage's collider is now the pad
    // alone -- 4 cm of concrete with no walls -- so the truck can be put down
    // in the middle of its own garage and drive out through the gantry, which
    // is what a garage is for. It stands 9 cm up because the pad is 4 cm thick
    // and a truck spawned level with it lands INSIDE it: measured, the body
    // came to rest at y -0.005, under a pad whose top is at 0.04, with its
    // wheels interpenetrating the concrete and the throttle doing nothing at
    // all. Dropping it from 35 cm costs a tenth of a second and cannot wedge.
    spawnOffset: [0, 0.35, 0],

    // --- driving -------------------------------------------------------------
    // Speeds are deliberately walking-scale. The plate is 40 m across and the
    // player runs at 5.2; a truck that did 20 would cross the yard in two
    // seconds and be undrivable indoors.
    topSpeed: 7.0,
    reverseSpeed: 3.2,
    // THESE ARE NOT THE ACCELERATION THE PLAYER FEELS, and the difference is
    // why the first numbers here (7 and 12) produced a truck that did not move
    // at all. The drive SETS the chassis velocity each substep; the solver then
    // spends that substep taking some of it back through ground contact --
    // measured at 9.5 m/s^2 on the plate. So the number below is a budget that
    // contact is paid out of first, and what is left over is the truck: 16
    // against 9.5 is about 6.5 m/s^2 of real acceleration, or nought to seven in
    // a shade over a second. Anything at or under 9.5 is a truck with the
    // handbrake welded on.
    accel: 16.0,
    brakeAccel: 26.0,
    // Radians per second at full lock, scaled by how fast you are going.
    steerRate: 1.0,
    // The speed at which steering reaches full rate. Below it a truck turns
    // proportionally less, which is what stops it pirouetting at a standstill.
    steerFullSpeed: 3.0,
    // How much sideways velocity survives a substep. Wheels are visual here, so
    // this is the only thing standing in for lateral grip; 0 would be on rails
    // and 1 would be ice.
    gripLoss: 0.06,
    linearDamping: 0.15,
    angularDamping: 1.2,
    density: 40.0,
    // LOW ON PURPOSE, and it is not a slippery truck: the box under this
    // vehicle stands in for four wheels, and a wheel ROLLS. At 0.9 -- the
    // friction a crate has, which is what this started as -- the plate held the
    // chassis still: measured, the drive asked for 0.20 m/s of acceleration per
    // substep and static friction was good for 0.24, so full throttle produced
    // exactly zero movement, forever. Sideways grip does not come from here; it
    // comes from `gripLoss`, which is the one thing standing in for a tyre.
    friction: 0.02,
    restitution: 0.05,

    // --- the bed and the tailgate --------------------------------------------
    // Both angles are travelled at a RATE (fractions of full travel per second)
    // rather than snapped: a bed that jumped to 45 degrees would teleport its
    // load through its own floor.
    // How much of the chassis's angular velocity the bed's pose is allowed to
    // predict, 0..1. See poseParts in src/sim/vehicles.js: 1.0 overshoots and
    // throws the load out on every corner, 0 leaves a one-substep lag that is
    // consistent and therefore harmless.
    yawPredictFrac: 0,

    tipMaxDegrees: 45,
    tipRate: 0.55,
    gateMaxDegrees: 105,
    gateRate: 1.6,

    // --- the camera behind the wheel ------------------------------------------
    // Third person, because the half of this truck that matters is the half
    // behind the driver: you cannot back a bed under a conveyor you cannot see.
    camDistance: 7.5,
    camHeight: 2.4,

    // --- getting in and out ---------------------------------------------------
    enterRange: 3.2,
    // How far outside the bed's own box a player may stand and still be carried
    // along with the truck. Generous on purpose: a passenger who slides off
    // because the driver clipped a kerb is a passenger who stops riding.
    rideMarginXZ: 0.25,
    rideMarginDown: 0.35,
    rideMarginUp: 1.30,
  },

  // The gambling box. Timings are the FEEL of the thing: a roll that resolves in
  // half a second is a vending machine, and one that takes ten is a chore.
  gamble: {
    shakeSeconds: 2.4,
    openSeconds: 0.45,
    settleSeconds: 0.8,
    hopHeight: 0.22,
    hopHz: 1.6,
    hopRampPower: 1.7,      // >1 keeps it lazy at first and frantic at the end
    flashHzStart: 1.2,
    flashHzEnd: 9.0,
    cooldownSeconds: 0.6,
    // TWO PRICES, TWO KEYS. They used to be one -- `gamble.cost` was read both
    // as what a single roll costs and as the shop price of the box itself -- so
    // the box was worth exactly one pull of its own handle, and, worse, tuning
    // either number silently retuned the other. There is no edit to "make rolls
    // cheaper" that does not also mark the box down, which is not a balance
    // decision anybody would choose to make; it was just what sharing a key did.
    //
    // rollCost is the fee the prompt quotes and the refusal names.
    // boxPrice is what the vendor charges for the machine. It is deliberately
    // several rolls' worth: a box that pays for itself on the first pull is not
    // a gamble, it is a purchase with extra steps.
    rollCost: 920,
    boxPrice: 3650,
    // Cheap prizes are common, expensive ones rare: weight = 1 / cost^power.
    prizePower: 1.15,
    // A losing roll is not empty -- it pays ducks instead, so the box always
    // gives you something and never reads as broken.
    duckPrizeMin: 3,
    duckPrizeMax: 12,
    // How far the lid swings about its rear hinge. Past 90 it is visibly THROWN
    // open rather than lifted, which is the read the whole animation is for.
    lidOpenDegrees: 118,
    // How far away the crosshair may be and still offer the box. Deliberately a
    // little longer than an arm (config.hand.pickupRange is 3.0) because the box
    // is a metre-wide object you stand back from to watch, and the same number is
    // the host's reach check for a remote player's request.
    useRange: 3.5,
    // Where the ducks of a losing roll are born, above the box's own centre --
    // they come OUT OF IT rather than appearing beside it.
    duckSpawnHeight: 1.0,
    duckSpawnSpread: 0.35,
    // The dice. A seeded stream, never Math.random -- the same rule the drop
    // spread and the tube spawn follow, so a session's rolls are the same twice
    // and a distribution can be measured rather than eyeballed.
    seed: 20260814,
  },

  world: {
    gravity: { x: 0, y: -22, z: 0 },
    // 180, not 120. Everything that reads plateSize derives from it -- the four
    // plate slabs in sim/world.js, the ShapeGeometry and its UVs in
    // render/view.js, the build bound in sim/build.js, the fallback player clamp
    // in main.js and the menu's "plac N m" line -- so this one number is the map
    // size and there is no second place to keep in step. What it must NOT break
    // is checked rather than assumed:
    //
    //   grid    half is 90.0 m, an exact multiple of build.grid (0.25), so the
    //           build lattice is unmoved and the buildable bound
    //           (90 - build.plateMargin 1.0 = 89.00) still lands on it.
    //   pit     the pit is at the origin and its hole is punched from
    //           pit.plateHoleHalf, neither of which reads plateSize.
    //   booth   (-5.5, 6) and the chute (7.5, -4) are absolute coordinates near
    //           the origin: untouched.
    //   walk    machine.z stays 35, so the opening walk from the first workbench
    //           to the pit is exactly the 35 m it has always been. What changes
    //           is what lies BEHIND the bench: 55 m of plate instead of 25.
    //   texture floorTileMeters is 30, so 180 is exactly 6 tiles across and the
    //           plate edge still lands on a painted joint instead of cutting a
    //           tile mid-seam (120 was 4 -- the property is kept, not broken).
    //   hash    createDuckHash (sim/conveyors.js) is a sparse Map over hashed
    //           cell indices with no world bounds, so a bigger plate costs it
    //           nothing.
    //   wire    net.positionStep 0.01 in a u16 spans +/-327.67 m; 90 m of plate
    //           over a 34 m shaft is nowhere near it.
    plateSize: 180,
    plateThickness: 2,
    // The concrete's own friction, which used to be 0.9 hardcoded in
    // src/sim/world.js. It matters more than the duck's: Rapier combines a
    // contact's two frictions by AVERAGING them, so dropping the duck from 0.6
    // to 0.32 alone moved the pair only from 0.75 to 0.61 and a swept duck still
    // barely travelled (0.116 m -> 0.144 m on a 2 m/s sweep). Both halves have
    // to come down for the broom to feel like it is pushing something.
    plateFriction: 0.45,
    // THE PLATE IS DARKER THAN IT WAS (0x5b5f63 -> 0x474a4d), AND IT IS THE
    // OTHER HALF OF THE OBJECT-VERSUS-GROUND FIX.
    //
    // config.render.contact grounds an object at its base; it does nothing for
    // the part of the silhouette standing against the floor BEHIND it, which is
    // most of the silhouette. That is a plate problem, and here is the
    // measurement, taken by masking each object out of the frame by difference
    // and comparing the median luminance inside the mask against a ring of
    // floor just outside it, at 10 m in the real 480 px backbuffer:
    //
    //                    body   floor ring   contrast     -> after
    //   machine          76.1      61.1        1.205        1.665
    //   conveyor         70.4      65.1        1.069        1.318
    //   platform         65.3      63.0        1.031        1.224
    //   vacuum_station   71.3      69.7        1.020        1.226
    //   press            68.7      42.7        1.475        1.516
    //
    // 1.02 to 1.20 is the whole defect in one column: the object and the ground
    // behind it were the same value, so the silhouette had nothing to bite on
    // and only the trim separated them.
    //
    // DOWN rather than up, and that direction is a judgement with two reasons
    // behind it. Buildable bodies measure 53 to 76, so a plate BELOW that band
    // separates the whole catalogue in one move, where a plate above it would
    // have to clear 76 and would then (a) close the gap to the gold that means
    // "duck" -- the one thing a critic said already pops at any distance -- and
    // (b) destroy the workbench's wayfinding, which works precisely because two
    // warm lamps are the only warm light on a DARK plate. Both were re-shot at
    // 35 m after this change and both still read.
    //
    // THE KNOWN COST, because it is real: an object whose body is darker than
    // the band loses a little. `container` (body 53) went 1.213 -> 1.121. There
    // is no single plate value that separates a catalogue spanning 53 to 76 in
    // both directions; this value buys four clear wins for one small loss.
    plateColor: 0x474a4d,
    markingColor: 0xd8b520,
    // The zenith stays essentially black -- the black hole and the starfield are
    // the only bright things up there and they need somewhere dark to be bright
    // against -- but it is a WARM black now (CRT.bg, #0b0906) rather than the
    // navy #0a0f1e, which was the last of the cold-blue leftovers in the world
    // itself.
    skyColor: 0x0b0906,
    // MUST equal render.fogColor. The dome's bottom band is what the fogged
    // plate fades into; when the two differ, the difference IS the horizon line.
    // It was 0x2b3350 against a 0x0a0f1e fog, which is where the hard edge in
    // the opening shot came from.
    horizonColor: 0x141017,
    sunColor: 0xfff2dd,
    // These two are a RATIO before they are two brightnesses: the sun is what a
    // shadow removes and the hemisphere is what is left standing in it. Moving
    // one without the other changes the contrast of every shadow in the game.
    //
    // 1.95 / 0.30, previously 1.75 / 0.44, and the pair moved together so the
    // LIT floor barely changes while the shadow deepens. Measured off the real
    // backbuffer with readPixels, shadowed concrete as a fraction of lit
    // concrete beside it:
    //   1.75 / 0.44   28%   (the old note called this 22%; it was not)
    //   1.95 / 0.30   21%
    //   2.10 / 0.22   18%   -- rejected, the unlit side of every machine goes
    //                          muddy and the booth loses its own shading
    // Lit floor over that whole range moves 65 -> 68 of 255, i.e. not at all.
    //
    // This matters more than the shadow map does, and that is worth writing
    // down. A duck is 18 cm wide, so at 10 m its shadow is FOUR backbuffer
    // pixels however fine the map is -- perspective sets that ceiling, not
    // resolution. Resolution decides whether those four pixels are solid;
    // contrast decides whether you notice them. Both were wrong, and only one
    // of them was in the shadow settings.
    // BOTH x 1.5 from 1.95 / 0.30, and both together on purpose: the pair above
    // is a RATIO before it is two brightnesses, and every shadow number in this
    // block was tuned against 6.5:1. Scaling one alone would have re-lit the
    // whole game as a side effect of making the yard brighter.
    //
    // Measured off a real render target, the plate at (9, 9) seen from 3.2 m up,
    // mean of the floor half of the frame in LINEAR light:
    //   1.95 / 0.30    9.31   -- what the yard was
    //   2.34 / 0.36   11.22
    //   2.63 / 0.41   12.60
    //   2.93 / 0.45   14.02   -- 50% more light on the plate
    //   3.41 / 0.53   16.29   -- rejected: the amber accents start to wash out
    //                            against concrete that is no longer darker than
    //                            they are, and the yard stops reading as night
    sunIntensity: 2.93,
    hemiIntensity: 0.45,
    // The fill light's two colours, which used to be literals in view.js.
    // They are here because they decide what a SHADOW looks like: a shadowed
    // patch of concrete is lit by these alone, so their hue is the shadow's hue.
    //
    // hemiSky was 0x9fb4d8 -- a saturated cold blue -- so every shadow in the
    // game was a blue decal rather than an absence of light. Measured at the
    // 480 px backbuffer, a duck's contact shadow came out as a 3 x 2 px navy
    // rectangle, which is the single worst offender in "a field of 200 ducks
    // reads as stickers": it was not just small, it was the wrong colour to be
    // a shadow at all.
    //
    // 0xa8aab2 is the same brightness with the chroma taken out. That is the
    // deliberate rule, not laziness: amber is the only saturated hue this world
    // is allowed (see world.horizon and the vendor booth), so the neutral half
    // of the palette has to stay actually neutral or the accent stops meaning
    // anything. Shadows are now darker concrete, which is what they are.
    hemiSkyColor: 0xa8aab2,
    hemiGroundColor: 0x2a2a2c,
    sunDir: { x: 0.45, y: 1.0, z: 0.3 },
    // --- shadows -------------------------------------------------------------
    // One directional light with a FITTED shadow camera. The naive version --
    // an ortho frustum stretched over the whole 180 m plate -- puts 180 m across
    // 1024 texels, i.e. 18 cm per texel, and a 20 cm duck's shadow is then one
    // texel of mush. So the frustum is a shadowRadius-metre box that FOLLOWS the
    // player and is snapped to its own texel grid every frame (view.js), which
    // is what stops the shadow edges crawling as you walk.
    //
    // 1 = shadows on. 0 turns off shadowMap in the renderer and castShadow on
    // the sun, and costs nothing at all -- it is the knob to reach for before
    // anything else if a machine cannot hold the frame budget.
    shadowsEnabled: 1,
    // 2048, PREVIOUSLY 1024, and the note this replaces said "2048 would be
    // prettier and costs four times the fill; measured at 300 ducks it was not
    // worth it". Re-measured, and that is not what it costs on this machine.
    //
    // Timed with work/artdir-harness.js RENDERMS() -- 200 glFinish'd renders of
    // the real scene with 300 ducks standing in frame, because rAF is dead in a
    // hidden pane and debugStats().frameMs reads 0:
    //   1024   0.207 ms median   9 draw calls
    //   2048   0.199 ms median   9 draw calls
    //   1024   0.199 ms median   (switched back, to prove it was not drift)
    // i.e. free, inside the noise. "Four times the fill" assumed the shadow pass
    // is fill-bound; it is not, because every duck in it is ONE instanced draw
    // and the map is depth-only. What it costs is 12 MB of depth texture.
    shadowMapSize: 2048,
    // Half-width of the fitted box, in metres. 34 -> 24, which with the map size
    // above takes the map from 6.6 cm per texel to 2.34 -- 2.8x finer.
    //
    // 34 was not wrong about coverage, it was wrong about what coverage is for.
    // A duck is 18 cm across, so at 6.6 cm it had under three texels to make a
    // shadow out of and got a 3 x 2 px rectangle offset from its own feet; at
    // 2.34 cm it has eight, and the shadow is a duck-shaped blob touching the
    // duck. Measured at 10 m in the real 480 px backbuffer, which is the only
    // test that counts.
    //
    // 24 still covers everything the player can build (build.maxDistance is 14)
    // with 10 m to spare, and the box is centred on the player, so the nearest
    // thing that stops casting is 24 m away.
    shadowRadius: 24,
    // How far up the sunDir the shadow camera sits. It only has to clear the
    // tallest caster (the chute mouth at 7 m), and it is HALVED from 90 because
    // it sets the ortho depth range that shadowBias is measured in -- see below.
    shadowDistance: 50,
    // Acne vs peter-panning, and both of these came down by an order of
    // magnitude because both were erasing the contact shadow they exist to
    // protect.
    //
    // shadowBias is in normalised depth, so its size in METRES is bias times the
    // ortho depth range (shadowDistance + 2 * shadowRadius + 40, see view.js).
    // At the old 90/34/-0.0006 that range was 198 m and the bias was 11.9 cm of
    // depth push -- against a duck 38 cm tall standing ON the receiver, so it
    // ate the entire contact. Now: 138 m range, -0.00006, 0.8 cm.
    //
    // normalBias moves the receiver's sample along its own normal, i.e. straight
    // up out of the floor, so 0.035 was half a texel at the old density and one
    // and a half at the new one. 0.004 is under a fifth of a texel. Nothing in
    // this game needs more: every surface is flat-shaded with hard normals, and
    // the grazing case across the plate is what the constant bias is for.
    //
    // Verified against acne, not just against contact -- the plate is 180 m of
    // one flat quad seen at every angle down to nearly edge-on, which is the
    // worst case there is, and it is clean.
    shadowBias: -0.00006,
    shadowNormalBias: 0.004,
    floorTextureSize: 1024,
    floorTileMeters: 30,
    // The photograph under the painted floor, and how much of it shows through.
    // Multiplied in, so it darkens and roughens the plate's own colour rather
    // than replacing it -- at 1.0 the game's concrete becomes somebody else's.
    //
    // 0.35 AND NOT 0.55, and the difference is the yard's brightness. Measured
    // on the plate's own texture canvas: 79.3 mean with no photograph, 60.4 at
    // 0.55 -- a quarter of the light gone, immediately after the sun and the
    // hemisphere were raised by half specifically to make the yard brighter.
    // Taking the same measurement is the only way to notice that two changes
    // pulled against each other.
    floorPhoto: './assets/textures/concrete.png',
    floorPhotoStrength: 0.35,
    floorNormal: './assets/textures/concrete_normal.png',
    // Relief is the half of a material a colour map cannot carry, and this plate
    // has exactly one directional light on it to catch it.
    floorNormalStrength: 0.65,
    floorTextureSeed: 20260813,
    floorBlotches: 160,
    floorCracks: 26,
    // Baked speckle in the concrete tile. This is what actually reads as "grain"
    // on the floor -- it is the dominant noise on screen, so it stays gentle.
    //
    // 2, previously 4. THIS REVERSES AN EARLIER INSTRUCTION and is the only
    // knob that moved for it. When the film-grain overlay was turned off
    // (render.grainAmount, now 0) Jurek asked for the concrete to keep its own
    // texture -- "grain na betonie ma byc taki sam" -- so this was deliberately
    // left alone. He has since asked for less grain again with the overlay
    // already at 0, which can only mean this one. Halved rather than removed:
    // materials.js paintGrain() feeds it to noiseCanvas at amp * 3.2, so the
    // speckle goes from +/-12.8 to +/-6.4 of 255, composited 'overlay' at 80%
    // alpha. The concrete does NOT become a flat grey plane, because the noise
    // was never the only thing on it: floorBlotches (160), the cast joints,
    // floorCracks (26) and the scuff pass are all untouched.
    floorGrain: 1.2,

    // --- the sky's horizon band ------------------------------------------------
    // The dome used to be a two-stop gradient: horizonColor at the bottom,
    // skyColor at the top. That cannot hide a horizon, because the plate fades
    // into fogColor and whatever the dome is doing at the bottom either matches
    // that (and the horizon is a flat dead join) or does not (and the horizon is
    // a hard line). It was the second one.
    //
    // Three stops instead. Bottom = horizonColor = fogColor, so the join is
    // genuinely invisible. A few degrees ABOVE it, skyGlowColor: a dim warm band
    // that gives the horizon somewhere to be, and -- more to the point -- gives
    // world.horizon's silhouettes something to be dark against. Then back down
    // to skyColor at the zenith, because the black hole and the starfield need
    // black to be bright in.
    //
    // The glow is amber-brown rather than blue for the same reason everything
    // else here is: the only light in this world comes from the accretion disc
    // and from industry, and both are warm. It is deliberately dim (a 0x2a1d10,
    // a fifth of the way to the accent) -- it is a ground for hierarchy, not a
    // thing in the hierarchy.
    skyGlowColor: 0x2a1d10,
    // Where the glow band peaks and how tall it is, as sin(elevation): 0 is the
    // horizon, 1 the zenith. 0.045 puts the peak about 2.6 degrees up, which at
    // a 270 px backbuffer is 10 px above the horizon line -- close enough to
    // silhouette against, far enough that it is not the horizon itself.
    skyGlowCenter: 0.045,
    skyGlowWidth: 0.20,

    // --- the boundary ----------------------------------------------------------
    // A silhouette band standing beyond the plate edge, and the reason it exists
    // is that FOG CANNOT HIDE A BOUNDARY, it can only soften one. However hard
    // the plate fades, its edge is still the last row of lit concrete with sky
    // above it, and the eye finds that line. Something has to stand behind it.
    //
    // This is one merged mesh -- a ring of plain rectangular slabs of varying
    // height and width, seeded so it is the same rim every session -- so the
    // whole boundary is ONE draw call. Unlit MeshBasic with baked vertex colour,
    // like the pit shaft: it is a backdrop, not a lit object, and lighting it
    // would only make it flicker as the shadow box slides past.
    //
    // radius 132 because the plate's far CORNER is at 90 * sqrt(2) = 127.3 m.
    // Anything nearer than that would poke up through the floor at the corners.
    // At 132 m the fog is 88% closed, so what actually reaches the eye is a very
    // low-contrast dark rim -- which is the intent. It should read as "the world
    // stops somewhere out there", not as scenery worth walking to. Nothing here
    // has a collider, and nothing needs one: it is 42 m beyond the plate.
    horizon: {
      enabled: 1,
      radius: 132,
      // Slabs around the ring. 128 at radius 132 is a 6.5 m chord -- about two
      // backbuffer pixels each at that distance, so the rim reads as a varied
      // edge rather than as a visible polygon count.
      segments: 128,
      minHeight: 3.0,
      // 14 m subtends 6.1 degrees at 132 m, i.e. 23 px of the 270 px buffer.
      // Tall enough to be a boundary, low enough to leave the sky to the black
      // hole.
      maxHeight: 14.0,
      // Fraction of a segment's chord the slab actually fills, so the rim has
      // gaps in it and reads as separate structures rather than as a fence.
      fill: 0.82,
      // Darker than horizonColor (0x141017), so it bites into the glow band
      // instead of dissolving into it.
      color: 0x08070c,
      seed: 20260816,
    },

    // --- the objective ---------------------------------------------------------
    // Two lamp posts flanking the Manual Duck Workbench, and they are here for
    // one reason: from the player's spawn the bench is 29 m away, and it was a
    // dark grey box against a dark sky -- about 20 backbuffer pixels of nothing.
    // The game's whole premise is the walk towards it, and the shot that states
    // the premise did not say where to go.
    //
    // Lamps rather than a marker or an arrow, because the world already answers
    // this question everywhere else with light: the pit has its hazard ring, the
    // booth has a lamp. The lamp head is UNLIT amber (see render/props.js), so
    // it holds its brightness through 13% of fog at 35 m instead of dimming with
    // everything else -- which is exactly what makes it a destination.
    //
    // x = +/-2.0 clears the workbench (1.5 m footprint at scale 1.6 = 2.4 m wide,
    // so 1.2 m half-width) and sits well outside the arrow path at x = 0, but
    // these posts have NO COLLIDER -- the player walks through them. Fixing that
    // needs a static box registered in main.js, which the renderer does not own.
    benchLamps: {
      enabled: 1,
      offsetX: 2.0,
      offsetZ: -0.4,
      scale: 1.15,
    },
  },

  // Floor markings are placed decals, never baked into the tiled concrete: a
  // tile repeats every 30 m, so anything drawn into it covers the whole plate.
  decals: {
    y: 0.02,               // lift above the plate top (y = 0)
    textureSize: 512,
    tilePadding: 6,        // transparent margin inside each atlas tile
    opacity: 0.9,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    // Hazard ring around the pit mouth.
    ringInner: 1.75,
    ringOuter: 2.75,
    ringSegments: 32,
    // Arrow path from the player spawn towards the pit.
    // Step has to exceed length or the chevrons merge into one solid band.
    arrowCount: 3,
    arrowStartZ: 8.2,
    arrowStepZ: 1.8,
    arrowWidth: 0.85,
    arrowLength: 1.3,
    // Marked drop zone under whatever the overhead tube drops.
    dropZoneSize: 4.5,
  },

  player: {
    spawn: { x: 0, y: 2.2, z: 6 },
    eyeHeight: 1.62,
    walkSpeed: 5.2,
    sprintMultiplier: 1.7,
    jumpSpeed: 7.5,
    radius: 0.35,
    height: 1.8,
    mouseSensitivity: 0.0022,
    pitchLimit: 1.5533,
  },

  // --- G1: ducks, pit, holding, money ---------------------------------------

  ducks: {
    max: 300,
    // RE-MEASURED off Jurek's duck.glb at duckRender.scale 0.8. The model's
    // long axis is +Z and duckRender.yaw turns it onto the collider's X, so:
    // X = length, Y = height, Z = width.
    //
    // The mesh is 0.1402 x 0.2199 x 0.2526 raw, so at 0.8 it is
    // 0.112 x 0.176 x 0.202 in the world. It is a different animal from the
    // one these numbers were written for: nearly the same LENGTH (0.202 against
    // 0.195) and barely half the HEIGHT (0.176 against 0.314) -- a duck sitting
    // rather than a duck standing. Every number below moved with it, because a
    // collider measured off a mesh that is no longer there is a duck that
    // hovers.
    halfExtentX: 0.101,
    halfExtentY: 0.088,
    halfExtentZ: 0.056,
    // Second collider for the head. headHalfY 0 disables it entirely, and it is
    // OFF now: the old duck was a body with a neck and a head on top of it, and
    // two boxes were what that shape actually was. This one is a single sitting
    // blob with no neck at all, so a second box would be a box around nothing --
    // and it is 300 fewer colliders in the world for free.
    headHalfX: 0.0625,
    headHalfY: 0,
    headHalfZ: 0.046,
    // Offsets from the body collider's centre, which sits 0.13 above the duck's
    // underside. The head's centre is 0.323 up, hence +0.193.
    headOffsetX: 0.02,
    headOffsetY: 0.193,
    // Lighter, and on a slipperier floor. Asked for as "make the ducks lighter,
    // it is very hard to sweep them" -- but mass alone would NOT have fixed
    // sweeping, and that is worth writing down. The broom and the belts scale
    // their impulse BY MASS (they target a velocity), so a lighter duck gets a
    // proportionally weaker shove and slides exactly as far. What stops a swept
    // duck is the floor: slide distance is v^2 / (2 * mu * g), with no mass in
    // it at all. Measured before: a 2 m/s sweep moved a duck 0.116 m, which is
    // why it felt like pushing a brick.
    //
    // So mass drops for the thing it DOES control -- the fans, which apply a
    // real force, so their acceleration is F/m -- and friction drops for the
    // thing that was actually blocking the broom.
    mass: 0.11,
    restitution: 0.35,
    friction: 0.32,
    linearDamping: 0.04,
    angularDamping: 0.3,
    sleepAfter: 10,
    sleepLinearEps: 0.06,
    sleepAngularEps: 0.4,
    parkY: -600,
    // 1 = try ColliderDesc.convexHull (falls back to a cuboid per duck),
    // 0 = always the cuboid. Cuboid is cheaper and steadier for a 25 cm duck.
    useConvexHull: 0,
  },

  rarity: {
    // A LADDER OF 25 RUNGS, 1 to 100000, and every rung rarer than the one
    // below it. This replaces seven hand-authored tiers.
    //
    // The obvious reading of "one duck worth 1, the next 2, the next 3, each
    // rarer, up to 100000" is a hundred thousand separate values -- and that
    // cannot work, measured rather than argued: spread the probability over
    // 100000 integers and either the top is one duck in sixteen BILLION, or you
    // flatten the curve until the top is reachable and the average duck is
    // worth 2455, which is the whole economy gone. There is no setting in
    // between; the two requirements are in direct conflict.
    //
    // So the ladder MULTIPLIES instead of adding. It still starts exactly as
    // asked -- 1, 2, 3, 4 -- and then each rung is about 1.6x the last, which
    // is the only shape where "each next one is rarer" and "100000 is a thing
    // that actually happens" are both true. Every rung has the same chance of
    // being upgraded to the next (0.65), so the weights below are simply
    // 0.65^k: strictly decreasing, exactly as promised.
    //
    // Measured over the whole ladder:
    //   mean duck                 16.88   (was 2.2125 across seven tiers)
    //   1000 or better       1 in 649
    //   10000 or better      1 in 6241
    //   the 100000 duck      1 in 88182
    //
    // Shop prices were multiplied by 7.63 in the same change, so the game
    // is paced exactly as it was and only the numbers got bigger.
    multipliers: [
      1, 2, 3, 4, 7,
      11, 18, 29, 46, 75,
      121, 196, 316, 511, 825,
      1334, 2154, 3481, 5623, 9085,
      14678, 23714, 38312, 61897, 100000,
    ],
    weights: [
      10000000, 6500000, 4225000, 2746250, 1785063,
      1160291, 754189, 490223, 318645, 207119,
      134627, 87508, 56880, 36972, 24032,
      15621, 10153, 6600, 4290, 2788,
      1812, 1178, 766, 498, 324,
    ],
    // Named weight sets. A producer row names one of these in
    // produce.rarityWeights; an unknown name is fatal, never a silent fallback.
    // A zero weight removes that rung from the machine's roll -- rollTier()
    // normalises over whatever it is handed -- which is how "never makes a
    // common duck" is expressed without a single branch in the code.
    sets: {
      w_basic: [
        10000000, 6500000, 4225000, 2746250, 1785063,
        1160291, 754189, 490223, 318645, 207119,
        134627, 87508, 56880, 36972, 24032,
        15621, 10153, 6600, 4290, 2788,
        1812, 1178, 766, 498, 324,
      ],
      // Luckier: every rung above the first weighted 1.5x, the same rule the
      // seven-tier version used, so Lucky Rubber still means what it meant.
      w_good: [
        10000000, 9750000, 6337500, 4119375, 2677594,
        1740436, 1131284, 735334, 477968, 310678,
        201940, 131262, 85320, 55458, 36048,
        23432, 15230, 9900, 6435, 4182,
        2718, 1767, 1149, 747, 486,
      ],
      // Never a plain duck: the bottom two rungs removed.
      w_rare: [
        0, 0, 4225000, 2746250, 1785063,
        1160291, 754189, 490223, 318645, 207119,
        134627, 87508, 56880, 36972, 24032,
        15621, 10153, 6600, 4290, 2788,
        1812, 1178, 766, 498, 324,
      ],
      // Nothing below rung 8, which is a duck worth 46 at the very least.
      w_elite: [
        0, 0, 0, 0, 0,
        0, 0, 0, 318645, 207119,
        134627, 87508, 56880, 36972, 24032,
        15621, 10153, 6600, 4290, 2788,
        1812, 1178, 766, 498, 324,
      ],
      // CREATIVE MODE: all the weight on the top rung and zero everywhere else,
      // the same mechanism w_rare and w_elite use. Every duck is the jackpot.
      w_creative: [
        0, 0, 0, 0, 0,
        0, 0, 0, 0, 0,
        0, 0, 0, 0, 0,
        0, 0, 0, 0, 0,
        0, 0, 0, 0, 1,
      ],
    },
  },

  // CREATIVE MODE. A property of the SESSION -- the host picks it in the lobby
  // before Start and the flag travels with the room, so a client can never be in
  // a different mode from the host it is playing with.
  //
  // Three facts and a name, read at exactly three points of decision:
  //   price        src/sim/shop.js priceOf()  -- what the next purchase costs
  //   stockUnits   src/sim/stock.js units()   -- what the shelf reports it has
  //   rarityWeights src/sim/ducks.js          -- the weight set every duck rolls
  // Nothing else in the game branches on the mode, and nothing else should:
  // every module that does is another place two modules can disagree.
  //
  // `enabled` is only the DEFAULT for a fresh session. The lobby is the chooser.
  creative: {
    enabled: 0,
    price: 0,
    stockUnits: 999,
    rarityWeights: 'w_creative',
  },

  economy: {
    startMoney: 0,
    duckBaseValue: 1,
    duckValueMul: 1,
  },

  // Prestige. The multiplier is a function of LIFETIME session earnings and is
  // ASSIGNED, never compounded:
  //
  //     multiplier = 1 + (totalEarned / threshold) ^ exponent
  //
  // The compounding version measured in tools/economy-sim.py was a runaway:
  // once income is large the threshold is crossed every tick, each run
  // multiplies the last, and the simulator recorded 1592 prestiges and a
  // multiplier of `inf` inside a minute. Asked as a question about the whole
  // save -- "what has this session earned in total?" -- the curve has a natural
  // ceiling and no exploit. Phase E measures 2 prestiges and x6.25 over a
  // three-hour session with these numbers. Do not turn this into a compounding
  // version.
  prestige: {
    threshold: 10000,
    exponent: 0.5,
    // A prestige has to be worth the factory it costs. The next multiplier must
    // be at least this many times the current one before the button is armed;
    // 1.0 would arm it for a gain of nothing. The Phase E player model used 2.5
    // as its BUYING heuristic -- when a good player chooses to take it -- which
    // is not the same number as when the game allows it. This is the floor.
    minGain: 1.25,
    // WHAT SURVIVES A PRESTIGE, by catalog tab. 1 keeps, 0 wipes. The frozen
    // product decision is that machines, upgrades and money go and buildings
    // stay; gear (bucket, crates, cart) is the Phase E judgement call recorded
    // in work/economy.md as open to the owner's veto -- they are your tools, not
    // your factory, and wiping them replays the opening two minutes every run.
    // Flipping that veto is changing the 1 on `gear` to a 0 and nothing else.
    // Every tab in src/data/index.js TABS must appear here or boot fails: a tab
    // with no entry would silently pick a side.
    //
    // TRANSPORT IS A NEW DECISION AND NEEDS THE OWNER'S EYE. Under the old four
    // tabs the belt system was split across two of them with opposite answers:
    // the four conveyors and the fan sat in Machines and were WIPED, while the
    // eight ramps, the slide, the platform, the stairs and the two other fans
    // sat in Buildings and were KEPT. One kind, one behaviour, two fates. Now
    // that they are one tab it has to take one side, and this is 1 (keep) for
    // two reasons: eleven of the sixteen rows were already kept, and a belt
    // lane is yard layout in the same sense a wall is -- prestige is meant to
    // reset the machines that print the money, not to make you re-lay your
    // walkways by hand every run. The five belt rows that were previously wiped
    // now survive; flip this to 0 if the intent was that automation never does.
    keep: {
      production: 0,
      transport: 1,
      building: 1,
      gear: 1,
      upgrades: 0,
      gamble: 0,
    },
  },

  pit: {
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    radius: 1.5,        // apothem of the 32-gon: 3 m across in every direction
    segments: 32,
    wallThickness: 0.15,
    wallFriction: 0.4,
    wallRestitution: 0.05,
    shaftDepth: 8,
    scoreDepth: 2.0,    // sensor plane, metres below the pit mouth
    captureMargin: 0.6,
    rimReach: 6.0,      // radial half-extent of each tangent floor slab
    plateHoleHalf: 4.0, // square opening the four plate slabs leave for the rim
    playerFallDepth: 0.5,
    playerFallSeconds: 2.0,
    respawnX: 0,
    respawnY: 2.2,
    respawnZ: 6,
  },

  // --- the second pit ---------------------------------------------------------
  // A second hole, at one of the four plate edges, and WHICH edge is rolled
  // fresh every run. It pays more than the main pit, so a factory built for one
  // layout is not the right factory next time -- which is the whole point of
  // rolling it: the yard stops being a puzzle you solve once.
  //
  // Everything about its shape is the main pit's, read from config.pit, except
  // what is listed here. Two copies of a shaft's geometry would drift the first
  // time either was tuned.
  pit2: {
    enabled: 1,
    // Smaller than the main pit (1.5): it pays better, so it should be harder
    // to hit, and a smaller mouth is the honest way to say that.
    radius: 1.1,
    // HOW FAR OUT, in metres from the middle -- and it is a distance rather
    // than an inset from the plate edge, because the plate is 180 m across and
    // everything a player actually uses (the pit, the booth, the tube, the
    // spawn) is inside ten. Measured from the plate edge it landed 84 m away,
    // which is half a minute of walking over empty concrete each way.
    //
    // 28 m is four seconds in the truck and about six on foot: far enough that
    // "it is at the north end" is a real journey and a reason the truck exists,
    // near enough that you can see which end it is from the middle.
    distance: 28.0,
    plateHoleHalf: 3.2,
    // WHAT IT PAYS, as a multiplier on the duck's own value. 1.25 to start, and
    // the shop sells four steps of it -- see stats.js `pit2Mul`.
    payMul: 1.25,
  },

  // --- contracts --------------------------------------------------------------
  // Somebody wants a load of ducks by a deadline and sends a lorry for them.
  // The first thing in the game that asks for something SPECIFIC rather than
  // just more -- see the header of src/sim/contracts.js.
  contracts: {
    enabled: 1,
    // Long enough that a new player has a factory before the first siren, and
    // the gap after that is long enough to rebuild for the next one.
    firstDelaySeconds: 240,
    gapSeconds: 200,
    gapJitterSeconds: 120,
    // The deadline is derived from the SIZE of the order rather than fixed, so
    // a big order is not simply an impossible one.
    secondsPerDuck: 2.2,
    minSeconds: 60,
    maxSeconds: 180,
    countMin: 12,
    countMax: 40,
    // Money per delivered duck, as a multiple of the contract's own minimum
    // value: a lorry pays better than the pit for the same duck, which is what
    // makes stopping what you are doing and running the load out worth it.
    payPerDuck: 1.6,
    // And filling the WHOLE order pays this much again on top. A half-filled
    // lorry keeps what it already earned; only a full one gets the bonus.
    bonusMul: 1.5,
    leaveSeconds: 6,
  },

  // --- processors -------------------------------------------------------------
  // The Sorter and the Refiner: machines that act on ducks already made.
  // See src/sim/processors.js for what each is for.
  processors: {
    // Sideways shove, in metres per second of velocity change. It has to beat
    // what the belt under the duck is doing or the belt simply drags it back.
    sortPush: 2.4,
    // And a little UP with it, for the same reason: a duck shoved flat along a
    // belt stays on the belt.
    sortLift: 1.6,
    // Once a duck is already moving this fast towards its side, the machine
    // stops pushing. Without it the shove is an accelerator rather than a
    // nudge -- see the note in processors.js.
    sortMaxSpeed: 2.2,
    // How high above its own base a processor's throat reaches. A duck riding
    // a belt is at 0.65 and a duck on the floor is at 0.13, so this catches
    // both without catching a player's boots.
    sortHeight: 1.10,
    // How long a full refiner takes to hand back the upgraded duck. Long
    // enough to be a machine working rather than a swap.
    refineSeconds: 1.6,
    refineMouthClear: 0.34,
    refineEjectSpeed: 1.8,
    // How hard a pneumatic pipe spits a duck out at the far end. Fast enough
    // that it lands clear of its own mouth and does not fall straight back in.
    pipeExitSpeed: 3.2,
  },

  // --- the world clock ---------------------------------------------------------
  // Day length, weather turnover and how often something interrupts. See
  // src/sim/worldclock.js -- one clock, because three would disagree.
  worldclock: {
    // Twelve minutes a day. Long enough that noon and dusk are different
    // sessions to build in, short enough that a player sees both in one sitting.
    dayLengthSeconds: 720,
    // Where a run starts: 0.25 is dawn, which is what a factory day looks like.
    startFraction: 0.25,
    // How dark midnight gets, as a fraction of full daylight. NOT zero: the
    // yard has to stay playable, and a factory you cannot see is a factory you
    // stop working at.
    nightFloor: 0.40,
    weatherMinSeconds: 90,
    weatherMaxSeconds: 240,
    eventFirstSeconds: 300,
    eventGapSeconds: 280,
    eventJitterSeconds: 160,
  },

  // --- belt routing -------------------------------------------------------------
  // The Belt Kit: mark a start, walk somewhere, confirm. See src/sim/route.js.
  route: {
    // One conveyor piece is 2 m long, and the router works entirely in whole
    // pieces -- there is no such thing as half a belt.
    pieceLength: 2.0,
    // TEN A PIECE, corners and climbs included. A corner costing more than a
    // straight would make the player route around bends to save money, which
    // is a puzzle about the price list rather than about the factory.
    pieceCost: 10,
    // What one sloped piece climbs. Measured off the model: the belt band drops
    // 0.718 m over its 2 m length (src/data/machines.js, conveyor_slope).
    slopeRise: 0.718,
    // The longest run one confirmation may lay. A cap the player can hit is
    // better than a frame that takes a second to draw four hundred belts.
    maxPieces: 60,
  },

  hold: {
    kp: 220,
    kdScale: 2,         // kd = kdScale * sqrt(kp) -> critically damped
    maxSpeed: 14,
    breakDistance: 3.0,
    distanceDefault: 2.0,
    distanceMin: 0.8,
    distanceMax: 4.0,
    distanceStep: 0.25,
    grabRange: 4.0,
    throwImpulse: 9.0,  // impulse = look * throwImpulse * mass -> m/s delta
    heldLinearDamping: 1.0,
    heldAngularDamping: 6.0,
    ccdOnThrow: 1,
    fallbackMass: 0.16,
  },

  // --- G1: models, props, HUD, interaction ----------------------------------

  models: {
    basePath: './assets/models/',
    timeoutMs: 5000,
  },

  // The tube is the PURCHASE chute, never a duck source. It hangs out of the
  // darkness overhead: the model is flipped 180 degrees about X so its open rim
  // (local +Y) points down, and nothing touches the ground.
  tube: {
    // To the RIGHT of the pit, not behind it. The player spawns at z = +6 facing
    // the pit, so their right hand is +X; the vendor's booth is at x = -5.5 on
    // the left, which leaves this side free. Directly behind the pit the chute
    // was in the one place a player standing at the pit could not see it.
    // The painted drop zone is derived from these two numbers in render/view.js,
    // so it follows automatically.
    x: 7.5,
    y: 0,           // vertical trim on top of the computed hang height
    z: -4,
    yaw: 0,
    pitchX: 3.1415926536,
    scale: 1.8,
    mouthWorldY: 7.0,   // world height of the downward-facing mouth
    intervalSeconds: 0, // reserved for the G2 purchase chute; 0 = never drops
    // Mouth in tube-local metres. The model's open rim sits at local y 6.33.
    mouthX: 0,
    mouthY: 6.33,
    mouthZ: 0,
    // Outward direction of whatever the tube drops: straight down.
    ejectX: 0,
    ejectY: -1,
    ejectZ: 0,
    ejectSpeed: 0,
    ejectSpread: 0,
    spawnSeed: 20260814,
    // Vertical fade baked into the tube's vertex colours, as a fraction of the
    // model height measured from the mouth end. The far end dissolves into the
    // dark sky so the pipe reads as coming out of somewhere unseen.
    fadeFloor: 0.04,
    fadeStart: 0.10,
    fadeEnd: 0.80,
  },

  // Manual Duck Workbench: the only duck source. HOLD the left button with the
  // crosshair on the side wheel; the wheel spins up, the bar fills, and one duck
  // leaves the front pipe every holdSecondsPerDuck of held time. It used to be a
  // clicker (one click = one tenth of a turn) and that invited an autoclicker,
  // which is the whole reason this is time-based now.
  machine: {
    x: 0,
    y: 0,
    z: 35,              // 35 m from the pit -- frozen product decision
    yaw: 3.1415926536,  // model front is +Z; face it at the pit
    scale: 1.6,
    // Kept as the wheel's CLICK GRAIN, not as a cost: the gear sound fires once
    // per this many wheel angles, and a bought bench's own `clicksPerDuck` is
    // read against this number to scale its seconds. Nothing counts clicks now.
    clicksPerTurn: 10,
    // How long ONE player must hold to get one duck. Two holders halve it: the
    // fill rate is one second of charge per second per holder.
    // 2.5, halved from 5 on Jurek's word after playing it: five seconds of
    // holding for one duck reads as a chore rather than as effort. The flywheel
    // still halves it again over a long session, so the range is now 2.5 s cold
    // down to 1.25 s wound up.
    holdSecondsPerDuck: 2.5,
    // Letting go does not zero the bar, it bleeds it: this many seconds of
    // charge lost per real second with nobody holding. 0.5 means a full bar
    // survives ten seconds of walking away and a slip of the finger costs
    // almost nothing -- fair, not punishing.
    holdDrainRate: 0.5,
    // Swift Hands multiplies holdSecondsPerDuck; this is the floor so no stack
    // of upgrades can make a duck free.
    minHoldSeconds: 0.5,
    // --- the flywheel ---------------------------------------------------------
    // Keep cranking and the wheel gets easier to turn: a multiplier on the FILL
    // RATE that climbs while cranking continues, is capped, survives a duck, and
    // bleeds away when cranking stops. Deliberately SMALL and SLOW -- 0.02 per
    // second means a full wind-up takes 50 seconds of unbroken cranking, and the
    // measured duck times are 4.76 s (duck 1), 3.63 s (duck 5), 2.94 s (duck 10)
    // and 2.50 s at the cap from about duck 15 on. Not a jump; a long shave.
    momentumPerSecond: 0.02,
    // The ceiling: twice the cold rate and no more. A wound wheel is a good
    // wheel, never a different game.
    momentumMax: 2.0,
    // Bleed, per second, with nobody cranking. Four times the climb, so a full
    // unwind is ~12.5 s: half a second of fumbled button costs 0.04 (two
    // seconds of climbing), and walking anywhere and back starts you cold.
    momentumDecayPerSecond: 0.08,
    // How much of the flywheel reaches the WHEEL'S SPEED, 0..1. At 1 a fully
    // wound wheel peaks at momentumMax x the cold peak, so a long session looks
    // faster than a fresh one instead of hitting the same ceiling every time.
    spinMomentumCoupling: 1,
    // How near a placed Auto-Cranker has to be to a manual wheel to work it.
    // Generous on purpose: it is bought to sit ON a bench, and refusing to run
    // because it landed 20 cm off would read as a broken item, not as a rule.
    botAttachRange: 3.0,
    // The pool was full when the duck popped. The bar is parked full and the
    // pop is retried after this long, instead of retrying every frame and
    // machine-gunning the cap message.
    capRetrySeconds: 1.0,
    // The wheel's spin. Angular velocity chases a target set by how full the bar
    // is -- slow at the start, very fast at the end -- and the curve exponent is
    // what makes the last second feel like the machine is about to fly apart.
    // RETUNED after the first playtest: "the wheel accelerates too slowly and
    // its top speed is far too low -- should be maximally much faster". The old
    // set (min 1.4, max 30, curve 2.2, accel 7) took the whole five seconds to
    // reach a speed the eye can still count spokes at, and the first two seconds
    // read as nothing happening at all. Three changes, each doing one job:
    //   min      6 rad/s -- the wheel LEAPS when you press, instead of creeping
    //   max    150 rad/s -- ~24 revolutions a second, well past the frame rate,
    //                       so the rim genuinely smears at the end of a fill
    //   curve  1.15      -- close to linear, so the ramp bites in the first
    //                       second instead of hiding in the last one
    spinMinRadPerSec: 6,
    spinMaxRadPerSec: 150,
    spinCurve: 1.15,
    // Approach rates for the exponential chase, per second. Spinning up is now
    // much quicker than spinning down: the press should feel instant, and the
    // coast after a duck is the part nobody complained about, so it is unchanged.
    spinAccelPerSecond: 16,
    // 4.5 was tuned against a 28 rad/s ceiling. At 150 the same rate leaves the
    // wheel still doing ~20 rad/s at the end of the pop coast, i.e. the duck no
    // longer reads as a stop -- so the deceleration goes up with the ceiling to
    // keep the spin-down looking like the one nobody complained about. Measured:
    // the dip after a pop lands at 4 rad/s, and a release reaches a true zero in
    // about a second.
    spinDecelPerSecond: 8,
    // Below this the wheel is called stopped and pinned to exactly zero, so
    // "decays to 0" is a number a test can read rather than an asymptote.
    spinStopBelow: 0.05,
    // After a duck pops the wheel is told to stop even if the button is still
    // down, so every duck is punctuated by a visible spin-down before the next
    // fill winds it up again. The bar keeps filling through it: this is feel,
    // not a tax on the rate.
    spinPopCoastSeconds: 0.45,
    // Above this the wheel is turning too fast for a discrete gear click to
    // read as one, so the ticking stops rather than turning into a machine gun.
    // With spinMax at 150 rad/s the clicks cover roughly the first third of a
    // fill and then give way to the blur.
    clickSoundMaxRadPerSec: 45,
    // A client is never told the wheel's speed -- EV.CRANK carries a percentage
    // and nothing else -- so it runs the same spin model off the percentages it
    // receives. A key whose percentage has not moved for this long is read as
    // "nobody is cranking" and the wheel coasts down.
    clientSpinIdleMs: 260,
    // Wheel hub in model-local metres (before scale/yaw). The wheel turns about
    // the model's local +X axis.
    // Re-measured off the reworked crank export, not estimated. The wheel used
    // to sit on the machine's SIDE, which is why it read as a toy: from the only
    // position you can crank from it was edge-on, and the big gold ring you
    // actually saw on the front was the ejector pipe. It is now on the FRONT
    // face and turns about local Z -- see setWheelAngle() in render/props.js,
    // which had to change axis and sign with it.
    wheelLocalX: 0.2761,
    wheelLocalY: 1.0200,
    wheelLocalZ: 0.2800,
    wheelRadius: 0.34,
    // Triangles with centroid x > splitMinX and within splitRadius of the hub in
    // the local YZ plane belong to the wheel and turn with it.
    // splitMinX is dead with the wheel on the front face; splitMinZ replaces it.
    // 0.19 measured: the nearest cabinet part sits 0.43 m clear of this plane.
    splitMinX: 0.40,
    splitMinZ: 0.19,
    splitRadius: 0.42,
    // Aim sphere used to decide "the cursor is on the wheel".
    hitRadiusScale: 1.25,
    useRange: 4.0,
    // Output pipe mouth in model-local metres; the pipe points along local +Z.
    pipeLocalX: -0.043,
    pipeLocalY: 0.42,
    pipeLocalZ: 0.66,
    ejectOffset: 0.32,
    ejectSpeed: 2.4,
    ejectDrop: -0.12,
    // Static collider for the cabinet, model-local, so the player cannot walk
    // through it. Attached to the existing plate body: no new rigid body.
    colliderHalfX: 0.656,
    colliderHalfY: 0.705,
    colliderHalfZ: 0.46,
    colliderLocalY: 0.705,
    colliderLocalZ: -0.205,
  },

  duckRender: {
    scale: 0.8,
    yaw: 1.5707963268,   // model long axis is +Z; the collider's is +X
    // The body collider's centre is halfExtentY above the duck's underside, and
    // the mesh stands on y=0 in the file, so it drops by exactly that. It moved
    // from -0.13 to -0.088 with the new model's height; leaving it would have
    // buried every duck four centimetres into the plate.
    yOffset: -0.088,     // model stands on y=0; drop it to the collider's base
    tierScaleStep: 0.045,
    topTierScale: 1.5,
    topTierPulseHz: 1.6,
    // The top tier is 1 in 8000, so it is allowed to blow past white.
    topTierPulseAmp: 1,
  },

  pitRender: {
    // Circumradius of the 32-gon whose apothem is pit.radius, so the shaft wall
    // meets the plate's hole edge with no gap.
    shaftRadius: 1.5073,
    shaftDepth: 26,
    shaftSegments: 32,
    // From standing height only the first metre of the far wall is visible, so
    // the fade to black has to happen inside that metre.
    fadeMeters: 0.9,
    fadeExponent: 2,
    topShade: 0.34,
    ribContrast: 0.45,
    ringEveryMeters: 0.32,
    ringShade: 1.55,
    // 0 = no raised kerb; the hole is edged only by the painted hazard ring.
    showRim: 0,
    rimScale: 1,
    rimY: 0,
  },

  // Rarity colours, index-matched to rarity.multipliers. Tier 0 is plain yellow;
  // each step is richer, and the top tier is white-gold and oversized.
  tierColors: {
    // One per rung. The hue sweeps a single turn -- yellow, green, cyan, blue,
    // violet, magenta -- and deliberately does NOT wrap, because a rung-19 duck
    // that looks like a rung-3 duck is worse than no colour at all. The top
    // three break out of the ramp into golds so a jackpot is unmistakable, and
    // rung 0 is exactly the yellow the plain duck always was.
    0: 0xf2c218,
    1: 0xc8c730,
    2: 0xaccc2e,
    3: 0x8cd12d,
    4: 0x6bd42d,
    5: 0x48d62e,
    6: 0x2ed838,
    7: 0x2fdb5d,
    8: 0x30dd83,
    9: 0x31dfa9,
    10: 0x31e1d0,
    11: 0x32cee3,
    12: 0x33aae5,
    13: 0x3486e7,
    14: 0x3561e9,
    15: 0x363ceb,
    16: 0x5838ed,
    17: 0x8039ef,
    18: 0xa83af0,
    19: 0xd13bf2,
    20: 0xf43cee,
    21: 0xf53ec9,
    22: 0xffb02a,
    23: 0xffd75e,
    24: 0xfff6d6,
  },

  hud: {
    // The contract banner: how long the result stays up after the lorry goes,
    // and when the clock starts flashing.
    contractEndMs: 3200,
    contractUrgentSeconds: 20,
    moneyPulseMs: 320,
    capMessageMs: 3200,
    floatMs: 900,
    tubeHintRadius: 5,
    machineHintRadius: 6,
  },

  input: {
    grabButton: 0,
    throwButton: 2,
    scrollSign: -1,
    // Chrome's post-Escape pointer-lock cooldown is about 1.25 s. Ask inside it
    // and the request is rejected; the game waits it out instead.
    lockCooldownMs: 1400,
    // A single rejection is a cooldown or a lost gesture, not a broken browser.
    // Only this many in a row drops to drag-to-look for good.
    lockFailuresBeforeFallback: 3,
    // A click whose only job is to get pointer lock back must not ALSO act in
    // the world. Leaving the shop, or pressing Escape, releases the cursor; the
    // click that takes it back is aimed wherever the mouse happened to be
    // sitting, which is how a wall ended up placed in the wrong spot by a click
    // the player only meant as "give me my cursor back". 1 swallows that one
    // grab edge (and the matching release), 0 restores the old behaviour.
    // It never applies when pointer lock is unavailable, because there the same
    // button is the ONLY way to act at all.
    swallowRelockClick: 1,
  },

  // --- G2: shop and content ------------------------------------------------
  // Everything the purchase logic reads. Item prices themselves are data rows
  // in src/data/, never here: config holds the rules, the catalog holds the
  // content.
  shop: {
    refundFraction: 0.6,   // demolish returns floor(price * this) -- frozen decision
    priceRounding: 1,      // repeat prices are rounded to this multiple
    maxLevelDefault: 1,    // levels for a row with no repeat block
    curveDefault: 1.6,     // repeat.curve when a row omits it
    // Nine, and bound to the digit row 1-9 for the same reason Minecraft is:
    // the keys are adjacent, they are all reachable without looking, and 0 is
    // the one digit that is not where its number says it is.
    hotbarSlots: 9,

    // --- the shelf -----------------------------------------------------------
    // How long one stock period lasts, and what it costs to skip the wait.
    // 180 s is the interval Jurek asked for; 100 is the price of impatience.
    stockSeconds: 180,
    rerollCost: 760,

    // The stock MODEL. src/sim/stock.js turns each of these into a unit count
    // per catalog row; none of it names an item, because "rarer" is derived
    // from the row's own cost, its repeat.times ceiling and its tab.
    stock: {
      // How much each derived signal contributes to a row's rarity, 0..1.
      // Price dominates: it is the catalog's own statement of how big a deal a
      // row is. The ownership ceiling is the second voice -- a row you may own
      // once is a one-off, a row you may own sixty times is bulk.
      costWeight: 0.60,
      limitWeight: 0.25,
      // Chance a row rolls ZERO units = zeroMax * rarity^zeroShape.
      // The shape is what protects the opening of work/economy.md: at 2.2 the
      // curve is nearly flat across the cheap half of the catalog, so the
      // bucket (rarity 0.17) sits near 1% while the dearest upgrade (0.85)
      // sits near 39%. Lowering zeroShape raises the floor for EVERY starter
      // item at once, which is the number that was measured and signed off, so
      // change it and re-measure rather than nudging it.
      zeroMax: 0.55,
      zeroShape: 2.2,
      // Units when a row IS stocked: uniform in
      // 1 .. round(unitsMax * (1 - rarity)^unitsShape).
      unitsMax: 14,
      unitsShape: 1.4,
      // A flat bias per tab, added last. Same shape as prestige.keep: one
      // number per catalog tab, so the rule stays data and never becomes a
      // branch on an id. Building material is raw stock and the vendor never
      // runs short of it; upgrades are paperwork he gets a few of at a time.
      //
      // Chosen to move as few rows as possible off the numbers Phase E actually
      // measured: production keeps Machines' 0.05, building and transport keep
      // Buildings' 0.00, gear keeps Items' 0.05, upgrades keep 0.15, and gamble
      // keeps the 0.05 it had under Machines. The only rows whose scarcity
      // changes at all are the four conveyors and the fan, which move from 0.05
      // to 0.00 -- they are cheap infrastructure bought by the dozen, so being
      // more reliably on the shelf is the right direction anyway.
      tabBias: {
        production: 0.05,
        transport: 0.00,
        building: 0.00,
        gear: 0.05,
        upgrades: 0.15,
        gamble: 0.05,
      },
    },
  },

  // The vendor's booth. Scenery with a solid box, exactly like the workbench:
  // a collider on the existing plate body, never a rigid body of its own.
  booth: {
    x: -5.5,
    y: 0,
    z: 6,
    yaw: 1.5707963268,   // model front is +Z; face it at the player spawn
    scale: 1,
    vendorLocalX: 0,
    vendorLocalY: 0,
    // Measured off shop.glb: the booth spans z -1.25..+1.25 and its front (+Z,
    // turned to face the player spawn) carries the counter around z +0.5. At
    // +1.05 the vendor was standing in FRONT of his own shop, on the customer's
    // side of the counter. -0.35 is the middle of the interior behind it.
    vendorLocalZ: -0.35,
    vendorYaw: 3.1415926536,
    useRange: 3.5,
    colliderHalfX: 1.45,
    colliderHalfY: 1.435,
    colliderHalfZ: 1.245,
    colliderLocalY: 1.435,
    colliderLocalZ: 0,
    // Placement keep-out around the booth, added to the collider half extents.
    keepout: 0.4,
    lampLocalX: 1.9,
    lampLocalY: 0,
    lampLocalZ: 0,
  },

  // Placement rules. resolvePlacement() in src/sim/build.js is the only reader
  // of these; both the hologram and the placed object come out of that one call.
  build: {
    grid: 0.25,
    yawStepDegrees: 15,
    fineStepDegrees: 1,   // [ and ] -- an arbitrary angle means free placement
    maxDistance: 14,
    minDistance: 0.9,
    groundY: 0,
    // Radial keep-out around the pit mouth, added to pit.radius.
    //
    // 0.05, not 0.45. The keep-out exists to stop an object being built INSIDE
    // the hole, and pit.radius already says where the hole ends -- every extra
    // centimetre is a ring of floor no belt may touch. At 0.45 the nearest legal
    // belt end sat outside the pit's 2.1 m capture radius, so a chain of fifteen
    // belts spanning the whole 35 m delivered its ducks onto bare concrete and
    // scored 0 out of 30. A transport chain that cannot reach the thing it
    // transports to is not a balance problem, it is a broken second act.
    pitMargin: 0.05,
    // ...but that argument only applies to things that DELIVER. A belt, a fan, a
    // ramp or a funnel wall has to be able to reach over the lip, so those keep
    // the 5 cm. Everything else -- machines, crates, decoration -- is pushed back
    // to `pitMarginBuild`, because a workbench parked on the rim is what turns
    // the mouth of the pit into a cluttered shelf and hides the one thing the
    // whole game points at.
    //
    // Split by KIND, from the row, never by id: a new machine gets the right
    // behaviour without anybody remembering to add it to a list.
    pitMarginBuild: 1.6,
    // The kinds allowed right up to the lip. These are exactly the pieces that
    // move ducks; if a new transport kind is added it belongs here, and the
    // symptom of forgetting is a chain that stops 1.6 m short of the hole.
    pitCloseKinds: ['conveyor', 'blower', 'ramp', 'wall'],
    // And these may go OVER it -- no keep-out at all, the hole is simply not
    // consulted. A belt is the only thing in the game that can carry ducks
    // somewhere on its own, so the one place a player most wants to end a belt
    // is the pit's mouth, and until now that was the one place they could not:
    // the keep-out ring stopped every piece a full 1.55 m short of the lip,
    // which is further than a duck rolls off the end.
    //
    // A 2 m belt over a 3 m hole cannot bridge it, so a duck riding to the end
    // drops in, which is the whole point. A player who lays enough belt to
    // cover the hole completely has built a floor over their own pit -- that is
    // their decision to make and it is trivially undone.
    pitOverKinds: ['conveyor'],
    // How far inside the plate edge an object must stay.
    plateMargin: 1.0,
    // Overlap slack: two objects may share this much before it counts as a
    // collision. Back to a numerical tolerance, which is all it was ever
    // supposed to be.
    //
    // It was 0.07 because the content was wrong, not because the rule was: a
    // wall measured 2.06 m against a 0.25 m grid, so the closest legal
    // neighbour sat 2.25 m away and left a 0.19 m hole -- wider than a duck
    // (0.20 x 0.18 x 0.14) -- and 0.07 m of licensed interpenetration was what
    // let a fence actually close. Belts had the same disease at 2.22 m and
    // corners at 1.45 m, and the slack then caused a SECOND bug: legal
    // neighbours that overlapped by less than 0.07 were accepted, so two belts
    // could be built visibly inside one another.
    //
    // Every placeable footprint is now an exact multiple of `grid` (authored in
    // tools/blender-models.py, table FOOTPRINT, and measured off the exported
    // GLBs), so flush neighbours share exactly 0.00 m and need no slack at all.
    // 0.01 is here only to absorb float dust in the snap-and-rotate arithmetic.
    overlapEpsilon: 0.01,
    demolishRange: 8,
    demolishHoldSeconds: 0.4,
    ghostOpacity: 0.42,
    ghostValidColor: 0x4fe07a,
    ghostInvalidColor: 0xff4a5c,
    // Capacity of the per-model instanced pool. Placed objects and dropped
    // props share the mechanism, so draw calls scale with distinct MODELS used,
    // not with the number of objects.
    instanceCapacity: 96,
  },

  // Purchases fall out of the overhead tube mouth as real bodies at 1:1 scale.
  drop: {
    belowMouth: 0.4,
    spread: 0.25,
    speed: 0.6,
    density: 90,
    friction: 0.85,
    restitution: 0.08,
    linearDamping: 0.05,
    angularDamping: 0.35,
    max: 48,
    seed: 20260815,
    // EVERY purchase is delivered through the chute -- buildings included -- so a
    // batch buy is a queue of deliveries, not a pile of rigid bodies created in
    // one frame. Two limits govern that queue, and they do different jobs:
    //
    //   perFrame  how many props the chute may spawn in a single frame. Buying
    //             sixty walls at once would otherwise create sixty dynamic
    //             bodies inside one step, which is the same mistake the
    //             container spill path already caps at `container.maxConvertPerStep`.
    //   max       how many dropped props may exist at all (above). The queue
    //             STOPS at that number rather than despawning the oldest prop,
    //             because a wall you paid for silently vanishing is worse than a
    //             wall that has not arrived yet. Whatever cannot fit waits in the
    //             chute and the HUD says how many are waiting.
    perFrame: 4,
    // How often the "deliveries waiting" message is repeated while the chute is
    // backed up. Without it the notice fires every frame.
    backlogNoticeSeconds: 3,
  },

  // Carrying an item in your hands.
  //
  // Nothing bought is ever handed straight to the player: it falls out of the
  // tube as a physical prop and stays on the floor until someone walks over,
  // puts the crosshair on it and presses E. Q throws whatever is in hand back
  // out as a prop, which is the whole point in co-op -- an item has to be able
  // to change hands, and the only way to give one away is to put it back in the
  // world where the other player can take it.
  hand: {
    pickupRange: 3.0,      // how far the E ray reaches for a dropped prop
    throwDistance: 0.9,    // metres in front of the eye the thrown prop appears
    throwSpeed: 5.0,       // m/s along the look direction
    throwLift: 0.25,       // fraction of throwSpeed added upwards
    minSpawnY: 0.12,       // a thrown prop never starts inside the floor
    // Where the held model sits in VIEW space, i.e. relative to the camera:
    // right, down, forward. A row's own `hand` block overrides any of these, so
    // these are the numbers a new carryable gets for free.
    modelX: 0.30,
    modelY: -0.32,
    modelZ: -0.62,
    modelPitchDegrees: 0,
    modelYawDegrees: 0,
    modelRollDegrees: 0,
    modelScale: 1,
  },

  // --- G3: automation --------------------------------------------------------

  // Automatic producers (the `producer_auto` kind). The output mouth is DERIVED
  // from the row's footprint and its placed pose, never tabulated per machine:
  // local +Z is a placed row's front, so the mouth sits mouthClear metres in
  // front of the front face, at mouthHeightFrac of the footprint height. A new
  // producer row therefore gets a working mouth from its footprint alone.
  producers: {
    mouthDepthFrac: 0.5,     // 0.5 = the front face of the footprint
    mouthClear: 0.28,        // metres beyond the face, so the duck spawns free of the collider
    mouthHeightFrac: 0.45,
    ejectSpeed: 2.0,         // m/s delta given to the new duck, along the mouth normal
    ejectDrop: -0.1,         // fraction of ejectSpeed applied downwards
    ejectSpread: 0.06,       // metres of lateral jitter, so a stack does not build a tower
    spawnSeed: 20260816,
    minSecondsPerDuck: 0.05, // floor on the interval however large machineRateMul gets
    maxSpawnsPerUpdate: 8,   // one long dt may not dump a whole minute of ducks at once
    rateMulMin: 0.05,
    // How long a machine with produce.jamChance stays seized. It is a wall,
    // not a delay: nothing happens until a player presses E on it, and this is
    // only the ceiling for a machine nobody comes to.
    jamSeconds: 45,
    rateMulMax: 20,
    luckMin: 1,
    luckMax: 40,
  },

  // Vacuum Station (the `collector_auto` kind). collect.radius / force /
  // perSecond are data on the row; these are the rules the kind obeys.
  collectors: {
    intakeHeightFrac: 0.55,  // intake height as a fraction of the footprint height
    // Clearance added to the machine's own footprint radius: inside that column
    // a duck counts as arrived, stops being pulled and stops eating the suction
    // budget. Without it the first few ducks pin themselves to the housing and
    // the station never reaches anything else.
    arriveRadius: 0.35,
    maxSpeed: 4.5,           // stop pushing a duck already closing faster than this
    burstSeconds: 1.0,       // how much unspent suction budget may be saved up
    minRadius: 0.1,
    // The lift, as a multiple of gravity, applied while a duck is below the
    // intake. It has to exceed 1.0 or a duck on the floor never leaves it:
    // friction on concrete (mu 0.6 x g 22 = 13.2 m/s^2) is stronger than the
    // Vacuum Station's own pull of 12, so a purely sideways suck moves nothing.
    // How long a duck a station has just delivered is invisible to every
    // station. Without it a Vacuum Station sucks its own output back in -- it
    // reaches 3.5 m and delivers at 1.4 -- and one duck bounces in and out
    // forever: measured, six ducks fed twenty-five times in six seconds. This
    // is the window a conveyor in front has to carry the duck away in.
    feedCooldownSeconds: 2.5,
    // The outlet cone: how far past the delivery point a station stays blind,
    // and how wide that blind spot is. cos(50 deg) = 0.643, so the station
    // ignores a 100-degree wedge in front of its own mouth out to the delivery
    // distance plus this clearance -- which is exactly the patch a conveyor is
    // laid on. Everything else in range is collected as before.
    outletClear: 1.20,
    outletCos: 0.643,
    liftGravityFrac: 1.15,
  },

  // The jam / attention readout. A duck asleep inside a transport's reach is
  // not player work; one asleep outside every reach is.
  attention: {
    beltMargin: 0.6,         // added to a belt's own footprint radius
    pitMargin: 0.5,          // a duck asleep over the pit mouth is not stranded
  },

  // --- G3: automation (belts and fans) --------------------------------------
  // How the movement systems behave. What each individual machine does is DATA
  // on its catalog row -- belt.speed / turn / rise, blow.force / range / cone --
  // and src/sim/conveyors.js and src/sim/blowers.js hardcode no number at all.
  automation: {
    // Uniform XZ grid the ducks are bucketed into once per substep, so a machine
    // visits the four cells its reach overlaps instead of all 300 ducks. One
    // cell should comfortably contain a single machine's reach.
    cellSize: 4.0,
    belt: {
      // How fast a duck's velocity converges on the belt's, per second. This is
      // grip, not teleporting: a duck held back by a wall simply slips, and the
      // correction is an impulse the solver may still overrule.
      //
      // It has to be this large because the belt collider is STATIC (contract:
      // no new rigid bodies for scenery), so Rapier's own friction fights the
      // drive every substep -- 0.75 combined friction under 22 m/s^2 of gravity
      // costs 0.275 m/s per substep. At 60 Hz the correction saturates at "match
      // the belt this substep", which puts the steady state at roughly
      // speed - 0.275 m/s, i.e. ~81% of the row's nominal belt.speed. Measured,
      // not assumed; raising this past 60 buys nothing at a 1/60 fixed step.
      grip: 60,
      maxAccel: 45,        // ceiling on the belt's correction, m/s^2
      // Footprint slack, in metres, added around a belt's own footprint.
      //
      // It no longer has a seam to bridge: belts are 1.00 x 2.00 and corners
      // 1.50 x 1.50, both exact multiples of build.grid, so two neighbours on
      // the grid touch with a gap of exactly zero. (It used to exist for that
      // reason -- 2.22 m belts and 1.45 m corners could leave 0.165 m of
      // undriven floor a duck stalled in forever.) What it still buys is grip
      // at the very edge of the belt and across the join itself, and it is safe
      // to be generous sideways because the surface band below still excludes
      // anything standing on the floor beside the belt.
      marginXZ: 0.14,
      surfaceBelow: 0.30,  // how far below the top face still counts as resting on it
      surfaceAbove: 0.45,  // and how far above, so a bouncing duck is not dropped
      liftScale: 1.0,      // scales the climb rate derived from the row's belt.rise
    },
    fan: {
      // The airstream's own speed. A duck already moving this fast gets no more
      // push, which is what turns a line of fans into a corridor with a speed
      // limit instead of a catapult.
      airSpeed: 7.0,
      falloffExponent: 0.55,
      minDistance: 0.25,   // no singularity right at the hub
      lift: 0.5,           // upward fraction of the blow; breaks floor friction
      edgeSoftness: 0.3,   // fraction of the cone over which the force fades out
    },
    // debugFanCoverage(): does a chain actually span the workbench-to-pit run?
    coverage: {
      stepMeters: 0.25,
      duckHeight: 0.12,
      maxGap: 0.5,
    },
    // debugChainTest(): spawn at the machine end, step, count what scored.
    chainTest: {
      ducks: 30,
      seconds: 60,
      spawnSpan: 0.5,
      spawnHeight: 0.5,
      spawnRows: 6,
      spawnStagger: 0.22,
    },
  },

  // Hybrid containers (the `storage` block: bucket, crate, large crate,
  // container, cart). src/sim/containers.js merges this over its own defaults
  // key by key, so a key deleted here is caught by assertConfig at boot rather
  // than silently falling back to the module's table.
  containers: {
    // At most this many real bodies live inside one container; everything past
    // it is absorbed into a virtual count and its body returns to the pool.
    physicalLimit: 25,
    // Ducks converted (either direction) per step during a spill.
    // Materialising 200 bodies in one frame freezes the game.
    maxConvertPerStep: 6,
    // Tipping: the up axis this far off vertical, held this long, starts a spill.
    tipAngleDegrees: 60,
    tipHoldSeconds: 0.25,
    // Capture zone: the box footprint, shrunk, extended this far above the lid.
    captureShrink: 0.92,
    mouthHeight: 0.5,
    // Where spilled ducks leave from, measured out from the box centre along the
    // container's own up axis, as a margin on top of its half-height.
    mouthMargin: 0.18,
    spillSpeed: 1.4,
    spillSpread: 0.35,
    spillSeed: 20260816,
    // Packing of the physical contents inside the box. slotSpacing is the widest
    // spacing tried; it shrinks by slotSpacingDecay until the lattice offers
    // physicalLimit places or hits slotSpacingMin.
    //
    // NEITHER of these can push two slots closer than one duck: containers.js
    // floors the per-axis step at the duck's own size, read from config.ducks.
    // They were authored against a 0.20 x 0.18 x 0.14 duck and kept packing on
    // a 0.08 m lattice after the duck grew to 0.178 x 0.386 x 0.146, which is
    // how a bucket came to report eight ducks while showing two.
    slotSpacing: 0.24,
    slotSpacingMin: 0.08,
    slotSpacingDecay: 0.9,
    // Breathing room between a duck and the nearest cavity wall. A MARGIN ON
    // TOP of the duck's own half-extent, which the lattice now insets by
    // separately -- it is no longer doing that job alone, so it is small.
    slotInset: 0.02,
    // Critically damped spring that keeps a physical content at its slot.
    slotKp: 80,
    slotKdScale: 2,
    slotMaxSpeed: 9,
    slotRestEpsilon: 0.02,
    // Mass added per duck inside. Deliberately larger than a loose duck's
    // 0.16 kg: a duck you can throw one-handed has to be light, and a crate of
    // sixteen of them has to be something you shove rather than flick. This is
    // the knob for "the full crate feels empty".
    massPerDuck: 0.6,
    // A row's storage.leakPerSecond only applies while the box is MOVING:
    // carried, or shoved along the floor. This is the speed above which it
    // counts as pushed; a leaky bucket standing on the plate holds what it has,
    // which is what makes the field a transport hazard rather than a slow drain
    // on everything the player owns.
    leakMinSpeed: 0.2,
    // Ducks a leak may materialise in one step (a leak is a trickle, so this is
    // deliberately smaller than maxConvertPerStep) and how long a leaked duck
    // stays invisible to the box it fell out of. The second number is not
    // optional: a leak exits through the mouth and the mouth IS the capture
    // zone, so without it a leaking bucket eats its own drip on the next step
    // and the measured rate reads zero while the box looks busy.
    leakMaxPerStep: 2,
    // Where a leak comes out. NOT the mouth: the mouth is the top and the top
    // is the capture zone, so a duck posted through it is thrown up into the lid
    // and drops straight back in (measured: 5 leaked, 3 instantly re-absorbed).
    // A leak escapes low and out through one side, clearing the box's own
    // collider by leakClearance, and lands beside it where it can be picked up.
    leakClearance: 0.24,
    leakDownBias: 0.35,
    leakReentrySeconds: 1.2,
  },

  // Handheld tools (the `tool` block: Broom, Handheld Vacuum, Scoop). Which
  // behaviour a row has is DATA on the row (`tool.mode`), not a number here.
  tools: {
    // Broom. The arc is measured on the FLOOR around the player's heading, so
    // `reach` is a horizontal distance: a broom that spent most of its 1.8 m on
    // the 1.6 m drop from the eye to the floor would sweep nothing.
    sweepLift: 0.25,          // fraction of the push that goes upward
    sweepFalloff: 0.5,        // impulse at maximum reach, as a fraction
    sweepMaxAccel: 40,        // m/s2 the bristles may add; floor friction is 13.2
    sweepBelow: 2.2,          // how far under the aim origin the bristles reach
    sweepAbove: 0.6,          // and how far above it
    sweepMaxTargets: 64,
    // Vacuum.
    suckHoldDistance: 1.1,    // where a sucked duck is held, metres along the aim
    suckKp: 60,
    suckKdScale: 2,
    suckMaxSpeed: 12,
    hoseSpeedScale: 1,        // hose impulse = tool.force * this * mass
    // Scoop. A scoop holds tool.capacity ducks instead of one, so it reuses
    // suckHoldDistance and suckKp/suckKdScale; what it needs of its own is
    // somewhere to put the ones after the first. scoopSpread is the radius of
    // the ring they are held in, one turn of the ring per duck.
    scoopSpread: 0.28,
    // A scoop's reach is HORIZONTAL, like the broom's and unlike the vacuum's,
    // and these are the band it works in. The eye is 1.62 m up, so a floor duck
    // is never closer than ~1.44 m in 3D: measured that way a `reach: 1.2`
    // dustpan could never touch the ground, and the row would read as a balance
    // mistake instead of a geometry one.
    scoopBelow: 2.2,
    scoopAbove: 0.6,
    // Only used if config.ducks.mass is missing, which assertConfig makes fatal.
    duckMassFallback: 0.16,
  },

  boot: {
    fetchTimeoutMs: 6000,
  },

  // Multiplayer transport. Wire-format ceilings that the deployed security
  // rules also enforce live in src/net/paths.js, not here: those two must not
  // be able to drift. What is here is timing, and only timing.
  net: {
    // Loading the Firebase SDK is lazy and must never be able to hang boot.
    sdkTimeoutMs: 8000,
    authTimeoutMs: 8000,
    // How long after a failed load before another attempt is allowed.
    retryCooldownMs: 15000,
    // Signalling and the ICE handshake. A peer that has not opened both
    // channels by then is reported as failed rather than left hanging.
    signalTimeoutMs: 20000,
    peerTimeoutMs: 25000,
    // Presence. A hidden tab freezes requestAnimationFrame, so this runs on
    // setInterval and the window in paths.js is far wider than the beat.
    heartbeatMs: 20000,
    // Unreliable state channel. Both ends of the same link, deliberately
    // asymmetric: the host sends the world, a client sends one capsule.
    hostStateHz: 20,
    clientStateHz: 30,
    // --- the client's input, as the host consumes it -------------------------
    // How many inputs each 30 Hz packet carries. The channel is lossy by design
    // and one input per packet means every lost packet is movement the host can
    // never apply -- and since an input is a HELD state, a lost one delays a
    // direction change and leaves a permanent offset that the reconciler
    // eventually calls a disagreement and snaps. 5 covers four consecutive
    // losses (133 ms at 30 Hz). It costs 5 x 16 B x 30 Hz = 2.34 KB/s of client
    // uplink against 0.47 KB/s for a single input: +1.88 KB/s, on a link whose
    // 60 KB/s budget (gate E-H) is spent on the host's downstream.
    inputWindow: 5,
    // The most input time the host will bank for one player. A client that tabs
    // away, drops, or stalls comes back with a redundancy window full of inputs;
    // without a ceiling the host would integrate its capsule across the whole
    // gap in one burst, which is a teleport. It is ALSO the host's replay lag:
    // banked input is input the host has not walked yet, so a deep bank means
    // the host's idea of where that player is standing -- which every one of
    // their requests is range checked against -- is that far behind. 120 ms is
    // 3.6 inputs at 30 Hz: deep enough to ride out jitter, shallow enough that
    // a remote player's position is never a metre stale.
    inputBudgetMaxMs: 120,
    // Two clocks are never quite the same speed. A client whose input timer runs
    // 1% fast credits 1.01 s of input per second of host simulation, and the
    // bank would sit pinned against the ceiling above for the rest of the
    // session -- the worst place for it to sit, because the ceiling is the lag.
    // So once there is more than one input in reserve the host spends input time
    // this much faster than it simulates, which walks the bank back down to one
    // input and holds it there. It does NOT make the capsule faster: a capsule
    // moves one substep of movement per substep whatever its bank says, so
    // draining discards surplus time smoothly instead of dropping a whole 33 ms
    // of somebody's walk in one lump.
    inputCatchUpFactor: 0.25,
    // With nothing banked, how long the capsule may keep walking on the last
    // input it did receive. An input is a held state, so the honest guess after
    // one lost packet is "still the same"; 100 ms is three packets at 30 Hz,
    // which the 5-deep window would have covered anyway. Past it the host does
    // not know, and standing still is the true answer -- this is the bound that
    // stops a silent client's capsule walking away on its own.
    inputCoastMs: 100,
    // How much of that coast the MOVEMENT survives. The look coasts for the
    // whole window -- a head that snaps to centre on a dropped packet is
    // horrible and harmless -- but the walk stops here, because the one packet
    // whose loss matters is the frame the player let go, and coasting through
    // it walks somebody who has stopped.
    // 40, and it MUST be under inputCoastMs (100) or it never fires: at 110 the
    // movement outlived the coast window that contains it and the fix did
    // nothing at all.
    inputCoastMoveMs: 40,
    // Rolling window for the KB/s counters on the debug overlay.
    rateWindowMs: 2000,
    // A client's own capsule is reconciled hard past this distance.
    reconcileHardMeters: 0.25,
    // --- binary state frame (src/net/snapshot.js) ---------------------------
    // Bumped whenever the byte layout changes; a frame carrying any other
    // version is rejected rather than misread as garbage poses.
    protocolVersion: 1,
    // Position quantisation. A 0.01 m step in a u16 covers +/-327.67 m, so
    // nothing on a 120 m plate above a 34 m shaft can leave the range, and the
    // worst-case error is half a step: 5 mm.
    positionStep: 0.01,
    positionBias: 32768,
    // Smallest-three quaternion: 10 bits per surviving component, ~0.1 deg.
    quatBits: 10,
    // Hard ceiling on one state frame. 512 bodies is 6160 B, well inside one
    // SCTP message, and the duck pool is 300.
    maxBodiesPerFrame: 512,
    // Relevance culling. Measured: the sleeping filter alone leaves a running
    // belt chain at 208 awake ducks and 49.1 KB/s against a 60 KB/s budget, so
    // this is load-bearing rather than an optimisation. A body further than this
    // from the receiving client's own camera is not in that client's frame at
    // all; 0 disables the filter.
    relevanceRadius: 45,
    // Automatic rate degradation, measured off the same sliding-window counter
    // the overlay shows. Above degradeAboveKBPerSecond for degradeHoldMs the
    // host drops to degradedHostStateHz; below recoverBelowKBPerSecond for the
    // same hold it goes back to hostStateHz.
    // 52 KB/s is 87% of the 60 KB/s budget and lands at 220 awake bodies, so a
    // running factory (208 awake, measured 49.06 KB/s) keeps the full 20 Hz --
    // degrading a normal factory permanently would trade smoothness for nothing.
    // recoverBelowKBPerSecond must stay under degradeAbove * 15/20 = 39, or a
    // degraded stream instantly qualifies for recovery and the rate oscillates;
    // resolveNetConfig() refuses to boot on a pair that breaks that.
    degradedHostStateHz: 15,
    degradeAboveKBPerSecond: 52,
    recoverBelowKBPerSecond: 38,
    degradeHoldMs: 2000,
    // Backpressure ceiling on the unreliable channel. Past this many bytes
    // already queued in the SCTP send buffer, a state frame is dropped instead
    // of queued: on an unreliable channel the NEXT tick carries fresher data
    // than the one waiting behind it, so queueing only adds latency. 256 KB is
    // ~2 s of the worst measured stream (70.6 KB/s at 300 awake bodies).
    stateBackpressureBytes: 262144,
    // --- host authority and the client (src/net/host.js, client.js) ---------
    // The host's simulation pump. requestAnimationFrame is dead in a hidden tab
    // and setInterval is clamped there to ~1 Hz, so the pump is a worker clock
    // (src/net/clock.js). This is also the cadence the per-peer send scheduler
    // is checked on, so it must divide into the state interval comfortably:
    // 25 ms against 50 ms (20 Hz) and 66.7 ms (15 Hz).
    hostTickMs: 25,
    // How long rAF may be silent before the worker clock takes the simulation
    // over. Above one slow frame (~60 ms) and well below the 1 Hz a hidden tab
    // would otherwise fall to. While the host tab is visible this is never
    // reached and the game runs exactly as it does single player.
    rafStaleMs: 120,
    // How far the pumped clock may fall behind the wall clock before the debt
    // is written off instead of repaid. A host whose machine cannot simulate as
    // fast as time passes would otherwise ask for a bigger dt every tick, which
    // costs more, which grows the debt -- the spiral of death. Half a second is
    // long enough that an ordinary stutter is caught up smoothly and short
    // enough that nobody watches the world fast-forward to catch up.
    pumpDebtCeilMs: 500,
    // Hard bound on how many chunks one tick may pump. The debt ceiling already
    // stops the loop on paper; this stops it in the one case the ceiling cannot,
    // which is a clock that jumps (machine wake from sleep). Six chunks is
    // 500 ms of simulation, exactly the ceiling, so it never binds first.
    pumpChunksPerTick: 6,
    // The client renders remote bodies this far in the past, so there are
    // always two frames to interpolate between. 100 ms is two frames at 20 Hz.
    interpDelayMs: 100,
    // Past this with no newer frame the client stops extrapolating and holds
    // the last known pose rather than sliding a duck across the plate.
    interpHoldMs: 400,
    // A client's own capsule: under the hard threshold the disagreement is
    // eased in at this fraction per AUTHORITATIVE SAMPLE -- not per rendered
    // frame. The stream is 20 Hz, so applying the same 50 ms old disagreement
    // on all three frames it spans applies it three times, which is most of
    // what the owner felt as resistance.
    reconcileSoftFactor: 0.18,
    // How much of its own recent path the client keeps, to tell "the host is
    // behind me" apart from "the host disagrees with me". It must comfortably
    // cover a round trip plus the 50 ms between samples; 600 ms covers a 500 ms
    // round trip, which is worse than any link this game is playable on.
    reconcileHistoryMs: 600,
    // How close to that path the host's pose has to land to count as agreement
    // rather than disagreement. Position quantisation is 10 mm and the path is
    // matched against segments rather than samples, so the floor is about 5 mm;
    // 50 mm leaves room for a frame of solver difference without ever reaching
    // a distance a player could see.
    reconcileMatchMeters: 0.05,
    // The join snapshot is JSON on the reliable channel. A single SCTP message
    // over about 64 KB is refused by some browsers and silently closes the
    // channel in others, so it is chunked. 12000 chars is comfortably inside
    // every implementation's limit.
    snapshotChunkChars: 12000,
    joinTimeoutMs: 20000,
    // Wire identity namespaces. The state frame carries a u16 netId and three
    // different kinds of body share it: duck pool slots start at 0, dropped
    // props are keyed by the monotonic placement counter, and player capsules
    // by slot. Without separate bases duck slot 7 and prop key 7 are the same
    // id on the wire and each overwrites the other.
    wireDuckBase: 0,
    wirePropBase: 1024,
    wirePlayerBase: 60000,
    // A duck that settles leaves the state stream and gets ONE duckSettled on
    // the reliable channel (frozen contract rule 4). They are batched so a
    // hundred ducks going quiet at once is a few messages, not a hundred.
    settledBatchMax: 64,
    // LIVENESS. Spawn and removal are both one-shot announcements: the host says
    // "duck 47 exists" once and "duck 47 is gone" once, and if either statement
    // fails to take effect on a client -- lost, or contradicted by something the
    // client's own copy of the simulation did on its own -- nothing in the
    // protocol ever mentions that duck again. The result is permanent: a duck
    // drawn on one screen that no other player can touch, or a duck everyone
    // else can push that one player cannot see.
    //
    // So the host re-states the WHOLE authoritative duck set on a slow timer, as
    // a bitmap of pool slots: 300 bits is 38 bytes, ~76 bytes of JSON once
    // base64'd, and at 1 Hz that is ~76 B/s against a 60 KB/s per-client budget
    // (0.12%). It is a periodic statement of fact rather than a diff on purpose
    // -- a diff is exactly the thing that cannot repair a missed diff.
    livenessIntervalMs: 1000,
    // A client that finds itself MISSING a duck the bitmap claims cannot invent
    // one: it has no tier and no pose. It asks, and the host clears its own
    // record of having announced those slots, so the next reconcile re-announces
    // them the same way it announces a fresh spawn. Bounded per message, and
    // rate limited on both ends, so a client on a broken link cannot turn its
    // own confusion into a broadcast storm.
    livenessResyncCooldownMs: 1000,
    livenessMaxResyncIds: 64,
    // THE ONE PLACE A CLIENT IS SUPPOSED TO HAVE DUCKS THE HOST NEVER SENT IT:
    // the intro. src/cutscene.js stages its own set -- shot 2's pile is spawned
    // locally on every tab, including a client's -- and strikes it again in
    // teardown. Collecting those would empty the shot while the camera is on it.
    // So liveness stands down while the room is in the lobby (where prepare()
    // dresses the set) and for this long after the intro starts. The intro is
    // ~30 s (config.cutscene.seconds is the fallback; the beats file is the
    // authority), and this is deliberately longer than the longest it can run.
    //
    // ASSUMPTION, and the honest way to remove it: client.js has no way to ask
    // whether a cutscene is still running -- the adapter exposes `phase`, and
    // phase is 'playing' throughout the intro. A `cutsceneActive()` on the game
    // adapter would turn this timer into a fact.
    livenessCutsceneGraceMs: 45000,
    // The host range checks every request against where the asking player is
    // actually standing, because a request carries an aim and an aim can be
    // stale by a round trip. This is how much further than the single-player
    // range that check allows: enough to cover a player who was walking when
    // they clicked, not enough to place a wall across the plate.
    reachSlack: 1.5,
    // A grab request carries the asker's eye position, and the host does not
    // take it: it casts the ray from where IT believes that player's eye is.
    // The supplied origin is only compared against that, and a request whose
    // origin is further off than this is refused rather than quietly corrected
    // -- being told "out of reach" is a fair answer to a lie, and to a genuinely
    // ancient message it is the true one. Generous enough to cover a sprinting
    // player's round trip (sprint is 8.4 m/s, so 3 m is about 350 ms of it).
    aimOriginSlack: 3.0,
    // STUN only. There is no TURN server, so symmetric NAT on both ends is a
    // documented failure, never something to paper over.
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  },

  // --- G5: the sky ----------------------------------------------------------
  //
  // Dark navy with a Gargantua-style black hole, and nothing else. Frozen
  // product decision: the sky is scenery, it does not change with time of day
  // and there is no second weather state to author.
  //
  // The shader itself is a 1:1 port of ../Gargantua/src/scene/blackhole.js and
  // owns its own constants (RS, DISK_IN, DISK_OUT, BEAM). Nothing here may
  // contradict them -- these are only where the thing hangs and how big it
  // looks, which is the part that is this game's business rather than the
  // shader's.
  sky: {
    // Direction from the player to the hole. Up and ahead-left of the spawn,
    // which faces -Z: it is in frame while walking the arrow path to the pit,
    // and out of the way of the workbench at +Z and the booth at -X.
    // -0.38, previously -0.52: 26.0 degrees left of the spawn's forward instead
    // of 33.7. The hole is wide enough now that the old bearing pushed its left
    // wing past the 51 degree half-FOV and the screen edge cut the disk.
    dirX: -0.38,
    // 0.42, previously 0.34. The hole is more than twice as wide on screen,
    // and at the old elevation (19.9 degrees) the bottom of the enlarged quad
    // dipped far enough below the horizon that the plate cut a straight line
    // across the outer starfield. 0.42 lifts it to 25.8 degrees elevation, which
    // puts the whole bright part of the picture -- the halo reaches 11.4 degrees
    // from centre -- between 14 and 37 degrees up, i.e. framed by a 70 degree
    // vertical FOV while the player is walking the arrow path, with only the
    // faint outer starfield low enough for the horizon to clip.
    dirY: 0.42,
    dirZ: -0.78,
    // The quad is parked on the camera every frame, so this is an apparent
    // distance, not a place on the plate. It must stay inside render.far (400)
    // with room for the quad's own corners: 300 + 170 diagonal = 375.
    // The accretion disk's streaks are driven by the shader's uTime, so this is
    // the one knob that decides what "the sky is static" means. 1 is the
    // Gargantua rate, which is what a 1:1 port gives; 0 freezes the disk into a
    // still image without touching a line of the ported shader. The frozen
    // product decision is that the sky does not CHANGE -- no day/night, no
    // weather -- and a slowly churning disk is read here as scenery rather than
    // as a change of state. One number to disagree with, not a code edit.
    timeScale: 1,
    // Bigger and closer, so Gargantua dominates the sky. The quad's apparent
    // scale is holeSize / holeDistance, and both moved:
    //   was  240 / 300 -> the shadow disc (RS 0.115 of the half-quad) spanned
    //        2 * atan(13.8 / 300) = 5.3 degrees. A coin.
    //   now  380 / 250 -> the shadow disc (RS 0.190) spans
    //        2 * atan(36.1 / 250) = 16.4 degrees, and the accretion disk's
    //        outer edge (DISK_OUT * RS = 0.874 of the half-quad) spans
    //        2 * atan(166 / 250) = 66.8 degrees of sky -- wider than the 70
    //        degree vertical FOV, which is what "dominates" means here.
    // The corners still fit inside render.far: 0.707 * 380 = 269 m off the quad
    // centre, so the far corner is sqrt(250^2 + 269^2) = 367 m against a 400 m
    // far plane. That 33 m is the whole remaining headroom -- growing the quad
    // any further needs render.far raised with it, and raising far costs depth
    // precision on a scene whose near plane is 0.1.
    holeDistance: 250,
    holeSize: 380,
    starCount: 900,
    starRadius: 330,
    starSize: 2.2,
    starOpacity: 0.75,
    starSeed: 1337,
    // Both live in the transparent pass, so these order them against each other
    // and against the decals (renderOrder 1) and the build hologram.
    holeRenderOrder: -2,
    starRenderOrder: -3,
  },

  // Object label and outline under the crosshair.
  //
  // The label is a DOM element positioned by projecting a world point, NEVER a
  // texture in the world: at a 480 px backbuffer world-space text is mush.
  // Settled in G0 and it is the same rule the avatar nicknames follow.
  //
  // The outline is an inverted hull -- the target's own geometry drawn back
  // faces only, pushed out along its normals in VIEW space so the rim is a
  // constant number of screen pixels at any distance. One extra draw call while
  // something is focused and zero when nothing is, and no post-processing
  // composer, which is the whole PSX approach and is settled.
  focus: {
    range: 14,           // how far the crosshair reaches for something to name
    duckRange: 6,        // ducks are small; naming one across the plate is noise
    // The duck pick is a ray/sphere test against the model's own bounding
    // sphere, shrunk by this: the raw sphere wraps the bill and the tail as
    // well as the body, so at 1.0 a duck is claimed from a good hand's width
    // off it and a crowd becomes one soup of overlapping claims.
    duckPickRadiusScale: 0.72,
    outlineWidth: 2.6,   // screen pixels of rim at the backbuffer's scale
    outlineColor: 0xffe14a,
    outlineOpacity: 0.9,
    labelMaxDistance: 14,
    labelMinOpacity: 0.45,
    // Metres above the target's own top face that the label anchor sits. The
    // top face is measured off the geometry's bounding box every frame rather
    // than tabulated, so it is right for a duck, a wall and the workbench alike.
    labelClearance: 0.22,
    // A duck's label is its VALUE, and it is set in type that grows with the
    // rarity ladder: the bottom rung reads at the same size as every other
    // label in the game and the top rung is 34 px of gold you can read from
    // across the yard. Only the last fifth of the ladder glows -- a glow on
    // every duck is not a signal, it is a filter over the whole screen.
    valueSizeMin: 12,
    valueSizeMax: 34,
    valueGlowFrom: 0.8,
    // A target must survive this many frames before its name is shown, so
    // sweeping the crosshair across a crowd does not strobe the label.
    stickyFrames: 2,
  },

  // --- G4: lobby, avatars, session summary ----------------------------------

  lobby: {
    // The public room list is a snapshot, not a subscription: one read per
    // refresh keeps the lobby off the RTDB listener budget while it is open.
    refreshMs: 6000,
    maxRooms: 12,
    // How long "Copied" stays under the link button.
    copyFeedbackMs: 1600,
    // Nickname box. The hard ceiling is limits.maxNickChars in net/paths.js,
    // which the deployed rules enforce; this is only what the input allows.
    maxNickChars: 24,
  },

  // --- G6: the front end -- main menu, settings, player configuration --------
  //
  // Every value below is a PREFERENCE. Nothing in this block is ever allowed to
  // hold an identity: presence ids and peer ids are generated per page load in
  // src/net/ and must NEVER be read back out of localStorage (frozen G4
  // contract rule 8). What is persisted here is what the player chose, and
  // nothing that says who they are on the wire.
  settings: {
    // The stored blob is versioned. Bumping this discards every stored
    // preference, which is the honest way to change what a field MEANS rather
    // than silently reinterpreting an old value under a new rule.
    schema: 1,
    // Volume sliders are multipliers ON TOP of the per-clip gains in
    // assets/audio/mix.json and of audio.masterGain. Jurek set those by ear;
    // a player's volume control scales the bus, it never rewrites his mix.
    masterVolume: 1,
    sfxVolume: 1,
    ambientVolume: 1,
    volumeMin: 0,
    volumeMax: 1,
    volumeStep: 0.01,
    // Radians of look per pixel of mouse travel -- exactly what
    // player.mouseSensitivity is, so the setting IS the number the input layer
    // reads rather than a multiplier that has to be decoded to be checked.
    mouseSensitivity: 0.0022,
    sensitivityMin: 0.0005,
    sensitivityMax: 0.008,
    sensitivityStep: 0.0001,
    // Vertical field of view in degrees, written straight onto the camera.
    fov: 70,
    fovMin: 55,
    fovMax: 100,
    fovStep: 1,
    // The PSX pixelation knob. The renderer clamps to
    // render.bufferWidthMin/Max, so this is only the range the slider offers --
    // it is not a second authority on what the buffer may be. Adaptive quality
    // is still free to move it under load afterwards; this is where it starts.
    bufferWidth: 480,
    bufferWidthStep: 20,
  },

  // The 30-second in-engine intro (src/cutscene.js) and the multiplayer waiting
  // room that launches it.
  //
  // The one number that is NOT here is the tempo. The beat grid is measured and
  // lives in assets/audio/cutscene.beats.json (30.000 s, 122.5 BPM, 62 beats,
  // 16 bars, beat 0 at t=0); every cut is addressed by BAR INDEX and resolved
  // through that file at runtime. Restating a BPM here would create a second
  // authority on the edit, and the two would drift the first time the track was
  // re-cut.
  cutscene: {
    // Only a fallback for the length, used if the beats file cannot be read at
    // all -- in which case the cutscene refuses to run rather than guess.
    seconds: 30,
    fetchTimeoutMs: 8000,
    beatsPath: './assets/audio/cutscene.beats.json',
    musicPath: './assets/audio/cutscene.mp3',
    // Through the audio bus (bus.synthNodes()), so the mixer, the mute and both
    // volume sliders apply. Never a bare `new Audio()`.
    musicGain: 0.85,
    // Decoding costs a few milliseconds and the timeline does not wait for it,
    // so the track starts at the point the clock has already reached plus this
    // much lead. Audio catches up to the clock; the clock never waits for audio.
    musicLeadSeconds: 0.02,
    musicFadeSeconds: 0.35,
    // The black at each end, driven off the timeline so a slow frame can never
    // leave the screen dark.
    fadeSeconds: 0.8,
    // Letterbox height, per bar, in vh. 0 removes it entirely -- it is one
    // number on purpose, because it is the ONLY thing drawn over the world
    // during the intro apart from the skip hint, and it is a camera device
    // rather than an interface element.
    letterboxVh: 9,
    // How many bars the skip hint stays up for before it fades away. It is not
    // allowed to sit on screen for the whole run: a hint that never leaves is
    // interface, and during the intro there is none.
    skipHoldBars: 2,
    // A player who would see less than this much of it sees none of it: two
    // seconds of intro is a flicker, not an intro.
    minRemainingSeconds: 3.0,
    // --- the title cards ------------------------------------------------------
    // The eyebrow/title pair a shot carries, timed like every other event here:
    // in BARS off the measured grid, never in arbitrary seconds. A card comes up
    // over the first `cardFadeBars` of its shot, holds for `cardHoldBars`, and
    // is gone again before the cut -- it is part of the film, so it obeys the
    // music and it leaves before the picture changes.
    cardFadeBars: 0.5,
    cardHoldBars: 2.5,

    // --- shot 2: the pile -----------------------------------------------------
    // Jurek's explicit instruction: every duck asleep BEFORE the camera rolls.
    // The world sleeps a duck after ducks.sleepAfter seconds of stillness, so
    // the staging steps the simulation until the world's own counters agree.
    // This is the ceiling on that loop, in simulated seconds.
    settleMaxSeconds: 40,
    // Substeps of the settle pass per frame while the waiting room is up. The
    // whole pass in one synchronous loop blocks the main thread long enough to
    // break a client's WebRTC handshake; 8 a frame keeps the tab answering.
    settleStepsPerFrame: 8,
    // Hard ceiling on the one-shot settle in finishSettle(). It is a safety wall,
    // not a tuning knob: nothing should ever reach it.
    settleWallClockMs: 2000,
    overflowDucks: 150,
    // 90 m from the factory set and 60 m from the crew, so shot 3's fans cannot
    // blow shot 2's pile around. The plate is 180 m; there is room.
    overflowX: -52,
    overflowZ: 40,
    // The column the pile is dropped from: radius, how much wider the base
    // gets, where the first duck starts and how far apart they are stacked.
    // 150 ducks at 0.085 m is a 12.7 m column, which lands as a heap about
    // 1.2 m high.
    overflowInnerRadius: 1.25,
    overflowRingStep: 0.55,
    overflowDropY: 0.35,
    overflowStackStep: 0.085,
    // How far around the pile counts as "in the shot" for the asleep assertion.
    overflowCheckRadius: 14,

    // --- shot 3: the factory --------------------------------------------------
    factoryX: 52,
    factoryZ: 40,
    factoryDucks: 48,

    // --- shot 4: the crew -----------------------------------------------------
    // AT THE PIT. The final shot pulls back off four players standing at the
    // rim of the hole the whole game points at, so the reveal is the plaza --
    // pit, booth, chute -- and not an empty grey plate.
    crewX: 0,
    crewZ: 6.0,
    crewRadius: 2.4,
    // A few ducks around their feet, so the last frame looks like a session
    // rather than four people standing in a field.
    crewDucks: 22,
    // Which of the four waves. The avatar is a single capsule with no limbs, so
    // the "wave" is a yaw rock and a bob on the beat -- the only gesture that
    // body can make.
    crewWaver: 1,
    crewNames: ['jurek', 'rysiek', 'narek', 'gzowo'],

    // --- shot 1: the chute ----------------------------------------------------
    // Let out a few per frame, exactly as a real sixty-wall purchase is, so the
    // flood reads as a stream rather than one clump.
    // Seconds between items in the burst. Sixteen at 0.11 s is a 1.8 s stream,
    // which spans most of the shot instead of emptying the pipe in a tenth of
    // a second.
    chuteIntervalSeconds: 0.11,
    chuteBurst: [
      'box', 'bucket', 'crate_wood', 'wall', 'bucket', 'box', 'wall', 'sack',
      'bucket', 'wall', 'box', 'crate_wood', 'bucket', 'wall', 'box', 'sack',
    ],
    // The single item at bar 0 and the second at bar 1.
    chuteFirst: 'box',
    chuteSecond: 'bucket',
  },

  menu: {
    // How long a saved/copied confirmation stays on screen.
    flashMs: 1400,
    // The avatar colour swatches. Chosen to stay apart from the duck yellow and
    // from each other under the flat-shaded lighting.
    palette: [
      '#9fe870', '#ffd84a', '#79b8ff', '#ff8a94',
      '#c9a0ff', '#5fe0c8', '#ffa45c', '#e8eeff',
    ],
    defaultColor: '#9fe870',
  },

  avatars: {
    // Remote players only. The local player is a camera, never a body on
    // screen, so four players means at most three avatars -- the fourth slot
    // exists so a spectating host still fits.
    max: 4,
    scale: 1,
    // The avatar model stands on y=0; the capsule pose is its centre.
    yOffset: -0.9,
    // avatar.glb faces its own local +Z. A player's yaw is the input yaw, where
    // 0 means looking down -Z (view.js: forward = -sin(yaw), -cos(yaw)), so the
    // mesh is turned half a turn or every remote player walks backwards.
    // MEASURED off a render of four avatars at yaw 0, not assumed.
    modelYaw: 3.1415926536,
    // Remote poses are INTERPOLATED, never simulated. The render delay and the
    // hold timeout are net.interpDelayMs / net.interpHoldMs -- an avatar is a
    // remote body like any other, and a second knob for the same effect is how
    // this project has been bitten before. Only the history window is local.
    bufferMs: 1500,
    // Nickname label: a DOM element positioned by projecting this point. A
    // world-space label would be mush at a 480 px backbuffer -- settled in G0.
    labelHeight: 2.15,
    labelMaxDistance: 45,
    labelMinOpacity: 0.35,
    // An avatar closer than this to the camera is not drawn: at that range it
    // is a wall of polygons across the whole screen and tells you nothing.
    hideRadius: 0.45,

    // --- the rig ---------------------------------------------------------
    //
    // avatar.glb is ONE baked mesh: there is no skeleton, no clip, and no
    // "left arm" node to look up. tools/blender-models.py is owned by another
    // builder, so the limbs are found the same way rotor.js finds fan blades --
    // by MEASURING the mesh. Connected components are classified by where their
    // centroid sits inside the model's own bounding box, and the three fractions
    // below are the only thresholds involved. They are fractions, not metres, so
    // the rule survives the model being re-authored at another size.
    //
    // Measured against the shipped avatar (34 components, 2596 tris, height
    // 1.8828 m; numbers below are model-local metres from the feet):
    //   arms  |x| 0.235 .. 0.272   legs |x| 0.108 .. 0.114
    //   vest straps |x| 0.155      eyes |x| 0.068
    //   pelvis y 0.900             hip ball y 0.855
    //   chest y 1.360              neck y 1.540
    // partLateralFrac * halfWidth(0.332) = 0.199 separates the arms (0.235) from
    // the vest straps (0.155) with 18% of margin on the tighter side.
    // partHipFrac * height = 0.866 separates the pelvis (0.900) from the hip
    // ball (0.855). partHeadFrac * height = 1.487 separates the neck (1.540)
    // from the chest (1.360).
    // The split is VALIDATED after the fact (both arms and both legs must come
    // out as mirror pairs with equal triangle counts, and no triangle may be
    // lost); if it fails the avatar falls back to the old single rigid mesh
    // rather than drawing a person with one arm.
    partLateralFrac: 0.6,
    partHipFrac: 0.46,
    partHeadFrac: 0.79,

    // --- walk ------------------------------------------------------------
    //
    // The gait phase is advanced by MEASURED horizontal speed, differentiated
    // from the same interpolated pose the body is drawn at -- never by a
    // free-running clock. A clock-driven walk keeps striding while the player
    // stands still, which is the one tell that reads as "this is a puppet".
    // Standing still therefore settles to the rest pose on its own, because the
    // amplitude it is multiplied by decays to zero.
    strideMetres: 1.70,     // metres of ground per full two-step cycle
    walkRefSpeed: 5.2,      // player.walkSpeed: the speed the swing is full at
    speedTau: 0.10,         // s, smoothing on the differentiated speed
    ampTau: 0.09,           // s, smoothing on the swing amplitude
    minWalkSpeed: 0.12,     // below this the phase stops advancing entirely
    legSwing: 0.62,         // rad at full amplitude
    armSwing: 0.42,         // rad, counter-swung against the legs
    armRest: 0.05,          // rad the arms hang out from the body at rest
    bobAmount: 0.045,       // m the torso rises and falls, twice per cycle
    leanAmount: 0.12,       // rad the torso pitches into a full-speed walk

    // --- jump / fall -----------------------------------------------------
    //
    // The roster carries no "grounded" flag, so airborne is DERIVED from the
    // vertical speed of the interpolated pose. player.jumpSpeed is 7.5 m/s and
    // the intro cutscene's wave bob peaks near 1.0 m/s, so 2.0 sits clear of
    // both. airTau holds the pose through the apex, where vertical speed passes
    // through zero and a raw test would blink.
    airborneSpeed: 2.0,
    airTau: 0.16,
    airLegFront: 0.70,      // rad, leading leg tucked up
    airLegBack: -0.40,      // rad, trailing leg swept back
    airArmLift: 1.05,       // rad the arms come up

    // --- carrying and tools ----------------------------------------------
    //
    // heldGripFrac is where up its own height the hand grips the model: a broom
    // is held near the top of the handle, not through its middle. Held items are
    // drawn at their AUTHORED size (heldScale 1), unlike the first-person copy
    // in src/render/hand.js which is shrunk because it sits 60 cm from the eye.
    heldGripFrac: 0.72,
    heldScale: 1.0,
    heldOffsetX: 0.0,
    heldOffsetY: -0.02,
    heldOffsetZ: 0.0,
    // MEASURED on a render, not guessed: the arm itself is already pitched
    // heldArmPitch (0.85 rad) forward, so the item's own pitch is a correction
    // on top of that. -15 deg puts a broom's head on the floor in front of the
    // avatar and leaves a horn or a bucket held sensibly upright.
    heldPitchDeg: -15,
    heldYawDeg: 0,
    heldRollDeg: 0,
    heldArmPitch: 0.85,     // rad the carrying arm holds forward
    heldArmRoll: 0.18,
    // A duck picked up off the floor is a world body already drawn by the duck
    // renderer; what the avatar owes it is a carry POSE, not a second duck.
    carryArmPitch: 1.20,
    carryArmRoll: 0.30,
    // Tool use. A sweep is a genuinely free-running action for as long as the
    // button is held, so unlike the walk it IS clocked.
    sweepSeconds: 0.55,
    sweepArmPitch: 0.95,
    sweepArmYaw: 0.80,
    beamArmPitch: 1.30,
    scoopArmPitch: 1.45,
    // The wave the intro asked for: the arm goes up and out and swings from the
    // shoulder. setGesture(id, 'wave', phase01) drives it.
    waveArmRoll: 2.15,
    waveArmSwing: 0.40,
    waveArmPitch: 0.20,
  },

  summary: {
    // The end-of-session screen. Same numbers for everyone; nobody sees a
    // different total from the person next to them.
    maxBuiltRows: 8,
  },

  // --- G5: sound -------------------------------------------------------------
  //
  // The per-clip gains are NOT here. They live in assets/audio/mix.json, set by
  // ear clip by clip, and are read at boot: a number in this file would be a
  // second opinion about the same thing. What lives here is everything that is
  // a decision about the SYSTEM -- how many voices may sound at once, how far a
  // sound carries, how fast a loop fades -- and every one of those is a
  // registered key, so deleting one is fatal at boot rather than silent.
  audio: {
    // 0 disables the whole layer before a single byte is fetched. The game is
    // unchanged; it is simply silent.
    enabled: 1,
    basePath: './assets/audio/',
    mixPath: './assets/audio/mix.json',
    // Every external load gets a timeout. A hanging CDN or a missing file costs
    // that one clip and nothing else.
    fetchTimeoutMs: 7000,
    // Clips are fetched in waves so forty parallel requests do not compete with
    // the models the player is waiting to see.
    concurrency: 6,
    // The bus output. Jurek's mix.json numbers already sit under 1, so this is
    // headroom against summing, not a second volume knob to reach for.
    masterGain: 0.9,
    // A clip with no line in mix.json. Nothing shipped uses it any more --
    // broom was the last one and got an explicit line when the bank was
    // re-rendered, because "whatever the default happens to be" is not a
    // decision anybody made about a specific sound.
    defaultClipGain: 0.4,
    // Where the loop points live. Every looping clip now ships with 0.15 s of
    // its own tail wrapped onto the front and 0.15 s of its head onto the back,
    // and this file says which slice of the buffer is the actual period. The
    // seam therefore sits INSIDE the buffer, where no mp3 decoder can move it;
    // see src/audio/bus.js. Missing or unreadable, every loop falls back to
    // looping the whole buffer, which is what it did before.
    loopsPath: './assets/audio/loops.json',
    // Voice limiting. 300 ducks landing in the same frame must not be 300
    // simultaneous squeaks -- both because it clips and because it is a wall of
    // noise where the sound should be a texture.
    maxVoices: 24,
    maxVoicesPerClip: 4,
    minRetriggerMs: 45,
    // Distance attenuation, computed here rather than through PannerNodes: the
    // game is first-person, mono placement reads fine at this scale, and one
    // multiply is cheaper than a spatialiser per voice.
    refDistance: 3,
    rolloff: 1.1,
    maxDistance: 45,
    // Below this a voice is not started at all.
    minAudibleGain: 0.004,
    // The played-clip log, for verification. It is a ring buffer: it can never
    // grow without bound during a long session.
    logMax: 400,

    // --- the room ------------------------------------------------------------
    // The plate is 35 m of bare concrete with a hole in the middle and the game
    // had NO reverb of any kind: every sound arrived dry, which is the acoustic
    // of an anechoic chamber and not of a warehouse. A machine at the far wall
    // and a machine at your elbow differed only in level.
    //
    // One ConvolverNode, fed by a per-voice send whose gain rises with distance,
    // so near sounds stay dry and far ones arrive mostly as room. The impulse
    // response is GENERATED (src/audio/bus.js buildImpulse) rather than shipped:
    // an IR file would be another download and another licence to account for,
    // and a concrete box is early reflections plus an exponentially decaying
    // noise tail, which is a few lines of arithmetic.
    reverb: {
      enabled: 1,
      // RT60 for the tail. Bare concrete, ~35 x ~35 m, no absorption to speak
      // of: long. Under a second would read as a small tiled room.
      seconds: 2.1,
      // Air and surfaces eat the top end faster than the bottom, so the tail
      // gets progressively duller. 1 is no damping; lower is darker sooner.
      damping: 0.34,
      // Time before the first reflection comes back, in seconds -- the distance
      // to the nearest wall over the speed of sound. 17 m at 343 m/s is 50 ms
      // there and back; the plate's centre is about that far from the edge.
      preDelaySeconds: 0.05,
      // Discrete early reflections laid in front of the tail: [time, gain].
      // These are what make a room read as BIG rather than merely as wet.
      earlyTaps: [[0.011, 0.7], [0.019, -0.52], [0.029, 0.44], [0.043, -0.33], [0.062, 0.24]],
      // Left and right get different noise, which is the whole of the stereo
      // width -- a mono IR through a stereo convolver is a wider mono.
      stereo: 1,
      // How much of the reverb return reaches the sfx bus, before any send.
      wetGain: 0.5,
      // The send curve. At or inside `dryMeters` a voice sends nothing; at or
      // past `wetMeters` it sends `sendMax`. Between, linear in distance.
      // dryMeters matches audio.refDistance -- inside the reference distance a
      // sound is at your hands and a room around it would be wrong.
      dryMeters: 3,
      wetMeters: 26,
      sendMax: 0.85,
      // A sound with no world position -- a menu click, a purchase -- is not in
      // the room at all and sends nothing.
      sendUnpositioned: 0,
    },

    // --- ducking -------------------------------------------------------------
    // The pit payoff is the sound the whole game points at, and it was competing
    // with its own factory: every machine, fan, conveyor and cart loop runs on
    // the loop bus underneath it. This dips that bus for the length of the
    // payoff so the run comes through the hum instead of over it.
    //
    // It is a node of its own after loopBus, NOT the loop bus's own gain, so it
    // cannot fight the player's ambience slider: the slider owns loopBus.gain
    // and the duck owns the node after it, and neither ever writes the other's
    // value.
    duck: {
      enabled: 1,
      // How far down, in dB. 6 is clearly audible without the bed disappearing;
      // a bed that vanishes and comes back reads as a dropout.
      depthDb: -6,
      attackSeconds: 0.04,
      // Held for about as long as a pit run lasts before it starts recovering.
      holdSeconds: 0.35,
      releaseSeconds: 0.55,
    },

    // --- variation -----------------------------------------------------------
    // The reward for automating well used to be a LOUDER MACHINE GUN. At 300
    // ducks the game plays roughly 22 byte-identical copies of one 0.5 s squeak
    // per second, and one footstep sample carries a whole session -- 2.7 plays a
    // second walking, 5.8 sprinting, tens of thousands of identical starts.
    // Identical repeats are the single most fatiguing thing a game can do to an
    // ear, and no amount of mixing fixes it: the ear locks onto the repetition
    // itself.
    //
    // The fix is per-play variation on playbackRate and gain, spread by a
    // BUCKET DECK rather than by bare Math.random(): the range is cut into
    // `buckets` slices, the slices are shuffled and dealt out, and the deck
    // refuses to open with the slice it just closed on. Plain random clusters --
    // three near-identical rates in a row is a normal outcome and sounds exactly
    // like the bug -- where a dealt deck guarantees the whole range is walked
    // before any slice repeats. It is round-robin without needing round-robin
    // FILES, which is what a project with no budget for forty more samples can
    // actually have.
    variation: {
      buckets: 7,
      // Applied to any clip with no line in `clips` below.
      defaultRate: 0.07,
      defaultGain: 0.12,
      // Hard bounds, so a bad number in the table can never turn a squeak into
      // a chipmunk or stop a clip dead.
      maxRate: 0.45,
      maxGain: 0.6,
      // Loops are excluded on purpose and this is not laziness: a loop is one
      // voice per TYPE held open for minutes, and re-pitching it on restart
      // reads as the fan changing speed for no reason. Their level already
      // moves continuously with distance and count.
      loopRate: 0,
      loopGain: 0,
      // Per clip: [rate, gain] as +/- fractions. The numbers are decided by how
      // often the clip fires and by whether its pitch carries meaning.
      //
      // WIDE -- fires constantly, pitch is texture:
      //   footstep, duck_squeak, duck_impact, crank_click, machine_eject.
      // NARROW -- fires often but is a UI answer, and a UI answer that changes
      //   pitch reads as a different answer: ui_click, ui_hover, tab_switch.
      // ZERO -- a written musical phrase. Detuning it is just wrong:
      //   achievement, prestige, session_end, buy_ok, duck_rare.
      clips: {
        footstep: [0.17, 0.22],
        duck_squeak: [0.19, 0.17],
        duck_impact: [0.15, 0.2],
        crank_click: [0.13, 0.16],
        machine_eject: [0.12, 0.14],
        machine_jam: [0.09, 0.12],
        grab: [0.11, 0.14],
        throw: [0.13, 0.15],
        broom: [0.12, 0.16],
        jump_land: [0.09, 0.13],
        box_spill: [0.08, 0.1],
        tube_drop: [0.07, 0.1],
        build_place: [0.07, 0.1],
        build_demolish: [0.07, 0.1],
        build_rotate: [0.1, 0.12],
        build_invalid: [0.05, 0.07],
        buy_fail: [0.05, 0.07],
        cash: [0.05, 0.09],
        pit_burp: [0.09, 0.12],
        ui_click: [0.035, 0.07],
        ui_hover: [0.05, 0.09],
        tab_switch: [0.03, 0.06],
        shop_open: [0.03, 0.05],
        shop_close: [0.03, 0.05],
        achievement: [0, 0.03],
        prestige: [0, 0.03],
        session_end: [0, 0.03],
        buy_ok: [0, 0.05],
        duck_rare: [0, 0.05],
        player_join: [0, 0.05],
        player_fall: [0.04, 0.06],
      },
    },

    // --- stereo --------------------------------------------------------------
    // Everything was mono. The game is first person in a 35 m room whose two
    // landmarks -- the workbench and the pit -- are at opposite ends of the walk
    // the whole design is about, and none of that reached the ears. This pans a
    // one-shot by its AZIMUTH relative to where the player is looking, using the
    // yaw the camera already has; it is one StereoPannerNode per one-shot voice
    // and no HRTF, which at this scale reads correctly and costs nothing.
    pan: {
      enabled: 1,
      // Full hard-left/right would put a duck at 90 degrees entirely in one ear,
      // which on headphones is uncomfortable and on speakers is a mistake.
      width: 0.75,
      // Inside this radius a sound collapses to the centre: something at your
      // feet has no meaningful direction and swings wildly as you turn.
      nearMeters: 2.2,
      // Loops keep their existing behaviour -- summed per type, no position.
      loops: 0,
    },

    // --- master chain --------------------------------------------------------
    // 24 voices summing into 0.9 of headroom with nothing catching the peaks.
    // A crate landing in the pit while a machine jams and the shop is open is
    // exactly the moment the game is loudest and exactly the moment it clipped.
    // A compressor with a fast attack and a high ratio is a limiter; it sits
    // after the master gain and before the destination, so every bus, the pit
    // synth and the cutscene all pass through it.
    master: {
      limiterEnabled: 1,
      thresholdDb: -6,
      kneeDb: 3,
      ratio: 12,
      attackSeconds: 0.003,
      releaseSeconds: 0.18,
      // Makeup for what the limiter takes off, so turning it on does not just
      // make the game quieter.
      makeup: 1.15,
    },

    // A stream of ducks paid out one at a time fired a 1.33 s cash register per
    // duck with no cooldown: overlapping tills, four deep, which is the sound of
    // the mix falling over rather than the sound of getting rich. The register
    // now rings at most this often and the deltas in between are summed into the
    // next ring, so the money still reads -- it just reads as one till.
    cashMinSeconds: 0.55,

    loops: {
      // Machines fade in when they start and out when they stop. The numbers
      // are deliberately slow: a loop that snaps on reads as a click.
      fadeInSeconds: 0.7,
      fadeOutSeconds: 1.0,
      // Summed per TYPE, never per instance. Sixteen presses are ONE press
      // voice at count^exponent gain, capped -- sixteen copies of one sample
      // would phase-cancel into a flanged mess and cost sixteen voices.
      countExponent: 0.5,
      maxCountScale: 2.2,
      // How often the placed lists are re-polled, in frames. Machines do not
      // appear sixty times a second.
      pollFrames: 10,
      // A container prop moving faster than this is a cart being pushed.
      cartSpeed: 0.7,
    },

    steps: {
      // Footsteps are timed off distance actually travelled, not off a timer:
      // walking backwards into a wall must not sound like walking.
      strideMeters: 1.95,
      minSpeed: 0.7,
      sprintStrideScale: 0.78,
      // A landing already plays jump_land; a footstep in the same instant is
      // mud.
      landingSilenceMs: 160,
    },

    pit: {
      // The pit swallows ducks quietly and burps when it has had a few.
      burpEveryDucks: 12,
      burpMinSeconds: 9,

      // The payoff sound itself, SYNTHESIZED -- see src/audio/pitsynth.js. There
      // is no duck_pit.mp3 in CLIPS any more: a sample cannot climb, and the
      // whole point of this sound is that duck number twelve is higher than duck
      // number one, so emptying a full crate into the pit is a rising run.
      //
      // Every number here is a slider in work/pit-lab.html, labelled in Polish,
      // and that page imports this file -- so what Jurek tunes there is exactly
      // what these defaults mean here.
      synth: {
        // Where the run starts, and how far each duck moves it. 1 semitone per
        // duck, quantized to a major pentatonic, so a dump is a tune rather than
        // a siren.
        baseHz: 191,
        semitonesPerDuck: 2.5,
        // Two octaves and then it stops climbing: past that it is a whistle, and
        // a run of 300 ducks would be inaudible at the top.
        ceilingSemitones: 31,
        quantize: 1,
        // The run holds for a couple of seconds after the last duck, then slides
        // back down at three ducks a second -- so a pause resets the tune and
        // the next crate starts low again.
        holdSeconds: 3.5,
        decayPerSecond: 0.1,
        // A crate spills a dozen ducks in ONE frame. The notes are laid out in
        // time instead of stacking into a chord, and the queue is bounded so a
        // dump cannot leave notes playing after the player has walked off.
        spacingSeconds: 0.055,
        maxAheadSeconds: 1,
        // The note: a fast plink with a short bend.
        attackSeconds: 0.035,
        decaySeconds: 0.26,
        glideSemitones: 0.6,
        glideSeconds: 0.05,
        level: 1,
        // High notes read louder at the same amplitude; this bends the level
        // back down as the run climbs.
        highTrim: 0.35,
        // The layers under the tone: an octave-up shine, an octave-down thump,
        // and a noise tick for the contact.
        harmonicRatio: 1.41,
        harmonicGain: 0.32,
        detuneCents: 6,
        subGain: 0.22,
        clickGain: 0.16,
        clickSeconds: 0.03,
        // Lowpass tracking the note, so the top of a run does not get harsh.
        cutoffMul: 6,
        cutoffMinHz: 900,
        cutoffMaxHz: 12000,
        resonance: 3.7,
        // Its own voice cap, separate from the sample limiter: these are
        // oscillators, and 300 of them at once is a fan, not a payoff. It is
        // enforced by widening the gap between notes rather than by dropping
        // them, so the end of a big dump is never the part that goes missing.
        maxVoices: 12,
        // The two knobs that are not numbers, so not registered keys below:
        // the oscillator shapes.
        waveform: 'square',
        shineWave: 'sine',
      },
    },

    impact: {
      // A rubber duck squeaks when something presses it, so CONTACT is what
      // makes the sound -- not arriving in the world. Jurek: "dzwiek kaczuszki
      // powinien byc za kazdym razem jak spadnie/dotknie czegos".
      //
      // 0.9, not 3.2. At 3.2 a duck had to be thrown or dropped from height to
      // be heard at all; every ordinary landing, roll and nudge was silent,
      // which is exactly the opposite of a squeaky toy.
      minSpeed: 0.9,
      // A hard slam gets the heavier thud layered under the squeak. Keeping the
      // two apart is also what stops `duck_impact` becoming an orphan file,
      // which gate F-D forbids.
      hardSpeed: 4.5,
      // Per FRAME across all ducks. The voice limiter caps concurrency anyway;
      // this stops 300 ducks landing together from queueing 300 requests.
      maxPerFrame: 6,
      // Per DUCK. Without it a duck settling on concrete jitters just above the
      // threshold and squeaks continuously -- the failure mode a low threshold
      // buys you if nothing else changes.
      perDuckSeconds: 0.22,
    },

    // Tier index at or above which a scored duck is worth its own fanfare.
    rareTier: 4,
    // Broom sweeps are continuous; the sample is not.
    sweepIntervalSeconds: 0.42,
    // The scoop and the beam had no sound at all: the event reached the audio
    // layer, fell through the mode switch and hit nothing. Both are throttled
    // like the broom because both fire every substep the button is held.
    scoopIntervalSeconds: 0.3,
    beamIntervalSeconds: 0.5,
    // A duck vanishing into a crate. Quiet on purpose -- a collector running
    // flat out absorbs several a second and this must stay a texture.
    absorbGain: 0.45,
    absorbMinSeconds: 0.12,

    // --- the gambling box ----------------------------------------------------
    // The most theatrical object in the game was SILENT: it shakes, it hops, it
    // cycles hue, the lid flies, a prize comes out, and none of it made a sound.
    // Nothing here is a sample -- these are oscillators in src/audio/gamblesynth.js,
    // for the same reason the pit payoff is: a shake that has to last exactly as
    // long as config.gamble.shakeSeconds cannot be a fixed-length recording, and
    // a payout chime that says "you won something big" has to know what it paid.
    // THE PIT COMBO. Every duck that goes down plays one hit, and the pitch
    // climbs with the run. Jurek's numbers, straight across from the spec he
    // wrote them in.
    combo: {
      // 0 puts the synthesized rising note back. They are alternatives, never
      // both: two things climbing in pitch at once is mud, not twice the
      // payoff.
      enabled: 1,
      basePitch: 1.0,
      pitchIncrement: 0.02,
      maxPitch: 4.0,
      // A combo is a run without a gap. Nothing else ends it -- not a cheap
      // duck, not the wrong pit -- because what the pitch measures is whether
      // the ducks are still coming.
      // "After a moment" -- 1.6 s. Long enough that a belt feeding one duck a
      // second keeps its run, short enough that walking away and coming back
      // starts a new one.
      breakSeconds: 1.6,
      // Below this many hits the break sound is not played. A stinger after
      // two ducks is nagging.
      breakMinHits: 5,
      // THE STREAK BONUS. A rising pitch says the run is going; it does not say
      // the run was worth anything. Three milestones, each paying a multiple of
      // what the run has already earned, so the reward scales with the ducks
      // rather than being a flat tip -- twenty-five plain ones and twenty-five
      // good ones are not the same achievement.
      milestones: [25, 50, 100],
      milestonePay: [0.25, 0.5, 1.0],
    },

    // The tipper truck. Synthesized rather than sampled because AN ENGINE IS NOT
    // AN EVENT: its pitch is the speedometer, and the speed is a number that
    // changes sixty times a second. See src/audio/trucksynth.js.
    truck: {
      idleHz: 42,
      revHz: 96,
      engineGain: 0.16,
      subGain: 0.12,
      // How fast the heard note chases the real speed. This is the flywheel: a
      // truck whose note snapped to its speed would chirp over every kerb.
      revLerpPerSecond: 3.5,
      gateHz: 320,
      gateGain: 0.5,
      gateDecaySeconds: 0.32,
      // The ram sounds only while the bed is MOVING, and its pitch says which
      // way -- which is how the player hears that Q/Z is a lever, not a button.
      ramHz: 180,
      ramHzEnd: 300,
      ramGain: 0.18,
      dumpGain: 0.5,
      dumpDecaySeconds: 0.7,
      maxVoices: 8,
    },

    gamble: {
      // The shake: a rattle of short wooden ticks that accelerates towards the
      // lid, so the box sounds like it is winding up rather than idling.
      rattleHz: 9,
      rattleHzEnd: 26,
      rattleGain: 0.5,
      rattleHzStart: 900,
      rattleHzSpread: 700,
      rattleDecaySeconds: 0.035,
      // The lid: a pop, then an arpeggio up. Bigger prizes get more notes and
      // start higher, which is the only place in the game where the sound tells
      // you the SIZE of what you won.
      popHz: 150,
      popGain: 0.9,
      chimeBaseHz: 523.25,
      chimeNotes: 4,
      chimeMaxNotes: 7,
      chimeSpacingSeconds: 0.085,
      chimeGain: 0.42,
      chimeDecaySeconds: 0.5,
      // The settle: one low thump as the lid comes back down.
      doneHz: 110,
      doneGain: 0.4,
      doneDecaySeconds: 0.2,
      // Its own voice ceiling, like the pit synth's. 20, not 10: a big payout is
      // a pop, a tick and seven chime notes, and two boxes opening within half a
      // second of each other put the second one's arpeggio entirely over the
      // cap. Measured at 10: two opens, 18 notes refused, which threw away
      // exactly the part that pays off.
      maxVoices: 20,
    },
  },

  debug: {
    // OFF in a shipped build. The fps/frame/phys/calls panel is a development
    // instrument, and it sat in the top-left of the live site looking like a
    // bug -- which, to anybody who did not build the game, it is. F3 still
    // brings it back for whoever wants it.
    overlayVisible: false,
    toggleKey: 'F3',
  },
};

// Keys the simulation and the renderer read. Kept as one authoritative list so a
// deleted or renamed key fails loudly at boot instead of falling back silently.
export const REQUIRED_CONFIG_KEYS = [
  'world.gravity.y',
  'vehicle.spawnCost',
  'vehicle.maxPerSpawner',
  'vehicle.topSpeed',
  'vehicle.reverseSpeed',
  'vehicle.accel',
  'vehicle.brakeAccel',
  'vehicle.steerRate',
  'vehicle.steerFullSpeed',
  'vehicle.gripLoss',
  'vehicle.linearDamping',
  'vehicle.angularDamping',
  'vehicle.density',
  'vehicle.friction',
  'vehicle.restitution',
  'vehicle.yawPredictFrac',
  'vehicle.tipMaxDegrees',
  'vehicle.tipRate',
  'vehicle.gateMaxDegrees',
  'vehicle.gateRate',
  'vehicle.camDistance',
  'vehicle.camHeight',
  'vehicle.enterRange',
  'vehicle.rideMarginXZ',
  'vehicle.rideMarginDown',
  'vehicle.rideMarginUp',
  'gamble.shakeSeconds',
  'gamble.openSeconds',
  'gamble.settleSeconds',
  'gamble.hopHeight',
  'gamble.hopHz',
  'gamble.hopRampPower',
  'gamble.flashHzStart',
  'gamble.flashHzEnd',
  'gamble.cooldownSeconds',
  'pit2.enabled',
  'pit2.radius',
  'pit2.distance',
  'pit2.plateHoleHalf',
  'pit2.payMul',
  'contracts.enabled',
  'contracts.firstDelaySeconds',
  'contracts.gapSeconds',
  'contracts.gapJitterSeconds',
  'contracts.secondsPerDuck',
  'contracts.minSeconds',
  'contracts.maxSeconds',
  'contracts.countMin',
  'contracts.countMax',
  'contracts.payPerDuck',
  'contracts.bonusMul',
  'contracts.leaveSeconds',
  'processors.sortPush',
  'processors.sortLift',
  'processors.sortMaxSpeed',
  'processors.sortHeight',
  'processors.refineSeconds',
  'processors.refineMouthClear',
  'processors.refineEjectSpeed',
  'processors.pipeExitSpeed',
  'worldclock.dayLengthSeconds',
  'worldclock.startFraction',
  'worldclock.nightFloor',
  'worldclock.weatherMinSeconds',
  'worldclock.weatherMaxSeconds',
  'worldclock.eventFirstSeconds',
  'worldclock.eventGapSeconds',
  'worldclock.eventJitterSeconds',
  'route.pieceLength',
  'route.pieceCost',
  'route.slopeRise',
  'route.maxPieces',
  'gamble.rollCost',
  'gamble.boxPrice',
  'gamble.prizePower',
  'gamble.duckPrizeMin',
  'gamble.duckPrizeMax',
  'gamble.lidOpenDegrees',
  'gamble.useRange',
  'gamble.duckSpawnHeight',
  'gamble.duckSpawnSpread',
  'gamble.seed',
  'world.plateSize',
  'world.plateThickness',
  'world.plateFriction',
  'world.floorTileMeters',
  'world.floorTextureSize',
  'world.floorPhotoStrength',
  'world.floorNormalStrength',
  'world.floorTextureSeed',
  'world.floorBlotches',
  'world.floorCracks',
  'world.floorGrain',
  'world.shadowsEnabled',
  'world.shadowMapSize',
  'world.shadowRadius',
  'world.shadowDistance',
  'world.shadowBias',
  'world.shadowNormalBias',
  'world.plateColor',
  'world.markingColor',
  // The look of the horizon. These are load-bearing for the opening composition,
  // so a typo in one has to be fatal at boot rather than silently flattening the
  // shot that states the game's premise.
  'world.skyColor',
  'world.horizonColor',
  'world.skyGlowColor',
  'world.skyGlowCenter',
  'world.skyGlowWidth',
  'world.hemiSkyColor',
  'world.hemiGroundColor',
  'world.horizon.enabled',
  'world.horizon.radius',
  'world.horizon.segments',
  'world.horizon.minHeight',
  'world.horizon.maxHeight',
  'world.horizon.fill',
  'world.horizon.color',
  'world.horizon.seed',
  'world.benchLamps.enabled',
  'world.benchLamps.offsetX',
  'world.benchLamps.offsetZ',
  'world.benchLamps.scale',
  'render.clearColor',
  'render.fogColor',
  'render.fogDensity',
  'loop.fixedDt',
  'loop.maxSubsteps',
  'loop.maxFrameDt',
  'loop.maxLoggedErrors',
  'player.spawn.x',
  'player.spawn.y',
  'player.spawn.z',
  'player.eyeHeight',
  'player.walkSpeed',
  'player.sprintMultiplier',
  'player.jumpSpeed',
  'player.radius',
  'player.height',
  'render.bufferWidth',
  'render.bufferWidthMin',
  'render.bufferWidthMax',
  'render.grainFrames',
  'render.grainStrength',
  'render.grainOpacity',
  'render.grainAmount',
  'render.floorAnisotropy',
  'render.vignetteAmount',
  'render.vignetteInner',
  'render.vignetteOuter',
  'render.fanSpin.turnsPerSecond',
  'render.fanSpin.referenceForce',
  'render.fanSpin.forceExponent',
  'render.fanSpin.maxTurnsPerSecond',
  'render.airflow.color',
  'render.airflow.wind.speed',
  'render.airflow.wind.strength',
  'render.airflow.wind.trails',
  'render.airflow.wind.width',
  'render.airflow.wind.length',
  'render.airflow.wind.randomness',
  'render.airflow.wind.spawnRate',
  'render.airflow.opacity',
  'render.airflow.brightness',
  'render.airflow.skinShell',
  'render.airflow.coreShell',
  'render.airflow.segments',
  'render.airflow.stations',
  'render.airflow.bands',
  'render.airflow.scrollPerSecond',
  'render.airflow.bandDuty',
  'render.airflow.bandSharpness',
  'render.airflow.instanceCapacity',
  'render.hint.opacity',
  'render.hint.coneSegments',
  'render.hint.coneRings',
  'render.hint.coneSpokes',
  'render.hint.footprintSamples',
  'render.hint.footprintRibs',
  'render.hint.footprintTick',
  'render.hint.footprintLift',
  'render.hint.pathSamples',
  'render.hint.chevrons',
  'render.hint.chevronSize',
  'render.hint.pathLift',
  'render.hint.circleSegments',
  'render.hint.circleLift',
  'render.contact.enabled',
  'render.contact.opacity',
  'render.contact.spread',
  'render.contact.lift',
  'render.contact.polygonOffsetFactor',
  'render.contact.polygonOffsetUnits',
  'render.contact.textureSize',
  'render.contact.core',
  'render.contact.capacity',
  'perf.maxSampleMs',
  'perf.visibilityGraceMs',
  'perf.sampleWindowMs',
  'perf.bufferWidthStep',
  'perf.downMs',
  'perf.upMs',
  'perf.cooldownMs',
  'ducks.max',
  'ducks.halfExtentX',
  'ducks.halfExtentY',
  'ducks.halfExtentZ',
  'ducks.headHalfX',
  'ducks.headHalfY',
  'ducks.headHalfZ',
  'ducks.headOffsetX',
  'ducks.headOffsetY',
  'ducks.mass',
  'ducks.restitution',
  'ducks.friction',
  'ducks.linearDamping',
  'ducks.angularDamping',
  'ducks.sleepAfter',
  'ducks.sleepLinearEps',
  'ducks.sleepAngularEps',
  'ducks.parkY',
  'ducks.useConvexHull',
  'rarity.multipliers.0',
  'rarity.multipliers.1',
  'rarity.multipliers.2',
  'rarity.multipliers.3',
  'rarity.multipliers.4',
  'rarity.multipliers.5',
  'rarity.multipliers.6',
  'rarity.multipliers.7',
  'rarity.multipliers.8',
  'rarity.multipliers.9',
  'rarity.multipliers.10',
  'rarity.multipliers.11',
  'rarity.multipliers.12',
  'rarity.multipliers.13',
  'rarity.multipliers.14',
  'rarity.multipliers.15',
  'rarity.multipliers.16',
  'rarity.multipliers.17',
  'rarity.multipliers.18',
  'rarity.multipliers.19',
  'rarity.multipliers.20',
  'rarity.multipliers.21',
  'rarity.multipliers.22',
  'rarity.multipliers.23',
  'rarity.multipliers.24',
  'rarity.weights.0',
  'rarity.weights.1',
  'rarity.weights.2',
  'rarity.weights.3',
  'rarity.weights.4',
  'rarity.weights.5',
  'rarity.weights.6',
  'economy.startMoney',
  'economy.duckBaseValue',
  'economy.duckValueMul',
  'prestige.threshold',
  'prestige.exponent',
  'prestige.minGain',
  'prestige.keep.production',
  'prestige.keep.transport',
  'prestige.keep.building',
  'prestige.keep.gear',
  'prestige.keep.upgrades',
  'prestige.keep.gamble',
  'pit.centerX',
  'pit.centerY',
  'pit.centerZ',
  'pit.radius',
  'pit.segments',
  'pit.wallThickness',
  'pit.wallFriction',
  'pit.wallRestitution',
  'pit.shaftDepth',
  'pit.scoreDepth',
  'pit.captureMargin',
  'pit.rimReach',
  'pit.plateHoleHalf',
  'pit.playerFallDepth',
  'pit.playerFallSeconds',
  'pit.respawnX',
  'pit.respawnY',
  'pit.respawnZ',
  'hold.kp',
  'hold.kdScale',
  'hold.maxSpeed',
  'hold.breakDistance',
  'hold.distanceDefault',
  'hold.distanceMin',
  'hold.distanceMax',
  'hold.distanceStep',
  'hold.grabRange',
  'hold.throwImpulse',
  'hold.heldLinearDamping',
  'hold.heldAngularDamping',
  'hold.ccdOnThrow',
  'hold.fallbackMass',
  'models.timeoutMs',
  'tube.x',
  'tube.y',
  'tube.z',
  'tube.yaw',
  'tube.scale',
  'tube.intervalSeconds',
  'tube.mouthX',
  'tube.mouthY',
  'tube.mouthZ',
  'tube.ejectX',
  'tube.ejectY',
  'tube.ejectZ',
  'tube.ejectSpeed',
  'tube.ejectSpread',
  'tube.spawnSeed',
  'tube.pitchX',
  'tube.mouthWorldY',
  'tube.fadeFloor',
  'tube.fadeStart',
  'tube.fadeEnd',
  'decals.y',
  'decals.textureSize',
  'decals.tilePadding',
  'decals.opacity',
  'decals.polygonOffsetFactor',
  'decals.polygonOffsetUnits',
  'decals.ringInner',
  'decals.ringOuter',
  'decals.ringSegments',
  'decals.arrowCount',
  'decals.arrowStartZ',
  'decals.arrowStepZ',
  'decals.arrowWidth',
  'decals.arrowLength',
  'decals.dropZoneSize',
  'machine.x',
  'machine.y',
  'machine.z',
  'machine.yaw',
  'machine.scale',
  'machine.clicksPerTurn',
  'machine.holdSecondsPerDuck',
  'machine.holdDrainRate',
  'machine.minHoldSeconds',
  'machine.momentumPerSecond',
  'machine.momentumMax',
  'machine.momentumDecayPerSecond',
  'machine.spinMomentumCoupling',
  'machine.botAttachRange',
  'machine.capRetrySeconds',
  'machine.spinMinRadPerSec',
  'machine.spinMaxRadPerSec',
  'machine.spinCurve',
  'machine.spinAccelPerSecond',
  'machine.spinDecelPerSecond',
  'machine.spinStopBelow',
  'machine.spinPopCoastSeconds',
  'machine.clickSoundMaxRadPerSec',
  'machine.clientSpinIdleMs',
  'machine.wheelLocalX',
  'machine.wheelLocalY',
  'machine.wheelLocalZ',
  'machine.wheelRadius',
  'machine.splitMinX',
  'machine.splitMinZ',
  'machine.splitRadius',
  'machine.hitRadiusScale',
  'machine.useRange',
  'machine.pipeLocalX',
  'machine.pipeLocalY',
  'machine.pipeLocalZ',
  'machine.ejectOffset',
  'machine.ejectSpeed',
  'machine.ejectDrop',
  'machine.colliderHalfX',
  'machine.colliderHalfY',
  'machine.colliderHalfZ',
  'machine.colliderLocalY',
  'machine.colliderLocalZ',
  'duckRender.scale',
  'duckRender.yaw',
  'duckRender.yOffset',
  'duckRender.tierScaleStep',
  'duckRender.topTierScale',
  'duckRender.topTierPulseHz',
  'duckRender.topTierPulseAmp',
  'pitRender.shaftRadius',
  'pitRender.shaftDepth',
  'pitRender.shaftSegments',
  'pitRender.fadeMeters',
  'pitRender.fadeExponent',
  'pitRender.topShade',
  'pitRender.ribContrast',
  'pitRender.ringEveryMeters',
  'pitRender.ringShade',
  'pitRender.showRim',
  'pitRender.rimScale',
  'pitRender.rimY',
  'tierColors.0',
  'tierColors.1',
  'tierColors.2',
  'tierColors.3',
  'tierColors.4',
  'tierColors.5',
  'tierColors.6',
  'hud.contractEndMs',
  'hud.contractUrgentSeconds',
  'hud.moneyPulseMs',
  'hud.capMessageMs',
  'hud.floatMs',
  'hud.tubeHintRadius',
  'hud.machineHintRadius',
  'shop.refundFraction',
  'shop.priceRounding',
  'shop.maxLevelDefault',
  'shop.curveDefault',
  // The shelf. Every one of these changes how often an item is simply not for
  // sale, so a missing key must be a boot error rather than a quiet default
  // that makes the vendor behave differently from the numbers that were
  // measured. tabBias needs all six tabs for the same reason prestige.keep
  // does: a tab with no entry would have its scarcity decided by accident.
  'shop.stockSeconds',
  'shop.rerollCost',
  'shop.stock.costWeight',
  'shop.stock.limitWeight',
  'shop.stock.zeroMax',
  'shop.stock.zeroShape',
  'shop.stock.unitsMax',
  'shop.stock.unitsShape',
  'shop.stock.tabBias.production',
  'shop.stock.tabBias.transport',
  'shop.stock.tabBias.building',
  'shop.stock.tabBias.gear',
  'shop.stock.tabBias.upgrades',
  'shop.stock.tabBias.gamble',
  'shop.hotbarSlots',
  'input.grabButton',
  'input.throwButton',
  'input.scrollSign',
  'input.lockCooldownMs',
  'input.lockFailuresBeforeFallback',
  'input.swallowRelockClick',
  'booth.x',
  'booth.y',
  'booth.z',
  'booth.yaw',
  'booth.scale',
  'booth.vendorLocalX',
  'booth.vendorLocalY',
  'booth.vendorLocalZ',
  'booth.vendorYaw',
  'booth.useRange',
  'booth.colliderHalfX',
  'booth.colliderHalfY',
  'booth.colliderHalfZ',
  'booth.colliderLocalY',
  'booth.colliderLocalZ',
  'booth.keepout',
  'booth.lampLocalX',
  'booth.lampLocalY',
  'booth.lampLocalZ',
  'build.grid',
  'build.yawStepDegrees',
  'build.fineStepDegrees',
  'build.maxDistance',
  'build.minDistance',
  'build.groundY',
  'build.pitMargin',
  'build.pitMarginBuild',
  'build.plateMargin',
  'build.overlapEpsilon',
  'build.demolishRange',
  'build.demolishHoldSeconds',
  'build.ghostOpacity',
  'build.ghostValidColor',
  'build.ghostInvalidColor',
  'build.instanceCapacity',
  'drop.belowMouth',
  'drop.spread',
  'drop.speed',
  'drop.density',
  'drop.friction',
  'drop.restitution',
  'drop.linearDamping',
  'drop.angularDamping',
  'drop.max',
  'drop.seed',
  'drop.perFrame',
  'drop.backlogNoticeSeconds',
  'hand.pickupRange',
  'hand.throwDistance',
  'hand.throwSpeed',
  'hand.throwLift',
  'hand.minSpawnY',
  'hand.modelX',
  'hand.modelY',
  'hand.modelZ',
  'hand.modelPitchDegrees',
  'hand.modelYawDegrees',
  'hand.modelRollDegrees',
  'hand.modelScale',
  'rarity.sets.w_basic.0',
  'rarity.sets.w_basic.6',
  'rarity.sets.w_good.0',
  'rarity.sets.w_good.6',
  'rarity.sets.w_rare.0',
  'rarity.sets.w_rare.6',
  'rarity.sets.w_elite.0',
  'rarity.sets.w_elite.6',
  'rarity.sets.w_creative.0',
  'rarity.sets.w_creative.6',
  'creative.enabled',
  'creative.price',
  'creative.stockUnits',
  'producers.mouthDepthFrac',
  'producers.mouthClear',
  'producers.mouthHeightFrac',
  'producers.ejectSpeed',
  'producers.ejectDrop',
  'producers.ejectSpread',
  'producers.spawnSeed',
  'producers.minSecondsPerDuck',
  'producers.maxSpawnsPerUpdate',
  'producers.rateMulMin',
  'producers.rateMulMax',
  'producers.jamSeconds',
  'producers.luckMin',
  'producers.luckMax',
  'collectors.intakeHeightFrac',
  'collectors.arriveRadius',
  'collectors.maxSpeed',
  'collectors.burstSeconds',
  'collectors.minRadius',
  'collectors.liftGravityFrac',
  'collectors.feedCooldownSeconds',
  'collectors.outletClear',
  'collectors.outletCos',
  'attention.beltMargin',
  'attention.pitMargin',
  'automation.cellSize',
  'automation.belt.grip',
  'automation.belt.maxAccel',
  'automation.belt.marginXZ',
  'automation.belt.surfaceBelow',
  'automation.belt.surfaceAbove',
  'automation.belt.liftScale',
  'automation.fan.airSpeed',
  'automation.fan.falloffExponent',
  'automation.fan.minDistance',
  'automation.fan.lift',
  'automation.fan.edgeSoftness',
  'automation.coverage.stepMeters',
  'automation.coverage.duckHeight',
  'automation.coverage.maxGap',
  'automation.chainTest.ducks',
  'automation.chainTest.seconds',
  'automation.chainTest.spawnSpan',
  'automation.chainTest.spawnHeight',
  'automation.chainTest.spawnRows',
  'automation.chainTest.spawnStagger',
  'containers.physicalLimit',
  'containers.maxConvertPerStep',
  'containers.tipAngleDegrees',
  'containers.tipHoldSeconds',
  'containers.captureShrink',
  'containers.mouthHeight',
  'containers.mouthMargin',
  'containers.spillSpeed',
  'containers.spillSpread',
  'containers.spillSeed',
  'containers.slotSpacing',
  'containers.slotSpacingMin',
  'containers.slotSpacingDecay',
  'containers.slotInset',
  'containers.slotKp',
  'containers.slotKdScale',
  'containers.slotMaxSpeed',
  'containers.slotRestEpsilon',
  'containers.massPerDuck',
  'containers.leakMinSpeed',
  'containers.leakMaxPerStep',
  'containers.leakClearance',
  'containers.leakDownBias',
  'containers.leakReentrySeconds',
  'tools.sweepLift',
  'tools.sweepFalloff',
  'tools.sweepMaxAccel',
  'tools.sweepBelow',
  'tools.sweepAbove',
  'tools.sweepMaxTargets',
  'tools.suckHoldDistance',
  'tools.suckKp',
  'tools.suckKdScale',
  'tools.suckMaxSpeed',
  'tools.hoseSpeedScale',
  'tools.scoopSpread',
  'tools.scoopBelow',
  'tools.scoopAbove',
  'tools.duckMassFallback',
  'net.sdkTimeoutMs',
  'net.authTimeoutMs',
  'net.retryCooldownMs',
  'net.signalTimeoutMs',
  'net.peerTimeoutMs',
  'net.heartbeatMs',
  'net.hostStateHz',
  'net.clientStateHz',
  'net.inputWindow',
  'net.inputBudgetMaxMs',
  'net.inputCatchUpFactor',
  'net.inputCoastMs',
  'net.inputCoastMoveMs',
  'net.rateWindowMs',
  'net.reconcileHardMeters',
  'net.protocolVersion',
  'net.positionStep',
  'net.positionBias',
  'net.quatBits',
  'net.maxBodiesPerFrame',
  'net.relevanceRadius',
  'net.degradedHostStateHz',
  'net.degradeAboveKBPerSecond',
  'net.recoverBelowKBPerSecond',
  'net.degradeHoldMs',
  'net.stateBackpressureBytes',
  'net.hostTickMs',
  'net.rafStaleMs',
  'net.pumpDebtCeilMs',
  'net.pumpChunksPerTick',
  'net.interpDelayMs',
  'net.interpHoldMs',
  'net.reconcileSoftFactor',
  'net.reconcileHistoryMs',
  'net.reconcileMatchMeters',
  'net.snapshotChunkChars',
  'net.joinTimeoutMs',
  'net.wireDuckBase',
  'net.wirePropBase',
  'net.wirePlayerBase',
  'net.settledBatchMax',
  'net.livenessIntervalMs',
  'net.livenessResyncCooldownMs',
  'net.livenessMaxResyncIds',
  'net.livenessCutsceneGraceMs',
  'net.reachSlack',
  'net.aimOriginSlack',
  'lobby.refreshMs',
  'lobby.maxRooms',
  'lobby.copyFeedbackMs',
  'lobby.maxNickChars',
  'settings.schema',
  'settings.masterVolume',
  'settings.sfxVolume',
  'settings.ambientVolume',
  'settings.volumeMin',
  'settings.volumeMax',
  'settings.volumeStep',
  'settings.mouseSensitivity',
  'settings.sensitivityMin',
  'settings.sensitivityMax',
  'settings.sensitivityStep',
  'settings.fov',
  'settings.fovMin',
  'settings.fovMax',
  'settings.fovStep',
  'settings.bufferWidth',
  'settings.bufferWidthStep',
  'cutscene.seconds',
  'cutscene.fetchTimeoutMs',
  'cutscene.musicGain',
  'cutscene.musicLeadSeconds',
  'cutscene.musicFadeSeconds',
  'cutscene.fadeSeconds',
  'cutscene.letterboxVh',
  'cutscene.skipHoldBars',
  'cutscene.minRemainingSeconds',
  'cutscene.cardFadeBars',
  'cutscene.cardHoldBars',
  'cutscene.settleMaxSeconds',
  'cutscene.settleStepsPerFrame',
  'cutscene.settleWallClockMs',
  'cutscene.overflowDucks',
  'cutscene.overflowX',
  'cutscene.overflowZ',
  'cutscene.overflowInnerRadius',
  'cutscene.overflowRingStep',
  'cutscene.overflowDropY',
  'cutscene.overflowStackStep',
  'cutscene.overflowCheckRadius',
  'cutscene.factoryX',
  'cutscene.factoryZ',
  'cutscene.factoryDucks',
  'cutscene.crewX',
  'cutscene.crewZ',
  'cutscene.crewRadius',
  'cutscene.crewDucks',
  'cutscene.crewWaver',
  'cutscene.chuteIntervalSeconds',
  'menu.flashMs',
  'avatars.max',
  'avatars.scale',
  'avatars.yOffset',
  'avatars.modelYaw',
  'avatars.bufferMs',
  'avatars.labelHeight',
  'avatars.labelMaxDistance',
  'avatars.labelMinOpacity',
  'avatars.hideRadius',
  'avatars.partLateralFrac',
  'avatars.partHipFrac',
  'avatars.partHeadFrac',
  'avatars.strideMetres',
  'avatars.walkRefSpeed',
  'avatars.speedTau',
  'avatars.ampTau',
  'avatars.minWalkSpeed',
  'avatars.legSwing',
  'avatars.armSwing',
  'avatars.armRest',
  'avatars.bobAmount',
  'avatars.leanAmount',
  'avatars.airborneSpeed',
  'avatars.airTau',
  'avatars.airLegFront',
  'avatars.airLegBack',
  'avatars.airArmLift',
  'avatars.heldGripFrac',
  'avatars.heldScale',
  'avatars.heldOffsetX',
  'avatars.heldOffsetY',
  'avatars.heldOffsetZ',
  'avatars.heldPitchDeg',
  'avatars.heldYawDeg',
  'avatars.heldRollDeg',
  'avatars.heldArmPitch',
  'avatars.heldArmRoll',
  'avatars.carryArmPitch',
  'avatars.carryArmRoll',
  'avatars.sweepSeconds',
  'avatars.sweepArmPitch',
  'avatars.sweepArmYaw',
  'avatars.beamArmPitch',
  'avatars.scoopArmPitch',
  'avatars.waveArmRoll',
  'avatars.waveArmSwing',
  'avatars.waveArmPitch',
  'summary.maxBuiltRows',
  'sky.dirX',
  'sky.dirY',
  'sky.dirZ',
  'sky.timeScale',
  'sky.holeDistance',
  'sky.holeSize',
  'sky.starCount',
  'sky.starRadius',
  'sky.starSize',
  'sky.starOpacity',
  'sky.starSeed',
  'sky.holeRenderOrder',
  'sky.starRenderOrder',
  'focus.range',
  'focus.duckRange',
  'focus.duckPickRadiusScale',
  'focus.outlineWidth',
  'focus.outlineColor',
  'focus.outlineOpacity',
  'focus.labelMaxDistance',
  'focus.labelMinOpacity',
  'focus.labelClearance',
  'focus.valueSizeMin',
  'focus.valueSizeMax',
  'focus.valueGlowFrom',
  'focus.stickyFrames',
  'audio.enabled',
  'audio.fetchTimeoutMs',
  'audio.concurrency',
  'audio.masterGain',
  'audio.defaultClipGain',
  'audio.maxVoices',
  'audio.maxVoicesPerClip',
  'audio.minRetriggerMs',
  'audio.refDistance',
  'audio.rolloff',
  'audio.maxDistance',
  'audio.minAudibleGain',
  'audio.logMax',
  // audio.loopsPath and audio.reverb.earlyTaps are deliberately NOT here:
  // assertConfig registers NUMERIC keys, and those two are a string and a list
  // of pairs. Listing them would fail the boot check on a correct config.
  'audio.reverb.enabled',
  'audio.reverb.seconds',
  'audio.reverb.damping',
  'audio.reverb.preDelaySeconds',
  'audio.reverb.stereo',
  'audio.reverb.wetGain',
  'audio.reverb.dryMeters',
  'audio.reverb.wetMeters',
  'audio.reverb.sendMax',
  'audio.reverb.sendUnpositioned',
  'audio.duck.enabled',
  'audio.duck.depthDb',
  'audio.duck.attackSeconds',
  'audio.duck.holdSeconds',
  'audio.duck.releaseSeconds',
  'audio.loops.fadeInSeconds',
  'audio.loops.fadeOutSeconds',
  'audio.loops.countExponent',
  'audio.loops.maxCountScale',
  'audio.loops.pollFrames',
  'audio.loops.cartSpeed',
  'audio.steps.strideMeters',
  'audio.steps.minSpeed',
  'audio.steps.sprintStrideScale',
  'audio.steps.landingSilenceMs',
  'audio.pit.burpEveryDucks',
  'audio.pit.burpMinSeconds',
  'audio.pit.synth.baseHz',
  'audio.pit.synth.semitonesPerDuck',
  'audio.pit.synth.ceilingSemitones',
  'audio.pit.synth.quantize',
  'audio.pit.synth.holdSeconds',
  'audio.pit.synth.decayPerSecond',
  'audio.pit.synth.spacingSeconds',
  'audio.pit.synth.maxAheadSeconds',
  'audio.pit.synth.attackSeconds',
  'audio.pit.synth.decaySeconds',
  'audio.pit.synth.glideSemitones',
  'audio.pit.synth.glideSeconds',
  'audio.pit.synth.level',
  'audio.pit.synth.highTrim',
  'audio.pit.synth.harmonicRatio',
  'audio.pit.synth.harmonicGain',
  'audio.pit.synth.detuneCents',
  'audio.pit.synth.subGain',
  'audio.pit.synth.clickGain',
  'audio.pit.synth.clickSeconds',
  'audio.pit.synth.cutoffMul',
  'audio.pit.synth.cutoffMinHz',
  'audio.pit.synth.cutoffMaxHz',
  'audio.pit.synth.resonance',
  'audio.pit.synth.maxVoices',
  'audio.impact.minSpeed',
  'audio.impact.hardSpeed',
  'audio.impact.perDuckSeconds',
  'audio.impact.maxPerFrame',
  'audio.rareTier',
  'audio.sweepIntervalSeconds',
  'audio.scoopIntervalSeconds',
  'audio.beamIntervalSeconds',
  'audio.absorbGain',
  'audio.absorbMinSeconds',
  'audio.cashMinSeconds',
  // Per-play variation. The per-clip table under audio.variation.clips is NOT
  // registered -- it is a map of pairs, not a fixed set of numeric keys, and a
  // clip missing from it correctly falls back to the defaults below. These are
  // the numbers that decide the SYSTEM, so they are fatal if deleted.
  'audio.variation.buckets',
  'audio.variation.defaultRate',
  'audio.variation.defaultGain',
  'audio.variation.maxRate',
  'audio.variation.maxGain',
  'audio.variation.loopRate',
  'audio.variation.loopGain',
  'audio.pan.enabled',
  'audio.pan.width',
  'audio.pan.nearMeters',
  'audio.pan.loops',
  'audio.master.limiterEnabled',
  'audio.master.thresholdDb',
  'audio.master.kneeDb',
  'audio.master.ratio',
  'audio.master.attackSeconds',
  'audio.master.releaseSeconds',
  'audio.master.makeup',
  'audio.combo.enabled',
  'audio.combo.basePitch',
  'audio.combo.pitchIncrement',
  'audio.combo.maxPitch',
  'audio.combo.breakSeconds',
  'audio.combo.breakMinHits',
  'audio.truck.idleHz',
  'audio.truck.revHz',
  'audio.truck.engineGain',
  'audio.truck.subGain',
  'audio.truck.revLerpPerSecond',
  'audio.truck.gateHz',
  'audio.truck.gateGain',
  'audio.truck.gateDecaySeconds',
  'audio.truck.ramHz',
  'audio.truck.ramHzEnd',
  'audio.truck.ramGain',
  'audio.truck.dumpGain',
  'audio.truck.dumpDecaySeconds',
  'audio.gamble.rattleHz',
  'audio.gamble.rattleHzEnd',
  'audio.gamble.rattleGain',
  'audio.gamble.rattleHzStart',
  'audio.gamble.rattleHzSpread',
  'audio.gamble.rattleDecaySeconds',
  'audio.gamble.popHz',
  'audio.gamble.popGain',
  'audio.gamble.chimeBaseHz',
  'audio.gamble.chimeNotes',
  'audio.gamble.chimeMaxNotes',
  'audio.gamble.chimeSpacingSeconds',
  'audio.gamble.chimeGain',
  'audio.gamble.chimeDecaySeconds',
  'audio.gamble.doneHz',
  'audio.gamble.doneGain',
  'audio.gamble.doneDecaySeconds',
  'audio.gamble.maxVoices',
];

export function readNumber(root, path) {
  let node = root;
  const parts = path.split('.');
  for (let i = 0; i < parts.length; i++) {
    if (node === null || typeof node !== 'object' || !(parts[i] in node)) return undefined;
    node = node[parts[i]];
  }
  return typeof node === 'number' && isFinite(node) ? node : undefined;
}

export function assertConfig(cfg, keys = REQUIRED_CONFIG_KEYS) {
  const missing = keys.filter((k) => readNumber(cfg, k) === undefined);
  if (missing.length) {
    throw new Error(
      'config.js is missing required numeric keys: ' + missing.join(', ') +
      '\nThe simulation depends on these; refusing to boot with silent defaults.'
    );
  }
  return true;
}

export default config;
