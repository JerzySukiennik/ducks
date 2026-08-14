// The bottomless pit: a 32-gon shaft cut through the ground plate.
//
// Geometry note: the shaft wall is 32 thin cuboids, never a convex hull -- 32
// nearly-coplanar points make ColliderDesc.convexHull throw. The hole itself is
// carved the same way: each of the 32 floor slabs is a half-plane tangent to the
// pit circle, and the union of 32 tangent half-planes is exactly the complement
// of the inscribed 32-gon. That keeps the hole a true 32-gon instead of the
// square a four-slab cut-out would leave, so "0.2 m outside the radius" really
// does land on solid floor in every direction.

function yQuat(angle) {
  const h = angle * 0.5;
  return { x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) };
}

export function createPit({ RAPIER, world, cfg, groups, ducks, economy, players, plate }) {
  const N = cfg.segments;
  const R = cfg.radius;
  const C = { x: cfg.center.x, y: cfg.center.y, z: cfg.center.z };
  const worldGroups = groups.interactionGroups(
    groups.GROUP_WORLD, groups.GROUP_WORLD | groups.GROUP_PROP | groups.GROUP_PLAYER
  );

  const shaftBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0)
  );

  const wallColliders = [];
  const rimColliders = [];
  const t = cfg.wallThickness;
  const halfDepth = cfg.shaftDepth * 0.5;
  const tangHalfWall = (R + t) * Math.tan(Math.PI / N) * 1.25 + 0.05;

  for (let k = 0; k < N; k++) {
    const theta = (k * 2 * Math.PI) / N;
    const nx = Math.cos(theta);
    const nz = Math.sin(theta);
    // Rotation about +Y by -theta maps local +X onto (cos t, 0, sin t).
    const q = yQuat(-theta);

    // Rim: tangent half-plane slab forming the plate's 32-gon hole.
    const rimHalf = cfg.rimReach;
    rimColliders.push(world.createCollider(
      RAPIER.ColliderDesc.cuboid(rimHalf, plate.halfThickness, rimHalf * 2)
        .setTranslation(
          C.x + nx * (R + rimHalf),
          C.y - plate.halfThickness,
          C.z + nz * (R + rimHalf)
        )
        .setRotation(q)
        .setFriction(plate.friction)
        .setCollisionGroups(worldGroups),
      shaftBody
    ));

    // Shaft wall: thin vertical cuboid just outside the 32-gon edge.
    wallColliders.push(world.createCollider(
      RAPIER.ColliderDesc.cuboid(t, halfDepth, tangHalfWall)
        .setTranslation(C.x + nx * (R + t), C.y - halfDepth, C.z + nz * (R + t))
        .setRotation(q)
        .setFriction(cfg.wallFriction)
        .setRestitution(cfg.wallRestitution)
        .setCollisionGroups(worldGroups),
      shaftBody
    ));
  }

  const scorePlaneY = C.y - cfg.scoreDepth;
  const captureR2 = (R + cfg.captureMargin) * (R + cfg.captureMargin);
  const playerFallY = C.y - cfg.playerFallDepth;

  // Whether THIS copy of the pit pays for ducks. A client's pit must not: the
  // ducks it sees are poses the host sent, its shaft is a replica, and when a
  // duck's pose crossed the sensor plane the client paid ITSELF for it. Measured
  // on two tabs: the client went 9000 -> 9001 while the host stayed at 9000, so
  // the player who joined ended up richer than the host until the next money
  // diff overwrote it. Scoring a duck also RELEASES its body, which is the
  // host's call alone -- a client releasing one locally would hand the pool a
  // body the host still believes in.
  let scoring = true;
  let events = [];
  let scored = 0;
  let paid = 0;
  const playerFall = new Map(); // player index -> seconds spent below the rim

  function postStep(dt) {
    // Ducks: crossing the sensor plane inside the shaft pays out and recycles.
    if (scoring) ducks.forEach((id, x, y, z) => {
      if (y > scorePlaneY) return;
      const dx = x - C.x;
      const dz = z - C.z;
      if (dx * dx + dz * dz > captureR2) return;
      const value = ducks.value(id, economy.duckBaseValue, economy.duckValueMul);
      economy.add(value, 'pit');
      events.push({ type: 'duck', id, value, tier: ducks.tier(id) });
      scored++;
      paid += value;
      ducks.release(id);
    });

    // Players: falling in is free. After a couple of seconds of fall the player
    // is put back near the tube instead of dropping forever.
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const body = world.getRigidBody(p.handle);
      if (!body) continue;
      const tr = body.translation();
      if (tr.y > playerFallY) {
        if (playerFall.has(i)) playerFall.delete(i);
        continue;
      }
      const elapsed = (playerFall.get(i) || 0) + dt;
      if (elapsed < cfg.playerFallSeconds) {
        playerFall.set(i, elapsed);
        continue;
      }
      playerFall.delete(i);
      const r = cfg.playerRespawn;
      body.setTranslation({ x: r.x, y: r.y, z: r.z }, true);
      if (typeof body.setNextKinematicTranslation === 'function') {
        body.setNextKinematicTranslation({ x: r.x, y: r.y, z: r.z });
      }
      events.push({ type: 'player', id: i, value: 0 });
    }
  }

  function consumeEvents() {
    if (events.length === 0) return [];
    const out = events;
    events = [];
    return out;
  }

  return {
    center: () => ({ x: C.x, y: C.y, z: C.z }),
    radius: () => R,
    segments: () => N,
    depth: () => cfg.shaftDepth,
    scorePlaneY: () => scorePlaneY,
    consumeEvents,
    pendingEvents: () => events.length,
    // Set false on a client, true everywhere else; see `scoring` above.
    setScoring(v) { scoring = !!v; return scoring; },
    isScoring: () => scoring,
    totalScored: () => scored,
    totalPaid: () => paid,
    colliderCount: () => wallColliders.length + rimColliders.length,
    contains(x, z) {
      const dx = x - C.x;
      const dz = z - C.z;
      return dx * dx + dz * dz <= R * R;
    },
    _postStep: postStep,
  };
}

export default createPit;
