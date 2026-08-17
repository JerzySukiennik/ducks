// Boot and wire-up. Owns window.GAME, the only supported way to test anything
// in this project: a hidden tab freezes requestAnimationFrame completely.

import config, { assertConfig } from './config.js';
import { createLoop } from './core/loop.js';
import { createInput } from './core/input.js';
import { createPerf } from './core/perf.js';
import { loadJSON } from './core/assets.js';
import { createRenderer } from './render/renderer.js';
import { createView } from './render/view.js';
import { loadModels, duckColorRemap } from './render/models.js';
import { createProps } from './render/props.js';
import { createDuckInstances } from './render/instancing.js';
import { createHUD } from './ui/hud.js';
import { createDebugOverlay } from './ui/debug.js';
import { createMachine, createSpin } from './sim/machine.js';
import { createBenches } from './sim/benches.js';
import { createShop } from './sim/shop.js';
import { createStock } from './sim/stock.js';
import { createPrestige } from './sim/prestige.js';
import { createProducers } from './sim/producers.js';
import { createCollectors, createAttention } from './sim/collectors.js';
import { createConveyors } from './sim/conveyors.js';
import { createVehicles } from './sim/vehicles.js';
import { TRUCK } from './data/vehicles.js';
import { createBlowers } from './sim/blowers.js';
import { createContainers, isStorageRow } from './sim/containers.js';
import { createTools, isToolRow } from './sim/tools.js';
import { createGamble, buildPrizeTable, PHASE as GAMBLE_PHASE } from './sim/gamble.js';
import { createState } from './sim/state.js';
import { createSnapshotCodec } from './net/snapshot.js';
import { createNetGame, REQ_GAMBLE } from './net/game.js';
import { REQ } from './net/protocol.js';
import { CATALOG, byId, byNetId, unstagedModels, isHandCarryable, isBuildableRow, VALIDATION } from './data/index.js';
import { resolvePlacement, createWorldQuery, createRotationState } from './sim/build.js';
import { createGhost } from './render/ghost.js';
import { createPlaced, initDropPhysics } from './render/placed.js';
import { createHandView } from './render/hand.js';
import { createShopUI } from './ui/shop.js';
import { createHotbar, reasonText } from './ui/hotbar.js';
import { createLobbyUI } from './ui/lobby.js';
import { createSettings, createSettingsUI } from './ui/settings.js';
import { createMenuUI } from './ui/menu.js';
import { createSummaryUI, createSessionStats } from './ui/summary.js';
import { createAvatarsView } from './render/avatars.js';
import { createGameAudio } from './audio/wire.js';
import { createFocus } from './render/focus.js';
import { createCutscene } from './cutscene.js';

// Stubs so the kinematic fallback world exposes the same surface as the real
// one: the frame loop must not grow a branch for every feature.
function stubGameplay(world) {
  if (!world.ducks) {
    world.ducks = {
      forEach() {}, spawn: () => null, release: () => false, atCap: () => false,
      pose: () => null, tier: () => null, body: () => null, isActive: () => false,
      count: () => ({ live: 0, sleeping: 0, free: 0, max: 0 }),
      onCapRefusal() {}, capMessage: () => 'Duck pool full.', max: 0,
    };
  }
  if (!world.hold) {
    world.hold = {
      tryGrab: () => false, release: () => false, throw: () => false,
      isHolding: () => false, scrollDistance: () => 0, distance: () => 0,
      grabCount: () => 0, heldDuck: () => null,
    };
  }
  if (!world.pit) world.pit = { totalScored: () => 0, consumeEvents: () => [] };
  if (!world.economy) world.economy = { money: () => 0, onChange: () => (() => {}) };
  if (!world.applyImpulse) world.applyImpulse = () => {};
  if (!world.addStaticBox) world.addStaticBox = () => null;
  return world;
}

function createFallbackWorld() {
  const g = config.world.gravity.y;
  const p = config.player;
  let simTime = 0;
  const state = { x: p.spawn.x, y: p.spawn.y, z: p.spawn.z, vx: 0, vy: 0, vz: 0, ground: false };
  const bodies = new Map();
  let nextId = 1;

  const player = {
    update(dt, input) {
      const speed = p.walkSpeed * (input.sprint ? p.sprintMultiplier : 1);
      const sin = Math.sin(input.yaw);
      const cos = Math.cos(input.yaw);
      let dx = input.right * cos - input.fwd * sin;
      let dz = -input.right * sin - input.fwd * cos;
      const len = Math.hypot(dx, dz);
      if (len > 1e-4) { dx /= len; dz /= len; } else { dx = 0; dz = 0; }
      state.vx = dx * speed;
      state.vz = dz * speed;
      state.vy += g * dt;
      if (state.ground && input.jump) state.vy = p.jumpSpeed;
      state.x += state.vx * dt;
      state.y += state.vy * dt;
      state.z += state.vz * dt;
      const half = config.world.plateSize / 2;
      state.x = Math.max(-half, Math.min(half, state.x));
      state.z = Math.max(-half, Math.min(half, state.z));
      if (state.y <= 0) { state.y = 0; state.vy = 0; state.ground = true; } else { state.ground = false; }
    },
    position: () => ({ x: state.x, y: state.y, z: state.z }),
    eyePosition: () => ({ x: state.x, y: state.y + p.eyeHeight, z: state.z }),
    velocity: () => ({ x: state.vx, y: state.vy, z: state.vz }),
    look: () => ({ yaw: 0, pitch: 0 }),
    grounded: () => state.ground,
  };

  return stubGameplay({
    fallback: true,
    step(dt) {
      simTime += dt;
      bodies.forEach((b) => {
        b.vy += g * dt;
        b.y += b.vy * dt;
        if (b.y <= 0.25) { b.y = 0.25; b.vy = 0; }
      });
    },
    addPlayer() { return player; },
    addTestBody(pos) {
      const id = nextId++;
      bodies.set(id, { x: pos.x, y: pos.y, z: pos.z, vy: 0 });
      return id;
    },
    bodyPose(id) {
      const b = bodies.get(id);
      return b ? { x: b.x, y: b.y, z: b.z, qx: 0, qy: 0, qz: 0, qw: 1 } : null;
    },
    stats: () => ({ bodies: bodies.size + 1, awake: bodies.size, sleeping: 0, physMs: 0, simTime }),
    dispose() { bodies.clear(); },
  });
}

