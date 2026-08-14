// All tunables for the Ducks harness. Nothing else may hardcode a number.
// assertConfig() is the boot-time contract: a missing key is fatal, never silent.

export const config = {
  version: '0.1.0',

  render: {
    bufferWidth: 480,
    bufferWidthMin: 320,
    bufferWidthMax: 640,
    fallbackAspect: 16 / 9,
    fov: 70,
    near: 0.1,
    far: 400,
    clearColor: 0x0a0f1e,
    fogColor: 0x0a0f1e,
    fogNear: 60,
    fogFar: 190,
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
    // world.floorGrain, the speckle baked into the concrete tile, and that one
    // is deliberately still 4 -- Jurek explicitly asked for the concrete to
    // keep its texture ("grain na betonie ma byc taki sam") after I turned both
    // down at once. Do not fold them back together.
    grainAmount: 0,
    grainOpacity: 0.07,
    grainFrames: 6,
    grainStrength: 34,
    floorAnisotropy: 16,
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

  world: {
    gravity: { x: 0, y: -22, z: 0 },
    plateSize: 120,
    plateThickness: 2,
    plateColor: 0x5b5f63,
    markingColor: 0xd8b520,
    skyColor: 0x0a0f1e,
    horizonColor: 0x2b3350,
    sunColor: 0xfff2dd,
    sunIntensity: 1.6,
    hemiIntensity: 0.55,
    sunDir: { x: 0.45, y: 1.0, z: 0.3 },
    floorTextureSize: 1024,
    floorTileMeters: 30,
    floorTextureSeed: 20260813,
    floorBlotches: 160,
    floorCracks: 26,
    // Baked speckle in the concrete tile. This is what actually reads as "grain"
    // on the floor -- it is the dominant noise on screen, so it stays gentle.
    floorGrain: 4,
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
    // MEASURED off assets/models/duck.glb at duckRender.scale 0.8, not guessed.
    // The model's long axis is +Z and duckRender.yaw turns it onto the collider's
    // X, so: X = length, Y = height, Z = width.
    //
    // Vertical profile of the mesh, in bands of 5 cm (length x width):
    //   0.00-0.10  narrow keel        0.06-0.08 x 0.06-0.11
    //   0.10-0.25  the BODY, widest   0.15-0.18 x 0.14
    //   0.25-0.39  head and neck      0.08-0.13 x 0.08-0.09
    // Two boxes, because that is what the shape actually is.
    halfExtentX: 0.089,
    halfExtentY: 0.13,
    halfExtentZ: 0.073,
    // Second collider for the head. headHalfY 0 disables it entirely.
    headHalfX: 0.0625,
    headHalfY: 0.063,
    headHalfZ: 0.046,
    // Offsets from the body collider's centre, which sits 0.13 above the duck's
    // underside. The head's centre is 0.323 up, hence +0.193.
    headOffsetX: 0.02,
    headOffsetY: 0.193,
    mass: 0.16,
    restitution: 0.35,
    friction: 0.6,
    linearDamping: 0.06,
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
    // 7 tiers. Weights sum to 8000, so the top tier is exactly 1 in 8000.
    multipliers: [1, 3, 10, 35, 100, 350, 1000],
    weights: [6800, 900, 220, 60, 15, 4, 1],
    // Named weight sets. A producer row names one of these in
    // produce.rarityWeights; an unknown name is fatal, never a silent fallback.
    // w_basic IS the Phase E curve above (mean duck multiplier 2.2125).
    // w_good is what "a better rarity roll" on the assembler row means: every
    // tier above the first weighted 1.5x, giving a mean of 2.692 (+21.7%).
    // w_rare and w_elite are the phase 1 catalog's "never makes a common duck"
    // machines. A zero weight on a tier is the mechanism the catalog assumed
    // existed and it does: rollTier() normalises over the weights it is given,
    // so a zero simply removes that tier from the machine's roll.
    //   w_rare  drops tier 0 and keeps the Phase E shape above it.
    //           mean 9.083 = 4.11x a basic duck, top tier 1 in 1200.
    //   w_elite drops everything below tier 3. mean 75.0 = 33.9x a basic duck,
    //           top tier 1 in 80 -- one duck a minute, worth a small fortune.
    // Neither reacts to rarityLuckMul: the stat scales every tier ABOVE the
    // first, and in these sets every surviving tier is above it, so the whole
    // set scales together and the mean does not move. That is correct rather
    // than convenient -- a machine that only makes rare ducks cannot be made
    // luckier -- but it does mean Lucky Rubber is worth nothing to a player
    // whose income is all reactor.
    sets: {
      w_basic: [6800, 900, 220, 60, 15, 4, 1],
      w_good: [6800, 1350, 330, 90, 22.5, 6, 1.5],
      w_rare: [0, 900, 220, 60, 15, 4, 1],
      w_elite: [0, 0, 0, 60, 15, 4, 1],
    },
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
    // stay; items (bucket, crates, cart) are the Phase E judgement call recorded
    // in work/economy.md as open to the owner's veto -- they are your tools, not
    // your factory, and wiping them replays the opening two minutes every run.
    // Flipping that veto is changing the 1 on `items` to a 0 and nothing else.
    // Every tab in src/data/index.js TABS must appear here or boot fails: a tab
    // with no entry would silently pick a side.
    keep: {
      machines: 0,
      buildings: 1,
      items: 1,
      upgrades: 0,
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

  // Manual Duck Workbench: the only duck source. Ten clicks on the side wheel
  // complete one turn and eject one duck from the front pipe.
  machine: {
    x: 0,
    y: 0,
    z: 35,              // 35 m from the pit -- frozen product decision
    yaw: 3.1415926536,  // model front is +Z; face it at the pit
    scale: 1.6,
    clicksPerTurn: 10,
    // Wheel hub in model-local metres (before scale/yaw). The wheel turns about
    // the model's local +X axis.
    wheelLocalX: 0.4685,
    wheelLocalY: 0.78,
    wheelLocalZ: -0.225,
    wheelRadius: 0.34,
    // Triangles with centroid x > splitMinX and within splitRadius of the hub in
    // the local YZ plane belong to the wheel and turn with it.
    splitMinX: 0.40,
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
    // The body collider's centre is now 0.13 above the duck's underside (it was
    // 0.09 before the head box went in), so the mesh drops by that instead.
    yOffset: -0.13,      // model stands on y=0; drop it to the collider's base
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
    0: 0xf2c218,
    1: 0x9ee34f,
    2: 0x35c2f0,
    3: 0xa763ff,
    4: 0xff7a2f,
    5: 0xff2f68,
    6: 0xffe14a,
  },

  hud: {
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
    rerollCost: 100,

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
      // branch on an id. Buildings are raw construction material and the
      // vendor never runs short of them; upgrades are paperwork he gets a few
      // of at a time.
      tabBias: {
        machines: 0.05,
        buildings: 0.00,
        items: 0.05,
        upgrades: 0.15,
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
    dirX: -0.52,
    dirY: 0.34,
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
    holeDistance: 300,
    holeSize: 240,
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
    // A target must survive this many frames before its name is shown, so
    // sweeping the crosshair across a crowd does not strobe the label.
    stickyFrames: 2,
  },

  // The key-prompt bar along the bottom of the screen. Real Kenney glyphs, not
  // a plain-text hint strip.
  keys: {
    // Kenney Input Prompts, "Keyboard & Mouse" default sheet. The folder and
    // file names carry an ampersand, so every fetch encodes the path segment.
    atlasPath: './assets/kenney-input-prompts/Keyboard & Mouse/',
    atlasImage: 'keyboard-&-mouse_sheet_default.png',
    atlasXml: 'keyboard-&-mouse_sheet_default.xml',
    // Gate F-A: booting with the network unplugged must still render a playable
    // scene, and that includes the HUD. A sheet that does not arrive inside this
    // leaves the bar drawn as procedural key caps instead of blank.
    timeoutMs: 4000,
    glyphSize: 21,       // on-screen size of one key cap, in CSS pixels
    opacity: 0.82,
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
    // A clip with no line in mix.json. broom.mp3 is the only one today.
    defaultClipGain: 0.4,
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
  'world.plateSize',
  'world.plateThickness',
  'world.floorTileMeters',
  'world.floorTextureSize',
  'world.floorTextureSeed',
  'world.floorBlotches',
  'world.floorCracks',
  'world.floorGrain',
  'world.plateColor',
  'world.markingColor',
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
  'prestige.keep.machines',
  'prestige.keep.buildings',
  'prestige.keep.items',
  'prestige.keep.upgrades',
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
  'machine.wheelLocalX',
  'machine.wheelLocalY',
  'machine.wheelLocalZ',
  'machine.wheelRadius',
  'machine.splitMinX',
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
  // measured. tabBias needs all four tabs for the same reason prestige.keep
  // does: a tab with no entry would have its scarcity decided by accident.
  'shop.stockSeconds',
  'shop.rerollCost',
  'shop.stock.costWeight',
  'shop.stock.limitWeight',
  'shop.stock.zeroMax',
  'shop.stock.zeroShape',
  'shop.stock.unitsMax',
  'shop.stock.unitsShape',
  'shop.stock.tabBias.machines',
  'shop.stock.tabBias.buildings',
  'shop.stock.tabBias.items',
  'shop.stock.tabBias.upgrades',
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
  'producers.luckMin',
  'producers.luckMax',
  'collectors.intakeHeightFrac',
  'collectors.arriveRadius',
  'collectors.maxSpeed',
  'collectors.burstSeconds',
  'collectors.minRadius',
  'collectors.liftGravityFrac',
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
  'focus.stickyFrames',
  'keys.timeoutMs',
  'keys.glyphSize',
  'keys.opacity',
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
  'audio.impact.minSpeed',
  'audio.impact.hardSpeed',
  'audio.impact.perDuckSeconds',
  'audio.impact.maxPerFrame',
  'audio.rareTier',
  'audio.sweepIntervalSeconds',
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
