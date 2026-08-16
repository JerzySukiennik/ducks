// Rooms and the offer/answer/ICE exchange over RTDB. Firebase is ONLY a
// mailbox: once both data channels are open, nothing else goes through it
// except the presence heartbeat.
//
// Rooms are open - there are no join codes. A public room is listed in the
// lobby branch, a private room exists only as a link. Private is the default.
//
// Every path string in this file comes from ./paths.js. Nothing here builds a
// path by hand, because the deployed security rules are generated from that
// same file and a drift between the two is silent.

import config from '../config.js';
import { getFirebase } from './firebase.js';
import { paths, limits, ICE_SIDE } from './paths.js';
import { createPeer } from './peer.js';
import { createClock } from './clock.js';

// Per PAGE LOAD, never persisted. Two tabs of one browser share an anonymous
// uid, so without this suffix they would look like the same participant and
// fight over the same reservation slot. Reading it from localStorage would
// reintroduce exactly that collision.
const TAB_TOKEN = Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

export function tabToken() {
  return TAB_TOKEN;
}

export function peerIdFor(uid) {
  return uid + ':' + TAB_TOKEN;
}

function emitter() {
  const listeners = new Set();
  return {
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit(ev) {
      listeners.forEach((fn) => {
        try {
          fn(ev);
        } catch (e) {
          if (typeof console !== 'undefined') console.warn('[net] listener threw:', e.message);
        }
      });
    },
    clear() {
      listeners.clear();
    },
  };
}

function cleanNick(nick) {
  const s = String(nick === undefined || nick === null ? '' : nick).trim();
  return (s || 'player').slice(0, limits.maxNickChars);
}

function fresh(lastSeen) {
  return typeof lastSeen === 'number' && (Date.now() - lastSeen) < limits.presenceWindowMs;
}

// A client slot is 1..maxPlayers-1; the host is slot 0 and never reserves.
function clientSlots() {
  const out = [];
  for (let n = 1; n < limits.maxPlayers; n++) out.push(n);
  return out;
}

export async function listPublicRooms() {
  const fb = await getFirebase();
  const snap = await fb.get(fb.ref(paths.lobby()));
  const val = snap.val() || {};
  return Object.keys(val)
    .map((id) => ({ id, ...val[id] }))
    .filter((r) => fresh(r.lastSeen))
    .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
}

// --- host ------------------------------------------------------------------

