// Lazy Firebase loader. Nothing here runs at import time and nothing here is
// allowed to break boot: if the CDN is unreachable, the SDK never loads, the
// promise rejects with a tagged error and the game keeps running single
// player. A blank screen is a bug, never an acceptable failure mode.

import config from '../config.js';
import { firebaseConfig } from './firebase-config.js';

// Pinned, absolute, verified with curl. These are NOT in the importmap on
// purpose: an importmap entry is resolved eagerly by some tooling, and the
// whole point is that a player who never opens the multiplayer menu never
// pays for 440 KB of SDK.
const SDK_VERSION = '10.12.5';
const CDN = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;
export const SDK_URLS = {
  app: `${CDN}/firebase-app.js`,
  auth: `${CDN}/firebase-auth.js`,
  database: `${CDN}/firebase-database.js`,
};

export const NET_UNAVAILABLE = 'net-unavailable';

let state = 'idle';
let pending = null;
let cached = null;
let lastFailure = 0;
let lastError = null;

export function netStatus() {
  return { state, error: lastError ? lastError.message : null, since: lastFailure };
}

export function netReady() {
  return state === 'ready' ? cached : null;
}

function tagged(message, cause) {
  const err = new Error(message);
  err.code = NET_UNAVAILABLE;
  if (cause) err.cause = cause;
  return err;
}

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(tagged(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function load() {
  const t0 = (performance && performance.now) ? performance.now() : Date.now();
  let appMod;
  let authMod;
  let dbMod;
  try {
    [appMod, authMod, dbMod] = await withTimeout(
      Promise.all([
        import(/* @vite-ignore */ SDK_URLS.app),
        import(/* @vite-ignore */ SDK_URLS.auth),
        import(/* @vite-ignore */ SDK_URLS.database),
      ]),
      config.net.sdkTimeoutMs,
      'Firebase SDK download'
    );
  } catch (e) {
    throw tagged('Firebase SDK could not be loaded: ' + (e && e.message ? e.message : e), e);
  }

  const app = appMod.getApps().length
    ? appMod.getApp()
    : appMod.initializeApp(firebaseConfig);

  const auth = authMod.getAuth(app);
  let user = auth.currentUser;
  if (!user) {
    try {
      const cred = await withTimeout(
        authMod.signInAnonymously(auth),
        config.net.authTimeoutMs,
        'Anonymous sign-in'
      );
      user = cred.user;
    } catch (e) {
      throw tagged('Anonymous sign-in failed: ' + (e && e.message ? e.message : e), e);
    }
  }

  const db = dbMod.getDatabase(app);
  const t1 = (performance && performance.now) ? performance.now() : Date.now();

  return {
    app,
    auth,
    db,
    uid: user.uid,
    loadMs: Math.round(t1 - t0),
    sdkVersion: SDK_VERSION,
    // The database surface the rest of src/net uses. Re-exported here so no
    // other module has to know the CDN URL or the modular SDK shape.
    ref: (path) => dbMod.ref(db, path),
    get: dbMod.get,
    set: dbMod.set,
    update: dbMod.update,
    remove: dbMod.remove,
    push: dbMod.push,
    child: dbMod.child,
    onValue: dbMod.onValue,
    onChildAdded: dbMod.onChildAdded,
    onDisconnect: dbMod.onDisconnect,
    runTransaction: dbMod.runTransaction,
    serverTimestamp: dbMod.serverTimestamp,
    goOffline: () => dbMod.goOffline(db),
  };
}

// The single entry point. Callers must handle rejection; every caller in this
// project turns it into "multiplayer unavailable" and nothing more.
export function getFirebase() {
  if (state === 'ready') return Promise.resolve(cached);
  if (pending) return pending;
  if (state === 'unavailable') {
    const waited = Date.now() - lastFailure;
    if (waited < config.net.retryCooldownMs) {
      return Promise.reject(lastError || tagged('Networking unavailable'));
    }
  }
  state = 'loading';
  pending = load().then(
    (api) => {
      cached = api;
      state = 'ready';
      pending = null;
      lastError = null;
      return api;
    },
    (err) => {
      state = 'unavailable';
      pending = null;
      lastFailure = Date.now();
      lastError = err && err.code === NET_UNAVAILABLE ? err : tagged(String(err && err.message || err), err);
      throw lastError;
    }
  );
  return pending;
}

// Convenience for UI: never rejects, resolves to null when there is no network.
export function tryFirebase() {
  return getFirebase().then((api) => api, () => null);
}
