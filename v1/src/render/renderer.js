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
  renderer.shadowMap.enabled = false;

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
    get grainCanvas() { return grain; },
    get grainOpacity() { return grainOpacity(); },
    setGrainAmount(a) {
      config.render.grainAmount = Number(a);
      grain.style.opacity = String(grainOpacity());
      buildGrain(grain.width, grain.height);
      return grainOpacity();
    },
    render(scene, camera) { renderer.render(scene, camera); drawGrain(); },
    dispose() { renderer.dispose(); },
  };
}
