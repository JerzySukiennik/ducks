// Garry's-Mod-style grab. The held body stays DYNAMIC and keeps its collision
// groups: it must still bump into walls and be deflectable by other props. It is
// driven to a target point by a critically damped PD spring (kd = 2*sqrt(kp)),
// applied as an impulse, and the grab breaks when the body drifts too far --
// which is what happens when the body is pinned behind geometry.

function len3(x, y, z) { return Math.sqrt(x * x + y * y + z * z); }

// ONE CONTROLLER PER PLAYER, ONE REGISTRY FOR ALL OF THEM
// A controller is created per player slot (world.holdFor), and every controller
// in a world shares one `claims` map: body handle -> owner slot. That map is the
// whole of the arbitration. It is read AND written inside the same synchronous
// tryGrab() call as the raycast, so two players reaching for the same duck
// cannot both pass however close together they arrive: the first to reach
// tryGrab owns the handle and the second reads it and is refused. There is no
// tick boundary in between for a race to live in.
//
// The 300 duck bodies are a fixed recycled pool, so a claim is keyed by the live
// rigid-body HANDLE and dropped the moment the hold ends -- otherwise a pool
// slot handed back out would be born already owned by whoever last held it.
export function createHold({
  RAPIER, world, cfg, groups, ducks, applyImpulse, getAim, claims, owner,
}) {
  // Single player passes neither: one controller, nothing to arbitrate, and the
  // claim bookkeeping below collapses to a no-op.
  const registry = claims || null;
  const me = owner === undefined ? 0 : owner;
  const kp = cfg.kp;
  const kd = cfg.kdScale * Math.sqrt(cfg.kp);
  // A query is filtered by the SAME two-way test as a contact, so a ray whose
  // membership is only PLAYER can never see a prop (props filter WORLD|PROP).
  // The grab ray therefore claims membership in everything it is allowed to hit.
  const QUERY_GROUPS = groups.interactionGroups(
    groups.GROUP_WORLD | groups.GROUP_PROP | groups.GROUP_PLAYER,
    groups.GROUP_WORLD | groups.GROUP_PROP
  );

  // Long Arms and Strong Arm, set from main.js applyStats(). Both were computed

  // and stored by the shop and read by NOBODY: two levels of Long Arms left the

  // grab failing at exactly the base 4.0 m, and throwImpulseMul was never touched

  // at all. src/data/stats.js names hold.grabRange and hold.throwImpulse as their

  // readers -- this is that wiring.

  let grabRangeAdd = 0;

  let throwImpulseMul = 1;

  let held = null;          // rigid body
  let heldDuckId = null;
  let restore = null;       // damping to put back on release
  let distance = cfg.distanceDefault;
  const target = { x: 0, y: 0, z: 0 };
  let lastBreakDistance = 0;
  let breaks = 0;
  let grabs = 0;
  let throws = 0;
  let refused = 0;
  let lastRefusal = null;
  let stolenReleases = 0;
  const grabListeners = [];
  const throwListeners = [];

  function announce(list, ev) {
    for (let i = 0; i < list.length; i++) {
      try { list[i](ev); } catch (e) { /* a broken listener never drops the duck */ }
    }
  }

  function aim() {
    const a = getAim();
    if (!a) return null;
    const d = a.dir;
    const l = len3(d.x, d.y, d.z);
    if (!(l > 1e-6)) return null;
    return {
      origin: a.origin,
      dir: { x: d.x / l, y: d.y / l, z: d.z / l },
      body: a.body || null,
    };
  }

  function computeTarget(a) {
    target.x = a.origin.x + a.dir.x * distance;
    target.y = a.origin.y + a.dir.y * distance;
    target.z = a.origin.z + a.dir.z * distance;
    return target;
  }

  function refuse(reason) {
    refused++;
    lastRefusal = reason;
    return false;
  }

  function tryGrab(originVec, dirVec) {
    if (held) return refuse('already holding something');
    let origin = originVec;
    let dir = dirVec;
    if (!origin || !dir) {
      const a = aim();
      if (!a) return refuse('no aim');
      origin = a.origin;
      dir = a.dir;
    }
    const l = len3(dir.x, dir.y, dir.z);
    if (!(l > 1e-6)) return refuse('no aim');
    const nd = { x: dir.x / l, y: dir.y / l, z: dir.z / l };

    const a = aim();
    const excludeBody = a ? a.body : null;
    const ray = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, nd);
    const hit = world.castRay(
      ray, cfg.grabRange + grabRangeAdd, true, undefined, QUERY_GROUPS, undefined, excludeBody || undefined
    );
    if (!hit) return refuse('nothing in reach');
    const collider = hit.collider || (hit.colliderHandle !== undefined
      ? world.getCollider(hit.colliderHandle) : null);
    if (!collider) return refuse('nothing in reach');
    const body = collider.parent();
    if (!body || typeof body.isDynamic !== 'function' || !body.isDynamic()) {
      return refuse('that will not move');
    }
    // The arbitration, in the same breath as the raycast: first request wins and
    // every later one is told plainly why, rather than quietly ending up with a
    // second controller springing the same body in a different direction.
    if (registry && registry.has(body.handle) && registry.get(body.handle) !== me) {
      return refuse('somebody else has it');
    }

    held = body;
    if (registry) registry.set(body.handle, me);
    heldDuckId = ducks ? ducks.idForHandle(body.handle) : null;
    grabs++;
    restore = {
      lin: body.linearDamping(),
      ang: body.angularDamping(),
    };
    body.setLinearDamping(cfg.heldLinearDamping);
    body.setAngularDamping(cfg.heldAngularDamping);
    wake();
    // Seed the target at the current distance so the spring does not yank.
    const t = body.translation();
    const dx = t.x - origin.x, dy = t.y - origin.y, dz = t.z - origin.z;
    setDistance(len3(dx, dy, dz));
    announce(grabListeners, { duck: heldDuckId, x: t.x, y: t.y, z: t.z });
    return true;
  }

  function wake() {
    if (!held) return;
    if (heldDuckId !== null && ducks) ducks.wakeDuck(heldDuckId);
    else held.wakeUp();
  }

  function release() {
    if (!held) return false;
    if (restore) {
      held.setLinearDamping(restore.lin);
      held.setAngularDamping(restore.ang);
    }
    // Dropped before the reference is, so a body can never leave a hold still
    // marked as owned -- which would make that duck ungrabbable for the rest of
    // the session, by anybody, with nothing on screen to say why.
    if (registry && registry.get(held.handle) === me) registry.delete(held.handle);
    held = null;
    heldDuckId = null;
    restore = null;
    return true;
  }

  function doThrow() {
    if (!held) return false;
    const a = aim();
    const body = held;
    const m = body.mass() || cfg.fallbackMass;
    wake();
    if (a) {
      applyImpulse(body, {
        x: a.dir.x * cfg.throwImpulse * throwImpulseMul * m,
        y: a.dir.y * cfg.throwImpulse * throwImpulseMul * m,
        z: a.dir.z * cfg.throwImpulse * throwImpulseMul * m,
      });
    }
    if (cfg.ccdOnThrow && typeof body.enableCcd === 'function') body.enableCcd(true);
    const p = body.translation();
    const thrownDuck = heldDuckId;
    release();
    throws++;
    announce(throwListeners, { duck: thrownDuck, x: p.x, y: p.y, z: p.z });
    return true;
  }

  // Runs before world.step(): the spring impulse must land in the same substep
  // the solver is about to integrate.
  function fixedUpdate(dt) {
    if (!held) return;
    const a = aim();
    if (!a) return;
    computeTarget(a);

    const p = held.translation();
    const v = held.linvel();
    const m = held.mass() || cfg.fallbackMass;

    const ex = target.x - p.x;
    const ey = target.y - p.y;
    const ez = target.z - p.z;

    const ix = (kp * ex - kd * v.x) * m * dt;
    const iy = (kp * ey - kd * v.y) * m * dt;
    const iz = (kp * ez - kd * v.z) * m * dt;

    wake();
    applyImpulse(held, { x: ix, y: iy, z: iz });

    // Impulse is deferred to the step, so clamp the velocity it will produce.
    let nx = v.x + ix / m, ny = v.y + iy / m, nz = v.z + iz / m;
    const s = len3(nx, ny, nz);
    if (s > cfg.maxSpeed) {
      const k = cfg.maxSpeed / s;
      held.setLinvel({ x: nx * k, y: ny * k, z: nz * k }, true);
    }
  }

  // Runs after world.step(): the break test uses the post-solve position.
  function postStep() {
    if (!held) return;
    // A held duck can be taken out from under the hold: a crate swallows it and
    // the pool parks the body a kilometre under the plate. The break test would
    // eventually notice (the target is now 1000 m away) but it would report a
    // 1000 m "break", and on the way there one substep of spring would fire at a
    // parked body. Asking the pool whether the duck is still in the world is the
    // honest test, and it is the one that runs first.
    if (heldDuckId !== null && ducks && typeof ducks.isActive === 'function'
        && !ducks.isActive(heldDuckId)) {
      stolenReleases++;
      release();
      return;
    }
    const p = held.translation();
    const d = len3(target.x - p.x, target.y - p.y, target.z - p.z);
    if (d > cfg.breakDistance) {
      lastBreakDistance = d;
      breaks++;
      release();
    }
  }

  function setDistance(d) {
    const v = Number(d);
    if (!isFinite(v)) return distance;
    distance = Math.max(cfg.distanceMin, Math.min(cfg.distanceMax, v));
    return distance;
  }

  return {

    setGrabRangeAdd(v) { grabRangeAdd = (typeof v === 'number' && isFinite(v)) ? v : 0; return grabRangeAdd; },

    setThrowImpulseMul(v) { throwImpulseMul = (typeof v === 'number' && isFinite(v) && v > 0) ? v : 1; return throwImpulseMul; },

    grabRange: () => cfg.grabRange + grabRangeAdd,
    tryGrab,
    release,
    throw: doThrow,
    // The two moments the player hears their own hands. Announced rather than
    // polled, because a grab and a release inside the same frame are two events
    // and a counter comparison would see one.
    onGrab(cb) { if (typeof cb === 'function') grabListeners.push(cb); },
    onThrow(cb) { if (typeof cb === 'function') throwListeners.push(cb); },
    setDistance,
    distance: () => distance,
    scrollDistance: (delta) => setDistance(distance + delta * cfg.distanceStep),
    heldId: () => (held ? (heldDuckId !== null ? heldDuckId : held.handle) : null),
    heldHandle: () => (held ? held.handle : null),
    heldDuck: () => heldDuckId,
    isHolding: () => held !== null,
    target: () => ({ x: target.x, y: target.y, z: target.z }),
    kp,
    kd,
    lastBreakDistance: () => lastBreakDistance,
    breakCount: () => breaks,
    grabCount: () => grabs,
    throwCount: () => throws,
    // Why the last grab did not happen. The host turns this straight into the
    // refusal the asking client sees, so "somebody else has it" reaches the
    // loser of a race as a sentence rather than as a click that did nothing.
    lastRefusal: () => lastRefusal,
    refusedCount: () => refused,
    stolenCount: () => stolenReleases,
    owner: me,
    _fixedUpdate: fixedUpdate,
    _postStep: postStep,
  };
}

export default createHold;
