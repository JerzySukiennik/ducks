// Art-direction measuring harness. Dev-only, never loaded by the game.
//
// Paste into the console (or fetch+eval) after boot. Everything here exists
// because the browser pane hides itself between tool calls, so rAF is dead and
// debugStats().fps / frameMs read 0: every number below is taken by timing
// GAME.debugStep(1/60) or GAME.three.render() by hand.
//
// The important one is MAG(). Judging a model "reads well" on a 2560 px window
// is how a bad batch passes review -- the game draws into a 480 px backbuffer
// and CSS upscales it, so 1 m subtends ~22 px at 10 m. MAG copies a crop of the
// REAL backbuffer into an overlay at an integer nearest-neighbour zoom, so what
// you look at is exactly the pixels the game drew, only bigger.
(function () {
  const g = window.GAME;
  if (!g) throw new Error('boot first');

  let ov = document.getElementById('MAGOV');
  if (!ov) {
    ov = document.createElement('canvas');
    ov.id = 'MAGOV';
    ov.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;image-rendering:pixelated;background:#000';
    document.body.appendChild(ov);
  }

  // Hide the HUD so a crop is the world and nothing else.
  window.HUD = function (on) {
    Array.prototype.forEach.call(document.body.children, (el) => {
      if (el === ov || el.contains(g.renderer.canvas)) return;
      el.style.visibility = on ? '' : 'hidden';
    });
    return !!on;
  };

  window.MAGOFF = function () { ov.style.display = 'none'; return true; };

  // x,y,w,h are BACKBUFFER pixels.
  window.MAG = function (x, y, w, h) {
    ov.style.display = 'none';
    // preserveDrawingBuffer is off, so the copy has to happen in the same task
    // as the render or the canvas reads back blank.
    g.three.render(g.view.scene, g.camera);
    const s = Math.max(1, Math.floor(Math.min(innerWidth / w, innerHeight / h)));
    ov.width = w * s; ov.height = h * s;
    ov.style.display = 'block';
    const c = ov.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.drawImage(g.renderer.canvas, x, y, w, h, 0, 0, w * s, h * s);
    return { crop: [x, y, w, h], zoom: s };
  };

  // Stand at (fx,fz) and aim at a world point. Returns the true eye distance,
  // so a shot labelled "10 m" is 10 m and not "roughly ten-ish".
  window.AIM = function (fx, fz, at) {
    g.debugTeleport({ x: fx, y: 2.2, z: fz });
    g.debugStep(0.25);
    const e = g.player.eyePosition();
    const dx = at[0] - e.x, dy = at[1] - e.y, dz = at[2] - e.z;
    g.debugLook(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
    g.debugStep(0.1);
    return { eye: e, dist: +Math.hypot(dx, dy, dz).toFixed(2) };
  };

  window.PROJ = function (p) {
    const V = g.camera.position.constructor;
    const v = new V(p[0], p[1], p[2]).project(g.camera);
    return [Math.round((v.x * 0.5 + 0.5) * g.renderer.bufferWidth),
            Math.round((-v.y * 0.5 + 0.5) * g.renderer.bufferHeight)];
  };

  window.SHOTAT = function (p, w, h) {
    const s = PROJ(p);
    return MAG(Math.max(0, s[0] - (w >> 1)), Math.max(0, s[1] - (h >> 1)), w, h);
  };

  // Whole-frame cost, timed by hand because fps/frameMs are 0 in a hidden tab.
  window.BENCH = function (frames) {
    frames = frames || 150;
    const dt = 1 / 60, t = [];
    for (let i = 0; i < 15; i++) g.debugStep(dt);
    for (let i = 0; i < frames; i++) { const a = performance.now(); g.debugStep(dt); t.push(performance.now() - a); }
    t.sort((a, b) => a - b);
    const st = g.debugStats();
    return {
      n: frames,
      med: +t[frames >> 1].toFixed(2), p95: +t[Math.floor(frames * 0.95)].toFixed(2),
      avg: +(t.reduce((s, x) => s + x, 0) / frames).toFixed(2),
      drawCalls: st.drawCalls, tris: st.tris, physMs: +st.physMs.toFixed(2),
      ducks: st.ducksLive, awake: st.awake,
    };
  };

  // Render cost alone, glFinish'd. This is the number that moves when the
  // shadow frustum or the map size changes; BENCH is dominated by the solver.
  window.RENDERMS = function (n) {
    n = n || 200;
    const t = [];
    for (let i = 0; i < 20; i++) g.three.render(g.view.scene, g.camera);
    for (let i = 0; i < n; i++) {
      const a = performance.now();
      g.three.render(g.view.scene, g.camera);
      g.three.getContext().finish();
      t.push(performance.now() - a);
    }
    t.sort((a, b) => a - b);
    const inf = g.three.info.render;
    return {
      med: +t[n >> 1].toFixed(3), avg: +(t.reduce((s, x) => s + x, 0) / n).toFixed(3),
      p95: +t[Math.floor(n * 0.95)].toFixed(3), calls: inf.calls, tris: inf.triangles,
    };
  };

  // Drop every duck, so one measurement cannot inherit the last one's field.
  window.CLEAR = function () {
    const ids = [];
    g.world.ducks.forEach((id) => ids.push(id));
    ids.forEach((id) => { try { g.world.ducks.release(id); } catch (e) { /* already gone */ } });
    g.debugStep(0.2);
    return g.debugStats().ducksLive;
  };

  return 'artdir harness ready';
})();