export async function hostRoom(opts) {
  const o = opts || {};
  const nick = cleanNick(o.nick);
  const isPublic = !!o.isPublic;
  const fb = await getFirebase();
  const uid = fb.uid;
  const pid = peerIdFor(uid);

  const roomId = fb.push(fb.ref(paths.rooms())).key;
  const metaRef = fb.ref(paths.meta(roomId));
  const roomRef = fb.ref(paths.room(roomId));
  const lobbyRef = fb.ref(paths.lobbyRoom(roomId));

  const events = emitter();
  const peers = new Map();       // slot -> peer
  const detach = [];
  let players = 1;
  let closed = false;

  await fb.set(metaRef, {
    hostUid: uid,
    hostPid: pid,
    hostNick: nick,
    players,
    public: isPublic,
    createdAt: Date.now(),
    lastSeen: Date.now(),
  });
  // The room evaporates when the host's socket drops. This is what gives the
  // clients their "host left" screen without any explicit goodbye message.
  fb.onDisconnect(roomRef).remove();

  if (isPublic) {
    await fb.set(lobbyRef, { hostUid: uid, hostNick: nick, players, lastSeen: Date.now() });
    fb.onDisconnect(lobbyRef).remove();
  }

  async function publishPresence() {
    if (closed) return;
    const beat = { players, lastSeen: Date.now() };
    try {
      await fb.update(metaRef, beat);
      if (isPublic) await fb.update(lobbyRef, { hostNick: nick, ...beat });
    } catch (e) {
      events.emit({ type: 'error', where: 'heartbeat', reason: e.message });
    }
  }

  // Not requestAnimationFrame (dead in a hidden tab) and not a bare
  // setInterval (clamped there): a worker clock, so a host who tabs away does
  // not let the room expire under him.
  const beat = createClock(config.net.heartbeatMs, publishPresence);

  function countPlayers() {
    let n = 1;
    peers.forEach((p) => {
      if (p.isOpen()) n++;
    });
    return n;
  }

  function dropPeer(slot, reason) {
    const peer = peers.get(slot);
    if (!peer) return;
    peers.delete(slot);
    peer.close();
    players = countPlayers();
    events.emit({ type: 'peerleft', slot, peer, reason: reason || null });
    publishPresence();
    // The host owns the whole room branch, so it clears the departed client's
    // mailbox and reservation itself.
    fb.remove(fb.ref(paths.peer(roomId, slot))).catch(() => {});
    fb.remove(fb.ref(paths.slot(roomId, slot))).catch(() => {});
  }

  function acceptOffer(slot, sdp) {
    if (closed || peers.has(slot)) return;
    const peer = createPeer({
      initiator: false,
      slot,
      label: 'host<-slot' + slot,
      onSignal: (kind, payload) => {
        if (kind === 'answer') {
          fb.set(fb.ref(paths.answer(roomId, slot)), payload.sdp).catch((e) =>
            events.emit({ type: 'error', where: 'answer', reason: e.message }));
        } else if (kind === 'ice') {
          const ref = fb.push(fb.ref(paths.iceFrom(roomId, slot, ICE_SIDE.host)));
          fb.set(ref, JSON.stringify(payload)).catch(() => {});
        }
      },
      onEvent: (ev) => {
        if (ev.type === 'open') {
          players = countPlayers();
          publishPresence();
        }
        if (ev.type === 'closed') dropPeer(slot, 'peer closed');
        events.emit({ ...ev, slot });
      },
    });
    peers.set(slot, peer);
    events.emit({ type: 'peer', slot, peer });
    peer.acceptOffer(sdp).catch((e) => {
      events.emit({ type: 'error', where: 'acceptOffer', slot, reason: e.message });
      dropPeer(slot, 'acceptOffer failed');
    });
  }

  clientSlots().forEach((slot) => {
    // Read permission is granted per slot, never on the peers branch as a
    // whole, so this is one listener per slot rather than one for all of them.
    detach.push(fb.onValue(fb.ref(paths.offer(roomId, slot)), (snap) => {
      const sdp = snap.val();
      if (typeof sdp === 'string' && sdp.length) acceptOffer(slot, sdp);
      else if (!sdp && peers.has(slot)) dropPeer(slot, 'offer withdrawn');
    }, (err) => events.emit({ type: 'error', where: 'offer:' + slot, reason: err.message })));

    detach.push(fb.onChildAdded(fb.ref(paths.iceFrom(roomId, slot, ICE_SIDE.client)), (snap) => {
      const peer = peers.get(slot);
      if (!peer) return;
      try {
        peer.addIce(JSON.parse(snap.val()));
      } catch (e) { /* a malformed candidate is not fatal */ }
    }, () => {}));
  });

  const session = {
    isHost: true,
    roomId,
    uid,
    pid,
    nick,
    isPublic,
    slot: 0,
    link: () => (typeof location !== 'undefined'
      ? location.origin + location.pathname + '?room=' + roomId
      : '?room=' + roomId),
    on: events.on,
    peers: () => Array.from(peers.values()),
    peerCount: () => peers.size,
    players: () => players,
    broadcastControl(msg) {
      let n = 0;
      peers.forEach((p) => {
        if (p.sendControl(msg)) n++;
      });
      return n;
    },
    broadcastControlBytes(bytes) {
      let n = 0;
      peers.forEach((p) => {
        if (p.sendControlBytes(bytes)) n++;
      });
      return n;
    },
    // produce(slot, peer) returns the bytes for that peer, or null to skip.
    startStateStream(produce) {
      const ms = Math.max(1, Math.round(1000 / config.net.hostStateHz));
      if (session._stream) session._stream.stop();
      session._stream = createClock(ms, () => {
        peers.forEach((p, slot) => {
          if (!p.isOpen()) return;
          let bytes = null;
          try {
            bytes = produce(slot, p);
          } catch (e) {
            events.emit({ type: 'error', where: 'stateProducer', slot, reason: e.message });
            return;
          }
          if (bytes) p.sendState(bytes);
        });
      });
      return ms;
    },
    stats() {
      let up = 0;
      let down = 0;
      const per = [];
      peers.forEach((p, slot) => {
        const s = p.stats();
        up += s.upBytesPerSec;
        down += s.downBytesPerSec;
        per.push({ slot, ...s });
      });
      return { role: 'host', roomId, players, upBytesPerSec: up, downBytesPerSec: down, peers: per };
    },
    async close() {
      if (closed) return;
      closed = true;
      beat.stop();
      if (session._stream) session._stream.stop();
      detach.forEach((off) => { try { off(); } catch (e) { /* ignore */ } });
      peers.forEach((p) => p.close());
      peers.clear();
      events.emit({ type: 'roomclosed', reason: 'host left' });
      events.clear();
      try {
        await fb.onDisconnect(roomRef).cancel();
        if (isPublic) await fb.onDisconnect(lobbyRef).cancel();
      } catch (e) { /* ignore */ }
      await fb.remove(roomRef).catch(() => {});
      if (isPublic) await fb.remove(lobbyRef).catch(() => {});
    },
  };

  return session;
}

