// A timer that survives a hidden tab.
//
// requestAnimationFrame stops entirely in a background tab, which is why none
// of the networking runs on it. setInterval is not the answer either: Chrome
// clamps timers in a hidden page to roughly one per second, and to one per
// minute after five minutes. Measured in this project, in a hidden tab:
// setInterval(50 ms) fired 5 times in 4 s where a worker-driven interval fired
// 95. A 20 Hz host stream would collapse to 1 Hz exactly when the host tabs
// away, and the presence heartbeat would drift towards the expiry window.
//
// A dedicated worker has no visibility state, so its timers are not clamped.
// The worker is only a metronome - every tick is handled on the main thread.

const WORKER_SRC = `
let timer = null;
onmessage = (e) => {
  const d = e.data || {};
  if (d.stop) { clearInterval(timer); timer = null; close(); return; }
  clearInterval(timer);
  timer = setInterval(() => postMessage(1), Math.max(1, d.ms | 0));
};`;

let blobUrl = null;

function workerUrl() {
  if (blobUrl) return blobUrl;
  blobUrl = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
  return blobUrl;
}

export function createClock(ms, fn) {
  const period = Math.max(1, Math.round(ms));
  let worker = null;
  let interval = null;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    try {
      fn();
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('[net] clock callback threw:', e.message);
    }
  };

  // Worker construction can fail (no Worker, blocked blob: URL). A clamped
  // timer is much worse than no timer at all, so the fallback is loud.
  try {
    if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined') {
      worker = new Worker(workerUrl());
      worker.onmessage = tick;
      worker.postMessage({ ms: period });
    }
  } catch (e) {
    worker = null;
  }
  if (!worker) {
    if (typeof console !== 'undefined') {
      console.warn('[net] worker clock unavailable; falling back to setInterval, which a hidden tab will throttle to ~1 Hz');
    }
    interval = setInterval(tick, period);
  }

  return {
    periodMs: period,
    driver: worker ? 'worker' : 'interval',
    stop() {
      if (stopped) return;
      stopped = true;
      if (worker) {
        try {
          worker.postMessage({ stop: true });
        } catch (e) { /* already gone */ }
        worker.terminate();
        worker = null;
      }
      if (interval !== null) clearInterval(interval);
      interval = null;
    },
  };
}
