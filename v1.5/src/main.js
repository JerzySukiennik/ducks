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
import { createMachine } from './sim/machine.js';
import { createBenches } from './sim/benches.js';
import { createShop } from './sim/shop.js';
import { createStock } from './sim/stock.js';
import { createPrestige } from './sim/prestige.js';
import { createProducers } from './sim/producers.js';
import { createCollectors, createAttention } from './sim/collectors.js';
import { createConveyors } from './sim/conveyors.js';
import { createBlowers } from './sim/blowers.js';
import { createContainers, isStorageRow } from './sim/containers.js';
import { createTools, isToolRow } from './sim/tools.js';
import { createState } from './sim/state.js';
import { createSnapshotCodec } from './net/snapshot.js';
import { createNetGame } from './net/game.js';
import { REQ } from './net/protocol.js';
import { CATALOG, byId, byNetId, unstagedModels, isHandCarryable, VALIDATION } from './data/index.js';
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
        wheel(x, y, z) {
          const m = config.machine;
          if (x <= m.splitMinX) return false;
          const dy = y - m.wheelLocalY;
          const dz = z - m.wheelLocalZ;
          return dy * dy + dz * dz < m.splitRadius * m.splitRadius;
        },
      },
    },
  };
  for (const row of CATALOG) {
    if (row.model && !modelSpecs[row.model]) modelSpecs[row.model] = { fallbackBox: row.footprint };
  }
  // Booth scenery. Sizes are the model bounding boxes, used only if the GLB
  // fails to load.
  if (!modelSpecs.shop) modelSpecs.shop = { fallbackBox: [2.9, 2.87, 2.49] };
  if (!modelSpecs.vendor) modelSpecs.vendor = { fallbackBox: [0.66, 1.88, 0.43] };
  if (!modelSpecs.lamp) modelSpecs.lamp = { fallbackBox: [0.68, 3.15, 1.24] };
  // Other players. Not a catalog row -- nobody buys a person -- so it is named
  // here or it never loads.
  if (!modelSpecs.avatar) modelSpecs.avatar = { fallbackBox: [0.6, 1.85, 0.4] };

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
  }

  const machine = createMachine({ clicksPerTurn: config.machine.clicksPerTurn });
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
  const sceneryTargets = [
    {
      name: crankRow.name,
      sub: crankRow.interact.hint,
      focusable: !!crankRow.interact.part,
      mesh: props.group.getObjectByName('machineWheel'),
      aim: (o, d) => props.wheelAimDistance(o, d),
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
  // Purchased manual workbenches. One click counter per placed bench, keyed by
  // its placement key, so a bought bench cranks on its own without touching the
  // starter one's state.
  const benches = createBenches({ list: automationList, byId });
  const producers = createProducers({
    ducks: world.ducks,
    applyImpulse: world.applyImpulse,
    list: automationList,
    byId,
    config,
    statsOf: () => shop.stats(),
  });
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

  if (typeof world.onFixedUpdate === 'function') {
    world.onFixedUpdate((h) => {
      conveyors._fixedUpdate(h);
      blowers._fixedUpdate(h);
      // The slot spring and the broom are springs like the grab controller: the
      // impulse has to land in the substep the solver is about to integrate, not
      // once per frame, or a full crate visibly sags between frames.
      containers._fixedUpdate(h);
      tools._fixedUpdate(h);
    });
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
  function uiCapture() {
    const owned = !!(
      (menu && menu.isOpen()) || (settingsUI && settingsUI.isOpen())
      || (lobby && lobby.isOpen()) || (shopUI && shopUI.isOpen())
      || (summaryUI && summaryUI.isOpen())
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
    onHost: (session) => {
      const n = netLayer();
      if (n && n.attachHost) n.attachHost(session);
    },
    onJoin: (session) => {
      const n = netLayer();
      if (n && n.attachClient) n.attachClient(session);
    },
    onLeave: (session, wasHost) => {
      const n = netLayer();
      if (n && n.detach) n.detach(session);
      endSession(wasHost ? 'You ended the session.' : 'You left the room.');
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
    onUi: (kind) => audio.ui(kind),
    onOpen: () => { uiCapture(); },
    onClose: () => { uiCapture(); if (menu) menu.sync(); },
  });

  // The menu sits in front of everything and starts open. The world is already
  // built and the loop is already running behind it -- Solo does not start a
  // game, it closes a panel -- which is why the network being dead can never
  // stand between the player and playing.
  menu = createMenuUI({
    container,
    settings,
    version: meta.version,
    degraded: !!degraded,
    session: () => lobby.session(),
    onUi: (kind) => audio.ui(kind),
    onOpen: () => { uiCapture(); },
    onClose: () => { if (!uiCapture()) input.requestLock(); },
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
      if (lobby.session()) lobby.leave();
      else endSession('You ended the session.');
    },
  });

  // Which tab makes something you build rather than something you carry. Data,
  // not an id list: a new machine row is buildable because its tab says so.
  const BUILD_TABS = { machines: true, buildings: true };
  function isBuildable(row) { return !!row && !!BUILD_TABS[row.tab] && !!row.model; }

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
    // An upgrade only exists once something reads its stat. This is the crank's
    // and the economy's reader; the producers and collectors read theirs every
    // update. The frame calls it too -- this one is so a purchase takes effect
    // in the frame it was made rather than the next one.
    applyStats();
    props.setWheelAngle(machine.angle());
  });

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
    const res = net.act({ a: REQ.PICKUP, key: t.prop.key });
    if (res && res.pending) return null;
    if (!res || !res.ok) { if (res && res.reason) hud.showCap(res.reason); return null; }
    pickUps++;
    lastPickup = { id: res.id, name: res.name, key: res.key, distance: t.distance };
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
    return { record: res.record, placement: res.placement };
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
        else if (lobby.isOpen()) lobby.close();
        else if (summaryUI.isOpen()) { /* the summary is dismissed by its own button */ }
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
      if (c === 'KeyE') {
        if (shopUI.isOpen()) shopUI.close();
        else if (pickupTarget()) pickUp();
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

  // One click is one tenth of a turn. The tenth click ejects a duck; if the pool
  // is full the turn is handed back one click short instead of being eaten.
  //
  // `rec` is a PURCHASED workbench, or null for the starter one standing on the
  // plate at boot. Everything below the state object is identical for both,
  // because a bought bench is the same machine: same size, same wheel, same ten
  // clicks, its own duck out of its own pipe.
  function crankOnce(rec) {
    audio.crank();
    if (rec) {
      const r = benches.crank(rec);
      if (!r) return { clicks: 0, angle: 0, complete: false, refused: true };
      placed.setWheelAngle(rec, benches.angle(rec));
      if (r.complete && ejectDuck(rec) === null) {
        benches.refund(rec);
        placed.setWheelAngle(rec, benches.angle(rec));
        return { clicks: r.clicks, angle: benches.angle(rec), complete: false, refused: true };
      }
      return r;
    }
    const r = machine.crank();
    props.setWheelAngle(machine.angle());
    if (r.complete && ejectDuck(null) === null) {
      machine.refund();
      props.setWheelAngle(machine.angle());
      return { clicks: machine.clicks(), angle: machine.angle(), complete: false, refused: true };
    }
    return r;
  }

  // What the crosshair is on: the starter bench's wheel, a purchased bench's
  // wheel, or nothing. The starter test lives in props.js next to the wheel's
  // own geometry and is shared with the crosshair outline, so the rim the player
  // sees light up and the thing this click acts on are the same sphere by
  // construction; placed.crankAim runs the same test on every bought bench.
  // Returns null or { rec }, where rec is null for the starter one.
  function wheelUnderCursor() {
    const a = view.aim();
    const starter = props.wheelAimDistance(a.origin, a.dir);
    const bought = placed.crankAim(a.origin, a.dir);
    if (starter >= 0 && (!bought || starter <= bought.distance)) return { rec: null };
    return bought ? { rec: bought.rec } : null;
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

  function syncBodies() {
    for (let i = 0; i < tracked.length; i++) {
      view.setPose(tracked[i], world.bodyPose(tracked[i]));
    }
  }

  // Hold to carry: the down edge grabs, the up edge drops. A down edge aimed at
  // the wheel cranks instead of grabbing, so the two never fight.
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
      if (net.holdingLocal()) net.act({ a: REQ.HURL });
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
      if (tools.takesGrabButton()) { net.act({ a: REQ.TOOL, down: true }); continue; }
      // A BUILDING in hand means the click places it, never grabs. A carryable
      // that is not a tool (an empty bucket, say) does neither, so it leaves the
      // grab button alone instead of swallowing it.
      if (isBuildable(hotbar.current())) { doPlace(); continue; }
      if (net.holdingLocal()) continue;
      // `key` names WHICH workbench: absent for the starter one, the placement
      // key for a purchased one. The host still checks reach itself.
      if (onWheel) net.act({ a: REQ.CRANK, key: onWheel.rec ? onWheel.rec.key : 0 });
      else {
        // The aim travels as evidence, not as a target id: the host casts the
        // ray itself and decides what was hit.
        const aim = view.aim();
        net.act({
          a: REQ.GRAB,
          o: [aim.origin.x, aim.origin.y, aim.origin.z],
          d: [aim.dir.x, aim.dir.y, aim.dir.z],
        });
      }
    }
    for (let i = 0; i < a.grabUp; i++) {
      if (demolishing) { demolishHold = 0; continue; }
      if (tools.takesGrabButton()) { net.act({ a: REQ.TOOL, down: false }); continue; }
      net.act({ a: REQ.DROP });
    }
    hud.setHolding(net.holdingLocal());
  }

  // completeStep() returns true only on the frame a step actually advances, so
  // the fanfare fires once per step rather than every frame after it.
  function onboardingStep(id) { if (hud.completeStep(id)) audio.achievement(); }

  function updateOnboarding(pos) {
    const t = props.machineBase();
    const dx = pos.x - t.x;
    const dz = pos.z - t.z;
    if (dx * dx + dz * dz < config.hud.machineHintRadius * config.hud.machineHintRadius) {
      onboardingStep('walk');
    }
    // On a CLIENT the local slot-0 controller never grabs anything (the hold
    // lives in the host's world), so the onboarding step reads the same fact the
    // HUD does rather than a counter that can only ever move in single player.
    if (world.hold.grabCount() > 0 || net.holdingLocal()) onboardingStep('grab');
    if (world.pit.totalScored() > 0) onboardingStep('score');
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

  function frame(dt, source) {
    const t0 = performance.now();
    // Stamped every frame from every source. A host reads it to decide whether
    // requestAnimationFrame has gone quiet -- which is exactly what happens the
    // moment the host's tab is hidden -- and takes the simulation over on its
    // worker clock when it has. While the tab is visible this is only a stamp.
    net.beginFrame();
    const inp = input.read();
    player.update(dt, inp);
    applyColliderFilters();
    syncContainers();
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
    producers.update(dt);
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
    const eye = player.eyePosition();
    view.updateCamera(eye, inp.yaw, inp.pitch);
    // The TARGET, not a boolean: `x && y && z` evaluates to its last truthy
    // operand, so writing this as one chain handed the click `true` instead of
    // the workbench it was aimed at -- and a crank with no target is the starter
    // machine, 35 m away. That is exactly the defect the owner saw.
    const onWheel = (shopUI.isOpen() || hotbar.current() || demolishing)
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
    // Build and demolish notices come first: when a mode owns the crosshair, the
    // thing it is refusing or removing beats "Press E - Shop" every time.
    hud.setPrompt(
      shopUI.isOpen() ? null
        : buildNotice ? buildNotice.label
          : pickable ? 'Press E - Pick up ' + pickable.row.name
            : onWheel && !net.holdingLocal() ? 'Click to crank'
              : nearBooth ? 'Press E - Shop'
                : null,
      buildNotice ? buildNotice.percent
        : onWheel && !pickable ? crankProgress(onWheel) * 100 : null,
      !!(buildNotice && buildNotice.bad)
    );
    updateOnboarding(player.position());
    // Remote players: interpolated off wall-clock stamps, because that is the
    // clock the samples arrive on. Nothing about them is simulated here.
    syncAvatars();
    avatars.update(performance.now(), view.camera);
    // The chute lets a few deliveries out per frame. HOST AND SINGLE PLAYER
    // ONLY: on a client a prop exists because the host said so and arrives in
    // the state stream, never because this tab decided to spawn one.
    // Ahead of syncProps so a prop that lands this frame is drawn this frame,
    // and clocked on simTime so debugStep drives it like everything else.
    if (!net.isClient()) pumpDeliveries(simTime);
    placed.syncProps();
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
      !shopUI.isOpen() && !demolishing && !isBuildable(hotbar.current()));
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
    hud, crankOnce, crankStates,
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
    onRoster() { /* syncAvatars() reads net.players() once per frame */ },
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
    // Crank a PURCHASED workbench by its placement key, head-down: the same
    // request the mouse sends, so nothing here is a second code path.
    debugCrankPlaced(key, n) {
      const count = Math.max(1, Math.round(n === undefined ? 1 : n));
      let last = null;
      for (let i = 0; i < count; i++) last = net.act({ a: REQ.CRANK, key });
      const rec = placed.objects.find((o) => o.key === key) || null;
      return {
        key,
        found: !!rec,
        wheelDegrees: rec ? (rec.wheelAngle * 180) / Math.PI : null,
        progress: rec ? benches.progress(rec) : null,
        crankedDucks,
        live: world.ducks.count().live,
        last,
      };
    },
    debugBenches() { return benches.info(); },
    debugCrank(n) {
      const count = Math.max(1, Math.round(n === undefined ? 1 : n));
      let last = null;
      for (let i = 0; i < count; i++) last = net.act({ a: REQ.CRANK });
      return {
        clicks: machine.clicks(),
        turns: machine.turns(),
        angleDegrees: machine.angleDegrees(),
        wheelMeshDegrees: (props.wheelAngle() * 180) / Math.PI,
        crankedDucks,
        live: world.ducks.count().live,
        last,
      };
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
        steps: hud.stepsDone(),
        capVisible: hud.capVisible(),
        prompt: hud.promptText(),
        promptVisible: hud.promptVisible(),
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
    debugKeyBarState() {
      const bar = hud.keyBar;
      // The key bar is off the game screen: its fifteen prompts live in the
      // menu's Controls panel now. Reported rather than thrown, so a check that
      // asks about it gets the truth instead of a stack trace.
      if (!bar) return { mode: 'off', glyphs: 0, prompts: 0, text: '' };
      return {
        mode: bar.mode(),
        glyphs: bar.glyphCount(),
        prompts: bar.promptCount(),
        text: bar.root.textContent,
      };
    },
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
    debugCrankRate() {
      return {
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
      if (hotbar.countOf(row.id) <= 0) hotbar.add(row, 1);
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
    debugCrankProgressOf(key) { return net.crankProgressOf(Math.round(key) || 0); },
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
