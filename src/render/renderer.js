// PSX backbuffer: render small, upscale with CSS pixelated. No post-processing.

import * as THREE from 'three';
import config from '../config.js';
import { noiseCanvas } from './materials.js';

// Grain frames live at backbuffer resolution, so one grain texel is exactly one
// rendered pixel once CSS upscales both canvases by the same factor.
//
// Strength is tuned in ONE place: config.render.grainAmount. It scales the
// layer's reference opacity, so halving it halves the difference the grain
// makes to every pixel on screen.
function grainOpacity() {
  return config.render.grainOpacity * config.render.grainAmount;
}

export function createRenderer(container) {
  const canvas = document.createElement('canvas');
  canvas.id = 'view';
  container.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    stencil: false,
    alpha: false,
  });
  renderer.setClearColor(config.render.clearColor, 1);
  // Real shadows, and BasicShadowMap on purpose. PCF spends a per-texel filter
  // on every shadowed fragment to buy a soft edge this game does not want: the
  // whole look is flat shading and hard edges at a 480 px backbuffer, where a
  // softened edge is a smear across two visible pixels. Basic is also the
  // cheapest of the three, which is what keeps 300 ducks inside the frame
  // budget. The shadow camera is fitted in render/view.js -- see the comment
  // there for why an unfitted one over a 180 m plate is worthless.
  renderer.shadowMap.enabled = !!config.world.shadowsEnabled;
  renderer.shadowMap.type = THREE.BasicShadowMap;
  // Static shadow map: nothing here changes light direction or map size at run
  // time, so autoUpdate stays on only because casters MOVE every frame -- 300
  // ducks and every placed object. Turning it off would freeze the first frame's
  // shadows in place.
  renderer.shadowMap.autoUpdate = true;

  // Vignette: one static element composited by CSS over the upscaled backbuffer.
  // It is painted once at boot and never touched again, so it costs nothing per
  // frame -- unlike the grain layer, which has to redraw noise. At
  // vignetteAmount 0 it is not created at all.
  const v = config.render;
  let vignette = null;
  if (v.vignetteAmount > 0) {
    vignette = document.createElement('div');
    vignette.id = 'vignette';
    vignette.style.cssText = [
      'position:fixed', 'inset:0', 'pointer-events:none',
      // Percentages on a radial-gradient's radius are relative to the box, and
      // `farthest-corner` makes 100% the corner distance -- which is what makes
      // the inner/outer fractions resolution independent.
      'background:radial-gradient(farthest-corner at 50% 50%,' +
        ' rgba(0,0,0,0) ' + (v.vignetteInner * 100).toFixed(1) + '%,' +
        ' rgba(0,0,0,' + v.vignetteAmount.toFixed(3) + ') ' +
        (v.vignetteOuter * 100).toFixed(1) + '%)',
    ].join(';');
    container.appendChild(vignette);
  }

  const grain = document.createElement('canvas');
  grain.id = 'grain';
  grain.width = 1;
  grain.height = 1;
  grain.style.opacity = String(grainOpacity());
  container.appendChild(grain);
  const grainCtx = grain.getContext('2d');
  let grainFrames = [];
  let grainIndex = 0;

  // The canvas always tracks the backbuffer, but the noise frames are only
  // generated while the layer is actually drawn. Six full-buffer noise canvases
  // cost 21-26 ms to build, and applySize() calls this on every adaptive width
  // change -- so at grainAmount 0 the resize spent a whole frame drawing noise
  // for a layer that is display:none. The frames are built the moment the knob
  // leaves 0, from drawGrain() or setGrainAmount().
  function buildGrain(w, h) {
    const sized = grain.width === w && grain.height === h;
    if (!sized) {
      grain.width = w;
      grain.height = h;
      grainFrames = [];
    }
    if (!(config.render.grainAmount > 0)) return;
    if (sized && grainFrames.length) return;
    grainFrames = [];
    for (let i = 0; i < config.render.grainFrames; i++) {
      grainFrames.push(noiseCanvas(grain.width, grain.height, config.render.grainStrength));
    }
    grainIndex = 0;
    grainCtx.drawImage(grainFrames[0], 0, 0);
  }

  // At grainAmount 0 the layer is not drawn and the canvas is hidden outright, so
  // "off" costs nothing instead of costing a full-screen composite every frame
  // at an opacity nobody can see.
  function drawGrain() {
    if (!(config.render.grainAmount > 0)) {
      if (grain.style.display !== 'none') grain.style.display = 'none';
      return;
    }
    if (!grainFrames.length) buildGrain(grain.width, grain.height);
    if (!grainFrames.length) return;
    if (grain.style.display === 'none') grain.style.display = '';
    grainIndex = (grainIndex + 1) % grainFrames.length;
    grainCtx.drawImage(grainFrames[grainIndex], 0, 0);
  }

  let width = 0;
  let height = 0;
  let bufferWidth = config.render.bufferWidth;
  let lastSignature = '';

  // Aspect comes from the laid-out CSS box, because window.innerWidth can still
  // be 0 while the page is being framed, which would make the buffer square.
  function displayAspect() {
    const cw = canvas.clientWidth || container.clientWidth || window.innerWidth;
    const ch = canvas.clientHeight || container.clientHeight || window.innerHeight;
    if (cw > 0 && ch > 0) return cw / ch;
    return config.render.fallbackAspect;
  }

  // The backbuffer never carries devicePixelRatio: its aspect must equal the
  // display aspect exactly, and CSS does the upscaling.
  function applySize(requestedWidth) {
    const r = config.render;
    bufferWidth = Math.round(
      Math.max(r.bufferWidthMin, Math.min(r.bufferWidthMax, requestedWidth || bufferWidth))
    );
    width = bufferWidth;
    height = Math.max(1, Math.round(width / displayAspect()));
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    buildGrain(width, height);
    lastSignature = signature();
    return { width, height, aspect: width / height };
  }

  // resize / ResizeObserver are part of the rendering lifecycle, so a hidden tab
  // never delivers them. This cheap guard re-syncs on the next frame instead.
  function signature() {
    return window.innerWidth + 'x' + window.innerHeight + 'x' + bufferWidth;
  }

  function syncSize() {
    if (signature() === lastSignature) return null;
    return applySize(bufferWidth);
  }

  let observer = null;
  function observeResize(onResize) {
    const apply = () => onResize(applySize(bufferWidth));
    window.addEventListener('resize', apply);
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(apply);
      observer.observe(container);
    }
    return () => {
      window.removeEventListener('resize', apply);
      if (observer) observer.disconnect();
      observer = null;
    };
  }

  return {
    three: renderer,
    canvas,
    applySize,
    syncSize,
    observeResize,
    get aspect() { return width / height; },
    get bufferWidth() { return bufferWidth; },
    get bufferHeight() { return height; },
    get info() { return renderer.info.render; },
    // What is RESIDENT, as opposed to what was drawn. A geometry or texture
    // count that only ever climbs is a leak, and a leak is invisible in the
    // draw-call number that sits beside it. `programs` is the compiled shader
    // count: a jump in it mid-session is a material that was never warmed.
    get memory() {
      const m = renderer.info.memory;
      return {
        geometries: m.geometries,
        textures: m.textures,
        programs: renderer.info.programs ? renderer.info.programs.length : 0,
      };
    },
    // SHADER WARM-UP, and it is worth a fifth of a second at exactly the wrong
    // moment. A three.js material compiles its program the first time something
    // tries to DRAW it, so the very first frame of a fresh boot pays for every
    // material in the scene at once. Measured on this machine before this
    // existed: frame 1 spent 140.10 ms inside renderer.render() against the
    // 2.5-3.8 ms it costs once running, with all 13 boot programs appearing on
    // that one frame.
    //
    // compileAsync walks the scene and builds every program up front, off the
    // frame loop, while the menu is still up and nobody is looking. It uses
    // scene.traverse rather than traverseVisible for materials, so an object
    // parked invisible in the scene graph is warmed too -- which is most of what
    // this game hides until it is needed.
    //
    // It cannot warm what is not in the scene yet. Anything built lazily on
    // first use still compiles on first use; see warmMaterials() for that half.
    async warmup(scene, camera) {
      const t0 = performance.now();
      const before = renderer.info.programs ? renderer.info.programs.length : 0;
      try {
        if (typeof renderer.compileAsync === 'function') await renderer.compileAsync(scene, camera);
        else renderer.compile(scene, camera);
      } catch (e) {
        // A warm-up that throws must cost the picture nothing: the materials
        // simply compile on first draw, exactly as they did before.
        console.warn('[renderer] warmup failed, falling back to lazy compile:', e);
      }
      const after = renderer.info.programs ? renderer.info.programs.length : 0;
      return { ms: performance.now() - t0, programsBefore: before, programsAfter: after };
    },
    // The other half: materials whose objects are NOT in the scene at boot
    // because the thing that owns them has not been built yet. Each is compiled
    // against a one-triangle mesh that is added, drawn and removed inside this
    // call, which is the only way to make three build a program for a material
    // nothing is drawing.
    warmMaterials(scene, camera, materials) {
      const list = (Array.isArray(materials) ? materials : [materials]).filter(Boolean);
      if (!list.length) return { ms: 0, warmed: 0 };
      const t0 = performance.now();
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9), 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
      let warmed = 0;
      for (const m of list) {
        const mesh = new THREE.Mesh(geo, m);
        // Never let the warm-up itself be visible: a degenerate triangle at the
        // origin draws nothing, but frustumCulled would also let three skip it
        // and skip the compile with it.
        mesh.frustumCulled = false;
        scene.add(mesh);
        try {
          if (typeof renderer.compile === 'function') { renderer.compile(scene, camera); warmed++; }
        } catch (e) { /* same rule as warmup(): never cost the picture */ }
        scene.remove(mesh);
      }
      geo.dispose();
      return { ms: performance.now() - t0, warmed };
    },
    get grainCanvas() { return grain; },
    get grainOpacity() { return grainOpacity(); },
    setGrainAmount(a) {
      config.render.grainAmount = Number(a);
      grain.style.opacity = String(grainOpacity());
      buildGrain(grain.width, grain.height);
      return grainOpacity();
    },
    get vignetteElement() { return vignette; },
    render(scene, camera) { renderer.render(scene, camera); drawGrain(); },
    dispose() {
      if (vignette && vignette.parentNode) vignette.parentNode.removeChild(vignette);
      vignette = null;
      renderer.dispose();
    },
  };
}
