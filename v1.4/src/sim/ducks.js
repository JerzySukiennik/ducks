// Fixed-size duck pool. Every rigid body and collider is allocated once at boot
// and recycled forever: nothing is created or destroyed while the game runs, so
// the Rapier body count is a boot-time constant and the cap can never be dodged
// by deleting somebody else's duck.

export const DUCK_FREE = 0;
export const DUCK_ACTIVE = 1;
export const DUCK_SLEEPING = 2;

const ZERO = { x: 0, y: 0, z: 0 };
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

// Crude convex duck silhouette (body + tail + head), used only when
// cfg.useConvexHull is on. Half-extents are the shipping default.
function duckHullPoints(hx, hy, hz) {
  const p = [
    [hx, 0, hz], [hx, 0, -hz], [-hx * 0.85, 0, hz], [-hx * 0.85, 0, -hz],
    [hx * 0.6, hy, hz * 0.6], [hx * 0.6, hy, -hz * 0.6],
    [-hx * 0.6, hy, hz * 0.6], [-hx * 0.6, hy, -hz * 0.6],
    [hx * 0.5, -hy, 0], [-hx * 0.5, -hy, 0],
    [-hx * 1.1, hy * 0.5, 0],
    [hx * 0.9, hy * 1.9, 0], [hx * 0.55, hy * 1.9, hz * 0.4], [hx * 0.55, hy * 1.9, -hz * 0.4],
    [hx * 1.35, hy * 1.5, 0],
  ];
  const out = new Float32Array(p.length * 3);
  for (let i = 0; i < p.length; i++) {
    out[i * 3] = p[i][0];
    out[i * 3 + 1] = p[i][1];
    out[i * 3 + 2] = p[i][2];
  }
  return out;
}

