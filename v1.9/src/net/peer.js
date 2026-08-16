// One WebRTC link, two data channels. Everything above this file talks in
// messages and bytes and never touches RTCPeerConnection.
//
//   control  reliable, ordered   - hello, full snapshot, requests, world events
//   state    unreliable, unordered - the 20/30 Hz stream of moving bodies
//
// Three traps are handled here on purpose, because all three cost a full
// debugging session in an earlier project:
//   1. ICE candidates that arrive before setRemoteDescription resolves are
//      lost unless they are buffered.
//   2. A channel handed to ondatachannel can ALREADY be open, so onopen will
//      never fire for it.
//   3. Both ends must agree on channel identity; the answerer creates none.

import config from '../config.js';
import { createClock } from './clock.js';

const CONTROL = 'control';
const STATE = 'state';

function now() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function createRate(windowMs) {
  let bytes = 0;
  let total = 0;
  let mark = now();
  let last = 0;
  return {
    add(n) {
      bytes += n;
      total += n;
    },
    sample() {
      const t = now();
      const dt = t - mark;
      if (dt >= windowMs) {
        last = (bytes * 1000) / dt;
        bytes = 0;
        mark = t;
      }
      return last;
    },
    total: () => total,
  };
}

function byteLength(payload) {
  if (typeof payload === 'string') return payload.length;
  if (payload && payload.byteLength !== undefined) return payload.byteLength;
  return 0;
}

