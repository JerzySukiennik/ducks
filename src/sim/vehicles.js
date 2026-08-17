// The tipper truck: a chassis you drive, a bed that tips, a tailgate that drops.
//
// No three.js. Rapier is imported here for the same reason world.js imports it
// -- this module OWNS three rigid bodies and a hinge, and handing them in from
// outside would only mean the caller had to know the same numbers.
//
// THE THREE BODIES, AND WHY THEY ARE NOT ONE.
//
//   chassis  DYNAMIC, with rotation locked to the Y axis. It is the thing that
//            drives, collides with the world and carries the other two. Locking
//            roll and pitch is what makes it a vehicle rather than a box that
//            somersaults the first time it clips a conveyor: a truck that can
//            land on its roof in a game with no respawn button is a truck the
//            player loses.
//   bed      KINEMATIC, posed every substep from the chassis pose and one
//            angle. It is a real open box with a floor and three walls, so the
//            ducks in it are ORDINARY LOOSE DUCKS resting on a moving floor --
//            not a container's virtual count. Tip it and they slide out because
//            they slide out, not because a rule fired.
//   gate     KINEMATIC, posed from the BED (not the chassis), so it tips with
//            the load it is holding back, the way a real tailgate does.
//
// Kinematic rather than jointed on purpose. A motorised revolute joint would be
// the textbook answer, and it would also put a powered constraint between a
// body whose velocity this file SETS directly each substep and a body with
// twenty-five ducks bouncing in it. A kinematic pose cannot fight the solver:
// it is simply where the bed is this substep, and Rapier's contact handling
// pushes the ducks out of the way exactly as it does for the player's capsule.
//
// THE ONE MEASUREMENT THE PLAYER FEELS: the tailgate's top edge sits at 0.62
// off the plate and a conveyor's belt runs at 0.65. Back a truck up to the end
// of a belt and the ducks come off the belt, clear the gate by three
// centimetres and drop into the bed. Every other number here is arranged around
// that one; see tools/blender-models.py, the CAR_ block.

import RAPIER from '@dimforge/rapier3d-compat';
import { GROUP_WORLD, GROUP_PROP, GROUP_PLAYER, interactionGroups } from './world.js';

const HALF_PI = Math.PI / 2;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Quaternion for a rotation of `a` about Y, then `b` about the resulting X.
// Written out rather than pulled from a maths library because src/sim may not
// import three.js, and these are the only two rotations this file ever needs.
function quatYX(a, b) {
  const cy = Math.cos(a / 2);
  const sy = Math.sin(a / 2);
  const cx = Math.cos(b / 2);
  const sx = Math.sin(b / 2);
  // q = qy * qx
  return {
    x: cy * sx,
    y: sy * cx,
    z: -sy * sx,
    w: cy * cx,
  };
}

// Rotate a local offset by yaw about Y, then add it to a world point.
function localToWorld(origin, yaw, off) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return {
    x: origin.x + off.x * c + off.z * s,
    y: origin.y + off.y,
    z: origin.z - off.x * s + off.z * c,
  };
}

