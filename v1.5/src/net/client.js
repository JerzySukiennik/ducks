// The client. It predicts exactly one thing -- its own capsule -- and believes
// the host about everything else.
//
// WHY ONLY THE CAPSULE
// Prediction is worth its cost only where the alternative is unplayable, and
// that is one place: your own movement, where a round trip of input latency is
// immediately obvious. A duck arriving 100 ms late is not obvious at all, so
// every other body here is INTERPOLATED between two host frames rather than
// simulated forward. Interpolation cannot diverge; prediction always can, and
// every predicted body is a body that needs reconciling.
//
// WHAT "RECONCILED" MEANS HERE, AND THE MISTAKE THAT MADE WALKING FEEL HEAVY
// The host's pose for our own capsule is not a statement about where we are
// now. It is where we WERE, one round trip ago: the host integrated it from an
// input frame that took the uplink to arrive, and the answer took the downlink
// to come back. Treating that pose as "now" and easing towards it every frame
// does not correct anything -- it deletes the prediction. Measured on the real
// client at 40 ms one way, walking a straight line: a correction on 100% of
// frames, mean error 0.067 m (well under the 0.25 m the contract calls a
// disagreement), and the player ending up 0.55 m behind their own input. That
// is what the owner felt as resistance.
//
// So the error is measured against WHERE WE WERE, not where we are. This file
// keeps a short history of its own capsule and compares the host's pose to the
// nearest point on that path (config.net.reconcileHistoryMs). If the host's
// pose lies on the path we actually walked, within
// config.net.reconcileMatchMeters, then the host agrees with us and is simply
// behind -- there is nothing to correct and nothing is applied. What is left
// over after that match is real disagreement, and only that is corrected:
// eased in at config.net.reconcileSoftFactor per authoritative sample, or hard
// set past config.net.reconcileHardMeters, where easing a metre of error just
// means being wrong slowly.
//
// It is also done once per host sample rather than once per rendered frame. The
// stream is 20 Hz; applying the same 50 ms old disagreement three times before
// a newer one arrives triples it.
//
// REQUESTS, NOT ACTIONS (frozen contract rule 6)
// Everything else the player does becomes a question on the reliable channel.
// This file has no code path that applies a request locally, and it does not
// have one because the host's answer does not come back as an answer -- it
// comes back as the world, in the same reconciled broadcast every other player
// receives. The one agreed exception is the build hologram, which never reaches
// this file: it is a preview, not a commitment.
//
// No three.js here, and nothing branches on a row's `id`.

import config from '../config.js';
import { createClock } from './clock.js';
import { createSnapshotCodec } from './snapshot.js';
import {
  MSG, EV, FRAME, wire, decodeWireId, WIRE_KIND, encodeInputWindow, INPUT_BYTES, PROTOCOL,
} from './protocol.js';

function now() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

// Nlerp with a sign fix. Slerp buys nothing at 20 Hz between two poses of the
// same duck, and it costs a trig call per body per frame.
function nlerpInto(out, a, b, t) {
  let bx = b.x, by = b.y, bz = b.z, bw = b.w;
  if (a.x * bx + a.y * by + a.z * bz + a.w * bw < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; }
  const x = a.x + (bx - a.x) * t;
  const y = a.y + (by - a.y) * t;
  const z = a.z + (bz - a.z) * t;
  const w = a.w + (bw - a.w) * t;
  const l = Math.hypot(x, y, z, w) || 1;
  out.x = x / l; out.y = y / l; out.z = z / l; out.w = w / l;
  return out;
}

