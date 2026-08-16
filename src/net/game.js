// The seam between the game and the network. main.js talks to this and to
// nothing else in src/net; host.js and client.js talk to the game through the
// adapter this file builds and never import a renderer.
//
// THE ONE RULE THIS FILE EXISTS TO MAKE STRUCTURAL
// Frozen contract rule 6: a client asks, the host does it, the host broadcasts
// to everyone INCLUDING the asker, and no client applies its own request
// locally first. That is enforced here by having exactly ONE implementation of
// every action -- perform(slot, req) -- and exactly one way in: act(req).
//
//   single player   act -> perform(0, req)         (identical to before G4)
//   host            act -> perform(0, req)         and the reconciler broadcasts
//   client          act -> client.request(req)     and NOTHING else happens
//
// The client branch has no call to perform at all. That is the point: the rule
// cannot be broken by forgetting it, only by adding a second code path, which
// is visible in a diff.
//
// The agreed exception is the build hologram. It never reaches this file: it is
// a preview of where an object WOULD go, not a claim that it went there, and a
// preview that waits for a round trip is unusable.
//
// INVENTORY IS THE HOST'S
// "Item X is in player P's hotbar" is a fact about the world, so the host owns
// it and it travels in the roster -- which is what lets a player who joins
// twenty minutes late be told that slot 2 is holding the broom rather than that
// the broom has vanished. The host's own inventory IS its local hotbar (there
// is no second copy to drift); every other player's is a map here, and a
// client's local hotbar is display only, written from the roster.
//
// No three.js in this file.

import config from '../config.js';
import { createHost } from './host.js';
import { createClient } from './client.js';
import { REQ, EV, WIRE_KIND, decodeInputWindow, seqNewer } from './protocol.js';
import { isToolRow } from '../sim/tools.js';
import { tryHostRoom, tryJoinRoom } from './signaling.js';

function now() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

const ZERO = { x: 0, y: 0, z: 0 };

// --- the gambling box's verb --------------------------------------------------
//
// PENDING A PROTOCOL LINE. Every other request in this file is named by a
// constant in src/net/protocol.js, and this one wants to be too:
//
//   REQ.GAMBLE: 'gamble'   (src/net/protocol.js, in REQ)
//   EV.GAMBLE:  'gamble'   (src/net/protocol.js, in EV)
//
// That file belongs to another builder this round, so the names below fall back
// to the same strings until the lines land, and NOTHING here changes when they
// do. What the fallback cannot fix is the wire: src/net/host.js refuses any
// request whose name is not in REQ (REQ_SET), and src/net/client.js ignores any
// event whose name it has no case for. So single player and a host both work
// today; a CLIENT's roll is refused as an unknown request, and that is the
// honest blocked state rather than a second code path pretending otherwise.
export const REQ_GAMBLE = REQ.GAMBLE || 'gamble';
export const EV_GAMBLE = EV.GAMBLE || 'gamble';

