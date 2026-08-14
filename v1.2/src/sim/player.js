// First-person capsule driven by Rapier's KinematicCharacterController.
// Input is latched by update(); integration happens on the world's fixed substeps.

import { GROUP_WORLD, GROUP_PROP, GROUP_PLAYER, interactionGroups } from './world.js';

const ZERO_INPUT = { fwd: 0, right: 0, jump: false, sprint: false, yaw: 0, pitch: 0 };

// What a capsule is fed for a substep no input covers. Deliberately carries NO
// yaw and NO pitch: update() only takes those when they are numbers, so a
// capsule that runs out of input stops walking while still facing where its
// owner last looked, rather than snapping to yaw 0.
const NO_INPUT = { fwd: 0, right: 0, jump: false, sprint: false };

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function createPlayer({ RAPIER, world, controller, params, spawn }) {
  const P = params;
  const halfHeight = Math.max(0.05, P.height / 2 - P.radius); // cylinder half-height

  const s = spawn || { x: 0, y: P.height / 2 + 0.1, z: 0 };
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(s.x, s.y, s.z)
  );
  // The capsule is infinite mass: it must never be able to shove props.
  // Membership PLAYER, filter WORLD only — props are simply not in its filter.
  const collider = world.createCollider(
    RAPIER.ColliderDesc.capsule(halfHeight, P.radius)
      .setCollisionGroups(interactionGroups(GROUP_PLAYER, GROUP_WORLD)),
    body
  );

  const vel = { x: 0, y: 0, z: 0 };
  let input = ZERO_INPUT;
  let jumpLatched = false;
  let jumpHeldPrev = false;
  let grounded = false;      // substep-local ground state
  let groundedFrame = false; // OR of every substep in the current step() call
  let yaw = 0;
  let pitch = 0;

  // Query groups are independent of collider membership: this cast may hit
  // world and props even though the capsule only collides with the world.
  const QUERY_GROUPS = interactionGroups(GROUP_PLAYER, GROUP_WORLD | GROUP_PROP);

  function rayGrounded() {
    const t = body.translation();
    const originY = t.y - halfHeight - P.radius + 0.05;
    const ray = new RAPIER.Ray({ x: t.x, y: originY, z: t.z }, { x: 0, y: -1, z: 0 });
    const hit = world.castRay(ray, 0.15, true, undefined, QUERY_GROUPS, collider, body);
    return hit !== null && hit !== undefined;
  }

  function update(dt, inp) {
    input = inp || ZERO_INPUT;
    if (typeof input.yaw === 'number') yaw = input.yaw;
    if (typeof input.pitch === 'number') pitch = clamp(input.pitch, -Math.PI / 2, Math.PI / 2);
    const jumpNow = !!input.jump;
    if (jumpNow && !jumpHeldPrev) jumpLatched = true; // edge-triggered, consumed by a substep
    jumpHeldPrev = jumpNow;
  }

  // A capsule the local player does not own -- a remote player's, on the host --
  // is not driven by a device, it is driven by input frames that arrive over a
  // lossy link at their own rate. Such a capsule gets a SOURCE: a function asked,
  // once per substep, which input covers THIS substep, and answering null when
  // none does. That is what makes the host integrate a remote player by the time
  // their input actually accounts for instead of by however long the host has
  // been running.
  //
  // The local player passes no source, so the branch below never runs for it and
  // single player steps through exactly the code it always did.
  let inputSource = null;

  function setInputSource(fn) {
    inputSource = typeof fn === 'function' ? fn : null;
    return !!inputSource;
  }

  function _fixedUpdate(dt) {
    // Latched per SUBSTEP, not per packet: the source hands back the input that
    // covers this 1/60 s, so a queue of them replays at the rate they were made.
    if (inputSource) update(dt, inputSource(dt) || NO_INPUT);
    const fwd = clamp(input.fwd || 0, -1, 1);
    const right = clamp(input.right || 0, -1, 1);
    const speed = input.sprint ? P.sprintSpeed : P.walkSpeed;

    // Yaw 0 looks down -Z; right is +X.
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    let dx = right * cos - fwd * sin;
    let dz = -right * sin - fwd * cos;
    const len = Math.hypot(dx, dz);
    if (len > 1e-6) {
      const s2 = Math.min(1, len) / len;
      dx *= s2;
      dz *= s2;
    }
    vel.x = dx * speed;
    vel.z = dz * speed;

    if (grounded && jumpLatched) {
      vel.y = P.jumpSpeed;
      jumpLatched = false;
      grounded = false;
    } else if (grounded && vel.y <= 0) {
      vel.y = -2.0; // small downward bias keeps the controller snapped to the floor
    } else {
      vel.y += P.gravity * dt;
      if (vel.y < -60) vel.y = -60;
    }

    const desired = { x: vel.x * dt, y: vel.y * dt, z: vel.z * dt };
    controller.computeColliderMovement(collider, desired, undefined, QUERY_GROUPS);
    const mv = controller.computedMovement();

    const t = body.translation();
    body.setNextKinematicTranslation({ x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z });

    let g = false;
    if (typeof controller.computedGrounded === 'function') g = g || controller.computedGrounded();
    g = g || rayGrounded();
    grounded = g;
    // OR-accumulate across substeps: a plain assignment would let substep 3 erase
    // a ground contact substep 1 found, silently killing jumps with no error.
    groundedFrame = groundedFrame || g;

    if (grounded && vel.y < 0) vel.y = 0;
    // Vertical blocked while rising (ceiling hit) — stop climbing.
    if (vel.y > 0 && mv.y < desired.y * 0.5) vel.y = 0;
  }

  function _beginFrame() {
    groundedFrame = false;
  }

  function _postStep() {
    // Kinematic pose is committed by world.step(); nothing else to reconcile.
  }

  function position() {
    const t = body.translation();
    return { x: t.x, y: t.y, z: t.z };
  }

  return {
    update,
    setInputSource,
    position,
    velocity: () => ({ x: vel.x, y: vel.y, z: vel.z }),
    grounded: () => groundedFrame || grounded,
    eyePosition: () => {
      const t = body.translation();
      return { x: t.x, y: t.y - P.height / 2 + P.eyeHeight, z: t.z };
    },
    look: () => ({ yaw, pitch }),
    handle: body.handle,
    _fixedUpdate,
    _postStep,
    _beginFrame,
  };
}
