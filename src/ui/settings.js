// Player preferences: the store that persists them and the panel that edits
// them. DOM only, like every other panel here.
//
// Three rules shape this file.
//
// 1. A SETTING IS THE NUMBER THE GAME READS, not a proxy for it. The
//    sensitivity slider stores radians-per-pixel because that is what
//    src/core/input.js reads; the FOV slider stores degrees because that is
//    what the camera takes. A setting that has to be decoded before it can be
//    checked is a setting that can silently disagree with the game.
// 2. NOTHING PERSISTED HERE IS AN IDENTITY. Presence ids and peer ids are per
//    page load and are generated in src/net/ (frozen G4 contract rule 8, which
//    exists because reusing a stored id broke an earlier project). A nickname
//    and a colour are what the player chose to be called and to look like;
//    they are not who they are on the wire, and nothing in this file reads or
//    writes an id.
// 3. STORAGE IS ALLOWED TO FAIL. Safari in private mode throws on
//    localStorage.setItem, and a browser that refuses to remember a volume
//    slider must cost the player their volume slider and nothing else. Every
//    access is guarded and the panel keeps working with storage dead.

import config from '../config.js';
import CRT, { injectCRT } from './theme.js';

// Every value below comes from src/ui/theme.js. A hex typed here is a hex that
// disagrees with the menu the moment either is touched.
const CSS = `
#settings { position: fixed; inset: 0; z-index: ${CRT.layer.settings}; display: none;
  align-items: center; justify-content: center; pointer-events: none;
  font: 400 ${CRT.type.body.size}/${CRT.type.body.line} ${CRT.display};
  letter-spacing: ${CRT.type.body.track}; color: ${CRT.on}; }
#settings.open { display: flex; }
#settings input, #settings button { font: inherit; color: inherit; letter-spacing: inherit; }
#settings button:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
/* Dim, never blur: a CRT has no depth of field and a blur here reads as a
   different product sitting on top of this one. */
#settings-scrim { position: absolute; inset: 0; background: ${CRT.scrim}; }
#settings-panel { position: relative; width: min(680px, 92vw); max-height: 86vh;
  display: flex; flex-direction: column; pointer-events: auto;
  background: ${CRT.bgRaised}; border: ${CRT.hairline} solid ${CRT.border};
  animation: ${CRT.powerOn}; }
#settings-head { display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: ${CRT.hairline} solid ${CRT.border}; }
#settings-title { font-size: ${CRT.type.heading.size}; line-height: ${CRT.type.heading.line};
  letter-spacing: ${CRT.type.heading.track}; text-transform: uppercase;
  color: ${CRT.bright}; text-shadow: ${CRT.glowSoft}; }
#settings-store { font-family: ${CRT.data}; font-size: ${CRT.type.dataSm.size};
  letter-spacing: ${CRT.type.dataSm.track}; text-transform: uppercase; color: ${CRT.ok}; }
#settings-store.bad { color: ${CRT.warn}; }
#settings-body { overflow-y: auto; padding: 4px 0 0; }
.set-sec { padding: 12px 16px; border-bottom: ${CRT.hairline} solid ${CRT.border}; }
.set-sec h4 { margin: 0 0 8px; font-weight: 400;
  font-size: ${CRT.type.label.size}; line-height: ${CRT.type.label.line};
  letter-spacing: ${CRT.type.label.track}; text-transform: uppercase; color: ${CRT.dim}; }
.set-row { display: grid; grid-template-columns: 220px 1fr 92px; gap: 12px;
  align-items: center; padding: 6px 0; }
.set-row .lb { color: ${CRT.on}; }
.set-row .lb small { display: block; color: ${CRT.dim};
  font-family: ${CRT.data}; font-size: ${CRT.type.dataSm.size};
  line-height: ${CRT.type.dataSm.line}; letter-spacing: ${CRT.type.dataSm.track}; }
/* Numbers stay in the data face. Aligned columns of digits are the one thing a
   bitmap face does badly. */
.set-row .vl { font-family: ${CRT.data}; font-size: ${CRT.type.dataRow.size};
  letter-spacing: ${CRT.type.dataRow.track}; color: ${CRT.bright};
  text-align: right; white-space: nowrap; }
.set-row input[type=range] { width: 100%; accent-color: ${CRT.bright}; cursor: pointer; }
.set-row input[type=text] { width: 100%; padding: 7px 10px; background: ${CRT.bg};
  border: ${CRT.hairline} solid ${CRT.border}; color: ${CRT.bright};
  transition: border-color ${CRT.fast} ${CRT.ease}; }
.set-row input[type=text]:focus { outline: none; border-color: ${CRT.borderHot}; }
#settings-colors { display: flex; gap: 8px; flex-wrap: wrap; }
.set-swatch { width: 26px; height: 26px; padding: 0; cursor: pointer;
  border: ${CRT.hairline} solid ${CRT.border}; appearance: none;
  transition: border-color ${CRT.fast} ${CRT.ease}, box-shadow ${CRT.fast} ${CRT.ease}; }
.set-swatch:hover { border-color: ${CRT.borderHot}; }
.set-swatch.on { border-color: ${CRT.hot}; box-shadow: ${CRT.glowSoft}; }
.set-btn { appearance: none; cursor: pointer; min-width: 104px; padding: 7px 12px;
  background: ${CRT.bgPanel}; border: ${CRT.hairline} solid ${CRT.border};
  color: ${CRT.on}; font-size: ${CRT.type.nav.size}; line-height: 1;
  letter-spacing: ${CRT.type.nav.track};
  transition: color ${CRT.fast} ${CRT.ease}, border-color ${CRT.fast} ${CRT.ease},
    text-shadow ${CRT.fast} ${CRT.ease}; }
.set-btn:hover, .set-btn:focus-visible { color: ${CRT.hot};
  border-color: ${CRT.borderHot}; text-shadow: ${CRT.glowText}; }
.set-btn.go { color: ${CRT.bright}; border-color: ${CRT.borderHot}; }
#settings-foot { display: flex; align-items: center; justify-content: space-between;
  gap: 12px; padding: 9px 16px; border-top: ${CRT.hairline} solid ${CRT.border};
  color: ${CRT.dim}; }
#settings-msg { color: ${CRT.ok}; }
#settings-actions { display: flex; gap: 8px; }
@media (max-width: 720px) {
  .set-row { grid-template-columns: 1fr; gap: 6px; }
  .set-row .vl { text-align: left; }
}
@media (prefers-reduced-motion: reduce) {
  #settings-panel { animation: none; }
  #settings * { transition: none !important; }
}
`;

