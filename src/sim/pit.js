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
  // Every collider's offset from the pit's CENTRE, in the same order it was
  // created. A pit that can move needs this: the second pit is rolled onto one
  // of four edges at the start of every run, and rebuilding sixty-four
  // colliders is a great deal more work than moving them.
  const offsets = [];
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
    offsets.push({ x: nx * (R + rimHalf), y: -plate.halfThickness, z: nz * (R + rimHalf) });
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
    offsets.push({ x: nx * (R + t), y: -halfDepth, z: nz * (R + t) });
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

  // MOVE THE WHOLE SHAFT. Rapier lets a collider be re-translated in place, so
  // relocating a pit is sixty-four writes rather than sixty-four rebuilds --
  // and, more importantly, nothing that holds a reference to this pit has to be
  // told, because it is the same pit.
  function relocate(centre) {
    const nx = Number(centre.x);
    const nz = Number(centre.z);
    if (!isFinite(nx) || !isFinite(nz)) return false;
    C.x = nx;
    C.z = nz;
    const all = rimColliders.concat(wallColliders);
    // offsets was filled rim-then-wall per segment; rebuild that interleaving.
    for (let k = 0; k < N; k++) {
      const o1 = offsets[k * 2];
      const o2 = offsets[k * 2 + 1];
      rimColliders[k].setTranslation({ x: C.x + o1.x, y: o1.y, z: C.z + o1.z });
      wallColliders[k].setTranslation({ x: C.x + o2.x, y: o2.y, z: C.z + o2.z });
    }
    return all.length;
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
  // 1 for the main pit; the second pit is created with its own and the shop
  // upgrade raises it. Held here rather than read off cfg every duck so the
  // upgrade can move it at runtime without rebuilding a shaft.
  let payMul = typeof cfg.payMul === 'number' && isFinite(cfg.payMul) ? cfg.payMul : 1;
  const name = cfg.name || 'pit';
  let events = [];
  let scored = 0;
  let paid = 0;
  const playerFall = new Map(); // player index -> seconds spent below the rim

  function postStep(dt) {
    // Ducks: crossing the sensor plane inside the shaft pays out and recycles.
    // `scoring` gates the two things that are the HOST'S alone -- paying, and
    // releasing the body back to the pool. It must NOT gate noticing.
    //
    // It used to wrap this whole loop, and that cost a client four systems at
    // once: no `duck` event meant no rising pit note (the game's signature
    // sound) and no rare-duck sting, no `scored` counter meant the summary
    // reported zero and "rarest: none", and main.js's onboarding trigger reads
    // that same counter -- so a player who JOINED a friend's game had the
    // tutorial stall on step 3 forever. In a 1-4 player co-op that was up to
    // three players out of four. A client now sees and hears everything and
    // simply does not touch the money or the pool.
    ducks.forEach((id, x, y, z) => {
      if (y > scorePlaneY) return;
      const dx = x - C.x;
      const dz = z - C.z;
      if (dx * dx + dz * dz > captureR2) return;
      // WHAT THIS HOLE PAYS. The main pit's multiplier is 1 and never appears;
      // the second pit's starts at config.pit2.payMul and is raised by the shop
      // upgrade through setPayMul(). It multiplies the duck's own value, so a
      // better hole is worth more on a rare duck than on a plain one -- which
      // is what makes "carry the good ones further" a decision rather than a
      // chore.
      const value = ducks.value(id, economy.duckBaseValue, economy.duckValueMul) * payMul;
      events.push({ type: 'duck', id, value, tier: ducks.tier(id), pit: name });
      scored++;
      if (!scoring) return;
      economy.add(value, 'pit');
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
    payMul: () => payMul,
    setPayMul(v) {
      const n = Number(v);
      payMul = isFinite(n) && n > 0 ? n : payMul;
      return payMul;
    },
    name: () => name,
    relocate,
    edge: () => (cfg.edge === undefined ? null : cfg.edge),
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
