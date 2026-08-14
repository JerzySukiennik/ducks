// The key-prompt bar along the bottom of the screen.
//
// Real Kenney Input Prompts glyphs, cut out of the "Keyboard & Mouse" default
// sheet with the rects from the sheet's own XML -- never a hand-typed table of
// coordinates, which is the kind of thing that silently goes stale the moment
// the atlas is regenerated.
//
// Both the sheet and its XML are loaded with a timeout and a procedural
// fallback, because a boot with no network (or a missing asset folder) must
// still put a legible control bar on screen. The fallback is a CSS key cap with
// the label drawn in it: not as pretty, but every prompt still reads.

import config from '../config.js';

const CSS = `
#hud-keys { position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%);
  display: flex; flex-wrap: wrap; justify-content: center;
  align-items: center; gap: 3px 12px; max-width: min(1240px, 96vw);
  color: rgba(207,227,255,0.62); font-size: 11px; line-height: 1; }
#hud-keys .kbg { display: flex; align-items: center; gap: 4px; }
#hud-keys .kbg span { white-space: nowrap; letter-spacing: 0.01em; }
#hud-keys i { display: block; flex: none;
  background-repeat: no-repeat; image-rendering: pixelated; }
#hud-keys i.fb { display: flex; align-items: center; justify-content: center;
  box-sizing: border-box; padding: 0 3px;
  border: 1px solid rgba(207,227,255,0.55); border-bottom-width: 2px;
  border-radius: 3px; background: rgba(10,15,30,0.65);
  color: rgba(226,238,255,0.9); font: 700 10px/1 ui-monospace, Menlo, monospace; }
`;

// One row per prompt: the atlas sub-texture names, the fallback cap text, and
// what the prompt does. Sub-texture names are exactly the ones in the sheet XML.
//
// Every row here was checked against the real binding rather than against what
// the bar used to say. Two were lying to the player and one glyph was doing the
// work of two different controls:
//   - the mouse-wheel glyph was labelled "rotate", but TURNING the wheel changes
//     how far away you hold a duck (`actions.scroll` -> REQ.HOLD_DIST) and it is
//     the middle BUTTON that rotates (`e.button === 1` -> rotation.step). Those
//     are two controls on one device, so they get two rows: `mouse_scroll` is
//     the sheet's wheel-pressed glyph, `mouse_scroll_vertical` its wheel-turned
//     one.
//   - LMB also cranks the workbench wheel and drives an equipped tool, which the
//     old "carry / place" never said.
// Exported: this table is no longer drawn on the game screen (the HUD does not
// build a key bar any more -- the owner wants the hotbar to be the only thing
// down there), and it is now the source the menu's Controls panel reads. The
// rows below are the corrected ones from the audit; do not retype them
// somewhere else, import them.
export const KEY_PROMPTS = [
  { keys: ['keyboard_w', 'keyboard_a', 'keyboard_s', 'keyboard_d'], caps: ['W', 'A', 'S', 'D'], text: 'move' },
  { keys: ['keyboard_shift'], caps: ['SHF'], text: 'sprint' },
  { keys: ['keyboard_space'], caps: ['SPC'], text: 'jump' },
  { keys: ['mouse_left'], caps: ['LMB'], text: 'carry / place / crank' },
  { keys: ['mouse_right'], caps: ['RMB'], text: 'throw duck' },
  { keys: ['keyboard_e'], caps: ['E'], text: 'shop / pick up' },
  { keys: ['keyboard_q'], caps: ['Q'], text: 'drop item' },
  { keys: ['keyboard_1', 'keyboard_9'], caps: ['1', '9'], text: 'hotbar', join: '-' },
  { keys: ['mouse_scroll_vertical'], caps: ['WHL'], text: 'carry distance' },
  // Three glyphs, one prompt, because they are one control. R and T exist
  // because a trackpad has no middle button and rotation was otherwise
  // unreachable; giving them their own row would say they were a second,
  // different way to turn a wall.
  { keys: ['keyboard_r', 'keyboard_t', 'mouse_scroll'], caps: ['R', 'T', 'MMB'], text: 'rotate' },
  { keys: ['keyboard_bracket_open', 'keyboard_bracket_close'], caps: ['[', ']'], text: 'free angle' },
  { keys: ['keyboard_g'], caps: ['G'], text: 'reset angle' },
  { keys: ['keyboard_x'], caps: ['X'], text: 'demolish' },
  { keys: ['keyboard_m'], caps: ['M'], text: 'lobby' },
  { keys: ['keyboard_f3'], caps: ['F3'], text: 'stats' },
];

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