export function createClient({ session, game, onEvent }) {
  if (!session || session.isHost) throw new Error('[client] needs a client session');
  if (!game) throw new Error('[client] needs a game adapter');

  const N = config.net;
  const emit = typeof onEvent === 'function' ? onEvent : () => {};
  const codec = createSnapshotCodec(config);
  const peer = session.peer();
  const mySlot = session.slot;

  // Two samples per body is all interpolation needs, and holding more would only
  // let a body drift further behind while pretending to be smooth.
  const track = new Map();   // netId -> { t0,x0,y0,z0,q0, t1,x1,y1,z1,q1 }
  const seen = new Set();

  let joined = false;
  let ready = false;         // the join snapshot has been loaded
  let hostClock = 0;
  let lastFrameAt = 0;
  let lastPlayersAt = 0;
  // -1 means "no frame accepted yet"; frame.seq is a u32 so 0 is a legitimate
  // first value and must not be mistaken for "unset".
  let lastSeq = -1;
  let inputSeq = 0;
  let closed = false;
  let reqId = 1;
  let roster = [];
  let lastReject = null;
  const pending = new Map();  // request id -> { action, at }

  const counters = {
    framesIn: 0,
    worldFrames: 0,
    playerFrames: 0,
    bodiesApplied: 0,
    settledApplied: 0,
    spawnsApplied: 0,
    eventsApplied: 0,
    requestsSent: 0,
    rejects: 0,
    hardCorrections: 0,
    softCorrections: 0,
    // A frame that lost the race against one the host sent later, on the
    // unordered/lossy state channel. Discarded before it can touch anything.
    staleFramesDropped: 0,
    // Samples where the host's pose lay on the path we had already walked, so
    // nothing was applied. On a healthy link this is nearly all of them, and a
    // number that falls is the first sign prediction and authority are drifting
    // apart for a reason that is not latency.
    agreedFrames: 0,
    worstCorrection: 0,
    // The part of the error that was NOT explained by our own recent path --
    // the only quantity a correction is ever computed from.
    worstDivergence: 0,
    correctionMeters: 0,
    inputsSent: 0,
    // What the redundancy window actually costs, measured rather than assumed:
    // bytes and records put on the wire for input alone.
    inputBytesSent: 0,
    inputRecordsSent: 0,
    staleBodies: 0,
  };

  // --- the join snapshot ------------------------------------------------------
  // Reassembled from chunks because a single SCTP message past ~64 KB is refused
  // or silently fatal depending on the browser, and 300 ducks of JSON is well
  // past it. It is `state.serialize()` and therefore byte-identical to
  // debugSnapshot(), which is what makes gate E-F a comparison rather than a
  // conversion.
  let chunks = null;

  function beginSnapshot(msg) {
    chunks = { want: msg.chunks | 0, chars: msg.chars | 0, parts: new Array(msg.chunks | 0), got: 0 };
    emit({ type: 'snapshotBegin', chunks: chunks.want, chars: chunks.chars });
  }

  function addChunk(msg) {
    if (!chunks) return;
    if (chunks.parts[msg.i] === undefined) chunks.got++;
    chunks.parts[msg.i] = msg.s;
  }

  function endSnapshot() {
    if (!chunks) return;
    const c = chunks;
    chunks = null;
    if (c.got !== c.want) {
      emit({ type: 'error', where: 'snapshot', reason: `got ${c.got} of ${c.want} chunks` });
      return;
    }
    const text = c.parts.join('');
    let snap = null;
    try {
      snap = JSON.parse(text);
    } catch (e) {
      emit({ type: 'error', where: 'snapshot', reason: 'bad JSON: ' + e.message });
      return;
    }
    let result = null;
    try {
      result = game.load(snap);
    } catch (e) {
      emit({ type: 'error', where: 'snapshotLoad', reason: e.message });
      return;
    }
    ready = true;
    hostClock = snap.clock;
    emit({ type: 'ready', chars: text.length, result, clock: snap.clock });
  }

  // --- control ----------------------------------------------------------------

  function onControl(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case MSG.WELCOME:
        joined = true;
        emit({ type: 'welcome', slot: msg.slot, hostNick: msg.hostNick, stateHz: msg.stateHz });
        return;
      case MSG.SNAPSHOT_BEGIN: beginSnapshot(msg); return;
      case MSG.SNAPSHOT_CHUNK: addChunk(msg); return;
      case MSG.SNAPSHOT_END: endSnapshot(); return;
      case MSG.PLAYERS:
        roster = Array.isArray(msg.players) ? msg.players : [];
        game.setRoster(roster);
        emit({ type: 'roster', players: roster });
        return;
      case MSG.SETTLED: applySettled(msg); return;
      case MSG.EVENT: applyEvent(msg); return;
      case MSG.REJECT: {
        counters.rejects++;
        lastReject = { id: msg.id, action: msg.a, reason: msg.reason, at: now() };
        pending.delete(msg.id);
        game.onReject(lastReject);
        emit({ type: 'reject', ...lastReject });
        return;
      }
      case MSG.BYE:
        emit({ type: 'hostbye', reason: msg.reason || 'host left' });
        return;
      default:
        return;
    }
  }

  // A body that has settled leaves the state stream, so its FINAL pose has to
  // arrive on the reliable channel or it freezes wherever the last lossy frame
  // happened to put it -- which is never quite where it stopped.
  function applySettled(msg) {
    const list = msg.b || [];
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const id = decodeWireId(r[0]);
      if (!id) continue;
      game.applyPose(id.kind, id.id, r[1], r[2], r[3], r[4], r[5], r[6], r[7], true);
      track.delete(r[0]);
      counters.settledApplied++;
    }
    const goneList = msg.gone || [];
    for (let i = 0; i < goneList.length; i++) {
      const id = decodeWireId(goneList[i]);
      if (!id) continue;
      game.removeBody(id.kind, id.id);
      track.delete(goneList[i]);
    }
  }

  function applyEvent(msg) {
    counters.eventsApplied++;
    switch (msg.e) {
      case EV.DUCK_SPAWNED: {
        const d = msg.d || [];
        for (let i = 0; i < d.length; i++) {
          game.spawnDuck(d[i].s, d[i].t, d[i].p[0], d[i].p[1], d[i].p[2]);
          counters.spawnsApplied++;
        }
        return;
      }
      case EV.PLACED:
        game.applyPlaced(msg.key, msg.netId, msg.p[0], msg.p[1], msg.p[2], msg.yaw, !!msg.free);
        return;
      case EV.DEMOLISHED: game.applyDemolished(msg.key); return;
      case EV.PROP_DROPPED:
        game.applyPropDropped(msg.key, msg.netId, msg.p, msg.q);
        return;
      case EV.PROP_TAKEN: game.applyPropTaken(msg.key); return;
      case EV.CRANK: game.applyCrank(msg.key, msg.p); return;
      case EV.MONEY: game.applyMoney(msg.money, msg.earned); return;
      // The vendor's shelf. A client NEVER rolls one of its own -- its stock
      // module only ticks a countdown for display -- so this is the single door
      // through which its idea of what is for sale can change.
      case EV.STOCK: game.applyStock(msg); return;
      // The team prestiged. The machines and the money are already on their way
      // through the reconciler's own diffs; this is the multiplier and the shop
      // levels, which are the two facts no diff can carry.
      case EV.PRESTIGE: game.applyPrestige(msg); return;
      default: return;
    }
  }

  // --- the state stream --------------------------------------------------------

  function onState(bytes) {
    let frame = null;
    try {
      frame = codec.decode(bytes);
    } catch (e) {
      emit({ type: 'error', where: 'decode', reason: e.message });
      return;
    }
    counters.framesIn++;
    // The state channel is `{ordered:false, maxRetransmits:0}` by design, so a
    // frame the host sent earlier can arrive after one it sent later. The line
    // below this comment used to be `if (t < s.t1) continue`, comparing LOCAL
    // ARRIVAL time -- which only ever increases, so it could never actually
    // detect reordering. A stale frame landing late silently overwrote the
    // tracked position with an OLD one, and when reconcile() then measured the
    // (correct, current) capsule against that stale sample, it read as a real
    // divergence and pulled the player backward: a teleport with no visible
    // cause, exactly as reported. `frame.seq` is a wrapping counter the host
    // already sends for this and nothing was reading it. Comparison is
    // wraparound-safe 32-bit signed subtraction, the standard trick for a
    // counter that wraps.
    if (lastSeq !== -1 && (((frame.seq - lastSeq) | 0)) <= 0) {
      counters.staleFramesDropped++;
      return;
    }
    lastSeq = frame.seq;
    const t = now();
    hostClock = frame.clock;
    if (frame.flags === FRAME.PLAYERS) {
      counters.playerFrames++;
      lastPlayersAt = t;
    } else {
      counters.worldFrames++;
      lastFrameAt = t;
    }
    const players = frame.flags === FRAME.PLAYERS;
    const own = ownNetId();
    for (let i = 0; i < frame.bodies.length; i++) {
      const b = frame.bodies[i];
      // Another player's capsule is handed STRAIGHT to the avatar layer, with
      // the time it arrived. That layer keeps its own history and does its own
      // interpolation, so passing it an already-interpolated pose would be
      // smoothing a smoothed signal -- which reads as a lag nobody can locate,
      // because neither half of it is wrong on its own. Only the client's OWN
      // capsule is kept here, and only because reconcile() needs it.
      if (players && b.netId !== own) {
        const id = decodeWireId(b.netId);
        if (id && id.kind === WIRE_KIND.PLAYER) {
          game.playerSample(id.id, b.x, b.y, b.z, b.qx, b.qy, b.qz, b.qw, t);
        }
        continue;
      }
      let s = track.get(b.netId);
      if (!s) {
        s = {
          t0: t, x0: b.x, y0: b.y, z0: b.z, q0: { x: b.qx, y: b.qy, z: b.qz, w: b.qw },
          t1: t, x1: b.x, y1: b.y, z1: b.z, q1: { x: b.qx, y: b.qy, z: b.qz, w: b.qw },
        };
        track.set(b.netId, s);
        seen.add(b.netId);
        continue;
      }
      // The real reordering guard is the frame.seq check at the top of
      // onState -- a whole frame that lost the race is dropped before it gets
      // here. This is just the harmless leftover invariant: within one
      // accepted frame, t (this call's now()) cannot be older than a t stamped
      // by a previous accepted frame.
      if (t < s.t1) continue;
      s.t0 = s.t1; s.x0 = s.x1; s.y0 = s.y1; s.z0 = s.z1;
      s.q0.x = s.q1.x; s.q0.y = s.q1.y; s.q0.z = s.q1.z; s.q0.w = s.q1.w;
      s.t1 = t; s.x1 = b.x; s.y1 = b.y; s.z1 = b.z;
      s.q1.x = b.qx; s.q1.y = b.qy; s.q1.z = b.qz; s.q1.w = b.qw;
    }
  }

  // --- what the frame calls ----------------------------------------------------

  const q = { x: 0, y: 0, z: 0, w: 1 };
  const ownNetId = () => wire.player(mySlot);

  // Called once per rendered frame, AFTER the local world has stepped: the host
  // is the authority, so whatever the local solver did to a remote body is
  // overwritten by what the host says about it.
  function applyRemote() {
    if (!ready) return 0;
    const t = now() - N.interpDelayMs;
    let n = 0;
    const own = ownNetId();
    track.forEach((s, netId) => {
      if (netId === own) return;         // the local capsule is predicted, not applied
      const id = decodeWireId(netId);
      if (!id) return;
      const span = s.t1 - s.t0;
      let a = 1;
      if (span > 1e-3) a = Math.max(0, Math.min(1, (t - s.t0) / span));
      // Past the hold window there is nothing newer to move towards, so the body
      // holds its last known pose. Extrapolating here is what slides a settled
      // duck across the plate when a frame goes missing.
      if (t > s.t1 + N.interpHoldMs) { counters.staleBodies++; a = 1; }
      const x = s.x0 + (s.x1 - s.x0) * a;
      const y = s.y0 + (s.y1 - s.y0) * a;
      const z = s.z0 + (s.z1 - s.z0) * a;
      nlerpInto(q, s.q0, s.q1, a);
      game.applyPose(id.kind, id.id, x, y, z, q.x, q.y, q.z, q.w, false);
      n++;
    });
    counters.bodiesApplied += n;
    return n;
  }

  // --- our own recent path ------------------------------------------------------
  // Where this capsule ACTUALLY was, one entry per rendered frame, kept for
  // config.net.reconcileHistoryMs. Recorded after any correction, so an entry is
  // a position we really occupied rather than one we predicted and then moved
  // away from -- otherwise a correction would be measured again against the path
  // it has already been applied to, and applied twice.
  const path = [];   // { t, x, y, z }, oldest first

  function recordPath(t) {
    const p = game.ownPosition();
    if (!p) return false;
    path.push({ t, x: p.x, y: p.y, z: p.z });
    const cutoff = t - N.reconcileHistoryMs;
    while (path.length > 2 && path[0].t < cutoff) path.shift();
    return true;
  }

  // Distance from a point to the segment ab, because the path is sampled at
  // frame rate and the host's pose almost never lands exactly on a sample. At
  // walking speed a frame is 87 mm of travel, so nearest-SAMPLE would report up
  // to 43 mm of "disagreement" that is only the gap between two samples.
  function distToSegment(p, a, b) {
    const ax = b.x - a.x, ay = b.y - a.y, az = b.z - a.z;
    const len2 = ax * ax + ay * ay + az * az;
    let u = 0;
    if (len2 > 1e-12) {
      u = ((p.x - a.x) * ax + (p.y - a.y) * ay + (p.z - a.z) * az) / len2;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
    }
    const cx = a.x + ax * u, cy = a.y + ay * u, cz = a.z + az * u;
    return { d: Math.hypot(p.x - cx, p.y - cy, p.z - cz), x: cx, y: cy, z: cz };
  }

  // How far the host's pose is off the path we walked, and in which direction.
  // Only entries no newer than the moment the sample arrived are eligible: a
  // host pose cannot be evidence about a step we had not taken yet.
  function offPath(hx, hy, hz, at) {
    let best = null;
    const p = { x: hx, y: hy, z: hz };
    for (let i = 0; i < path.length - 1; i++) {
      if (path[i].t > at) break;
      const c = distToSegment(p, path[i], path[i + 1]);
      if (!best || c.d < best.d) best = c;
    }
    if (!best && path.length) {
      const a = path[path.length - 1];
      best = { d: Math.hypot(hx - a.x, hy - a.y, hz - a.z), x: a.x, y: a.y, z: a.z };
    }
    return best;
  }

  // The client's own capsule, and the only prediction in the project. Runs once
  // per authoritative sample, not once per frame.
  let lastOwnSampleAt = -1;

  function reconcile() {
    if (!ready) return null;
    const s = track.get(ownNetId());
    if (!s) return null;
    if (s.t1 === lastOwnSampleAt) return { mode: 'waiting' };
    lastOwnSampleAt = s.t1;
    const local = game.ownPosition();
    if (!local) return null;
    // Kept for the overlay and for anyone comparing the two numbers: this is the
    // raw distance between the host's pose and where we are NOW, which at any
    // latency is mostly just how far we have walked since. It is deliberately
    // not what a correction is computed from.
    const err = Math.hypot(s.x1 - local.x, s.y1 - local.y, s.z1 - local.z);
    if (err > counters.worstCorrection) counters.worstCorrection = err;

    // No history yet -- the first sample after a join, where reconcile() runs
    // before the frame that would have recorded anything. The honest reading
    // then is the raw error against where we are, which is also exactly what
    // this file did before there was a history at all.
    const match = offPath(s.x1, s.y1, s.z1, s.t1)
      || { d: err, x: local.x, y: local.y, z: local.z };
    const off = match.d;
    if (off > counters.worstDivergence) counters.worstDivergence = off;

    // The host's pose sits on the path we walked. It agrees with us and is
    // behind, which is what a host always is. Nothing to correct.
    if (off <= N.reconcileMatchMeters) {
      counters.agreedFrames++;
      return { error: err, divergence: off, mode: 'lag' };
    }
    if (off > N.reconcileHardMeters) {
      counters.hardCorrections++;
      counters.correctionMeters += err;
      game.setOwnPosition(s.x1, s.y1, s.z1, true);
      return { error: err, divergence: off, mode: 'hard' };
    }
    // Real disagreement, and only the part of it that is real: the offset from
    // the path, never the distance to a pose that is a round trip old. Applied
    // to where we are now, so the prediction keeps running underneath it.
    const k = N.reconcileSoftFactor;
    const dx = (s.x1 - match.x) * k;
    const dy = (s.y1 - match.y) * k;
    const dz = (s.z1 - match.z) * k;
    counters.softCorrections++;
    counters.correctionMeters += Math.hypot(dx, dy, dz);
    game.setOwnPosition(local.x + dx, local.y + dy, local.z + dz, false);
    return { error: err, divergence: off, mode: 'soft' };
  }

  // --- outbound ----------------------------------------------------------------

  // The last N inputs, oldest first. Every packet carries all of them, so one
  // lost packet costs nothing at all: the next one contains what it was
  // carrying. The channel stays unreliable on purpose -- a retransmitted input
  // arrives too late to be worth applying -- and the redundancy is what makes
  // that affordable. Cost, stated: N x 16 B at clientStateHz, which at the
  // configured 5 and 30 Hz is 2.34 KB/s of uplink.
  const window = [];

  function sendInput() {
    if (closed || !peer.isOpen()) return false;
    const inp = game.ownInput();
    if (!inp) return false;
    inputSeq = (inputSeq + 1) & 0xffff;
    window.push({ inp, seq: inputSeq });
    const max = Math.max(1, Math.round(N.inputWindow));
    while (window.length > max) window.shift();
    const bytes = encodeInputWindow(window);
    const ok = peer.sendState(bytes);
    if (ok) {
      counters.inputsSent++;
      counters.inputBytesSent += bytes.byteLength;
      counters.inputRecordsSent += bytes.byteLength / INPUT_BYTES;
    }
    return ok;
  }

  // rAF is dead in a hidden tab, so input goes out on a worker clock like every
  // other periodic network job in this project.
  const inputClock = createClock(Math.max(1, Math.round(1000 / N.clientStateHz)), sendInput);

  // The ONLY way this file causes anything to happen in the world. It returns
  // the request id and nothing else -- deliberately not a promise of a result,
  // because there is no result to wait for: what happened arrives later as the
  // world, in the broadcast every player receives.
  function request(action, payload) {
    if (closed || !peer.isOpen()) return null;
    const id = reqId++;
    const msg = { t: MSG.REQUEST, v: PROTOCOL.version, id, a: action, ...(payload || {}) };
    if (!peer.sendControl(msg)) return null;
    counters.requestsSent++;
    pending.set(id, { action, at: now() });
    return id;
  }

  const off = session.on((ev) => {
    if (closed) return;
    if (ev.type === 'control') { onControl(ev.msg); return; }
    if (ev.type === 'state') { onState(ev.bytes); return; }
    if (ev.type === 'open') {
      peer.sendControl({ t: MSG.HELLO, v: PROTOCOL.version, nick: session.nick, slot: mySlot });
      emit({ type: 'linkopen', slot: mySlot });
      return;
    }
    if (ev.type === 'roomclosed' || ev.type === 'closed') {
      emit({ type: 'hostgone', reason: ev.reason || 'connection closed' });
      return;
    }
    if (ev.type === 'error') emit({ type: 'error', where: 'peer', reason: ev.reason });
  });

  return {
    role: 'client',
    slot: mySlot,
    session,
    request,
    isReady: () => ready,
    isJoined: () => joined,
    roster: () => roster,
    lastReject: () => lastReject,
    // Called from the game frame, after the local world has stepped.
    postStep() {
      const n = applyRemote();
      const r = reconcile();
      // After the correction, so the history is where this capsule really was.
      recordPath(now());
      return { applied: n, reconcile: r };
    },
    // The lobby reads the room through this and never touches a peer.
    roomState() {
      return {
        role: 'client',
        roomId: session.roomId,
        slot: mySlot,
        nick: session.nick,
        hostNick: session.hostNick,
        link: (typeof location !== 'undefined'
          ? location.origin + location.pathname + '?room=' + session.roomId
          : '?room=' + session.roomId),
        players: roster,
        ready,
      };
    },
    stats(t) {
      const at = t === undefined ? now() : t;
      const link = peer.stats();
      const c = codec.stats(at);
      return {
        role: 'client',
        roomId: session.roomId,
        slot: mySlot,
        ready,
        joined,
        hostClock,
        tracked: track.size,
        msSinceWorldFrame: lastFrameAt ? at - lastFrameAt : null,
        msSincePlayerFrame: lastPlayersAt ? at - lastPlayersAt : null,
        downKBPerSecond: link.downBytesPerSec / 1024,
        upKBPerSecond: link.upBytesPerSec / 1024,
        stateFramesDecoded: c.framesSent,
        linkState: link.state,
        iceConnection: link.iceConnection,
        clockDriver: inputClock.driver,
        pendingRequests: pending.size,
        ...counters,
      };
    },
    close() {
      if (closed) return;
      closed = true;
      try { peer.sendControl({ t: MSG.BYE }); } catch (e) { /* already gone */ }
      inputClock.stop();
      if (typeof off === 'function') off();
      track.clear();
    },
  };
}

export default createClient;
