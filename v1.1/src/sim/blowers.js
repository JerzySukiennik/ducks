// Wind for the `blower` kind (the Fan).
//
// A cone of moving air along the machine's local +Z. Everything about the cone
// is DATA on the row -- blow.force, blow.range, blow.cone -- and the row also
// says `collider.blockDucks: false`, which is why a duck sails straight through
// the blades while the player still walks into the housing. Nothing in this file
// knows that the row is called "fan"; a second blower row would work with no
// edit here.
//
// The force is a drag towards the airstream, not a constant shove: it falls off
// with distance, fades at the edge of the cone, and drops to zero once the duck
// is already moving with the air. That is what stops a fan being an infinite
// accelerator, and it is what makes a chain of fans a corridor rather than a
// catapult.
//
// The spatial hash and the config reader come from conveyors.js: both movement
// systems need exactly the same two primitives and duplicating them would give
// the project two subtly different broad phases.

import { readNum, createDuckHash } from './conveyors.js';

const DEG = Math.PI / 180;

export function createBlowers({ config, ducks, applyImpulse, list, byId }) {
  if (!ducks) throw new Error('[blowers] a duck pool is required');
  if (typeof list !== 'function') throw new Error('[blowers] list() is required');
  if (typeof byId !== 'function') throw new Error('[blowers] byId() is required');
  const cellSize = readNum(config, 'automation.cellSize');
  const F = {
    airSpeed: readNum(config, 'automation.fan.airSpeed'),
    falloffExponent: readNum(config, 'automation.fan.falloffExponent'),
    minDistance: readNum(config, 'automation.fan.minDistance'),
    lift: readNum(config, 'automation.fan.lift'),
    edgeSoftness: readNum(config, 'automation.fan.edgeSoftness'),
  };
  const hash = createDuckHash(cellSize, ducks.max);

  const fans = [];

  let flags = { blowing: false };
  let accFlags = { blowing: false };
  let counts = { pushed: 0, impulses: 0 };
  let accCounts = { pushed: 0, impulses: 0 };
  let totalImpulses = 0;

  function accepts(row) {
    return !!row && row.kind === 'blower' && !!row.blow;
  }

  function describe(rec, row) {
    const yaw = rec.yaw;
    // Machine forward is local +Z, the same convention the workbench and the
    // booth already use.
    //
    // `blow.pitchDegrees` tilts that forward off the horizontal, positive up,
    // and it is taken RELATIVE TO THE PLACED POSE exactly as
    // collider.surface.pitchDegrees is for a ramp: the yawed horizontal heading
    // first, then the tilt about it. A world-space tilt would make the same fan
    // blow in a different direction depending on which way it was turned, which
    // is the whole reason ramps do it this way.
    const pitch = (typeof row.blow.pitchDegrees === 'number' ? row.blow.pitchDegrees : 0) * DEG;
    const cp = Math.cos(pitch);
    const fx = -Math.sin(yaw) * cp;
    const fy = Math.sin(pitch);
    const fz = Math.cos(yaw) * cp;
    const range = row.blow.range;
    const cone = row.blow.cone * DEG;
    // The blast leaves an APERTURE, not a point. Its radius is the fan's own
    // half-extent -- data off the same row, never a tuned literal -- and the
    // cone half-angle widens it downstream. Treating the source as a point puts
    // a dead zone directly in front of every floor-standing fan, exactly where a
    // duck coming off the machine lands: at 0.4 m ahead a duck on the floor is
    // 62 degrees below a 0.82 m hub, i.e. outside a 35 degree point-cone.
    const aperture = Math.min(rec.hx, rec.hy);
    const spread = Math.tan(cone);
    const lateral = aperture + range * spread;
    return {
      key: rec.key,
      id: rec.id,
      // The hub, not the floor: a fan blows from where its blades are.
      x: rec.x, y: rec.y, z: rec.z, yaw,
      fx, fy, fz,
      pitch,
      force: row.blow.force,
      range,
      cone,
      aperture,
      spread,
      blockDucks: !!(row.collider && row.collider.blockDucks),
      minX: rec.x - range - lateral, maxX: rec.x + range + lateral,
      minZ: rec.z - range - lateral, maxZ: rec.z + range + lateral,
    };
  }

  // A projection of the placer's live list, exactly as conveyors.js does it:
  // placing or demolishing a fan turns it on and off with no registration step.
  const byKey = new Map();
  function sync() {
    const objs = list() || [];
    let changed = false;
    let n = 0;
    for (let i = 0; i < objs.length; i++) {
      const rec = objs[i];
      const row = byId(rec.id);
      if (!accepts(row)) continue;
      n++;
      if (!byKey.has(rec.key)) {
        byKey.set(rec.key, describe(rec, row));
        changed = true;
      }
    }
    if (n !== byKey.size) {
      const live = new Set();
      for (let i = 0; i < objs.length; i++) live.add(objs[i].key);
      for (const key of Array.from(byKey.keys())) {
        if (!live.has(key)) { byKey.delete(key); changed = true; }
      }
    }
    if (changed || fans.length !== byKey.size) {
      fans.length = 0;
      byKey.forEach((f) => fans.push(f));
    }
    return fans.length;
  }

  // Strength of the wind at a point, 0..1, before the duck's own velocity is
  // taken into account. 0 means the point is outside the cone entirely.
  function fieldAt(f, x, y, z) {
    const dx = x - f.x;
    const dy = y - f.y;
    const dz = z - f.z;
    // Downstream distance along the jet, and how far off its axis. The vertical
    // term is what makes a pitched fan a jet rather than a horizontal one with a
    // strange bounding box; at pitch 0 fy is exactly 0 and this is the same
    // number it always was.
    const along = dx * f.fx + dy * f.fy + dz * f.fz;
    if (along <= 0 || along > f.range) return 0;
    const d2 = dx * dx + dy * dy + dz * dz;
    const perp2 = d2 - along * along;
    const rmax = f.aperture + along * f.spread;
    if (perp2 >= rmax * rmax) return 0;
    const perp = perp2 > 0 ? Math.sqrt(perp2) : 0;
    const eff = along < F.minDistance ? F.minDistance : along;
    const axial = Math.pow(Math.max(0, 1 - eff / f.range), F.falloffExponent);
    // Soft edge: the outer slice of the jet fades instead of switching off, so a
    // duck drifting sideways slows down rather than falling off a cliff.
    const edge = F.edgeSoftness > 1e-9
      ? Math.min(1, (1 - perp / rmax) / F.edgeSoftness)
      : 1;
    return axial * edge;
  }

  function fixedUpdate(dt) {
    sync();
    if (fans.length === 0) return;
    hash.rebuild(ducks);
    let blew = false;

    for (let i = 0; i < fans.length; i++) {
      const f = fans[i];
      hash.query(f.minX, f.minZ, f.maxX, f.maxZ, (id, x, y, z) => {
        const field = fieldAt(f, x, y, z);
        if (field <= 0) return;
        const body = ducks.body(id);
        if (!body) return;
        const lv = body.linvel();
        // Relative to the airstream: no push left once the duck matches the air.
        const along = lv.x * f.fx + lv.y * f.fy + lv.z * f.fz;
        const slip = 1 - along / F.airSpeed;
        if (slip <= 0) return;
        const mag = f.force * field * (slip > 1 ? 1 : slip) * dt;
        if (mag < 1e-9) return;

        // The one trap this whole phase is built around: Rapier ignores forces
        // on a sleeping body AND does not wake it, so a duck asleep in the wind
        // would lie there forever with no error anywhere.
        ducks.wakeDuck(id);
        applyImpulse(body, {
          x: f.fx * mag,
          // The jet's own vertical component PLUS the standing lift. The lift is
          // not part of the aim: it breaks the floor friction that would
          // otherwise pin a settled duck in place at the far end of the cone,
          // and it is there at every pitch. At pitch 0 fy is 0 and this is the
          // impulse the fan has always applied.
          y: (f.fy + F.lift) * mag,
          z: f.fz * mag,
        });

        blew = true;
        accCounts.pushed++;
        accCounts.impulses++;
        totalImpulses++;
      });
    }

    accFlags.blowing = accFlags.blowing || blew;
  }

  function endFrame() {
    flags = { blowing: accFlags.blowing };
    counts = { pushed: accCounts.pushed, impulses: accCounts.impulses };
    accFlags = { blowing: false };
    accCounts = { pushed: 0, impulses: 0 };
  }

  // Is a duck standing here inside somebody's wind? Used by the coverage probe.
  function covers(x, y, z) {
    sync();
    for (let i = 0; i < fans.length; i++) {
      if (fieldAt(fans[i], x, y, z) > 0) return fans[i];
    }
    return null;
  }

  function info() {
    sync();
    return fans.map((f) => ({
      key: f.key,
      id: f.id,
      position: { x: f.x, y: f.y, z: f.z },
      yawDegrees: (f.yaw * 180) / Math.PI,
      forward: { x: f.fx, y: f.fy, z: f.fz },
      pitchDegrees: f.pitch / DEG,
      force: f.force,
      range: f.range,
      coneDegrees: f.cone / DEG,
      blockDucks: f.blockDucks,
      fieldAtHalfRange: fieldAt(
        f, f.x + f.fx * f.range * 0.5, f.y + f.fy * f.range * 0.5, f.z + f.fz * f.range * 0.5
      ),
      fieldAtRange: fieldAt(
        f, f.x + f.fx * f.range * 0.99, f.y + f.fy * f.range * 0.99, f.z + f.fz * f.range * 0.99
      ),
    }));
  }

  return {
    sync,
    covers,
    info,
    fieldAt: (x, y, z) => {
      sync();
      let best = 0;
      for (let i = 0; i < fans.length; i++) best = Math.max(best, fieldAt(fans[i], x, y, z));
      return best;
    },
    count: () => { sync(); return fans.length; },
    flags: () => ({ ...flags }),
    counts: () => ({ ...counts }),
    totalImpulses: () => totalImpulses,
    hashStats: () => ({
      cells: hash.cellCount(),
      ducks: hash.liveCount(),
      cellSize: hash.cellSize(),
    }),
    _fixedUpdate: fixedUpdate,
    endFrame,
  };
}

export default createBlowers;