export function createPeer(opts) {
  const o = opts || {};
  const initiator = !!o.initiator;
  const emit = typeof o.onEvent === 'function' ? o.onEvent : () => {};
  const onSignal = typeof o.onSignal === 'function' ? o.onSignal : () => {};
  const label = o.label || (initiator ? 'client' : 'host');

  const pc = new RTCPeerConnection({
    iceServers: o.iceServers || config.net.iceServers,
    // No TURN, so there is nothing to relay through; keep the candidate set
    // small and let the pair fail honestly if both ends are behind symmetric
    // NAT.
    iceCandidatePoolSize: 0,
  });

  const channels = { control: null, state: null };
  const opened = { control: false, state: false };
  const up = createRate(config.net.rateWindowMs);
  const down = createRate(config.net.rateWindowMs);

  // Trap 1: everything that arrives before the remote description resolves
  // goes in here, and is replayed the moment it does.
  const pendingIce = [];
  let remoteReady = false;
  let closed = false;
  let linkState = 'new';
  let streamTimer = null;
  let dropped = 0;
  const openedAt = { control: 0, state: 0 };
  const t0 = now();

  let deadline = setTimeout(() => {
    if (linkState !== 'open') fail('handshake timed out after ' + config.net.peerTimeoutMs + ' ms');
  }, config.net.peerTimeoutMs);

  function setState(next, detail) {
    if (linkState === next || closed) return;
    linkState = next;
    emit({ type: 'status', state: next, detail: detail || null, peer: api });
  }

  function fail(reason) {
    if (closed) return;
    emit({ type: 'error', reason, peer: api });
    setState('failed', reason);
    close();
  }

  function bothOpen() {
    return opened.control && opened.state;
  }

  function markOpen(kind) {
    if (opened[kind]) return;
    opened[kind] = true;
    openedAt[kind] = now() - t0;
    emit({ type: 'channel', channel: kind, peer: api });
    if (bothOpen()) {
      clearTimeout(deadline);
      deadline = null;
      setState('open');
      emit({ type: 'open', peer: api });
    }
  }

  function wire(kind, ch) {
    channels[kind] = ch;
    ch.binaryType = 'arraybuffer';
    ch.onmessage = (ev) => {
      const data = ev.data;
      down.add(byteLength(data));
      if (kind === CONTROL) {
        let msg = data;
        if (typeof data === 'string') {
          try {
            msg = JSON.parse(data);
          } catch (e) {
            emit({ type: 'error', reason: 'bad control JSON: ' + e.message, peer: api });
            return;
          }
          emit({ type: 'control', msg, peer: api });
        } else {
          emit({ type: 'controlBytes', bytes: data, peer: api });
        }
      } else {
        emit({ type: 'state', bytes: data, peer: api });
      }
    };
    ch.onclose = () => {
      opened[kind] = false;
      if (!closed) setState('closed', kind + ' channel closed');
    };
    ch.onerror = (ev) => {
      const e = ev && ev.error;
      const msg = (e && e.message) || 'unknown';
      // "User-Initiated Abort, reason=Close called" is what EVERY normal remote
      // close reports through onerror. Reporting it as an error made a peer
      // hanging up look like a fault, twice per peer.
      if (closed || /User-Initiated Abort/i.test(msg)) {
        if (!closed) setState('closed', kind + ' channel closed by the other end');
        return;
      }
      emit({ type: 'error', reason: kind + ' channel: ' + msg, peer: api });
    };
    // Trap 2: by the time we get here the channel may already be open, in
    // which case onopen has already fired into the void.
    if (ch.readyState === 'open') markOpen(kind);
    else ch.onopen = () => markOpen(kind);
  }

  pc.onicecandidate = (ev) => {
    if (!ev.candidate) return;
    onSignal('ice', ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate);
  };
  pc.oniceconnectionstatechange = () => {
    const s = pc.iceConnectionState;
    if (s === 'failed') fail('ICE failed (no TURN server: symmetric NAT on both ends cannot be traversed)');
    else if (s === 'disconnected' && linkState === 'open') setState('interrupted', 'ice disconnected');
    else if (s === 'connected' && linkState === 'interrupted') setState('open');
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') fail('peer connection failed');
    if (pc.connectionState === 'closed' && !closed) setState('closed', 'peer connection closed');
  };
  // The answerer creates no channels; it receives both.
  pc.ondatachannel = (ev) => {
    const ch = ev.channel;
    if (ch.label === CONTROL || ch.label === STATE) wire(ch.label, ch);
    else ch.close();
  };

  async function flushIce() {
    remoteReady = true;
    while (pendingIce.length) {
      const c = pendingIce.shift();
      try {
        await pc.addIceCandidate(c);
      } catch (e) {
        emit({ type: 'error', reason: 'addIceCandidate: ' + e.message, peer: api });
      }
    }
  }

  const api = {
    label,
    initiator,
    id: o.id || null,
    slot: o.slot === undefined ? null : o.slot,
    nick: o.nick || null,

    state: () => linkState,
    isOpen: () => linkState === 'open',

    // Initiator only. Creates both channels, then the offer.
    async start() {
      if (!initiator) throw new Error('only the initiator creates the offer');
      setState('connecting');
      wire(CONTROL, pc.createDataChannel(CONTROL, { ordered: true }));
      wire(STATE, pc.createDataChannel(STATE, { ordered: false, maxRetransmits: 0 }));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      onSignal('offer', { type: offer.type, sdp: pc.localDescription.sdp });
      return pc.localDescription.sdp;
    },

    // Answerer: pass the offer, get the answer signalled back out.
    async acceptOffer(sdp) {
      setState('connecting');
      await pc.setRemoteDescription({ type: 'offer', sdp });
      await flushIce();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      onSignal('answer', { type: answer.type, sdp: pc.localDescription.sdp });
      return pc.localDescription.sdp;
    },

    // Initiator: the answer came back over the signalling channel.
    async acceptAnswer(sdp) {
      if (pc.signalingState === 'stable') return false;
      await pc.setRemoteDescription({ type: 'answer', sdp });
      await flushIce();
      return true;
    },

    // Trap 1 lives here: before the remote description resolves this only
    // queues. Calling addIceCandidate early throws and loses the candidate.
    async addIce(candidate) {
      if (!candidate) return;
      if (!remoteReady) {
        pendingIce.push(candidate);
        return;
      }
      try {
        await pc.addIceCandidate(candidate);
      } catch (e) {
        emit({ type: 'error', reason: 'addIceCandidate: ' + e.message, peer: api });
      }
    },

    sendControl(msg) {
      const ch = channels.control;
      if (!ch || ch.readyState !== 'open') return false;
      const text = typeof msg === 'string' ? msg : JSON.stringify(msg);
      ch.send(text);
      up.add(text.length);
      return true;
    },

    // Snapshot bytes from src/net/snapshot.js travel as-is; this file never
    // inspects them.
    sendControlBytes(bytes) {
      const ch = channels.control;
      if (!ch || ch.readyState !== 'open') return false;
      ch.send(bytes);
      up.add(byteLength(bytes));
      return true;
    },

    sendState(bytes) {
      const ch = channels.state;
      if (!ch || ch.readyState !== 'open') return false;
      // Dropping under backpressure is correct for an unreliable channel:
      // the next tick carries fresher data than the one queued behind it.
      if (ch.bufferedAmount > config.net.stateBackpressureBytes) {
        dropped++;
        return false;
      }
      ch.send(bytes);
      up.add(byteLength(bytes));
      return true;
    },

    // rAF is dead in a hidden tab and setInterval is clamped to ~1 Hz there,
    // so the stream is driven by a worker clock. See ./clock.js.
    startStateStream(hz, produce) {
      this.stopStateStream();
      const ms = Math.max(1, Math.round(1000 / hz));
      streamTimer = createClock(ms, () => {
        if (linkState !== 'open') return;
        let bytes = null;
        try {
          bytes = produce();
        } catch (e) {
          emit({ type: 'error', reason: 'state producer: ' + e.message, peer: api });
          return;
        }
        if (bytes) api.sendState(bytes);
      });
      return ms;
    },

    stopStateStream() {
      if (streamTimer) streamTimer.stop();
      streamTimer = null;
    },

    stats() {
      return {
        state: linkState,
        upBytesPerSec: up.sample(),
        downBytesPerSec: down.sample(),
        upBytes: up.total(),
        downBytes: down.total(),
        controlOpenMs: openedAt.control,
        stateOpenMs: openedAt.state,
        bufferedState: channels.state ? channels.state.bufferedAmount : 0,
        droppedStateFrames: dropped,
        iceConnection: pc.iceConnectionState,
        connection: pc.connectionState,
        queuedIce: pendingIce.length,
      };
    },

    async selectedCandidatePair() {
      try {
        const report = await pc.getStats();
        let pair = null;
        const byId = new Map();
        report.forEach((r) => byId.set(r.id, r));
        report.forEach((r) => {
          if (r.type === 'candidate-pair' && (r.selected || r.state === 'succeeded')) pair = r;
        });
        if (!pair) return null;
        const local = byId.get(pair.localCandidateId);
        const remote = byId.get(pair.remoteCandidateId);
        return {
          local: local ? local.candidateType : null,
          remote: remote ? remote.candidateType : null,
          rttMs: pair.currentRoundTripTime ? pair.currentRoundTripTime * 1000 : null,
        };
      } catch (e) {
        return null;
      }
    },

    close() {
      close();
    },

    raw: () => pc,
  };

  function close() {
    if (closed) return;
    closed = true;
    api.stopStateStream();
    if (deadline) clearTimeout(deadline);
    deadline = null;
    try {
      if (channels.control) channels.control.close();
      if (channels.state) channels.state.close();
    } catch (e) { /* already gone */ }
    try {
      pc.close();
    } catch (e) { /* already gone */ }
    opened.control = false;
    opened.state = false;
    if (linkState !== 'failed') linkState = 'closed';
    emit({ type: 'closed', peer: api });
  }

  return api;
}
