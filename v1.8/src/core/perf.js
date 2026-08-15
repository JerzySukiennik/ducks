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
    // Adapt on what PIXELS actually cost, not on the whole frame. The frame
    // includes physics, networking and state encoding, and none of those get
    // cheaper when the buffer shrinks -- this game is CPU bound. Measured on a
    // host with the world held identical: 320x180 averaged 5.77 ms and 640x360
    // averaged 5.67 ms. Four times the pixels, no difference outside the noise.
    //
    // The consequence was a real bug and it only ever hit the HOST, because a
    // host pays for everyone's physics: its frames ran long, the scaler stepped
    // the buffer down 80 px at a time, the frames did not get shorter, and it
    // ratcheted all the way to the floor and stayed. At 320 into a 2560 px
    // window one buffer pixel is an 8 px block, which is exactly what the player
    // reported -- "a lot of grain, and very thick very grainy outlines" -- while
    // his client, doing a fraction of the work, sat at the maximum and looked
    // perfect.
    //
    // Subtracting the simulation's own cost leaves the half resolution can
    // actually move. physMs is set every frame by main.js from the same frame
    // this sample describes.
    const avgFrame = windowMs / Math.max(1, windowFrames);
    const avg = Math.max(0, avgFrame - (physMs > 0 ? physMs : 0));
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
