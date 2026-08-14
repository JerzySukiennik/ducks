// Binary encoding for the unreliable `state` channel: host -> client at 20 Hz,
// {ordered:false, maxRetransmits:0}.
//
// THE RULE THIS FILE EXISTS FOR: only NON-SLEEPING bodies go in the state
// stream. A duck that settles gets one `duckSettled` on the reliable `control`
// channel and then leaves the stream entirely. Without that,
// 300 ducks x 12 B x 20 Hz x 3 clients = 1.7 Mbps of upstream, which a home
// connection does not have. The filter lives in encode() itself so no caller can
// forget it.
//
// Pure bytes: no three.js, no Rapier, no DOM. Everything tunable comes from
// config.net.
//
// FRAME LAYOUT (little-endian)
//   0   u32  magic 'DUC1'
//   4   u8   protocol version
//   5   u8   flags
//   6   u16  body count
//   8   u32  sequence (wraps; the client keeps the newest, this channel is
//            unordered and lossy by design)
//   12  f32  session clock, seconds
//   16  ...  body records, 12 B each
//
// BODY RECORD (12 B)
//   0   u16  netId          -- duck pool slot, or any wire id under 65536
//   2   u16  x quantised    -- (round(x / step) + bias), 1 cm step by default
//   4   u16  y quantised
//   6   u16  z quantised
//   8   u32  rotation       -- smallest-three compressed quaternion
//              bits 30..31  index of the dropped (largest) component
//              bits 20..29  component a, 10 bits
//              bits 10..19  component b
//              bits  0..9   component c
// Velocity is deliberately absent: the client interpolates, and 12 B is the
// budget the contract's arithmetic is written against. Full velocity lives in
// the join snapshot (src/sim/state.js), which is a different job.

export const MAGIC = 0x31435544;          // 'DUC1' little-endian
export const HEADER_BYTES = 16;
export const BODY_BYTES = 12;

// Fallbacks keep this module usable standalone (a harness, a unit test). The
// authoritative copy of every one of these is the `net` block in src/config.js,
// and every key is in REQUIRED_CONFIG_KEYS, so a deleted key is fatal at boot
// rather than silently landing here. No number below appears inline in logic.
export const NET_DEFAULTS = {
  protocolVersion: 1,
  // Position quantisation. 0.01 m over a u16 covers +/-327.67 m; the plate is
  // 120 m across and the pit shaft 34 m deep, so nothing in the world can leave
  // the range. Worst-case error is half a step: 5 mm.
  positionStep: 0.01,
  positionBias: 32768,
  // Smallest-three quaternion. 10 bits over [-1/sqrt2, 1/sqrt2] is ~0.0014 per
  // component, about 0.1 degrees of angular error -- invisible on a duck.
  quatBits: 10,
  // The host's send rate. Read from config.net.hostStateHz -- the transport
  // owns that number and this module must not grow a second copy of it.
  hostStateHz: 20,
  // Sliding window for the bytes/second counter the overlay reads. Same key the
  // transport's own counters use, for the same reason.
  rateWindowMs: 2000,
  // Hard ceiling on one frame. 512 x 12 B + 16 = 6160 B, comfortably inside a
  // 64 KB SCTP message and far inside any sane MTU-fragmented datagram.
  maxBodiesPerFrame: 512,
  // RELEVANCE CULLING. The sleeping filter above is necessary but NOT
  // sufficient: a running belt chain keeps 208 ducks awake, which measured
  // 49.1 KB/s against a 60 KB/s budget. A body further than this from the
  // client's own camera is not sent to that client at all. 45 m on a 120 m
  // plate keeps everything a player can actually resolve on a 480 px
  // backbuffer, and 0 disables the filter.
  relevanceRadius: 45,
  // RATE DEGRADATION. When the measured per-client upstream sits above
  // degradeAboveKBPerSecond for degradeHoldMs, the host's send rate drops to
  // degradedHostStateHz; when it sits below recoverBelowKBPerSecond for the
  // same hold, it climbs back. 52 KB/s is 87% of the 60 KB/s budget and works
  // out at 220 awake bodies, so a running factory at 208 awake (49.1 KB/s)
  // keeps the full 20 Hz and only a busier world gives up smoothness.
  // The anti-flap rule is structural, not a guess: dropping to 15 Hz multiplies
  // the rate by 15/20, so recoverBelowKBPerSecond must stay below
  // degradeAboveKBPerSecond * degradedHostStateHz / hostStateHz or a degraded
  // stream immediately qualifies for recovery and oscillates. resolveNetConfig
  // enforces it.
  degradedHostStateHz: 15,
  degradeAboveKBPerSecond: 52,
  recoverBelowKBPerSecond: 38,
  degradeHoldMs: 2000,
};