export function createVehicles({ world, config, spec }) {
  const V = config.vehicle;
  const S = spec;
  const list = [];
  const byKey = new Map();
  let nextKey = 1;

  // Membership PROP so a truck collides with the world, with props and with
  // players exactly as a dropped crate does -- and so every existing query that
  // already asks about props (the crosshair, the tools, the airflow) sees it
  // without being taught a new group.
  const carGroups = interactionGroups(
    GROUP_PROP, GROUP_WORLD | GROUP_PROP | GROUP_PLAYER
  );

  // The same part, moved by a mount point. Used to hang the bed's own colliders
  // off the CHASSIS at the bed's hinge, so one part list serves both bodies and
  // the two copies cannot drift apart.
  function offsetPart(p, mount) {
    const c = p.center;
    const moved = { center: [c[0] + mount[0], c[1] + mount[1], c[2] + mount[2]] };
    if (p.shape === 'ball') { moved.shape = 'ball'; moved.radius = p.radius; } else moved.half = p.half;
    return moved;
  }

  function addPart(body, p, density) {
    const desc = p.shape === 'ball'
      ? RAPIER.ColliderDesc.ball(p.radius)
      : RAPIER.ColliderDesc.cuboid(p.half[0], p.half[1], p.half[2]);
    return world._raw.createCollider(
      desc
        .setTranslation(p.center[0], p.center[1], p.center[2])
        .setDensity(density)
        .setFriction(V.friction)
        .setRestitution(V.restitution)
        .setCollisionGroups(carGroups),
      body
    );
  }

  function addParts(body, parts, density) {
    const out = [];
    for (const p of parts) {
      // A part is a box unless it says otherwise. The four wheels say otherwise:
      // a ball has no vertical face at ground level, so it rolls over a kerb
      // instead of stopping dead against it. See src/data/vehicles.js.
      const desc = p.shape === 'ball'
        ? RAPIER.ColliderDesc.ball(p.radius)
        : RAPIER.ColliderDesc.cuboid(p.half[0], p.half[1], p.half[2]);
      out.push(world._raw.createCollider(
        desc
          .setTranslation(p.center[0], p.center[1], p.center[2])
          .setDensity(density)
          .setFriction(V.friction)
          .setRestitution(V.restitution)
          .setCollisionGroups(carGroups),
        body
      ));
    }
    return out;
  }

  // --- one truck -------------------------------------------------------------

  function spawn(pos, yaw) {
    const y = typeof yaw === 'number' && isFinite(yaw) ? yaw : 0;
    const p = {
      x: Number(pos.x) || 0,
      y: Number(pos.y) || 0,
      z: Number(pos.z) || 0,
    };
    const q = quatYX(y, 0);

    const chassis = world._raw.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y, p.z)
        .setRotation(q)
        // Roll and pitch locked; yaw free, because steering IS yaw. The method
        // is `enabledRotations` on the DESCRIPTOR (the body's own setter is
        // `setEnabledRotations`), and getting that wrong is a boot-time throw
        // rather than a truck that quietly somersaults.
        .enabledRotations(false, true, false)
        .setLinearDamping(V.linearDamping)
        .setAngularDamping(V.angularDamping)
        // A parked truck must not fall asleep: the player walks up to it and
        // presses a key, and a sleeping body would take the first frame of
        // input to wake instead of to move.
        .setCanSleep(false)
    );
    addParts(chassis, S.chassis.parts, V.density);
    // A SECOND COPY OF THE BED, BOLTED TO THE CHASSIS ITSELF, and it is the
    // only reason a loaded truck can take a corner.
    //
    // The bed is a kinematic body: every substep it is TELEPORTED to where the
    // chassis is. Rapier reads a teleport as velocity, and the faster and more
    // sideways the truck moves, the worse that reading gets. Measured with the
    // load on a kinematic bed through a hard turn: a duck went from 1.0 m/s to
    // 41.7 m/s inside a single 0.1 s window and left the plate. Predicting the
    // chassis a substep forward helped and did not fix it; predicting the yaw
    // as well made it worse.
    //
    // So while the bed is DOWN -- which is all of the time the truck is moving
    // -- the load does not rest on the kinematic body at all. It rests on these
    // colliders, which belong to the chassis and therefore move exactly as the
    // truck moves, because they ARE the truck. The kinematic copy is switched on
    // only while the bed is tipping, when the truck is standing still and a
    // teleport reads as what it is: a bed going up.
    const bedOnChassis = [];
    for (const p of S.bed.parts) {
      bedOnChassis.push(addPart(chassis, offsetPart(p, S.bed.hinge), V.density));
    }
    for (const p of S.gate.parts) {
      bedOnChassis.push(addPart(chassis, offsetPart(p, [
        S.bed.hinge[0] + S.gate.hingeInBed[0],
        S.bed.hinge[1] + S.gate.hingeInBed[1],
        S.bed.hinge[2] + S.gate.hingeInBed[2],
      ]), V.density));
    }

    // BORN WHERE THEY BELONG, not at the chassis origin and posed a step later.
    // setNextKinematicTranslation is a promise about the NEXT step, so a bed
    // created at the chassis origin spends one step with its floor 38 cm inside
    // the chassis it is bolted to -- and the solver's answer to two overlapping
    // bodies is to throw them apart. That was the truck that flew away.
    const bedPos = localToWorld(p, y, {
      x: S.bed.hinge[0], y: S.bed.hinge[1], z: S.bed.hinge[2],
    });
    const bed = world._raw.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(bedPos.x, bedPos.y, bedPos.z)
        .setRotation(q)
    );
    const bedColliders = addParts(bed, S.bed.parts, V.density);

    const gatePos = localToWorld(bedPos, y, {
      x: S.gate.hingeInBed[0], y: S.gate.hingeInBed[1], z: S.gate.hingeInBed[2],
    });
    const gate = world._raw.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(gatePos.x, gatePos.y, gatePos.z)
        .setRotation(q)
    );
    const gateColliders = addParts(gate, S.gate.parts, V.density);

    const rec = {
      key: nextKey++,
      chassis,
      bed,
      gate,
      // 0 = down, 1 = fully tipped. Same for the gate: 0 shut, 1 wide open.
      tip: 0,
      gateOpen: 0,
      // What the driver is asking for this frame, in the same units.
      tipWant: 0,
      gateWant: 0,
      driver: null,          // player slot, or null
      throttle: 0,
      steer: 0,
      handbrake: false,
      // Where the truck was last substep, so anything standing on it can be
      // carried by the DIFFERENCE rather than by guessing at its velocity.
      bedOnChassis,
      bedKinematic: bedColliders.concat(gateColliders),
      // NOT `false`: setBedMode short-circuits when the mode already matches, so
      // a record born `false` would never actually switch the kinematic copy
      // off, and the truck would drive around double-walled -- a duck caught
      // between the two copies is a duck squeezed by a solver.
      tipped: null,
      prev: { x: p.x, y: p.y, z: p.z, yaw: y },
      delta: { x: 0, y: 0, z: 0, yaw: 0 },
      yaw: y,
    };
    setBedMode(rec, false);
    poseParts(rec, 0);
    list.push(rec);
    byKey.set(rec.key, rec);
    return rec;
  }

  // Which copy of the bed is solid right now. Exactly one of the two is ever
  // enabled, so nothing is ever double-walled and a duck can never be caught
  // between a bed and its own shadow.
  //
  //   down (tipped === false)  the chassis's copy. The load rides on the truck
  //                            itself and a corner cannot throw it, because
  //                            nothing is being teleported.
  //   up   (tipped === true)   the kinematic bodies. They are the ones that can
  //                            actually rotate, and a truck tipping its load out
  //                            is a truck that is standing still.
  function setBedMode(rec, tipped) {
    if (rec.tipped === tipped) return false;
    rec.tipped = tipped;
    for (const c of rec.bedOnChassis) c.setEnabled(!tipped);
    for (const c of rec.bedKinematic) c.setEnabled(tipped);
    return true;
  }

  function remove(key) {
    const rec = byKey.get(key);
    if (!rec) return false;
    const i = list.indexOf(rec);
    if (i >= 0) list.splice(i, 1);
    byKey.delete(key);
    for (const b of [rec.gate, rec.bed, rec.chassis]) {
      try { world._raw.removeRigidBody(b); } catch (e) { /* already gone */ }
    }
    return true;
  }

  // --- where the bed and the gate are ----------------------------------------
  //
  // Both are derived, every substep, from the chassis pose and one angle each.
  // Nothing stores their poses: a stored pose is a second source of truth and
  // would drift the first time the chassis was moved by something other than
  // this file (a shove, a snapshot restore, a duck landing on the bonnet).

  // `dt` is not optional decoration. setNextKinematicTranslation states where a
  // body will be at the END of the step, so posing the bed at the chassis's
  // CURRENT pose puts it one substep behind the chassis, every substep, forever.
  // A truck driving straight barely shows it; a truck TURNING does, because the
  // bed then has to snap round to catch up each substep and Rapier reads that
  // snap as velocity -- the bed's far corner covering its lag in a single
  // 1/60 s is metres per second of implied speed, applied to whatever is
  // resting on it. That is why the load came out of the back on every corner
  // and went a very long way. Predicting the chassis one substep forward, from
  // the velocities the solver is about to integrate, removes the lag entirely.
  function poseParts(rec, dt) {
    const t = rec.chassis.translation();
    let yaw = rec.yaw;
    if (dt > 0) {
      const v = rec.chassis.linvel();
      const w = rec.chassis.angvel();
      t.x += v.x * dt;
      t.y += v.y * dt;
      t.z += v.z * dt;
      // TRANSLATION IS PREDICTED, ROTATION IS NOT, and the asymmetry is
      // measured rather than tidy. The solver honours a set linear velocity
      // almost exactly, so predicting where the chassis will be is reliable.
      // It does NOT honour a set angular velocity the same way -- ground
      // contact fights the yaw -- so predicting the ANGLE overshoots, the bed
      // snaps back the next substep, and Rapier reads that snap as speed and
      // throws the load out. Measured with yaw predicted: nine ducks aboard, a
      // hard turn, nine ducks 17 to 23 metres away.
      yaw += w.y * dt * V.yawPredictFrac;
    }
    const tipA = rec.tip * V.tipMaxDegrees * (Math.PI / 180);
    const gateA = rec.gateOpen * V.gateMaxDegrees * (Math.PI / 180);

    const bedPos = localToWorld(t, yaw, {
      x: S.bed.hinge[0], y: S.bed.hinge[1], z: S.bed.hinge[2],
    });
    rec.bed.setNextKinematicTranslation(bedPos);
    rec.bed.setNextKinematicRotation(quatYX(yaw, tipA));

    // The gate hangs off the BED, so its hinge point has to be carried through
    // the bed's own tilt -- otherwise a raised bed would leave its tailgate
    // behind in mid-air at the height it was shut at.
    const gh = S.gate.hingeInBed;
    const ca = Math.cos(tipA);
    const sa = Math.sin(tipA);
    const tilted = { x: gh[0], y: gh[1] * ca - gh[2] * sa, z: gh[1] * sa + gh[2] * ca };
    const gatePos = localToWorld(bedPos, yaw, tilted);
    rec.gate.setNextKinematicTranslation(gatePos);
    rec.gate.setNextKinematicRotation(quatYX(yaw, tipA + gateA));
  }

  // --- driving ---------------------------------------------------------------
  //
  // Velocity is SET, not pushed. A duck is shoved around by impulses because a
  // duck is a thing being acted on; a truck is a thing with a driver, and a
  // driver expects the same key to give the same speed on a slope as on the
  // flat. Gravity is left alone -- only the horizontal plane is written -- so
  // the truck still falls, still lands, and still cannot climb a wall.

  function driveFixed(rec, dt) {
    const c = rec.chassis;
    const rot = c.rotation();
    // Yaw straight off the body, so a truck shoved round by a collision steers
    // from where it ACTUALLY points rather than from where this file last
    // decided it pointed.
    rec.yaw = Math.atan2(2 * (rot.w * rot.y + rot.x * rot.z),
      1 - 2 * (rot.y * rot.y + rot.z * rot.z));

    const v = c.linvel();
    const fx = -Math.sin(rec.yaw);
    const fz = -Math.cos(rec.yaw);
    // Speed along the truck's own nose. Signed: reverse is negative, and that
    // is what makes the steering reverse with it below.
    const along = v.x * fx + v.z * fz;

    const throttle = clamp(rec.throttle, -1, 1);
    const top = throttle >= 0 ? V.topSpeed : V.reverseSpeed;
    const want = throttle * top;
    // Braking is a REVERSAL or a release, not a start. `(want > 0) !== (along >
    // 0)` alone called pulling away from a standstill a brake, because a
    // stationary truck is not moving forwards either -- so every start used the
    // brake curve. Standing still counts as agreeing with whatever you ask for.
    const rolling = Math.abs(along) > 0.05;
    const accel = rec.handbrake || Math.abs(want) < 0.01
      || (rolling && (want > 0) !== (along > 0))
      ? V.brakeAccel
      : V.accel;
    let next = along;
    const target = rec.handbrake ? 0 : want;
    const d = target - along;
    const step = accel * dt;
    next = Math.abs(d) <= step ? target : along + Math.sign(d) * step;

    // Sideways velocity is killed rather than kept: with no wheels there is no
    // lateral friction to do it, and a truck that keeps its sideways momentum
    // through a turn does not drive, it curls.
    const rx = Math.cos(rec.yaw);
    const rz = -Math.sin(rec.yaw);
    const side = (v.x * rx + v.z * rz) * V.gripLoss;
    c.setLinvel({
      x: fx * next + rx * side,
      y: v.y,
      z: fz * next + rz * side,
    }, true);

    // STEERING SCALES WITH SPEED, and reverses in reverse. A truck that spins
    // on the spot at a standstill is a turret; one that turns fastest at speed
    // is undrivable. The curve is linear up to steerFullSpeed and flat after.
    // What the drive actually decided this substep, kept for info(): a truck
    // that will not move is a question about these three numbers and nothing
    // else, and reading them back beats guessing at the solver.
    rec.debug = { along, want, next, accel };

    const rate = clamp(Math.abs(next) / V.steerFullSpeed, 0, 1);
    const dir = next < 0 ? -1 : 1;
    c.setAngvel({ x: 0, y: -clamp(rec.steer, -1, 1) * V.steerRate * rate * dir, z: 0 }, true);
  }

  // How far the truck moved LAST substep. The chassis is dynamic, so its
  // translation only changes inside world.step(); measuring the difference at
  // the top of a substep is therefore measuring the move the solver just made,
  // and a rider carried by it is one substep -- 16 ms -- behind the floor they
  // are standing on. That lag is what every moving platform in every engine
  // has, and it is invisible at 7 m/s.
  function beginStep(rec) {
    const t = rec.chassis.translation();
    const rot = rec.chassis.rotation();
    const yawNow = Math.atan2(2 * (rot.w * rot.y + rot.x * rot.z),
      1 - 2 * (rot.y * rot.y + rot.z * rot.z));
    let dyaw = yawNow - rec.prev.yaw;
    // Shortest way round: a truck crossing the +-pi seam would otherwise whip
    // its passengers a full turn about its own axle.
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    rec.delta = { x: t.x - rec.prev.x, y: t.y - rec.prev.y, z: t.z - rec.prev.z, yaw: dyaw };
    rec.prev.x = t.x;
    rec.prev.y = t.y;
    rec.prev.z = t.z;
    rec.prev.yaw = yawNow;
    rec.yaw = yawNow;
    return rec.delta;
  }

  function carryDelta(rec) {
    return rec.delta || { x: 0, y: 0, z: 0, yaw: 0 };
  }

  // The bed's floor, in world space: where a passenger has to be standing to be
  // carried, and where the driver's seat is measured from.
  function bedTop(rec) {
    const t = rec.chassis.translation();
    return localToWorld(t, rec.yaw, {
      x: 0, y: S.bed.floorY, z: (S.bed.zRange[0] + S.bed.zRange[1]) / 2,
    });
  }

  // Is this world point standing on the bed? Tested in the TRUCK's frame, so it
  // is still right when the truck is parked at an angle -- an axis-aligned test
  // would drop a passenger the moment the driver turned.
  function onBed(rec, p) {
    const t = rec.chassis.translation();
    const dx = p.x - t.x;
    const dz = p.z - t.z;
    const c = Math.cos(rec.yaw);
    const s = Math.sin(rec.yaw);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    if (Math.abs(lx) > S.bed.halfX + V.rideMarginXZ) return false;
    if (lz < S.bed.zRange[0] - V.rideMarginXZ || lz > S.bed.zRange[1] + V.rideMarginXZ) return false;
    const dy = p.y - (t.y + S.bed.floorY);
    return dy > -V.rideMarginDown && dy < V.rideMarginUp;
  }

  function seatOf(rec) {
    const t = rec.chassis.translation();
    return localToWorld(t, rec.yaw, { x: S.seat[0], y: S.seat[1], z: S.seat[2] });
  }

  // Where a player is put down when they get out. Beside the cab, on the side
  // with room -- never inside the truck, which would leave the capsule
  // interpenetrating its own vehicle and let the solver fire it into the sky.
  function exitOf(rec) {
    const t = rec.chassis.translation();
    return localToWorld(t, rec.yaw, { x: S.exit[0], y: S.exit[1], z: S.exit[2] });
  }

  function fixedUpdate(dt) {
    for (let i = 0; i < list.length; i++) {
      const rec = list[i];
      beginStep(rec);
      driveFixed(rec, dt);
      // The two hinges move at a rate, not instantly: a bed that snapped to
      // 45 degrees would teleport its load through its own floor.
      const tr = V.tipRate * dt;
      rec.tip = rec.tipWant > rec.tip
        ? Math.min(rec.tipWant, rec.tip + tr)
        : Math.max(rec.tipWant, rec.tip - tr);
      const gr = V.gateRate * dt;
      rec.gateOpen = rec.gateWant > rec.gateOpen
        ? Math.min(rec.gateWant, rec.gateOpen + gr)
        : Math.max(rec.gateWant, rec.gateOpen - gr);
      // The moment either hinge leaves its resting position, the moving copy of
      // the bed takes over; the moment both are back home, the chassis's copy
      // does. `> 0` and not a threshold: a bed one degree up is a bed that has
      // to be able to move, and the switch is one frame either way.
      setBedMode(rec, rec.tip > 0 || rec.gateOpen > 0);
      poseParts(rec, dt);
    }
  }

  return {
    spawn,
    remove,
    list,
    byKey: (k) => byKey.get(k) || null,
    count: () => list.length,
    fixedUpdate,
    carryDelta,
    onBed,
    seatOf,
    exitOf,
    bedTop,

    // --- what the driver asks for ---------------------------------------------
    // Set once a frame from input, consumed by the substeps. Nothing here acts
    // immediately: a control is a REQUEST, and the fixed update is the only
    // place a truck ever moves.
    control(key, { throttle, steer, handbrake }) {
      const rec = byKey.get(key);
      if (!rec) return false;
      rec.throttle = clamp(Number(throttle) || 0, -1, 1);
      rec.steer = clamp(Number(steer) || 0, -1, 1);
      rec.handbrake = !!handbrake;
      return true;
    },
    // 0..1 each. The keys nudge these; the fixed update walks the real angle
    // towards them at tipRate / gateRate.
    setTip(key, v) {
      const rec = byKey.get(key);
      if (!rec) return null;
      rec.tipWant = clamp(Number(v) || 0, 0, 1);
      return rec.tipWant;
    },
    setGate(key, v) {
      const rec = byKey.get(key);
      if (!rec) return null;
      rec.gateWant = clamp(Number(v) || 0, 0, 1);
      return rec.gateWant;
    },
    setDriver(key, slot) {
      const rec = byKey.get(key);
      if (!rec) return false;
      rec.driver = slot;
      if (slot === null) {
        rec.throttle = 0;
        rec.steer = 0;
        rec.handbrake = true;
      }
      return true;
    },
    driverOf: (key) => {
      const rec = byKey.get(key);
      return rec ? rec.driver : null;
    },
    // The nearest truck a player at `p` could get into, and how far away it is.
    nearest(p, range) {
      let best = null;
      let bestD = range === undefined ? V.enterRange : range;
      for (const rec of list) {
        const t = rec.chassis.translation();
        const d = Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z);
        if (d < bestD) { bestD = d; best = rec; }
      }
      return best ? { key: best.key, distance: bestD, vehicle: best } : null;
    },
    info(key) {
      const rec = key === undefined ? list[0] : byKey.get(key);
      if (!rec) return null;
      const t = rec.chassis.translation();
      const v = rec.chassis.linvel();
      return {
        key: rec.key,
        x: Math.round(t.x * 1e4) / 1e4,
        y: Math.round(t.y * 1e4) / 1e4,
        z: Math.round(t.z * 1e4) / 1e4,
        yawDegrees: Math.round(rec.yaw * (180 / Math.PI) * 100) / 100,
        speed: Math.round(Math.hypot(v.x, v.z) * 1e3) / 1e3,
        tip: Math.round(rec.tip * 1e3) / 1e3,
        tipDegrees: Math.round(rec.tip * V.tipMaxDegrees * 100) / 100,
        gate: Math.round(rec.gateOpen * 1e3) / 1e3,
        gateDegrees: Math.round(rec.gateOpen * V.gateMaxDegrees * 100) / 100,
        driver: rec.driver,
        throttle: rec.throttle,
        steer: rec.steer,
        drive: rec.debug || null,
      };
    },
    infoAll: () => list.map((r) => r.key),
  };
}

export default createVehicles;
