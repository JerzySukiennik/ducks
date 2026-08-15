// Single source of truth for RTDB layout. The security rules in
// database.rules.json are GENERATED from this file by tools/gen-rules.mjs -
// a drift between the two silently kills signalling with no visible error.

export const ROOT = 'ducks';

export const paths = {
  rooms: () => `${ROOT}/rooms`,
  room: (id) => `${ROOT}/rooms/${id}`,
  meta: (id) => `${ROOT}/rooms/${id}/meta`,
  metaField: (id, k) => `${ROOT}/rooms/${id}/meta/${k}`,
  slots: (id) => `${ROOT}/rooms/${id}/reservation/slots`,
  slot: (id, n) => `${ROOT}/rooms/${id}/reservation/slots/${n}`,
  peer: (id, n) => `${ROOT}/rooms/${id}/peers/${n}`,
  offer: (id, n) => `${ROOT}/rooms/${id}/peers/${n}/offer`,
  answer: (id, n) => `${ROOT}/rooms/${id}/peers/${n}/answer`,
  ice: (id, n) => `${ROOT}/rooms/${id}/peers/${n}/ice`,
  // ICE is split by sender so the two ends never overwrite each other's list.
  iceFrom: (id, n, side) => `${ROOT}/rooms/${id}/peers/${n}/ice/${side}`,
  // A room is only readable by the players in it, so the browsable list of
  // public rooms is a separate, deliberately tiny branch. Private rooms are
  // never written here: they exist only as a link.
  lobby: () => `${ROOT}/lobby`,
  lobbyRoom: (id) => `${ROOT}/lobby/${id}`,
};

// Which end wrote an ICE candidate. Host reads 'c', client reads 'h'.
export const ICE_SIDE = { host: 'h', client: 'c' };

// Enforced by the deployed rules - exceeding these is a permission denial,
// not a warning. tools/gen-rules.mjs bakes these numbers into the rules.
export const limits = {
  maxPlayers: 4,
  maxSdpChars: 12000,
  maxIceChars: 1200,
  maxNickChars: 24,
  presenceWindowMs: 75000,
  clockSkewMs: 120000,
};