const SQRT1_2 = Math.SQRT1_2;

function numOr(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

export function resolveNetConfig(config) {
  const src = (config && config.net) || {};
  const out = {};
  for (const k of Object.keys(NET_DEFAULTS)) out[k] = numOr(src[k], NET_DEFAULTS[k]);
  out.quatScale = (1 << out.quatBits) - 1;
  out.quatMask = (1 << out.quatBits) - 1;
  out.stateHz = out.hostStateHz;
  out.frameIntervalMs = 1000 / (out.hostStateHz || 1);
  if (out.degradedHostStateHz > out.hostStateHz || out.degradedHostStateHz <= 0) {
    throw new Error(
      `[snapshot] net.degradedHostStateHz (${out.degradedHostStateHz}) must be positive and `
      + `at most net.hostStateHz (${out.hostStateHz})`
    );
  }
  // The same stream costs (degradedHz / hostHz) as much once degraded. If the
  // recovery line sits above that, degrading makes the stream instantly eligible
  // to recover and the rate oscillates forever at the hold interval.
  out.degradeFloorKBPerSecond = out.degradeAboveKBPerSecond
    * (out.degradedHostStateHz / out.hostStateHz);
  if (out.recoverBelowKBPerSecond >= out.degradeFloorKBPerSecond) {
    throw new Error(
      `[snapshot] net.recoverBelowKBPerSecond (${out.recoverBelowKBPerSecond}) must be below `
      + `net.degradeAboveKBPerSecond * net.degradedHostStateHz / net.hostStateHz `
      + `(${out.degradeFloorKBPerSecond.toFixed(2)}) or the send rate flaps`
    );
  }
  return out;
}

// --- quantisation ------------------------------------------------------------

export function quantisePosition(v, cfg) {
  const q = Math.round(numOr(v, 0) / cfg.positionStep) + cfg.positionBias;
  return q < 0 ? 0 : (q > 65535 ? 65535 : q);
}

export function dequantisePosition(q, cfg) {
  return (q - cfg.positionBias) * cfg.positionStep;
}

// Smallest-three. The dropped component is the largest in magnitude, so the
// three that travel are each within [-1/sqrt2, 1/sqrt2] and the dropped one is
// recovered as sqrt(1 - a^2 - b^2 - c^2). The sign of the dropped component is
// flipped into the others when it is negative: q and -q are the same rotation.
export function packQuaternion(x, y, z, w, cfg) {
  let c0 = numOr(x, 0), c1 = numOr(y, 0), c2 = numOr(z, 0), c3 = numOr(w, 1);
  const len = Math.hypot(c0, c1, c2, c3) || 1;
  c0 /= len; c1 /= len; c2 /= len; c3 /= len;

  const a = [c0, c1, c2, c3];
  let big = 0;
  for (let i = 1; i < 4; i++) if (Math.abs(a[i]) > Math.abs(a[big])) big = i;
  if (a[big] < 0) { a[0] = -a[0]; a[1] = -a[1]; a[2] = -a[2]; a[3] = -a[3]; }

  let out = big << (cfg.quatBits * 3);
  let shift = cfg.quatBits * 2;
  for (let i = 0; i < 4; i++) {
    if (i === big) continue;
    let n = (a[i] / SQRT1_2 + 1) * 0.5 * cfg.quatScale;
    n = Math.round(n);
    if (n < 0) n = 0; else if (n > cfg.quatScale) n = cfg.quatScale;
    out += n * Math.pow(2, shift);
    shift -= cfg.quatBits;
  }
  return out >>> 0;
}

export function unpackQuaternion(packed, cfg, out) {
  const o = out || { x: 0, y: 0, z: 0, w: 1 };
  const big = (packed >>> (cfg.quatBits * 3)) & 0x3;
  const v = [0, 0, 0, 0];
  let shift = cfg.quatBits * 2;
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    if (i === big) continue;
    const n = (Math.floor(packed / Math.pow(2, shift))) & cfg.quatMask;
    const f = ((n / cfg.quatScale) * 2 - 1) * SQRT1_2;
    v[i] = f;
    sum += f * f;
    shift -= cfg.quatBits;
  }
  v[big] = Math.sqrt(Math.max(0, 1 - sum));
  o.x = v[0]; o.y = v[1]; o.z = v[2]; o.w = v[3];
  return o;
}

