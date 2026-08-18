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
import {
  MSG, EV, FRAME, REQ, wire, REJECT_REASON, PROTOCOL, encodeLiveBitmap,
} from './protocol.js';

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
  const placedSeen = new Map();
  const crankSeen = new Map();     // placement key -> whole percent last sent
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
    livenessSent: 0,
    livenessBytes: 0,
    resyncAsked: 0,      // RESYNC messages received
    resyncSlots: 0,      // slots re-announced because of one
    resyncIgnored: 0,    // asked again inside the cooldown
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

  // Crank progress. EV.CRANK has existed in the protocol since G4 and nothing
  // ever sent it, so the percentage beside a workbench prompt was the only
  // number on a client's screen with no source: it read the client's own copy of
  // the bench, which is never cranked, and therefore never moved.
  //
  // Diffed rather than emitted from the CRANK action, for the reason this file
  // diffs everything else: an emit can be forgotten at a new call site, a diff
  // cannot. Quantised to whole percent, which is all the prompt displays -- so
  // the traffic is one small message per visible percent change, and a bench
  // nobody is touching sends nothing at all.
  function reconcileCrank() {
    const list = game.crankStates ? game.crankStates() : [];
    const live = new Set();
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const key = c.key | 0;
      live.add(key);
      const pct = Math.max(0, Math.min(100, Math.round((Number(c.p) || 0) * 100)));
      if (crankSeen.get(key) === pct) continue;
      crankSeen.set(key, pct);
      broadcast({ t: MSG.EVENT, e: EV.CRANK, key, p: pct });
    }
    crankSeen.forEach((_, key) => { if (!live.has(key)) crankSeen.delete(key); });
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
    reconcileSky();
    const st = game.stockState ? game.stockState() : null;
    if (!st) return;
    if (st.sig === stockSeen) return;
    const first = stockSeen === null;
    stockSeen = st.sig;
    if (first) return;
    // `el`, not `e`: `e` is already the event name on every MSG.EVENT frame.
    broadcast({ t: MSG.EVENT, e: EV.STOCK, p: st.p, el: st.e, u: st.u, r: st.r });
  }

  // THE SKY. Weather and events are ROLLED, and a roll is the one kind of
  // fact a client can never work out for itself: two machines calling their
  // own random number generator are two different days in the same room.
  // Sent on change, like the shelf and the roster.
  let skySeen = '';
  function reconcileSky() {
    const sky = game.skyState ? game.skyState() : null;
    if (!sky) return;
    const sig = sky.weather + '|' + (sky.event || '') + '|' + Math.round(sky.fraction * 200);
    if (sig === skySeen) return;
    skySeen = sig;
    broadcast({ t: MSG.EVENT, e: EV.SKY, w: sky.weather, ev: sky.event, f: sky.fraction });
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
    // ...and tell THIS tab too. The host used to be the one player nobody told:
    // clients learned the roster from this message, while the host's own waiting
    // room was pushed from the frame loop instead. That made the host's player
    // list depend on requestAnimationFrame -- which a hidden tab freezes dead,
    // the trap this project has now hit five times -- and it meant the two sides
    // were fed by two different mechanisms, so only one of them could be right
    // at a time. Measured before this line existed: the host's roster held two
    // players and its panel drew one, because an empty list falls back to
    // "just me".
    //
    // The reconciler runs on the worker clock, so this fires whether the tab is
    // in front or not, and both sides now read the same list from the same event.
    emit({ type: 'roster', players: list });
  }

  // SPAWNS FIRST. The channel is ordered, so this order is the order a client
  // applies them in, and a pose for a duck that does not exist yet is thrown
  // away: applyPose refuses a slot the pool has not allocated. That is exactly
  // what a re-announced duck looks like -- a spawn and its true resting pose in
  // the same tick -- and with settled first the pose was the half that was
  // dropped. A slot cannot be spawned and removed in the same pass (one needs
  // it live, the other needs it dead), so the three lists never contradict.
  function drainSettled() {
    const max = Math.max(1, Math.round(N.settledBatchMax));
    while (spawned.length) {
      const batch = spawned.splice(0, max);
      broadcast({ t: MSG.EVENT, e: EV.DUCK_SPAWNED, d: batch });
      counters.spawnsSent += batch.length;
    }
    while (settled.length) {
      const batch = settled.splice(0, max);
      broadcast({ t: MSG.SETTLED, b: batch });
      counters.settledSent += batch.length;
    }
    if (gone.length) {
      broadcast({ t: MSG.SETTLED, b: [], gone: gone.slice() });
      gone.length = 0;
    }
  }

  // --- liveness ---------------------------------------------------------------
  // Everything above this line is a DIFF, and a diff has one failure mode that
  // no amount of care at the call sites can remove: it is a statement made once.
  // `gone` and DUCK_SPAWNED both ride the reliable control channel, so neither
  // is lost to a dropped packet -- measured, not assumed -- but reliability is
  // only half of the problem. The other half is that a client's copy of the
  // simulation is not inert: it runs its own producers and its own containers,
  // so it can create a duck the host never had and destroy one the host still
  // has, entirely on its own, without a single message going missing. After
  // that the digest here says the client has been told the truth, and it has
  // been -- it just is not true any more, and nothing will ever say so again.
  // Measured on the rig: one divergence, 2 s of further ticks, still diverged.
  //
  // So once a second the host stops diffing and simply states the whole set. A
  // bit per pool slot, 300 bits, 52 characters of base64: any divergence, from
  // any cause, is corrected within one interval instead of lasting the session.
  let lastLivenessAt = 0;

  function sendLiveness(t) {
    if (!maxDucks) return 0;
    const every = Math.max(0, Math.round(N.livenessIntervalMs));
    if (!every) return 0;
    if (t - lastLivenessAt < every) return 0;
    lastLivenessAt = t;
    // Built from duckActive, which reconcileDucks has just made equal to the
    // live set. Reading the pool a second time here would only give the two
    // statements two chances to disagree.
    const bits = encodeLiveBitmap(duckActive, maxDucks);
    const msg = { t: MSG.LIVENESS, n: maxDucks, bits };
    let sent = 0;
    peers.forEach((p) => {
      // A peer still being handed the join snapshot already has the whole truth
      // coming to it in one piece, on this same ordered channel.
      if (!p.peer.isOpen() || !p.snapshotSent) return;
      if (p.peer.sendControl(msg)) sent++;
    });
    if (sent) {
      counters.controlSent += sent;
      counters.livenessSent += sent;
      counters.livenessBytes += JSON.stringify(msg).length * sent;
    }
    return sent;
  }

  // A client says it is missing slots the bitmap claimed. It cannot be handed a
  // duck it has no tier or pose for, so the answer is not a new message type:
  // the host FORGETS having announced those slots, and the reconciler above
  // re-announces them next tick through the same DUCK_SPAWNED path a fresh
  // spawn uses -- with the live tier and the live pose, because that is where
  // it reads them from. One code path for "this duck exists", never two.
  function handleResync(slot, msg) {
    const p = peers.get(slot);
    const ids = Array.isArray(msg && msg.ids) ? msg.ids : null;
    if (!p || !ids || !ids.length) return 0;
    const t = now();
    const cool = Math.max(0, Math.round(N.livenessResyncCooldownMs));
    if (p.lastResyncAt && t - p.lastResyncAt < cool) {
      counters.resyncIgnored++;
      return 0;
    }
    p.lastResyncAt = t;
    counters.resyncAsked++;
    const max = Math.max(1, Math.round(N.livenessMaxResyncIds));
    let n = 0;
    for (let i = 0; i < ids.length && n < max; i++) {
      const id = ids[i] | 0;
      if (id < 0 || id >= maxDucks) continue;
      // Only a slot that is actually alive is worth re-announcing. A client
      // asking about a dead slot is asking about a removal it has already
      // applied, and clearing the digest for it would be harmless but pointless.
      if (!duckActive[id]) continue;
      duckActive[id] = 0;
      // Deliberately marked AWAKE rather than cleared. A duck that is asleep is
      // not in the state stream, so a re-announced spawn would put it back at
      // the spawn position's rotation and leave it there; setting this makes the
      // next reconcile see a sleeping duck that was awake and send the ONE
      // duckSettled that carries its true final pose -- the same mechanism, and
      // the same message, that rule 4 already exists for.
      duckAwake[id] = 1;
      n++;
    }
    counters.resyncSlots += n;
    if (n) emit({ type: 'resync', slot, slots: n });
    return n;
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
    reconcileCrank();
    reconcileMoney();
    reconcileStock();
    reconcilePrestige();
    reconcileRoster();
    drainSettled();
    // After the diffs, never before: within one tick a client must hear what
    // changed and only then be told what the whole set is, or the bitmap would
    // describe a world one message older than the messages beside it.
    sendLiveness(t);
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
      lastResyncAt: 0,
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
        // Which side of the door this client arrived on. 'lobby' means the host
        // has not pressed Start and the newcomer waits with everybody else;
        // 'playing' means the session is already running, and a latecomer goes
        // STRAIGHT INTO THE WORLD with no intro. Sessions here run for hours, so
        // making somebody wait for the next round would be worse than making
        // them miss thirty seconds of music.
        phase: typeof game.phase === 'function' ? game.phase() : 'playing',
        // The room's mode travels with the welcome, so a joining client adopts it
        // before it can buy anything.
        creative: typeof game.creative === 'function' ? game.creative() : false,
        // WHICH END OF THE MAP the second hole is at. It is rolled fresh every
        // run, so it is a fact about THIS session and not about the build --
        // a client that guessed its own would be standing on a floor with the
        // hole in a different place, which is the worst kind of desync: the
        // one where both machines are internally consistent.
        pit2Edge: typeof game.pit2Edge === 'function' ? game.pit2Edge() : null,
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
      // Not a REQUEST: it asks for nothing to HAPPEN in the world, it only says
      // "I did not receive this". It never reaches game.perform, so it cannot be
      // a way to make the host do anything, and the answer it produces is the
      // same broadcast everybody else gets.
      if (msg.t === MSG.RESYNC) { handleResync(slot, msg); return; }
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
        // The colour that player picked, travelling the same path the nick does
        // so the waiting room can draw them in it. Bounded like the nick is.
        const color = String(msg.color || '').slice(0, 16);
        if (color && typeof game.setPeerColor === 'function') game.setPeerColor(slot, color);
        rosterSeen = '';
        // A diff only sends what CHANGED, so a player who arrives mid-turn is
        // told nothing about a crank that is already at 40%. Forgetting what was
        // sent makes the next tick re-broadcast every bench once, to everyone --
        // a handful of tiny messages, and the newcomer's percentage is right
        // from its first frame instead of after somebody else turns a wheel.
        crankSeen.clear();
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
    // A ONE-SHOT broadcast, for the handful of facts that are events rather than
    // state. Everything this host normally sends is a reconciled diff -- which is
    // what makes a forgotten emit impossible -- but "the session started at host
    // clock X" is not a property of the world that can be diffed: it happens
    // once, at an instant, and the instant IS the message. It goes on the
    // reliable control channel like every other EV.
    sendEvent(ev) {
      if (!ev || !ev.e) return 0;
      return broadcast({ t: MSG.EVENT, ...ev });
    },
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
