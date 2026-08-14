// Frame timing and adaptive backbuffer width. Adaptation is driven by measured
// frame time only; debug steps must not feed this. It never touches the
// backbuffer aspect ratio, only how many pixels wide the render target is.

import config from '../config.js';

export function createPerf() {
  const c = config.perf;
  const r = config.render;
  let bufferWidth = Math.max(r.bufferWidthMin, Math.min(r.bufferWidthMax, r.bufferWidth));
  let windowMs = 0;
  let windowFrames = 0;
  let lastChangeAt = -Infinity;
  let frameMs = 0;
  let fps = 0;
  let physMs = 0;
  let smoothed = 0;
  let discarded = 0;
  // A hidden tab freezes rAF, so the first delta after it is shown again is the
  // length of the pause, not the cost of a frame. Such samples must never adapt.
  let resumedAt = -Infinity;

  const onVisibility = () => {
    windowMs = 0;
    windowFrames = 0;
    if (typeof document !== 'undefined' && !document.hidden) {
      resumedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    }
  };
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', onVisibility);
  }

  function usable(ms, nowMs) {
    if (!(ms > 0) || !isFinite(ms)) return false;
    if (ms > c.maxSampleMs) return false;
    if (typeof document !== 'undefined' && document.hidden) return false;
    const t = typeof nowMs === 'number' && isFinite(nowMs)
      ? nowMs
      : (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (t - resumedAt < c.visibilityGraceMs) return false;
    return true;
  }

  function sample(ms, nowMs) {
    if (!usable(ms, nowMs)) {
      discarded += 1;
      windowMs = 0;
      windowFrames = 0;
      return bufferWidth;
    }
    frameMs = ms;
    smoothed = smoothed === 0 ? ms : smoothed + (ms - smoothed) * 0.1;
    fps = smoothed > 0 ? 1000 / smoothed : 0;
    windowMs += ms;
    windowFrames += 1;
    if (windowMs < c.sampleWindowMs) return bufferWidth;
    const avg = windowMs / Math.max(1, windowFrames);
    windowMs = 0;
    windowFrames = 0;
    if (nowMs - lastChangeAt < c.cooldownMs) return bufferWidth;
    if (avg > c.downMs && bufferWidth > r.bufferWidthMin) {
      bufferWidth = Math.max(r.bufferWidthMin, bufferWidth - c.bufferWidthStep);
      lastChangeAt = nowMs;
    } else if (avg <= c.upMs && bufferWidth < r.bufferWidthMax) {
      bufferWidth = Math.min(r.bufferWidthMax, bufferWidth + c.bufferWidthStep);
      lastChangeAt = nowMs;
    }
    return bufferWidth;
  }

  return {
    sample,
    setPhysMs(ms) { physMs = ms; },
    // The player picked a render width. Adaptation is still free to move it
    // afterwards -- a settings slider is where the buffer STARTS, not a promise
    // that the frame budget will be ignored -- but the measurement window and
    // the cooldown are reset so the next decision is made from what the game
    // does at the new width rather than from samples taken at the old one.
    setBufferWidth(w) {
      const next = Math.round(Math.max(r.bufferWidthMin, Math.min(r.bufferWidthMax, Number(w) || bufferWidth)));
      if (next === bufferWidth) return bufferWidth;
      bufferWidth = next;
      windowMs = 0;
      windowFrames = 0;
      lastChangeAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      return bufferWidth;
    },
    get bufferWidth() { return bufferWidth; },
    get frameMs() { return frameMs; },
    get fps() { return fps; },
    get physMs() { return physMs; },
    get discardedSamples() { return discarded; },
    dispose() {
      if (typeof document !== 'undefined' && document.removeEventListener) {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    },
  };
}
