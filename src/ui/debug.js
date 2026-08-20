// F3 overlay. Draw calls come first: they are this project's ceiling.

import config from '../config.js';

export function createDebugOverlay(container) {
  const el = document.createElement('div');
  el.id = 'debug';
  el.style.display = config.debug.overlayVisible ? 'block' : 'none';
  container.appendChild(el);

  let visible = config.debug.overlayVisible;

  function onKey(e) {
    if (e.code !== config.debug.toggleKey) return;
    e.preventDefault();
    visible = !visible;
    el.style.display = visible ? 'block' : 'none';
  }
  window.addEventListener('keydown', onKey);

  function fmt(n, d = 1) {
    return Number.isFinite(n) ? n.toFixed(d) : '-';
  }

  return {
    update(s) {
      if (!visible) return;
      el.textContent = [
        `fps      ${fmt(s.fps, 0)}`,
        `frame    ${fmt(s.frameMs, 2)} ms`,
        `phys     ${fmt(s.physMs, 2)} ms`,
        // The breakdown, and it reads top-down in the order the frame runs.
        // `phys` above is preSim + sim, which is what the adaptive scaler
        // subtracts; the four lines below are where those milliseconds went.
        `  pre    ${fmt(s.preSimMs, 2)} ms   sim ${fmt(s.simMs, 2)} ms`,
        `  solv   ${fmt(s.solverMs, 2)} ms  hook ${fmt(s.hooksMs, 2)} ms`,
        `  ctrl   ${fmt(s.ctrlMs, 2)} ms  post ${fmt(s.postMs, 2)} ms`,
        `  view   ${fmt(s.viewMs, 2)} ms  draw ${fmt(s.drawMs, 2)} ms`,
        s.netTickMs > 0 ? `  net    ${fmt(s.netTickMs, 2)} ms (host tick)` : '',
        `substep  ${s.substeps}`,
        `calls    ${s.drawCalls}`,
        `tris     ${s.tris}`,
        `mem      geo ${s.geometries} tex ${s.textures} prog ${s.programs}`,
        `buffer   ${s.bufferWidth}x${s.bufferHeight}`,
        `pos      ${fmt(s.playerX, 2)} ${fmt(s.playerY, 2)} ${fmt(s.playerZ, 2)}`,
        `ground   ${s.grounded ? 'yes' : 'no'}`,
        `bodies   ${s.bodies} (awake ${s.awake})`,
        `ducks    ${s.ducksLive} live, ${s.ducksSleeping} asleep`,
        `frame#   ${s.frame}  t ${fmt(s.simTime, 2)}s`,
        s.errors ? `errors   ${s.errors}` : '',
      ].filter(Boolean).join('\n');
    },
    showNotice(msg) {
      if (typeof window.__ducksNotice === 'function') window.__ducksNotice(msg);
      else console.warn('[notice]', msg);
    },
    showFatal(msg) {
      if (typeof window.__ducksFatal === 'function') window.__ducksFatal(msg);
      else console.error('[fatal]', msg);
    },
    setVisible(v) {
      visible = v;
      el.style.display = v ? 'block' : 'none';
    },
    get element() { return el; },
    dispose() { window.removeEventListener('keydown', onKey); },
  };
}