function seeded(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

async function boot() {
  assertConfig(config);
  const container = document.getElementById('app');
  const overlay = createDebugOverlay(container);
  const renderer = createRenderer(container);
  const perf = createPerf();
  const sized = renderer.applySize(perf.bufferWidth);
  const view = createView(sized.aspect);
  const input = createInput(renderer.canvas);
  const hud = createHUD(container);

  const meta = await loadJSON('./version.json', { version: config.version, phase: 'G1' });

  let world = null;
  let degraded = null;
  // Collision groups come from the physics module, which is imported
  // dynamically: a CDN outage must cost physics, not the whole page.
  let groups = {
    GROUP_WORLD: 1, GROUP_PROP: 2, GROUP_PLAYER: 4,
    interactionGroups: (m, f) => ((m & 0xffff) << 16) | (f & 0xffff),
  };
  try {
    const mod = await import('./sim/world.js');
    world = await mod.createWorld(config);
    groups = {
      GROUP_WORLD: mod.GROUP_WORLD,
      GROUP_PROP: mod.GROUP_PROP,
      GROUP_PLAYER: mod.GROUP_PLAYER,
      interactionGroups: mod.interactionGroups,
    };
    stubGameplay(world);
  } catch (err) {
    degraded = err;
    console.error('[boot] physics unavailable, running fallback kinematics:', err);
    world = createFallbackWorld();
    overlay.showNotice(
      `Physics unavailable (${err && err.message ? err.message : err}) - running kinematic fallback.`
    );
  }

  const player = world.addPlayer(config.player.spawn);

  // Every model has a timeout and a procedural fallback, so a slow CDN or a
  // missing file costs detail, never the scene.
  // Model post-processing lives here so both the GLB and the procedural
  // stand-in get the same treatment.
  function smoothstep(a, b, x) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1e-6)));
    return t * t * (3 - 2 * t);
  }
  // Hand-authored specs for the models that need post-processing. Everything
  // else in the catalog is added below from the rows themselves, so a new item
  // row needs no edit here: its model is loaded because the row names it.
  const modelSpecs = {
    duck: duckColorRemap,
    pit_rim: null,
    tube: {
      // The plinth is the only thing that made the tube look ground-standing.
      drop: ['concrete'],
      // Fade the far end towards black. After the 180-degree flip that end is
      // the top, so the pipe dissolves into the dark sky instead of ending in
      // mid-air with a visible cut.
      shade(x, y) {
        const t = Math.max(0, Math.min(1, y / config.tube.mouthY));
        const s = smoothstep(config.tube.fadeStart, config.tube.fadeEnd, t);
        return config.tube.fadeFloor + (1 - config.tube.fadeFloor) * s;
      },
    },
    crank: {
      parts: {
        // Everything on the right-hand side within splitRadius of the hub, in
        // the local YZ plane, is wheel: rim, spokes, hub and handle.
        // The wheel moved from the machine's SIDE to its FRONT face, so the
        // test moved with it: a disc around the hub in the local XY plane,
        // in front of the cabinet. The old side-face version selected ZERO
        // triangles against the reworked mesh -- all 3280 welded into the
        // cabinet and the wheel silently stopped turning, which is the exact
        // failure mode a hand-written coordinate predicate has whenever the
        // model under it is reshaped.
        wheel(x, y, z) {
          const m = config.machine;
          if (z <= m.splitMinZ) return false;
          const dx = x - m.wheelLocalX;
          const dy = y - m.wheelLocalY;
          return dx * dx + dy * dy < m.splitRadius * m.splitRadius;
        },
      },
    },
  };
  for (const row of CATALOG) {
    if (row.model && !modelSpecs[row.model]) modelSpecs[row.model] = { fallbackBox: row.footprint };
    // A row's SECOND model, if it has one. The gambling box's lid is a separate
    // export rather than a part split out at load, so it has to be loaded like
    // any other model -- and it is named by the row, which keeps the rule
    // ("a model loads because a row names it") intact instead of adding a
    // hand-maintained list here.
    if (row.lid && row.lid.model && !modelSpecs[row.lid.model]) {
      modelSpecs[row.lid.model] = { fallbackBox: row.lid.footprint };
    }
    // And its MOVING parts -- cleats, rams, reels -- by the same rule. They are
    // deliberately given NO fallbackBox: a lid that fails to load should still
    // be a lid-shaped stand-in, but a cleat that fails to load should be
    // nothing at all rather than a metre cube riding a conveyor. placed.js
    // checks the `fallback` flag and simply draws the body alone.
    if (Array.isArray(row.moving)) {
      for (const p of row.moving) {
        if (p.model && !modelSpecs[p.model]) modelSpecs[p.model] = null;
      }
    }
  }
  // Booth scenery. Sizes are the model bounding boxes, used only if the GLB
  // fails to load.
  if (!modelSpecs.shop) modelSpecs.shop = { fallbackBox: [2.9, 2.87, 2.49] };
  if (!modelSpecs.vendor) modelSpecs.vendor = { fallbackBox: [0.66, 1.88, 0.43] };
  if (!modelSpecs.lamp) modelSpecs.lamp = { fallbackBox: [0.68, 3.15, 1.24] };
  // Other players. Not a catalog row -- nobody buys a person -- so it is named
  // here or it never loads.
  if (!modelSpecs.avatar) modelSpecs.avatar = { fallbackBox: [0.6, 1.85, 0.4] };
  // The truck's three parts. Not catalog rows -- nobody buys a truck, they buy
  // the garage that makes them -- so they are named here for the same reason
  // `avatar` is, and with no fallbackBox for the same reason a belt's cleats
  // have none: a stand-in box in the shape of a chassis is not a chassis.
  for (const m of ['car_body', 'car_bed', 'car_gate']) {
    if (!modelSpecs[m]) modelSpecs[m] = null;
  }

  const models = await loadModels(modelSpecs);
  const fellBack = Object.keys(models).filter((k) => models[k].fallback);
  if (fellBack.length) {
    overlay.showNotice(`Using procedural stand-ins for: ${fellBack.join(', ')}.`);
  }
  const unstaged = unstagedModels();
  if (unstaged.length) {
    overlay.showNotice(`Catalog models not staged in assets/models/: ${unstaged.join(', ')}.`);
  }

  const pitCenter = { x: config.pit.centerX, y: config.pit.centerY, z: config.pit.centerZ };
  const props = createProps({ scene: view.scene, models, pitCenter });
  const ducksView = createDuckInstances({
    geometry: models.duck.geometry,
    max: world.ducks.max || config.ducks.max,
    ducks: world.ducks,
  });
  view.add(ducksView.mesh);

  // The workbench is scenery with a solid box. It is registered as a collider on
  // the existing plate body, so the boot-constant rigid-body count is unchanged.
  {
    const m = config.machine;
    const s = m.scale;
    const sy = Math.sin(m.yaw);
    const cyw = Math.cos(m.yaw);
    world.addStaticBox({
      x: m.x + (0 * cyw + m.colliderLocalZ * sy) * s,
      y: m.y + m.colliderLocalY * s,
      z: m.z + (-0 * sy + m.colliderLocalZ * cyw) * s,
      hx: (Math.abs(m.colliderHalfX * cyw) + Math.abs(m.colliderHalfZ * sy)) * s,
      hy: m.colliderHalfY * s,
      hz: (Math.abs(m.colliderHalfX * sy) + Math.abs(m.colliderHalfZ * cyw)) * s,
    });
  }

  // The booth is scenery with a solid box, registered the same way: a collider
  // on the existing plate body, so no new rigid body appears at boot.
  {
    const b = config.booth;
    const s = b.scale;
    const sy = Math.sin(b.yaw);
    const cy = Math.cos(b.yaw);
    world.addStaticBox({
      x: b.x + b.colliderLocalZ * sy * s,
      y: b.y + b.colliderLocalY * s,
      z: b.z + b.colliderLocalZ * cy * s,
      hx: (Math.abs(b.colliderHalfX * cy) + Math.abs(b.colliderHalfZ * sy)) * s,
      hy: b.colliderHalfY * s,
      hz: (Math.abs(b.colliderHalfX * sy) + Math.abs(b.colliderHalfZ * cy)) * s,
    });

    // The two lamp posts the art pass planted either side of the workbench, so
    // the player cannot walk through them. Slim boxes around the poles rather
    // than the models' full footprint: the lamp heads overhang and a footprint
    // collider would put an invisible wall across the approach to the bench --
    // the one path every session begins with.
    for (const sx of [-1, 1]) {
      world.addStaticBox({
        x: sx * 2.0, y: 1.248, z: 35.4,
        hx: 0.09, hy: 1.248, hz: 0.09,
      });
    }
  }

  // Every tuning number the workbench needs, in ONE object, because the starter
  // bench (here), every bought bench (src/sim/benches.js) and a client's purely
  // visual wheel all have to spin off the same curve or the same machine reads
  // as two different machines depending on who is looking at it. src/sim/** does
  // not import config, so this is where config stops.
  const MACHINE_TUNING = {
    clicksPerTurn: config.machine.clicksPerTurn,
    secondsPerDuck: config.machine.holdSecondsPerDuck,
    minSeconds: config.machine.minHoldSeconds,
    drainRate: config.machine.holdDrainRate,
    capRetrySeconds: config.machine.capRetrySeconds,
    momentumPerSecond: config.machine.momentumPerSecond,
    momentumMax: config.machine.momentumMax,
    momentumDecayPerSecond: config.machine.momentumDecayPerSecond,
    spin: {
      momentumCoupling: config.machine.spinMomentumCoupling,
      minRadPerSec: config.machine.spinMinRadPerSec,
      maxRadPerSec: config.machine.spinMaxRadPerSec,
      curve: config.machine.spinCurve,
      accelPerSecond: config.machine.spinAccelPerSecond,
      decelPerSecond: config.machine.spinDecelPerSecond,
      stopBelow: config.machine.spinStopBelow,
      popCoastSeconds: config.machine.spinPopCoastSeconds,
    },
  };

  const machine = createMachine(MACHINE_TUNING);
  props.setWheelAngle(machine.angle());

  // --- G2: shop, hotbar, placement -----------------------------------------

  // Prestige is created a few hundred lines below, because it has to ask the
  // shop what you own -- and the shop has to ask it what the multiplier is. One
  // of the two has to be handed to the other late; a null-guarded reference is
  // honest about that, the same way netRef is. Nothing reads the stat table
  // before both exist.
  let prestige = null;
  // The vendor's shelf. Built BEFORE the shop because the shop is the thing
  // that gates a purchase on it, and it takes the catalog rather than the shop
  // so it never learns what a purchase is: it counts units and rolls dice.
  const stock = createStock({ rows: CATALOG, config });
  const shop = createShop({
    economy: world.economy,
    config,
    stock,
    // Prestige reaches every consumer of a stat through this one line, folded by
    // the same applyEffects() an upgrade goes through. There is deliberately no
    // second multiplier anywhere: shop.stats().duckValueMul is the whole answer.
    extraEffects: () => (prestige ? prestige.effects() : []),
  });
  const physicsProps = await initDropPhysics();
  const placed = createPlaced({ scene: view.scene, models, world, groups });
  const ghost = createGhost({ scene: view.scene, models });
  // What is in your hands, drawn in view space. It is a render-layer object on
  // purpose: src/sim/** never learns that a renderer exists.
  const handView = createHandView({ scene: view.scene, models });
  const hotbar = createHotbar({ container });
  const rotation = createRotationState(config);
  // placed.objects is a live array, so a placed object blocks the next
  // hologram without anything having to copy it across.
  const worldQuery = createWorldQuery(config, placed.objects);

  // What the crosshair is on: an inverted-hull outline in the scene and a DOM
  // name projected above it. Everything it needs to identify a thing already
  // exists, so this hands it the readers rather than a copy of anything.
  const focus = createFocus({
    scene: view.scene,
    container,
    sources: {
      placed,
      duckMesh: ducksView.mesh,
      duckOfSlot: (slot) => ducksView.duckOf(slot),
      duckPose: (id) => world.ducks.pose(id),
      tierMultiplier: (t) => config.rarity.multipliers[
        Math.max(0, Math.min(config.rarity.multipliers.length - 1, t | 0))
      ],
      sceneryMeshes: () => sceneryTargets,
      // The catalog row behind a placed object, so focus.js can read the row's
      // `interact` declaration instead of keeping its own idea of which models
      // have an interactive part.
      rowOf: (id) => byId(id),
      // The interactive part of a PLACED machine. Same declaration
      // (`row.interact`), same aim test as the click -- `placed.crankAim` is
      // what wheelUnderCursor() consults for bought benches -- and the outline
      // geometry is the wheel's own instanced part, never the whole model.
      placedInteract: (aim, range) => {
        const hit = placed.crankAim(aim.origin, aim.dir);
        if (!hit || hit.distance > range) return null;
        const rec = hit.rec;
        const row = byId(rec.id);
        if (!row || !row.interact || !rec.wheelPool || rec.wheelSlot < 0) return null;
        return {
          key: rec.key + ':' + row.interact.part,
          name: rec.name || row.name,
          hint: row.interact.hint,
          distance: hit.distance,
          // The label hangs on the WHEEL HUB, which is a fixed point on the
          // cabinet, not on the wheel's spinning bounding box. See wheelLabelY.
          anchor: () => wheelLabelAnchor(placed.wheelCenter(rec), placed.scaleOf(rec)),
          // The pool and the slot, not a matrix: main.js does not import three,
          // and focus.js already owns the scratch Matrix4 to read it into.
          pool: rec.wheelPool,
          slot: rec.wheelSlot,
        };
      },
    },
  });
  // The scenery focus table. `focusable` is a DECLARATION, not an accident of
  // what happens to be in a raycast list: an outline promises the player that
  // the thing answers a key, so anything that answers nothing says so here.
  // Non-focusable rows stay in the table because they are still solid -- focus.js
  // uses them as occluders so the vendor cannot be outlined through the front of
  // his own booth.
  //
  // The starter workbench is the same catalog row as a bought one, so WHICH part
  // of it is interactive comes from the row (`crank.interact`), not from this
  // table: the two paths must not be able to disagree about it. The table only
  // says how to hit that part here -- `props.wheelAimDistance` is the same
  // sphere `wheelUnderCursor` reads, sized by machine.hitRadiusScale and cut off
  // at machine.useRange.
  const crankRow = byId('crank');
  // WHERE THE WHEEL'S NAME HANGS. The wheel turns -- fast, now that cranking is
  // a hold -- and focus.js's default anchor is the top of the target's live
  // bounding box, which for a spinning part rises and falls once per revolution
  // and made the label visibly bounce while cranking. This is the hub, a point
  // that does not move, lifted clear of the rim by the wheel's own radius. It is
  // computed from config and the machine's pose, never from the animated
  // transform, so it is still while the wheel is a blur.
  function wheelLabelAnchor(center, scale) {
    const s = typeof scale === 'number' && isFinite(scale) && scale > 0
      ? scale : config.machine.scale;
    const clear = config.machine.wheelRadius * s + config.focus.labelClearance;
    return { x: center.x, y: center.y + clear, z: center.z };
  }
  const sceneryTargets = [
    {
      name: crankRow.name,
      sub: crankRow.interact.hint,
      focusable: !!crankRow.interact.part,
      mesh: props.group.getObjectByName('machineWheel'),
      aim: (o, d) => props.wheelAimDistance(o, d),
      anchor: () => wheelLabelAnchor(props.wheelCenter()),
    },
    { name: 'Workbench cabinet', focusable: false, mesh: props.group.getObjectByName('machineBody') },
    { name: 'Purchase Chute', focusable: false, mesh: props.group.getObjectByName('tube') },
    { name: "Vendor's Booth", focusable: false, mesh: props.group.getObjectByName('boothKiosk') },
    { name: 'Vendor', sub: 'press E', focusable: true, mesh: props.group.getObjectByName('boothVendor') },
    { name: 'Lamp', focusable: false, mesh: props.group.getObjectByName('boothLamp') },
  ].filter((e) => !!e.mesh);

  // --- G3: automation -------------------------------------------------------
  // The systems are handed a live list of placed records and the duck pool, and
  // nothing else: src/sim/** never learns that a renderer exists. `placed` is
  // the same array worldQuery reads, so placing or demolishing a machine turns
  // its behaviour on and off with no registration step.
  const automationList = () => placed.objects;
  // Purchased manual workbenches. One charge and one wheel per placed bench,
  // keyed by its placement key, so a bought bench is held on its own without
  // touching the starter one's state.
  const benches = createBenches({ list: automationList, byId, machine: MACHINE_TUNING });
  const producers = createProducers({
    ducks: world.ducks,
    applyImpulse: world.applyImpulse,
    list: automationList,
    byId,
    config,
    statsOf: () => shop.stats(),
  });
  // A press presses when a duck actually comes out of it. The stroke is driven
  // from the SAME event the eject sound is (src/audio/wire.js), so a machine
  // that is jammed or held at the duck cap is visibly and audibly idle -- the
  // animation reports work done rather than running on a clock beside it.
  producers.onEmit((ev) => { if (ev && placed.strokeAt) placed.strokeAt(ev.key); });
  const collectors = createCollectors({
    ducks: world.ducks,
    applyImpulse: world.applyImpulse,
    list: automationList,
    byId,
    config,
    // The duck in your hands is not loose, so the vacuum leaves it alone -- and
    // in a room "your hands" is any of the four pairs, not just this keyboard's.
    isBusy: (id) => (world.holderOfDuck ? world.holderOfDuck(id) !== null
      : world.hold.heldDuck() === id),
  });
  const attention = createAttention({
    ducks: world.ducks, list: automationList, byId, config,
  });
  // Movement. Belts and fans act on the same placed list, but unlike producers
  // they have to push in lockstep with the solver, so they subscribe to the
  // world's substep loop instead of being ticked once a frame.
  const conveyors = createConveyors({
    ducks: world.ducks, applyImpulse: world.applyImpulse, list: automationList, byId, config,
  });
  const blowers = createBlowers({
    ducks: world.ducks, applyImpulse: world.applyImpulse, list: automationList, byId, config,
  });
  // Containers and handheld tools push bodies the same way, so they live in the
  // same substep loop. Both act only through impulses on woken bodies.
  const containers = createContainers({
    ducks: world.ducks,
    pit: world.pit,
    economy: world.economy,
    applyImpulse: world.applyImpulse,
    config,
    getStats: () => shop.stats(),
    groups,
    // A leaking container leaks while it is CARRIED as well as while it is
    // shoved, and a held box hovers dead still -- so speed alone would call it
    // parked. world.isHeldHandle() is the same claim table the hold controller
    // owns, in a room as well as solo.
    isHeld: (body) => !!(body && world.isHeldHandle(body.handle)),
  });
  const tools = createTools({
    ducks: world.ducks,
    applyImpulse: world.applyImpulse,
    getAim: () => view.aim(),
    config,
    stepWorld: (dt) => loop.step(dt),
  });
  // --- G5: sound --------------------------------------------------------------
  // One bus, the gains from assets/audio/mix.json, and a hard rule that it can
  // never take the frame loop down: every call below is a no-op when a clip is
  // missing or the browser has not granted an AudioContext yet. The simulation
  // emits and this layer listens -- src/sim/** imports nothing from src/audio/.
  const audio = createGameAudio({
    config, world, producers, collectors, conveyors, blowers, containers, tools,
    shop, placed, props, byId, player,
    listener: () => player.eyePosition(),
  });

  // --- prestige --------------------------------------------------------------
  // Trade the factory for a permanent multiplier on what a duck pays. The rule,
  // the curve and the trap that produced it live in src/sim/prestige.js; this is
  // the half that owns the WORLD, because removing a press from the plate is a
  // renderer's business and src/sim/** is not allowed to know a renderer exists.
  //
  // What has to be destroyed is not only the placed machines. A row can be in
  // four places at once -- standing on the plate, lying on the drop zone as an
  // uncollected delivery, queued in the chute, or sitting in somebody's hotbar
  // -- and a wipe that missed any of them would leave a press to be rebuilt for
  // free after the reset. Each of the four is handled here once, and none of
  // them is named by id: the predicate comes from prestige.js, which asks the
  // catalog row about its TAB.
  function wipeForPrestige(shouldWipe) {
    let placedRemoved = 0;
    for (let i = placed.objects.length - 1; i >= 0; i--) {
      const rec = placed.objects[i];
      if (!shouldWipe(rec.id)) continue;
      if (placed.remove(rec)) placedRemoved++;
    }
    let propsRemoved = 0;
    for (let i = placed.props.length - 1; i >= 0; i--) {
      const rec = placed.props[i];
      if (!shouldWipe(rec.id)) continue;
      if (placed.despawnProp(rec)) propsRemoved++;
    }
    let dropped = 0;
    for (let i = deliveries.length - 1; i >= 0; i--) {
      if (!shouldWipe(deliveries[i].id)) continue;
      deliveries.splice(i, 1);
      dropped++;
    }
    // Hands, everybody's. src/net/game.js owns every inventory in the room.
    const n = netLayer();
    const items = n && typeof n.clearInventories === 'function' ? n.clearInventories(shouldWipe) : 0;
    // The automation modules key their state off the live placed list and only
    // notice when something asks them to look. info() and sync() resync without
    // advancing anything, so a demolished producer's timer cannot survive into a
    // machine bought after the reset.
    producers.info();
    benches.sync();
    syncContainers();
    return { placed: placedRemoved, props: propsRemoved, deliveries: dropped, items };
  }

  prestige = createPrestige({
    economy: world.economy,
    shop,
    config,
    listPlaced: () => placed.objects,
    byId,
    onWipe: wipeForPrestige,
  });

  // --- G4: the world snapshot ------------------------------------------------
  // ONE serialisation serving three jobs: a client joining mid-game, crash
  // recovery, and debugSnapshot(). It is handed the modules it has to put back
  // and nothing else -- `placed` goes in as an object list, not as a renderer,
  // which is why src/sim/state.js still imports no three.js.
  // Assigned once the network layer exists a few hundred lines below. The
  // snapshot needs to ask "who is holding what" and the network layer needs the
  // snapshot to answer "what is the world", so one of the two has to be handed
  // to the other late. A null-guarded reference is honest about that; a second
  // copy of the roster living in here would not be.
  let netRef = null;

  const state = createState({
    world, shop, placed, containers, producers, prestige, stock, byNetId, config,
    hooks: {
      // The gap this round had to close. src/sim/state.js serialised every
      // duck, every crate on the floor and every placed building, and still
      // could not tell a joining player that the broom is in slot 2's hands
      // rather than gone. An item in a hand is not a prop and not a placed
      // object, so it needed a section of its own -- and it had to go in the
      // SNAPSHOT, because the snapshot is the join path.
      players: () => (netRef ? netRef.players() : []),
      setPlayers: (list) => { if (netRef) netRef.setRoster(list); },
    },
  });

  // The 20 Hz binary state frame. Created here so the two filters that keep the
  // stream inside the 60 KB/s budget -- the sleeping filter and relevance culling
  // -- are measurable head-down through window.GAME long before a transport
  // exists to carry the bytes. The codec owns the send rate and degrades it
  // itself; whatever ends up calling it asks codec.stateHz() every frame rather
  // than caching the configured 20.
  const netCodec = createSnapshotCodec(config);

  // The tipper trucks. Created before the fixed hook below because that hook is
  // where they drive; nothing about a truck happens outside a substep.
  const vehicles = createVehicles({ world, config, spec: TRUCK });

  if (typeof world.onFixedUpdate === 'function') {
    world.onFixedUpdate((h) => {
      conveyors._fixedUpdate(h);
      blowers._fixedUpdate(h);
      // Trucks, and then whoever is riding one. The order matters and it is the
      // only order that works: the drive writes the chassis velocity for the
      // step the solver is about to run, and the carry moves passengers by the
      // distance the solver moved the truck LAST step. Both inside the substep,
      // because a truck that only moved once a frame would leave its passengers
      // behind at every frame boundary.
      if (!net.isClient()) vehicles.fixedUpdate(h);
      carryRiders();
      // The slot spring and the broom are springs like the grab controller: the
      // impulse has to land in the substep the solver is about to integrate, not
      // once per frame, or a full crate visibly sags between frames.
      // Absorbing a duck DESTROYS it (the body goes back to the pool), which is
      // the host's decision alone -- a client doing it deletes a duck the host
      // still believes in. The spring that holds the contents in place is
      // harmless, but the two live in the same call, so the whole step is gated
      // and a client's crates are display only, like its pit.
      if (!net.isClient()) containers._fixedUpdate(h);
      tools._fixedUpdate(h);
    });
  }

  // --- the truck: driving it, riding on it, tipping it -------------------------
  //
  // Everything below is the LOCAL player's relationship with a truck. The truck
  // itself does not live here: src/sim/vehicles.js owns the bodies and the
  // hinges, src/data/vehicles.js owns the geometry, and config.vehicle owns
  // every number a player can feel.
  //
  // The capsule is kinematic, which is what makes both halves of this simple.
  // A driver is not "attached" to anything: they are put at the seat once per
  // substep, after their own controller has run and before the solver, so there
  // is no frame in which they are half in the cab. A passenger is moved by the
  // truck's own last-substep displacement, which is what a moving platform is.

  // Which truck the local player is driving, or null.
  let driving = null;
  // Their look, kept while driving, so the third-person camera can be swung
  // round the truck without the truck steering to follow the mouse.
  const truckMeshes = new Map();     // vehicle key -> [attached render records]

  function playerBody() {
    if (!world._raw || typeof player.handle !== 'number') return null;
    const b = world._raw.getRigidBody(player.handle);
    return b && b.handle === player.handle ? b : null;
  }

  // The capsule's centre for a given foot position: the player module measures
  // its body from the middle of the capsule, and every position this file deals
  // in -- a seat, a bed floor -- is where the FEET go.
  function centreForFeet(p) {
    return { x: p.x, y: p.y + config.player.height / 2, z: p.z };
  }

  function carryRiders() {
    if (!vehicles.count()) return;
    const b = playerBody();
    if (!b) return;
    if (driving) {
      const rec = vehicles.byKey(driving);
      if (!rec) { driving = null; return; }
      // Pinned to the seat. setNextKinematicTranslation rather than
      // setTranslation: the controller has already written its own next pose
      // this substep and this overwrites it, so the two never fight and the
      // capsule never spends a substep inside the cab's collider.
      b.setNextKinematicTranslation(centreForFeet(vehicles.seatOf(rec)));
      return;
    }
    // A passenger. The capsule's own next pose is the one the controller just
    // computed -- walking, falling, standing still -- and the truck's
    // displacement is ADDED to it, so a player can walk about on a moving bed.
    const next = typeof b.nextTranslation === 'function' ? b.nextTranslation() : b.translation();
    const feet = { x: next.x, y: next.y - config.player.height / 2, z: next.z };
    for (const rec of vehicles.list) {
      if (!vehicles.onBed(rec, feet)) continue;
      const d = vehicles.carryDelta(rec);
      // The yaw part is a rotation about the truck's centre, not a spin in
      // place: a passenger standing at the back of a turning truck travels
      // further than one standing over the axle, exactly as they should.
      const t = rec.chassis.translation();
      const rx = next.x - t.x;
      const rz = next.z - t.z;
      const c = Math.cos(d.yaw);
      const s = Math.sin(d.yaw);
      b.setNextKinematicTranslation({
        x: t.x + rx * c + rz * s + d.x,
        y: next.y + d.y,
        z: t.z - rx * s + rz * c + d.z,
      });
      return;
    }
  }

  // The three meshes of one truck, bolted to the three bodies. They are drawn
  // with NO seating offset -- see placed.attachBody -- because the models are
  // authored in their bodies' own frames.
  function attachTruck(rec) {
    const parts = [];
    for (const [part, model] of [
      ['chassis', TRUCK.models.body], ['bed', TRUCK.models.bed], ['gate', TRUCK.models.gate],
    ]) {
      const m = placed.attachBody(model, rec[part]);
      if (m) parts.push(m);
    }
    truckMeshes.set(rec.key, parts);
    return parts.length;
  }

  // Put a truck on the plate in front of a garage. `free` is the first one,
  // which came with the building; every other costs config.vehicle.spawnCost
  // and this refuses rather than going overdrawn.
  function spawnTruck(garage, free) {
    const V = config.vehicle;
    let owned = 0;
    for (const rec of vehicles.list) if (rec.garage === garage.key) owned++;
    if (owned >= V.maxPerSpawner) return { ok: false, reason: 'full' };
    if (!free) {
      if (world.economy.money() < V.spawnCost) return { ok: false, reason: 'money' };
      world.economy.spend(V.spawnCost, 'vehicle');
    }
    const o = V.spawnOffset;
    const c = Math.cos(garage.yaw);
    const s = Math.sin(garage.yaw);
    const pos = {
      x: garage.x + o[0] * c + o[2] * s,
      y: garage.y - garage.hy + o[1],
      z: garage.z - o[0] * s + o[2] * c,
    };
    // Nose OUT. The truck stands on the far side of the garage from its gantry,
    // and a truck facing the building it came out of can only leave in reverse
    // -- measured: full throttle moved it 0.45 m and stopped against the
    // garage's own collider, which reads exactly like a broken vehicle.
    const rec = vehicles.spawn(pos, garage.yaw + Math.PI);
    rec.garage = garage.key;
    attachTruck(rec);
    return { ok: true, key: rec.key, cost: free ? 0 : V.spawnCost };
  }

  // The garage under the crosshair, if the player is close enough to use it.
  function garageTarget() {
    const p = player.position();
    let best = null;
    let bestD = config.booth.useRange + 1.5;
    for (const rec of placed.objects) {
      if (rec.kind !== 'spawner') continue;
      const d = Math.hypot(p.x - rec.x, p.z - rec.z);
      if (d < bestD) { bestD = d; best = rec; }
    }
    return best;
  }

  function enterTruck() {
    const near = vehicles.nearest(player.position());
    if (!near) return false;
    if (near.vehicle.driver !== null && near.vehicle.driver !== 0) return false;
    driving = near.key;
    vehicles.setDriver(near.key, 0);
    vehicles.control(near.key, { throttle: 0, steer: 0, handbrake: false });
    // THE CONTROLS, ON SCREEN, ONCE. Nothing else in this game needs a key
    // legend because everything else is one key on one object; a truck is five
    // keys the player has no way to discover, and "I cannot drop the tailgate"
    // is what a player says when the tailgate is on a key nobody told them
    // about. E is the way OUT, because E is the way out of everything.
    hud.showCap('WASD drive - Space brake - R tailgate - Q/Z bed - E out');
    // The engine starts when the driver does. It is a running note, not a clip
    // (src/audio/trucksynth.js), so it has an on and an off rather than a play.
    if (audio.truckEngineOn) audio.truckEngineOn();
    return true;
  }

  // One frame of driving. Everything here is a REQUEST written onto the record;
  // the truck itself only ever moves inside a substep, in src/sim/vehicles.js.
  // A test harness cannot press a key, so debugDrive writes here and this is
  // read INSTEAD of the keyboard for as long as it is set. Without it every
  // scripted drive was overwritten by the real input on the very next frame --
  // the truck would be told to go, and then told to stop, sixty times a second.
  let driveOverride = null;

  function driveFromInput(inp) {
    if (!driving) return;
    const rec = vehicles.byKey(driving);
    if (!rec) { driving = null; return; }
    const src = driveOverride || inp;
    vehicles.control(driving, {
      throttle: src.fwd,
      steer: src.right,
      // Space is the brake, which is the same key that jumps on foot. It reads
      // as the right one anyway: the thing you press when you want to stop.
      handbrake: !!src.jump,
    });
    // Q raises the bed, Z lowers it, and it holds wherever you let go -- which
    // is the whole point of a lever. Pressing both is a tie and nothing moves.
    if (driveOverride && driveOverride.tip !== undefined && driveOverride.tip !== null) {
      vehicles.setTip(driving, driveOverride.tip);
      return;
    }
    const up = input.isKeyDown('KeyQ');
    const down = input.isKeyDown('KeyZ');
    if (up !== down) vehicles.setTip(driving, up ? 1 : 0);
    else vehicles.setTip(driving, rec.tip);
  }

  // The camera when driving: behind the truck, above it, looking at it. The
  // player's own yaw and pitch still swing it, so you can look over your
  // shoulder while reversing under a belt -- which is the manoeuvre this whole
  // vehicle exists for and the one thing a cab-view camera cannot show.
  function truckCamera(yaw, pitch) {
    if (!driving) return null;
    const rec = vehicles.byKey(driving);
    if (!rec) return null;
    const t = rec.chassis.translation();
    const focus = { x: t.x, y: t.y + config.vehicle.camHeight, z: t.z };
    const d = config.vehicle.camDistance;
    const cp = Math.cos(pitch);
    return {
      x: focus.x + Math.sin(yaw) * d * cp,
      y: focus.y - Math.sin(pitch) * d,
      z: focus.z + Math.cos(yaw) * d * cp,
    };
  }

  function exitTruck() {
    if (!driving) return false;
    const rec = vehicles.byKey(driving);
    if (rec) {
      vehicles.setDriver(driving, null);
      const b = playerBody();
      // Put down beside the cab, not inside it. setTranslation, not `next`:
      // getting out is instant and the controller picks up from where it lands.
      if (b) b.setTranslation(centreForFeet(vehicles.exitOf(rec)), true);
    }
    driving = null;
    if (audio.truckEngineOff) audio.truckEngineOff();
    return true;
  }

  // The truck's own sounds, once a frame. Everything here is READ from the
  // record rather than remembered: the engine note is the truck's real speed as
  // a fraction of its top speed, and the ram whines only while the bed is
  // actually moving -- which is what tells the player that Q and Z are a lever
  // they are holding rather than a button they pressed.
  let lastTip = 0;
  let lastGateOpen = 0;
  function truckAudio(dt) {
    if (!driving) return;
    const rec = vehicles.byKey(driving);
    if (!rec) return;
    const v = rec.chassis.linvel();
    if (audio.truckSpeed) {
      audio.truckSpeed(Math.hypot(v.x, v.z) / config.vehicle.topSpeed, dt);
    }
    const moving = Math.abs(rec.tip - lastTip) > 1e-4;
    if (audio.truckRam) audio.truckRam(moving, rec.tip);
    // The load leaves when the bed is high enough for it to slide, and the
    // sound fires once on that crossing rather than every frame past it.
    const dumpAt = 0.55;
    if (lastTip < dumpAt && rec.tip >= dumpAt && rec.gateOpen > 0.5 && audio.truckDump) {
      audio.truckDump();
    }
    lastTip = rec.tip;
    const gateNow = rec.gateWant > 0.5 ? 1 : 0;
    if (gateNow !== lastGateOpen) {
      if (audio.truckGate) audio.truckGate(!!gateNow);
      lastGateOpen = gateNow;
    }
  }

  // A container is a DROPPED PROP with a real dynamic body -- a placed building
  // is a collider on the shared plate and could never be tipped. Registration is
  // therefore reconciled against placed.props rather than hooked onto the
  // purchase: a prop despawned to make room for a newer one (config.drop.max)
  // takes its rigid body with it, and a container still holding that body would
  // read a freed pointer on the next substep.
  function syncContainers() {
    const keys = containers.keys();
    for (let i = 0; i < keys.length; i++) {
      let alive = false;
      for (let j = 0; j < placed.props.length; j++) {
        if (placed.props[j].key === keys[i]) { alive = true; break; }
      }
      if (!alive) containers.unregister(keys[i]);
    }
    for (let i = 0; i < placed.props.length; i++) {
      const rec = placed.props[i];
      if (containers.get(rec.key)) continue;
      const row = byId(rec.id);
      // isStorageRow reads the row's storage block, so bucket, crate, large
      // crate, container and cart all qualify without naming one of them.
      if (row && isStorageRow(row)) containers.register(row, rec.body, { key: rec.key });
    }
  }

  // `collider.blockDucks: false` is a DATA field, and the Fan is the row that
  // needs it: ducks sail through the blades while the player still walks into
  // the housing. The placer gives every object the same solid collider, so the
  // filter is narrowed here from the row -- never from an id.
  const DUCK_PASS_FILTER = groups.interactionGroups(
    groups.GROUP_WORLD, groups.GROUP_WORLD | groups.GROUP_PLAYER
  );
  function applyColliderFilters() {
    const objs = placed.objects;
    for (let i = 0; i < objs.length; i++) {
      const rec = objs[i];
      if (rec._duckFilter) continue;
      rec._duckFilter = 1;
      const row = byId(rec.id);
      if (!row || !row.collider || row.collider.blockDucks !== false) continue;
      if (rec.collider && typeof rec.collider.setCollisionGroups === 'function') {
        rec.collider.setCollisionGroups(DUCK_PASS_FILTER);
        rec._duckFilter = 2;
      }
    }
  }

  // The live stat table reaching the two consumers that cannot read it for
  // themselves.
  //
  //   clicksPerDuckMul (Swift Hands) re-rates the crank, as it has since G2.
  //   duckValueMul     is pushed into the economy, which src/sim/pit.js reads at
  //                    the instant a duck scores.
  //
  // The second half is new and it closes a real hole: NOTHING read duckValueMul.
  // Market Valuation folded into shop.stats() correctly and no consumer ever
  // picked the number up, so eight levels of a $500 upgrade paid for nothing.
  // Prestige feeds the same stat through the same table, so there is one reader
  // for both and no separate prestige multiplier at the pit to keep in step.
  //
  // Called once per frame rather than only on purchase. A stat can now change
  // without a purchase -- a prestige does it, and so does a snapshot load inside
  // the network layer, which main.js has no hook into -- and a pushed value that
  // depends on somebody remembering to push it is the exact failure mode the
  // hole above came from. computeStats() folds a handful of rows; producers.js
  // already calls shop.stats() per machine per update.
  function applyStats() {
    const s = shop.stats();
    benches.setClicksPerDuck(s.clicksPerDuckMul);
    machine.setClicksPerDuck(s.clicksPerDuckMul);
    world.economy.duckValueMul = s.duckValueMul;
    // The three that were computed and never read. An audit measured Sturdy
    // Boots x3 moving the walk speed from 5.196 to 5.198 m/s -- noise for about
    // $1,020 -- Long Arms x2 still failing at exactly the base 4.0 m, and Strong
    // Arm consumed by nothing at all. src/data/stats.js already named the reader
    // for each; this is that wiring, and it belongs here beside the other two so
    // the next stat added has an obvious place to be applied.
    if (player.setMoveSpeedMul) player.setMoveSpeedMul(s.moveSpeedMul);
    if (world.hold && world.hold.setGrabRangeAdd) world.hold.setGrabRangeAdd(s.grabRangeAdd);
    if (world.hold && world.hold.setThrowImpulseMul) world.hold.setThrowImpulseMul(s.throwImpulseMul);
    return s;
  }
  applyStats();

  // --- G6: the front end -----------------------------------------------------
  // Declared before the panels that ask about them, because every panel now
  // answers ONE question the same way: does anything own the pointer right now.
  // Setting `captured` from each panel's own close handler is what makes
  // closing the settings panel hand control back to the player while the menu
  // is still up in front of them.
  let menu = null;
  let settings = null;
  let settingsUI = null;
  // The intro. Declared here rather than where it is built, because the frame
  // loop and uiCapture() both ask about it and both are written above the line
  // that creates it (it needs the network layer, which is built last).
  let cutscene = null;
  function uiCapture() {
    const owned = !!(
      (menu && menu.isOpen()) || (settingsUI && settingsUI.isOpen())
      || (lobby && lobby.isOpen()) || (shopUI && shopUI.isOpen())
      || (summaryUI && summaryUI.isOpen())
      // The cutscene owns the pointer and the keyboard the same way a panel
      // does: the camera is flying, so a player walking around under it would
      // be steering a body nobody can see. Esc and Space still reach the
      // cutscene, which listens in the capture phase.
      || (cutscene && cutscene.isActive())
    );
    input.setCaptured(owned);
    return owned;
  }

  const shopUI = createShopUI({
    container,
    shop,
    economy: world.economy,
    // Buying is a world change (it moves shared money and drops a physical
    // object), so on a client it is a request like every other one.
    onBuy: (id) => net.act({ a: REQ.BUY, item: id }),
    // The shelf, for the countdown and the price on the restock button. The
    // per-row unit counts do NOT come through here -- they ride inside
    // shop.listTab() with the prices, so the panel has one source for "what can
    // I buy" instead of two that can disagree.
    stock,
    // Paying to turn the shelf over spends shared money and rolls the host's
    // dice, so it is a request like every other one. A client never rolls.
    onReroll: () => net.act({ a: REQ.REROLL }),
    // The prestige panel. The quote is read live from src/sim/prestige.js so the
    // screen cannot disagree with what taking it would actually do, and the
    // commit is a request like every other one -- on a client it is SENT, and
    // the reset arrives in the host's broadcast with everybody else's.
    prestigeQuote: () => (prestige ? prestige.quote() : null),
    onPrestige: () => net.act({ a: REQ.PRESTIGE }),
    // Who may pull the lever. A shared economy makes this a team action, and the
    // host is the authority every player accepted by joining their room; a
    // client sees the same quote with the reason its button is off.
    prestigeAllowed: () => (net.isClient()
      ? { ok: false, reason: 'Only the host can call a prestige' }
      : { ok: true, reason: null }),
    // The loop keeps running while the shop is open; only the player's input is
    // handed to the DOM. debugStep must still advance the simulation.
    onOpen: () => { uiCapture(); audio.shopOpened(); },
    // Closing hands control back AND asks for pointer lock in the same gesture,
    // so the player is looking around again without a click in between. The key
    // that closed the shop is the user gesture the request needs; if the browser
    // still refuses (its post-Escape cooldown), input.js waits the cooldown out
    // and asks again, and the click that finally does it acts on nothing.
    onClose: () => { if (!uiCapture()) input.requestLock(); audio.shopClosed(); },
    onUi: (kind) => audio.ui(kind),
  });

  // --- G4: lobby, avatars, end-of-session screen ----------------------------
  //
  // Other players are drawn from INTERPOLATED poses in one InstancedMesh, so
  // four of them cost one draw call and none of them is simulated here.
  const avatars = createAvatarsView({ scene: view.scene, models, container });
  const sessionStats = createSessionStats({ world, placed });
  const summaryUI = createSummaryUI({ container, onClose: () => { uiCapture(); } });

  // src/net/game.js owns the live session. This file hands it the signalling
  // session the lobby created and asks it who is in the room and where they
  // are: attachHost, attachClient, detach, players, playerPose, localSlot,
  // isSingle -- all of which createNetGame already exports.
  //
  // It is reached through a registration rather than a captured const because
  // the net layer is built further down this same file by the other half of
  // G4; registerNetLayer() is the seam, and until it is called the lobby still
  // opens, single player is untouched, and no parallel path is invented.
  let netGame = null;
  function registerNetLayer(n) {
    netGame = n || null;
    return netGame;
  }
  function netLayer() {
    if (netGame) return netGame;
    const g = window.GAME;
    return (g && (g.net || g.netGame)) || null;
  }

  // Everyone in the room except the player holding this keyboard, drawn from
  // net.playerPose(). The poses go into the avatar view's buffer stamped with
  // the wall clock and come back out net.interpDelayMs later: this file never
  // simulates a remote player, it plays back what the network reported.
  // Only the avatars this function put there are its to take away. Clearing on
  // "no session" unconditionally would also wipe anything debugSetAvatars put
  // in the world, and an avatar view that cannot be driven head-down is an
  // avatar view nobody can test.
  // ONE definition of an avatar's id, because the roster and the pose stream
  // are pushed from two different places and a mismatch between them creates a
  // second, poseless record for a player who is standing right there.
  const AVATAR_ID = (slot) => 'slot' + slot;
  // What colour a remote player is drawn in. If the roster carries the colour
  // that player chose, that is the answer and nothing else gets a say. It does
  // NOT carry one today: the roster is built in src/net/, which this round does
  // not own, so a player's own choice is visible to them in the menu and is not
  // yet on the wire. Until it is, the fallback is the player's SLOT, which
  // every peer already agrees on -- so four players are four colours and all
  // four tabs agree on which is which, rather than everyone being identical.
  function avatarColorFor(p) {
    if (p && p.color) return p.color;
    const palette = config.menu.palette;
    const slot = p && typeof p.slot === 'number' ? p.slot : 0;
    return palette[((slot % palette.length) + palette.length) % palette.length];
  }
  let avatarsFromNet = false;
  let lastRoster = 0;
  function syncAvatars() {
    const n = netLayer();
    if (!n || typeof n.players !== 'function' || n.isSingle()) {
      if (avatarsFromNet) { avatars.clear(); avatarsFromNet = false; }
      return 0;
    }
    avatarsFromNet = true;
    const local = n.localSlot();
    const list = n.players().filter((p) => p && p.slot !== local);
    avatars.setPlayers(list.map((p) => ({
      id: AVATAR_ID(p.slot), nick: p.nick, slot: p.slot, color: avatarColorFor(p),
      // What this player is holding, carrying and doing. The roster has carried
      // `hand` and `hold` since G4 and this map used to drop them on the floor,
      // which is why nobody could see the broom in anybody else's hands. `using`
      // is new -- see usingModeOf() in src/net/game.js.
      hand: p.hand || null, hold: p.hold || null, using: p.using || null,
    })));
    // Somebody arrived. The roster is the one place that knows, and it only
    // ever grows by a join.
    if (list.length > lastRoster) audio.playerJoined();
    lastRoster = list.length;
    // Poses are NOT pushed from here, in EITHER role. On a client they arrive
    // on the network at 20 Hz and are pushed by net's onPlayerPose the instant
    // they do, stamped with when they actually arrived; re-sampling them at
    // frame rate would stamp one host pose three times at three different
    // instants and hand the avatar's interpolator a stair step to smooth. A
    // host receives no such stream -- it owns those capsules -- so it pushes
    // through the same callback from its own tick (src/net/host.js,
    // collectPlayers). Losing that half is what left the host looking at an
    // empty room while everybody else could see the host.
    return list.length;
  }

  function sessionPlayers() {
    const n = netLayer();
    if (n && typeof n.players === 'function') return n.players();
    const s = lobby ? lobby.session() : null;
    return s ? [{ slot: s.slot, nick: s.nick, self: true }] : [];
  }

  // The same screen with the same numbers for everyone. A client shows what the
  // host sent it; only a host with nobody to ask computes its own.
  function endSession(reason, data) {
    const shown = data || sessionStats.collect({
      reason: reason || 'Session ended.',
      players: sessionPlayers(),
      now: simTime,
    });
    if (lobby) lobby.clearSession(null);
    audio.sessionEnded();
    summaryUI.show(shown);
    return shown;
  }

  const lobby = createLobbyUI({
    container,
    onOpen: () => { uiCapture(); },
    onClose: () => { uiCapture(); if (menu) menu.sync(); },
    // The lobby's name box and the Settings name box are one preference.
    onNickname: (v) => { if (settings) settings.set('nickname', v); },
    // Opening or joining a room DRESSES THE INTRO'S SET, right then, while
    // everybody is sitting in the waiting room with nothing to look at.
    // Staging costs over a second of wall clock and the timeline is anchored to
    // the instant Start is pressed, so a tab that paid it after Start would
    // correctly and uselessly enter the intro that far in. Paying it during the
    // wait costs nobody anything: there is no world on screen to disturb.
    onHost: (session) => {
      const n = netLayer();
      if (n && n.attachHost) n.attachHost(session);
      if (cutscene) cutscene.prepare();
    },
    // NOT prepared here. A joining tab does not yet know which side of the door
    // it arrived on -- the host's WELCOME decides that -- and a latecomer who
    // dropped straight into a running session would have staged a hundred and
    // seventy ducks for an intro it is never going to play and never strike.
    // net.onPhaseChange below prepares only when the answer comes back 'lobby'.
    onJoin: (session) => {
      const n = netLayer();
      if (n && n.attachClient) n.attachClient(session);
    },
    onLeave: (session, wasHost) => {
      const n = netLayer();
      if (n && n.detach) n.detach(session);
      // Left before it ever ran: the set comes down through the same teardown
      // the ending uses, so a room somebody backed out of leaves nothing behind.
      if (cutscene) cutscene.discard();
      endSession(wasHost ? 'You ended the session.' : 'You left the room.');
    },
    // --- the waiting room ------------------------------------------------------
    // Both of these go through net.act() like every other action in this file.
    // The host PERFORMS start (it is slot 0); a client SENDS ready and its flag
    // comes back in the roster with everybody else's. Neither the panel nor this
    // file keeps a second copy of who is ready.
    onCreative: (on) => applyCreative(on),
    onStart: () => {
      const n = netLayer();
      const on = lobby.creative ? lobby.creative() : false;
      applyCreative(on);
      return n && n.startSession ? n.startSession({ creative: on }) : null;
    },
    onReady: (on) => {
      const n = netLayer();
      const color = settings ? settings.get('avatarColor') : config.menu.defaultColor;
      return n && n.setReady ? n.setReady(on, color) : null;
    },
  });

  // The preference store. Its targets are the LIVE objects a setting acts on,
  // so every slider changes the thing it names in the frame it is moved: the
  // audio bus, the camera, the renderer, the input layer's own config key. None
  // of them is re-read at boot from a copy.
  //
  // What is persisted is preferences and nothing else. Presence ids and peer
  // ids stay per page load and are generated in src/net/ (frozen G4 rule 8);
  // nothing in this store or in localStorage is ever consulted for identity.
  settings = createSettings({
    storageKey: 'ducks.prefs.v1',
    targets: {
      audio,
      renderer,
      perf,
      camera: view.camera,
      setAspect: (a) => view.setAspect(a),
      setNickname: (v) => lobby.setNickname(v),
      setAvatarColor: () => { if (menu) menu.sync(); },
    },
  });
  settingsUI = createSettingsUI({
    container,
    settings,
    // What the renderer is ACTUALLY drawing into, so the panel can show the
    // gap between the width the player asked for and the width the adaptive
    // sampler settled on instead of quietly presenting one as the other.
    // A function, not a number: the value changes while the panel is open.
    live: { bufferWidth: () => renderer.bufferWidth },
    onUi: (kind) => audio.ui(kind),
    onOpen: () => { uiCapture(); },
    onClose: () => { uiCapture(); if (menu) menu.sync(); },
  });

  // The menu sits in front of everything and starts open. The world is already
  // built and the loop is already running behind it -- Solo does not start a
  // game, it closes a panel -- which is why the network being dead can never
  // stand between the player and playing.
  // CREATIVE MODE, applied at the three points of decision and nowhere else:
  // what a thing costs, how many the vendor has, and which tier a duck rolls.
  // Called once per session, before play starts, by whoever owns the session.
  function applyCreative(on) {
    const v = !!on;
    shop.setCreative(v);
    stock.setCreative(v);
    world.ducks.setCreative(config, v);
    return v;
  }

  menu = createMenuUI({
    container,
    settings,
    version: meta.version,
    degraded: !!degraded,
    // Same fact, same source, for the menu's one-line Settings summary.
    bufferWidth: () => renderer.bufferWidth,
    session: () => lobby.session(),
    onUi: (kind) => audio.ui(kind),
    onOpen: () => { uiCapture(); },
    onClose: (reason) => {
      if (!uiCapture()) input.requestLock();
      // The menu's "Play" button gets the intro too. It runs through the SAME cutscene.start()
      // the host's REQ.START path uses -- one timeline, one teardown, one skip --
      // rather than a solo-only copy that would drift from it. Only the deliberate
      // press counts: 'scrim', 'close' and 'cutscene' must not re-enter it, or
      // Escape during the intro would restart the intro.
      if (reason !== 'play') return;
      if (!cutscene || cutscene.isActive()) return;
      if (lobby && lobby.session && lobby.session()) return;   // a room drives its own start
      // Solo takes the mode the lobby is showing, so pressing Play in creative is
      // creative.
      applyCreative(lobby.creative ? lobby.creative() : false);
      Promise.resolve(cutscene.prepare()).then(() => {
        cutscene.start({ elapsed: 0, info: { role: 'solo' } });
      });
    },
    // The menu hands OVER to a panel, it does not stack behind one. Opening the
    // lobby while the menu stayed up put two panels on screen at once with the
    // menu covering the room list it had just opened. Settings is the deliberate
    // exception: it layers on the menu and Escape returns you to it.
    onMultiplayer: () => { menu.close(); lobby.open(); },
    onSettings: () => { settingsUI.open(); },
    // The end-of-session panel reads the SAME collector the summary screen
    // renders from, so the preview and the screen it leads to cannot report
    // different numbers. It is asked for, never accumulated.
    summary: () => sessionStats.collect({
      reason: '', players: sessionPlayers(), now: simTime,
    }),
    // Ending goes through the lobby when there is a room, because leaving one is
    // the lobby's job and its onLeave already calls endSession. With no room
    // there is nobody to tell, so the summary is raised directly.
    onEndSession: () => {
      menu.close('end');
      // Strike the intro's set FIRST, exactly as the leave path above does. The
      // two ends of a session were asymmetric: leaving a room discarded the
      // cutscene, ending a solo session did not, so `endSession()` raised the
      // summary while the intro was still holding its own stage -- and the
      // player got the film replayed over the only artefact a 2-4 hour session
      // with no save ever produces. One missing line, on the path that matters
      // most.
      if (lobby.session()) lobby.leave();
      else {
        if (cutscene) cutscene.discard();
        endSession('You ended the session.');
      }
    },
  });

  // What you build rather than what you carry. Data, not an id list: a new
  // machine row is buildable because its KIND says so.
  //
  // This used to read `BUILD_TABS = { machines: true, buildings: true }`, which
  // tied a placement rule to a shop grouping -- so re-sorting the shop moved
  // things in and out of buildability as a side effect. It now asks
  // KINDS[kind].build, which is the same question stated where the answer
  // actually lives, and the shop is free to be arranged for the player.
  //
  // One row changes behaviour as a result, and it is a fix rather than a cost:
  // `plank` is a `ramp` -- slope block, floor anchor, collider, snap grid, the
  // full placement kit -- that was typed into the Items tab and was therefore
  // silently unbuildable. It is still hand-carryable (it has a `hand` block), so
  // it gains the ghost path without losing the throw one.
  const isBuildable = isBuildableRow;

  // A tool goes into a hotbar slot like a building does, but taking it out puts
  // it in your HAND instead of on the ground: the slot is the equip switch, so
  // there is exactly one place a tool can be picked up and put away, and putting
  // it away is the same keypress that puts a wall away. Selecting a different
  // slot, or the same slot twice, unequips -- which is what gives the grab
  // button back.
  function handTool() {
    const item = hotbar.current();
    return item && isToolRow(item) ? item : null;
  }
  let equippedRow = null;
  function syncEquippedTool() {
    const want = handTool();
    if (want === equippedRow) return equippedRow;
    if (want) tools.equip(want); else tools.unequip();
    equippedRow = want;
    return equippedRow;
  }

  let demolishing = false;
  let demolishHold = 0;
  let demolishTarget = null;
  let lastPlacement = null;
  let lastRefund = 0;
  let placeCount = 0;
  let demolishCount = 0;
  let purchases = 0;
  const dropRnd = seeded(config.drop.seed);

  // Everything bought falls out of the overhead tube mouth as a real body at
  // 1:1 scale, so a container arrives like a container.
  function dropPurchase(row) {
    if (!row.model || !row.collider) return null;
    const mouth = props.tubeMouth();
    const d = config.drop;
    return placed.dropProp(row, {
      x: mouth.x + (dropRnd() - 0.5) * d.spread,
      y: mouth.y - d.belowMouth - row.collider.half[1],
      z: mouth.z + (dropRnd() - 0.5) * d.spread,
    }, { x: 0, y: -d.speed, z: 0 });
  }

  // --- the chute is a QUEUE, not a hand ----------------------------------------
  //
  // NOTHING bought is ever handed to the player. Buildings used to be, and that
  // one line was the root of both defects Jurek reported: with a wall already in
  // hand when the shop closed, the click that takes pointer lock back also
  // placed it, somewhere he never aimed. Now a wall arrives the same way a broom
  // does -- it falls out of the tube and is picked up with E -- so at the moment
  // the shop closes there is nothing in hand for a stray click to place.
  //
  // Deliveries queue for two reasons that are not the same reason:
  //   * sixty walls bought in one go must not become sixty dynamic bodies in one
  //     frame (config.drop.perFrame), exactly as the container spill path caps
  //     conversions per step;
  //   * the prop pool is finite (config.drop.max). Rather than despawn the
  //     OLDEST prop to make room -- which quietly destroys a wall the player paid
  //     for -- the chute HOLDS the rest and says how many are waiting. Nothing is
  //     ever deleted, which is the same rule the duck pool follows at its cap.
  const deliveries = [];
  let backlogNoticeAt = -1e9;
  let deliveredCount = 0;

  // One definition of "the floor is full", owned by the thing that enforces it.
  function chuteFull() { return placed.atCap(); }

  function pumpDeliveries(now) {
    let spawned = 0;
    const perFrame = Math.round(config.drop.perFrame);
    while (deliveries.length && spawned < perFrame && !chuteFull()) {
      const row = deliveries[0];
      if (!dropPurchase(row)) break;        // no pool slot / physics not up yet
      deliveries.shift();
      spawned++;
      deliveredCount++;
    }
    if (spawned) audio.tubeDrop();
    // A backlog is visible, never silent: the player is told the chute is
    // holding their purchases and what to do about it.
    if (deliveries.length && chuteFull()
        && now - backlogNoticeAt >= config.drop.backlogNoticeSeconds) {
      backlogNoticeAt = now;
      hud.showCap('Chute is holding ' + deliveries.length
        + (deliveries.length === 1 ? ' delivery' : ' deliveries')
        + ' - the drop zone is full, clear it');
    }
    return spawned;
  }

  shop.onPurchase((ev) => {
    const row = byId(ev.id);
    if (!row) return;
    purchases++;
    // A row with a model is a physical thing and is delivered. A row without one
    // is an upgrade: it has nothing to fall out of a tube and its effect is
    // already applied by the shop.
    if (row.model) deliveries.push(row);
    // The last onboarding step: money buys machines. Fired here rather than in
    // updateOnboarding() because a purchase is an event, not a state somebody
    // can poll -- and this handler runs for the player who actually asked.
    onboardingStep('buy');
    // An upgrade only exists once something reads its stat. This is the crank's
    // and the economy's reader; the producers and collectors read theirs every
    // update. The frame calls it too -- this one is so a purchase takes effect
    // in the frame it was made rather than the next one.
    applyStats();
    props.setWheelAngle(machine.angle());
  });

  // --- the gambling box --------------------------------------------------------
  //
  // Pay, watch it rattle, take whatever falls out. The roll itself is
  // src/sim/gamble.js and knows nothing about this file; what lives here is the
  // three things only the game can answer: what a prize IS, where the money
  // comes from, and how the thing that was won reaches the player.
  //
  // HOST AUTHORITY. Starting a roll is a request like every other verb (see
  // REQ_GAMBLE in src/net/game.js): a client asks, the host rolls its own dice,
  // and what comes out reaches everybody through the channels that already
  // exist -- the chute for an item, the duck spawn stream for ducks, the money
  // diff for the fee. A client that rolled its own would be looking at a reward
  // nobody else can see.
  const GAMBLE_KIND = 'gamble';
  function isGambleRow(row) { return !!row && row.kind === GAMBLE_KIND; }

  // Never Math.random: this project bans it in anything that has to be the same
  // twice. The same stream decides the prize and the size of a duck payout.
  const gambleRnd = seeded(config.gamble.seed);
  const gamble = createGamble({ config, rnd: gambleRnd });

  // THE PRIZE TABLE IS THE CATALOG, which is what makes "anything can fall out
  // of it" a property of the data rather than a promise in a comment: a row
  // added to machines.js or buildings.js tomorrow is winnable tomorrow, with no
  // second list to forget. Two filters, both structural:
  //
  //   * it must have a MODEL -- a prize is a physical object that falls out of
  //     the chute, and a row without one is an upgrade whose effect is applied
  //     by the shop and could not fall out of anything;
  //   * it must be something a player could otherwise own (buildable, or
  //     carryable in the hand), because those are the two things the delivery
  //     path knows how to hand over.
  //
  // Weight is 1 / cost^prizePower inside buildPrizeTable, so the cheap rows are
  // the common ones and the endless pipe is the story you tell afterwards.
  const gamblePrizeRows = CATALOG.filter((r) => r.model && (isBuildable(r) || isHandCarryable(r)));
  const gamblePrizeTable = buildPrizeTable(gamblePrizeRows, { power: config.gamble.prizePower });
  // THE TABLE MUST NEVER BE EMPTY, and this is the line that guarantees it.
  // sim/gamble.js refuses to start a roll it has nothing to award ("nothing to
  // win"), which is correct for the module and wrong for the player: a box that
  // silently declines to open reads as broken, and the rule is that it always
  // gives you something. So an empty catalog resolves to a single row that names
  // no catalog item at all -- payGamblePrize() finds no row for it and pays
  // ducks. One sentinel, and the whole "empty table" case stops being a refusal.
  const GAMBLE_DUCK_TABLE = { rows: [{ id: '__ducks', cost: 1, weight: 1, p: 1 }], total: 1 };
  // Test-only override. The shipped catalog has 70-odd winnable rows, so the
  // duck path is unreachable in a normal session -- and an unreachable branch is
  // an unmeasured one. This is the only way to exercise it; nothing in the game
  // ever sets it.
  let gambleForceDucks = false;
  function gambleTable() {
    if (gambleForceDucks || !gamblePrizeTable.rows.length) return GAMBLE_DUCK_TABLE;
    return gamblePrizeTable;
  }
  let gambleRolls = 0;
  let lastGamblePrize = null;
  const gambleWins = new Map();     // prize id -> how many times it has come out

  // Boxes are reconciled against the placed list every frame, exactly the way
  // syncContainers() reconciles containers against dropped props: a box that was
  // demolished has to stop being stepped, and a box the host placed for us has
  // to start. Registering on the place() call instead would miss every box that
  // arrives through a join snapshot or an EV.PLACED.
  function syncGambleBoxes() {
    const keys = gamble.keys();
    for (let i = 0; i < keys.length; i++) {
      let alive = false;
      for (let j = 0; j < placed.objects.length; j++) {
        if (placed.objects[j].key === keys[i]) { alive = true; break; }
      }
      if (!alive) gamble.forget(keys[i]);
    }
    for (let i = 0; i < placed.objects.length; i++) {
      const rec = placed.objects[i];
      if (isGambleRow(byId(rec.id))) gamble.register(rec.key);
    }
  }

  // The box under an EXPLICIT aim. Explicit because the host runs this same test
  // for a remote player, from where IT believes that player is looking -- the
  // same rule wheelAimFrom() follows, and the reason no box id ever travels in a
  // message.
  function gambleAimFrom(origin, dir) {
    const hit = placed.raycast(origin, dir, config.gamble.useRange);
    if (!hit) return null;
    return isGambleRow(byId(hit.object.id)) ? { rec: hit.object, distance: hit.distance } : null;
  }

  function gambleTarget() {
    if (shopUI.isOpen() || demolishing) return null;
    const a = view.aim();
    const hit = gambleAimFrom(a.origin, a.dir);
    return hit ? { rec: hit.rec, distance: hit.distance } : null;
  }

  // What the host actually does when somebody asks for a roll. Money first, and
  // only ever ONCE: the cost is checked against the shared balance, the sim is
  // asked to start (it is the authority on "already rolling" and on the
  // cooldown), and the fee is taken only after it has said yes -- so a refused
  // roll never costs anything.
  function gambleStart(key) {
    const rec = placed.objects.find((o) => o.key === key);
    if (!rec) return { ok: false, reason: 'nothing there' };
    // The ROLL fee, which is a different number from what the box costs to buy
    // (config.gamble.boxPrice). They were one key until it became clear that
    // meant no roll could be repriced without repricing the machine.
    const cost = config.gamble.rollCost;
    if (gamble.isRolling(key)) return { ok: false, reason: 'It is already rolling' };
    if (!world.economy.canAfford(cost)) {
      return { ok: false, reason: 'You need $' + cost + ' for a roll' };
    }
    const res = gamble.start(key, gambleTable());
    if (!res || !res.ok) return { ok: false, reason: (res && res.reason) || 'refused' };
    world.economy.spend(cost, 'gamble:' + key);
    gambleRolls++;
    return { ok: true, key, cost, seconds: res.seconds };
  }

  // The lid is open and something has to come out. An ITEM arrives exactly the
  // way a purchase does -- queued in the chute, dropped out of the tube, picked
  // up with E -- rather than through a second delivery path invented for this
  // one machine. Ducks are the fallback for a table that came up empty, so the
  // box always gives you something and never reads as broken.
  function payGamblePrize(ev) {
    const rec = placed.objects.find((o) => o.key === ev.key) || null;
    const row = ev.prize ? byId(ev.prize.id) : null;
    if (row && row.model) {
      deliveries.push(row);
      lastGamblePrize = { key: ev.key, kind: 'item', id: row.id, name: row.name, cost: row.cost };
      gambleWins.set(row.id, (gambleWins.get(row.id) || 0) + 1);
      hud.showCap('The box paid out: ' + row.name + ' - collect it from the chute');
      return lastGamblePrize;
    }
    const g = config.gamble;
    const span = Math.max(0, Math.round(g.duckPrizeMax) - Math.round(g.duckPrizeMin));
    const n = Math.round(g.duckPrizeMin) + Math.floor(gambleRnd() * (span + 1));
    let made = 0;
    for (let i = 0; i < n; i++) {
      const at = rec
        ? { x: rec.x + (gambleRnd() - 0.5) * g.duckSpawnSpread,
          y: rec.y + g.duckSpawnHeight,
          z: rec.z + (gambleRnd() - 0.5) * g.duckSpawnSpread }
        : { x: 0, y: 2, z: 0 };
      if (world.ducks.spawn(at) !== null) made++;
    }
    lastGamblePrize = { key: ev.key, kind: 'ducks', ducks: made };
    gambleWins.set('__ducks', (gambleWins.get('__ducks') || 0) + 1);
    hud.showCap('The box paid out ' + made + ' ducks');
    return lastGamblePrize;
  }

  // Drained once a frame, HOST AND SINGLE PLAYER ONLY: a prize is a change to
  // the world, and on a client the world arrives from the host.
  // Where a box stands, for positioned audio. Null is fine -- the audio layer
  // treats a missing position as non-positional rather than as the origin.
  function gambleWorldPos(key) {
    const rec = placed.objects.find((o) => o.key === key);
    return rec ? { x: rec.position.x, y: rec.position.y, z: rec.position.z } : undefined;
  }

  // 0..1, how big this prize is against the best the table can give. Drives how
  // long and how high the win arpeggio runs.
  function gamblePrizeSize01(ev) {
    const rows = gamblePrizeTable && gamblePrizeTable.rows ? gamblePrizeTable.rows : null;
    if (!rows || !rows.length || !ev || !ev.prize) return 0;
    let best = 0;
    for (let i = 0; i < rows.length; i++) if (rows[i].cost > best) best = rows[i].cost;
    return best > 0 ? Math.max(0, Math.min(1, (ev.prize.cost || 0) / best)) : 0;
  }

  function pumpGambleEvents() {
    const evs = gamble.drainEvents();
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      // The box was the largest silent surface in the game: it shook, hopped,
      // flashed and paid out without a sound. The rattle is sized to the roll's
      // own duration and the arpeggio's length and pitch come from the prize, so
      // a big win is audibly a big win.
      const at = gambleWorldPos ? gambleWorldPos(ev.key) : undefined;
      if (ev.type === 'gambleStart' && audio.gambleStarted) audio.gambleStarted(ev.seconds);
      if (ev.type === 'gambleOpen') {
        if (audio.gambleOpened) audio.gambleOpened(gamblePrizeSize01(ev), at);
        payGamblePrize(ev);
      }
      if (ev.type === 'gambleDone' && audio.gambleDone) audio.gambleDone(at);
    }
    return evs.length;
  }

  // The look, which is the point of the feature. Every number comes out of the
  // simulation and none of them is decided here: hop() is metres above the
  // floor, lid() is 0..1 open, hue() is where round the colour wheel it is. The
  // only thing this adds is HOW MUCH of that hue to apply, which is a render
  // decision -- a box at rest is its own colour, a box mid-roll is a strobe.
  function updateGambleView() {
    const list = placed.gambles();
    for (let i = 0; i < list.length; i++) {
      const rec = list[i];
      const phase = gamble.phase(rec.key);
      if (phase === GAMBLE_PHASE.IDLE && !rec.hop && !rec.lidAngle) continue;
      const u = gamble.t01(rec.key);
      const flash = phase === GAMBLE_PHASE.SHAKE ? 0.35 + 0.65 * u
        : phase === GAMBLE_PHASE.OPEN ? 1
          : phase === GAMBLE_PHASE.SETTLE ? 1 - u
            : 0;
      placed.setGamble(rec, gamble.hop(rec.key), gamble.lid(rec.key), gamble.hue(rec.key), flash);
    }
  }

  // A CLIENT being told the host started a roll. Animation and nothing else:
  // this tab never drains a gambleOpen (pumpGambleEvents is host-side), so no
  // prize is ever handed out here. The module needs a table to start at all and
  // gets the real one; the prize it happens to pick locally is dead state and
  // gambleInfo() blanks it so nothing can ever read it as the answer.
  function gambleShow(key) {
    const k = Math.round(Number(key)) || 0;
    if (!k) return false;
    gamble.register(k);
    const res = gamble.start(k, gambleTable());
    return !!(res && res.ok);
  }

  // E on a box. Through net.act like every other verb: in single player this is
  // perform(0, req) in the same frame, on a client it is a question and nothing
  // else happens locally.
  function doGamble() {
    const t = gambleTarget();
    if (!t) return null;
    const a = view.aim();
    const res = net.act({
      a: REQ_GAMBLE,
      o: [a.origin.x, a.origin.y, a.origin.z], d: [a.dir.x, a.dir.y, a.dir.z],
    });
    if (res && res.pending) return null;
    if (!res || !res.ok) {
      if (res && res.reason) hud.showCap(res.reason);
      return null;
    }
    return res;
  }

  // --- carrying: pick up with E, throw back out with Q ------------------------
  // Both ends of the loop go through the same two objects: the hotbar slot and
  // the prop list. Picking up removes the prop (and its rigid body) and adds the
  // slot; throwing removes the slot and creates a FRESH prop. Nothing hands a
  // freed body pointer to anything.

  let pickUps = 0;
  let throwCount = 0;
  let lastPickup = null;
  let lastThrow = null;

  // Anything lying on the floor that E can take. A carryable ends up IN YOUR
  // HANDS as a model; a building ends up in the hotbar as a hologram to place.
  // Both are "collect the delivery", so both answer to the same key and the same
  // ray -- inventing a second pick-up verb for buildings would leave the player
  // guessing which one a given crate wants.
  function isCollectable(row) { return isHandCarryable(row) || isBuildable(row); }

  // What the crosshair is on, if it is something you could pick up.
  function pickupTarget() {
    if (shopUI.isOpen() || demolishing) return null;
    const a = view.aim();
    const hit = placed.raycastProps(a.origin, a.dir, config.hand.pickupRange);
    if (!hit) return null;
    const row = byId(hit.prop.id);
    if (!isCollectable(row)) return null;
    return { prop: hit.prop, row, distance: hit.distance };
  }

  // --- every action the player takes goes through exactly one door -------------
  // net.act(request) is that door. Single player and a host both run the SAME
  // implementation behind it (src/net/game.js, perform()); a client sends the
  // request and does nothing else, so frozen contract rule 6 -- no client
  // applies its own request locally first -- is a property of the shape of this
  // code rather than a rule somebody has to remember.
  //
  // A pending request returns { pending: true } and the world arrives later, in
  // the same broadcast every other player receives. A refusal comes back on the
  // reliable channel and is shown by net's onReject, so the reason a client is
  // told is the reason the host actually had.
  //
  // The build hologram is the ONE agreed exception and never comes through
  // here: it is a preview of where an object would go, not a claim that it went
  // there, and a preview that waits for a round trip is unusable.

  function pickUp() {
    const t = pickupTarget();
    if (!t) return null;
    // ASKED BEFORE THE REQUEST GOES OUT, because the host's pickup handler
    // despawns the prop the moment it hands it over: a bar that refused the item
    // afterwards would delete it off the floor instead of leaving it there. With
    // nine slots full the tenth item used to overwrite slot 9 in silence; now the
    // bar refuses (hotbar.add returns -1) and this is where the player hears why.
    if (!hotbar.hasRoom(t.row.id)) {
      hud.showCap('Hotbar is full (' + hotbar.slotCount + '/' + hotbar.slotCount
        + ') - place or drop something first');
      return null;
    }
    const res = net.act({ a: REQ.PICKUP, key: t.prop.key });
    if (res && res.pending) return null;
    if (!res || !res.ok) { if (res && res.reason) hud.showCap(res.reason); return null; }
    pickUps++;
    lastPickup = { id: res.id, name: res.name, key: res.key, distance: t.distance };
    // E-pickup was silent while grabbing the SAME object with the mouse played a
    // sound -- the two are one gesture to the player.
    if (audio.itemPickedUp) audio.itemPickedUp();
    return lastPickup;
  }

  // Q. The item leaves your hands and becomes a physical object again, in front
  // of you, so another player can pick it up.
  function throwItem() {
    const item = hotbar.current();
    if (!isHandCarryable(item)) return null;
    const a = view.aim();
    const res = net.act({
      a: REQ.THROW, item: item.id,
      o: [a.origin.x, a.origin.y, a.origin.z], d: [a.dir.x, a.dir.y, a.dir.z],
    });
    if (res && res.pending) return null;
    if (!res || !res.ok) { if (res && res.reason) hud.showCap(res.reason); return null; }
    throwCount++;
    audio.itemThrown();
    lastThrow = { id: res.id, name: res.name, key: res.key, position: res.position };
    return lastThrow;
  }

  function doPlace() {
    const item = hotbar.current();
    if (!item) return null;
    // Only a building goes on the floor. A carryable in hand is held, and its
    // click belongs to whatever the item does.
    if (!isBuildable(item)) return null;
    const a = view.aim();
    const rot = rotation.get();
    const res = net.act({
      a: REQ.PLACE, item: item.id, yaw: rot.yaw, free: !!rot.free,
      o: [a.origin.x, a.origin.y, a.origin.z], d: [a.dir.x, a.dir.y, a.dir.z],
    });
    if (res && res.pending) return null;
    if (!res || !res.ok) {
      // reasonText() maps a placement reason code; anything else is already a
      // sentence, and reasonText hands an unknown code straight back.
      audio.placementRefused();
      if (res && res.reason) hud.showCap(reasonText(res.reason));
      return null;
    }
    placeCount++;
    audio.placed(res.record ? { x: res.record.x, y: res.record.y, z: res.record.z } : undefined);
    // A garage arrives WITH ITS FIRST TRUCK. The player already paid for it when
    // they bought the building, so making them walk up and pay again before
    // anything happened would be charging twice for one decision -- and a garage
    // with an empty pad is a building that looks broken.
    if (item.kind === 'spawner' && item.spawn && item.spawn.firstFree && !net.isClient()) {
      const rec = placed.objects.find((o) => o.key === (res.record && res.record.key));
      if (rec) spawnTruck(rec, true);
    }
    return { record: res.record, placement: res.placement };
  }

  // The container the crosshair is on, if it has anything in it. Deliberately
  // the same ray the pick-up prompt uses, so "what R will act on" and "what E
  // will act on" can never disagree.
  // How many are inside a prop, for the prompt. Zero for anything that is not a
  // container, so the extra line only appears when pouring would do something.
  function pourableCount(prop) {
    if (!prop || !containers.info) return 0;
    const info = containers.info(prop.key);
    return info && info.total ? info.total : 0;
  }

  function pourTarget() {
    const t = pickupTarget();
    if (!t || !t.prop) return null;
    const info = containers.info ? containers.info(t.prop.key) : null;
    if (!info || !info.total) return null;
    return t.prop;
  }

  function doPour(prop) {
    if (!prop) return null;
    const res = net.act({ a: REQ.POUR, key: prop.key });
    if (res && res.pending) return null;
    if (!res || !res.ok) { if (res && res.reason) hud.showCap(res.reason); return null; }
    audio.itemThrown();
    return res;
  }

  function doDemolish(rec) {
    if (!rec) return null;
    const res = net.act({ a: REQ.DEMOLISH, key: rec.key });
    demolishHold = 0;
    demolishTarget = null;
    if (res && res.pending) return null;
    if (!res || !res.ok) { if (res && res.reason) hud.showCap(res.reason); return null; }
    demolishCount++;
    audio.demolished({ x: rec.x, y: rec.y, z: rec.z });
    lastRefund = res.refund;
    return { id: res.id, name: res.name, refund: res.refund };
  }

  // What the removed status strip used to say and the world cannot: why a
  // hologram is red, and how far a demolish hold has got. It goes to the
  // crosshair prompt, which is already where the player is looking and already
  // knows how to draw "label + percent". Everything else the strip said (what is
  // in hand, what the grid is, what the angle is) is on screen as the selected
  // slot and the hologram itself, so it is simply gone.
  let buildNotice = null;

  function updateBuild(dt) {
    buildNotice = null;
    if (shopUI.isOpen()) { ghost.hide(); return; }

    if (demolishing) {
      ghost.hide();
      const a = view.aim();
      const hit = placed.raycast(a.origin, a.dir, config.build.demolishRange);
      const target = hit ? hit.object : null;
      if (target !== demolishTarget) demolishHold = 0;
      demolishTarget = target;
      if (!target) {
        hotbar.setStatus({ mode: 'demolish', text: 'Look at something you placed', bad: true });
        buildNotice = { label: 'Demolish - look at something you placed', percent: null, bad: true };
        return;
      }
      // What will be refunded is on screen before the hold completes.
      const quote = shop.refundQuote(target.id);
      if (input.grabHeld) demolishHold += dt;
      const pct = Math.min(100, Math.round((demolishHold / config.build.demolishHoldSeconds) * 100));
      hotbar.setStatus({
        mode: 'demolish',
        text: 'Hold LMB to remove ' + target.name + '  refund $' + quote + '  ' + pct + '%',
        bad: false,
      });
      buildNotice = {
        label: 'Hold LMB - remove ' + target.name + ' for $' + quote,
        percent: pct,
      };
      if (demolishHold >= config.build.demolishHoldSeconds) doDemolish(target);
      return;
    }

    const item = hotbar.current();
    if (!item) {
      ghost.hide();
      lastPlacement = null;
      hotbar.setStatus({ mode: 'idle', text: 'Nothing in hand', bad: false });
      return;
    }
    // A carryable has no hologram: it is in your hand, not going on the floor.
    if (!isBuildable(item)) {
      ghost.hide();
      lastPlacement = null;
      hotbar.setStatus({
        mode: 'idle',
        text: item.name + ' in hand - '
          + (isToolRow(item) ? 'hold LMB to use, ' : '')
          + 'press Q to throw it back out',
        bad: false,
      });
      return;
    }
    const a = view.aim();
    lastPlacement = resolvePlacement(item, a.origin, a.dir, rotation.get(), worldQuery);
    ghost.show(item, lastPlacement);
    hotbar.setStatus({
      mode: lastPlacement.free ? 'free' : 'build',
      grid: item.snap.grid,
      degrees: rotation.degrees(),
      reason: lastPlacement.reason,
      valid: lastPlacement.valid,
    });
    // Only the refusal. A placement that is going to work says so by being a
    // hologram standing where you are pointing; a "Ready" label under it would
    // be a permanent line of text that never once told the player anything.
    if (lastPlacement.valid === false && lastPlacement.reason) {
      buildNotice = { label: reasonText(lastPlacement.reason), percent: null, bad: true };
    }
  }

  // Selecting a hotbar slot. Local and instant on every machine; the host is
  // told so the roster (and therefore every other player's view of your hands)
  // agrees. On a client the SELECT request is the notification, not a question:
  // it moves nothing in the world.
  function selectSlot(i) {
    const n = hotbar.select(i);
    audio.ui('click');
    net.act({ a: REQ.SELECT, i: n });
    return n;
  }

  const FINE = (config.build.fineStepDegrees * Math.PI) / 180;

  function handleKeys() {
    const codes = input.consumeKeys();
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      // Escape is one key with one meaning: back out of whatever is in front of
      // you. Innermost panel first, and when nothing is open it opens the menu,
      // so there is no second "menu key" to remember and no state in which
      // Escape does nothing.
      if (c === 'Escape') {
        if (settingsUI.isOpen()) settingsUI.close();
        else if (shopUI.isOpen()) shopUI.close();
        // NOT forced. lobby.close() defaults to force:true, which is how the
        // network layer closes the room when the session really ends -- driving
        // it from Escape walked straight past the lobby's own waiting-room
        // guard and dropped the player into the world while still in a room
        // with nothing on screen saying so. Passing false asks the lobby, and
        // the lobby says "The room is waiting. Start it, or leave." like it
        // does for its own Back button.
        else if (lobby.isOpen()) lobby.close(false);
        // The summary answers Escape like every other panel. It used to be the
        // one screen that did not: its only exit was a button a short viewport
        // can push off the bottom of the panel, and the documented recovery was
        // reloading the page. Nothing here is destructive -- the session is
        // already over and the numbers stay readable from the menu's End panel.
        else if (summaryUI.isOpen()) summaryUI.hide();
        else menu.toggle();
        continue;
      }
      // M is the multiplayer lobby. It never blocks the game: the loop keeps
      // running behind it and closing it hands control straight back.
      if (c === 'KeyM' && !menu.isOpen() && !settingsUI.isOpen()) { lobby.toggle(); continue; }
      if (menu.isOpen() || settingsUI.isOpen() || lobby.isOpen() || summaryUI.isOpen()) continue;
      // E is THE interact key and it acts on what the crosshair is on: an item
      // lying on the floor first, the booth otherwise. Inventing a second pick-up
      // key would leave the player guessing which one this object wants.
      // BEHIND THE WHEEL THE KEYBOARD MEANS SOMETHING ELSE. This block comes
      // first and swallows everything it handles, because a driver pressing E
      // wants to get out of the truck and not to open a shop they are sitting
      // three metres above. Only the panel keys above this line still work.
      if (driving) {
        if (c === 'KeyE') { exitTruck(); continue; }
        // The tailgate: one key, one flap. It is a toggle rather than a hold
        // because it has exactly two useful states and holding a key open to
        // keep a gate open is a hand you cannot steer with.
        if (c === 'KeyR') {
          const rec = vehicles.byKey(driving);
          if (rec) { vehicles.setGate(driving, rec.gateWant > 0.5 ? 0 : 1); audio.rotated(); }
          continue;
        }
        // The bed is Q/Z, held: up while you hold it, down while you hold the
        // other, and it stops where you let go. That is what a real tipper's
        // lever does, and it is the only way to pour half a load.
        if (c === 'KeyQ' || c === 'KeyZ') continue;
        continue;
      }
      if (c === 'KeyE') {
        if (shopUI.isOpen()) shopUI.close();
        else if (pickupTarget()) pickUp();
        // A truck you are standing next to answers E before anything else on
        // the plate does: it is three metres of vehicle, so if it is in range
        // it is unambiguously what the player meant.
        else if (vehicles.nearest(player.position())) enterTruck();
        // A garage sells another truck for config.vehicle.spawnCost. The first
        // one came with the building; this is how you get a second.
        else if (garageTarget()) {
          const out = spawnTruck(garageTarget(), false);
          if (!out.ok) {
            hud.showCap(out.reason === 'money'
              ? `A truck costs $${config.vehicle.spawnCost}.`
              : `This garage already keeps ${config.vehicle.maxPerSpawner} trucks.`);
            audio.placementRefused();
          } else audio.placed(player.position());
        }
        // The gambling box answers the same key, after the floor and before the
        // booth: a delivery lying against the box is still the thing you meant,
        // and the box is a metre wide so it can never be confused for the shop.
        else if (gambleTarget()) doGamble();
        else if (props.boothDistance(player.position()) <= config.booth.useRange) shopUI.open();
        continue;
      }
      if (shopUI.isOpen()) continue;
      // Q hands the item back to the world, which is how it changes hands.
      if (c === 'KeyQ') { throwItem(); continue; }
      if (c === 'KeyG') { rotation.reset(); continue; }
      // R and T are the keyboard equivalent of middle-click and shift+middle-click.
      // They are not a convenience: a trackpad has no middle button, so without
      // them a laptop player cannot rotate anything at all.
      // R pours a container before it rotates a hologram. The two never
      // compete: a hologram only exists with a BUILDING in hand, and this only
      // fires when the crosshair is on a container standing in the world.
      if (c === 'KeyR' && pourTarget()) { doPour(pourTarget()); continue; }
      if (c === 'KeyR') { rotation.step(1); audio.rotated(); continue; }
      if (c === 'KeyT') { rotation.step(-1); audio.rotated(); continue; }
      if (c === 'KeyX') { demolishing = !demolishing; demolishHold = 0; demolishTarget = null; continue; }
      if (c === 'BracketLeft') { rotation.nudge(-FINE); audio.rotated(); continue; }
      if (c === 'BracketRight') { rotation.nudge(FINE); audio.rotated(); continue; }
      if (c.indexOf('Digit') === 0) {
        const n = Number(c.slice(5)) - 1;
        if (n >= 0 && n < hotbar.slotCount) {
          // Pressing the slot you are already holding puts it away, so a hand
          // full of walls never blocks grabbing a duck.
          // Which slot is in your hand is LOCAL and instant, like the build
          // hologram: it changes nothing in the world, only what other players
          // see you carrying. The host is TOLD (so the roster and the avatars
          // agree) rather than asked, because a hotbar that waits for a round
          // trip before it responds reads as broken.
          selectSlot(n === hotbar.selectedIndex() ? -1 : n);
          demolishing = false;
        }
      }
    }
  }

  let frameNo = 0;
  let simTime = 0;
  let lastNow = 0;
  let crankedDucks = 0;
  const tracked = [];
  const rnd = seeded(config.tube.spawnSeed);

  hud.setMoney(world.economy.money());
  world.economy.onChange((money) => hud.setMoney(money));
  world.ducks.onCapRefusal(() => hud.showCap(world.ducks.capMessage()));

  function impulseFor(id, dir, speed) {
    const body = world.ducks.body(id);
    if (!body) return;
    const m = (typeof body.mass === 'function' ? body.mass() : config.ducks.mass) || config.ducks.mass;
    world.applyImpulse(body, { x: dir.x * speed * m, y: dir.y * speed * m, z: dir.z * speed * m });
  }

  // The workbench is the ONLY duck source. The tube overhead drops purchases and
  // never a duck. At the cap nothing spawns and the refusal is shown: nothing is
  // ever deleted to make room.
  function ejectDuck(rec) {
    if (world.ducks.atCap()) {
      hud.showCap(world.ducks.capMessage());
      return null;
    }
    const m = rec ? placed.machineMouth(rec) : props.machineMouth();
    const id = world.ducks.spawn({
      x: m.x + (rnd() - 0.5) * 0.06,
      y: m.y,
      z: m.z + (rnd() - 0.5) * 0.06,
    });
    if (id === null) return null;
    impulseFor(id, rec ? placed.machineEject(rec) : props.machineEject(), config.machine.ejectSpeed);
    crankedDucks++;
    return id;
  }

  // ONE STEP of held time on every wheel in the world. This is the whole of the
  // new crank: the button is not an action any more, it is a state, and this
  // runs once per frame on the HOST (and in single player, which is the same
  // code path with one slot). A client never gets here -- see updateCrankView().
  //
  // `holders` comes from net.crankHolders(), which is the host's own count of
  // who has the button down on which wheel and is re-reach-checked every frame.
  // Two holders means the charge advances twice as fast, by arithmetic.
  let crankPops = 0;
  let crankTicksHeard = 0;
  function tickWheel(unit, rec, holders, dt) {
    const r = rec ? benches.hold(rec, dt, holders) : machine.hold(dt, holders);
    if (!r) return;
    // A refused duck (pool at cap) hands the bar back FULL and parks the pop for
    // config.machine.capRetrySeconds, so a full pool does not fire the cap
    // message once per frame.
    for (let i = 0; i < r.pops; i++) {
      if (ejectDuck(rec) === null) {
        if (rec) benches.refund(rec); else machine.refund();
        break;
      }
      crankPops++;
    }
    // The gear sound is played per CLICK ANGLE the wheel crossed, so the ticking
    // accelerates with the wheel for free. Capped per frame: a long debugStep
    // must not queue four hundred voices.
    // Discrete gear clicks only while the wheel is slow enough for a click to
    // BE a click. Past clickSoundMaxRadPerSec the wheel crosses several click
    // angles per frame and the sound stops being ticks and starts being a
    // machine gun -- so it stops, which is also what a real gear train does when
    // it spins up into a whine. One per frame at most, always.
    const ticks = (r.omega <= config.machine.clickSoundMaxRadPerSec)
      ? Math.min(1, r.ticks || 0) : 0;
    for (let i = 0; i < ticks; i++) audio.crank();
    crankTicksHeard += r.ticks || 0;
    if (rec) placed.setWheelAngle(rec, benches.angle(rec));
    else props.setWheelAngle(machine.angle());
  }

  // --- the Auto-Cranker --------------------------------------------------------
  // A placed item that works a manual wheel for you. It is deliberately NOT a
  // producer: it does not make ducks, it does not have a rate, and it knows
  // nothing about charge. It registers as ONE MORE HOLDER on the nearest manual
  // wheel, and every rule of cranking then applies to it for free and cannot
  // drift -- the fill rate, the flywheel, Swift Hands, the cap refusal, the
  // co-op stacking with players and with other bots, all of it, because they are
  // all implemented once against a holder count.
  //
  // Selected by `kind`, never by id. Attachment is by proximity to a wheel hub
  // rather than by a socket on the bench, because a socket would be a second
  // placement system; config.machine.botAttachRange is the whole rule.
  const BOT_KIND = 'crank_bot';
  function isBotRow(row) { return !!row && row.kind === BOT_KIND; }

  // Every manual wheel in the world, as { key, x, y, z }. Key 0 is the starter
  // bench, exactly as in crankStates() and crankHolders().
  function wheelList() {
    const out = [];
    const w = props.wheelCenter();
    out.push({ key: 0, x: w.x, y: w.y, z: w.z });
    const list = placed.objects;
    for (let i = 0; i < list.length; i++) {
      const rec = list[i];
      if (!benches.has || !benches.has(rec)) continue;
      const c = placed.wheelCenter(rec);
      out.push({ key: rec.key, x: c.x, y: c.y, z: c.z });
    }
    return out;
  }

  // Which wheel each placed bot is working, nearest within range or none.
  function botAssignments() {
    const out = [];
    const list = placed.objects;
    let wheels = null;
    for (let i = 0; i < list.length; i++) {
      const rec = list[i];
      if (!isBotRow(byId(rec.id))) continue;
      if (!wheels) wheels = wheelList();
      let best = null;
      let bestD = config.machine.botAttachRange;
      for (let j = 0; j < wheels.length; j++) {
        const w = wheels[j];
        const d = Math.hypot(rec.x - w.x, rec.y - w.y, rec.z - w.z);
        if (d <= bestD) { bestD = d; best = w; }
      }
      out.push({ key: rec.key, wheel: best ? best.key : null, distance: best ? bestD : null });
    }
    return out;
  }

  // What the host merges into its holder count. HOST ONLY by construction: the
  // net layer never calls this on a client.
  function botHolders() {
    const out = new Map();
    const list = botAssignments();
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.wheel === null) continue;
      out.set(a.wheel, (out.get(a.wheel) || 0) + 1);
    }
    return out;
  }

  function updateCranks(dt) {
    const holders = net.crankHolders ? net.crankHolders() : new Map();
    tickWheel(machine, null, holders.get(0) || 0, dt);
    const list = placed.objects;
    for (let i = 0; i < list.length; i++) {
      const rec = list[i];
      if (!benches.has || !benches.has(rec)) continue;
      tickWheel(null, rec, holders.get(rec.key) || 0, dt);
    }
  }

  // A CLIENT's wheels. There is no charge here and there never can be -- the
  // charge is the host's -- but a wheel that only jumped when a percentage
  // arrived would read as a slideshow, so the client runs the SAME spin model
  // (src/sim/machine.js createSpin) off the percentages it is told. It is
  // animation and nothing else: no duck is ever produced on this path.
  const clientSpins = new Map();
  function clientSpin(key) {
    let s = clientSpins.get(key);
    if (!s) {
      s = createSpin({ ...MACHINE_TUNING.spin, clickAngle: (Math.PI * 2) / config.machine.clicksPerTurn });
      clientSpins.set(key, s);
    }
    return s;
  }
  function updateCrankView(dt) {
    const keys = net.crankKeys ? net.crankKeys() : [];
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const info = net.crankInfo(key);
      if (!info) continue;
      const s = clientSpin(key);
      if (info.popped) s.pop();
      // "Somebody is cranking" is the only thing a percentage stream can tell
      // us: it went UP, recently. Stale or falling means coast to a stop.
      const active = info.rising && info.ageMs <= config.machine.clientSpinIdleMs;
      s.update(dt, active, info.p);
      if (key === 0) props.setWheelAngle(s.angle());
      else {
        const rec = placed.objects.find((o) => o.key === key);
        if (rec) placed.setWheelAngle(rec, s.angle());
      }
    }
  }

  // What the crosshair is on: the starter bench's wheel, a purchased bench's
  // wheel, or nothing. The starter test lives in props.js next to the wheel's
  // own geometry and is shared with the crosshair outline, so the rim the player
  // sees light up and the thing this hold acts on are the same sphere by
  // construction; placed.crankAim runs the same test on every bought bench.
  // Returns null or { rec }, where rec is null for the starter one.
  //
  // Takes an EXPLICIT origin and direction because the host runs this same test
  // for a remote player, from where IT believes that player is looking. There is
  // exactly one wheel test in the game and this is it.
  function wheelAimFrom(origin, dir) {
    const starter = props.wheelAimDistance(origin, dir);
    const bought = placed.crankAim(origin, dir);
    if (starter >= 0 && (!bought || starter <= bought.distance)) return { rec: null };
    return bought ? { rec: bought.rec } : null;
  }

  function wheelUnderCursor() {
    const a = view.aim();
    return wheelAimFrom(a.origin, a.dir);
  }

  function crankProgress(target) {
    if (!target) return 0;
    const key = target.rec ? target.rec.key : 0;
    // A client's own copy of a workbench is never cranked: the crank happens in
    // the host's world and only its RESULT comes back. Reading the local record
    // here meant the percentage on a client sat at whatever it was when the
    // bench arrived and never moved, however hard that player turned the wheel.
    if (net.isClient && net.isClient()) {
      const p = net.crankProgressOf(key);
      return p === null ? 0 : p;
    }
    return target.rec ? benches.progress(target.rec) : machine.progress();
  }

  // Every crank in the world, host side, as the reconciler wants to diff it:
  // the starter machine on the plate is key 0, purchased benches are their
  // placement key.
  function crankStates() {
    const out = [{ key: 0, p: machine.progress() }];
    const list = placed.objects;
    for (let i = 0; i < list.length; i++) {
      const rec = list[i];
      if (!benches.has || !benches.has(rec)) continue;
      out.push({ key: rec.key, p: benches.progress(rec) });
    }
    return out;
  }

  // --- the crank, head-down ----------------------------------------------------
  // A feature that needs a human hand is untested by definition, and a held
  // button is the easiest thing in the world to fake badly. So these drive the
  // REAL layers: the camera, input.pressGrab(), and loop.step(). Nothing here
  // calls machine.hold() or net.act({a:CRANK}) behind the input layer's back --
  // if the button is not actually down, none of this produces a duck.

  function crankProgressOfKey(key) {
    if (net.isClient && net.isClient()) {
      const p = net.crankProgressOf(key);
      return p === null ? 0 : p;
    }
    if (!key) return machine.progress();
    const rec = placed.objects.find((o) => o.key === key);
    return rec ? benches.progress(rec) : 0;
  }

  function crankOmegaOfKey(key) {
    if (net.isClient && net.isClient()) {
      const s = clientSpins.get(key);
      return s ? s.omega() : 0;
    }
    if (!key) return machine.omega();
    const rec = placed.objects.find((o) => o.key === key);
    return rec ? benches.omega(rec) : 0;
  }

  function crankHolderCount(key) {
    if (!net.crankHolders) return 0;
    const m = net.crankHolders();
    if (key === undefined) {
      let n = 0;
      m.forEach((v) => { n += v; });
      return n;
    }
    return m.get(Math.round(Number(key)) || 0) || 0;
  }

  // Stand where the wheel can actually be seen. The wheel is on ONE SIDE of the
  // cabinet and props.wheelAimDistance refuses an aim from the other side (its
  // stand-in for an occlusion test, there since v1) -- so a test that teleports
  // to a tidy round number like x=0 and looks at the wheel gets a null aim, no
  // hold, and a machine that looks broken when it is not. This puts the player
  // on the wheel's side by construction so nobody has to know that rule.
  function standAtWheel(key) {
    const k = Math.round(Number(key)) || 0;
    const rec = k ? placed.objects.find((o) => o.key === k) || null : null;
    const w = rec ? placed.wheelCenter(rec) : props.wheelCenter();
    // Model-local +X in world -- the side the wheel is on. For a placed bench
    // that is (rec.c, -rec.s), which is the exact expression placed.crankAim
    // guards with, read off the record rather than recomputed from a yaw.
    const right = rec ? { x: rec.c, z: -rec.s } : props.machineRight();
    const d = config.machine.useRange * 0.4;
    return { x: w.x + right.x * d, y: 1.2, z: w.z + right.z * d, wheel: w };
  }

  // The one line debugTeleport is built on, factored out so the crank harness
  // can place the player without going through window.GAME.
  function teleportPlayer(pos) {
    const raw = world._raw;
    if (!raw || player.handle === undefined) return null;
    const body = raw.getRigidBody(player.handle);
    if (!body) return null;
    body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    return player.position();
  }

  // Point the camera at a wheel and let the frame after it adopt the look --
  // this project's oldest harness trap: the camera takes a new look on the NEXT
  // frame, so aiming and acting in the same call aims at wherever you were.
  function aimAtWheel(key) {
    const rec = key ? placed.objects.find((o) => o.key === key) || null : null;
    const center = rec ? placed.wheelCenter(rec) : props.wheelCenter();
    const eye = player.eyePosition();
    lookAt(eye, center);
    const inp = input.read();
    view.updateCamera(eye, inp.yaw, inp.pitch);
    return center;
  }

  // Step `seconds` of frames with the button already down, sampling as it goes.
  function stepHeld(key, seconds, o) {
    const dt = config.loop.fixedDt;
    const n = Math.max(0, Math.round((Number(seconds) || 0) / dt));
    const before = crankedDucks;
    const samples = [];
    for (let i = 0; i < n; i++) {
      loop.step(dt);
      if (o && o.sample) {
        samples.push({
          t: Number(((i + 1) * dt).toFixed(3)),
          p: Number(crankProgressOfKey(key).toFixed(4)),
          w: Number(crankOmegaOfKey(key).toFixed(3)),
          d: crankedDucks - before,
        });
      }
    }
    return {
      key,
      heldSeconds: Number((n * dt).toFixed(3)),
      ducks: crankedDucks - before,
      progress: crankProgressOfKey(key),
      omega: crankOmegaOfKey(key),
      holders: crankHolderCount(key),
      grabHeld: input.grabHeld,
      samples,
    };
  }

  function holdWheel(key, seconds, o) {
    const dt = config.loop.fixedDt;
    // Walk-free tests stand wherever they were teleported, and the wheel is only
    // visible from one side. Unless the caller says `stay`, put the player where
    // the wheel can be seen first -- this is the single trap that made a working
    // crank look dead in another harness.
    if (!(o && o.stay)) {
      const s = standAtWheel(key);
      const p = player.position();
      const already = Math.hypot(p.x - s.wheel.x, p.z - s.wheel.z) <= config.machine.useRange
        && wheelAimFrom({ x: p.x, y: p.y + 0.7, z: p.z },
          { x: s.wheel.x - p.x, y: 0, z: s.wheel.z - p.z });
      if (!already) { teleportPlayer(s); loop.step(dt); }
    }
    aimAtWheel(key);
    loop.step(dt);              // the camera adopts the look here
    const aimed = wheelUnderCursor();
    input.pressGrab();
    loop.step(dt);              // the down edge is drained here
    const r = stepHeld(key, seconds, o);
    if (!(o && o.keepHeld)) {
      input.releaseGrab();
      loop.step(dt);
    }
    return { ...r, aimedAtWheel: !!aimed, aimedKey: aimed ? (aimed.rec ? aimed.rec.key : 0) : null };
  }

  function syncBodies() {
    for (let i = 0; i < tracked.length; i++) {
      view.setPose(tracked[i], world.bodyPose(tracked[i]));
    }
  }

  // Is THIS player's button currently down on a wheel? Local bookkeeping only:
  // it decides which request the up edge sends, never what the world does.
  let cranking = false;
  // Which wheel the hold started on, so the bar keeps reporting THAT one while
  // the crosshair wanders off it.
  let crankHeldTarget = null;
  function releaseCrank() {
    cranking = false;
    crankHeldTarget = null;
    net.act({ a: REQ.CRANK, down: false });
  }

  // SAY WHY IT DID NOT WORK.
  //
  // Every action in this file goes through net.act(), which returns the host's
  // verdict -- and about sixteen of those verdicts were being thrown away on the
  // floor. The reasons already existed and were already written in English
  // ('too far from the workbench', 'already holding something', 'nothing to
  // grab'); nothing ever showed them, so a refused grab was indistinguishable
  // from a dropped input, and the player's only theory was that the game had
  // missed the click.
  //
  // Three things this does not do, each of them on purpose:
  //   - it says nothing on a PENDING result. On a client the answer has not
  //     arrived yet; it comes back through net's onReject, which routes to this
  //     same message box through this same translator.
  //   - it says nothing on success, obviously, and nothing when there is no
  //     reason to give -- a verdict with no words is a bug in the verdict, not a
  //     message to invent one for.
  //   - it does not dress the words itself. reasonText() is the one place a
  //     refusal becomes a sentence, so the solo path and the client path cannot
  //     print the same refusal two different ways.
  function reportRefusal(res) {
    if (!res || res.ok || res.pending) return null;
    if (!res.reason) return null;
    const text = reasonText(res.reason);
    hud.showCap(text);
    return text;
  }

  // Hold to carry: the down edge grabs, the up edge drops. A down edge aimed at
  // the wheel starts a CRANK HOLD instead of grabbing, so the two never fight.
  function handleActions(onWheel) {
    const a = input.consumeActions();
    if (a.rotate) {
      const dir = a.rotate > 0 ? 1 : -1;
      for (let i = 0; i < Math.abs(a.rotate); i++) rotation.step(dir);
      audio.rotated();
    }
    // Every one of these four goes through net.act, which in single player is
    // still perform(0, req) on the same controller in the same frame -- and on a
    // client is a question to the host and nothing else. There is no branch here
    // that grabs locally, which is frozen contract rule 6 made structural rather
    // than remembered.
    if (a.scroll) net.act({ a: REQ.HOLD_DIST, n: a.scroll });
    for (let i = 0; i < a.throw; i++) {
      if (net.holdingLocal()) reportRefusal(net.act({ a: REQ.HURL }));
    }
    for (let i = 0; i < a.grabDown; i++) {
      if (shopUI.isOpen()) break;
      // Demolish is a hold, timed in updateBuild; the down edge only starts it.
      if (demolishing) { demolishHold = 0; continue; }
      // An equipped tool OWNS the grab button. It is asked, never assumed: the
      // tool module is the single authority on whether the button is its own,
      // and it stops saying yes the moment the tool leaves the hand.
      // Through the request door like everything else. On a host and in single
      // player this lands on the same tool module it always did; on a client it
      // is a question, and the ducks move because the HOST's broom moved them.
      if (tools.takesGrabButton()) { reportRefusal(net.act({ a: REQ.TOOL, down: true })); continue; }
      // A BUILDING in hand means the click places it, never grabs. A carryable
      // that is not a tool (an empty bucket, say) does neither, so it leaves the
      // grab button alone instead of swallowing it.
      if (isBuildable(hotbar.current())) { doPlace(); continue; }
      if (net.holdingLocal()) continue;
      // The wheel is HELD, not clicked. The down edge starts the hold and
      // carries the aim as evidence -- no workbench id, because the host runs
      // its own wheel test; see REQ.CRANK. Everything between the edges happens
      // in the host's world, once per frame, in updateCranks().
      if (onWheel) {
        const aim = view.aim();
        cranking = true;
        crankHeldTarget = onWheel;
        // A refused crank must ALSO drop the local hold flag, or the button is
        // held against a wheel the host said no to and the up edge later sends a
        // release for a hold that never started.
        const r = net.act({
          a: REQ.CRANK,
          down: true,
          o: [aim.origin.x, aim.origin.y, aim.origin.z],
          d: [aim.dir.x, aim.dir.y, aim.dir.z],
        });
        if (reportRefusal(r)) { cranking = false; crankHeldTarget = null; }
      } else {
        // The aim travels as evidence, not as a target id: the host casts the
        // ray itself and decides what was hit.
        const aim = view.aim();
        reportRefusal(net.act({
          a: REQ.GRAB,
          o: [aim.origin.x, aim.origin.y, aim.origin.z],
          d: [aim.dir.x, aim.dir.y, aim.dir.z],
        }));
      }
    }
    for (let i = 0; i < a.grabUp; i++) {
      if (demolishing) { demolishHold = 0; continue; }
      if (tools.takesGrabButton()) { reportRefusal(net.act({ a: REQ.TOOL, down: false })); continue; }
      // A release that ends a crank is not a drop. Without this the up edge fell
      // through to REQ.DROP, which is harmless but noise, and the hold would
      // never be told to stop.
      if (cranking) { releaseCrank(); continue; }
      net.act({ a: REQ.DROP });
    }
    // The safety net for every way a button can stop being down without an up
    // edge reaching this loop: the shop taking the cursor, the window losing
    // focus, a swallowed relock click. A hold that outlived its button would
    // print ducks forever, which is exactly the autoclicker this replaces.
    if (cranking && !input.grabHeld) releaseCrank();
    hud.setHolding(net.holdingLocal());
  }

  // completeStep() returns true only on the frame a step actually advances, so
  // the fanfare fires once per step rather than every frame after it.
  function onboardingStep(id) { if (hud.completeStep(id)) audio.achievement(); }

  // THE CUTSCENE LEAK, and why these three numbers exist.
  //
  // Every trigger below reads a LIFETIME total -- ducks scored, ducks grabbed,
  // ducks cranked -- and the intro flies over a world that is doing all three:
  // it stages a pile, drops ducks down the chute and lands some of them in the
  // pit. updateOnboarding() is not called while the camera is flying, so none of
  // that ticked a step as it happened; it ticked on the FIRST frame after the
  // intro, all at once, before the player had moved a step. That is the
  // "`score` was already ticked before I moved" defect, and it is not a bug in
  // the trigger: the trigger was reading the world's total and calling it the
  // player's.
  //
  // So the totals are baselined the moment the player takes control. Everything
  // below asks "since you got here", which is the only question onboarding was
  // ever asking. Rebaselined on every hand-over (a solo start, a room start, a
  // skipped intro) because each of those is a fresh player taking control of a
  // world that has been running without them.
  let onboardBase = null;
  function resetOnboardingBaseline() {
    onboardBase = {
      scored: world.pit ? world.pit.totalScored() : 0,
      grabs: world.hold ? world.hold.grabCount() : 0,
      cranks: crankPops,
      places: placeCount,
    };
    return onboardBase;
  }

  function updateOnboarding(pos) {
    if (!onboardBase) resetOnboardingBaseline();
    const b = onboardBase;
    const t = props.machineBase();
    const dx = pos.x - t.x;
    const dz = pos.z - t.z;
    if (dx * dx + dz * dz < config.hud.machineHintRadius * config.hud.machineHintRadius) {
      onboardingStep('walk');
    }
    // Cranking is its own step now. It used to be the back half of "walk to the
    // workbench and crank out a duck", which completed on ARRIVING -- so the
    // step taught two things and was satisfied by one of them.
    if (crankPops > b.cranks) onboardingStep('crank');
    // On a CLIENT the local slot-0 controller never grabs anything (the hold
    // lives in the host's world), so the onboarding step reads the same fact the
    // HUD does rather than a counter that can only ever move in single player.
    if (world.hold.grabCount() > b.grabs || net.holdingLocal()) onboardingStep('grab');
    if (world.pit.totalScored() > b.scored) onboardingStep('score');
    // The second half of the loop.
    // 'shop'  standing at the booth: the same test the crosshair prompt uses to
    //         decide whether E opens the shop, so the hint cannot ask for a key
    //         that would do nothing.
    // 'buy'   fired from the purchase notification (shop.onPurchase, above), not
    //         from here: a purchase is an event, and it is the same event on a
    //         host and on a client.
    // 'place' the last step, and the reason the list no longer stops at 'buy':
    //         a purchase is an object in the hotbar and the player was never
    //         told what to do with it. placeCount moves for exactly one reason
    //         (doPlace succeeded), so this cannot tick on somebody else's build.
    if (placeCount > b.places) onboardingStep('place');
    if (props.boothDistance(pos) <= config.booth.useRange) onboardingStep('shop');
  }

  // Changing the backbuffer width reallocates the drawing buffer and leaves it
  // CLEARED. Whatever the compositor takes next is therefore an empty canvas --
  // black, or the page's #0a0f1e showing through the transparent buffer -- which
  // is the "screen flashes black / dark blue" defect: the adaptive quality step
  // ran after renderer.render(), so every width change presented one blank
  // frame, and it changed every few seconds while the sampler hunted between
  // two widths. A fresh buffer is never handed over undrawn.
  function applyBufferWidth(w) {
    const sized = renderer.applySize(w);
    view.setAspect(sized.aspect);
    renderer.render(view.scene, view.camera);
    return sized;
  }

  // The chrome the world wears, off while the camera is flying and back on the
  // instant it lands. ONE switch, so nothing can be left hidden by a skip.
  let cinematicOn = false;
  let lastFrameMs = 0;
  function setCinematicChrome(on) {
    cinematicOn = !!on;
    // Nothing is hidden HERE. src/cutscene.js owns the one switch -- a single
    // `cinematic` class on <html> plus an allowlist of what survives -- because
    // hiding panel by panel works right up until somebody adds an eleventh
    // panel and never thinks about an intro they have not seen. This function
    // only turns off the things that are not DOM: the build hologram, which is
    // geometry in the scene and would happily float through a cutscene.
    if (cinematicOn) ghost.hide();
    return cinematicOn;
  }

  function frame(dt, source) {
    const t0 = performance.now();
    // Stamped every frame from every source. A host reads it to decide whether
    // requestAnimationFrame has gone quiet -- which is exactly what happens the
    // moment the host's tab is hidden -- and takes the simulation over on its
    // worker clock when it has. While the tab is visible this is only a stamp.
    net.beginFrame();
    const inp = input.read();
    // A driver's WASD steers the truck, so it must NOT also walk the capsule --
    // otherwise the player would be trying to run out of the cab every frame
    // while being pinned back into it by carryRiders(). The look is untouched:
    // the mouse swings the camera round the truck, and steering is the keys.
    if (driving) {
      driveFromInput(inp);
      truckAudio(dt);
      inp.fwd = 0;
      inp.right = 0;
      inp.jump = false;
      inp.sprint = false;
    }
    player.update(dt, inp);
    applyColliderFilters();
    syncContainers();
    syncGambleBoxes();
    syncEquippedTool();
    // Before the step, because the step is what scores ducks: the value a duck
    // pays this frame is the multiplier the stat table says right now, including
    // a prestige taken one frame ago or a multiplier a snapshot just restored.
    applyStats();
    // Who is allowed to pay for a duck that reaches the bottom. Asked every
    // frame rather than wired to a join event, because the answer changes when a
    // player joins or leaves a room and a missed event would leave a client
    // quietly minting money. See pit.setScoring().
    if (world.pit && world.pit.setScoring) world.pit.setScoring(!(net.isClient && net.isClient()));
    world.step(dt);
    const physMs = performance.now() - t0;
    perf.setPhysMs(physMs);
    simTime += dt;

    // The pit's events were already being produced and thrown away; the summary
    // reads its rarest-duck line off the same pass rather than keeping a second
    // tally somewhere that can disagree with this one.
    // consumeEvents() DRAINS, so it is called once and the list is handed to
    // both readers. Two callers would each get half the events.
    const pitEvents = world.pit.consumeEvents();
    sessionStats.notePitEvents(pitEvents);
    audio.notePitEvents(pitEvents);

    // The vendor's shelf turns over on SIMULATION time, not wall time, so
    // debugStep drives it like everything else and a three-minute period is
    // three minutes of the game rather than three minutes of the tab being
    // open. The second argument is the multiplayer rule: only a host rolls.
    // A client ticks the same clock so its countdown is live, and its units
    // change only when EV.STOCK arrives.
    stock.advance(dt, !net.isClient());
    // The panel's countdown is live while it is open, and tick() re-renders the
    // rows only when the shelf actually changed -- which covers the period
    // turning over here AND a client being handed a new shelf by EV.STOCK,
    // without either of those needing to know the panel exists.
    if (shopUI.isOpen()) shopUI.tick();

    // Automation runs after the physics step and before the render sync, so a
    // duck produced this frame is drawn this frame. Both systems act only
    // through impulses on woken bodies; neither moves anything by hand.
    // The manual wheels, before the automated ones: a held crank is a duck
    // source like a press is, and it is now a per-frame integration rather than
    // an event. HOST AND SINGLE PLAYER ONLY -- on a client the charge lives in
    // the host's world and only its percentage comes back, so all a client does
    // is animate (updateCrankView), which cannot produce anything.
    if (net.isClient()) updateCrankView(dt);
    else updateCranks(dt);
    // The gambling boxes. Stepped on EVERY tab, because the shake, the lid and
    // the colour are an animation and a client has to see them too; the PRIZE is
    // drained one line below and only where the world is owned, so nothing a
    // client does here can hand anybody anything.
    gamble.step(dt);
    if (!net.isClient()) pumpGambleEvents();
    // A CLIENT MAY NOT MAKE DUCKS. producers.update() spawns into this tab's own
    // pool, and on a client the host never hears about it: the duck gets no
    // poses, no removal and nobody else can touch it. That is exactly the
    // reported bug -- "the ducks the machine spat out are still there for the
    // other player, and he cannot move them" -- and it is the same mistake the
    // pit made until it was told to stop scoring on a client. The gate belongs
    // beside pumpDeliveries and updateCranks, which have always had one.
    if (!net.isClient()) producers.update(dt);
    // Collectors only apply impulses to bodies that already exist, so they are
    // harmless in either role and stay ungated.
    collectors.update(dt);
    // Belts and fans push INSIDE the substep loop (world.onFixedUpdate below);
    // this is only where their OR-accumulated substep flags are committed, once
    // per frame, after the loop has finished.
    conveyors.endFrame();
    blowers.endFrame();

    // CLIENT ONLY, and it runs AFTER the local solver on purpose: the host is
    // the authority, so whatever the local step did to a duck or a crate is
    // overwritten by the host's interpolated pose. The one body this does not
    // touch is the client's own capsule, which is predicted and then reconciled
    // -- and only against the part of the disagreement its own recent path
    // cannot explain, because a host pose is a round trip old and correcting
    // towards it every frame is what made walking feel like wading.
    // On a host and in single player this returns null and does nothing.
    net.postStep();

    syncBodies();
    const resized = renderer.syncSize();
    if (resized) view.setAspect(resized.aspect);
    // THE INTRO DRIVES THE REAL CAMERA. It is not a video: it is the same
    // view.updateCamera() call the player's own eye goes through, one line
    // below, pointed somewhere else. Everything on screen is the running world.
    // `lastFrameMs` is the previous frame's measured cost, which is what the
    // cutscene records as its worst frame -- this frame's cost is not known yet.
    const csPose = cutscene && cutscene.isActive() ? cutscene.update(dt, lastFrameMs) : null;
    const eye = player.eyePosition();
    const truckEye = csPose ? null : truckCamera(inp.yaw, inp.pitch);
    if (csPose) view.updateCamera(csPose, csPose.yaw, csPose.pitch);
    else if (truckEye) view.updateCamera(truckEye, inp.yaw, inp.pitch);
    else view.updateCamera(eye, inp.yaw, inp.pitch);
    // Every piece of interface the world normally wears comes off while the
    // camera is flying: a crosshair, a build hologram or a "Press E - Shop"
    // prompt in the middle of a cinematic is what makes an in-engine intro read
    // as a debug camera instead of a trailer.
    const cinematic = !!csPose;
    if (cinematic !== cinematicOn) setCinematicChrome(cinematic);
    // The TARGET, not a boolean: `x && y && z` evaluates to its last truthy
    // operand, so writing this as one chain handed the click `true` instead of
    // the workbench it was aimed at -- and a crank with no target is the starter
    // machine, 35 m away. That is exactly the defect the owner saw.
    const onWheel = (cinematic || shopUI.isOpen() || hotbar.current() || demolishing)
      ? null
      : wheelUnderCursor();
    // Keys first (they can change what is in hand), then the hologram, then the
    // click that acts on it -- all three off the camera set one line above, so
    // the preview and the placement see exactly the same aim.
    handleKeys();
    updateBuild(dt);
    handleActions(onWheel);
    // What is in hand is drawn where hands are: view space, written from the
    // camera that was just updated, so it never lags a frame behind the look.
    handView.set(isHandCarryable(hotbar.current()) ? hotbar.current() : null);
    handView.update(view.camera);
    const nearBooth = props.boothDistance(player.position()) <= config.booth.useRange;
    const pickable = pickupTarget();
    // The gambling box under the crosshair, and whether it is mid-roll. Both are
    // needed by the prompt: what it costs before you press, and that it heard
    // you afterwards -- a box that shakes for two and a half seconds with the
    // prompt still saying "Press E" reads as a button that did nothing.
    const gambleAt = cinematic ? null : gambleTarget();
    // Build and demolish notices come first: when a mode owns the crosshair, the
    // thing it is refusing or removing beats "Press E - Shop" every time.
    //
    // The FOURTH argument names the button each of these is about. It is not
    // decoration: hud.setPrompt hands it to the onboarding line, which stands
    // down while a contextual prompt has claimed the same button. That is what
    // stops "Hold left click to carry a duck" and "Hold left click to crank"
    // being on screen together at the wheel. Every branch that mentions a button
    // in its words must name that button here, or the two will argue again.
    const promptLabel = cinematic ? null
      : shopUI.isOpen() ? null
      : buildNotice ? buildNotice.label
        : pickable && pourableCount(pickable.prop)
          ? 'Press E - Pick up ' + pickable.row.name
            + '   R - Pour out ' + pourableCount(pickable.prop)
          : pickable ? 'Press E - Pick up ' + pickable.row.name
          : gambleAt
            ? (gamble.isRolling(gambleAt.rec.key)
              ? 'Rolling...'
              : 'Press E - Gamble ($' + config.gamble.rollCost + ')')
          : onWheel && !net.holdingLocal() ? 'Hold left click to crank'
            : nearBooth ? 'Press E - Shop'
              : null;
    // Only an INSTRUCTION claims a button. A refusal and a status are not
    // instructions and must not silence the onboarding line: "No ground in view"
    // is the game reporting, "Hold LMB - remove Conveyor for $70" is the game
    // telling you what the button does. Getting this wrong hid the last
    // onboarding step -- the one that teaches placing -- for exactly as long as
    // the player was pointing somewhere they could not build, which is precisely
    // when they most needed reading. Same reasoning for "Rolling...": the box
    // heard you, there is nothing to press.
    const promptInput = cinematic || shopUI.isOpen() ? null
      : buildNotice ? (buildNotice.bad ? null : 'lmb')
        : pickable ? 'e'
          : gambleAt ? (gamble.isRolling(gambleAt.rec.key) ? null : 'e')
            : onWheel && !net.holdingLocal() ? 'lmb'
              : nearBooth ? 'e'
                : null;
    hud.setPrompt(
      promptLabel,
      // NO NUMBER on the crank. The bar under the crosshair is the whole readout
      // now -- a percentage beside the prompt is something you read instead of
      // watching the wheel, which is the opposite of what the hold is for. The
      // demolish/build notice keeps its percent: that one is a countdown, not a
      // gauge, and it has no bar of its own.
      buildNotice ? buildNotice.percent : null,
      !!(buildNotice && buildNotice.bad),
      promptInput
    );
    // The fill bar. Shown while the crosshair is on a wheel OR while this player
    // is still holding one, so a hand that drifts off the rim mid-fill does not
    // make the bar vanish -- the charge is still there and the bar has to say so.
    const barTarget = (cinematic || (onWheel && !pickable)) ? (cinematic ? null : onWheel)
      : (cranking ? crankHeldTarget : null);
    hud.setCrank(barTarget ? crankProgress(barTarget) * 100 : null);
    if (!cinematic) updateOnboarding(player.position());
    // Remote players: interpolated off wall-clock stamps, because that is the
    // clock the samples arrive on. Nothing about them is simulated here.
    // NOT during the intro: shot 4's four players are staged through this same
    // avatar view, and the room's real roster would overwrite them mid-shot.
    if (!cinematic) syncAvatars();
    // The intro's set settles while the waiting room is up, a few substeps a
    // frame. A no-op unless a room has been opened and the pile is still awake.
    if (cutscene) cutscene.pumpPrepare();
    // The waiting room, on a HOST. A client's roster arrives as a message and
    // reaches the panel through net's onRoster; a host builds its own and
    // nothing ever tells it, so the panel is pushed here while it is on screen.
    // Throttled: it is a menu, not a gauge.
    if (lobby.isOpen() && !net.isClient() && !net.isSingle() && (frameNo % 12) === 0) {
      lobby.setPlayers(net.players());
    }
    avatars.update(performance.now(), view.camera);
    // The chute lets a few deliveries out per frame. HOST AND SINGLE PLAYER
    // ONLY: on a client a prop exists because the host said so and arrives in
    // the state stream, never because this tab decided to spawn one.
    // Ahead of syncProps so a prop that lands this frame is drawn this frame,
    // and clocked on simTime so debugStep drives it like everything else.
    if (!net.isClient()) pumpDeliveries(simTime);
    // The simulated clock, not the wall clock. Fan blades and the scrolling
    // airstream bands read it, and with the wall clock a head-down debugStep run
    // would advance them by real elapsed time instead of simulated -- the same
    // trap the audio layer's cooldowns already hit once in this project.
    // The hop, the lid and the flash, written into the instance pools straight
    // from the simulation's own numbers. Ahead of syncProps so a box that is
    // mid-leap this frame is drawn mid-leap this frame.
    updateGambleView();
    placed.syncProps(simTime);
    // Sound last: it reads the world the frame just produced and can never
    // change it. A throw in here is caught by the loop guard like any other,
    // but every call inside the audio layer is already no-op-on-failure.
    audio.update(dt);
    ducksView.sync(simTime);
    // The sky is one uniform, driven off the simulation clock so debugStep
    // advances it exactly like everything else.
    view.blackHole.update(simTime);
    // Outline width is in backbuffer pixels, so the shader needs the size of the
    // buffer it is actually drawing into -- which the adaptive quality system is
    // allowed to change under it.
    focus.setResolution(renderer.bufferWidth, renderer.bufferHeight);
    // Off while a mode already owns the crosshair: the hologram and the demolish
    // highlight say what is happening far better than a second outline would.
    focus.update(view.camera, view.aim(),
      !cinematic && !shopUI.isOpen() && !demolishing && !isBuildable(hotbar.current()));
    renderer.render(view.scene, view.camera);
    frameNo += 1;

    if (source === 'raf') {
      const now = performance.now();
      const ms = lastNow === 0 ? dt * 1000 : now - lastNow;
      lastNow = now;
      const next = perf.sample(ms, now);
      if (next !== renderer.bufferWidth) applyBufferWidth(next);
    }
    overlay.update(stats());
    // What this frame actually cost, handed to the next frame. The cutscene
    // reports its worst frame off this, so the number it prints is the same
    // number the overlay is reading rather than a second measurement.
    lastFrameMs = performance.now() - t0;
    // The cutscene's teardown, judged one frame after it happened -- see the
    // onDone handler for why it cannot be judged in the frame it ran in.
    if (auditPending) {
      // Re-assert the economy first: the pit can score in the single frame
      // between the teardown and this line, and it did -- $2 on a live host.
      const late = cutscene.restoreEconomy();
      lastCutsceneAudit = auditWorld(auditPending);
      lastCutsceneAudit.lateEconomy = late;
      auditPending = null;
    }
  }

  const loop = createLoop({ frame });

  // --- G4: host authority and the client -------------------------------------
  //
  // ONE object stands between the game and the network, and it is the only
  // thing in this file that knows a room exists. It runs three ways:
  //
  //   single player  net.act(request) performs the request immediately -- the
  //                  same implementation, in the same order, as before G4
  //   host           the same, plus a reconciler that broadcasts what CHANGED
  //                  to every client twenty times a second
  //   client         net.act(request) SENDS the request and does nothing else
  //
  // That last line is frozen contract rule 6, and it is enforced by there being
  // no client-side branch that performs anything: the world arrives afterwards,
  // in the broadcast every player receives at the same moment. The two agreed
  // exceptions, both local and both purely visual, are the build hologram and
  // which hotbar slot is in your hand.
  const net = createNetGame({
    world, state, placed, shop, hotbar, containers, machine, props, view, input, loop,
    player, byId, byNetId, resolvePlacement, worldQuery, isBuildable, isHandCarryable,
    // The ONE wheel test, handed to the host so a remote player's press is
    // resolved by the same function the local crosshair uses -- from the host's
    // own belief about where that player is looking, never from an id in a
    // message. There is no crankOnce any more: a crank is a held state that
    // main.js integrates once per frame, not an event the net layer fires.
    hud, wheelAimFrom, crankStates,
    // So a client's refusals read as sentences, exactly like a solo player's.
    reasonText,
    // The gambling box, in the same shape the wheel is handed over: ONE aim
    // test, run by the host from its own belief about where the asker is
    // looking, and ONE place that spends the money and starts the roll. No box
    // id ever travels in a message -- a client that could name a box could name
    // one on the far side of the plate.
    gambleAimFrom, gambleStart, gambleShow,
    // Auto-Crankers, as extra holders on whichever wheel each one is sitting at.
    // The net layer adds them to the players' holds and nothing downstream can
    // tell the difference, which is the point.
    botHolders,
    // The host's own tool, and a factory for everyone else's. Each remote
    // instance shares this world's ducks and impulse sink and differs only in
    // where it aims from.
    tools,
    makeTools: (getAim) => createTools({
      ducks: world.ducks,
      applyImpulse: world.applyImpulse,
      getAim,
      config,
      stepWorld: (dt) => loop.step(dt),
    }),
    // Prestige is a world change on a shared economy, so it goes through
    // perform(slot, req) like every other request and never happens locally on
    // a client. The host is the only slot allowed to call one; see REQ.PRESTIGE.
    prestige,
    // The vendor's shelf. The host rolls it and the reconciler broadcasts what
    // changed, exactly like the money; a client's copy is written only by what
    // arrives. See REQ.REROLL and EV.STOCK.
    stock,
    // Who is in the room, and what is in their hands. Fed straight to the
    // avatar layer, which the other G4 builder owns: this file is the only
    // place that knows both names.
    // ROSTER: who is in the room. syncAvatars() below owns avatars.setPlayers,
    // so this callback deliberately does NOT also call it. Two feeds into one
    // renderer with two different id conventions ('0' here, 'slot0' there) was
    // registering every player twice and letting each pass delete the other's
    // record; the symptom was an avatar that flickered between two identities
    // and never accumulated a usable pose history.
    // The colour this player picked, live from the settings store. It rides on
    // HELLO so the host can fold it into the roster, which is where the waiting
    // room and every other tab read a player's facts from.
    localColor: () => (settings ? settings.get('avatarColor') : config.menu.defaultColor),
    onRoster(list) {
      // syncAvatars() reads net.players() once per frame; the LOBBY does not,
      // and this is the event that tells it somebody's name, colour or ready
      // flag changed. On a host the roster is diffed by the reconciler and this
      // never fires, which is why the frame loop pushes it there -- see below.
      if (lobby) lobby.setPlayers(list);
    },
    // POSE: pushed the moment a sample exists, with the time it existed at --
    // arrival time on a client, tick time on a host, which is the only tab
    // where the pose is produced rather than received.
    // This is NOT a duplicate of syncAvatars -- it is the half that has to be
    // event driven. Sampling a 20 Hz stream from a 60 Hz frame stamps the same
    // host pose three times at three different instants, which turns smooth
    // motion into a stair step that the avatar's own interpolation then
    // faithfully reproduces. The id string is the one avatars.js was given by
    // setPlayers, because a pose for an unknown id silently creates a second
    // record for the same player.
    onPlayerPose(slot, pose, t) {
      if (slot === net.localSlot()) return;
      avatars.pushPose(AVATAR_ID(slot), pose, t);
    },
    onEvent(ev) {
      if (ev.type === 'hostgone' || ev.type === 'hostbye') {
        endSession(ev.reason || 'The host closed the room.');
      }
    },
  });
  netRef = net;
  // The audio layer is built before the network layer, so it is told where to
  // ask afterwards rather than reaching for a `net` that did not exist yet.
  audio.setHeldDuckSource((id) => net.isDuckHeld(id));

  // --- the intro -------------------------------------------------------------
  //
  // src/cutscene.js owns the timeline, the camera path and the beat grid. It
  // owns NO world: every object it stages is created through the hooks below,
  // which are the same placer, the same duck pool and the same drop path the
  // game itself uses -- that is what makes it in-engine rather than a video, and
  // it is also what makes the teardown provable, because everything it made
  // came through a function that recorded it.
  //
  // The economy is snapshotted and restored as a PAIR of numbers. A duck that
  // scores while the camera is rolling moves the balance and the lifetime earned
  // counter, and prestige is a function of the second one.
  const cutsceneStage = {
    // Placement goes through resolvePlacement() from six metres up, pointing
    // straight down: the same call the player's own hologram makes, so a set
    // dressed here obeys the grid, the plate margin and the pit keep-out
    // exactly as a built factory does.
    place(itemId, x, z, yaw) {
      const item = byId(itemId);
      if (!item || !item.collider) return null;
      const res = resolvePlacement(item, { x, y: 6, z }, { x: 0, y: -1, z: 0 },
        { yaw: Number(yaw) || 0, free: false }, worldQuery);
      if (!res.valid) return null;
      const rec = placed.place(item, res);
      return rec ? { key: rec.key, id: rec.id, x: rec.x, y: rec.y, z: rec.z } : null;
    },
    removePlaced(key) {
      const rec = placed.objects.find((r) => r.key === key);
      return rec ? placed.remove(rec) : false;
    },
    dropProp(itemId, pos, vel) {
      const item = byId(itemId);
      if (!item || !item.collider || !item.model) return null;
      const rec = placed.dropProp(item, pos, vel);
      return rec ? { key: rec.key, id: rec.id } : null;
    },
    removeProp(key) {
      const rec = placed.props.find((r) => r.key === key);
      return rec ? placed.despawnProp(rec) : false;
    },
    spawnDuck(pos, tier) { return world.ducks.spawn(pos, tier); },
    duckCounts() {
      const c = world.ducks.count();
      return { live: c.live, sleeping: c.sleeping, free: c.free };
    },
    // The ducks IN A SHOT, rather than in the world. The overflow shot's
    // contract is about the pile the camera is pointed at; a press ninety
    // metres away making its own ducks is not part of it, and counting those
    // would turn a true claim into a false one.
    duckCountsNear(x, z, r) {
      const r2 = r * r;
      let live = 0;
      let sleeping = 0;
      world.ducks.forEach((id, dx, dy, dz, qx, qy, qz, qw, tier, asleep) => {
        const ex = dx - x;
        const ez = dz - z;
        if (ex * ex + ez * ez > r2) return;
        live++;
        if (asleep) sleeping++;
      });
      return { live, sleeping };
    },
    // EVERY live duck, not only the ones the cutscene spawned: a press staged
    // for shot 3 makes its own, and a duck the intro caused is a duck the intro
    // has to take away.
    releaseAllDucks() {
      const ids = [];
      world.ducks.forEach((id) => { ids.push(id); });
      let n = 0;
      for (let i = 0; i < ids.length; i++) if (world.ducks.release(ids[i])) n++;
      return n;
    },
    step(dt) { loop.step(dt); },
    // PHYSICS ONLY, and it exists because of a reentrancy crash. The settle
    // pass is pumped from inside the frame loop, and stepping the whole LOOP
    // from inside it re-enters frame() -- Rapier answers that with "recursive
    // use of an object detected which would lead to unsafe aliasing in rust"
    // and the tab is done. Sleeping is a property of the solver, so the solver
    // is all the settle pass needs; running it a second time later in the same
    // frame is sequential, not nested, and is safe.
    stepWorld(dt) { world.step(dt); },
    // THE SESSION CLOCK MUST NOT MOVE WHILE THE SET IS BEING DRESSED.
    // src/sim/state.js defines the session clock as (base + elapsed simTime),
    // and the cutscene's settle pass steps the solver until every duck in the
    // pile is asleep -- 287 substeps, 4.78 SIMULATED SECONDS, inside about a
    // second and a half of wall time. That is setup, not session time, and
    // leaving it in the clock broke the one thing the clock is for here: the
    // host stamps EV.CUTSCENE with state.clock(), a client subtracts that from
    // the host clock it is currently seeing, and the 4.78 s of staging showed
    // up as "you are already 4.8 seconds into the intro". MEASURED: a client
    // that should have entered at t=2.0 entered at t=9.2 and cut straight to
    // shot 3. setClock() re-anchors the base so the drift is cancelled exactly.
    clockSnapshot() { return state.clock(); },
    clockRestore(v) { return state.setClock(v); },
    economySnapshot() {
      return { money: world.economy.money(), earned: world.economy.totalEarned() };
    },
    economyRestore(snap) {
      world.economy.set(snap.money);
      world.economy.setTotalEarned(snap.earned);
      return true;
    },
    tubeMouth() { return props.tubeMouth(); },
    setAvatars(list) { return avatars.setPlayers(list); },
    // WALL CLOCK, not cutscene time. src/render/avatars.js interpolates its
    // buffer against the same clock main.js hands avatars.update() -- which is
    // performance.now() -- and a sample stamped with anything else lands
    // outside the interpolation window and is hidden as stale. Four invisible
    // players is exactly what the first version of shot 4 rendered.
    pushAvatarPose(id, pose) { return avatars.pushPose(id, pose, performance.now()); },
    clearAvatars() { return avatars.clear(); },
  };

  cutscene = createCutscene({
    container,
    stage: cutsceneStage,
    // The BUS, not a bare `new Audio()`: the track goes through the same graph
    // src/audio/pitsynth.js plugs into, so the mixer, the mute and both volume
    // sliders apply to it. If the browser has not granted an AudioContext yet
    // the cutscene runs silently on its own clock rather than waiting.
    bus: audio.bus,
    onDone(end) {
      // Landing. Chrome back on, the pointer handed back, and -- the part that
      // matters -- the world audited against the boot baseline, so "the set was
      // struck" is a measurement rather than a claim.
      setCinematicChrome(false);
      // THE HAND-OVER. This is the instant the player takes control of a world
      // that has been running -- and scoring, and grabbing -- without them, so
      // it is where onboarding starts counting. Without this line every step
      // whose trigger the intro happened to satisfy was already ticked before
      // the player had moved. Here rather than in updateOnboarding() because
      // this is the event; a lazy first-call baseline would be taken on
      // whichever frame happened to run first and would not survive a skip.
      resetOnboardingBaseline();
      // The audit is taken ONE FRAME LATER, not here. finish() runs inside the
      // frame, before ducksView.sync() has had a chance to notice that 174
      // ducks were just released -- auditing on this line reported 218 live
      // instances against a boot baseline of 0 and called a clean teardown
      // dirty. The world is correct; the renderer had not been told yet.
      auditPending = end;
      if (!uiCapture()) input.requestLock();
    },
  });

  // The boot baseline the teardown is judged against: what a fresh session looks
  // like before anything has been staged. Taken once, here, because after this
  // line the world is whatever the player has done to it.
  let bootBaseline = null;
  let bootUI = null;
  let lastCutsceneAudit = null;
  let auditPending = null;
  const AUDIT_KEYS = [
    'ducksLive', 'ducksSleeping', 'placedObjects', 'droppedProps',
    'deliveriesPending', 'money', 'instances', 'avatars', 'bodies',
  ];
  function worldFingerprint() {
    const st = stats();
    const out = {};
    for (let i = 0; i < AUDIT_KEYS.length; i++) out[AUDIT_KEYS[i]] = st[AUDIT_KEYS[i]];
    out.totalEarned = world.economy.totalEarned();
    return out;
  }

  // WHAT IS ON SCREEN, as the browser actually computes it -- not as anybody's
  // flag claims. The cutscene hides the whole interface behind one class, and
  // the failure mode that matters is it not coming back: a player left with no
  // crosshair is worse off than a player who saw a crosshair during the intro.
  // So the restore is measured the same way the world teardown is, against a
  // boot baseline, key by key, and it covers the SKIPPED path as well as the
  // ended one because both go through the same line.
  function uiFingerprint() {
    const out = { rootClass: document.documentElement.className || '' };
    const seen = (node, prefix) => {
      for (let i = 0; i < node.children.length; i++) {
        const c = node.children[i];
        if (c.tagName === 'SCRIPT' || c.tagName === 'STYLE') continue;
        const id = c.id || (c.className ? '.' + String(c.className).split(' ')[0] : c.tagName);
        out[prefix + id] = getComputedStyle(c).display;
      }
    };
    seen(document.body, 'body/');
    if (container) seen(container, 'app/');
    return out;
  }
  function auditWorld(end) {
    const after = worldFingerprint();
    const afterUI = uiFingerprint();
    const diff = {};
    const uiDiff = {};
    let clean = true;
    if (bootBaseline) {
      // A ROOM IS NOT A FRESH BOOT IN TWO RESPECTS, and both are other people
      // rather than anything the intro left behind: every remote player has an
      // avatar in the view and a capsule in the world. The baseline is adjusted
      // by however many of them there are, so "clean" still means "the intro
      // left nothing" and does not quietly go false because somebody joined.
      const remotes = net.isSingle() ? 0 : Math.max(0, net.players().length - 1);
      const expected = {
        ...bootBaseline,
        avatars: bootBaseline.avatars + remotes,
        bodies: bootBaseline.bodies + remotes,
      };
      Object.keys(expected).forEach((k) => {
        if (after[k] !== expected[k]) { diff[k] = { boot: expected[k], after: after[k] }; clean = false; }
      });
      diff.__remotes = remotes;
      if (Object.keys(diff).length === 1) delete diff.__remotes;
    }
    if (bootUI) {
      // The menu is the ONE element allowed to differ: at boot it is open (it is
      // the first thing on screen) and after the intro it is not, because the
      // intro is what closed it. Every other element must read exactly as it did
      // on a fresh boot.
      const expected = { ...bootUI, 'app/menu': afterUI['app/menu'] };
      Object.keys(expected).forEach((k) => {
        if (afterUI[k] !== expected[k]) { uiDiff[k] = { boot: expected[k], after: afterUI[k] }; clean = false; }
      });
    }
    return {
      clean,
      worldClean: Object.keys(diff).length === 0,
      uiClean: Object.keys(uiDiff).length === 0,
      baseline: bootBaseline, after, diff,
      uiBaseline: bootUI, afterUI, uiDiff,
      end: end || null,
    };
  }

  // What actually rolls the intro, registered with the network layer because
  // that is what decides WHEN: the host by performing REQ.START, a client by
  // being told (EV.CUTSCENE) and entering the timeline at the host's offset.
  net.onCutscene((elapsed, info) => {
    if (menu && menu.isOpen()) menu.close('cutscene');
    if (lobby && lobby.isOpen()) lobby.close();
    if (lobby && lobby.setPhase) lobby.setPhase('playing');
    return cutscene.start({ elapsed: elapsed || 0, info });
  });
  net.onPhaseChange((p, why) => {
    // A joining client adopts the host's mode before it can spend anything.
    if (lobby && lobby.setCreative && net.creative) {
      lobby.setCreative(net.creative());
      applyCreative(net.creative());
    }
    if (lobby && lobby.setPhase) lobby.setPhase(p);
    // The host's answer to "am I waiting or am I late". Waiting -> dress the
    // set now, while there is nothing on screen to disturb. Late -> make sure
    // nothing was dressed.
    if (p === 'lobby' && cutscene) cutscene.prepare();
    // ONLY on the welcome path. 'start' and 'cutscene' both mean the intro is
    // about to roll and fire one line before it does; discarding there would
    // strike the set start() is holding.
    if (p === 'playing' && why === 'welcome' && cutscene) cutscene.discard();
    // A client told "the session is already running" goes STRAIGHT INTO THE
    // WORLD: the panel closes, no intro, no waiting. That is the deliberate
    // trade -- sessions run for hours, and locking a latecomer out until the
    // next round would be worse than skipping thirty seconds of music.
    if (p === 'playing' && net.isClient() && !cutscene.isActive()) {
      if (lobby && lobby.isOpen()) lobby.close();
      if (menu && menu.isOpen()) menu.close('joined');
    }
  });

  function stats() {
    const pos = player.position();
    const ws = world.stats();
    return {
      fps: perf.fps,
      frameMs: perf.frameMs,
      physMs: perf.physMs,
      drawCalls: renderer.info.calls,
      tris: renderer.info.triangles,
      frame: frameNo,
      simTime,
      bufferWidth: renderer.bufferWidth,
      bufferHeight: renderer.bufferHeight,
      playerX: pos.x,
      playerY: pos.y,
      playerZ: pos.z,
      grounded: player.grounded(),
      bodies: ws.bodies,
      awake: ws.awake,
      ducksLive: ws.ducksLive || 0,
      ducksSleeping: ws.ducksSleeping || 0,
      ducksFree: ws.ducksFree || 0,
      atCap: !!ws.ducksAtCap,
      money: world.economy.money(),
      held: net.heldLocal(),
      holdDistance: world.hold.distance(),
      instances: ducksView.liveInstances(),
      crankedDucks,
      shopOpen: shopUI.isOpen(),
      demolishing,
      placedObjects: placed.objects.length,
      droppedProps: placed.props.length,
      deliveriesPending: deliveries.length,
      deliveriesDropped: deliveredCount,
      chuteFull: chuteFull(),
      instancePools: placed.poolCount(),
      ghostVisible: ghost.visible(),
      ghostValid: lastPlacement ? lastPlacement.valid : null,
      ghostReason: lastPlacement ? lastPlacement.reason : null,
      hotbarSlot: hotbar.selectedIndex(),
      inHand: hotbar.current() ? hotbar.current().id : null,
      // What is actually on screen in the player's hands, read off the scene
      // graph -- not the same claim as `inHand`, which is only a hotbar slot.
      handModel: handView.current(),
      handVisible: handView.visible(),
      pickUps,
      thrownItems: throwCount,
      purchases,
      placeCount,
      demolishCount,
      lastRefund,
      containers: containers.counters().containers,
      contained: containers.containedCount(),
      toolEquipped: tools.state().equipped,
      avatars: avatars.count(),
      avatarsDrawn: avatars.drawn(),
      lobbyOpen: lobby.isOpen(),
      summaryOpen: summaryUI.isOpen(),
      inRoom: !!lobby.session(),
      crankClicks: machine.clicks(),
      crankTurns: machine.turns(),
      wheelDegrees: machine.angleDegrees(),
      // The hold, on the overlay: how full the bar is, how fast the wheel is
      // actually turning, and how many hands are on it. All three are the
      // measurements this feature is judged by, so none of them is a derived
      // guess in a test file.
      crankProgress: machine.progress(),
      crankOmega: machine.omega(),
      crankMomentum: machine.momentum(),
      crankHolders: net.crankHolders ? (net.crankHolders().get(0) || 0) : 0,
      errors: loop.errorCount,
    };
  }

  // A window resize goes through the same rule: applySize() has already cleared
  // the buffer by the time this callback runs, so it is redrawn here instead of
  // waiting for the next frame with a blank canvas on screen.
  renderer.observeResize((sized) => {
    view.setAspect(sized.aspect);
    renderer.render(view.scene, view.camera);
  });

  function lookAt(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    const dir = { x: dx / l, y: dy / l, z: dz / l };
    input.setLook(Math.atan2(-dir.x, -dir.z), Math.asin(Math.max(-1, Math.min(1, dir.y))));
    return dir;
  }

  // Prestige is the one clip with no producer in the game yet: the row exists on
  // the summary and reads 0 because nothing raises it. setPrestige() IS the
  // hook the design named, so the sound hangs off it rather than off an
  // invented event -- the day something calls it, it is already audible.
  const rawSetPrestige = sessionStats.setPrestige;
  sessionStats.setPrestige = function setPrestigeWithSound(n) {
    const before = sessionStats.prestige();
    const after = rawSetPrestige.call(sessionStats, n);
    if (after > before) audio.prestiged();
    return after;
  };

  // The summary's prestige row now has its producer, and exactly one: every path
  // that can move the count ends at prestige.onChange. Taking one is the obvious
  // path; a CLIENT being told about the host's is the one that would otherwise
  // have been forgotten, and it arrives here through the same listener because a
  // client's prestige state is written by setState() rather than by take().
  let prestigeAnnounced = 0;
  prestige.onChange((s) => {
    sessionStats.setPrestige(s.count);
    if (shopUI) shopUI.refresh();
    if (s.count > prestigeAnnounced) {
      hud.showCap('PRESTIGE x' + s.multiplier.toFixed(2)
        + ' - machines, upgrades and money are gone. Buildings and tools stayed.');
    }
    prestigeAnnounced = s.count;
  });

  window.GAME = {
    version: meta.version,
    degraded: !!degraded,
    config,
    three: renderer.three,
    scene: view.scene,
    camera: view.camera,
    world,
    player,
    input,
    loop,
    perf,
    renderer,
    view,
    hud,
    props,
    models,
    ducksView,
    debugCameraY() { return view.camera.position.y; },
    debugSetBufferWidth(w) { applyBufferWidth(w); return renderer.bufferWidth; },
    debugStep(seconds) {
      const n = Math.max(1, Math.round((seconds || 0) / config.loop.fixedDt));
      for (let i = 0; i < n; i++) loop.step(config.loop.fixedDt);
      return stats();
    },
    debugStats: stats,
    lobby,
    avatars,
    summaryUI,
    sessionStats,
    endSession,
    // Everything G4 adds is drivable head-down with rAF dead, like the rest of
    // this project: a feature that needs a human hand is untested by definition.
    // The other half of G4 calls this once with the object createNetGame
    // returned; the lobby, the avatars and the summary all read it from there.
    registerNetLayer,
    debugOpenLobby(options) { return lobby.open(options); },
    debugLobbyState() { return lobby.state(); },

    // --- the waiting room and the intro ---------------------------------------
    // Everything here is the same door the buttons use. There is deliberately no
    // debug-only way to start a session or to roll the cutscene, because a
    // debug-only way is a second implementation and it would be the one that
    // gets tested.
    cutscene,
    debugLobbyPush() { lobby.setPlayers(net.players()); return lobby.state(); },
    debugLobbyStart() { return lobby.start(); },
    debugSetReady(on) { return lobby.setReady(!!on); },
    debugNetPhase() { return net.phase(); },
    // The Start button, from the network layer's side -- for a headless host
    // that never opened the panel.
    debugStartSession() { return net.startSession(); },
    debugCutsceneState() { return cutscene.state(); },
    debugCutsceneGrid() { return cutscene.grid(); },
    debugCutsceneBeatHud(v) { return cutscene.setDebugHud(!!v); },
    debugSkipCutscene() { return cutscene.skip(); },
    debugCutsceneEnd() { return cutscene.lastEnd(); },
    debugPrepareCutscene() { return cutscene.prepare(); },
    debugDiscardCutscene() { return cutscene.discard(); },
    // Did the set actually come down? The boot fingerprint against the world as
    // it is now, key by key. `clean: true` is the whole claim.
    debugCutsceneAudit() { return lastCutsceneAudit || auditWorld(null); },
    debugWorldFingerprint() { return worldFingerprint(); },
    debugUiFingerprint() { return uiFingerprint(); },
    debugBootBaseline() { return bootBaseline; },
    // Roll it with no room at all, for a head-down single-player check of the
    // camera, the staging and the teardown. It runs the SAME cutscene.start()
    // the network path runs; what it skips is the network, not the cutscene.
    debugPlayCutscene(elapsed) {
      if (menu && menu.isOpen()) menu.close('cutscene');
      return cutscene.start({ elapsed: Number(elapsed) || 0, info: { role: 'solo' } });
    },
    // Step the cutscene head-down. rAF is dead in a hidden tab, so the intro is
    // driven exactly like everything else in this project: simulated frames,
    // never wall time. Returns the per-frame worst cost and the state at the end.
    debugStepCutscene(seconds, opts) {
      const o = opts || {};
      const dt = config.loop.fixedDt;
      const n = Math.max(1, Math.round((seconds || 0) / dt));
      const samples = [];
      for (let i = 0; i < n; i++) {
        if (!cutscene.isActive()) break;
        const t0 = performance.now();
        loop.step(dt);
        const ms = performance.now() - t0;
        if (o.sample) {
          const st = cutscene.state();
          samples.push({ t: st.t, shot: st.shot, ms: Math.round(ms * 100) / 100 });
        }
      }
      return { state: cutscene.state(), end: cutscene.lastEnd(), samples };
    },
    // --- G6: menu, settings, player configuration ----------------------------
    // The whole front end is drivable head-down, like everything else here: a
    // menu that needs a mouse to be tested is a menu nobody can test with rAF
    // dead.
    menu,
    settings,
    settingsUI,
    debugOpenMenu() { return menu.open(); },
    debugCloseMenu() { return menu.close('debug'); },
    debugMenuState() { return menu.state(); },
    // Solo IS closing the menu -- the world has been running behind it since
    // boot -- so this is the button, not a shortcut around it.
    debugPlaySolo() { menu.close('play'); return { menuOpen: menu.isOpen(), inRoom: !!lobby.session(), captured: input.captured }; },
    debugOpenSettings() { settingsUI.open(); return settingsUI.state(); },
    debugCloseSettings() { return settingsUI.close(); },
    debugSettingsState() { return settingsUI.state(); },
    debugSetSetting(key, value) { const v = settings.set(key, value); settingsUI.sync(); return v; },
    debugResetSettings() { const v = settings.reset(); settingsUI.sync(); return v; },
    // What the settings actually DID, read off the objects they name rather
    // than off the stored values. These two disagreeing is the only failure
    // mode a settings panel really has.
    debugSettingsApplied() {
      return {
        stored: settings.all(),
        masterGainNode: audio.bus.volumes().masterGainNode,
        sfxGainNode: audio.bus.volumes().sfxGainNode,
        loopGainNode: audio.bus.volumes().loopGainNode,
        configMasterGain: config.audio.masterGain,
        mouseSensitivity: config.player.mouseSensitivity,
        cameraFov: view.camera.fov,
        bufferWidth: renderer.bufferWidth,
        bufferHeight: renderer.bufferHeight,
        perfBufferWidth: perf.bufferWidth,
        lobbyNickname: lobby.nickname(),
        storage: settings.state(),
      };
    },
    debugAvatarColor(id) { return avatars.colorOf(id); },
    debugSetAvatarColor(id, color) { return avatars.setColor(id, color); },
    debugSetAvatars(list) { return avatars.setPlayers(list); },
    debugAvatarPose(id, pose, t) {
      return avatars.pushPose(id, pose, typeof t === 'number' ? t : performance.now());
    },
    debugAvatarState() { return avatars.state(); },
    debugEndSession(reason) { return endSession(reason || 'Session ended.'); },
    debugSummaryState() { return summaryUI.state(); },

    // --- prestige --------------------------------------------------------------
    // Every one of these is the same path the player's clicks take: the quote is
    // what the panel shows, and taking one goes through net.act -> perform().
    // There is no debug-only way to prestige, because a debug-only way is a
    // second implementation and would be the one that gets tested.
    prestige,
    debugPrestige() { return prestige.quote(); },
    debugPrestigeState() {
      return {
        ...prestige.state(),
        duckValueMul: world.economy.duckValueMul,
        statTable: shop.stats().duckValueMul,
        upgradesOnly: shop.upgradeStats().duckValueMul,
        totalEarned: world.economy.totalEarned(),
        candidate: prestige.candidate(),
        summaryRow: sessionStats.prestige(),
      };
    },
    debugTakePrestige() { return net.act({ a: REQ.PRESTIGE }); },
    debugPrestigePanel() { shopUI.prestigeReview(); return shopUI.prestigeState(); },
    debugPrestigeConfirm() { shopUI.prestigeReview(); return shopUI.prestigeConfirm(); },
    debugThrowOnce() { loop.throwNext(); },
    debugLook(yaw, pitch) { input.setLook(yaw, pitch); },
    debugMove(fwd, right) { input.setMove(fwd, right); },
    debugJump(v) { input.setJump(!!v); },
    debugClearInput() { input.clearOverrides(); input.setJump(false); },
    debugAddBody(pos) {
      const p = pos || { x: 0, y: 8, z: 0 };
      const id = world.addTestBody(p);
      view.addBox(id, 0.5, 0xd9a441);
      tracked.push(id);
      return id;
    },
    debugBodyPose(id) { return world.bodyPose(id); },

    // --- G1 verification surface ---------------------------------------------
    debugSpawnDucks(n, opts) {
      const want = Math.max(0, Math.round(n || 0));
      const o = opts || {};
      const cx = o.x === undefined ? 0 : o.x;
      const cz = o.z === undefined ? -16 : o.z;
      const span = o.span === undefined ? 11 : o.span;
      const cols = Math.max(1, Math.ceil(Math.sqrt(want)));
      let made = 0;
      for (let i = 0; i < want; i++) {
        const gx = i % cols;
        const gz = (i / cols) | 0;
        const px = cx + ((gx / Math.max(1, cols - 1)) - 0.5) * span;
        const pz = cz + ((gz / Math.max(1, cols - 1)) - 0.5) * span;
        const id = world.ducks.spawn({ x: px, y: 0.6 + (i % 7) * 0.22, z: pz }, o.tier);
        if (id === null) break;
        made++;
      }
      return made;
    },
    machine,
    benches,
    // HOLD a purchased workbench's wheel by its placement key, head-down: the
    // same button, the same request, the same frame loop the mouse drives, so
    // nothing here is a second code path. `seconds` is held time.
    debugCrankPlaced(key, seconds) {
      const r = holdWheel(key, seconds === undefined ? config.machine.holdSecondsPerDuck : seconds, {});
      const rec = placed.objects.find((o) => o.key === key) || null;
      return {
        key,
        found: !!rec,
        wheelDegrees: rec ? (rec.wheelAngle * 180) / Math.PI : null,
        progress: rec ? benches.progress(rec) : null,
        crankedDucks,
        live: world.ducks.count().live,
        ...r,
      };
    },
    debugBenches() { return benches.info(); },
    // Where a test has to stand to be able to see a wheel at all. The wheel is
    // on ONE side of the cabinet and the aim test refuses the other side, which
    // is what made a working crank read as dead in another harness.
    debugStandAtWheel(key) {
      const s = standAtWheel(key);
      teleportPlayer(s);
      loop.step(config.loop.fixedDt);
      aimAtWheel(Math.round(Number(key)) || 0);
      loop.step(config.loop.fixedDt);
      return { stand: { x: s.x, y: s.y, z: s.z }, wheel: s.wheel, under: wheelUnderCursor() };
    },
    // The crank, head-down. `seconds` is now HELD TIME, not a click count -- the
    // wheel stopped being a clicker and this hook stopped counting clicks with
    // it. Everything it does goes through the real input layer: it aims the
    // camera at the wheel, presses the actual grab button, steps real frames,
    // and releases. There is no path here that touches machine.hold() directly.
    //
    // opts: { key, keepHeld, sample } -- keepHeld leaves the button DOWN so a
    // test can prove the loop continues across a pop without a release, and
    // sample records progress/omega/ducks every frame.
    debugCrank(seconds, opts) {
      const o = opts || {};
      const r = holdWheel(Math.round(Number(o.key)) || 0,
        seconds === undefined ? config.machine.holdSecondsPerDuck : seconds, o);
      return {
        clicks: machine.clicks(),
        turns: machine.turns(),
        angleDegrees: machine.angleDegrees(),
        wheelMeshDegrees: (props.wheelAngle() * 180) / Math.PI,
        crankedDucks,
        live: world.ducks.count().live,
        ...r,
      };
    },
    // Keep holding for another `seconds` without ever touching the button. This
    // is the anti-autoclicker proof: fill, pop, coast, fill again, one press.
    debugCrankKeepHolding(seconds, opts) {
      const o = opts || {};
      return stepHeld(Math.round(Number(o.key)) || 0, seconds, o);
    },
    debugCrankRelease() {
      input.releaseGrab();
      loop.step(config.loop.fixedDt);
      return { grabHeld: input.grabHeld, holders: crankHolderCount() };
    },
    // Everything the hold model knows about one wheel, in one call.
    debugCrankState(key) {
      const k = Math.round(Number(key)) || 0;
      const rec = k ? placed.objects.find((o) => o.key === k) || null : null;
      return {
        key: k,
        progress: crankProgressOfKey(k),
        omega: crankOmegaOfKey(k),
        wheelDegrees: rec
          ? (rec.wheelAngle * 180) / Math.PI
          : (props.wheelAngle() * 180) / Math.PI,
        secondsPerDuck: rec ? benches.secondsPerDuck(rec) : machine.secondsPerDuck(),
        momentum: rec ? benches.momentum(rec) : machine.momentum(),
        momentumMax: config.machine.momentumMax,
        holders: crankHolderCount(k),
        bots: botAssignments().filter((b) => b.wheel === k).length,
        holdSlots: net.crankHoldSlots ? net.crankHoldSlots() : [],
        stalled: rec ? null : machine.stalled(),
        coasting: rec ? null : machine.coasting(),
        cranking,
        grabHeld: input.grabHeld,
        isClient: net.isClient(),
        crankedDucks,
        live: world.ducks.count().live,
      };
    },
    // Every placed Auto-Cranker and the wheel it decided to work.
    debugBots() { return botAssignments(); },
    // Who is leaning on what, as a plain object.
    debugCrankHolders() {
      const out = {};
      if (net.crankHolders) net.crankHolders().forEach((n, key) => { out[key] = n; });
      return out;
    },
    debugMachineInfo() {
      const m = props.machineBase();
      const w = props.wheelCenter();
      const mouth = props.machineMouth();
      const pit = { x: config.pit.centerX, y: config.pit.centerY, z: config.pit.centerZ };
      return {
        machine: m,
        wheelCenter: w,
        wheelHitRadius: props.wheelHitRadius(),
        wheelDegrees: (props.wheelAngle() * 180) / Math.PI,
        outputMouth: mouth,
        clicksPerTurn: machine.clicksPerTurn(),
        baseClicksPerTurn: machine.baseClicksPerTurn,
        clicksPerDuckMul: shop.stats().clicksPerDuckMul,
        anglePerClickDegrees: (machine.anglePerClick() * 180) / Math.PI,
        distanceToPit: Math.hypot(m.x - pit.x, m.z - pit.z),
        crankedDucks,
      };
    },
    debugLookAtWheel() {
      const eye = player.eyePosition();
      lookAt(eye, props.wheelCenter());
      const inp = input.read();
      view.updateCamera(eye, inp.yaw, inp.pitch);
      return wheelUnderCursor();
    },
    debugWheelUnderCursor() { return wheelUnderCursor(); },
    debugTubeInfo() {
      const mouth = props.tubeMouth();
      return {
        mouth,
        pivotY: config.tube.mouthWorldY + config.tube.mouthY * config.tube.scale + config.tube.y,
        scale: config.tube.scale,
        pitchX: config.tube.pitchX,
      };
    },
    debugGrabNearest(maxRange) {
      const eye = player.eyePosition();
      const range = maxRange === undefined ? config.hold.grabRange : maxRange;
      let best = null;
      let bestD2 = range * range;
      world.ducks.forEach((id, x, y, z) => {
        const d2 = (x - eye.x) ** 2 + (y - eye.y) ** 2 + (z - eye.z) ** 2;
        if (d2 < bestD2) { bestD2 = d2; best = { id, x, y, z }; }
      });
      if (!best) return null;
      const dir = lookAt(eye, best);
      view.updateCamera(eye, input.read().yaw, input.read().pitch);
      const ok = world.hold.tryGrab(eye, dir);
      return ok ? best.id : null;
    },
    debugRelease() { return world.hold.release(); },
    debugThrow() { return world.hold.throw(); },
    debugMoney() { return world.economy.money(); },
    debugScroll(n) { input.scrollBy(n); return world.hold.distance(); },
    // Hold-to-carry, programmatically: press grabs, release drops.
    debugPressGrab() { input.pressGrab(); },
    debugReleaseGrab() { input.releaseGrab(); },
    debugPressThrow() { input.pressThrow(); },
    debugHudState() {
      return {
        money: hud.moneyText(),
        step: hud.stepText(),
        stepIndex: hud.stepIndex(),
        // `step` is what the CURRENT step says; `stepVisible` is whether it is
        // on screen at all. They differ exactly when the step has yielded its
        // button to the crosshair prompt, which is the whole point of the
        // layering -- a check that counts instructions must read this one.
        stepVisible: hud.stepVisible(),
        stepInputs: hud.stepInputs(),
        steps: hud.stepsDone(),
        capVisible: hud.capVisible(),
        prompt: hud.promptText(),
        promptVisible: hud.promptVisible(),
        promptInput: hud.promptInput(),
      };
    },
    // --- G5 verification surface ---------------------------------------------
    focus,
    blackHole: view.blackHole,
    debugFocusState() {
      const t = focus.target();
      return {
        target: t,
        outlineVisible: focus.outlineVisible(),
        labelVisible: focus.labelVisible(),
        labelText: focus.labelText(),
      };
    },
    // debugKeyBarState() is GONE. It reported on src/ui/keybar.js, which was
    // deleted -- so it was a permanently-off stub answering questions about a
    // file that does not exist, and any check still calling it was being told
    // "off" forever rather than that it was asking about nothing. The key list
    // it used to describe is KEY_ROWS in src/ui/controls.js, which is read
    // through the menu's Controls panel and has its own state().
    debugSkyState() {
      return {
        time: view.blackHole.time(),
        direction: view.blackHole.direction,
        quadVisible: view.blackHole.quad.visible,
        stars: view.blackHole.stars.geometry.attributes.position.count,
      };
    },
    // --- G2 verification surface ---------------------------------------------
    shop,
    shopUI,
    hotbar,
    placed,
    ghost,
    rotation,
    worldQuery,
    catalog: CATALOG,
    dataValidation: VALIDATION,
    debugUnstagedModels() { return unstagedModels(); },
    debugPhysicsProps: () => physicsProps,
    debugGiveMoney(n) { return world.economy.add(Number(n) || 0, 'debug'); },
    debugBuy(id) { return shopUI.buy(id); },
    debugCanBuy(id) { return shop.canBuy(id); },
    debugShopOpen() { return shopUI.open(); },
    debugShopClose() { return shopUI.close(); },
    debugShopState() { return shopUI.state(); },
    debugShopTab(t) { shopUI.setTab(t); return shopUI.state(); },
    // --- the shelf ------------------------------------------------------------
    // Drivable head-down like everything else here. debugStockAdvance is how a
    // three-minute period is tested in a millisecond: it moves the shelf's own
    // clock without pretending three minutes of physics happened.
    stock,
    debugStockState() { return stock.table(); },
    debugStockInfo(id) { return stock.info(id); },
    debugShopShelf() { return shopUI.shelfState(); },
    debugStockAdvance(seconds) {
      const rolled = stock.advance(Number(seconds) || 0, !net.isClient());
      if (shopUI.isOpen()) shopUI.tick();
      return { rolled, period: stock.periodNo(), secondsLeft: stock.secondsLeft() };
    },
    debugReroll() { return shopUI.reroll(); },
    debugShopCloseButton() { return shopUI.clickClose(); },
    debugSelectHotbar(i) { return hotbar.select(Math.round(i)); },
    debugHotbarState() { return hotbar.state(); },
    debugSetRotation(yawRadians, free) {
      if (free) rotation.setFree(yawRadians);
      else { rotation.reset(); rotation.setFree(yawRadians); }
      return rotation.get();
    },
    debugRotateStep(n) {
      const k = Math.round(n === undefined ? 1 : n);
      for (let i = 0; i < Math.abs(k); i++) rotation.step(k >= 0 ? 1 : -1);
      return rotation.get();
    },
    debugResetRotation() { return rotation.reset(); },
    debugDemolishMode(v) {
      demolishing = v === undefined ? !demolishing : !!v;
      demolishHold = 0;
      demolishTarget = null;
      return demolishing;
    },

    // Place through the real path and report BOTH poses: the hologram's, read
    // back out of the scene graph, and the placed object's, read back out of
    // the instance matrix and out of the physics collider. Nothing here trusts
    // the numbers that went in.
    debugPlace(itemId, origin, dir, yaw, opts) {
      const item = byId(itemId);
      if (!item || !item.collider) return null;
      const o = opts || {};
      const rot = { yaw: Number(yaw) || 0, free: !!o.free };
      const first = resolvePlacement(item, origin, dir, rot, worldQuery);
      ghost.show(item, first);
      const ghostPose = ghost.pose();
      const out = {
        id: itemId,
        valid: first.valid,
        reason: first.reason,
        free: first.free,
        yaw: first.yaw,
        ghost: ghostPose,
        placed: null,
        collider: null,
        key: null,
      };
      if (!first.valid && !o.force) return out;
      const second = resolvePlacement(item, origin, dir, rot, worldQuery);
      const rec = placed.place(item, second);
      if (!rec) return out;
      out.placed = placed.renderedPose(rec);
      out.collider = placed.colliderPose(rec);
      out.key = rec.key;
      if (o.remove) placed.remove(rec);
      return out;
    },
    debugPlaceFromHand() { return doPlace(); },
    debugPlacementAt(itemId, origin, dir, yaw, free) {
      const item = byId(itemId);
      if (!item) return null;
      return resolvePlacement(item, origin, dir, { yaw: Number(yaw) || 0, free: !!free }, worldQuery);
    },
    debugPlacedList() {
      return placed.objects.map((o) => ({
        key: o.key, id: o.id, x: o.x, y: o.y, z: o.z, yaw: o.yaw, free: o.free,
      }));
    },
    debugRemovePlaced(key) {
      const rec = placed.objects.find((o) => o.key === key);
      return rec ? placed.remove(rec) : false;
    },
    debugClearPlaced() {
      let n = 0;
      for (let i = placed.objects.length - 1; i >= 0; i--) { placed.remove(placed.objects[i]); n++; }
      return n;
    },
    debugDemolishNearest(range) {
      const p = player.position();
      const rec = placed.nearest(p, range === undefined ? 1e9 : range);
      return doDemolish(rec);
    },
    debugDropStats() { return placed.stats(); },
    // --- the truck ------------------------------------------------------------
    debugTrucks: () => vehicles.list.map((r) => vehicles.info(r.key)),
    // What the truck's own synth is doing: whether the engine note is running,
    // where its revs are (0..1) and how many one-shots are alive. Read back from
    // the synth rather than from what was asked of it.
    debugTruckAudio: () => (audio.truckState ? audio.truckState() : null),
    debugTruckInfo: (key) => vehicles.info(key),
    debugSpawnTruck(free) {
      const g = garageTarget() || placed.objects.find((o) => o.kind === 'spawner');
      if (!g) return { ok: false, reason: 'no garage' };
      return spawnTruck(g, free !== false);
    },
    debugEnterTruck: () => enterTruck(),
    debugExitTruck: () => exitTruck(),
    debugDriving: () => driving,
    debugDrive(throttle, steer, handbrake) {
      if (throttle === null) { driveOverride = null; return true; }
      driveOverride = { fwd: Number(throttle) || 0, right: Number(steer) || 0, jump: !!handbrake };
      if (!driving) return false;
      return vehicles.control(driving, { throttle, steer, handbrake });
    },
    debugTruckTip(v) {
      // Through the override for the same reason debugDrive is: the frame loop
      // rewrites the tip from the keyboard every frame, and a test that wrote
      // straight to the record would be undone before the next substep.
      if (!driveOverride) driveOverride = { fwd: 0, right: 0, jump: false };
      driveOverride.tip = v === null ? null : Number(v) || 0;
      return driving ? vehicles.setTip(driving, driveOverride.tip) : null;
    },
    debugTruckGate(v) { return driving ? vehicles.setGate(driving, v) : null; },
    // Is this world point standing on the bed? The ride test itself, so a
    // passenger that is not being carried can be told from one that is not
    // standing where they think they are.
    debugOnBed(key, p) {
      const rec = vehicles.byKey(key === undefined ? vehicles.list[0] && vehicles.list[0].key : key);
      return rec ? vehicles.onBed(rec, p) : null;
    },
    // The chute's queue. `pending` is what has been PAID FOR and not yet fallen
    // out; nothing here is ever discarded, so pending + dropped == everything
    // bought that has a model.
    debugDeliveries() {
      return {
        pending: deliveries.map((r) => r.id),
        pendingCount: deliveries.length,
        dropped: deliveredCount,
        props: placed.props.length,
        max: Math.round(config.drop.max),
        perFrame: Math.round(config.drop.perFrame),
        full: chuteFull(),
      };
    },
    // Pointer lock, as the click handler sees it. `relockClicks` counts clicks
    // spent buying the lock back -- clicks the world never saw.
    debugLockState() {
      return {
        locked: input.pointerLocked,
        available: input.pointerLockAvailable,
        coolingDown: input.lockCoolingDown,
        needsRelockClick: input.needsRelockClick,
        relockClicks: input.relockClicks,
        swallowingGrab: input.swallowingGrab,
      };
    },

    // --- carrying: the same path the player's keys drive ----------------------
    // These push the real key edge and step the loop, so E here is E there. A
    // debug function that called pickUp() directly could keep passing after the
    // key binding broke.
    handView,
    debugPickUp() {
      input.pressKey('KeyE');
      loop.step(config.loop.fixedDt);
      return {
        picked: lastPickup,
        hotbar: hotbar.state(),
        props: placed.props.length,
        bodies: world.stats().bodies,
      };
    },
    debugThrowItem() {
      input.pressKey('KeyQ');
      loop.step(config.loop.fixedDt);
      return {
        thrown: lastThrow,
        hotbar: hotbar.state(),
        props: placed.props.length,
        bodies: world.stats().bodies,
      };
    },
    debugPickupTarget() {
      const t = pickupTarget();
      return t ? { id: t.row.id, name: t.row.name, key: t.prop.key, distance: t.distance } : null;
    },
    debugPropList() {
      return placed.props.map((p) => {
        const t = p.body.translation();
        return {
          key: p.key, id: p.id, x: t.x, y: t.y, z: t.z,
          carryable: isHandCarryable(byId(p.id)),
          collectable: isCollectable(byId(p.id)),
        };
      });
    },
    // Aim at a dropped prop the way a player would: turn the head, then push the
    // camera the aim ray is taken from. Without the camera update the ray is
    // still on last frame's look direction.
    debugLookAtProp(key) {
      const rec = key === undefined ? placed.props[placed.props.length - 1] : placed.propByKey(key);
      if (!rec) return null;
      const t = rec.body.translation();
      const eye = player.eyePosition();
      lookAt(eye, { x: t.x, y: t.y, z: t.z });
      const inp = input.read();
      view.updateCamera(eye, inp.yaw, inp.pitch);
      return { key: rec.key, id: rec.id, target: { x: t.x, y: t.y, z: t.z },
        distance: Math.hypot(t.x - eye.x, t.y - eye.y, t.z - eye.z) };
    },
    debugHandView() { return handView.pose(); },
    debugTeleport(pos) {
      const raw = world._raw;
      if (!raw || player.handle === undefined) return null;
      const body = raw.getRigidBody(player.handle);
      if (!body) return null;
      body.setNextKinematicTranslation
        ? body.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z })
        : null;
      body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
      return player.position();
    },
    debugBoothInfo() {
      const p = player.position();
      return {
        base: props.boothBase(),
        counter: props.boothCounter(),
        distance: props.boothDistance(p),
        useRange: config.booth.useRange,
        inRange: props.boothDistance(p) <= config.booth.useRange,
      };
    },
    // --- G3 verification surface ---------------------------------------------
    producers,
    collectors,
    attention,
    debugProducerInfo() {
      // info() resyncs against the placed list, so it is read FIRST: a count
      // taken before the sync would report 0 for a machine placed a line ago.
      const units = producers.info();
      return {
        count: producers.count(),
        producedTotal: producers.producedTotal(),
        expectedPerMinute: producers.expectedPerMinute(),
        machineRateMul: shop.stats().machineRateMul,
        rarityLuckMul: shop.stats().rarityLuckMul,
        units,
      };
    },
    debugCollectorInfo() {
      const units = collectors.info();
      return {
        count: collectors.count(),
        pulledTotal: collectors.pulledTotal(),
        impulses: collectors.impulses(),
        units,
      };
    },
    // Gate D-C. Counted in src/sim/world.js by applyImpulse(): any body that was
    // still asleep when an impulse arrived. Must read 0.
    debugSleepingImpulses() {
      const c = world.counters();
      return {
        impulsesOnSleeping: c.impulsesOnSleeping,
        impulses: c.impulses,
        collectorImpulses: collectors.impulses(),
        beltImpulses: conveyors.totalImpulses(),
        fanImpulses: blowers.totalImpulses(),
      };
    },
    conveyors,
    blowers,
    debugBeltInfo() {
      // info() resyncs against the placed list, so it is read FIRST: a count
      // taken before the sync would report 0 for a belt placed a line ago.
      const units = conveyors.info();
      return {
        count: units.length,
        flags: conveyors.flags(),
        lastFrame: conveyors.counts(),
        impulsesTotal: conveyors.totalImpulses(),
        broadPhase: conveyors.hashStats(),
        units,
      };
    },
    debugFanInfo() {
      const units = blowers.info();
      return {
        count: units.length,
        flags: blowers.flags(),
        lastFrame: blowers.counts(),
        impulsesTotal: blowers.totalImpulses(),
        broadPhase: blowers.hashStats(),
        airSpeed: config.automation.fan.airSpeed,
        units,
      };
    },

    // Does the chain actually reach? Walks the workbench-to-pit run at duck
    // height and asks each system whether a duck standing on that spot would be
    // moved. Eyeballing a row of fans is exactly how a 1 m dead zone survives to
    // the playtest.
    debugFanCoverage(opts) {
      const C = config.automation.coverage;
      const o = opts || {};
      const from = { x: o.fromX === undefined ? config.machine.x : o.fromX,
        z: o.fromZ === undefined ? config.machine.z : o.fromZ };
      const to = { x: config.pit.centerX, z: config.pit.centerZ };
      const y = o.y === undefined ? C.duckHeight : o.y;
      const span = Math.hypot(to.x - from.x, to.z - from.z);
      const ux = (to.x - from.x) / (span || 1);
      const uz = (to.z - from.z) / (span || 1);
      const step = C.stepMeters;
      const n = Math.max(2, Math.round(span / step) + 1);

      let coveredFan = 0;
      let coveredBelt = 0;
      let covered = 0;
      let gap = 0;
      let longestGap = 0;
      let gapStart = null;
      let worstGapAt = null;
      const holes = [];
      for (let i = 0; i < n; i++) {
        const d = Math.min(span, i * step);
        const x = from.x + ux * d;
        const z = from.z + uz * d;
        // Inside the pit mouth a duck needs no help at all.
        const inPit = Math.hypot(x - to.x, z - to.z) <= config.pit.radius;
        const f = inPit ? null : blowers.covers(x, y, z);
        const b = inPit ? null : conveyors.covers(x, y, z);
        if (f) coveredFan++;
        if (b) coveredBelt++;
        if (inPit || f || b) {
          if (gap > 0) {
            holes.push({ startD: gapStart, endD: d, meters: gap });
            if (gap > longestGap) { longestGap = gap; worstGapAt = gapStart; }
          }
          gap = 0;
          covered++;
        } else {
          if (gap === 0) gapStart = d;
          gap += step;
        }
      }
      if (gap > 0) {
        holes.push({ startD: gapStart, endD: span, meters: gap });
        if (gap > longestGap) { longestGap = gap; worstGapAt = gapStart; }
      }
      return {
        fans: blowers.count(),
        belts: conveyors.count(),
        from,
        to,
        spanMeters: span,
        samples: n,
        stepMeters: step,
        probeHeight: y,
        coveredFraction: covered / n,
        coveredByFans: coveredFan / n,
        coveredByBelts: coveredBelt / n,
        longestGapMeters: longestGap,
        longestGapStartMeters: worstGapAt,
        maxGapAllowed: C.maxGap,
        holes,
        spans: longestGap <= C.maxGap,
      };
    },

    // The end-to-end measurement: put n ducks down at the machine end and count
    // how many the chain actually delivers. Everything is stepped synchronously,
    // because a backgrounded tab has no requestAnimationFrame to wait for.
    debugChainTest(n, seconds) {
      const T = config.automation.chainTest;
      const want = Math.max(1, Math.round(n === undefined ? T.ducks : n));
      const secs = seconds === undefined ? T.seconds : seconds;
      const m = props.machineMouth();
      const c0 = world.counters();
      const before = world.pit.totalScored();
      const moneyBefore = world.economy.money();

      let spawned = 0;
      for (let i = 0; i < want; i++) {
        // A column of ducks in one spot interpenetrates and measures the
        // pathological case instead of the chain, so they are laid out in rows
        // and dropped in staggered from above.
        const col = i % Math.max(1, Math.round(T.spawnRows));
        const row = Math.floor(i / Math.max(1, Math.round(T.spawnRows)));
        const id = world.ducks.spawn({
          x: m.x + ((col / Math.max(1, T.spawnRows - 1)) - 0.5) * T.spawnSpan,
          y: m.y + T.spawnHeight + row * T.spawnStagger,
          z: m.z + ((row % 2) - 0.5) * T.spawnSpan * 0.5,
        });
        if (id === null) break;
        spawned++;
      }

      const steps = Math.max(1, Math.round(secs / config.loop.fixedDt));
      const t0 = performance.now();
      for (let i = 0; i < steps; i++) loop.step(config.loop.fixedDt);
      const wall = performance.now() - t0;

      // Where did the survivors end up? A pile 2 m past the last fan is a very
      // different failure from a pile still sitting in the machine's mouth.
      let minZ = Infinity;
      let maxZ = -Infinity;
      let sumZ = 0;
      let live = 0;
      world.ducks.forEach((id, x, yy, z) => {
        live++;
        sumZ += z;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      });
      const c1 = world.counters();
      return {
        spawned,
        seconds: secs,
        steps,
        scored: world.pit.totalScored() - before,
        moneyGained: world.economy.money() - moneyBefore,
        stillLive: live,
        survivorZ: live ? { min: minZ, max: maxZ, mean: sumZ / live } : null,
        fans: blowers.count(),
        belts: conveyors.count(),
        physMs: world.stats().physMs,
        frameMs: perf.frameMs,
        wallMsPerStep: wall / steps,
        impulsesOnSleeping: c1.impulsesOnSleeping - c0.impulsesOnSleeping,
        beltImpulses: conveyors.totalImpulses(),
        fanImpulses: blowers.totalImpulses(),
        coverage: window.GAME.debugFanCoverage(),
      };
    },
    debugJamState() {
      return { ...producers.jamState(), attention: attention.report() };
    },
    debugAttention() { return attention.report(); },
    // Swift Hands lands on SECONDS per duck now, not clicks per duck: same stat,
    // same multiplier, same direction (below 1 is faster), no rounding to a
    // whole click. The click numbers stay in the readout because the wheel still
    // has a click grain for the gear sound.
    debugCrankRate() {
      return {
        secondsPerDuck: machine.secondsPerDuck(),
        baseSecondsPerDuck: machine.baseSecondsPerDuck,
        minSeconds: config.machine.minHoldSeconds,
        momentum: machine.momentum(),
        momentumMax: machine.momentumMax,
        // What a duck costs RIGHT NOW at this many hands, flywheel included.
        secondsPerDuckNow: machine.secondsPerDuckAt(Math.max(1, crankHolderCount(0))),
        clicksPerTurn: machine.clicksPerTurn(),
        baseClicksPerTurn: machine.baseClicksPerTurn,
        clicksPerDuckMul: shop.stats().clicksPerDuckMul,
      };
    },
    debugInstanceStats() { return ducksView.stats(); },
    debugResetInstanceStats() { ducksView.resetStats(); },
    containers,
    tools,
    // Equipping is normally the hotbar slot; head-down it is one call. Both go
    // through the same hotbar state, so the debug path cannot drift from the
    // played one.
    debugEquipTool(id) {
      const row = byId(id);
      if (!row || !isToolRow(row)) return null;
      // -1 is a full bar refusing, and it has to be reported rather than
      // followed by a select(-1) that looks like the tool simply did nothing.
      if (hotbar.countOf(row.id) <= 0 && hotbar.add(row, 1) < 0) {
        return { error: 'hotbar is full', slots: hotbar.state().slots };
      }
      const slot = hotbar.state().slots.findIndex((s) => s && s.id === row.id);
      hotbar.select(slot);
      syncEquippedTool();
      return tools.state();
    },
    debugUnequipTool() {
      hotbar.select(-1);
      syncEquippedTool();
      return tools.state();
    },
    // --- G4: the 20 Hz state stream ------------------------------------------
    // Encode one frame exactly as the host would for ONE client. The origin is
    // that client's own camera, so relevance culling is measured against the
    // thing it is defined against; omit it and this tab's camera stands in.
    debugNetFrame(opts) {
      const o = opts || {};
      const c = view.camera.position;
      const origin = o.origin === null ? null : (o.origin || { x: c.x, y: c.y, z: c.z });
      const bytes = netCodec.encodeDucks(world.ducks, {
        origin, radius: o.radius, now: o.now, clock: state.clock(),
      });
      const s = netCodec.stats(o.now);
      return {
        bytes: bytes.byteLength,
        bodies: s.bodiesLastFrame,
        considered: s.bodiesConsideredLastFrame,
        culled: s.relevanceCulledLastFrame,
        radius: o.radius === undefined ? s.relevanceRadius : o.radius,
        stateHz: s.stateHz,
        projectedKBPerSecondPerClient: s.projectedKBPerSecondPerClient,
      };
    },
    debugNetStats(now) { return netCodec.stats(now); },
    debugNetReset() { netCodec.resetStats(); return netCodec.stats(); },
    debugNetSetHz(hz) { return netCodec.setStateHz(hz); },
    // Drive the stream for `seconds` of stream time at whatever rate the codec
    // is currently on, feeding it its own clock. rAF is dead in a hidden tab and
    // performance.now() would make one measurement out of a thousand calls in
    // the same millisecond, so the cadence is synthesised from
    // frameIntervalMs() -- re-read every frame, which is how a degradation
    // mid-burst shows up as a real change in the send cadence.
    debugNetBurst(seconds, opts) {
      const o = opts || {};
      const c = view.camera.position;
      const origin = o.origin === null ? null : (o.origin || { x: c.x, y: c.y, z: c.z });
      const span = Math.max(0, Number(seconds) || 0) * 1000;
      let now = Number(o.startAt);
      if (!isFinite(now)) now = 0;
      const t0 = now;
      let frames = 0;
      let bytes = 0;
      let degradedAtMs = null;
      const startHz = netCodec.stateHz();
      while (now - t0 < span) {
        const frame = netCodec.encodeDucks(world.ducks, {
          origin, radius: o.radius, now, clock: state.clock(),
        });
        bytes += frame.byteLength;
        frames++;
        const hzNow = netCodec.stateHz();
        if (degradedAtMs === null && hzNow !== startHz) degradedAtMs = now - t0;
        now += netCodec.frameIntervalMs();
      }
      const s = netCodec.stats(now);
      return {
        seconds: (now - t0) / 1000,
        frames,
        bytes,
        avgFrameBytes: frames ? bytes / frames : 0,
        // What gate E-H is read off: bytes actually put on the wire per second
        // for one client, over the whole burst.
        kbPerSecond: (now - t0) > 0 ? (bytes / 1024) / ((now - t0) / 1000) : 0,
        windowKBPerSecond: s.upKBPerSecond,
        bodiesLastFrame: s.bodiesLastFrame,
        culledLastFrame: s.relevanceCulledLastFrame,
        settledFiltered: s.settledFiltered,
        relevanceCulled: s.relevanceCulled,
        startHz,
        endHz: s.stateHz,
        degraded: s.degraded,
        degradedAtMs,
        degradations: s.degradations,
        recoveries: s.recoveries,
      };
    },
    start() { loop.start(); },
    stop() { loop.stop(); },

    // --- G4: host authority and the client ------------------------------------
    // The lobby reaches the network layer through window.GAME.net; so does
    // every test below. There is one instance and no second path to it.
    net,
    // What the host's crank reconciler diffs. A client's percentage comes from
    // this and nothing else, so it is worth being able to read directly.
    debugCrankStates() { return crankStates(); },

    // --- the gambling box, head-down ------------------------------------------
    // Everything here reads the REAL layers: debugGamble presses the same E-key
    // path a player does (via net.act), so if the aim, the money or the cooldown
    // would refuse a human they refuse this too.

    // What the simulation says about every box in the world, plus what the
    // RENDERER actually has on screen for it (read back out of the instance
    // matrices, not out of the fields that were written into them).
    debugGamble() {
      const out = [];
      const drawn = placed.gambleState();
      const keys = gamble.keys();
      for (let i = 0; i < keys.length; i++) {
        const info = gamble.info(keys[i]);
        const d = drawn.find((x) => x.key === keys[i]) || null;
        out.push({
          ...info,
          // A client picks a local prize it will never pay out; blanked here so
          // nothing can read it as the answer. The host's prize is the only one.
          prize: net.isClient() ? null : info.prize,
          drawn: d,
        });
      }
      return out;
    },
    // Roll the box the crosshair is on, or a named one -- but only ever through
    // net.act, so a client SENDS and a host performs, exactly like pressing E.
    debugGamble1(key) {
      if (key === undefined) return doGamble();
      const rec = placed.objects.find((o) => o.key === (Math.round(Number(key)) || 0));
      if (!rec) return { ok: false, reason: 'nothing there' };
      // Aim at the box from where the player is standing: the host casts its own
      // ray, so a synthetic direction has to be a real one.
      const p = player.position();
      const eye = { x: p.x, y: p.y + config.player.eyeHeight - config.player.height / 2, z: p.z };
      const dx = rec.position.x - eye.x;
      const dy = rec.position.y - eye.y;
      const dz = rec.position.z - eye.z;
      const l = Math.hypot(dx, dy, dz) || 1;
      const res = net.act({
        a: REQ_GAMBLE,
        o: [eye.x, eye.y, eye.z], d: [dx / l, dy / l, dz / l],
      });
      return res;
    },
    // The prize table itself, so "anything can fall out of it" is a number: how
    // many rows are winnable, and the chance of each.
    debugGambleTable() {
      return {
        rows: gamblePrizeTable.rows.length,
        total: gamblePrizeTable.total,
        top: gamblePrizeTable.rows.slice().sort((a, b) => b.p - a.p).slice(0, 10)
          .map((r) => ({ id: r.id, cost: r.cost, p: Math.round(r.p * 1e5) / 1e5 })),
      };
    },
    // Force the empty-table case, which the shipped catalog can never produce.
    // The box must still roll and still pay -- in ducks -- rather than refuse.
    debugGambleForceDucks(on) { gambleForceDucks = !!on; return gambleForceDucks; },
    // What has actually come out, this session.
    debugGambleWins() {
      const out = {};
      gambleWins.forEach((n, id) => { out[id] = n; });
      return { rolls: gambleRolls, last: lastGamblePrize, wins: out };
    },
    debugCrankProgressOf(key) { return net.crankProgressOf(Math.round(key) || 0); },
    debugSetCreative(on) { if (lobby.setCreative) lobby.setCreative(!!on); return applyCreative(!!on); },
    debugCreative() {
      return {
        lobby: lobby.creative ? lobby.creative() : null,
        shop: shop.isCreative(), stock: stock.isCreative(), ducks: world.ducks.isCreative(),
      };
    },
    debugNetRole() { return net.role(); },
    debugNetRoom() { return net.roomState(); },
    debugNetPlayers() { return net.players(); },
    debugNetPose(slot) { return net.playerPose(Math.round(slot)); },
    debugNetStatsLive(t) { return net.stats(t); },
    // Host or join WITHOUT the lobby on screen, for a head-down test. Both go
    // through the same attachHost/attachClient the lobby uses.
    debugNetHost(opts) { return net.host(opts || { nick: 'host', isPublic: false }); },
    debugNetJoin(roomId, opts) { return net.join(roomId, opts || { nick: 'client' }); },
    debugNetLeave() { return net.leave(); },
    // One host tick on demand. rAF is dead in a hidden tab and the worker clock
    // runs on its own schedule, so a test that needs "reconcile and send, now"
    // asks for it rather than sleeping and hoping.
    debugNetTick(n) {
      const k = Math.max(1, Math.round(n === undefined ? 1 : n));
      for (let i = 0; i < k; i++) net.tick();
      return net.stats();
    },
    // Gate E-H, measured rather than projected: what has actually gone out to
    // each client over the last config.net.rateWindowMs.
    debugNetUpstream() {
      const s = net.stats();
      return {
        role: s.role,
        clients: s.clients === undefined ? 0 : s.clients,
        worstClientKBPerSecond: s.worstClientKBPerSecond,
        budgetKBPerSecond: 60,
        peers: s.peers || [],
      };
    },
    // What a client is holding, as the HOST sees it. This is the answer a
    // joining player gets, and the thing that did not exist before this round.
    debugNetInventory(slot) { return net.inventoryOf(Math.round(slot || 0)); },

    // --- G4: the hold, per player ---------------------------------------------
    // The core verb, drivable head-down from either side of the wire. A client
    // tab gets exactly the same calls as the host tab: they are requests, and
    // which of the two performs them is the whole thing under test.

    // Aim at a duck and ask for it. Returns the instant the request left, so a
    // test can subtract it from the instant the duck first moves and report a
    // real number instead of "felt instant".
    debugGrabRequest(duckId) {
      const eye = player.eyePosition();
      if (duckId !== undefined && duckId !== null) {
        const p = world.ducks.pose(Math.round(duckId));
        if (!p) return { ok: false, reason: 'no such duck' };
        lookAt(eye, p);
        view.updateCamera(eye, input.read().yaw, input.read().pitch);
      }
      const aim = view.aim();
      const sentAt = performance.now();
      const ret = net.act({
        a: REQ.GRAB,
        o: [aim.origin.x, aim.origin.y, aim.origin.z],
        d: [aim.dir.x, aim.dir.y, aim.dir.z],
      });
      return { sentAt, ret, aim: { o: aim.origin, d: aim.dir }, role: net.role() };
    },
    debugHurlRequest() {
      const sentAt = performance.now();
      return { sentAt, ret: net.act({ a: REQ.HURL }), role: net.role() };
    },
    debugDropRequest() {
      const sentAt = performance.now();
      return { sentAt, ret: net.act({ a: REQ.DROP }), role: net.role() };
    },
    // Perform a request AS another slot, without waiting for that player's
    // message to arrive. This is not a back door around rule 6 -- it is the same
    // perform(slot, req) every real request from that slot goes through, called
    // synchronously so two grabs can be put in the SAME tick on purpose. There
    // is no other way to test a race whose whole point is that it has no tick
    // boundary in it.
    debugGrabAs(slot, target) {
      const s = Math.round(slot);
      const pose = world.ducks.pose(Math.round(target));
      if (!pose) return { ok: false, reason: 'no such duck' };
      const p = net.playerPose(s);
      if (!p) return { ok: false, reason: 'no such player' };
      const eye = { x: p.x, y: p.y + config.player.eyeHeight - config.player.height / 2, z: p.z };
      const dx = pose.x - eye.x, dy = pose.y - eye.y, dz = pose.z - eye.z;
      const l = Math.hypot(dx, dy, dz) || 1;
      return net.perform(s, {
        a: REQ.GRAB, o: [eye.x, eye.y, eye.z], d: [dx / l, dy / l, dz / l],
      });
    },
    // Who is holding what, from whichever side is asking. On a client these are
    // the host's words, which is the point.
    debugHoldReport() {
      const out = { role: net.role(), localSlot: net.localSlot(), local: net.heldLocal(), players: [] };
      net.players().forEach((p) => {
        out.players.push({ slot: p.slot, nick: p.nick, hold: p.hold || null, hand: p.hand || null });
      });
      if (world.holdSlots) {
        out.controllers = world.holdSlots();
        out.claims = world.holdClaimCount();
        out.heldBySlot = world.holdSlots().map((s) => {
          const h = world.holdIfAny(s);
          return { slot: s, duck: h && h.isHolding() ? h.heldDuck() : null };
        });
      }
      return out;
    },
    // Test setup. debugSpawnDucks lays its grid out on its own terms, so putting
    // a duck exactly where a test needs it means moving a live body: the pool
    // never creates or destroys one.
    debugMoveDuck(id, pos) {
      const i = Math.round(id);
      const b = world.ducks.body(i);
      if (!b || !world.ducks.isActive(i)) return null;
      b.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      world.ducks.wakeDuck(i);
      return world.ducks.pose(i);
    },
    debugDuckPose(id) { return world.ducks.pose(Math.round(id)); },
    debugEye() { return player.eyePosition(); },
  };

  // The hooks each module owes window.GAME come from the module itself, so the
  // names cannot drift from the code that serves them.
  Object.assign(
    window.GAME, containers.debugHooks(), tools.debugHooks(), state.debugHooks(),
    audio.debugHooks()
  );
  window.GAME.state = state;
  window.GAME.netCodec = netCodec;

  loop.step(config.loop.fixedDt);