export function createNetGame(deps) {
  const {
    world, state, placed, shop, hotbar, containers, machine, props, view, input, loop,
    player, byId, byNetId, resolvePlacement, worldQuery, isBuildable, isHandCarryable,
    onEvent, onRoster, onReject, hud,
  } = deps;

  const N = config.net;
  const emit = typeof onEvent === 'function' ? onEvent : () => {};
  let session = null;
  let host = null;
  let client = null;
  let localSlot = 0;
  let lastFrameAt = now();
  // True only while pump() is driving the loop; see pump() for why it matters.
  let pumping = false;
  let actingSlot = 0;

  // Remote players. Capsules on the host (real bodies, so a remote player can
  // shove a crate), interpolated poses on a client (an avatar is a body like
  // any other and must never be simulated locally).
  const remote = new Map();   // slot -> { nick, capsule, input, pose, hotbar, selected, pitch }
  let roster = [];
  // Whole-percent crank progress the host has told us about, by placement key
  // (0 is the starter machine), as { p, at, rising }. Client side only; a host
  // reads its own world. `at` and `rising` exist so a client can run the wheel's
  // spin model off the percentages alone -- EV.CRANK carries no speed and the
  // client dispatcher (src/net/client.js) is not this builder's file to widen.
  const crankPct = new Map();

  // Who is currently HOLDING which wheel: slot -> placement key (0 = the starter
  // bench). Host and single player only -- a client's hold exists in the host's
  // world and nowhere else, which is frozen rule 6. Cleared on the up edge, when
  // the bench is demolished, and when the player leaves.
  const crankHold = new Map();

  // A tool instance per remote player, made on demand. The host owns every duck
  // body, so a remote player's broom has to sweep HERE -- in this world, from
  // where this host believes that player is looking -- and the result reaches
  // everyone through the pose stream that already exists. Slot 0 is not in this
  // map: the host's own tool is the local instance main.js already steps.
  const remoteTools = new Map();

  const counters = { acted: 0, requested: 0, performed: 0, refused: 0 };

  // --- the waiting room ---------------------------------------------------------
  // A room now opens into a LOBBY rather than into the world, so the session has
  // a PHASE and the host owns it like it owns everything else:
  //
  //   'lobby'    the host has a room and has not pressed Start
  //   'playing'  Start was pressed; the intro is running or has run
  //
  // Single player has no phase at all -- there is nobody to wait for, and
  // debugPlaySolo() must stay instant, so nothing below is ever consulted
  // without a session.
  //
  // `cutsceneAt` is the host's OWN session clock at the instant Start was
  // pressed. It is the single number EV.CUTSCENE carries and the only thing that
  // makes four tabs share one timeline.
  let phase = 'lobby';
  // CREATIVE MODE is a property of the ROOM, not of a player: the host writes it
  // by performing START, a client is written from the host's WELCOME. Everyone in
  // a room plays the same mode or the shared economy means nothing.
  let creative = false;
  let cutsceneAt = null;
  // The host's view of who has said they are ready and what colour they chose.
  // Slot 0 is the host's own, kept here for the same reason: one table, not two.
  const readyBy = new Map();     // slot -> bool
  const colorBy = new Map();     // slot -> '#rrggbb'
  // What main.js hooks to actually roll the cutscene. Registered rather than
  // captured, because src/cutscene.js is built after this layer.
  let onCutscene = null;
  let onPhase = null;

  function isClient() { return !!client; }
  function isHost() { return !!host; }

  // --- inventory ---------------------------------------------------------------
  // Slot 0 on a host is the local hotbar; there is deliberately no second copy
  // of it, because two copies of an inventory is how an item ends up in two
  // hands at once.

  function invOf(slot) {
    if (slot === 0) return null;
    let r = remote.get(slot);
    if (!r) { r = newRemote(slot); remote.set(slot, r); }
    return r.hotbar;
  }

  function invCount(slot, id) {
    if (slot === 0) return hotbar.countOf(id);
    const m = invOf(slot);
    return m.get(id) || 0;
  }

  function invAdd(slot, item, n) {
    if (slot === 0) { hotbar.add(item, n); return true; }
    const m = invOf(slot);
    m.set(item.id, (m.get(item.id) || 0) + n);
    return true;
  }

  function invTake(slot, id, n) {
    if (slot === 0) return hotbar.take(id, n);
    const m = invOf(slot);
    const have = m.get(id) || 0;
    if (have < n) return false;
    if (have === n) m.delete(id); else m.set(id, have - n);
    return true;
  }

  // Take everything matching `pred` out of every inventory in the room -- the
  // local hotbar and every remote player's map. Used by prestige, which destroys
  // rows wholesale rather than one item at a time: an unplaced press sitting in
  // a hotbar slot would otherwise survive a wipe that took every placed one.
  function clearInventories(pred) {
    if (typeof pred !== 'function') return 0;
    let n = 0;
    const mine = hotbar.state().slots;
    for (let i = 0; i < mine.length; i++) {
      const s = mine[i];
      if (!s || !s.id || !pred(s.id)) continue;
      if (hotbar.take(s.id, s.count)) n += s.count;
    }
    remote.forEach((r) => {
      Array.from(r.hotbar.keys()).forEach((id) => {
        if (!pred(id)) return;
        n += r.hotbar.get(id) || 0;
        r.hotbar.delete(id);
      });
    });
    return n;
  }

  function newRemote(slot) {
    return {
      slot,
      nick: 'player ' + slot,
      capsule: null,
      input: { fwd: 0, right: 0, jump: false, sprint: false, yaw: 0, pitch: 0 },
      pose: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 },
      hotbar: new Map(),
      selected: -1,
      lastInputAt: 0,
      // --- the input queue this player's capsule is stepped from ---------------
      // `queue` holds inputs the host has been told about and has not finished
      // spending, oldest first, each carrying how much of its slice is left.
      // `lastSeq` is the newest sequence number ever applied, compared with
      // wraparound-safe arithmetic. `coast` is how long the capsule may keep
      // walking on the last input when the queue has run dry.
      queue: [],
      lastSeq: null,
      last: null,
      coast: 0,
      // Substeps already walked on a guess, owed back to the inputs that were
      // only late. Bounded by inputCoastMs, because a capsule that has stopped
      // coasting is standing still and standing still borrows nothing.
      debt: 0,
      appliedInputs: 0,
      duplicateInputs: 0,
      trimmedInputs: 0,
      starvedSubsteps: 0,
      coastSubsteps: 0,
      inputSeconds: 0,
    };
  }

  // How much simulated time one input frame accounts for. A client sends at
  // config.net.clientStateHz and each packet's records are one interval apart,
  // so this is the SAME number on both ends and neither has to be told it.
  function inputSlice() {
    const hz = Math.max(1, Number(N.clientStateHz) || 30);
    return 1 / hz;
  }

  // Asked once per fixed substep by that player's capsule: which input covers
  // THIS 1/60 s of simulation?
  //
  // This is the whole fix for the class of bug where the host's copy of a
  // walking player does not travel the same distance the client's copy did.
  // The rule is that a remote capsule advances by the time its inputs account
  // for -- not once per packet (which ties travel to packet rate) and not
  // unconditionally every substep (which ties it to how long the host has been
  // running, and lets a silent client's capsule walk away on its own).
  //
  // Fixed substeps rather than one variable-dt integration, deliberately: the
  // kinematic character controller only commits a pose inside world.step(), and
  // world.js steps every player at config.loop.fixedDt. Integrating a remote
  // player over a variable dt would put them through different collision
  // resolution from the local player standing next to them.
  function banked(r) {
    let s = 0;
    for (let i = 0; i < r.queue.length; i++) s += r.queue[i].left;
    return s;
  }

  function nextInput(r, dt) {
    while (r.queue.length && r.queue[0].left <= 0) {
      r.last = r.queue[0].inp;
      r.queue.shift();
    }
    const head = r.queue[0];
    const catchUp = Math.max(0, Number(N.inputCatchUpFactor) || 0);
    if (head) {
      let spend = dt;
      // FIRST, pay off whatever was walked on a guess while the queue was dry.
      // Without this the coast below is free distance: the capsule walks a
      // substep on the last known input, and then the input that was merely
      // LATE arrives and walks that same substep again. Measured before this
      // line existed: the host travelled 0.45% further than the client over a
      // straight walk, which the reconciler read as the host being ahead of the
      // path -- 12 soft corrections on a clean link where there should be none.
      // Coasted time is a debt against arriving input, not a gift.
      if (r.debt > 0) {
        const pay = Math.min(r.debt, dt * (1 + catchUp));
        spend += pay;
        r.debt -= pay;
      } else if (banked(r) > inputSlice()) {
        // Spend a little faster than we simulate while there is more than one
        // input in reserve. Two clocks are never the same speed, and without
        // this a client whose timer runs 1% fast pins the bank against its
        // ceiling for the whole session -- and the bank IS the host's replay
        // lag. It is time that is discarded, never movement that is added:
        // this function is asked once per substep and a capsule moves one
        // substep per substep whatever it answers, so nobody can walk faster
        // by sending more often.
        spend = dt * (1 + catchUp);
      }
      let need = spend;
      while (need > 0 && r.queue.length) {
        const h = r.queue[0];
        const take = Math.min(need, h.left);
        h.left -= take;
        need -= take;
        if (h.left > 1e-9) break;
        r.last = h.inp;
        r.queue.shift();
      }
      r.last = head.inp;
      r.coast = Math.max(0, Number(N.inputCoastMs) || 0) / 1000;
      r.inputSeconds += dt;
      return head.inp;
    }
    // Nothing left to spend. An input is a HELD state, not an event, so the
    // honest guess after one late packet is "still the same" -- but only for a
    // bounded while. Past it the host genuinely does not know what this player
    // is doing and standing still is the true answer. This bound is what turns
    // "a client that tabs away walks into the pit" into "a client that tabs
    // away stops".
    if (r.coast > 0 && r.last) {
      r.coast -= dt;
      r.debt += dt;
      r.coastSubsteps++;
      return r.last;
    }
    // Standing still walks nothing, so it owes nothing: the debt stops growing
    // here rather than turning a long outage into a long stretch of frozen
    // catch-up when the player comes back.
    r.starvedSubsteps++;
    return null;
  }

  function attachCapsule(r) {
    if (r.capsule) return r.capsule;
    r.capsule = world.addPlayer(config.player.spawn);
    if (typeof r.capsule.setInputSource === 'function') {
      r.capsule.setInputSource((dt) => nextInput(r, dt));
    }
    return r.capsule;
  }

  // --- the actions -------------------------------------------------------------
  // ONE implementation each. The host runs them for itself and for every
  // client; a client runs none of them.

  function rowFor(id) {
    const row = byId(id);
    return row && row.collider ? row : null;
  }

  function aimOf(slot, req) {
    if (req && req.o && req.d) {
      return { origin: { x: req.o[0], y: req.o[1], z: req.o[2] },
        dir: { x: req.d[0], y: req.d[1], z: req.d[2] } };
    }
    if (slot === 0) return view.aim();
    const r = remote.get(slot);
    if (!r) return null;
    const p = r.pose;
    const cp = Math.cos(p.pitch);
    return {
      origin: { x: p.x, y: p.y + config.player.eyeHeight - config.player.height / 2, z: p.z },
      dir: { x: -Math.sin(p.yaw) * cp, y: Math.sin(p.pitch), z: -Math.cos(p.yaw) * cp },
    };
  }

  // Where the acting player is standing. Every request is range checked against
  // it, so a malformed or stale aim cannot place a wall on the other side of the
  // plate.
  function bodyOf(slot) {
    if (slot === 0) return player.position();
    const r = remote.get(slot);
    return r ? { x: r.pose.x, y: r.pose.y, z: r.pose.z } : null;
  }

  // The range check exists because a REMOTE aim arrives in a message and a
  // message can be stale by a round trip or simply wrong. The local player's
  // aim is not a message: it came out of view.aim() one line earlier and has
  // already been through the hologram, the pick-up raycast or the wheel test,
  // every one of which is a stricter check than a distance. Applying a second,
  // looser one to slot 0 changed nothing about what a player could do and did
  // break head-down tests that drive an action without walking there first.
  function inReach(slot, point, range) {
    if (slot === 0) return true;
    const p = bodyOf(slot);
    if (!p || !point) return false;
    return Math.hypot(p.x - point.x, p.y - point.y, p.z - point.z) <= range;
  }

  // --- the hold, per player ------------------------------------------------------
  // The controller for slot 0 is the one that has always existed. Every other
  // slot gets its own, created on first grab and destroyed when that player
  // leaves, and all of them share one claim registry inside the world so two
  // players can never spring the same body.

  // The aim a remote player's hold FOLLOWS. It is re-read every substep from
  // that player's live pose -- the same pose their 16 B input frame updates 20
  // times a second -- so a teammate who looks around while carrying a duck
  // carries it around with them. Their own capsule is excluded from the grab
  // ray, or the first thing anybody would grab is themselves.
  function holdAim(slot) {
    return () => {
      const a = aimOf(slot, null);
      if (!a) return null;
      const r = remote.get(slot);
      let body = null;
      const raw = world._raw;
      if (raw && r && r.capsule && r.capsule.handle !== undefined) {
        body = raw.getRigidBody(r.capsule.handle) || null;
      }
      return { origin: a.origin, dir: a.dir, body };
    };
  }

  function holdOf(slot) {
    if (slot === 0) return world.hold;
    if (typeof world.holdFor !== 'function') return null;
    return world.holdFor(slot, holdAim(slot));
  }

  // Read-only: never creates a controller, so asking "is slot 2 holding
  // something" for a player who has never grabbed anything does not quietly
  // allocate one per roster build.
  function heldDuckOf(slot) {
    const h = slot === 0
      ? world.hold
      : (typeof world.holdIfAny === 'function' ? world.holdIfAny(slot) : null);
    if (!h || !h.isHolding()) return null;
    const d = h.heldDuck();
    return typeof d === 'number' ? d : null;
  }

  // What the roster carries. A client's own hold is whatever the host last said
  // it was: there is no second copy of this fact anywhere.
  function holdRecordOf(slot) {
    if (client) {
      const row = roster.find((r) => r && r.slot === slot);
      return (row && row.hold) || null;
    }
    const d = heldDuckOf(slot);
    return d === null ? null : { d };
  }

  // Is this player USING their tool right now, and in which mode. The host knows
  // (it runs every player's tool); a client is told, like everything else. This
  // is the one fact the avatar layer needed that the roster did not carry --
  // without it a remote player's arm cannot swing with their broom.
  function usingModeOf(slot) {
    if (client) {
      const row = roster.find((r) => r && r.slot === slot);
      return (row && row.using) || null;
    }
    const t = slot === 0 ? (deps.tools || null) : (remoteTools.get(slot) || null);
    if (!t || typeof t.state !== 'function') return null;
    const st = t.state();
    return st && st.pressed && st.mode ? st.mode : null;
  }

  // The host's own belief about where that player's eye is, which is what the
  // ray is cast from. A client's supplied origin is evidence, never input.
  function eyeOf(slot) {
    const a = aimOf(slot, null);
    return a ? a.origin : null;
  }

  const ACTIONS = {
    // Ask to pick something up. The client sends where it is looking FROM and
    // ALONG; the host casts the ray, decides what was hit, and arbitrates the
    // claim. Nothing about the target comes from the message.
    [REQ.GRAB](slot, req) {
      const h = holdOf(slot);
      if (!h) return { ok: false, reason: 'no hold controller' };
      if (h.isHolding()) return { ok: false, reason: 'already holding something' };
      const eye = eyeOf(slot);
      if (!eye) return { ok: false, reason: 'no aim' };
      const a = aimOf(slot, req);
      if (!a) return { ok: false, reason: 'no aim' };
      // The one thing checked about the supplied origin: that it is roughly
      // where the host thinks this player's head is. Past that the request is
      // either a lie or a message old enough to be one.
      if (slot !== 0 && req && req.o) {
        const d = Math.hypot(a.origin.x - eye.x, a.origin.y - eye.y, a.origin.z - eye.z);
        if (d > config.net.aimOriginSlack) return { ok: false, reason: 'out of reach' };
      }
      // Cast from the HOST's eye, along the client's direction.
      if (!h.tryGrab(eye, a.dir)) {
        return { ok: false, reason: h.lastRefusal ? h.lastRefusal() : 'nothing to grab' };
      }
      return { ok: true, held: h.heldDuck(), slot };
    },

    [REQ.DROP](slot) {
      const h = holdOf(slot);
      if (!h || !h.isHolding()) return { ok: false, reason: 'not holding anything' };
      const d = h.heldDuck();
      h.release();
      return { ok: true, held: d, slot };
    },

    // The pit shot. The direction is the host's own copy of where that player is
    // looking, so there is no vector in the message to be stale or forged: the
    // controller throws along the same aim it has been springing towards.
    [REQ.HURL](slot) {
      const h = holdOf(slot);
      if (!h || !h.isHolding()) return { ok: false, reason: 'not holding anything' };
      const d = h.heldDuck();
      if (!h.throw()) return { ok: false, reason: 'could not throw it' };
      return { ok: true, held: d, slot };
    },

    [REQ.HOLD_DIST](slot, req) {
      const h = holdOf(slot);
      if (!h) return { ok: false, reason: 'no hold controller' };
      const n = Number(req && req.n);
      if (!isFinite(n) || n === 0) return { ok: false, reason: 'no scroll' };
      return { ok: true, distance: h.scrollDistance(n) };
    },

    [REQ.BUY](slot, req) {
      const row = byId(req.item);
      if (!row) return { ok: false, reason: 'no such item' };
      const res = shop.buy(row.id);
      if (!res || res.ok === false) {
        return { ok: false, reason: (res && res.reason) || 'refused' };
      }
      return { ok: true };
    },

    // Buy a fresh shelf. The money and the dice both live behind
    // shop.rerollStock(), so this is the same two lines as BUY and for the same
    // reason: the host rolls, everyone is told, and the asker learns the result
    // from the broadcast like everybody else.
    [REQ.REROLL]() {
      const res = shop.rerollStock ? shop.rerollStock() : null;
      if (!res || res.ok === false) {
        return { ok: false, reason: (res && res.reason) || 'refused' };
      }
      return { ok: true, price: res.price, period: res.period };
    },

    // Prestige. The team shares one economy, so this is a TEAM action: it wipes
    // every machine on the plate and every player's money at once and hands the
    // whole room the new multiplier. Who may pull it: THE HOST, and only the
    // host. A shared economy means one player's click costs everybody else their
    // factory, and there is no vote in this protocol to hold; the host is the
    // one authority every player already accepted by joining their room. Clients
    // see the same quote in the same panel, with the reason their button is off.
    // Single player IS slot 0 on a host that has no clients, so this reads
    // exactly as it always did with nobody else in the room.
    [REQ.PRESTIGE](slot) {
      if (slot !== 0) return { ok: false, reason: 'Only the host can call a prestige' };
      if (!deps.prestige) return { ok: false, reason: 'prestige is not wired up' };
      const res = deps.prestige.take();
      if (!res || res.ok === false) return { ok: false, reason: (res && res.reason) || 'refused' };
      return { ok: true, ...res };
    },

    [REQ.PLACE](slot, req) {
      const item = rowFor(req.item);
      if (!item || !isBuildable(item)) return { ok: false, reason: 'not placeable' };
      if (invCount(slot, item.id) <= 0) return { ok: false, reason: 'you do not have one' };
      const a = aimOf(slot, req);
      if (!a) return { ok: false, reason: 'no aim' };
      const rot = { yaw: Number(req.yaw) || 0, free: !!req.free };
      const res = resolvePlacement(item, a.origin, a.dir, rot, worldQuery);
      if (!res.valid) return { ok: false, reason: res.reason || 'invalid spot' };
      if (!inReach(slot, res.position, config.build.maxDistance + config.net.reachSlack)) {
        return { ok: false, reason: 'out of reach' };
      }
      const rec = placed.place(item, res);
      if (!rec) return { ok: false, reason: 'no room for another one' };
      invTake(slot, item.id, 1);
      // No consumeProp here. It used to exist because a purchase both dropped a
      // prop AND handed a copy to the hotbar, so placing the hotbar copy had to
      // delete the delivery nobody had collected. Purchases are now delivered
      // ONLY through the chute, so the hotbar copy IS the collected prop --
      // deleting another one would destroy a second wall lying on the floor,
      // possibly somebody else's.
      return { ok: true, record: rec, placement: res };
    },

    [REQ.DEMOLISH](slot, req) {
      const rec = placed.objects.find((o) => o.key === req.key);
      if (!rec) return { ok: false, reason: 'nothing there' };
      if (!inReach(slot, rec.position, config.build.demolishRange + config.net.reachSlack)) {
        return { ok: false, reason: 'out of reach' };
      }
      const amount = shop.refund(rec.id);
      placed.remove(rec);
      return { ok: true, id: rec.id, name: rec.name, refund: amount };
    },

    [REQ.PICKUP](slot, req) {
      const prop = placed.propByKey(req.key);
      if (!prop) return { ok: false, reason: 'nothing there' };
      const row = byId(prop.id);
      // Two kinds of thing can be collected off the floor and they end up in
      // different places: a carryable goes into your HANDS, a building goes into
      // the hotbar as something to place. Both are the same verb to the player
      // ("press E to take the thing the chute just dropped"), and since every
      // purchase now arrives through the chute, refusing buildings here would
      // make a bought wall permanently unreachable.
      if (!isHandCarryable(row) && !isBuildable(row)) {
        return { ok: false, reason: 'you cannot carry that' };
      }
      const t = prop.body.translation();
      if (!inReach(slot, t, config.hand.pickupRange + config.net.reachSlack)) {
        return { ok: false, reason: 'out of reach' };
      }
      // A crate's virtual contents live on its prop key; putting that key in a
      // hotbar slot would take the ducks inside it with no message.
      const c = containers.info(prop.key);
      if (c && c.total > 0) {
        return { ok: false, reason: 'Empty the ' + row.name + ' first (' + c.total + ' inside)' };
      }
      invAdd(slot, row, 1);
      placed.despawnProp(prop);
      return { ok: true, id: row.id, name: row.name, key: prop.key };
    },

    [REQ.THROW](slot, req) {
      const item = rowFor(req.item);
      if (!item || !isHandCarryable(item)) return { ok: false, reason: 'not carryable' };
      if (invCount(slot, item.id) <= 0) return { ok: false, reason: 'you do not have one' };
      const a = aimOf(slot, req);
      if (!a) return { ok: false, reason: 'no aim' };
      const h = config.hand;
      const half = item.collider.half;
      const pos = {
        x: a.origin.x + a.dir.x * h.throwDistance,
        y: Math.max(half[1] + h.minSpawnY, a.origin.y + a.dir.y * h.throwDistance),
        z: a.origin.z + a.dir.z * h.throwDistance,
      };
      const pv = (slot === 0 && player.velocity) ? player.velocity() : ZERO;
      // Past the prop cap a throw is REFUSED and the item stays in your hand.
      // The alternative -- dropping it and deleting the oldest prop on the floor
      // to make room -- destroys something somebody else may be about to pick up.
      if (typeof placed.atCap === 'function' && placed.atCap()) {
        return { ok: false, reason: 'Too much on the floor already - clear some of it first' };
      }
      const rec = placed.dropProp(item, pos, {
        x: pv.x + a.dir.x * h.throwSpeed,
        y: pv.y + a.dir.y * h.throwSpeed + h.throwSpeed * h.throwLift,
        z: pv.z + a.dir.z * h.throwSpeed,
      });
      if (!rec) return { ok: false, reason: 'cannot drop that here' };
      invTake(slot, item.id, 1);
      return { ok: true, id: item.id, name: item.name, key: rec.key, position: pos };
    },

    // The wheel, HELD. The down edge starts a hold, the up edge ends it, and
    // between them this slot contributes one holder's worth of charge per second
    // to whatever wheel the HOST decided the press was aimed at. Nothing about
    // WHICH workbench comes from the message: an id in a message could name a
    // bench on the far side of the plate, so the aim is evidence and the wheel
    // test is the host's own -- the same rule GRAB follows.
    //
    // Reach is checked here AND again every tick in crankHolders(), because a
    // hold is not an instant: a player who walks away mid-fill has to stop
    // contributing without needing a message to say so.
    [REQ.CRANK](slot, req) {
      const down = !!(req && req.down);
      if (!down) {
        const had = crankHold.has(slot);
        crankHold.delete(slot);
        return { ok: true, down: false, released: had, slot };
      }
      const eye = eyeOf(slot);
      if (!eye) return { ok: false, reason: 'no aim' };
      const a = aimOf(slot, req);
      if (!a) return { ok: false, reason: 'no aim' };
      // The one thing checked about a remote origin: that it is roughly where
      // the host thinks that head is. Past that it is a lie or a stale message.
      if (slot !== 0 && req && req.o) {
        const d = Math.hypot(a.origin.x - eye.x, a.origin.y - eye.y, a.origin.z - eye.z);
        if (d > config.net.aimOriginSlack) return { ok: false, reason: 'out of reach' };
      }
      if (typeof deps.wheelAimFrom !== 'function') return { ok: false, reason: 'no wheel test' };
      // Cast from the HOST's eye, along the asker's direction.
      const hit = deps.wheelAimFrom(eye, a.dir);
      if (!hit) return { ok: false, reason: 'not aimed at a workbench wheel' };
      const key = hit.rec ? hit.rec.key : 0;
      const wheel = hit.rec ? placed.wheelCenter(hit.rec) : props.wheelCenter();
      if (!inReach(slot, wheel, config.machine.useRange + config.net.reachSlack)) {
        return { ok: false, reason: 'too far from the workbench' };
      }
      crankHold.set(slot, key);
      return { ok: true, down: true, key, slot };
    },

    // An equipped tool's button. The host equips from what that player has
    // SELECTED -- its own record, not a claim in the message -- so naming a
    // broom you do not own buys you nothing.
    [REQ.TOOL](slot, req) {
      const t = toolsOf(slot);
      if (!t) return { ok: false, reason: 'no tool layer' };
      const down = !!(req && req.down);
      const row = selectedRowOf(slot);
      if (!row || !isToolRow(row)) {
        // Nothing tool-like in hand: make sure whatever was equipped stops,
        // rather than leaving a broom sweeping because a message went missing.
        t.unequip();
        return { ok: false, reason: 'no tool equipped' };
      }
      t.equip(row);
      const ok = down ? t.grabDown() : t.grabUp();
      return { ok: !!ok, down, tool: row.id };
    },

    // Pour out a container. The key may be named, but it is checked against
    // what the host believes: the asker must be holding that prop or be within
    // arm's reach of it, so naming a crate across the plate does nothing.
    [REQ.POUR](slot, req) {
      if (!containers || typeof containers.pour !== 'function') {
        return { ok: false, reason: 'no containers' };
      }
      const key = Math.round(Number(req && req.key)) || 0;
      const prop = key ? placed.propByKey(key) : null;
      if (!prop) return { ok: false, reason: 'nothing to pour' };
      const at = prop.body ? prop.body.translation() : prop.position;
      if (!inReach(slot, at, config.hand.pickupRange + config.net.reachSlack)) {
        return { ok: false, reason: 'too far away' };
      }
      const n = containers.pour(key);
      if (n === null) return { ok: false, reason: 'not a container' };
      if (!n) return { ok: false, reason: 'already empty' };
      return { ok: true, key, ducks: n };
    },

    // A roll of the gambling box. Money out of the shared balance and a prize
    // out of the HOST's dice -- which is the whole reason this is a request and
    // not a local click. A client that rolled its own would win something
    // nobody else can see, and the ducks or the machine it produced would exist
    // in exactly one world.
    //
    // Nothing about WHICH box comes from the message, exactly as with REQ.CRANK:
    // the aim travels as evidence, the host casts its own test from where it
    // believes that player's eye is, and the result is range checked against
    // where it believes that player is standing.
    [REQ_GAMBLE](slot, req) {
      if (typeof deps.gambleAimFrom !== 'function' || typeof deps.gambleStart !== 'function') {
        return { ok: false, reason: 'no gambling boxes' };
      }
      const eye = eyeOf(slot);
      if (!eye) return { ok: false, reason: 'no aim' };
      const a = aimOf(slot, req);
      if (!a) return { ok: false, reason: 'no aim' };
      if (slot !== 0 && req && req.o) {
        const d = Math.hypot(a.origin.x - eye.x, a.origin.y - eye.y, a.origin.z - eye.z);
        if (d > config.net.aimOriginSlack) return { ok: false, reason: 'out of reach' };
      }
      const hit = deps.gambleAimFrom(eye, a.dir);
      if (!hit || !hit.rec) return { ok: false, reason: 'not aimed at a gambling box' };
      if (!inReach(slot, hit.rec.position, config.gamble.useRange + config.net.reachSlack)) {
        return { ok: false, reason: 'too far from the box' };
      }
      const res = deps.gambleStart(hit.rec.key);
      if (!res || !res.ok) return { ok: false, reason: (res && res.reason) || 'refused' };
      // Tell the room. The prize does NOT ride in this message and must not: it
      // reaches everyone through the channels that already carry world changes
      // (the chute's prop drop, the duck spawn stream, the money diff), so there
      // is no second copy of a reward for the two ends to disagree about. What a
      // client cannot derive is that a roll STARTED and when -- that is an
      // instant, exactly like EV.CUTSCENE, and the instant is the message.
      if (host && typeof host.sendEvent === 'function') {
        host.sendEvent({ e: EV_GAMBLE, key: hit.rec.key, slot });
      }
      return { ok: true, key: hit.rec.key, cost: res.cost, seconds: res.seconds, slot };
    },

    [REQ.SELECT](slot, req) {
      const i = Math.round(Number(req.i));
      if (slot === 0) { hotbar.select(i); return { ok: true, slot: i }; }
      const r = remote.get(slot);
      if (r) r.selected = i;
      return { ok: true, slot: i };
    },

    // --- the waiting room -------------------------------------------------------

    // "I am set." Carries the colour too, because the lobby has to draw the
    // player in the colour they picked and the roster is the one place every tab
    // already reads a player's facts from. Setting it is idempotent and legal at
    // any time; nothing about being ready changes the world.
    [REQ.READY](slot, req) {
      const on = !!(req && req.ready);
      readyBy.set(slot, on);
      if (req && typeof req.color === 'string' && req.color) colorBy.set(slot, req.color);
      // The roster is diffed as a whole, so the change reaches every tab on the
      // next tick without a message of its own.
      return { ok: true, slot, ready: on };
    },

    // Start the session for the WHOLE ROOM. Host only, refused for anyone else
    // with that reason -- the same rule PRESTIGE follows, for the same argument:
    // everyone can see the lobby, one person opens the door.
    //
    // The cutscene's start time is the host's session clock at this instant, and
    // it is recorded BEFORE anything is broadcast so the number the host runs on
    // and the number it sends are provably the same one.
    [REQ.START](slot) {
      if (slot !== 0) return { ok: false, reason: 'Only the host can start the session' };
      if (phase === 'playing') return { ok: false, reason: 'already started' };
      phase = 'playing';
      cutsceneAt = state.clock();
      if (host && typeof host.sendEvent === 'function') {
        host.sendEvent({ e: EV.CUTSCENE, at: cutsceneAt });
      }
      if (typeof onPhase === 'function') onPhase(phase, 'start');
      // The host runs the same timeline from the same number, entered at zero.
      if (typeof onCutscene === 'function') onCutscene(0, { role: 'host', at: cutsceneAt });
      return { ok: true, at: cutsceneAt };
    },
  };

  // The single entry point. Nothing in main.js calls an ACTION directly.
  function perform(slot, req) {
    const fn = ACTIONS[req && req.a];
    if (!fn) return { ok: false, reason: 'unknown request' };
    const before = actingSlot;
    actingSlot = slot;
    try {
      const res = fn(slot, req);
      if (res && res.ok) counters.performed++; else counters.refused++;
      return res;
    } finally {
      actingSlot = before;
    }
  }

  // What main.js calls when the player does something.
  function act(req) {
    counters.acted++;
    if (client) {
      counters.requested++;
      const id = client.request(req.a, req);
      // Nothing local happens. Deliberately. The world arrives in the host's
      // next broadcast, at the same instant it arrives for everyone else.
      return { pending: true, id };
    }
    return perform(localSlot, req);
  }

  // --- the roster ---------------------------------------------------------------
  // Small, diffed as a whole, and the answer to "who is holding what". The host
  // builds it; a client only reads the one the host sent.

  function hotbarList(slot) {
    if (slot === 0) {
      const s = hotbar.state();
      return s.slots.map((x) => (x && x.count > 0 ? { id: x.id, n: x.count } : null));
    }
    const out = [];
    invOf(slot).forEach((n, id) => { if (n > 0) out.push({ id, n }); });
    return out;
  }

  function buildRoster() {
    const list = [];
    const p = player.position();
    const look = player.look ? player.look() : { yaw: 0, pitch: 0 };
    list.push({
      slot: 0,
      nick: session ? session.nick : 'host',
      host: true,
      p: [p.x, p.y, p.z],
      yaw: look.yaw,
      pitch: look.pitch,
      hotbar: hotbarList(0),
      sel: hotbar.selectedIndex(),
      // What is actually IN THIS PLAYER'S HANDS, which is not the same claim as
      // "somewhere in their hotbar" and is the thing an avatar has to draw.
      hand: currentHandId(0),
      // And what they have picked UP off the floor, which is a different fact
      // again: a duck in somebody's grip is a world body whose pose already
      // flows down the state stream, but nothing in that stream says WHOSE grip
      // it is in. Without this a player joining mid-carry sees a duck floating
      // in front of nobody.
      hold: holdRecordOf(0),
      using: usingModeOf(0),
      // The waiting room's two facts. They ride in the roster rather than in a
      // message of their own because the roster is already diffed and already
      // read by every tab -- a second feed for "is this player ready" is a
      // second thing that can disagree with the first.
      ready: !!readyBy.get(0),
      color: colorBy.get(0) || null,
    });
    remote.forEach((r, slot) => {
      list.push({
        slot,
        nick: r.nick,
        host: false,
        ready: !!readyBy.get(slot),
        color: colorBy.get(slot) || r.color || null,
        p: [r.pose.x, r.pose.y, r.pose.z],
        yaw: r.pose.yaw,
        pitch: r.pose.pitch,
        hotbar: hotbarList(slot),
        sel: r.selected,
        hand: currentHandId(slot),
        hold: holdRecordOf(slot),
        using: usingModeOf(slot),
      });
    });
    return list;
  }

  function currentHandId(slot) {
    if (slot === 0) {
      const c = hotbar.current();
      return c && isHandCarryable(c) ? c.id : null;
    }
    const r = remote.get(slot);
    if (!r || r.selected < 0) return null;
    const list = hotbarList(slot);
    const item = list[r.selected];
    if (!item) return null;
    const row = byId(item.id);
    return row && isHandCarryable(row) ? row.id : null;
  }

  // The row a player currently has selected, whatever kind it is. currentHandId
  // answers a narrower question (what is DRAWN in their hands) and refuses
  // anything that is not hand-carryable, so a tool lookup cannot reuse it.
  function selectedRowOf(slot) {
    if (slot === 0) return hotbar.current() || null;
    const r = remote.get(slot);
    if (!r || r.selected < 0) return null;
    const item = hotbarList(slot)[r.selected];
    return item ? byId(item.id) || null : null;
  }

  // The tool module acting for this slot, created the first time that player
  // uses one. Its aim is read from the host's own belief about where they are
  // looking -- never from the message -- which is the same rule GRAB follows.
  function toolsOf(slot) {
    if (slot === 0) return deps.tools || null;
    let t = remoteTools.get(slot);
    if (!t) {
      if (typeof deps.makeTools !== 'function') return null;
      t = deps.makeTools(() => aimOf(slot, null));
      if (!t) return null;
      remoteTools.set(slot, t);
      // Stepped inside the substep loop like every other impulse source; a
      // broom that pushed once per frame reads as mush next to one that pushes
      // once per substep.
      if (world.onFixedUpdate) t._unhook = world.onFixedUpdate((h) => t._fixedUpdate(h));
    }
    return t;
  }

  // How many players are leaning on each wheel RIGHT NOW, keyed the same way
  // crankStates() is: 0 is the starter bench, anything else is a placement key.
  // main.js asks once per frame and multiplies the fill rate by it, which is the
  // whole of the co-op rule -- two holders, twice the speed, no special case.
  //
  // Reach is re-tested here rather than trusted from the down edge: a hold lasts
  // as long as the button does, and walking away has to stop it. Out of reach
  // does not CANCEL the hold (the button is still down and walking back should
  // just resume) -- it only stops contributing.
  function crankHolders() {
    const out = new Map();
    if (client) return out;
    // Auto-Crankers first. They are holders like any other -- a placed machine
    // with its hand on the wheel -- so they are counted HERE rather than in a
    // parallel system, which is what makes two bots stack exactly like two
    // players and makes every crank rule apply to them without being restated.
    if (typeof deps.botHolders === 'function') {
      const bots = deps.botHolders();
      if (bots && typeof bots.forEach === 'function') {
        bots.forEach((n, key) => { if (n > 0) out.set(key | 0, (out.get(key | 0) || 0) + n); });
      }
    }
    const range = config.machine.useRange + config.net.reachSlack;
    Array.from(crankHold.keys()).forEach((slot) => {
      const key = crankHold.get(slot);
      const rec = key ? placed.objects.find((o) => o.key === key) || null : null;
      // The bench was demolished under the holder's hands.
      if (key && !rec) { crankHold.delete(slot); return; }
      const wheel = rec ? placed.wheelCenter(rec) : props.wheelCenter();
      if (!inReach(slot, wheel, range)) return;
      out.set(key, (out.get(key) || 0) + 1);
    });
    return out;
  }

  function dropRemoteTools(slot) {
    crankHold.delete(slot);
    const t = remoteTools.get(slot);
    if (!t) return;
    try { t.unequip(); } catch (_) { /* leaving must never throw */ }
    if (typeof t._unhook === 'function') t._unhook();
    remoteTools.delete(slot);
  }

  function setRoster(list) {
    roster = list || [];
    for (let i = 0; i < roster.length; i++) {
      const r = roster[i];
      if (r.slot === localSlot) {
        // A client's own hotbar is display only: the host owns the inventory
        // and this is what it says is in it.
        if (hotbar.setFromNet) hotbar.setFromNet(r.hotbar, r.sel, byId);
        continue;
      }
      let e = remote.get(r.slot);
      if (!e) { e = newRemote(r.slot); remote.set(r.slot, e); }
      e.nick = r.nick;
      e.selected = r.sel;
      e.handId = r.hand;
      // Who is carrying which duck. On a client this is the ONLY source of that
      // fact -- the duck's pose arrives in the state stream like any other body
      // and says nothing about whose hands it is in -- and it arrives in the
      // join snapshot too, so a player who connects mid-carry is told on frame
      // one rather than watching a duck hover in front of nobody.
      e.hold = r.hold || null;
      e.pose.pitch = r.pitch;
      e.hotbarList = r.hotbar;
      if (!isHost()) {
        // Poses come from the 20 Hz stream; the roster's copy is only a
        // fallback for a player who has not moved since it was sent.
        if (!e.streamed) { e.pose.x = r.p[0]; e.pose.y = r.p[1]; e.pose.z = r.p[2]; }
      }
    }
    // Anyone the roster no longer names has left.
    const live = new Set(roster.map((r) => r.slot));
    remote.forEach((e, slot) => { if (!live.has(slot)) { dropRemoteTools(slot); remote.delete(slot); } });
    if (typeof onRoster === 'function') onRoster(roster);
  }

  // --- the adapter handed to host.js / client.js ---------------------------------

  const adapter = {
    ducks: world.ducks,
    placedObjects: () => placed.objects,
    // Every crank's progress, for the host's reconciler to diff. Lives on the
    // adapter rather than being read off `deps` by host.js, because host.js is
    // only ever handed this object.
    crankStates: () => (deps.crankStates ? deps.crankStates() : []),
    placedProps: () => placed.props,
    money: () => world.economy.money(),
    // The lifetime counter, which prestige is a function of. It rides beside the
    // balance in the same reconciled message.
    earned: () => world.economy.totalEarned(),
    clock: () => state.clock(),
    serialize: () => state.serialize(),
    load: (snap) => state.load(snap),
    roster: buildRoster,
    setRoster,
    perform,
    // Stepping the world when rAF has stalled -- a hidden host tab. It MUST
    // also stamp lastFrameAt, because that stamp is what pumpIfStale measures
    // the gap from. Without it the gap only ever grew: `dt` pinned at
    // config.loop.maxFrameDt (0.25 s) and the host tick fires every
    // net.hostTickMs (25 ms), so a backgrounded host ran its world at 40 x 0.25
    // = TEN TIMES real time. Everything downstream of that -- the clock it
    // stamps into every frame, producer timers, the poses it broadcasts --
    // raced away from the client, which felt it as being dragged backwards
    // while walking. rAF freezing in a hidden tab is the trap this project has
    // now hit four times; this is the same one wearing a different hat.
    // The stamp advances by the time actually SIMULATED, never to now(). Both
    // wrong ways were measured on a hidden host tab, 60 ticks each:
    //   no stamp at all -> gap grows forever, dt pins at maxFrameDt, and at one
    //     tick per hostTickMs the world runs about ten times real time;
    //   stamp = now()   -> the wall time the step itself burned is thrown away,
    //     and the world ran at 0.60 x real time.
    // Adding dt keeps the remainder pumpIfStale has not simulated yet, so the
    // two agree by construction instead of by luck. The clamp is the anti-spiral
    // guard: if the machine cannot keep up, the debt is dropped rather than
    // chased, because a host that never catches up would tick faster and faster
    // until it stopped rendering entirely.
    pump(dt) {
      // beginFrame() runs INSIDE loop.step and stamps the clock to now(). During
      // a pump that is exactly wrong -- it hands back the wall time the step
      // itself burned and reports the gap as already closed, so the chunk loop
      // in host.pumpIfStale stopped after one helping. Measured: 83 ms simulated
      // per 120 ms waited, 0.6x real time, three runs in a row. The flag makes
      // pump the only writer of the stamp for the duration of its own step.
      pumping = true;
      let n;
      try { n = loop.step(dt); } finally { pumping = false; }
      lastFrameAt += dt * 1000;
      const t = now();
      if (lastFrameAt > t || t - lastFrameAt > N.pumpDebtCeilMs) lastFrameAt = t;
      return n;
    },
    lastFrameAt: () => lastFrameAt,

    // Relevance culling is defined against the RECEIVING client's own camera,
    // so this is that client's capsule, not the host's.
    cameraOf(slot) {
      if (slot === 0) {
        const c = view.camera.position;
        return { x: c.x, y: c.y, z: c.z };
      }
      const r = remote.get(slot);
      return r ? { x: r.pose.x, y: r.pose.y, z: r.pose.z } : null;
    },

    // Every player capsule, for the players frame. The host's own included:
    // a client has to draw the host.
    capsules() {
      const out = [];
      const p = player.position();
      const look = player.look ? player.look() : { yaw: 0, pitch: 0 };
      out.push({ slot: 0, x: p.x, y: p.y, z: p.z, yaw: look.yaw, pitch: look.pitch });
      remote.forEach((r, slot) => {
        const c = r.capsule;
        const t = c ? c.position() : r.pose;
        out.push({ slot, x: t.x, y: t.y, z: t.z, yaw: r.input.yaw, pitch: r.input.pitch });
      });
      return out;
    },

    // The HOST's own avatar feed, called by host.js once per tick with the same
    // capsule list the players frame is built from.
    //
    // A client is pushed poses by playerSample() below, off the stream it
    // receives. The host receives no stream -- it owns these bodies -- so
    // without this its avatar layer has no source whatsoever and every remote
    // player stays hidden as stale. What goes out is the authoritative capsule
    // as of this tick, read out of the host's own world; it is not a poll of a
    // received stream and there is nothing here to re-sample.
    playersSampled(list, t) {
      if (typeof deps.onPlayerPose !== 'function' || !Array.isArray(list)) return 0;
      const at = typeof t === 'number' ? t : now();
      let n = 0;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (!p || p.slot === localSlot) continue;
        const r = remote.get(p.slot);
        deps.onPlayerPose(p.slot, {
          x: p.x, y: p.y, z: p.z, yaw: p.yaw, nick: r ? r.nick : undefined,
        }, at);
        n++;
      }
      return n;
    },

    // A client's input packet. It is fed to that client's REAL capsule in the
    // host's world, so a remote player walking into a crate is the host's solver
    // moving the crate -- not a message asserting that it moved.
    //
    // A packet carries the last config.net.inputWindow inputs, not one, because
    // the channel is `{ordered:false, maxRetransmits:0}` and one input per
    // packet made every loss a slice of movement the host could never apply.
    // What lands here is therefore a WINDOW, of which only the records this
    // host has not already seen are new; `seq` is a 16-bit WRAPPING counter, so
    // "not seen" is signed 16-bit subtraction and never a plain comparison.
    //
    // Nothing is integrated here. The records are queued as time to be spent,
    // one fixed substep at a time, by nextInput() above.
    applyClientInput(slot, bytes) {
      const list = decodeInputWindow(bytes);
      if (!list || !list.length) return false;
      let r = remote.get(slot);
      if (!r) { r = newRemote(slot); remote.set(slot, r); }
      const slice = inputSlice();
      let applied = 0;
      for (let i = 0; i < list.length; i++) {
        const inp = list[i];
        if (r.lastSeq !== null && !seqNewer(inp.seq, r.lastSeq)) {
          r.duplicateInputs++;
          continue;
        }
        r.lastSeq = inp.seq;
        r.queue.push({ inp, left: slice });
        r.appliedInputs++;
        applied++;
      }
      if (!applied) return true;   // pure redundancy: seen it all before
      // The ceiling on banked input. A client that went quiet -- tabbed away,
      // dropped, stalled -- must not have its capsule integrated across the
      // whole gap the moment it comes back, and a client sending faster than
      // clientStateHz must not be able to buy speed by sending more. Both are
      // the same rule: the bank has a maximum and the OLDEST entries are the
      // ones discarded, because the newest are what the player is doing now.
      const maxSeconds = Math.max(slice, (Number(N.inputBudgetMaxMs) || 0) / 1000);
      let bank = banked(r);
      while (r.queue.length > 1 && bank > maxSeconds) {
        bank -= r.queue[0].left;
        r.queue.shift();
        r.trimmedInputs++;
      }
      // Aim and look come from the NEWEST record: where a player is pointing is
      // a fact about now, and a request range-checked against a pose two frames
      // stale is refused for no reason. Where they ARE still comes from the
      // capsule, which is moved by the queue.
      const newest = list[list.length - 1];
      r.input = newest;
      r.lastInputAt = now();
      attachCapsule(r);
      const t = r.capsule.position();
      r.pose.x = t.x; r.pose.y = t.y; r.pose.z = t.z;
      r.pose.yaw = newest.yaw; r.pose.pitch = newest.pitch;
      return true;
    },

    // --- client side ---------------------------------------------------------

    ownInput() {
      const i = input.read();
      return {
        fwd: i.fwd, right: i.right, jump: i.jump, sprint: i.sprint, yaw: i.yaw, pitch: i.pitch,
      };
    },
    ownPosition: () => player.position(),
    setOwnPosition(x, y, z, hard) {
      const raw = world._raw;
      if (!raw || player.handle === undefined) return false;
      const body = raw.getRigidBody(player.handle);
      if (!body) return false;
      body.setTranslation({ x, y, z }, true);
      if (body.setNextKinematicTranslation) body.setNextKinematicTranslation({ x, y, z });
      return true;
    },

    // The host is the authority, so this overwrites whatever the local solver
    // did. `settled` also puts the body to sleep, which is what stops the local
    // solver from nudging a duck the host considers finished.
    applyPose(kind, id, x, y, z, qx, qy, qz, qw, settled) {
      if (kind === WIRE_KIND.DUCK) {
        const b = world.ducks.body(id);
        if (!b || !world.ducks.isActive(id)) return false;
        b.setTranslation({ x, y, z }, false);
        b.setRotation({ x: qx, y: qy, z: qz, w: qw }, false);
        b.setLinvel(ZERO, false);
        b.setAngvel(ZERO, false);
        if (settled) b.sleep(); else b.wakeUp();
        return true;
      }
      if (kind === WIRE_KIND.PROP) {
        const rec = placed.propByKey(id);
        if (!rec || !rec.body) return false;
        rec.body.setTranslation({ x, y, z }, false);
        rec.body.setRotation({ x: qx, y: qy, z: qz, w: qw }, false);
        rec.body.setLinvel(ZERO, false);
        rec.body.setAngvel(ZERO, false);
        if (settled) rec.body.sleep(); else rec.body.wakeUp();
        return true;
      }
      if (kind === WIRE_KIND.PLAYER) {
        if (id === localSlot) return false;
        let r = remote.get(id);
        if (!r) { r = newRemote(id); remote.set(id, r); }
        r.streamed = true;
        r.pose.x = x; r.pose.y = y; r.pose.z = z;
        // The record carries a yaw-only quaternion; pitch rides in the roster.
        r.pose.yaw = Math.atan2(2 * qy * qw, 1 - 2 * qy * qy);
        return true;
      }
      return false;
    },

    setPeerNick(slot, nick) {
      let r = remote.get(slot);
      if (!r) { r = newRemote(slot); remote.set(slot, r); }
      r.nick = nick;
      return true;
    },

    // The colour a joining player picked, off their HELLO. It travels the same
    // path the nick does and lands in the same roster, so the lobby draws every
    // player in the colour they chose rather than in the colour of their slot.
    setPeerColor(slot, color) {
      if (!color) return false;
      colorBy.set(slot, String(color).slice(0, 16));
      let r = remote.get(slot);
      if (!r) { r = newRemote(slot); remote.set(slot, r); }
      r.color = colorBy.get(slot);
      return true;
    },

    // The phase a joining client is told about in its WELCOME. A client that
    // arrives while the room is still in the lobby waits with everybody else; a
    // client that arrives mid-session goes STRAIGHT INTO THE WORLD and sees no
    // intro at all. Sessions run for hours -- locking a latecomer out until the
    // next round would be worse than skipping thirty seconds of music.
    phase: () => phase,
    creative: () => creative,
    setCreative(on) { creative = !!on; return creative; },
    // Written by src/net/client.js off the host's WELCOME. The host never calls
    // it -- there, phase is written by performing REQ.START.
    setPhase(p) {
      if (p !== 'lobby' && p !== 'playing') return phase;
      phase = p;
      // 'welcome' is the reason, and it matters: this is the ONLY path that can
      // mean "the session was already running before you got here". Every other
      // way into 'playing' is the intro about to roll, and a listener that
      // could not tell them apart struck the set one line before start() needed
      // it.
      if (typeof onPhase === 'function') onPhase(phase, 'welcome');
      return phase;
    },
    // The colour this player picked, for the HELLO. Read live from whatever
    // main.js handed in (the settings store), never a copy kept here.
    localColor() {
      const c = typeof deps.localColor === 'function' ? deps.localColor() : null;
      if (c) colorBy.set(localSlot, c);
      return c;
    },

    // A client applying the host's start. `at` is the host's session clock at
    // the instant Start was pressed; `hostClock` is the newest host clock this
    // tab has seen on the state stream, which is what turns "when it started"
    // into "how far in we already are".
    applyCutscene(msg, hostClock) {
      if (!msg) return false;
      phase = 'playing';
      cutsceneAt = Number(msg.at) || 0;
      const seen = typeof hostClock === 'number' && isFinite(hostClock) ? hostClock : null;
      // Fall back to this tab's own copy of the session clock, which was seeded
      // from the host's join snapshot, when no state frame has arrived yet.
      const nowHost = seen === null ? state.clock() : seen;
      const elapsed = Math.max(0, nowHost - cutsceneAt);
      if (typeof onPhase === 'function') onPhase(phase, 'cutscene');
      if (typeof onCutscene === 'function') onCutscene(elapsed, { role: 'client', at: cutsceneAt, hostClock: nowHost });
      return true;
    },

    // A departed player's capsule is a real rigid body in the host's world, so
    // leaving it behind leaves a body everybody keeps walking into. Rapier has
    // no removePlayer, so the capsule is parked far under the plate and taken
    // out of the substep list; its inventory goes with it, because an item held
    // by somebody who is gone is an item nobody can ever get back.
    dropPlayer(slot) {
      const r = remote.get(slot);
      if (!r) return false;
      // Their hold goes first. A controller whose owner has gone would keep
      // springing a duck towards an aim nobody is producing any more, and its
      // claim on that body would never be dropped -- one duck of the fixed 300
      // permanently held by a ghost and ungrabbable by everyone left in the
      // room. Releasing is not cleanup here, it is the difference between a
      // player leaving and a duck leaking.
      if (typeof world.dropHold === 'function') world.dropHold(slot);
      if (r.capsule) {
        const i = world.players.indexOf(r.capsule);
        if (i >= 0) world.players.splice(i, 1);
        const raw = world._raw;
        if (raw && r.capsule.handle !== undefined) {
          const b = raw.getRigidBody(r.capsule.handle);
          if (b) b.setTranslation({ x: 0, y: config.ducks.parkY, z: 0 }, false);
        }
      }
      remote.delete(slot);
      return true;
    },

    // A raw host sample of somebody else's capsule, with the time it arrived.
    // It goes to the avatar renderer untouched: that layer keeps its own
    // history and interpolates from it, and handing it a value this file had
    // already smoothed would be smoothing a smoothed signal -- which reads as a
    // lag nobody can locate, because neither half of it is wrong on its own.
    playerSample(slot, x, y, z, qx, qy, qz, qw, t) {
      let r = remote.get(slot);
      if (!r) { r = newRemote(slot); remote.set(slot, r); }
      r.streamed = true;
      r.pose.x = x; r.pose.y = y; r.pose.z = z;
      r.pose.yaw = Math.atan2(2 * qy * qw, 1 - 2 * qy * qy);
      if (typeof deps.onPlayerPose === 'function') {
        deps.onPlayerPose(slot, { x, y, z, yaw: r.pose.yaw, nick: r.nick }, t);
      }
      return true;
    },

    removeBody(kind, id) {
      if (kind === WIRE_KIND.DUCK) return world.ducks.release(id);
      if (kind === WIRE_KIND.PROP) {
        const rec = placed.propByKey(id);
        return rec ? !!placed.despawnProp(rec) : false;
      }
      return false;
    },

    spawnDuck(slot, tier, x, y, z) {
      return world.ducks.spawnSlot(slot, { x, y, z }, tier) !== null;
    },

    applyPlaced(key, netId, x, y, z, yaw, free) {
      const existing = placed.objects.find((o) => o.key === key);
      if (existing) return true;   // already ours, and the pose is the host's
      const item = byNetId(netId);
      if (!item || !item.collider) return false;
      const half = item.collider.half;
      const h = yaw * 0.5;
      const rec = placed.place(item, {
        position: { x, y, z },
        quaternion: { x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) },
        valid: true, reason: null, yaw, free: !!free, snapped: !free,
        box: { x, y, z, yaw, hx: half[0], hy: half[1], hz: half[2] },
      });
      if (!rec) return false;
      // The HOST's instance key, adopted, or every later message about this
      // object addresses something else.
      rec.key = key;
      placed.reserveKey(key);
      return true;
    },

    applyDemolished(key) {
      const rec = placed.objects.find((o) => o.key === key);
      return rec ? !!placed.remove(rec) : false;
    },

    applyPropDropped(key, netId, p, q) {
      if (placed.propByKey(key)) return true;
      const item = byNetId(netId);
      if (!item || !item.collider || !item.model) return false;
      const rec = placed.dropProp(item, { x: p[0], y: p[1], z: p[2] }, ZERO);
      if (!rec) return false;
      rec.key = key;
      placed.reserveKey(key);
      if (q) rec.body.setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }, false);
      return true;
    },

    applyPropTaken(key) {
      const rec = placed.propByKey(key);
      return rec ? !!placed.despawnProp(rec) : false;
    },

    // The host's word on how far a crank has been turned. Applied here rather
    // than on the public API because client.js is handed THIS object -- the
    // first version of this function sat on the wrong one and the message
    // arrived, matched its case, and called nothing.
    applyCrank(key, pct) {
      const k = key | 0;
      const p = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
      const prev = crankPct.get(k);
      // `rising` is what tells a client's wheel whether anybody is cranking. A
      // percentage that FELL is either the drain or the pop -- both of which
      // should let the wheel coast, and the pop is picked out by how far it fell.
      const rising = prev === undefined ? true : p > prev.p;
      const popped = prev !== undefined && p < prev.p - 30;
      crankPct.set(k, { p, at: now(), rising, popped });
    },
    // The host started a roll on box `key`. All this does is start the same
    // animation locally, off the same simulation module, so the box shakes and
    // opens on every screen at once. It hands nothing over: the prize reaches
    // this tab as a prop out of the chute, a duck out of the spawn stream or a
    // change in the money -- all of which are already reconciled.
    //
    // WAITING ON src/net/client.js, which is another builder's file this round:
    // its applyEvent() switch needs `case EV.GAMBLE: game.applyGamble(msg);
    // return;` or this is never called and a client sees a box that pays out
    // without ever having moved.
    applyGamble(msg) {
      if (!msg || typeof deps.gambleShow !== 'function') return false;
      return deps.gambleShow(Math.round(Number(msg.key)) || 0);
    },

    applyMoney(m, earned) {
      if (world.economy.set) world.economy.set(m);
      // Money first, THEN the lifetime counter -- set() moves the balance with
      // add(), and a positive add() raises `earned` on its way past. The same
      // ordering src/sim/state.js restores in, and for the same reason.
      if (typeof earned === 'number' && isFinite(earned) && world.economy.setTotalEarned) {
        world.economy.setTotalEarned(earned);
      }
      return true;
    },

    // What the host's reconciler diffs to notice a prestige, and what a client
    // is handed when one happens. The shop levels ride along because a client is
    // never told about ownership outside the join snapshot, and after a prestige
    // its idea of what the team owns is exactly wrong.
    prestigeState() {
      if (!deps.prestige) return null;
      const s = deps.prestige.state();
      return { n: s.count, mul: s.multiplier, levels: shop.ownedLevels() };
    },

    // The vendor's shelf, as the host's reconciler diffs it and as a client is
    // handed it. `u` is the units left, `r` what the period started with (a
    // refund puts a unit back and may not exceed it), `p` the period number and
    // `e` how far into the period the host is -- which is what stops a client's
    // countdown drifting away from the moment the shelf will actually turn.
    stockState() {
      const st = deps.stock;
      if (!st) return null;
      const t = st.table();
      return { p: t.period, e: Math.round(t.elapsed * 100) / 100, u: t.units, r: t.rolled, sig: st.signature() };
    },

    applyStock(msg) {
      if (!msg || !deps.stock) return false;
      // `el`, not `e`: on a MSG.EVENT frame `e` is the event name itself.
      deps.stock.setTable({ period: msg.p, elapsed: msg.el, units: msg.u, rolled: msg.r });
      return true;
    },

    applyPrestige(msg) {
      if (!msg) return false;
      if (deps.prestige) deps.prestige.setState({ count: msg.n, multiplier: msg.mul });
      if (msg.levels && typeof shop.setLevels === 'function') {
        try { shop.setLevels(msg.levels); } catch (e) { /* reported by the caller's log */ }
      }
      // A machine in somebody's hotbar is not a prop and not a placed object, so
      // no reconciled diff can take it away. Every inventory in the room drops
      // whatever the prestige wiped.
      if (deps.prestige) clearInventories((id) => deps.prestige.wipesId(id));
      return true;
    },

    onReject(r) {
      // Through the same translator solo uses. Without it a CLIENT saw the raw
      // code -- `overlap`, `too_far` -- where a solo player saw the sentence,
      // so the one player who most needs telling why got the least.
      if (hud && typeof hud.showCap === 'function' && r && r.reason) {
        hud.showCap(typeof deps.reasonText === 'function' ? deps.reasonText(r.reason) : r.reason);
      }
      if (typeof onReject === 'function') onReject(r);
    },
  };

  // --- lifecycle ----------------------------------------------------------------

  // The LOBBY owns creating and closing the signalling session; this layer is
  // handed the live one. Two things must not both own a session's lifetime, and
  // the lobby is where a human decides to start or end one, so it wins.
  // attachHost/attachClient/detach are the whole contract between them.

  function attachHost(s) {
    if (!s || !s.isHost) return null;
    detach();
    session = s;
    localSlot = 0;
    // Hosting a room opens the WAITING ROOM, not the world. This is the line
    // that makes that true, and it is here rather than in the lobby UI so a
    // headless test that attaches a session gets the same behaviour.
    phase = 'lobby';
    cutsceneAt = null;
    readyBy.clear();
    // The host is ready by definition -- it is the one holding the Start button.
    readyBy.set(0, true);
    if (typeof deps.localColor === 'function') {
      const c = deps.localColor();
      if (c) colorBy.set(0, c);
    }
    host = createHost({
      session,
      game: adapter,
      onEvent: (e) => {
        // The roster the reconciler just broadcast is also news for THIS tab.
        // Routing it to the same onRoster a client uses means the waiting room
        // is fed by one mechanism in both roles instead of two -- see the note
        // in host.js reconcileRoster().
        if (e && e.type === 'roster' && typeof onRoster === 'function') {
          roster = Array.isArray(e.players) ? e.players : [];
          onRoster(roster);
        }
        return emit({ ...e, role: 'host' });
      },
    });
    emit({ type: 'hosting', roomId: s.roomId, link: s.link ? s.link() : null });
    return host;
  }

  function attachClient(s) {
    if (!s || s.isHost) return null;
    detach();
    session = s;
    localSlot = s.slot;
    // Provisional. The host's WELCOME is what actually decides it, and it is
    // applied by src/net/client.js through setPhase() below; until it arrives
    // the client waits rather than dropping into a world it may not be in yet.
    phase = 'lobby';
    cutsceneAt = null;
    client = createClient({ session, game: adapter, onEvent: (e) => emit({ ...e, role: 'client' }) });
    emit({ type: 'joining', roomId: s.roomId, slot: s.slot });
    return client;
  }

  // Tears down the authority layer only. The session itself belongs to the
  // lobby, so closing it is the lobby's call and never a side effect of this.
  function detach() {
    if (host) { host.close(); host = null; }
    if (client) { client.close(); client = null; }
    remote.clear();
    // Nobody is holding anything after a teardown, and a stale hold would keep
    // a wheel turning for a player who is no longer in the room.
    crankHold.clear();
    crankPct.clear();
    roster = [];
    localSlot = 0;
    session = null;
    // Back to single player, which has no waiting room at all.
    phase = 'lobby';
    cutsceneAt = null;
    readyBy.clear();
    colorBy.clear();
    emit({ type: 'detached' });
    return true;
  }

  // Convenience for a headless test that has no lobby on screen: it creates the
  // session itself and attaches it through exactly the same two functions, so
  // there is no second code path for the tested case to diverge along.
  async function startHost(opts) {
    if (session) return { ok: false, error: 'already in a room' };
    const res = await tryHostRoom(opts || {});
    if (!res.ok) return res;
    attachHost(res.session);
    return { ok: true, roomId: res.session.roomId, link: res.session.link(), session: res.session };
  }

  async function join(roomId, opts) {
    if (session) return { ok: false, error: 'already in a room' };
    const res = await tryJoinRoom(roomId, opts || {});
    if (!res.ok) return res;
    attachClient(res.session);
    return { ok: true, roomId, slot: res.session.slot, session: res.session };
  }

  async function leave() {
    const s = session;
    detach();
    if (s) await s.close();
    emit({ type: 'left' });
    return true;
  }

  return {
    // main.js calls exactly these three from the frame.
    beginFrame() { if (!pumping) lastFrameAt = now(); },
    postStep() { return client ? client.postStep() : null; },
    act,
    perform,
    // Who the host is currently acting FOR. A purchase drops a prop out of the
    // tube and, if the row is buildable, puts a copy in somebody's hotbar --
    // and "somebody" is the player who asked, not whoever happens to own the
    // shop UI. main.js reads this inside its onPurchase handler, which is the
    // one place that fact is knowable.
    actingSlot: () => actingSlot,
    // Written by src/sim/state.js when a join snapshot is loaded: the snapshot
    // carries who is holding what, and this is where that lands.
    setRoster,
    give: (slot, item, n) => invAdd(slot, item, n === undefined ? 1 : n),
    inventoryOf: (slot) => hotbarList(slot),
    // Every inventory in the room at once. Prestige is the caller: it wipes
    // catalog rows wholesale, and an item in a hand is the one place a wipe
    // cannot reach through the world.
    clearInventories,

    // --- the hold, as the rest of the game asks about it ------------------------
    // main.js used to read world.hold directly for "am I carrying something".
    // On a CLIENT that controller is the local slot-0 one and it is always
    // empty: the client's hold lives in the host's world, and the only true
    // answer this side of the wire is the one the host sent in the roster.
    holdingLocal() {
      if (client) {
        const r = roster.find((x) => x && x.slot === localSlot);
        return !!(r && r.hold);
      }
      return !!(world.hold && world.hold.isHolding());
    },
    heldLocal() {
      if (client) {
        const r = roster.find((x) => x && x.slot === localSlot);
        return r && r.hold && typeof r.hold.d === 'number' ? r.hold.d : null;
      }
      return world.hold && world.hold.isHolding() ? world.hold.heldDuck() : null;
    },
    // Who is holding what, for anybody -- the host's own answer when it has one,
    // the host's last word when we are a client. Used by the avatar layer and by
    // the tests.
    heldBy(slot) {
      const s = slot | 0;
      if (client || s !== localSlot) {
        const r = (client ? roster : buildRoster()).find((x) => x && x.slot === s);
        return r && r.hold && typeof r.hold.d === 'number' ? r.hold.d : null;
      }
      return heldDuckOf(s);
    },
    holdSlots: () => (world.holdSlots ? world.holdSlots() : [0]),

    // 0..1 to match benches.progress(), or null when the host has not mentioned
    // this bench yet -- which is not the same as zero and must not read as it.
    crankProgressOf(key) {
      const r = crankPct.get(key | 0);
      return r === undefined ? null : r.p / 100;
    },
    // Every wheel the host has ever mentioned, and the last thing it said about
    // one. A client's wheel animation reads these and nothing else.
    crankKeys: () => Array.from(crankPct.keys()),
    crankInfo(key) {
      const r = crankPct.get(key | 0);
      if (r === undefined) return null;
      // `popped` is consumed: the spin-down it triggers must happen once, not on
      // every frame until the next message arrives.
      const out = { p: r.p / 100, ageMs: now() - r.at, rising: r.rising, popped: r.popped };
      if (r.popped) r.popped = false;
      return out;
    },
    // Who is holding which wheel, host side. main.js multiplies by this.
    crankHolders,
    crankHoldSlots: () => Array.from(crankHold.keys()),
    isClient,

    // Is this duck in ANYBODY's hands? On a host the hold claims answer it. On a
    // client there are no local claims at all -- the hold lives in the host's
    // world -- so the roster is the only source, and without consulting it the
    // audio layer read a carried duck's spring motion as a stream of collisions
    // and squeaked non-stop while a player walked. See audio/wire.js isHeld().
    isDuckHeld(id) {
      const d = id | 0;
      if (world.isHeldHandle && world.ducks && typeof world.ducks.handleOf === 'function') {
        const h = world.ducks.handleOf(d);
        if (h !== null && h !== undefined && world.isHeldHandle(h)) return true;
      }
      for (let i = 0; i < roster.length; i++) {
        const r = roster[i];
        if (r && r.hold && (r.hold.d | 0) === d) return true;
      }
      return false;
    },

    // --- the waiting room, as the lobby UI and main.js ask about it -------------
    // ONE reader for the phase and ONE writer for each side of it: the host
    // writes it by performing REQ.START, a client writes it by being told
    // (setPhase, from its WELCOME, and applyCutscene from EV.CUTSCENE).
    phase: () => (session ? phase : 'single'),
    cutsceneAt: () => cutsceneAt,
    setPhase(p) {
      if (p !== 'lobby' && p !== 'playing') return phase;
      phase = p;
      if (typeof onPhase === 'function') onPhase(phase);
      return phase;
    },
    // main.js registers what actually rolls the cutscene, because src/cutscene.js
    // is built after this layer. `elapsed` is how far into the timeline this tab
    // already is: 0 on the host, (hostClockNow - startedAt) on a client.
    onCutscene(fn) { onCutscene = typeof fn === 'function' ? fn : null; return true; },
    onPhaseChange(fn) { onPhase = typeof fn === 'function' ? fn : null; return true; },
    // The two lobby verbs, through the same door every other action uses: on a
    // client they are SENT, on a host they are performed.
    setReady(on, color) { return act({ a: REQ.READY, ready: !!on, color: color || null }); },
    startSession(opts) {
      if (opts && typeof opts.creative === 'boolean') creative = opts.creative;
      return act({ a: REQ.START });
    },
    isReady(slot) { return !!readyBy.get(slot | 0); },
    colorOf(slot) { return colorBy.get(slot | 0) || null; },
    // Everyone the host is waiting for, and whether it is still waiting. The
    // Start button is deliberately NOT gated on this -- a host may start with an
    // unready player, because the alternative is one AFK tab holding a room
    // hostage -- but the button says what it is about to do.
    allReady() {
      const list = client ? roster : buildRoster();
      for (let i = 0; i < list.length; i++) if (list[i] && !list[i].ready) return false;
      return list.length > 0;
    },

    // Lifecycle. The lobby calls the first three; the last three exist for a
    // headless test that has no lobby on screen.
    attachHost,
    attachClient,
    detach,
    host: startHost,
    join,
    leave,
    role: () => (host ? 'host' : client ? 'client' : 'single'),
    isHost,
    isClient,
    isSingle: () => !session,
    localSlot: () => localSlot,
    // Everything a lobby screen or an avatar renderer needs, and nothing about
    // peers or codecs. These are the exports the other G4 builder consumes.
    roomState() {
      if (host) return host.roomState();
      if (client) return client.roomState();
      return { role: 'single', roomId: null, slot: 0, players: [] };
    },
    // A client shows what the host sent it. Anyone else -- a host, or a single
    // player with no room at all -- builds it, because in single player this is
    // still the answer to "what is in my hands" and the snapshot is still a
    // crash-recovery format. Returning an empty list off-line would quietly
    // make every single-player snapshot incomplete in exactly the way this
    // round set out to fix.
    players: () => (client ? roster : buildRoster()),
    playerPose(slot) {
      if (slot === localSlot) {
        const p = player.position();
        const look = player.look ? player.look() : { yaw: 0, pitch: 0 };
        return { slot, x: p.x, y: p.y, z: p.z, yaw: look.yaw, pitch: look.pitch, local: true };
      }
      const r = remote.get(slot);
      if (!r) return null;
      const t = r.capsule ? r.capsule.position() : r.pose;
      return {
        slot, x: t.x, y: t.y, z: t.z,
        yaw: r.pose.yaw, pitch: r.pose.pitch,
        nick: r.nick, hand: r.handId || currentHandId(slot), local: false,
      };
    },
    remoteSlots: () => Array.from(remote.keys()),
    onSessionEvent: (fn) => { if (session) return session.on(fn); return () => {}; },
    // What the host is doing with each remote player's input: how many records
    // it accepted, how many arrived as pure redundancy (the window's whole
    // purpose), how many it had to discard as too old to be worth replaying,
    // and how many substeps it had no input for at all. A starved capsule is
    // the honest reading of a client that has gone quiet; it used to be a
    // capsule that kept walking.
    inputStats() {
      const out = [];
      remote.forEach((r, slot) => {
        out.push({
          slot,
          queued: r.queue.length,
          bankedMs: Math.round(banked(r) * 1000),
          debtMs: Math.round(r.debt * 1000),
          appliedInputs: r.appliedInputs,
          duplicateInputs: r.duplicateInputs,
          trimmedInputs: r.trimmedInputs,
          coastSubsteps: r.coastSubsteps,
          starvedSubsteps: r.starvedSubsteps,
          inputSeconds: r.inputSeconds,
          lastSeq: r.lastSeq,
        });
      });
      return out;
    },

    stats(t) {
      const base = { role: host ? 'host' : client ? 'client' : 'single', ...counters,
        remotePlayers: remote.size };
      if (host) return { ...base, ...host.stats(t) };
      if (client) return { ...base, ...client.stats(t) };
      return base;
    },
    // Test surface: a host tick without waiting for the worker clock.
    tick() { return host ? host.tick() : null; },
    _host: () => host,
    _client: () => client,
  };
}

export default createNetGame;