// --- the counter -------------------------------------------------------------
// A sliding window over the last rateWindowMs, so the overlay shows what the
// upstream is doing NOW rather than an average since boot. Gate E-H is read off
// this number.

export function createRateCounter(windowMs) {
  const win = numOr(windowMs, NET_DEFAULTS.rateWindowMs);
  const times = [];
  const sizes = [];
  let total = 0;
  let frames = 0;
  let windowBytes = 0;
  let peak = 0;

  function trim(now) {
    while (times.length && now - times[0] > win) {
      windowBytes -= sizes.shift();
      times.shift();
    }
  }

  return {
    add(bytes, now) {
      const t = numOr(now, (typeof performance !== 'undefined' ? performance.now() : Date.now()));
      const b = numOr(bytes, 0);
      times.push(t);
      sizes.push(b);
      windowBytes += b;
      total += b;
      frames++;
      trim(t);
      const bps = this.bytesPerSecond(t);
      if (bps > peak) peak = bps;
      return b;
    },
    bytesPerSecond(now) {
      const t = numOr(now, (typeof performance !== 'undefined' ? performance.now() : Date.now()));
      trim(t);
      if (!times.length) return 0;
      // Below a full window, divide by the elapsed span rather than the window,
      // or the first second of a session reads artificially low.
      const span = Math.max(1, Math.min(win, t - times[0] + 1));
      return (windowBytes * 1000) / span;
    },
    kbPerSecond(now) { return this.bytesPerSecond(now) / 1024; },
    totalBytes: () => total,
    frames: () => frames,
    peakBytesPerSecond: () => peak,
    reset() { times.length = 0; sizes.length = 0; total = 0; frames = 0; windowBytes = 0; peak = 0; },
  };
}

// --- encoder / decoder -------------------------------------------------------

export function frameBytes(bodyCount) {
  return HEADER_BYTES + bodyCount * BODY_BYTES;
}