function pickTier(weights, rnd) {
  let total = 0;
  for (let i = 0; i < weights.length; i++) total += weights[i];
  if (!(total > 0)) return 0;
  let r = rnd() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

export function createDucks({ RAPIER, world, cfg, groups, counters, rng }) {
  const N = cfg.max;
  const hx = cfg.hx, hy = cfg.hy, hz = cfg.hz;
  const random = typeof rng === 'function' ? rng : Math.random;
  const propGroups = groups.interactionGroups(
    groups.GROUP_PROP, groups.GROUP_WORLD | groups.GROUP_PROP
  );

  const bodies = new Array(N);
  const colliders = new Array(N);
  // The head is a second collider on the same body; it must be parked, woken and
  // re-grouped in lockstep with the body one, or a parked duck would still block
  // things with its face.
  const headColliders = new Array(N);
  const state = new Uint8Array(N);
  const tiers = new Uint8Array(N);
  const idle = new Float32Array(N);
  const handleToId = new Map();
  const freeList = [];
  const hullFallbacks = [];
  let hullUsed = 0;
  let liveCount = 0;
  let refusals = 0;
  const refusalListeners = [];
  // A duck ARRIVING in the world, which is a thing the player can hear. Only
  // spawn() fires it: spawnSlot() is the snapshot restore path, and a client
  // joining a busy factory must not be greeted by three hundred squeaks.
  const spawnListeners = [];

  // Parking deliberately does NOT use RigidBody.setEnabled. Measured on Rapier
  // 0.14: one world.step() with a body disabled zeroes its mass properties, and
  // re-enabling does not restore them until a further step has run. Any impulse
  // in the frame a duck is spawned would therefore be multiplied by mass 0 and
  // silently vanish. Parking by collision group + gravity scale + forced sleep
  // keeps the mass (and the collider-derived inertia) intact at all times.
  const PARK_GROUPS = 0;

  const hullPoints = cfg.useConvexHull ? duckHullPoints(hx, hy, hz) : null;

  for (let i = 0; i < N; i++) {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, cfg.parkY - i * 0.5, 0)
        .setCanSleep(true)
        .setLinearDamping(cfg.linearDamping)
        .setAngularDamping(cfg.angularDamping)
    );
    let desc = null;
    if (cfg.useConvexHull) {
      try {
        desc = RAPIER.ColliderDesc.convexHull(hullPoints);
        if (!desc) throw new Error('convexHull returned null');
        hullUsed++;
      } catch (err) {
        desc = null;
        hullFallbacks.push(i);
      }
    }
    if (!desc) desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz);
    desc.setMass(cfg.mass)
      .setRestitution(cfg.restitution)
      .setFriction(cfg.friction)
      .setCollisionGroups(propGroups);

    bodies[i] = body;
    colliders[i] = world.createCollider(desc, body);

    // A rubber duck is not a box. Measured off duck.glb at the render scale, the
    // model is 0.386 m tall while the body box is 0.18 -- so the head and neck,
    // everything above 0.26 m, had NO collision at all. It passed through walls
    // and belts as if it were not there.
    //
    // The fix is a second cuboid on the SAME body rather than a convex hull:
    // the mesh has 1092 vertices, and a 1092-point hull resolving contacts 300
    // times over is a different order of cost from two boxes. The profile is
    // genuinely two boxes -- widest between 0.10 and 0.25 (the body), narrowing
    // above it (the head) -- so nothing is lost by saying so.
    if (cfg.headHalfY > 0) {
      const head = RAPIER.ColliderDesc.cuboid(cfg.headHalfX, cfg.headHalfY, cfg.headHalfZ)
        .setTranslation(cfg.headOffsetX, cfg.headOffsetY, 0)
        // Mass lives entirely on the body collider. Giving the head mass too
        // would quietly make every duck heavier than `ducks.mass` says, and
        // every throw impulse is scaled by that number.
        .setMass(0)
        .setRestitution(cfg.restitution)
        .setFriction(cfg.friction)
        .setCollisionGroups(propGroups);
      headColliders[i] = world.createCollider(head, body);
    }
    handleToId.set(body.handle, i);
    state[i] = DUCK_FREE;
    park(i);
    freeList.push(i);
  }

  if (hullFallbacks.length) {
    console.warn(
      `[ducks] convexHull rejected for ${hullFallbacks.length} duck(s); ` +
      `fell back to a cuboid. ids: ${hullFallbacks.slice(0, 16).join(',')}` +
      (hullFallbacks.length > 16 ? ',...' : '')
    );
  }

  function park(i) {
    const b = bodies[i];
    b.setLinvel(ZERO, false);
    b.setAngvel(ZERO, false);
    b.setRotation(IDENTITY, false);
    b.setTranslation({ x: 0, y: cfg.parkY - i * 0.5, z: 0 }, false);
    if (typeof b.enableCcd === 'function') b.enableCcd(false);
    colliders[i].setCollisionGroups(PARK_GROUPS);
    if (headColliders[i]) headColliders[i].setCollisionGroups(PARK_GROUPS);
    b.setGravityScale(0, false);
    b.sleep();
    idle[i] = 0;
  }

  function unpark(i, pos) {
    const b = bodies[i];
    colliders[i].setCollisionGroups(propGroups);
    if (headColliders[i]) headColliders[i].setCollisionGroups(propGroups);
    b.setGravityScale(1, false);
    b.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, false);
    b.setRotation(IDENTITY, false);
    b.setLinvel(ZERO, false);
    b.setAngvel(ZERO, false);
    b.wakeUp();
    idle[i] = 0;
  }

  // Single wake path. Rapier ignores forces on a sleeping body, so every
  // impulse in the project routes through here first.
  function wakeDuck(idOrHandle) {
    const b = resolveBody(idOrHandle);
    if (b) b.wakeUp();
    return b;
  }

  function resolveBody(idOrHandle) {
    if (typeof idOrHandle !== 'number' || !isFinite(idOrHandle)) return null;
    if (idOrHandle >= 0 && idOrHandle < N && Number.isInteger(idOrHandle) && bodies[idOrHandle]) {
      return bodies[idOrHandle];
    }
    const id = handleToId.get(idOrHandle);
    return id === undefined ? null : bodies[id];
  }

  function idForHandle(handle) {
    const id = handleToId.get(handle);
    return id === undefined ? null : id;
  }

  function spawn(pos, tierOrNull) {
    if (freeList.length === 0) {
      refusals++;
      for (let i = 0; i < refusalListeners.length; i++) {
        try { refusalListeners[i](N); } catch (e) { /* ignore */ }
      }
      return null;
    }
    const id = freeList.pop();
    const p = pos || { x: 0, y: 1, z: 0 };
    unpark(id, p);
    let tier = tierOrNull;
    if (typeof tier !== 'number' || !isFinite(tier)) tier = pickTier(cfg.weights, random);
    tiers[id] = Math.max(0, Math.min(cfg.multipliers.length - 1, Math.round(tier)));
    state[id] = DUCK_ACTIVE;
    liveCount++;
    for (let i = 0; i < spawnListeners.length; i++) {
      try { spawnListeners[i](id, p.x, p.y, p.z, tiers[id]); } catch (e) { /* ignore */ }
    }
    return id;
  }

  // Spawn into a SPECIFIC pool slot. A client is told "the host spawned duck
  // 47"; the pool slot IS the wire identity, so the client cannot take whatever
  // slot its own free list happens to be holding -- every later message about
  // that duck would address a different one. Nothing in single player calls
  // this, and it creates no body: the pool is still allocated once at boot.
  function spawnSlot(id, pos, tierOrNull) {
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 0 || id >= N) return null;
    if (state[id] !== DUCK_FREE) return id;   // already ours, nothing to take
    const at = freeList.lastIndexOf(id);
    if (at < 0) return null;
    freeList.splice(at, 1);
    unpark(id, pos || { x: 0, y: 1, z: 0 });
    let tier = tierOrNull;
    if (typeof tier !== 'number' || !isFinite(tier)) tier = pickTier(cfg.weights, random);
    tiers[id] = Math.max(0, Math.min(cfg.multipliers.length - 1, Math.round(tier)));
    state[id] = DUCK_ACTIVE;
    liveCount++;
    return id;
  }

  function release(id) {
    if (typeof id !== 'number' || id < 0 || id >= N) return false;
    if (state[id] === DUCK_FREE) return false;
    state[id] = DUCK_FREE;
    liveCount--;
    park(id);
    freeList.push(id);
    return true;
  }

  // Runs after world.step(). Owns the FREE -> ACTIVE -> SLEEPING transition.
  function postStep(dt) {
    const lin2 = cfg.sleepLinearEps * cfg.sleepLinearEps;
    const ang2 = cfg.sleepAngularEps * cfg.sleepAngularEps;
    for (let id = 0; id < N; id++) {
      if (state[id] === DUCK_FREE) continue;
      const b = bodies[id];
      const asleep = b.isSleeping();
      if (asleep) {
        state[id] = DUCK_SLEEPING;
        idle[id] = cfg.sleepAfter;
        continue;
      }
      const v = b.linvel();
      const w = b.angvel();
      const moving =
        (v.x * v.x + v.y * v.y + v.z * v.z) > lin2 ||
        (w.x * w.x + w.y * w.y + w.z * w.z) > ang2;
      if (moving) {
        idle[id] = 0;
        state[id] = DUCK_ACTIVE;
      } else {
        idle[id] += dt;
      }
      // sleepAfter is a guaranteed ceiling, not a floor: Rapier's own idle
      // threshold usually fires first (and cheaper), and this backstop catches
      // ducks that jitter just above it and would otherwise never settle.
      if (idle[id] >= cfg.sleepAfter) {
        if (typeof b.enableCcd === 'function') b.enableCcd(false);
        b.sleep();
        state[id] = DUCK_SLEEPING;
      } else {
        state[id] = DUCK_ACTIVE;
      }
    }
  }

  function count() {
    let sleeping = 0;
    for (let id = 0; id < N; id++) {
      if (state[id] !== DUCK_FREE && bodies[id].isSleeping()) sleeping++;
    }
    return { live: liveCount, sleeping, free: N - liveCount, max: N };
  }

  function pose(id) {
    if (typeof id !== 'number' || id < 0 || id >= N) return null;
    if (state[id] === DUCK_FREE) return null;
    const b = bodies[id];
    const t = b.translation();
    const r = b.rotation();
    return {
      x: t.x, y: t.y, z: t.z,
      qx: r.x, qy: r.y, qz: r.z, qw: r.w,
      tier: tiers[id],
      sleeping: b.isSleeping(),
    };
  }

  function forEach(cb) {
    if (typeof cb !== 'function') return;
    for (let id = 0; id < N; id++) {
      if (state[id] === DUCK_FREE) continue;
      const b = bodies[id];
      const t = b.translation();
      const r = b.rotation();
      cb(id, t.x, t.y, t.z, r.x, r.y, r.z, r.w, tiers[id], b.isSleeping());
    }
  }

  function value(id, base, mul) {
    const t = tiers[id] || 0;
    return base * cfg.multipliers[t] * mul;
  }

  function dispose() {
    handleToId.clear();
    freeList.length = 0;
  }

  return {
    spawn,
    spawnSlot,
    release,
    count,
    atCap: () => freeList.length === 0,
    pose,
    forEach,
    tier: (id) => (id >= 0 && id < N && state[id] !== DUCK_FREE ? tiers[id] : null),
    multiplier: (t) => cfg.multipliers[Math.max(0, Math.min(cfg.multipliers.length - 1, t | 0))],
    value,
    isActive: (id) => id >= 0 && id < N && state[id] !== DUCK_FREE,
    stateOf: (id) => (id >= 0 && id < N ? state[id] : null),
    body: (id) => (id >= 0 && id < N ? bodies[id] : null),
    idForHandle,
    handleOf: (id) => (id >= 0 && id < N ? bodies[id].handle : null),
    wakeDuck,
    resolveBody,
    max: N,
    refusedCount: () => refusals,
    capMessage: () => `Duck pool full (${N}/${N}) - the source stopped. Clear ducks into the pit.`,
    onCapRefusal(cb) { if (typeof cb === 'function') refusalListeners.push(cb); },
    onSpawn(cb) { if (typeof cb === 'function') spawnListeners.push(cb); },
    hullFallbacks: () => hullFallbacks.slice(),
    headColliderCount: () => headColliders.filter(Boolean).length,
    hullUsed: () => hullUsed,
    massOf: (id) => (id >= 0 && id < N ? bodies[id].mass() : null),
    _postStep: postStep,
    dispose,
  };
}

export default createDucks;
