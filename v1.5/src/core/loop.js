// Crash-proof frame loop. An unhandled throw inside rAF freezes the whole
// game, so the per-frame body is always guarded and always rescheduled.

import config from '../config.js';

export function createLoop({ frame, onError }) {
  let handle = 0;
  let running = false;
  let last = 0;
  let errorCount = 0;
  let logged = 0;
  let throwOnce = false;

  function guarded(dt, source) {
    if (throwOnce) {
      throwOnce = false;
      try {
        throw new Error('debugThrowOnce: intentional frame exception');
      } catch (err) {
        record(err);
        return false;
      }
    }
    try {
      frame(dt, source);
      return true;
    } catch (err) {
      record(err);
      return false;
    }
  }

  function record(err) {
    errorCount += 1;
    if (logged < config.loop.maxLoggedErrors) {
      logged += 1;
      console.error('[loop] frame error (further errors counted only):', err);
    }
    if (onError) {
      try { onError(err, errorCount); } catch (_) { /* never rethrow */ }
    }
  }

  function tick(now) {
    if (!running) return;
    handle = requestAnimationFrame(tick);
    const dt = last === 0 ? config.loop.fixedDt : Math.min(config.loop.maxFrameDt, (now - last) / 1000);
    last = now;
    guarded(dt, 'raf');
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = 0;
      handle = requestAnimationFrame(tick);
    },
    stop() {
      running = false;
      if (handle) cancelAnimationFrame(handle);
      handle = 0;
    },
    step(dt) { return guarded(dt, 'debug'); },
    throwNext() { throwOnce = true; },
    get errorCount() { return errorCount; },
    get running() { return running; },
  };
}