// The fresh-session fingerprint the cutscene's teardown is judged against.
  // Taken here, on the last line before the loop runs, because after this the
  // world is whatever somebody did to it.
  bootBaseline = worldFingerprint();
  bootUI = uiFingerprint();
  loop.start();
  window.__ducksBooted = true;
  document.body.classList.add('ready');

  // A private room IS its link, so arriving with one opens the lobby on that
  // room. It is done after the game is up and running: if the network is dead
  // the lobby says so over a game that is already playable, which is the whole
  // point of the link not being a gate.
  const roomParam = new URLSearchParams(location.search).get('room');
  // Stored preferences are applied to the LIVE objects here, once the whole
  // game exists: the volumes, the sensitivity, the camera and the backbuffer
  // all take their remembered values before the player sees the first frame.
  settings.applyAll();
  settingsUI.sync();
  if (roomParam) {
    // Arriving on a room link is already a choice of what to play, so the menu
    // stays out of the way and the lobby opens on that room, exactly as before.
    lobby.open({ joinRoomId: roomParam });
  } else {
    menu.open();
  }
}

boot().catch((err) => {
  console.error('[boot] fatal:', err);
  const msg = err && err.stack ? err.stack : String(err);
  if (typeof window.__ducksFatal === 'function') window.__ducksFatal(msg);
});
