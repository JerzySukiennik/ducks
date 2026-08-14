// The host owns the simulation. Everything below is a consequence of that one
// sentence.
//
// HOW IT BROADCASTS, AND WHY IT IS A DIFF RATHER THAN A PILE OF EMIT CALLS
// The obvious design is an emit at every call site: place an object, emit a
// `placed`; pick up a prop, emit a `propTaken`. That design has one failure mode
// and it is silent -- a call site that forgets to emit leaves every client
// looking at a world that no longer exists, and nothing in the code says so.
// This host instead RECONCILES: once per tick it compares its own authoritative
// world against a digest of what it last told the clients, and the difference IS
// the message. A duck cannot spawn without the clients hearing about it, because
// the duck's existence is what is being compared, not somebody's intention to
// mention it.
//
// That also makes the frozen contract's rule 6 structural instead of a
// convention: a client cannot apply its own request first, because a client is
// never told about its own request. It is told about the world afterwards, at
// the same moment and in the same message as everybody else.
//
// TWO CHANNELS, TWO JOBS
//   control  reliable: the join snapshot, world deltas, duckSettled, the roster
//   state    unreliable: poses of things that are MOVING, 20 Hz, 12 B each
//
// A duck that settles leaves the state stream and gets exactly one duckSettled
// on control, carrying its final pose (frozen contract rule 4). Without the pose
// in that message a duck would freeze wherever its last lossy frame put it,
// which is not where it actually came to rest.
//
// NOT requestAnimationFrame, and not setInterval either. A hidden tab freezes
// rAF completely and clamps setInterval to about 1 Hz, so both the simulation
// pump and the send scheduler run off the worker clock in ./clock.js. While the
// host tab is visible rAF is still what drives the frame; the worker clock only
// takes over when rAF has gone quiet, so a visible host plays exactly as it does
// single player.
//
// No three.js here, and nothing branches on a row's `id`.

import config from '../config.js';
import { createClock } from './clock.js';
import { createSnapshotCodec } from './snapshot.js';
import { MSG, EV, FRAME, REQ, wire, REJECT_REASON, PROTOCOL } from './protocol.js';

function now() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