// fetch() has no timeout of its own, so one is imposed. A slow asset must not be
// able to hold the HUD hostage; it just loses to the fallback.
function withTimeout(promise, ms, tag) {
  let timer = 0;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(tag + ' timed out after ' + ms + ' ms')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function loadImage(url, ms) {
  return withTimeout(new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed: ' + url));
    img.src = url;
  }), ms, 'key atlas image');
}

async function loadAtlas() {
  const k = config.keys;
  const base = encodePath(k.atlasPath);
  const xmlUrl = base + encodeURIComponent(k.atlasXml);
  const pngUrl = base + encodeURIComponent(k.atlasImage);

  const res = await withTimeout(fetch(xmlUrl, { cache: 'no-store' }), k.timeoutMs, 'key atlas xml');
  if (!res.ok) throw new Error('key atlas xml HTTP ' + res.status);
  const text = await withTimeout(res.text(), k.timeoutMs, 'key atlas xml body');

  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('key atlas xml is not valid XML');
  const nodes = doc.getElementsByTagName('SubTexture');
  if (!nodes.length) throw new Error('key atlas xml has no SubTexture entries');

  const rects = new Map();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    rects.set(n.getAttribute('name'), {
      x: Number(n.getAttribute('x')),
      y: Number(n.getAttribute('y')),
      w: Number(n.getAttribute('width')),
      h: Number(n.getAttribute('height')),
    });
  }

  const img = await loadImage(pngUrl, k.timeoutMs);
  return { rects, url: pngUrl, width: img.naturalWidth, height: img.naturalHeight };
}

export function createKeyBar(parent) {
  const k = config.keys;

  const style = document.createElement('style');
  style.id = 'keybar-style';
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'hud-keys';
  root.style.opacity = String(k.opacity);
  (parent || document.body).appendChild(root);

  let mode = 'fallback';
  let glyphCount = 0;

  function capGlyph(text) {
    const i = document.createElement('i');
    i.className = 'fb';
    i.textContent = text;
    i.style.height = k.glyphSize * 0.72 + 'px';
    i.style.minWidth = k.glyphSize * 0.72 + 'px';
    return i;
  }

  function atlasGlyph(atlas, name, capText) {
    const r = atlas.rects.get(name);
    if (!r) return capGlyph(capText);
    // One scale for the whole sheet, so every glyph keeps its authored size
    // relative to the others: a mouse prompt is taller than a letter key and is
    // supposed to stay that way.
    const s = k.glyphSize / r.h;
    const i = document.createElement('i');
    i.style.width = Math.round(r.w * s) + 'px';
    i.style.height = Math.round(r.h * s) + 'px';
    i.style.backgroundImage = 'url("' + atlas.url + '")';
    i.style.backgroundSize = Math.round(atlas.width * s) + 'px ' + Math.round(atlas.height * s) + 'px';
    i.style.backgroundPosition = '-' + Math.round(r.x * s) + 'px -' + Math.round(r.y * s) + 'px';
    glyphCount++;
    return i;
  }

  function render(atlas) {
    root.textContent = '';
    glyphCount = 0;
    mode = atlas ? 'atlas' : 'fallback';
    for (let p = 0; p < KEY_PROMPTS.length; p++) {
      const row = KEY_PROMPTS[p];
      const group = document.createElement('div');
      group.className = 'kbg';
      for (let i = 0; i < row.keys.length; i++) {
        if (i > 0 && row.join) {
          const sep = document.createElement('span');
          sep.textContent = row.join;
          group.appendChild(sep);
        }
        group.appendChild(atlas
          ? atlasGlyph(atlas, row.keys[i], row.caps[i])
          : capGlyph(row.caps[i]));
      }
      const text = document.createElement('span');
      text.textContent = row.text;
      group.appendChild(text);
      root.appendChild(group);
    }
  }

  render(null);

  const ready = loadAtlas().then((atlas) => {
    render(atlas);
    return true;
  }).catch((err) => {
    // Never fatal, never a blank bar: the procedural caps are already on screen.
    console.warn('[keybar] key prompt atlas unavailable, using drawn caps:', err && err.message);
    if (window.__ducksNotice) {
      window.__ducksNotice('Key prompt art unavailable; showing plain key caps.', 'keybar');
    }
    return false;
  });

  return {
    root,
    ready,
    mode: () => mode,
    glyphCount: () => glyphCount,
    promptCount: () => KEY_PROMPTS.length,
    dispose() {
      if (root.parentNode) root.parentNode.removeChild(root);
      if (style.parentNode) style.parentNode.removeChild(style);
    },
  };
}

export default createKeyBar;
