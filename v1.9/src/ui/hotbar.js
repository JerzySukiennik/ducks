// The hotbar: nine slots, 1-9, and the ONLY interface element the game screen
// carries besides the money counter and the onboarding hint.
//
// Every other strip that used to live down here is gone. The key-prompt bar
// moved into the menu's Controls panel; the status strip that read
// "IDLE / Nothing in hand" is gone because the bar already says it -- a slot
// drawn as selected IS "in hand", and no slot selected IS "nothing in hand".
// The two things the strip said that a hologram cannot (why a placement was
// refused, and how far a demolish hold has got) moved to the crosshair prompt
// in src/ui/hud.js, which is where the player is already looking.
//
// A slot holds a buildable OR a tool. Selecting a tool's slot equips it and
// selecting away puts it back, so the slot IS the equip switch -- that is why
// pressing the selected digit again deselects rather than doing nothing.
//
// Colour, type, timing and surface all come from src/ui/theme.js. Slot text is
// the theme's DATA face, not its display face: a bitmap face is exactly wrong
// for the one thing this bar does, which is stack short names against counts.

import config from '../config.js';
import { REASONS } from '../sim/build.js';
import CRT, { injectCRT } from './theme.js';

// Reason codes come from src/sim/build.js; the text lives here, in the UI.
const REASON_TEXT = {
  [REASONS.NO_SURFACE]: 'No ground in view',
  [REASONS.TOO_FAR]: 'Too far away',
  [REASONS.TOO_CLOSE]: 'Too close',
  [REASONS.OUT_OF_BOUNDS]: 'Outside the plate',
  [REASONS.PIT]: 'Too close to the pit',
  [REASONS.BOOTH]: 'Blocked by the booth',
  [REASONS.OVERLAP]: 'Overlaps something already there',
  [REASONS.NOT_PLACEABLE]: 'Not placeable',
};

export function reasonText(code) {
  if (!code) return '';
  return REASON_TEXT[code] || code;
}

// Nine cells have to fit a 1280 px screen without becoming the screen. 64 px
// cells with 4 px gutters come to 608 px -- under half the width, and still wide
// enough for a two-word item name at the data face's smallest size.
const CELL_W = 64;
const CELL_H = 58;
const GAP = 4;

const CSS = `
#bar { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%);
  z-index: 14; pointer-events: none; display: none;
  font: ${CRT.type.dataSm.size}/${CRT.type.dataSm.line} ${CRT.data};
  color: ${CRT.on}; }
#bar.on { display: block; }
#bar-slots { position: relative; display: flex; gap: ${GAP}px;
  padding: ${GAP}px; background: ${CRT.bgPanel};
  border: ${CRT.hairline} solid ${CRT.border}; border-radius: ${CRT.radius}; }
.bar-slot { position: relative; box-sizing: border-box;
  width: ${CELL_W}px; height: ${CELL_H}px;
  background: ${CRT.bgRaised};
  border: ${CRT.hairline} solid ${CRT.border};
  display: flex; flex-direction: column; justify-content: center;
  padding: 12px 4px 4px; overflow: hidden;
  transition: border-color ${CRT.fast} ${CRT.ease},
    background-color ${CRT.fast} ${CRT.ease}, box-shadow ${CRT.fast} ${CRT.ease}; }
.bar-slot.sel { border-color: ${CRT.bright}; background: ${CRT.bgRaised};
  box-shadow: 0 0 0 1px ${CRT.bright} inset, ${CRT.glowSoft}; }
/* An emptied slot keeps its label and dims -- it is still that item's slot. */
.bar-slot.empty { border-color: ${CRT.faint}; }
.bar-slot.empty .n { color: ${CRT.faint}; }
.bar-slot .k { position: absolute; top: 2px; left: 4px;
  font-size: ${CRT.type.dataSm.size}; letter-spacing: ${CRT.type.dataSm.track};
  color: ${CRT.dim}; }
.bar-slot.sel .k { color: ${CRT.hot}; text-shadow: ${CRT.glowText}; }
.bar-slot .n { font-size: 10px; line-height: 1.15; color: ${CRT.on};
  max-height: 3.45em; overflow: hidden; word-break: break-word; }
.bar-slot.sel .n { color: ${CRT.bright}; }
.bar-slot .c { position: absolute; right: 4px; bottom: 3px;
  font-size: ${CRT.type.dataSm.size}; font-weight: 700; color: ${CRT.ok}; }
`;

function el(tag, cls, parent, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}