// game is the adapter main.js builds. Everything the host is allowed to touch
// arrives through it, which is why this file imports no renderer and no sim.
export function createHost({ session, game, onEvent }) {
  if (!session || !session.isHost) throw new Error('[host] needs a host session');
  if (!game) throw new Error('[host] needs a game adapter');

  const N = config.net;
  const emit = typeof onEvent === 'function' ? onEvent : () => {};
  const ducks = game.ducks;
  const maxDucks = (ducks && ducks.max) || 0;

  // --- what the clients have been told ---------------------------------------
  // The digest. Comparing against this, rather than against nothing, is what
  // turns "the world changed" into a message without anybody having to remember
  // to send one.
  const duckActive = new Uint8Array(maxDucks);
  const duckTier = new Int16Array(maxDucks);
  const duckAwake = new Uint8Array(maxDucks);
  const propSeen = new Map();      // placement key -> netId
  const placedSeen = new Map();    // placement key -> serialised pose
  const propAwake = new Map();     // placement key -> 1 while streaming
  let moneySeen = null;
  let prestigeSeen = null;
  let stockSeen = null;
  let rosterSeen = '';
  let started = false;
  let closed = false;

  // Per peer, because gate E-H is written per client and because relevance
  // culling is defined against THAT client's camera. One shared codec would
  // measure the sum of every client's stream and degrade the rate for all of
  // them on a number none of them is actually seeing.
  const peers = new Map();   // slot -> { peer, codec, lastSendMs, joined, snapshotSent }

  const counters = {
    ticks: 0,
    pumps: 0,
    framesSent: 0,
    controlSent: 0,
    settledSent: 0,
    spawnsSent: 0,
    requests: 0,
    rejected: 0,
    snapshotsSent: 0,
    snapshotBytes: 0,
  };

  // --- outbound ---------------------------------------------------------------

  function sendTo(slot, msg) {
    const p = peers.get(slot);
    if (!p || !p.peer.isOpen()) return false;
    counters.controlSent++;
    return p.peer.sendControl(msg);
  }

  function broadcast(msg) {
    let n = 0;
    peers.forEach((p) => {
      if (p.peer.isOpen() && p.peer.sendControl(msg)) n++;
    });
    if (n) counters.controlSent += n;
    return n;
  }

  // The join snapshot is `state.serialize()` -- byte-identical to what
  // debugSnapshot() returns, which is the whole point of there being one
  // format (frozen contract rule 7). It goes out in chunks because a single
  // SCTP message past about 64 KB is refused by some browsers and quietly
  // closes the channel in others, and 300 ducks of JSON is well past that.
  function sendSnapshot(slot) {
    const p = peers.get(slot);
    if (!p) return false;
    const snap = game.serialize();
    const text = JSON.stringify(snap);
    const size = Math.max(1, Math.round(N.snapshotChunkChars));
    const total = Math.ceil(text.length / size) || 1;
    sendTo(slot, {
      t: MSG.SNAPSHOT_BEGIN, v: PROTOCOL.version, chunks: total, chars: text.length,
      clock: snap.clock, slot,
    });
    for (let i = 0; i < total; i++) {
      sendTo(slot, { t: MSG.SNAPSHOT_CHUNK, i, s: text.slice(i * size, (i + 1) * size) });
    }
    sendTo(slot, { t: MSG.SNAPSHOT_END, chunks: total, chars: text.length });
    p.snapshotSent = true;
    counters.snapshotsSent++;
    counters.snapshotBytes += text.length;
    emit({ type: 'snapshotSent', slot, chars: text.length, chunks: total });
    return true;
  }

  // --- the reconciler ---------------------------------------------------------
  // One pass over the authoritative world, producing (a) the bodies that go in
  // this tick's state frames and (b) the control messages that describe
  // everything the state stream is not allowed to carry.

  const worldBodies = [];
  const playerBodies = [];
  const settled = [];
  const gone = [];
  const spawned = [];

  function reconcileDucks() {
    worldBodies.length = 0;
    settled.length = 0;
    gone.length = 0;
    spawned.length = 0;
    if (!ducks || typeof ducks.forEach !== 'function') return;

    const live = new Uint8Array(maxDucks);
    ducks.forEach((id, x, y, z, qx, qy, qz, qw, tier, sleeping) => {
      live[id] = 1;
      if (!duckActive[id]) {
        // A duck the clients have never heard of. Its pool slot is its wire id,
        // so the message is small; the tier is what a client cannot derive.
        spawned.push({ s: id, t: tier | 0, p: [x, y, z] });
      }
      duckActive[id] = 1;
      duckTier[id] = tier | 0;
      if (sleeping) {
        // Rule 4: it leaves the stream and gets ONE duckSettled, with the pose
        // it actually stopped at rather than whichever lossy frame was last.
        if (duckAwake[id]) settled.push([wire.duck(id), x, y, z, qx, qy, qz, qw]);
        duckAwake[id] = 0;
      } else {
        duckAwake[id] = 1;
        worldBodies.push({ netId: wire.duck(id), x, y, z, qx, qy, qz, qw, sleeping: false });
      }
    });

    for (let i = 0; i < maxDucks; i++) {
      if (duckActive[i] && !live[i]) {
        duckActive[i] = 0;
        duckAwake[i] = 0;
        gone.push(wire.duck(i));
      }
    }
  }

  function reconcileProps() {
    const list = game.placedProps ? game.placedProps() : [];
    const live = new Set();
    for (let i = 0; i < list.length; i++) {
      const rec = list[i];
      const b = rec.body;
      if (!b) continue;
      live.add(rec.key);
      const t = b.translation();
      const r = b.rotation();
      const asleep = typeof b.isSleeping === 'function' ? b.isSleeping() : false;
      if (!propSeen.has(rec.key)) {
        propSeen.set(rec.key, rec.netId);
        broadcast({
          t: MSG.EVENT, e: EV.PROP_DROPPED, key: rec.key, netId: rec.netId,
          p: [t.x, t.y, t.z], q: [r.x, r.y, r.z, r.w],
        });
      }
      if (asleep) {
        if (propAwake.get(rec.key)) {
          settled.push([wire.prop(rec.key), t.x, t.y, t.z, r.x, r.y, r.z, r.w]);
        }
        propAwake.set(rec.key, 0);
      } else {
        propAwake.set(rec.key, 1);
        worldBodies.push({
          netId: wire.prop(rec.key),
          x: t.x, y: t.y, z: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w, sleeping: false,
        });
      }
    }
    propSeen.forEach((netId, key) => {
      if (live.has(key)) return;
      propSeen.delete(key);
      propAwake.delete(key);
      broadcast({ t: MSG.EVENT, e: EV.PROP_TAKEN, key, netId });
    });
  }

  function poseKey(rec) {
    return rec.netId + '|' + rec.position.x.toFixed(4) + ',' + rec.position.y.toFixed(4)
      + ',' + rec.position.z.toFixed(4) + '|' + rec.yaw.toFixed(5) + '|' + (rec.free ? 1 : 0);
  }

  function reconcilePlaced() {
    const list = game.placedObjects ? game.placedObjects() : [];
    const live = new Set();
    for (let i = 0; i < list.length; i++) {
      const rec = list[i];
      live.add(rec.key);
      const k = poseKey(rec);
      if (placedSeen.get(rec.key) === k) continue;
      placedSeen.set(rec.key, k);
      broadcast({
        t: MSG.EVENT, e: EV.PLACED, key: rec.key, netId: rec.netId,
        p: [rec.position.x, rec.position.y, rec.position.z],
        yaw: rec.yaw, free: !!rec.free,
      });
    }
    placedSeen.forEach((_, key) => {
      if (live.has(key)) return;
      placedSeen.delete(key);
      broadcast({ t: MSG.EVENT, e: EV.DEMOLISHED, key });
    });
  }

  // The balance, and the LIFETIME total beside it. The second number used to
  // travel only in the join snapshot, and it is the input to the prestige
  // formula -- so a client's prestige panel was quoting a multiplier off its own
  // local guess at what the team had earned. It is one more field on a message
  // that already exists and it changes at exactly the same moments.
  function reconcileMoney() {
    const m = game.money ? game.money() : 0;
    const earned = game.earned ? game.earned() : 0;
    const k = m + '|' + earned;
    if (k === moneySeen) return;
    moneySeen = k;
    broadcast({ t: MSG.EVENT, e: EV.MONEY, money: m, earned });
  }

  // The vendor's shelf. Diffed on the UNIT COUNTS and the period number only --
  // never on the clock -- because the clock moves every frame and the shelf
  // moves when somebody buys something or three minutes pass. Diffing the clock
  // too would put a 400-byte message on the wire twenty times a second to say
  // nothing. The clock still RIDES on the message, so every client that hears
  // about a purchase also resyncs its countdown for free.
  //
  // Like the prestige diff, the first pass only records: a client that has just
  // been handed the join snapshot already knows what is on the shelf.
  function reconcileStock() {
    const st = game.stockState ? game.stockState() : null;
    if (!st) return;
    if (st.sig === stockSeen) return;
    const first = stockSeen === null;
    stockSeen = st.sig;
    if (first) return;
    // `el`, not `e`: `e` is already the event name on every MSG.EVENT frame.
    broadcast({ t: MSG.EVENT, e: EV.STOCK, p: st.p, el: st.e, u: st.u, r: st.r });
  }

  // A prestige changes three things a client cannot work out for itself: the
  // multiplier (a number, fixed at the instant it was taken), the shop levels
  // (which a client only ever hears about in the join snapshot), and the count.
  // Everything else it costs -- the money, the machines on the plate, the crates
  // that were still in the chute -- is already a diff the reconciler above
  // notices on its own, which is exactly why this is three fields and not a
  // description of a wipe.
  //
  // Diffed like everything else here rather than emitted at the call site: the
  // first pass only RECORDS, because a client that has just been sent the join
  // snapshot has already been told.
  function reconcilePrestige() {
    const p = game.prestigeState ? game.prestigeState() : null;
    if (!p) return;
    const k = p.n + '|' + p.mul;
    if (k === prestigeSeen) return;
    const first = prestigeSeen === null;
    prestigeSeen = k;
    if (first) return;
    broadcast({ t: MSG.EVENT, e: EV.PRESTIGE, n: p.n, mul: p.mul, levels: p.levels });
  }

  // The roster carries WHO IS IN THE ROOM and, per player, WHAT THEY ARE
  // HOLDING. The second half is the gap this round had to close: a joining
  // player could be handed every dropped prop on the plate and still have no
  // way to know that the broom is in slot 2's hands rather than lying on the
  // floor. It is diffed as a whole because it is small and changes rarely.
  function reconcileRoster() {
    const list = game.roster ? game.roster() : [];
    const text = JSON.stringify(list);
    if (text === rosterSeen) return;
    rosterSeen = text;
    broadcast({ t: MSG.PLAYERS, players: list });
  }

  function drainSettled() {
    const max = Math.max(1, Math.round(N.settledBatchMax));
    while (settled.length) {
      const batch = settled.splice(0, max);
      broadcast({ t: MSG.SETTLED, b: batch });
      counters.settledSent += batch.length;
    }
    if (gone.length) {
      broadcast({ t: MSG.SETTLED, b: [], gone: gone.slice() });
      gone.length = 0;
    }
    while (spawned.length) {
      const batch = spawned.splice(0, max);
      broadcast({ t: MSG.EVENT, e: EV.DUCK_SPAWNED, d: batch });
      counters.spawnsSent += batch.length;
    }
  }

  // Every capsule in the room, once per tick, for the players frame -- AND for
  // this tab's own avatar renderer.
  //
  // The second half is not a convenience. A client is drawn other players from
  // the 20 Hz stream it receives, so its avatar layer has a push source; the
  // host receives no such stream, because it is the thing producing it. With
  // the frame-rate poll removed (correctly: it re-sampled a 20 Hz stream at
  // 60 Hz and handed the interpolator a stair step) the host was left with NO
  // source at all, so every remote avatar sat with an empty sample buffer and
  // was hidden as stale -- the host saw an empty room while everybody else saw
  // the host. This is the authoritative body read straight out of the host's
  // own world at the tick rate, which is neither a poll of a stream nor a
  // re-sample of one.
  function collectPlayers(t) {
    playerBodies.length = 0;
    const list = game.capsules ? game.capsules() : [];
    if (typeof game.playersSampled === 'function') game.playersSampled(list, t);
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      playerBodies.push({
        netId: wire.player(p.slot),
        x: p.x, y: p.y, z: p.z,
        // Yaw and pitch are what an avatar needs and a quaternion is what the
        // 12 B record carries, so the look direction travels as a yaw-only
        // quaternion and the pitch rides in the roster. A body record cannot be
        // widened without changing the measured frame size.
        qx: 0, qy: Math.sin(p.yaw * 0.5), qz: 0, qw: Math.cos(p.yaw * 0.5),
        sleeping: false,
      });
    }
  }

  // --- the tick ---------------------------------------------------------------

  function sendFrames(t) {
    peers.forEach((p, slot) => {
      if (!p.peer.isOpen() || !p.snapshotSent) return;
      // Asked every tick, never cached: a degradation must take effect on the
      // next send rather than whenever something happens to rebuild a timer.
      const interval = p.codec.frameIntervalMs();
      if (t - p.lastSendMs < interval) return;
      p.lastSendMs = t;
      const origin = game.cameraOf ? game.cameraOf(slot) : null;
      const world = p.codec.encode(worldBodies, {
        origin, now: t, clock: game.clock(), flags: FRAME.WORLD,
      });
      p.peer.sendState(world);
      // Players go in their own frame with NO origin, so relevance culling
      // cannot make a teammate 50 m away stop moving. 16 B of extra header
      // twenty times a second is 320 B/s; a frozen teammate is a bug.
      // Recorded BEFORE the players frame overwrites it. The codec keeps one
      // "last frame" figure and two frames go out per tick, so reading it
      // afterwards reports the two-body player frame as though it were the
      // world -- which would make a 300-duck stream look like it was carrying
      // nothing at all, in exactly the counter gate E-H is read off.
      p.worldBodies = p.codec.stats(t).bodiesLastFrame;
      p.worldCulled = p.codec.stats(t).relevanceCulledLastFrame;
      const pl = p.codec.encode(playerBodies, {
        origin: null, now: t, clock: game.clock(), flags: FRAME.PLAYERS,
      });
      p.peer.sendState(pl);
      counters.framesSent += 2;
    });
  }

  // The rAF watchdog. While the host tab is visible, frames arrive every ~16 ms
  // and this never fires, so single player and a visible host run identically.
  // The moment the tab is hidden rAF stops dead and the worker clock -- which
  // has no visibility state to be clamped by -- becomes the simulation.
  // One pump may only ask for as much time as the world can actually simulate.
  // world.run() runs at most config.loop.maxSubsteps substeps and then THROWS
  // AWAY whatever is left in its accumulator, so a single pump caps out at
  // maxSubsteps * fixedDt = 83 ms however large a dt it is handed. Asking for
  // config.loop.maxFrameDt (250 ms) did not simulate 250 ms; it simulated 83 and
  // silently discarded 167. Measured on a hidden host over three runs of 80
  // ticks: the world advanced 1.333 s per 2.20 s of real time -- 0.606x, the
  // same number every run because it is 5 substeps a pump, not jitter.
  //
  // That is the rewind. A backgrounded host ran SLOW, not fast: the client
  // predicts its own capsule in real time, walks ahead of a host living in the
  // past, and every correction drags it backwards. Hence "constantly while
  // walking", and only on the tab that joined.
  //
  // So: chunk the gap into helpings the world can swallow, and pump until it is
  // paid off. game.pump() advances the stamp by what it simulated and writes off
  // anything older than net.pumpDebtCeilMs, which is what terminates this loop
  // on a machine too slow to ever catch up.
  function pumpIfStale(t) {
    const last0 = game.lastFrameAt ? game.lastFrameAt() : t;
    if (t - last0 < N.rafStaleMs) return 0;
    const chunkMs = config.loop.maxSubsteps * config.loop.fixedDt * 1000;
    const stepMs = config.loop.fixedDt * 1000;
    let simulated = 0;
    for (let i = 0; i < N.pumpChunksPerTick; i++) {
      const gap = t - game.lastFrameAt();
      if (gap < stepMs) break;
      const dt = Math.min(chunkMs, gap) / 1000;
      game.pump(dt);
      counters.pumps++;
      simulated += dt;
    }
    return simulated;
  }

  function tick() {
    if (closed) return;
    const t = now();
    counters.ticks++;
    pumpIfStale(t);
    reconcileDucks();
    reconcileProps();
    reconcilePlaced();
    reconcileMoney();
    reconcileStock();
    reconcilePrestige();
    reconcileRoster();
    drainSettled();
    collectPlayers(t);
    sendFrames(t);
  }

  const clock = createClock(N.hostTickMs, tick);

  // --- inbound ----------------------------------------------------------------

  function handleRequest(slot, msg) {
    counters.requests++;
    const action = msg && msg.a;
    if (!action || !Object.prototype.hasOwnProperty.call(REQ_SET, action)) {
      counters.rejected++;
      sendTo(slot, { t: MSG.REJECT, id: msg && msg.id, reason: REJECT_REASON.UNKNOWN_REQUEST });
      return;
    }
    let res = null;
    try {
      res = game.perform(slot, msg);
    } catch (e) {
      res = { ok: false, reason: e && e.message ? e.message : REJECT_REASON.FAILED };
    }
    if (!res || !res.ok) {
      counters.rejected++;
      sendTo(slot, {
        t: MSG.REJECT, id: msg.id, a: action,
        reason: (res && res.reason) || REJECT_REASON.FAILED,
      });
      emit({ type: 'rejected', slot, action, reason: res && res.reason });
      return;
    }
    // Deliberately no ack carrying the result. What happened reaches the asker
    // through the same reconciled broadcast everybody else gets, on the next
    // tick, which is what keeps every client's world identical to the host's.
    emit({ type: 'performed', slot, action });
  }

  const REQ_SET = {};
  Object.keys(REQ).forEach((k) => { REQ_SET[REQ[k]] = true; });

  function attach(slot, peer) {
    if (peers.has(slot)) return;
    peers.set(slot, {
      peer,
      codec: createSnapshotCodec(config),
      lastSendMs: 0,
      snapshotSent: false,
      nick: null,
      worldBodies: 0,
      worldCulled: 0,
    });
  }

  function onPeerEvent(ev) {
    if (closed) return;
    const slot = ev.slot;
    if (ev.type === 'peer') {
      attach(slot, ev.peer);
      return;
    }
    if (ev.type === 'open') {
      attach(slot, ev.peer);
      const p = peers.get(slot);
      sendTo(slot, {
        t: MSG.WELCOME, v: PROTOCOL.version, slot,
        hostNick: session.nick, roomId: session.roomId,
        stateHz: p.codec.stateHz(),
      });
      // Everything the client needs to exist in this world, in one format that
      // is also debugSnapshot() and also crash recovery.
      sendSnapshot(slot);
      // The roster has to be resent: it is diffed, and a client that joined
      // after the last change would otherwise never receive one.
      rosterSeen = '';
      emit({ type: 'clientJoined', slot });
      return;
    }
    if (ev.type === 'peerleft' || ev.type === 'closed') {
      if (peers.has(slot)) {
        peers.delete(slot);
        rosterSeen = '';
        // Their capsule has to go with them, or a departed player stands on the
        // plate forever as a body everyone else still collides with.
        if (typeof game.dropPlayer === 'function') game.dropPlayer(slot);
        emit({ type: 'clientLeft', slot, reason: ev.reason || null });
      }
      return;
    }
    if (ev.type === 'control' && ev.msg) {
      const msg = ev.msg;
      if (msg.t === MSG.REQUEST) { handleRequest(slot, msg); return; }
      if (msg.t === MSG.HELLO) {
        const p = peers.get(slot);
        const nick = String(msg.nick || '').slice(0, 24);
        if (p) p.nick = nick;
        // The roster is what every other player reads a name off, and it is
        // built by the game adapter, not by this file. Keeping the name only in
        // the peer record left the host's own roster calling everybody
        // "player 1", which is exactly the sort of thing that looks cosmetic
        // and is actually a fact travelling down one path and not the other.
        if (nick && typeof game.setPeerNick === 'function') game.setPeerNick(slot, nick);
        rosterSeen = '';
        emit({ type: 'hello', slot, nick });
        return;
      }
      if (msg.t === MSG.BYE) { emit({ type: 'clientBye', slot }); return; }
      return;
    }
    if (ev.type === 'state' && ev.bytes) {
      // A client's own capsule, its look and its input. Everything else it
      // wants changed goes through a request on the reliable channel.
      try {
        game.applyClientInput(slot, ev.bytes);
      } catch (e) {
        emit({ type: 'error', where: 'clientInput', slot, reason: e.message });
      }
      return;
    }
    if (ev.type === 'error') emit({ type: 'error', where: 'peer', slot, reason: ev.reason });
  }

  const offSession = session.on(onPeerEvent);
  started = true;

  return {
    role: 'host',
    slot: 0,
    session,
    started: () => started,
    peerSlots: () => Array.from(peers.keys()),
    clientCount: () => peers.size,
    // The lobby and the avatar renderer read the room through these two, so
    // neither of them has to know that a peer or a codec exists.
    roomState() {
      return {
        role: 'host',
        roomId: session.roomId,
        isPublic: session.isPublic,
        link: session.link(),
        nick: session.nick,
        slot: 0,
        players: session.players(),
        clients: Array.from(peers.entries()).map(([slot, p]) => ({
          slot, nick: p.nick, state: p.peer.state(), joined: p.snapshotSent,
        })),
      };
    },
    broadcast,
    sendTo,
    resendSnapshot: sendSnapshot,
    // Manual pump, for a test that wants a tick without waiting for the clock.
    tick,
    stats(t) {
      const at = t === undefined ? now() : t;
      const per = [];
      let worst = 0;
      peers.forEach((p, slot) => {
        const s = p.codec.stats(at);
        const link = p.peer.stats();
        const kb = s.upKBPerSecond;
        if (kb > worst) worst = kb;
        per.push({
          slot,
          stateKBPerSecond: kb,
          // Everything on the wire to this client, state plus control, measured
          // by the transport rather than by the codec.
          linkKBPerSecond: link.upBytesPerSec / 1024,
          // The WORLD frame's counts, captured before the player frame
          // overwrote the codec's single "last frame" figure.
          bodiesLastFrame: p.worldBodies || 0,
          culledLastFrame: p.worldCulled || 0,
          playerBodiesLastFrame: s.bodiesLastFrame,
          settledFiltered: s.settledFiltered,
          stateHz: s.stateHz,
          degraded: s.degraded,
          degradations: s.degradations,
          droppedStateFrames: link.droppedStateFrames,
        });
      });
      return {
        role: 'host',
        roomId: session.roomId,
        clients: peers.size,
        worstClientKBPerSecond: worst,
        clockDriver: clock.driver,
        worldBodiesLastTick: worldBodies.length,
        playerBodiesLastTick: playerBodies.length,
        ...counters,
        peers: per,
      };
    },
    close() {
      if (closed) return;
      closed = true;
      broadcast({ t: MSG.BYE, reason: 'host closed' });
      clock.stop();
      if (typeof offSession === 'function') offSession();
      peers.clear();
    },
  };
}

export default createHost;
