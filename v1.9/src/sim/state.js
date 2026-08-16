// The world snapshot: ONE serialisation format serving three jobs -- a client
// joining mid-game, debugSnapshot() for debugging, and crash recovery. If those
// three ever diverge the format is wrong, so there is exactly one serialize()
// and exactly one load() and every consumer goes through them.
//
// Renderer-agnostic like the rest of src/sim: no three.js, no Rapier import, no
// DOM. Every dependency is handed in, and the module reaches into nothing it was
// not given.
//
// WIRE IDENTITY
//   duck        pool slot (0..ducks.max-1). Fixed pool, so the slot IS the id.
//   placed row  netId, from the catalog. Says WHAT the object is.
//   placed copy key, the monotonic instance counter from render/placed.js. Says
//               WHICH copy. Never derived from array position, never recycled.
//   prop        a dropped dynamic body, keyed by the SAME counter as a placed
//               copy: placed.js hands out one sequence for both.
//   container   the key of the prop body that carries it (same counter).
// Nothing in this file branches on a row's `id`.

// Field-level restore capability, stated once so it cannot be discovered by
// surprise. `full` fields are restored exactly through the owning module's
// public API. Nothing is `hook` any more: the five setters the previous version
// of this file named as missing now exist, and every one of them is used below.
export const RESTORE_CAPABILITY = Object.freeze({
  money: 'full',            // economy.set()
  totalEarned: 'full',      // economy.setTotalEarned(): exact, both directions
  clock: 'full',            // owned here
  ducks: 'full',            // pool slot, tier, pose, velocity, sleeping
  containers: 'full',       // physical slots + tiers, virtual tiers
  placed: 'full',           // netId, key, pose, yaw, free, buyLevel
  props: 'full',            // netId, key, pose, velocity, sleeping, via
                            // placed.dropProp(); a storage prop is re-registered
                            // as its container before anything is put back in it
  producerTimers: 'full',   // restored by interleaving placement with update()
  shopLevels: 'full',       // shop.setLevels(): levels only, no money moved and
                            // no purchase listener fired
  prestige: 'full',         // prestige.setState(): count and multiplier, told
                            // rather than recomputed
  producerProduced: 'full', // producers.setProduced(key, n)
  players: 'full',          // WHO IS HOLDING WHAT, via hooks.players/setPlayers
});

// Snapshot paths that no public API can write back, so a round trip cannot be
// expected to close them. Deliberately EMPTY: every gap this list used to
// describe now has a setter. The mechanism stays so a future gap has somewhere
// honest to be declared instead of quietly inflating the drift count.
export const HOOK_ONLY_PATHS = Object.freeze([]);

export function isHookOnly(path) {
  for (let i = 0; i < HOOK_ONLY_PATHS.length; i++) {
    if (HOOK_ONLY_PATHS[i].test(path)) return true;
  }
  return false;
}

// 2: added the `props` section (dropped physics bodies). A frame of the older
// layout describes a world with containers whose bodies do not exist, so it is
// rejected outright rather than loaded into a half-built plate.
// 3: added the `players` section. A carryable can be picked up INTO a player's
// hotbar and thrown back out, so an item can exist in the world without being a
// prop on the floor and without being a placed object. Versions 1 and 2 could
// describe every duck and every crate and still not answer "who is holding the
// broom" -- which meant a player joining a running game was told the broom had
// simply vanished. A snapshot is supposed to be the whole world; this is the
// part of it that was missing.
// 4: each player row gained `hold` -- the duck they are CARRYING, as opposed to
// `hand`, the hotbar item they have equipped. The two are different facts about
// different objects: an equipped broom is an inventory row with no body in the
// world, while a carried duck is a real body whose pose is already streaming to
// everyone. What the stream cannot say is whose grip it is in, so a player who
// joined mid-carry saw a duck hovering in front of nobody until it was dropped.
// 5: added `prestige` -- the team's prestige count and the multiplier it bought.
// The multiplier is NOT derivable from anything else in the frame: it is the
// formula evaluated at the instant a prestige was taken, and `totalEarned` has
// kept climbing since, so a client that recomputed it from its own copy of the
// counter would pay every duck at the wrong rate. It has to be told.
// 6: added `stock` -- the vendor's shelf. Like the prestige multiplier this is
// not derivable from anything else in the frame: it is the host's dice, rolled
// once every stock period, and a client that rolled its own would be shopping
// in a different shop. It carries the units LEFT, the units the period started
// with (a refund puts one back and may not exceed it) and how far into the
// period the host is, so a player joining at 2:50 sees the shelf turn over ten
// seconds later like everybody else rather than three minutes later.
const SNAPSHOT_VERSION = 6;

