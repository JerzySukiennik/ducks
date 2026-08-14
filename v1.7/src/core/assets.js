// Every external fetch gets a timeout and a fallback value. A blank screen
// caused by a hanging request is a bug, not a network condition.

import config from '../config.js';

export function fetchWithTimeout(url, timeoutMs = config.boot.fetchTimeoutMs) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, timeoutMs);
  return fetch(url, { signal: ctrl ? ctrl.signal : undefined, cache: 'no-store' })
    .finally(() => clearTimeout(timer));
}

export async function loadJSON(url, fallback, timeoutMs) {
  try {
    const res = await fetchWithTimeout(url, timeoutMs);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`[assets] ${url} unavailable, using fallback:`, err && err.message);
    return fallback;
  }
}

export function makeNoiseCanvas(size, alpha) {
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = Math.round(alpha * 255);
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}