function el(tag, cls, parent, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}

function clamp(v, lo, hi) {
  const n = Number(v);
  if (!isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

const HEX = /^#[0-9a-f]{6}$/i;

// The one place that says what a preference is, what it may be, and how it is
// spelled on screen. The panel builds itself from this list, so adding a
// preference is one row here and nothing else.
export function fields() {
  const S = config.settings;
  return [
    { key: 'masterVolume', group: 'Audio', label: 'Master volume',
      hint: 'scales the whole bus', kind: 'range',
      min: S.volumeMin, max: S.volumeMax, step: S.volumeStep,
      def: S.masterVolume, format: (v) => Math.round(v * 100) + '%' },
    { key: 'sfxVolume', group: 'Audio', label: 'Sound effects',
      hint: 'ducks, clicks, impacts', kind: 'range',
      min: S.volumeMin, max: S.volumeMax, step: S.volumeStep,
      def: S.sfxVolume, format: (v) => Math.round(v * 100) + '%' },
    { key: 'ambientVolume', group: 'Audio', label: 'Ambience and machines',
      hint: 'the loops under the action', kind: 'range',
      min: S.volumeMin, max: S.volumeMax, step: S.volumeStep,
      def: S.ambientVolume, format: (v) => Math.round(v * 100) + '%' },
    { key: 'mouseSensitivity', group: 'Controls', label: 'Mouse sensitivity',
      hint: 'radians of look per pixel', kind: 'range',
      min: S.sensitivityMin, max: S.sensitivityMax, step: S.sensitivityStep,
      def: S.mouseSensitivity, format: (v) => v.toFixed(4) },
    { key: 'fov', group: 'Display', label: 'Field of view',
      hint: 'vertical, degrees', kind: 'range',
      min: S.fovMin, max: S.fovMax, step: S.fovStep,
      def: S.fov, format: (v) => Math.round(v) + ' deg' },
    // ONE NAME. This setting was called three different things in three places:
    // "Render width" here, "Pixel size" in the menu's Settings summary, and
    // "buffer 480 px" in the value that summary printed. Three names for one
    // slider, and the reader has to work out that they are the same knob. It is
    // "Pixel size" everywhere now -- the menu row, this label, and the wording
    // of the hint.
    //
    // The hint also has to say the thing the panel was silently lying about: the
    // number here is where the buffer STARTS. src/core/perf.js moves it up and
    // down to hold the frame rate, so a panel reading 480 while the game ran at
    // 560 was not a stale widget, it was the panel reporting a setting as if it
    // were a measurement. The row shows the live width beside it (see the range
    // control below) and this line explains why the two can differ.
    { key: 'bufferWidth', group: 'Display', label: 'Pixel size',
      hint: 'width of the pixel buffer; lower is chunkier and faster. The game moves it to hold the frame rate',
      kind: 'range',
      min: config.render.bufferWidthMin, max: config.render.bufferWidthMax,
      step: S.bufferWidthStep, def: S.bufferWidth,
      format: (v) => Math.round(v) + ' px' },
    { key: 'nickname', group: 'Player', label: 'Name',
      hint: 'what other players see above your head', kind: 'text',
      def: '', max: config.lobby.maxNickChars },
    { key: 'avatarColor', group: 'Player', label: 'Colour',
      hint: 'your avatar, as everyone else sees it', kind: 'color',
      def: config.menu.defaultColor },
  ];
}

// --- the store ---------------------------------------------------------------
//
// targets are the live objects a preference acts on. They are handed in rather
// than imported so this file never learns that a renderer or an audio bus
// exists as a module -- and so a test can drive the store with no game at all.
export function createSettings(opts) {
  const o = opts || {};
  const t = o.targets || {};
  const key = o.storageKey || 'ducks.prefs';
  const spec = fields();
  const byKey = Object.create(null);
  spec.forEach((f) => { byKey[f.key] = f; });

  let storageError = null;
  function store() {
    try {
      const s = o.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
      if (!s) { storageError = 'no localStorage'; return null; }
      return s;
    } catch (err) {
      // Reading window.localStorage itself throws when cookies are blocked.
      storageError = err && err.message ? err.message : String(err);
      return null;
    }
  }

  function coerce(f, v) {
    if (f.kind === 'range') return clamp(v, f.min, f.max);
    if (f.kind === 'color') return HEX.test(String(v)) ? String(v) : f.def;
    return String(v === undefined || v === null ? f.def : v).slice(0, f.max || 64);
  }

  const values = Object.create(null);
  spec.forEach((f) => { values[f.key] = f.def; });

  // A stored blob from a different schema is DISCARDED, not migrated field by
  // field: the version exists so that changing what a field means is safe, and
  // reinterpreting an old number under a new rule is exactly what it is meant
  // to prevent.
  let loaded = false;
  let loadError = null;
  function load() {
    const s = store();
    if (!s) return false;
    let raw = null;
    try { raw = s.getItem(key); } catch (err) {
      storageError = err && err.message ? err.message : String(err);
      return false;
    }
    if (!raw) return false;
    let blob = null;
    try { blob = JSON.parse(raw); } catch (err) {
      loadError = 'stored preferences were not readable JSON';
      return false;
    }
    if (!blob || typeof blob !== 'object' || blob.schema !== config.settings.schema) {
      loadError = 'stored preferences were from another schema and were ignored';
      return false;
    }
    spec.forEach((f) => {
      if (blob[f.key] !== undefined) values[f.key] = coerce(f, blob[f.key]);
    });
    loaded = true;
    return true;
  }

  function save() {
    const s = store();
    if (!s) return false;
    const blob = { schema: config.settings.schema };
    spec.forEach((f) => { blob[f.key] = values[f.key]; });
    try {
      s.setItem(key, JSON.stringify(blob));
      storageError = null;
      return true;
    } catch (err) {
      // Private mode, a full quota, a blocked origin. The game is unaffected.
      storageError = err && err.message ? err.message : String(err);
      return false;
    }
  }

  function clear() {
    const s = store();
    if (!s) return false;
    try { s.removeItem(key); return true; } catch (_) { return false; }
  }

  // Applying is per key so that changing one preference costs one action --
  // moving the FOV slider must not rebuild the backbuffer.
  function applyOne(k) {
    const v = values[k];
    if (k === 'masterVolume' && t.audio && t.audio.bus) t.audio.bus.setMasterVolume(v);
    else if (k === 'sfxVolume' && t.audio && t.audio.bus) t.audio.bus.setSfxVolume(v);
    else if (k === 'ambientVolume' && t.audio && t.audio.bus) t.audio.bus.setLoopVolume(v);
    else if (k === 'mouseSensitivity') config.player.mouseSensitivity = v;
    else if (k === 'fov') {
      config.render.fov = v;
      if (t.camera) { t.camera.fov = v; t.camera.updateProjectionMatrix(); }
    } else if (k === 'bufferWidth') {
      // The renderer clamps and reports what it actually took; perf is told the
      // same number so its next adaptation step starts from the truth rather
      // than from the width it last chose by itself.
      if (t.renderer) {
        const sized = t.renderer.applySize(v);
        if (t.setAspect) t.setAspect(sized.aspect);
        if (t.perf && t.perf.setBufferWidth) t.perf.setBufferWidth(t.renderer.bufferWidth);
      }
    } else if (k === 'nickname') {
      // ONE nickname in the game. The lobby's box is a view of this value, not
      // a second copy of it.
      if (t.setNickname) t.setNickname(v);
    } else if (k === 'avatarColor') {
      if (t.setAvatarColor) t.setAvatarColor(v);
    }
    return values[k];
  }

  function applyAll() {
    spec.forEach((f) => applyOne(f.key));
    return { ...values };
  }

  function set(k, v, opt) {
    const f = byKey[k];
    if (!f) return null;
    values[k] = coerce(f, v);
    applyOne(k);
    if (!(opt && opt.transient)) save();
    if (o.onChange) o.onChange(k, values[k]);
    return values[k];
  }

  load();

  return {
    fields: () => spec.slice(),
    get: (k) => values[k],
    all: () => ({ ...values }),
    set,
    save,
    applyAll,
    reset() {
      spec.forEach((f) => { values[f.key] = f.def; });
      applyAll();
      save();
      return { ...values };
    },
    clearStored: clear,
    storageKey: key,
    state: () => ({
      values: { ...values },
      loadedFromStorage: loaded,
      storageAvailable: !!store(),
      storageError,
      loadError,
      schema: config.settings.schema,
    }),
  };
}

// --- the panel ---------------------------------------------------------------

export function createSettingsUI(opts) {
  const o = opts || {};
  const settings = o.settings;
  const container = o.container || document.body;
  const ui = typeof o.onUi === 'function' ? o.onUi : () => {};

  injectCRT(document);
  const style = document.createElement('style');
  style.id = 'settings-style';
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = el('div', null, container);
  root.id = 'settings';
  const scrim = el('div', null, root);
  scrim.id = 'settings-scrim';
  const panel = el('div', 'crt-scan', root);
  panel.id = 'settings-panel';
  // The theme's reduced-transparency and increased-contrast rules key off this
  // attribute, so every surface in the game wears it.
  panel.setAttribute('data-crt-pane', '');

  const head = el('div', null, panel);
  head.id = 'settings-head';
  const title = el('div', null, head, 'Settings');
  title.id = 'settings-title';
  const storeState = el('div', null, head, '');
  storeState.id = 'settings-store';

  const body = el('div', null, panel);
  body.id = 'settings-body';

  const foot = el('div', null, panel);
  foot.id = 'settings-foot';
  const msg = el('div', null, foot, '');
  msg.id = 'settings-msg';
  const actions = el('div', null, foot);
  actions.id = 'settings-actions';
  const resetBtn = el('button', 'set-btn', actions, 'Reset');
  const closeBtn = el('button', 'set-btn go', actions, 'Done');

  let open = false;
  let flashTimer = 0;
  const controls = [];

  // What a setting is ACTUALLY running at, when that is a different question
  // from what the player asked for. `o.live` is a map of key -> function, handed
  // in by main.js from the live objects (renderer.bufferWidth, today the only
  // one), because this file must not learn that a renderer exists. A key with no
  // entry here has no gap to report and prints exactly what it always did.
  const live = o.live || {};
  function liveValue(key) {
    const fn = live[key];
    if (typeof fn !== 'function') return null;
    const v = Number(fn());
    return isFinite(v) ? v : null;
  }

  function say(text) {
    msg.textContent = text || '';
    clearTimeout(flashTimer);
    if (text) {
      flashTimer = setTimeout(() => { msg.textContent = ''; }, Math.round(config.menu.flashMs));
    }
  }

  // Sections come from the field list, in the order the fields are declared, so
  // the panel cannot fall out of step with the store.
  const sections = Object.create(null);
  function sectionFor(name) {
    if (sections[name]) return sections[name];
    const sec = el('div', 'set-sec', body);
    el('h4', null, sec, name);
    sections[name] = sec;
    return sec;
  }

  settings.fields().forEach((f) => {
    const sec = sectionFor(f.group);
    const row = el('div', 'set-row', sec);
    row.dataset.key = f.key;
    const lb = el('div', 'lb', row, f.label);
    if (f.hint) el('small', null, lb, f.hint);

    if (f.kind === 'range') {
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(f.min);
      input.max = String(f.max);
      input.step = String(f.step);
      input.value = String(settings.get(f.key));
      row.appendChild(input);
      // The value cell says what the slider is set to, and -- only when the two
      // disagree -- what the game is running at right now. Both, never one
      // standing in for the other: the slider position has to match the number
      // beside it, and the panel must not claim a width the renderer is not
      // using. This is the fix for "Settings shows 480 px while the applied
      // buffer is 560": neither number was wrong, the panel was showing one of
      // them and letting the reader assume it was the other.
      function valueText() {
        const v = Number(settings.get(f.key));
        const now = liveValue(f.key);
        if (now === null || Math.round(now) === Math.round(v)) return f.format(v);
        return f.format(v) + '  (now ' + f.format(now) + ')';
      }
      const out = el('div', 'vl', row, valueText());
      // Dragging applies live and does NOT hit localStorage on every pixel;
      // the commit on release is what is written.
      input.addEventListener('input', () => {
        settings.set(f.key, input.value, { transient: true });
        out.textContent = valueText();
      });
      input.addEventListener('change', () => {
        settings.set(f.key, input.value);
        ui('click');
        say('Saved');
      });
      controls.push({ f, sync() { input.value = String(settings.get(f.key)); out.textContent = valueText(); } });
    } else if (f.kind === 'text') {
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = f.max || 24;
      input.placeholder = 'player';
      input.value = String(settings.get(f.key) || '');
      row.appendChild(input);
      el('div', 'vl', row, '');
      input.addEventListener('input', () => settings.set(f.key, input.value, { transient: true }));
      input.addEventListener('change', () => { settings.set(f.key, input.value); say('Saved'); });
      input.addEventListener('blur', () => { settings.set(f.key, input.value); });
      controls.push({ f, sync() { input.value = String(settings.get(f.key) || ''); } });
    } else if (f.kind === 'color') {
      const box = el('div', null, row);
      box.id = 'settings-colors';
      const swatches = config.menu.palette.map((hex) => {
        const b = el('button', 'set-swatch', box, '');
        b.style.background = hex;
        b.dataset.color = hex;
        b.title = hex;
        b.addEventListener('click', () => {
          settings.set(f.key, hex);
          ui('click');
          syncAll();
          say('Saved');
        });
        return b;
      });
      el('div', 'vl', row, '');
      controls.push({
        f,
        sync() {
          const cur = String(settings.get(f.key)).toLowerCase();
          swatches.forEach((b) => b.classList.toggle('on', b.dataset.color.toLowerCase() === cur));
        },
      });
    }
  });

  function syncAll() {
    controls.forEach((c) => c.sync());
    const st = settings.state();
    storeState.textContent = st.storageAvailable ? 'saved on this device' : 'not saved (storage blocked)';
    storeState.classList.toggle('bad', !st.storageAvailable);
  }
  syncAll();

  resetBtn.addEventListener('click', () => { settings.reset(); syncAll(); ui('click'); say('Reset to defaults'); });
  closeBtn.addEventListener('click', () => doClose());
  scrim.addEventListener('click', () => doClose());

  function doOpen() {
    if (open) return false;
    open = true;
    syncAll();
    say('');
    root.classList.add('open');
    if (document.exitPointerLock) document.exitPointerLock();
    if (o.onOpen) o.onOpen();
    return true;
  }

  function doClose() {
    if (!open) return false;
    open = false;
    root.classList.remove('open');
    if (o.onClose) o.onClose();
    return true;
  }

  return {
    root,
    open: doOpen,
    close: doClose,
    toggle() { return open ? (doClose(), false) : (doOpen(), true); },
    isOpen: () => open,
    sync: syncAll,
    state: () => ({
      open,
      message: msg.textContent,
      store: storeState.textContent,
      rows: Array.from(body.querySelectorAll('.set-row')).map((r) => ({
        key: r.dataset.key,
        label: r.querySelector('.lb').firstChild.textContent,
        value: r.querySelector('.vl') ? r.querySelector('.vl').textContent : '',
        input: r.querySelector('input') ? r.querySelector('input').value : null,
      })),
      settings: settings.state(),
    }),
    dispose() {
      clearTimeout(flashTimer);
      if (root.parentNode) root.parentNode.removeChild(root);
      if (style.parentNode) style.parentNode.removeChild(style);
    },
  };
}

export default createSettings;
