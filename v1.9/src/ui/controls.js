// The full key list, as a menu panel, and THE ONE key table in the game.
//
// There used to be two. The on-screen key bar along the bottom of the HUD held
// a second copy (src/ui/keybar.js, KEY_PROMPTS) whose own header said "do not
// retype them somewhere else, import them" -- and they had been retyped here,
// and the two had already drifted: the bar never mentioned R pouring a
// container and it lumped R, T and the middle button into one "rotate" prompt.
// The bar was exported, imported by nothing and drawn nowhere, so it is gone
// and KEY_ROWS below is the only table left. If a new binding needs a row, it
// gets one HERE.
//
// Every row was read out of the code that actually handles the key, not out of
// the old bar's labels. The rule is: a row exists because a binding exists, and
// it says what that binding does in src/core/input.js and handleKeys /
// handleActions in src/main.js. The trail for each one is in the `src` field,
// kept in the data so a future edit has to look where this one looked.
//
// Three things the old bar got wrong and this list does not:
//   - it said "hotbar 1-4". Slots 1-9 are ALL reachable; the edge list is
//     derived from `config.shop.hotbarSlots`, so it cannot drift again.
//   - the wheel glyph was labelled "rotate". TURNING the wheel changes how far
//     away you hold a duck (actions.scroll -> REQ.HOLD_DIST); it is the middle
//     BUTTON that rotates (e.button === 1 -> rotation.step). Two controls on one
//     device, so two rows.
//   - R was listed as a rotate key and nothing else. R pours a container when
//     the crosshair is on one, and that was discoverable only from a prompt
//     that appears for as long as you happen to be looking at the container.

import CRT from './theme.js';

// key: what you press, as a player reads it. what: what it does. src: the code
// that proves it.
export const KEY_ROWS = [
  { key: 'W A S D · arrows', what: 'move',
    src: 'input.js read(): KeyW/KeyS/KeyD/KeyA and the four Arrow codes' },
  { key: 'Shift', what: 'sprint',
    src: 'input.js read(): ShiftLeft/ShiftRight -> state.sprint' },
  { key: 'Space', what: 'jump',
    src: 'input.js read(): keys.has("Space") -> state.jump' },
  { key: 'mouse', what: 'look around - with no pointer lock, drag with left click',
    src: 'input.js onMouse(): runs when locked OR dragging' },
  { key: 'left click (hold)', what: 'carry · place · crank the wheel · use a tool',
    src: 'main.js handleActions() grabDown: tools.grabDown / doPlace / REQ.CRANK / REQ.GRAB' },
  { key: 'right click', what: 'throw the duck you are holding',
    src: 'input.js onMouseDown(): config.input.throwButton -> REQ.HURL' },
  { key: 'mouse wheel', what: 'how far away you hold a duck',
    src: 'input.js onWheel() -> actions.scroll -> REQ.HOLD_DIST' },
  { key: 'middle click · T', what: 'rotate one step (Shift on the button reverses it)',
    src: 'input.js onMouseDown() e.button === 1; main.js handleKeys KeyT -> rotation.step(-1)' },
  { key: 'R', what: 'pour out the container you are pointing at - otherwise rotates',
    src: 'main.js handleKeys KeyR: doPour(pourTarget()) else rotation.step(1)' },
  { key: '[  ]', what: 'fine angle, both ways',
    src: 'main.js handleKeys BracketLeft/BracketRight -> rotation.nudge(FINE)' },
  { key: 'G', what: 'reset the angle',
    src: 'main.js handleKeys KeyG -> rotation.reset()' },
  { key: 'E', what: 'pick up an item · at the booth it opens the shop',
    src: 'main.js handleKeys KeyE: shopUI.close / pickUp / doGamble / shopUI.open' },
  { key: 'Q', what: 'throw whatever is in your hands',
    src: 'main.js handleKeys KeyQ -> throwItem()' },
  { key: 'X', what: 'demolish mode - then hold left click',
    src: 'main.js handleKeys KeyX -> demolishing = !demolishing' },
  { key: '1 - 9', what: 'hotbar slot - the same key puts it away',
    src: 'input.js EDGE_KEYS Digit1..Digit9; main.js handleKeys -> selectSlot(n)' },
  { key: 'M', what: 'lobby: rooms and playing together',
    src: 'main.js handleKeys KeyM -> lobby.toggle()' },
  { key: 'Esc', what: 'back out - and with nothing open it opens the menu',
    src: 'main.js handleKeys Escape: settings / shop / lobby / summary / menu.toggle' },
  { key: 'F3', what: 'draw call and frame counter',
    src: 'ui/debug.js listens for config.debug.toggleKey' },
];

const CSS = `
.ctrl-list { display: flex; flex-direction: column; }
.ctrl-row { display: grid; grid-template-columns: minmax(0, 11em) 1fr; gap: 14px;
  align-items: baseline; padding: 4px 0;
  border-bottom: ${CRT.hairline} solid ${CRT.border}; }
.ctrl-row:last-child { border-bottom: 0; }
.ctrl-row .k { color: ${CRT.bright}; }
.ctrl-row .w { color: ${CRT.dim}; }
.ctrl-note { margin-top: 12px; color: ${CRT.dim};
  font-size: ${CRT.type.dataSm.size}; font-family: ${CRT.data};
  letter-spacing: ${CRT.type.dataSm.track}; line-height: ${CRT.type.dataSm.line}; }
@media (max-width: 720px) {
  .ctrl-row { grid-template-columns: 1fr; gap: 0; }
}
`;

let styled = false;
function injectControlStyles() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const s = document.createElement('style');
  s.id = 'controls-style';
  s.textContent = CSS;
  document.head.appendChild(s);
}

// Fills a host node with the list. It is a panel BODY, not a panel: the menu
// owns the frame, the title and the arrival animation, exactly like every other
// pane in there. Handing this file a whole panel to build would give the menu
// two different ideas of what a panel is.
export function createControlsPanel(opts) {
  const o = opts || {};
  const mount = o.mount;
  injectControlStyles();

  const list = document.createElement('div');
  list.className = 'ctrl-list';
  KEY_ROWS.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'ctrl-row';
    row.dataset.key = r.key;
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = r.key;
    const w = document.createElement('span');
    w.className = 'w';
    w.textContent = r.what;
    row.appendChild(k);
    row.appendChild(w);
    list.appendChild(row);
  });
  if (mount) mount.appendChild(list);

  const note = document.createElement('div');
  note.className = 'ctrl-note';
  note.textContent = 'Keys cannot be remapped yet.';
  if (mount) mount.appendChild(note);

  return {
    root: list,
    rows: () => KEY_ROWS.slice(),
    rowCount: () => KEY_ROWS.length,
    state: () => ({
      rows: Array.from(list.querySelectorAll('.ctrl-row')).map((r) => ({
        key: r.querySelector('.k').textContent,
        what: r.querySelector('.w').textContent,
      })),
    }),
  };
}

export default createControlsPanel;