export function createHotbar({ container }) {
  injectCRT(document);
  const style = document.createElement('style');
  style.id = 'bar-style';
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = el('div', null, container || document.body);
  root.id = 'bar';
  // The tube treatment goes on the slot strip, which is the only thing with a
  // surface; scanlines over a transparent wrapper would darken the game behind it.
  const slotsEl = el('div', 'crt-scan', root);
  slotsEl.id = 'bar-slots';

  const count = Math.max(1, Math.round(config.shop.hotbarSlots));
  const slots = new Array(count).fill(null);
  let selected = 0;

  // The status strip is gone from the screen, but the state it carried is still
  // read by the verification surface and by main.js, which routes the two
  // load-bearing messages to the crosshair prompt. Kept as data, not DOM.
  let status = { mode: 'build', text: '', rotation: '' };

  const slotEls = [];
  for (let i = 0; i < count; i++) {
    const s = el('div', 'bar-slot empty', slotsEl);
    el('span', 'k', s, String(i + 1));
    el('div', 'n', s, '');
    el('div', 'c', s, '');
    slotEls.push(s);
  }

  function render() {
    for (let i = 0; i < count; i++) {
      const s = slots[i];
      const node = slotEls[i];
      node.classList.toggle('empty', !s || s.count <= 0);
      node.classList.toggle('sel', i === selected);
      node.querySelector('.n').textContent = s ? s.name : '';
      node.querySelector('.c').textContent = s && s.count > 0 ? 'x' + s.count : '';
    }
    // Always on once the game screen exists. A hotbar that appears the moment
    // you buy something is a second thing to learn; nine empty slots are the
    // one place the player already knows to look.
    root.classList.add('on');
  }

  // Is there anywhere for this id to go? A slot it already occupies counts, and
  // an emptied slot counts because an emptied slot is reusable. Exported so a
  // caller can ASK before it starts a transaction it cannot undo -- see pickUp()
  // in src/main.js, which is the one path that fills this bar.
  function slotFor(id) {
    for (let i = 0; i < count; i++) if (slots[i] && slots[i].id === id) return i;
    return slots.findIndex((s) => !s || s.count <= 0);
  }

  function hasRoom(id) { return slotFor(id) >= 0; }

  // Buying an item puts it in its own slot, or increments the slot it already
  // has. Slots are keyed by item id and never reused while the item is held, so
  // a purchase cannot silently displace what is in hand.
  //
  // A FULL BAR REFUSES, and returns -1 having changed nothing. It used to write
  // the newest item over slot 9 -- `if (idx < 0) idx = count - 1` -- which is
  // the one denial in this game that deleted something instead of explaining
  // itself: with nine slots full, a tenth item ate whatever was in the last one
  // and said nothing. Every caller must treat -1 as "this did not happen"; the
  // refusal is reported to the player through hud.showCap by whoever asked.
  function add(item, quantity) {
    const n = quantity === undefined ? 1 : quantity;
    for (let i = 0; i < count; i++) {
      if (slots[i] && slots[i].id === item.id) {
        slots[i].count += n;
        render();
        return i;
      }
    }
    const idx = slots.findIndex((s) => !s || s.count <= 0);
    if (idx < 0) return -1;
    slots[idx] = { id: item.id, name: item.name, item, count: n };
    if (!slots[selected] || slots[selected].count <= 0) selected = idx;
    render();
    return idx;
  }

  function take(id, n) {
    const k = n === undefined ? 1 : n;
    for (let i = 0; i < count; i++) {
      if (slots[i] && slots[i].id === id) {
        slots[i].count = Math.max(0, slots[i].count - k);
        render();
        return true;
      }
    }
    return false;
  }

  // -1 is "empty hand". Without it, owning a wall would mean never being able to
  // left-click a duck again, because a full hand always places.
  function select(i) {
    if (i < -1 || i >= count) return selected;
    selected = i;
    render();
    return selected;
  }

  function current() {
    if (selected < 0) return null;
    const s = slots[selected];
    return s && s.count > 0 ? s.item : null;
  }

  // mode: 'build' | 'free' | 'demolish' | 'idle'
  // Nothing here draws any more. It is the single place that turns a placement
  // result into player-facing words, and main.js hands those words to the
  // crosshair prompt -- so there is still exactly one such translation, and it
  // is still next to reasonText().
  function setStatus(s) {
    const mode = s.mode || 'build';
    let text = '';
    if (s.text !== undefined && s.text !== null) text = s.text;
    else if (s.reason) text = reasonText(s.reason);
    status = {
      mode,
      text,
      bad: !!s.bad || (!!s.reason && s.text === undefined),
      rotation: s.degrees === undefined ? '' : Math.round(s.degrees) + ' deg',
      grid: s.grid,
      valid: s.valid,
    };
  }

  // Multiplayer: on a CLIENT this bar is display only. The host owns every
  // inventory in the room -- "item X is in player P's hotbar" is a fact about
  // the world, not about a UI -- so a client's bar is written from the roster
  // the host sends rather than from its own add()/take(). Without this a client
  // could show itself holding something the host has already given to somebody
  // else. `resolve` turns an item id back into a catalog row; the bar itself
  // never learns what a row is.
  function setFromNet(list, sel, resolve) {
    const rows = Array.isArray(list) ? list : [];
    for (let i = 0; i < count; i++) slots[i] = null;
    for (let i = 0; i < rows.length && i < count; i++) {
      const r = rows[i];
      if (!r || !r.id || !(r.n > 0)) continue;
      const item = typeof resolve === 'function' ? resolve(r.id) : (r.item || null);
      slots[i] = { id: r.id, name: (item && item.name) || r.id, item, count: r.n };
    }
    if (typeof sel === 'number') selected = sel < -1 || sel >= count ? -1 : sel;
    render();
    return selected;
  }

  render();

  return {
    root,
    add,
    hasRoom,
    slotFor,
    isFull: () => slots.every((s) => s && s.count > 0),
    take,
    setFromNet,
    select,
    current,
    setStatus,
    render,
    // What the removed strip used to say, for whoever needs to show it.
    status: () => ({ ...status }),
    selectedIndex: () => selected,
    slotCount: count,
    countOf(id) {
      for (let i = 0; i < count; i++) if (slots[i] && slots[i].id === id) return slots[i].count;
      return 0;
    },
    state: () => ({
      selected,
      hand: current() ? 'In hand: ' + slots[selected].name + ' (x' + slots[selected].count + ')' : '',
      mode: status.mode,
      status: status.text,
      rotation: status.rotation,
      slots: slots.map((s) => (s ? { id: s.id, name: s.name, count: s.count } : null)),
    }),
    dispose() {
      if (root.parentNode) root.parentNode.removeChild(root);
      if (style.parentNode) style.parentNode.removeChild(style);
    },
  };
}

export default createHotbar;