export function createSnapshotCodec(config) {
  const cfg = resolveNetConfig(config);
  const up = createRateCounter(cfg.rateWindowMs);
  const down = createRateCounter(cfg.rateWindowMs);
  let seq = 0;
  let lastBodies = 0;
  let dropped = 0;          // bodies over the per-frame ceiling
  let settled = 0;          // bodies filtered out for being asleep
  let culled = 0;           // bodies filtered out for being out of range
  let lastCulled = 0;
  let lastConsidered = 0;

  // --- the host's send rate ---------------------------------------------------
  // Measured, not assumed: the decision reads the same sliding-window counter
  // gate E-H is read off, so the rate cannot degrade on a number nobody can see.
  let hz = cfg.hostStateHz;
  let overSince = 0;
  let underSince = 0;
  let degradations = 0;
  let recoveries = 0;
  let lastRateKB = 0;

  function updateRate(now) {
    const kb = up.kbPerSecond(now);
    lastRateKB = kb;
    if (hz > cfg.degradedHostStateHz) {
      underSince = 0;
      if (kb > cfg.degradeAboveKBPerSecond) {
        if (!overSince) overSince = now;
        else if (now - overSince >= cfg.degradeHoldMs) {
          hz = cfg.degradedHostStateHz;
          degradations++;
          overSince = 0;
        }
      } else overSince = 0;
      return kb;
    }
    overSince = 0;
    if (kb < cfg.recoverBelowKBPerSecond) {
      if (!underSince) underSince = now;
      else if (now - underSince >= cfg.degradeHoldMs) {
        hz = cfg.hostStateHz;
        recoveries++;
        underSince = 0;
      }
    } else underSince = 0;
    return kb;
  }

  // Reused across frames: a 20 Hz encoder must not allocate a fresh ArrayBuffer
  // sixty times a second per client.
  let buf = new ArrayBuffer(frameBytes(cfg.maxBodiesPerFrame));
  let view = new DataView(buf);

  // `bodies` is any array-like of { netId, x, y, z, qx, qy, qz, qw, sleeping }.
  // Sleeping bodies are dropped HERE and nowhere else, and so are bodies outside
  // the receiving client's relevance radius: both filters live in the encoder so
  // no caller can forget either one.
  //
  // opts.origin is THE RECEIVING CLIENT'S OWN CAMERA, so one frame per client,
  // not one frame broadcast to all. Without an origin the radius is not applied
  // at all -- a missing camera must not silently empty the stream.
  function encode(bodies, opts) {
    const o = opts || {};
    const n = bodies ? bodies.length : 0;
    let count = 0;
    let offset = HEADER_BYTES;
    let over = 0;
    let asleep = 0;
    let far = 0;

    const origin = o.origin || null;
    const radius = numOr(o.radius, cfg.relevanceRadius);
    const r2 = origin && radius > 0 ? radius * radius : 0;

    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      if (!b) continue;
      if (b.sleeping) { asleep++; continue; }
      if (r2) {
        const dx = b.x - origin.x;
        const dy = b.y - origin.y;
        const dz = b.z - origin.z;
        if (dx * dx + dy * dy + dz * dz > r2) { far++; continue; }
      }
      if (count >= cfg.maxBodiesPerFrame) { over++; continue; }
      view.setUint16(offset, b.netId & 0xffff, true);
      view.setUint16(offset + 2, quantisePosition(b.x, cfg), true);
      view.setUint16(offset + 4, quantisePosition(b.y, cfg), true);
      view.setUint16(offset + 6, quantisePosition(b.z, cfg), true);
      view.setUint32(offset + 8, packQuaternion(b.qx, b.qy, b.qz, b.qw, cfg), true);
      offset += BODY_BYTES;
      count++;
    }

    view.setUint32(0, MAGIC, true);
    view.setUint8(4, cfg.protocolVersion & 0xff);
    view.setUint8(5, (o.flags || 0) & 0xff);
    view.setUint16(6, count, true);
    view.setUint32(8, seq >>> 0, true);
    view.setFloat32(12, numOr(o.clock, 0), true);
    seq = (seq + 1) >>> 0;

    lastBodies = count;
    lastCulled = far;
    lastConsidered = n;
    dropped += over;
    settled += asleep;
    culled += far;
    const out = buf.slice(0, offset);
    const t = numOr(o.now, (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    up.add(out.byteLength, t);
    updateRate(t);
    return out;
  }

  // Collect straight out of the duck pool. This is the path a host actually
  // uses: ducks.forEach hands over the pose it already has, so nothing is read
  // twice. The sleeping flag is passed THROUGH rather than filtered here, so
  // there is exactly one place in the project that drops a settled body and the
  // settledFiltered counter is a real measurement of it.
  const scratch = [];
  function encodeDucks(ducks, opts) {
    scratch.length = 0;
    if (ducks && typeof ducks.forEach === 'function') {
      ducks.forEach((id, x, y, z, qx, qy, qz, qw, tier, sleeping) => {
        scratch.push({ netId: id, x, y, z, qx, qy, qz, qw, sleeping: !!sleeping });
      });
    }
    return encode(scratch, opts);
  }

  function decode(arrayBuffer, opts) {
    const o = opts || {};
    const ab = arrayBuffer instanceof ArrayBuffer
      ? arrayBuffer
      : (arrayBuffer && arrayBuffer.buffer) || null;
    if (!ab || ab.byteLength < HEADER_BYTES) throw new Error('[snapshot] frame too short');
    const dv = new DataView(ab);
    const magic = dv.getUint32(0, true);
    if (magic !== MAGIC) throw new Error('[snapshot] bad magic ' + magic.toString(16));
    const version = dv.getUint8(4);
    if (version !== cfg.protocolVersion) {
      throw new Error(`[snapshot] protocol ${version} != ${cfg.protocolVersion}`);
    }
    const flags = dv.getUint8(5);
    const count = dv.getUint16(6, true);
    const expected = frameBytes(count);
    if (ab.byteLength < expected) {
      throw new Error(`[snapshot] frame says ${count} bodies (${expected} B) but is ${ab.byteLength} B`);
    }
    const out = {
      version, flags,
      seq: dv.getUint32(8, true),
      clock: dv.getFloat32(12, true),
      count,
      bytes: ab.byteLength,
      bodies: new Array(count),
    };
    const q = { x: 0, y: 0, z: 0, w: 1 };
    for (let i = 0; i < count; i++) {
      const off = HEADER_BYTES + i * BODY_BYTES;
      unpackQuaternion(dv.getUint32(off + 8, true), cfg, q);
      out.bodies[i] = {
        netId: dv.getUint16(off, true),
        x: dequantisePosition(dv.getUint16(off + 2, true), cfg),
        y: dequantisePosition(dv.getUint16(off + 4, true), cfg),
        z: dequantisePosition(dv.getUint16(off + 6, true), cfg),
        qx: q.x, qy: q.y, qz: q.z, qw: q.w,
      };
    }
    down.add(ab.byteLength, o.now);
    return out;
  }

  return {
    encode,
    encodeDucks,
    decode,
    config: cfg,
    // What the overlay shows, and what gate E-H is measured against.
    stats(now) {
      return {
        seq,
        bodiesLastFrame: lastBodies,
        bytesLastFrame: frameBytes(lastBodies),
        upBytesPerSecond: up.bytesPerSecond(now),
        upKBPerSecond: up.kbPerSecond(now),
        upPeakKBPerSecond: up.peakBytesPerSecond() / 1024,
        downKBPerSecond: down.kbPerSecond(now),
        framesSent: up.frames(),
        totalBytesSent: up.totalBytes(),
        settledFiltered: settled,
        droppedOverCap: dropped,
        relevanceCulled: culled,
        relevanceCulledLastFrame: lastCulled,
        bodiesConsideredLastFrame: lastConsidered,
        relevanceRadius: cfg.relevanceRadius,
        // Per additional client, at the rate the host is CURRENTLY sending at --
        // reading the configured 20 Hz here would hide the whole point of the
        // degradation, which is that this number comes down.
        projectedKBPerSecondPerClient: (frameBytes(lastBodies) * hz) / 1024,
        stateHz: hz,
        degraded: hz < cfg.hostStateHz,
        degradations,
        recoveries,
        rateKBPerSecond: lastRateKB,
      };
    },
    // The interval the transport must schedule on. It asks every frame rather
    // than caching, so a degradation takes effect on the next send.
    stateHz: () => hz,
    frameIntervalMs: () => 1000 / (hz || 1),
    degraded: () => hz < cfg.hostStateHz,
    // Manual override, for measuring one rate against the other without waiting
    // out the hold. Anything outside the two configured rates is refused.
    setStateHz(v) {
      const want = Math.round(numOr(v, hz));
      if (want !== cfg.hostStateHz && want !== cfg.degradedHostStateHz) {
        throw new Error(`[snapshot] setStateHz(${v}): only ${cfg.hostStateHz} or ${cfg.degradedHostStateHz}`);
      }
      hz = want;
      overSince = 0;
      underSince = 0;
      return hz;
    },
    up,
    down,
    resetStats() {
      up.reset(); down.reset();
      dropped = 0; settled = 0; culled = 0;
      lastBodies = 0; lastCulled = 0; lastConsidered = 0;
      overSince = 0; underSince = 0; lastRateKB = 0;
      degradations = 0; recoveries = 0;
      hz = cfg.hostStateHz;
    },
    // A fresh buffer if the ceiling is raised at runtime; the encoder never
    // grows one by surprise mid-frame.
    resize(maxBodies) {
      cfg.maxBodiesPerFrame = Math.max(1, Math.round(numOr(maxBodies, cfg.maxBodiesPerFrame)));
      buf = new ArrayBuffer(frameBytes(cfg.maxBodiesPerFrame));
      view = new DataView(buf);
      return cfg.maxBodiesPerFrame;
    },
  };
}

export default createSnapshotCodec;