function fin(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

function q6(v) {
  // Snapshots are compared field by field and travel as JSON; float noise from
  // a physics engine is not signal. Six decimals is a micrometre.
  return Math.round(fin(v, 0) * 1e6) / 1e6;
}

// deps:
//   world        createWorld() result (ducks, economy, stats, _raw not used)
//   shop         createShop() result
//   placed       render/placed.js result -- an object list, not a renderer
//   containers   createContainers() result
//   producers    createProducers() result
//   byNetId      catalog lookup, netId -> row
//   resolveItem  optional; row -> the object placed.place() expects
//   config       for loop.fixedDt
export function createState({
  world, shop, placed, containers, producers, prestige, stock, byNetId, config, hooks,
}) {
  if (!world) throw new Error('[state] world is required');
  if (typeof byNetId !== 'function') throw new Error('[state] byNetId is required');

  const H = hooks || {};
  const fixedDt = fin(config && config.loop && config.loop.fixedDt, 1 / 60);

  // The session clock. world.stats().simTime is monotonic from boot and has no
  // setter, so the session clock is defined here as (base + simTime elapsed).
  // A loaded snapshot moves the base; nothing else does.
  let clockBase = 0;
  let clockOrigin = simTime();

  function simTime() {
    const s = world.stats ? world.stats() : null;
    return fin(s && s.simTime, 0);
  }

  function clock() {
    return clockBase + (simTime() - clockOrigin);
  }

  // A placed record does not carry the shop level it was bought at (placed.js
  // stores a pose and a row, nothing about the transaction). The level is
  // therefore captured the first time this module sees a record, which for a
  // host that serialises every frame is the frame it was placed. `rec.buyLevel`
  // wins if placed.js ever starts writing one.
  const buyLevels = new Map();   // placed key -> level

  function observe() {
    const objs = (placed && placed.objects) || [];
    for (let i = 0; i < objs.length; i++) {
      const rec = objs[i];
      if (typeof rec.buyLevel === 'number') { buyLevels.set(rec.key, rec.buyLevel); continue; }
      if (buyLevels.has(rec.key)) continue;
      buyLevels.set(rec.key, shop && typeof shop.levelOf === 'function' ? shop.levelOf(rec.id) : 0);
    }
    return buyLevels.size;
  }

  // --- serialise -------------------------------------------------------------

  function serializeDucks() {
    const ducks = world.ducks;
    const out = [];
    if (!ducks || typeof ducks.forEach !== 'function') return out;
    // Emitted in pool-slot order: the pool is fixed at 300, so the slot is the
    // identity and the array is already sorted by it.
    ducks.forEach((id, x, y, z, qx, qy, qz, qw, tier, sleeping) => {
      const b = typeof ducks.body === 'function' ? ducks.body(id) : null;
      const v = b && typeof b.linvel === 'function' ? b.linvel() : { x: 0, y: 0, z: 0 };
      const w = b && typeof b.angvel === 'function' ? b.angvel() : { x: 0, y: 0, z: 0 };
      out.push({
        slot: id,
        tier: tier | 0,
        sleeping: !!sleeping,
        p: [q6(x), q6(y), q6(z)],
        q: [q6(qx), q6(qy), q6(qz), q6(qw)],
        v: [q6(v.x), q6(v.y), q6(v.z)],
        w: [q6(w.x), q6(w.y), q6(w.z)],
      });
    });
    return out;
  }

  function serializePlaced() {
    observe();
    const objs = (placed && placed.objects) || [];
    const out = [];
    for (let i = 0; i < objs.length; i++) {
      const rec = objs[i];
      out.push({
        key: rec.key,
        netId: rec.netId,
        p: [q6(rec.position.x), q6(rec.position.y), q6(rec.position.z)],
        yaw: q6(rec.yaw),
        free: !!rec.free,
        level: buyLevels.has(rec.key) ? buyLevels.get(rec.key) : 0,
      });
    }
    // Canonical order: by instance key. Array position carries no meaning on
    // the wire, and load() rebuilds the list in a different order (producer
    // timers dictate placement order), so an unsorted array would make the
    // round trip look broken when nothing had actually changed.
    out.sort(byKeyAsc);
    return out;
  }

  function byKeyAsc(a, b) { return a.key - b.key; }

  // Dropped physics props: the crate the vendor just dropped, the bucket you
  // knocked over, every container on the plate. These are real dynamic bodies,
  // not colliders on the plate, so unlike a placed building they carry a full
  // pose AND a velocity -- a crate caught mid-bounce has to land where it was
  // going to land, and a container restored at rest when it was falling would
  // drop its contents.
  //
  // A container's CONTENTS are serialised separately (serializeContainers) and
  // are keyed by exactly this key, so a container without its prop is a box of
  // ducks with no box. That is the gap this section closes.
  function serializeProps() {
    const list = (placed && placed.props) || [];
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const rec = list[i];
      const b = rec.body;
      if (!b) continue;
      const t = b.translation();
      const r = b.rotation();
      const v = typeof b.linvel === 'function' ? b.linvel() : { x: 0, y: 0, z: 0 };
      const w = typeof b.angvel === 'function' ? b.angvel() : { x: 0, y: 0, z: 0 };
      out.push({
        key: rec.key,
        netId: rec.netId,
        p: [q6(t.x), q6(t.y), q6(t.z)],
        q: [q6(r.x), q6(r.y), q6(r.z), q6(r.w)],
        v: [q6(v.x), q6(v.y), q6(v.z)],
        w: [q6(w.x), q6(w.y), q6(w.z)],
        sleeping: !!(typeof b.isSleeping === 'function' && b.isSleeping()),
      });
    }
    // Same reason as serializePlaced: array position carries no meaning on the
    // wire and load() rebuilds in its own order.
    out.sort(byKeyAsc);
    return out;
  }

  function serializeContainers() {
    if (!containers || typeof containers.list !== 'object') return [];
    const out = [];
    const list = containers.list;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      out.push({
        key: c.key,
        netId: c.netId,
        // Physical contents are duck pool slots -- real bodies you can see
        // moving in the box. Virtual contents are tiers only: the body went
        // back to the pool and the tier is all that is remembered.
        physical: c.physical.slice(),
        physicalTiers: c.physical.map((id) => {
          const t = world.ducks.tier(id);
          return typeof t === 'number' ? t : 0;
        }),
        virtualCount: c.virtualTiers.length,
        virtualTiers: c.virtualTiers.slice(),
      });
    }
    out.sort(byKeyAsc);
    return out;
  }

  function serializeProducers() {
    if (!producers || typeof producers.info !== 'function') return [];
    return producers.info().map((u) => ({
      key: u.key,
      timer: q6(u.timer),
      interval: q6(u.intervalSeconds),
      produced: u.produced,
      jammed: !!u.jammed,
    })).sort(byKeyAsc);
  }

  // Who is in the room and what is in their hands. Supplied by hooks.players()
  // because inventory lives above src/sim -- a hotbar is a UI in single player
  // and a host-owned map in multiplayer, and this module is not allowed to know
  // which. What it IS allowed to insist on is that the answer travels in the
  // snapshot: the same one format for joining, for debugSnapshot() and for
  // crash recovery. An item in a hand is not a prop and not a placed object, so
  // before this section a snapshot could describe a complete world in which the
  // broom somebody was carrying did not exist.
  //
  // Normalised rather than passed through: the shape is part of the format, and
  // a hook returning something slightly different would otherwise show up as a
  // round-trip drift somewhere else entirely.
  function serializePlayers() {
    const list = typeof H.players === 'function' ? H.players() : null;
    if (!Array.isArray(list)) return [];
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i] || {};
      const hb = Array.isArray(p.hotbar) ? p.hotbar : [];
      out.push({
        slot: p.slot | 0,
        nick: String(p.nick === undefined || p.nick === null ? '' : p.nick),
        host: !!p.host,
        p: [q6(p.p ? p.p[0] : 0), q6(p.p ? p.p[1] : 0), q6(p.p ? p.p[2] : 0)],
        yaw: q6(p.yaw),
        pitch: q6(p.pitch),
        sel: typeof p.sel === 'number' ? p.sel : -1,
        hand: p.hand || null,
        // The duck in their GRIP, by pool slot -- the pool slot is the wire
        // identity of a duck everywhere else in the project, so it is what
        // travels here too. Normalised to a number or null: a hook handing back
        // anything else would show up later as round-trip drift in a section
        // that has nothing to do with hands.
        hold: (p.hold && typeof p.hold.d === 'number' && isFinite(p.hold.d))
          ? { d: p.hold.d | 0 } : null,
        // Slot order is meaningful here (it is which key holds what), so unlike
        // every other section this one is NOT sorted. A null is an empty slot.
        hotbar: hb.map((s) => (s && s.id ? { id: s.id, n: s.n | 0 } : null)),
      });
    }
    out.sort((a, b) => a.slot - b.slot);
    return out;
  }

  function restorePlayers(snap) {
    const rows = snap.players || [];
    if (typeof H.setPlayers !== 'function') {
      return { applied: rows.length === 0, count: rows.length };
    }
    try {
      H.setPlayers(rows);
      return { applied: true, count: rows.length };
    } catch (err) {
      return { applied: false, count: rows.length, error: err && err.message ? err.message : String(err) };
    }
  }

  // The team's prestige. Two numbers, and the second one cannot be derived: the
  // multiplier was fixed at the instant it was taken and `totalEarned` has moved
  // on since. A joining client is told it rather than computing it.
  function serializePrestige() {
    const s = prestige && typeof prestige.state === 'function' ? prestige.state() : null;
    return { count: fin(s && s.count, 0), multiplier: q6(fin(s && s.multiplier, 1)) };
  }

  function restorePrestige(snap) {
    const want = snap.prestige || { count: 0, multiplier: 1 };
    if (!prestige || typeof prestige.setState !== 'function') {
      return { applied: !want.count && want.multiplier === 1, want };
    }
    prestige.setState(want);
    return { applied: true, want };
  }

  // The vendor's shelf. Written straight through from src/sim/stock.js, which
  // already keeps it in a JSON-safe shape (two id -> integer tables and two
  // numbers) because it was designed to travel.
  function serializeStock() {
    if (!stock || typeof stock.table !== 'function') return null;
    const t = stock.table();
    return { elapsed: q6(fin(t.elapsed, 0)), period: fin(t.period, 0), units: t.units, rolled: t.rolled };
  }

  // A snapshot with no `stock` section describes a session that had no stock
  // system, which is a real state (the shop can be built without a shelf) and
  // not an error. What must never happen is a client silently keeping the shelf
  // it rolled at boot while believing it loaded the host's.
  function restoreStock(snap) {
    const want = snap.stock || null;
    if (!stock || typeof stock.setTable !== 'function') {
      return { applied: !want, want };
    }
    if (!want) return { applied: false, want: null, reason: 'snapshot carries no stock section' };
    stock.setTable(want);
    return { applied: true, want };
  }

  function serialize() {
    const econ = world.economy || {};
    return {
      v: SNAPSHOT_VERSION,
      clock: q6(clock()),
      money: fin(econ.money ? econ.money() : 0, 0),
      totalEarned: fin(econ.totalEarned ? econ.totalEarned() : 0, 0),
      duckMax: (world.ducks && world.ducks.max) || 0,
      shopLevels: shop && typeof shop.ownedLevels === 'function' ? shop.ownedLevels() : {},
      stock: serializeStock(),
      prestige: serializePrestige(),
      placed: serializePlaced(),
      props: serializeProps(),
      ducks: serializeDucks(),
      containers: serializeContainers(),
      producers: serializeProducers(),
      players: serializePlayers(),
    };
  }

  // --- load ------------------------------------------------------------------
  //
  // Order is load-bearing and is the reason this reads the way it does:
  //   1  unregister every container, so no duck is owned by anything and no
  //      container is left holding a body step 3 is about to destroy
  //   2  release every duck, so the whole pool is free
  //   3  clear the placed list AND despawn every dropped prop, and make the
  //      producers notice, so no stale unit survives to be reused by a key this
  //      load is about to re-adopt
  //   4  recreate the props from the snapshot and re-register the storage ones
  //      as containers under their own keys
  //   5  order the pool's free list so the next N spawns land on exactly the
  //      slots the snapshot names -- the pool hands out the LAST slot released
  //   6  refill containers (their spawns consume the head of that order)
  //   7  spawn the loose ducks (they consume the rest)
  //   8  write every pose, velocity and sleeping flag by slot
  //   9  rebuild the placed list, replaying producer timers as it goes
  //  10  write the shop levels, the producers' lifetime counters and the money
  // Step 4 before 6 is new and is not optional: containers.fill() spawns each
  // physical content at a lattice slot computed from the CONTAINER'S CURRENT
  // POSE, so a crate whose body had not been put back yet would fill at the
  // origin. Step 8 before 9 is why a full pool stays full: a producer's jam
  // state is a function of the cap. Step 8 after 6/7 is what makes container
  // contents land where the host had them rather than at their lattice slots.

  function clearContainers() {
    if (!containers || typeof containers.list !== 'object') return 0;
    const snap = containers.list.slice();
    let n = 0;
    for (let i = 0; i < snap.length; i++) {
      // unregister() frees every physical content back to the pool. Unlike the
      // previous version this does NOT re-register: the body it would be
      // re-registered against is about to be destroyed with its prop, and a
      // container holding a freed body reads a dangling pointer on the next
      // substep. Registration happens again in restoreProps(), against the new
      // body, under the same key.
      snap[i].virtualTiers.length = 0;
      containers.unregister(snap[i].key);
      n++;
    }
    return n;
  }

  function clearProps() {
    const list = (placed && placed.props) || [];
    if (!placed || typeof placed.despawnProp !== 'function') return 0;
    const n = list.length;
    for (let i = list.length - 1; i >= 0; i--) placed.despawnProp(list[i]);
    return n;
  }

  // Recreate every dropped prop through placed.dropProp() -- the same call the
  // vendor's tube uses, so a restored crate is indistinguishable from a bought
  // one -- then overwrite the pose and both velocities, adopt the host's key,
  // and hand the body to containers.register() if the row is a storage row.
  // register() returns null for anything else, so no id is ever tested here.
  function restoreProps(snap) {
    const rows = snap.props || [];
    const out = { restored: 0, skipped: 0, containers: 0, overCap: 0 };
    if (!rows.length) return out;
    if (!placed || typeof placed.dropProp !== 'function') {
      out.skipped = rows.length;
      return out;
    }
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const item = byNetId(r.netId);
      if (!item || !item.collider || !item.model) { out.skipped++; continue; }
      const rec = placed.dropProp(
        item,
        { x: r.p[0], y: r.p[1], z: r.p[2] },
        { x: r.v[0], y: r.v[1], z: r.v[2] }
      );
      if (!rec) { out.skipped++; continue; }
      rec.key = r.key;
      // The local counter must not hand this key out again to a later purchase.
      if (typeof placed.reserveKey === 'function') placed.reserveKey(r.key);
      const b = rec.body;
      b.setTranslation({ x: r.p[0], y: r.p[1], z: r.p[2] }, false);
      b.setRotation({ x: r.q[0], y: r.q[1], z: r.q[2], w: r.q[3] }, false);
      b.setLinvel({ x: r.v[0], y: r.v[1], z: r.v[2] }, false);
      b.setAngvel({ x: r.w[0], y: r.w[1], z: r.w[2] }, false);
      if (r.sleeping) b.sleep(); else b.wakeUp();
      if (containers && typeof containers.register === 'function') {
        if (containers.register(item, b, { key: rec.key })) out.containers++;
      }
      out.restored++;
    }
    // dropProp() REFUSES past config.drop.max (it used to despawn the oldest
    // prop, which lost a restored crate with nothing to say so), so a snapshot
    // carrying more props than the local cap loses the ones restored LAST and
    // they are counted here. It cannot happen between two builds of the same
    // config, which is exactly why it is measured rather than assumed.
    const live = (placed.props || []).length;
    if (live < out.restored) {
      out.overCap = out.restored - live;
      out.restored = live;
    }
    // Anything whose prop did not survive must not be left registered.
    if (containers && typeof containers.keys === 'function') {
      const keys = containers.keys();
      for (let i = 0; i < keys.length; i++) {
        let alive = false;
        const list = placed.props || [];
        for (let j = 0; j < list.length; j++) if (list[j].key === keys[i]) { alive = true; break; }
        if (!alive) { containers.unregister(keys[i]); out.containers--; }
      }
    }
    return out;
  }

  function releaseAllDucks() {
    const ducks = world.ducks;
    const ids = [];
    ducks.forEach((id) => { ids.push(id); });
    for (let i = 0; i < ids.length; i++) ducks.release(ids[i]);
    return ids.length;
  }

  // Make the pool hand out `order` (an array of pool slots) on the next
  // order.length spawns, in that exact sequence. The pool's free list is a
  // stack, so: drain it, put back everything unwanted, then put back the wanted
  // slots in reverse. No body is created or destroyed -- park/unpark only.
  const PARK = { x: 0, y: -400, z: 0 };
  function orderFreeList(order) {
    const ducks = world.ducks;
    const N = ducks.max;
    const want = new Set(order);
    // Drain: every free slot becomes live, so the free list is empty and this
    // module -- not spawn order history -- decides what goes back on it.
    const drained = [];
    for (let i = 0; i < N; i++) {
      const id = ducks.spawn(PARK, 0);
      if (id === null) break;
      drained.push(id);
    }
    for (let i = 0; i < drained.length; i++) {
      if (!want.has(drained[i])) ducks.release(drained[i]);
    }
    for (let i = order.length - 1; i >= 0; i--) {
      if (ducks.isActive(order[i])) ducks.release(order[i]);
    }
    return drained.length;
  }

  function clearPlaced() {
    if (!placed || typeof placed.place !== 'function') return 0;
    const n = placed.objects.length;
    for (let i = placed.objects.length - 1; i >= 0; i--) placed.remove(placed.objects[i]);
    buyLevels.clear();
    // Force the producer set to resync against the now-empty placed list. Its
    // units are keyed by placement key and are only dropped when something asks
    // it to look; without this the old units survive the clear, and because
    // load() re-adopts the host's keys they are silently REUSED, carrying their
    // previous timers into the restore and firing a duck that was never owed.
    // info() resyncs without advancing anything.
    if (producers && typeof producers.info === 'function') producers.info();
    return n;
  }

  function rebuildPlaced(snap) {
    if (!placed || typeof placed.place !== 'function') return { placed: 0, skipped: 0 };

    // Producer timers are restored by placing in descending-timer order and
    // advancing the producer clock by the gap between consecutive timers: a
    // unit placed later has had less time to run. producers.update() adds the
    // same dt to every unit it currently knows about, which is exactly what
    // makes the arithmetic come out per-unit.
    const timers = new Map();
    for (let i = 0; i < (snap.producers || []).length; i++) {
      const u = snap.producers[i];
      timers.set(u.key, fin(u.timer, 0));
    }
    const rows = (snap.placed || []).slice();
    rows.sort((a, b) => (timers.get(b.key) || -1) - (timers.get(a.key) || -1));

    let count = 0;
    let skipped = 0;
    let advanced = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const item = byNetId(r.netId);
      if (!item || !item.collider) { skipped++; continue; }
      const rec = placeOne(item, r);
      if (!rec) { skipped++; continue; }
      count++;
      // Advance to the next unit's timer, if this one is a producer.
      if (timers.has(r.key) && producers && typeof producers.update === 'function') {
        let next = 0;
        for (let j = i + 1; j < rows.length; j++) {
          if (timers.has(rows[j].key)) { next = timers.get(rows[j].key); break; }
        }
        const dt = timers.get(r.key) - next;
        if (dt > 0) { producers.update(dt); advanced += dt; }
      }
    }
    return { placed: count, skipped, advanced: q6(advanced) };
  }

  function placeOne(item, r) {
    const half = item.collider.half;
    const yaw = fin(r.yaw, 0);
    const h = yaw * 0.5;
    const pose = {
      position: { x: r.p[0], y: r.p[1], z: r.p[2] },
      quaternion: { x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) },
      valid: true,
      reason: null,
      yaw,
      free: !!r.free,
      snapped: !r.free,
      box: { x: r.p[0], y: r.p[1], z: r.p[2], yaw, hx: half[0], hy: half[1], hz: half[2] },
    };
    const rec = placed.place(item, pose);
    if (!rec) return null;
    // Adopt the host's instance id. A joining client MUST use the host's keys or
    // every later message about that object addresses a different one.
    rec.key = r.key;
    if (typeof placed.reserveKey === 'function') placed.reserveKey(r.key);
    rec.buyLevel = fin(r.level, 0);
    buyLevels.set(rec.key, rec.buyLevel);
    return rec;
  }

  function refillContainers(snap) {
    if (!containers || typeof containers.fill !== 'function') return 0;
    let n = 0;
    for (let i = 0; i < (snap.containers || []).length; i++) {
      const s = snap.containers[i];
      const c = containers.get(s.key);
      if (!c) continue;
      // Physical first, one at a time so each keeps its own tier. fill() is the
      // only public path that takes a duck in properly (collision groups,
      // gravity scale and the containedBy map all move together).
      for (let j = 0; j < s.physical.length; j++) {
        containers.fill(s.key, 1, { tier: s.physicalTiers ? s.physicalTiers[j] : 0 });
      }
      // Virtual contents have no body by definition, so they are pushed
      // directly; fill(key, 0) then re-runs the additional-mass sync.
      for (let j = 0; j < (s.virtualTiers || []).length; j++) {
        c.virtualTiers.push(s.virtualTiers[j] | 0);
      }
      containers.fill(s.key, 0);
      n++;
    }
    return n;
  }

  function writeDuckPoses(snap) {
    const ducks = world.ducks;
    let n = 0;
    for (let i = 0; i < (snap.ducks || []).length; i++) {
      const d = snap.ducks[i];
      const b = ducks.body(d.slot);
      if (!b || !ducks.isActive(d.slot)) continue;
      b.setTranslation({ x: d.p[0], y: d.p[1], z: d.p[2] }, false);
      b.setRotation({ x: d.q[0], y: d.q[1], z: d.q[2], w: d.q[3] }, false);
      b.setLinvel({ x: d.v[0], y: d.v[1], z: d.v[2] }, false);
      b.setAngvel({ x: d.w[0], y: d.w[1], z: d.w[2] }, false);
      if (d.sleeping) b.sleep(); else b.wakeUp();
      n++;
    }
    return n;
  }

  // Money first, THEN earned. That order matters: economy.set() moves the
  // balance with add(), and a positive add() raises `earned` on the way past, so
  // writing the lifetime counter first would leave it inflated by whatever the
  // balance had to climb. setTotalEarned() is exact in both directions, which is
  // what makes a crash recovery to a SMALLER number correct rather than
  // "reported as short".
  function restoreMoney(snap) {
    const econ = world.economy;
    if (!econ) return { money: 0, earned: 0, earnedShort: 0 };
    if (typeof econ.set === 'function') econ.set(fin(snap.money, 0));
    let earnedShort = 0;
    if (typeof econ.totalEarned === 'function') {
      const have = econ.totalEarned();
      const want = fin(snap.totalEarned, have);
      if (typeof econ.setTotalEarned === 'function') {
        econ.setTotalEarned(want);
      } else {
        // Fallback for an economy without the setter: add() raises earned and
        // add(-x) lowers money without touching it, so the pair raises earned
        // and leaves the balance where it was. Lowering is impossible this way
        // and is reported, never silently swallowed.
        const delta = want - have;
        if (delta > 0) { econ.add(delta, 'restore'); econ.add(-delta, 'restore'); }
        else if (delta < 0) earnedShort = delta;
      }
    }
    return { money: econ.money(), earned: econ.totalEarned(), earnedShort };
  }

  // shop.setLevels() writes the ownership map and nothing else -- no money
  // spent, no purchase listener fired, so no prop drops out of the tube and no
  // hotbar slot fills. It throws on an unknown id or a level past a row's
  // ceiling; that is caught here and reported rather than aborting a load that
  // has already rebuilt the world.
  function applyShopLevels(snap) {
    const want = snap.shopLevels || {};
    const have = shop && typeof shop.ownedLevels === 'function' ? shop.ownedLevels() : {};
    const diffs = [];
    const ids = new Set(Object.keys(want).concat(Object.keys(have)));
    ids.forEach((id) => {
      const a = want[id] || 0;
      const b = have[id] || 0;
      if (a !== b) diffs.push({ id, want: a, have: b });
    });
    if (!diffs.length) return { applied: true, diffs, error: null };
    try {
      if (shop && typeof shop.setLevels === 'function') {
        shop.setLevels(want);
        return { applied: true, diffs, error: null };
      }
      if (typeof H.setShopLevels === 'function') {
        H.setShopLevels(want);
        return { applied: true, diffs, error: null, viaHook: true };
      }
    } catch (err) {
      return { applied: false, diffs, error: err && err.message ? err.message : String(err) };
    }
    return { applied: false, diffs, error: 'no shop.setLevels()' };
  }

  // The lifetime per-producer counter. Written AFTER rebuildPlaced, because
  // replaying the timers through producers.update() can legitimately emit a duck
  // and bump the counter on its way.
  function restoreProduced(snap) {
    const rows = snap.producers || [];
    const missing = [];
    if (!rows.length) return { applied: true, missing };
    if (!producers || typeof producers.setProduced !== 'function') {
      return { applied: false, missing: rows.map((u) => u.key) };
    }
    for (let i = 0; i < rows.length; i++) {
      if (!producers.setProduced(rows[i].key, rows[i].produced)) missing.push(rows[i].key);
    }
    return { applied: missing.length === 0, missing };
  }

  function load(snapshot) {
    const snap = snapshot;
    if (!snap || typeof snap !== 'object') throw new Error('[state] load() needs a snapshot object');
    if (snap.v !== SNAPSHOT_VERSION) {
      throw new Error(`[state] snapshot version ${snap.v} != ${SNAPSHOT_VERSION}`);
    }

    const emptied = clearContainers();
    const released = releaseAllDucks();
    clearPlaced();
    const propsCleared = clearProps();

    // The props come back BEFORE anything is put inside them: a container fills
    // at lattice slots measured from its body's current pose.
    const propsBuilt = restoreProps(snap);

    // The order the pool must hand slots out in: every container's physical
    // contents first (fill() spawns them), then the loose ducks.
    const order = [];
    const contained = new Set();
    for (let i = 0; i < (snap.containers || []).length; i++) {
      const s = snap.containers[i];
      for (let j = 0; j < s.physical.length; j++) {
        order.push(s.physical[j]);
        contained.add(s.physical[j]);
      }
    }
    for (let i = 0; i < (snap.ducks || []).length; i++) {
      if (!contained.has(snap.ducks[i].slot)) order.push(snap.ducks[i].slot);
    }
    orderFreeList(order);

    const filled = refillContainers(snap);

    // Loose ducks, in the same order the free list was arranged in.
    let spawned = 0;
    const wanted = new Map();
    for (let i = 0; i < (snap.ducks || []).length; i++) wanted.set(snap.ducks[i].slot, snap.ducks[i]);
    for (let i = 0; i < order.length; i++) {
      if (contained.has(order[i])) continue;
      const d = wanted.get(order[i]);
      const id = world.ducks.spawn({ x: d.p[0], y: d.p[1], z: d.p[2] }, d.tier);
      if (id === null) break;
      spawned++;
    }

    const posed = writeDuckPoses(snap);

    // Placement comes AFTER the pool is back, and that ordering is load-bearing:
    // restoring a producer's timer replays it through producers.update(), and a
    // producer jams (timer pinned at its interval) only while the pool is at the
    // cap. Rebuilding the machines against an empty pool let a jammed producer
    // decide it was not jammed after all, emit a duck nobody was owed, and reset
    // its timer to 0. With the ducks already back, the cap state the timer was
    // recorded under is the cap state it is replayed under.
    const built = rebuildPlaced(snap);

    const produced = restoreProduced(snap);
    const econ = restoreMoney(snap);
    const levels = applyShopLevels(snap);
    const prest = restorePrestige(snap);
    // The shelf. Nothing else in the load depends on it and it depends on
    // nothing else -- it is two tables of integers -- so it can sit anywhere in
    // this sequence; it lives beside the shop levels because that is the other
    // half of "what can I buy right now".
    const shelf = restoreStock(snap);
    // AFTER the props, and the ordering matters for the same reason the rest of
    // this function is ordered: a hand holding a crate and a crate lying on the
    // floor are the same object, and restoring the hands first would leave the
    // prop rebuild free to put a second copy of it on the plate.
    const people = restorePlayers(snap);

    clockBase = fin(snap.clock, 0);
    clockOrigin = simTime();

    const wantedProps = (snap.props || []).length;

    return {
      ok: true,
      emptiedContainers: emptied,
      releasedDucks: released,
      clearedProps: propsCleared,
      props: propsBuilt.restored,
      propsWanted: wantedProps,
      propsSkipped: propsBuilt.skipped,
      propsOverCap: propsBuilt.overCap,
      registeredContainers: propsBuilt.containers,
      placed: built.placed,
      placedSkipped: built.skipped,
      producerSecondsAdvanced: built.advanced,
      filledContainers: filled,
      spawnedDucks: spawned,
      posedDucks: posed,
      money: econ.money,
      totalEarned: econ.earned,
      earnedShort: econ.earnedShort,
      shopLevelsApplied: levels.applied,
      shopLevelDiffs: levels.diffs,
      shopLevelError: levels.error,
      prestige: prest.want.count,
      prestigeMultiplier: prest.want.multiplier,
      prestigeApplied: prest.applied,
      stockApplied: shelf.applied,
      stockPeriod: snap.stock ? snap.stock.period : null,
      producedApplied: produced.applied,
      producedMissing: produced.missing,
      players: people.count,
      playersApplied: people.applied,
      playersError: people.error || null,
      // Everything the load could NOT put back, named. Silence here would be a
      // lie by omission on exactly the fields a restore is least able to reach.
      unrestored: (levels.applied ? [] : ['shopLevels'])
        .concat(prest.applied ? [] : ['prestige'])
        .concat(shelf.applied ? [] : ['stock'])
        .concat(econ.earnedShort < 0 ? ['totalEarned'] : [])
        .concat(produced.applied ? [] : ['producerProduced'])
        .concat(propsBuilt.restored === wantedProps ? [] : ['props'])
        .concat(people.applied ? [] : ['players']),
    };
  }

  // --- comparison ------------------------------------------------------------
  // Round-tripping is proven field by field, never by eye. Returns every path
  // whose value differs, with both values, so a failure names itself.

  function diff(a, b, path, out, tol) {
    const o = out || [];
    const p = path || '';
    const t = fin(tol, 0);
    if (a === b) return o;
    if (typeof a === 'number' && typeof b === 'number') {
      if (Math.abs(a - b) > t) o.push({ path: p, a, b, delta: b - a });
      return o;
    }
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
        o.push({ path: p, a, b });
        return o;
      }
      for (let i = 0; i < a.length; i++) diff(a[i], b[i], `${p}[${i}]`, o, t);
      return o;
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      const keys = new Set(Object.keys(a).concat(Object.keys(b)));
      keys.forEach((k) => diff(a[k], b[k], p ? `${p}.${k}` : k, o, t));
      return o;
    }
    o.push({ path: p, a, b });
    return o;
  }

  return {
    serialize,
    load,
    diff,
    observe,
    clock,
    setClock(v) { clockBase = fin(v, 0); clockOrigin = simTime(); return clock(); },
    version: SNAPSHOT_VERSION,
    capability: RESTORE_CAPABILITY,
    fixedDt,

    // The hooks this module owes window.GAME, named here so they cannot drift
    // from the code that serves them. debugSnapshot() is byte-identical to what
    // a joining client receives, because it is the same function.
    debugHooks() {
      return {
        debugSnapshot: () => serialize(),
        debugLoadSnapshot: (s) => load(s),
        debugSnapshotDiff: (x, y, tol) => diff(x, y, '', [], tol),
        debugSnapshotRoundTrip: (tol) => {
          const before = serialize();
          const result = load(before);
          const after = serialize();
          const d = diff(before, after, '', [], tol);
          // Reported separately, never merged: a field with no setter anywhere
          // in the project is a known gap with a named hook, not a bug in the
          // format, and hiding it inside one number would lose that.
          const hook = d.filter((e) => isHookOnly(e.path));
          const real = d.filter((e) => !isHookOnly(e.path));
          return {
            drift: real.length,
            driftTotal: d.length,
            hookOnlyDrift: hook.length,
            fields: real.slice(0, 40),
            hookFields: hook.slice(0, 20),
            result,
          };
        },
        debugSessionClock: () => clock(),
      };
    },
  };
}

export default createState;
