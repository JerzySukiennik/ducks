// What host and client agree on: message names, frame flags, and the ONE thing
// that is easy to get silently wrong -- wire identity.
//
// The binary state frame (src/net/snapshot.js) carries a u16 netId per body and
// three different kinds of body share that number space:
//
//   duck    the pool slot, 0..299, fixed for the life of the session
//   prop    a dropped dynamic body, keyed by the monotonic placement counter
//   player  a capsule, keyed by room slot
//
// A duck slot and a prop key are both small integers starting near zero, so
// without separate bases duck 7 and prop 7 are the same body on the wire and
// each one overwrites the other's pose twenty times a second. The bases are
// config keys, never literals, and decodeWireId() is the only place that turns
// a netId back into a kind.
//
// Nothing here branches on a row's `id`, and nothing here imports three.js.

import config from '../config.js';

export const PROTOCOL = {
  // Bumped whenever the meaning of a control message changes. The binary frame
  // carries its own version (config.net.protocolVersion); this one covers the
  // JSON above it.
  version: 1,
};

// Control-channel message types. Reliable and ordered, so these are the ones
// that must not be lost: the join snapshot, world events, and requests.
export const MSG = {
  HELLO: 'hello',                 // client -> host, first message on control
  WELCOME: 'welcome',             // host -> client, slot and session identity
  SNAPSHOT_BEGIN: 'snapBegin',    // host -> client, the join snapshot follows
  SNAPSHOT_CHUNK: 'snapChunk',
  SNAPSHOT_END: 'snapEnd',
  REQUEST: 'req',                 // client -> host, "please do this"
  REJECT: 'reject',               // host -> asker only, with a reason to show
  EVENT: 'ev',                    // host -> EVERYONE, "this happened"
  SETTLED: 'duckSettled',         // host -> everyone, bodies that left the stream
  PLAYERS: 'players',             // host -> everyone, the roster (nicks, slots)
  BYE: 'bye',                     // either way, a clean goodbye
};

// World events. The host is the only thing that ever emits one, and both ends
// apply them through the same function, so a client cannot drift by applying a
// different code path from the host's.
export const EV = {
  PLACED: 'placed',
  DEMOLISHED: 'demolished',
  PROP_DROPPED: 'propDropped',
  PROP_TAKEN: 'propTaken',
  BOUGHT: 'bought',
  MONEY: 'money',
  // The team prestiged. Money, props and placed objects all reach a client
  // through the reconciler's own diffs; what cannot be diffed is the multiplier
  // (a number no client can derive) and the shop levels (which a client is not
  // told about at all outside the join snapshot), so those travel here.
  PRESTIGE: 'prestige',
  // What the vendor has on the shelf. A client can never derive this -- it is
  // the host's dice -- and it changes on two schedules that have nothing to do
  // with each other: every purchase takes a unit, and every three minutes the
  // whole shelf turns over. Both reach a client here.
  STOCK: 'stock',
  CRANK: 'crank',
  DUCK_SPAWNED: 'duckSpawned',
  HOTBAR: 'hotbar',
};

// Requests a client may make. Every one of them is a question, never an action:
// the client sends it, the host does it, the host broadcasts the result to
// EVERYONE INCLUDING THE ASKER. No client applies its own request locally
// first. The single agreed exception is the build hologram, which is a preview
// and not a commitment, so it never appears in this list.
export const REQ = {
  PLACE: 'place',
  DEMOLISH: 'demolish',
  PICKUP: 'pickup',
  THROW: 'throw',
  BUY: 'buy',
  // Take a prestige. A TEAM action on a shared economy -- it wipes everyone's
  // machines and everyone's money at once -- so it is the host's to call and a
  // client asking for one is refused with that reason. Everyone can see the
  // quote; one person can pull the lever.
  PRESTIGE: 'prestige',
  // Pay to turn the vendor's shelf over now instead of waiting out the period.
  // Unlike PRESTIGE this is NOT host-only: it spends shared money exactly like
  // BUY does, and any player who can spend the team's money on a conveyor can
  // spend it on restocking the conveyors. What it is not allowed to be is
  // LOCAL -- a client that rolled its own shelf would be looking at a shop
  // nobody else can see.
  REROLL: 'reroll',
  CRANK: 'crank',
  SELECT: 'select',
  // The core verb of the game, and the four messages it takes. GRAB carries the
  // asker's aim -- origin and direction -- and NOT a target id: a client that
  // could name the body it wants could name any body in the world, so the host
  // casts the ray itself and the aim is evidence, not an instruction. The other
  // three need no payload at all, because what a hold does next is decided by
  // where the host already believes that player is looking.
  GRAB: 'grab',
  DROP: 'drop',          // let go, gently
  HURL: 'hurl',          // let go, hard, along the aim -- the pit shot
  HOLD_DIST: 'holdDist', // wheel: push the carried thing away / pull it closer
};