// --- client ----------------------------------------------------------------

async function claimSlot(fb, roomId, uid, pid) {
  for (const slot of clientSlots()) {
    const ref = fb.ref(paths.slot(roomId, slot));
    /* eslint-disable no-await-in-loop */
    const res = await fb.runTransaction(ref, (cur) => {
      if (cur && cur.pid !== pid && fresh(cur.ts)) return undefined; // taken
      return { uid, pid, ts: Date.now() };
    });
    if (res.committed) return slot;
  }
  return -1;
}

export async function joinRoom(roomId, opts) {
  const o = opts || {};
  const nick = cleanNick(o.nick);
  const fb = await getFirebase();
  const uid = fb.uid;
  const pid = peerIdFor(uid);

  const metaSnap = await fb.get(fb.ref(paths.meta(roomId)));
  const meta = metaSnap.val();
  if (!meta) {
    const err = new Error('Room not found. It may have closed.');
    err.code = 'room-missing';
    throw err;
  }
  if (!fresh(meta.lastSeen)) {
    const err = new Error('Room is stale - the host stopped answering.');
    err.code = 'room-stale';
    throw err;
  }

  const slot = await claimSlot(fb, roomId, uid, pid);
  if (slot < 0) {
    const err = new Error('Room is full (' + limits.maxPlayers + ' players).');
    err.code = 'room-full';
    throw err;
  }

  const events = emitter();
  const detach = [];
  const slotRef = fb.ref(paths.slot(roomId, slot));
  const peerRef = fb.ref(paths.peer(roomId, slot));
  let closed = false;
  let answered = false;
  // The host's onDisconnect deletes the whole room branch, and the moment it
  // does, this client no longer owns the slot it is listening to - so every
  // listener still attached turns into a permission_denied. That is the room
  // ending, not an error worth showing a player, so the mailbox is detached
  // the instant the room goes away and later failures are swallowed.
  let signalDown = false;

  function signalError(where, reason) {
    if (signalDown || closed) return;
    events.emit({ type: 'error', where, reason });
  }

  // Losing read permission on our own slot means the room branch was deleted
  // under us - i.e. the host is gone. RTDB delivers that denial BEFORE the meta
  // listener notices the deletion, so it has to be classified here or it shows
  // up as a raw "permission_denied" in front of a player.
  function listenerError(where, err) {
    const text = String((err && err.code) || '') + ' ' + String((err && err.message) || '');
    if (/permission[_-]denied/i.test(text)) {
      roomGone('host left');
      return;
    }
    signalError(where, err && err.message ? err.message : String(err));
  }

  function roomGone(reason) {
    if (closed || signalDown) return;
    events.emit({ type: 'roomclosed', reason });
    teardownSignalling();
  }

  function teardownSignalling() {
    if (signalDown) return;
    signalDown = true;
    beat.stop();
    detach.forEach((off) => { try { off(); } catch (e) { /* ignore */ } });
    detach.length = 0;
  }

  fb.onDisconnect(slotRef).remove();
  fb.onDisconnect(peerRef).remove();
  // Whatever the previous occupant of this slot left behind is ours to clear.
  await fb.remove(peerRef).catch(() => {});

  const beat = createClock(config.net.heartbeatMs, () => {
    if (closed || signalDown) return;
    fb.set(slotRef, { uid, pid, ts: Date.now() }).catch((e) => listenerError('heartbeat', e));
  });

  const peer = createPeer({
    initiator: true,
    slot,
    label: 'slot' + slot + '->host',
    onSignal: (kind, payload) => {
      if (signalDown) return;
      if (kind === 'offer') {
        fb.set(fb.ref(paths.offer(roomId, slot)), payload.sdp).catch((e) => signalError('offer', e.message));
      } else if (kind === 'ice') {
        const ref = fb.push(fb.ref(paths.iceFrom(roomId, slot, ICE_SIDE.client)));
        fb.set(ref, JSON.stringify(payload)).catch(() => {});
      }
    },
    onEvent: (ev) => events.emit({ ...ev, slot }),
  });

  detach.push(fb.onValue(fb.ref(paths.answer(roomId, slot)), (snap) => {
    const sdp = snap.val();
    if (typeof sdp !== 'string' || !sdp.length || answered) return;
    answered = true;
    peer.acceptAnswer(sdp).catch((e) => signalError('acceptAnswer', e.message));
  }, (err) => listenerError('answer', err)));

  detach.push(fb.onChildAdded(fb.ref(paths.iceFrom(roomId, slot, ICE_SIDE.host)), (snap) => {
    try {
      peer.addIce(JSON.parse(snap.val()));
    } catch (e) { /* a malformed candidate is not fatal */ }
  }, () => {}));

  // The host's onDisconnect wipes the whole room, so meta going away IS the
  // "host closed the tab" signal. No goodbye message is needed or trusted.
  detach.push(fb.onValue(fb.ref(paths.meta(roomId)), (snap) => {
    if (snap.exists() || closed || signalDown) return;
    roomGone('host left');
  }, () => {}));

  await peer.start();

  const session = {
    isHost: false,
    roomId,
    uid,
    pid,
    nick,
    slot,
    hostNick: meta.hostNick || 'host',
    on: events.on,
    peer: () => peer,
    peers: () => [peer],
    sendControl: (msg) => peer.sendControl(msg),
    sendControlBytes: (bytes) => peer.sendControlBytes(bytes),
    startStateStream(produce) {
      return peer.startStateStream(config.net.clientStateHz, produce);
    },
    stats() {
      const s = peer.stats();
      return {
        role: 'client',
        roomId,
        slot,
        upBytesPerSec: s.upBytesPerSec,
        downBytesPerSec: s.downBytesPerSec,
        peers: [{ slot, ...s }],
      };
    },
    async close() {
      if (closed) return;
      closed = true;
      teardownSignalling();
      peer.close();
      events.clear();
      try {
        await fb.onDisconnect(slotRef).cancel();
        await fb.onDisconnect(peerRef).cancel();
      } catch (e) { /* ignore */ }
      await fb.remove(peerRef).catch(() => {});
      await fb.remove(slotRef).catch(() => {});
    },
  };

  return session;
}

// Convenience for the UI layer: neither of these ever rejects with a raw
// Firebase error, and neither can leave the game without a single-player
// fallback.
export async function tryHostRoom(opts) {
  try {
    return { ok: true, session: await hostRoom(opts) };
  } catch (e) {
    return { ok: false, error: e.message, code: e.code || 'failed' };
  }
}

export async function tryJoinRoom(roomId, opts) {
  try {
    return { ok: true, session: await joinRoom(roomId, opts) };
  } catch (e) {
    return { ok: false, error: e.message, code: e.code || 'failed' };
  }
}