// Header flag bits on a binary state frame. A frame of player capsules is sent
// with no relevance culling -- a player 60 m away still has to be drawn -- so it
// cannot share a frame with the world bodies, which are culled at 45 m.
export const FRAME = {
  WORLD: 0,
  PLAYERS: 1,
};

function base(key, fallback) {
  const v = config && config.net ? config.net[key] : undefined;
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

export const WIRE_KIND = { DUCK: 'duck', PROP: 'prop', PLAYER: 'player' };

export const wire = {
  duck: (slot) => base('wireDuckBase', 0) + (slot | 0),
  prop: (key) => base('wirePropBase', 1024) + (key | 0),
  player: (slot) => base('wirePlayerBase', 60000) + (slot | 0),
};

// The only place a netId is turned back into a kind. Returns null for anything
// outside the three ranges rather than guessing.
export function decodeWireId(netId) {
  const n = netId | 0;
  const d = base('wireDuckBase', 0);
  const p = base('wirePropBase', 1024);
  const pl = base('wirePlayerBase', 60000);
  if (n >= pl) return { kind: WIRE_KIND.PLAYER, id: n - pl };
  if (n >= p) return { kind: WIRE_KIND.PROP, id: n - p };
  if (n >= d) return { kind: WIRE_KIND.DUCK, id: n - d };
  return null;
}

// --- the client's input frame -------------------------------------------------
// 16 bytes, on the UNRELIABLE channel at config.net.clientStateHz. It is the
// only thing a client ever sends without asking, and it is not an action: it is
// "this is which way I am pointing and which way I am walking". The host feeds
// it to that client's real capsule, so a client shoving a crate is the host's
// physics doing it, not a message claiming it happened.
//
// Encoder and decoder sit next to each other on purpose. When they lived in two
// files in an earlier project, a field added to one and not the other read as
// garbage input rather than as an error.
//
//   0  u8   protocol version
//   1  u8   flags: bit0 jump, bit1 sprint
//   2  i8   forward, -100..100
//   3  i8   right,   -100..100
//   4  f32  yaw
//   8  f32  pitch
//  12  u16  sequence (wraps)
//  14  u16  reserved
export const INPUT_BYTES = 16;
export const INPUT_FLAG = { JUMP: 1, SPRINT: 2 };

export function encodeInput(inp, seq, out) {
  const buf = out && out.byteLength === INPUT_BYTES ? out : new ArrayBuffer(INPUT_BYTES);
  const dv = new DataView(buf);
  const clamp = (v) => Math.max(-100, Math.min(100, Math.round((v || 0) * 100)));
  dv.setUint8(0, PROTOCOL.version & 0xff);
  dv.setUint8(1, (inp.jump ? INPUT_FLAG.JUMP : 0) | (inp.sprint ? INPUT_FLAG.SPRINT : 0));
  dv.setInt8(2, clamp(inp.fwd));
  dv.setInt8(3, clamp(inp.right));
  dv.setFloat32(4, inp.yaw || 0, true);
  dv.setFloat32(8, inp.pitch || 0, true);
  dv.setUint16(12, seq & 0xffff, true);
  dv.setUint16(14, 0, true);
  return buf;
}

export function decodeInput(bytes) {
  const ab = bytes instanceof ArrayBuffer ? bytes : (bytes && bytes.buffer);
  if (!ab || ab.byteLength < INPUT_BYTES) return null;
  const dv = new DataView(ab);
  if (dv.getUint8(0) !== (PROTOCOL.version & 0xff)) return null;
  const flags = dv.getUint8(1);
  return {
    jump: !!(flags & INPUT_FLAG.JUMP),
    sprint: !!(flags & INPUT_FLAG.SPRINT),
    fwd: dv.getInt8(2) / 100,
    right: dv.getInt8(3) / 100,
    yaw: dv.getFloat32(4, true),
    pitch: dv.getFloat32(8, true),
    seq: dv.getUint16(12, true),
  };
}

// Shared by both ends so a rejection reads the same in the host's log and in
// the asker's HUD.
export const REJECT_REASON = {
  UNKNOWN_REQUEST: 'unknown request',
  NOT_ALLOWED: 'not allowed',
  INVALID: 'invalid request',
  FAILED: 'the host refused it',
};

export default PROTOCOL;
