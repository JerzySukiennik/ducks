// The full key list, as a menu panel.
//
// This is a MIGRATION, not a new screen. The on-screen key bar along the bottom
// of the HUD is being deleted, and it was the only place the player could read
// what anything does -- so if its content did not land here it would be gone.
//
// Every row below was read out of the code that actually handles the key, not
// out of the bar's old labels. An audit found the bar lying in three separate
// places, so the rule for this file is: a row exists because a binding exists,
// and it says what that binding does in src/core/input.js and handleKeys /
// handleActions in src/main.js. The trail for each one is in the comment beside
// it. Nothing here is a guess about intent.
//
// Two things the old bar got wrong and this list does not:
//   - it said "hotbar 1-4". input.js only queues Digit1..Digit5 as edges, and
//     Slots 1-9 are ALL reachable. This comment previously said 1-5, because
//     `EDGE_KEYS` listed the digits by hand and stopped at Digit5 while the bar
//     had grown to nine -- so four slots were dead. That list is now derived
//     from `config.shop.hotbarSlots`, which is why it cannot drift again.
//   - the wheel glyph was labelled "rotate". Turning the wheel changes how far
//     away you hold a duck (actions.scroll -> REQ.HOLD_DIST); it is the middle
//     BUTTON that rotates (e.button === 1 -> rotation.step). Two controls on one
//     device, so two rows.

import CRT from './theme.js';

// key: what you press, as a player reads it. what: what it does. why: the code
// that proves it -- kept in the data so a future edit has to look at the same
// place this one did.
export const KEY_ROWS = [
  { key: 'W A S D · strzałki', what: 'ruch',
    src: 'input.js read(): KeyW/KeyS/KeyD/KeyA and the four Arrow codes' },
  { key: 'Shift', what: 'bieg',
    src: 'input.js read(): ShiftLeft/ShiftRight -> state.sprint' },
  { key: 'Spacja', what: 'skok',
    src: 'input.js read(): keys.has("Space") -> state.jump' },
  { key: 'mysz', what: 'rozglądanie się — bez locka przeciągnij LPM',
    src: 'input.js onMouse(): runs when locked OR dragging' },
  { key: 'LPM (przytrzymaj)', what: 'chwyć · postaw · kręć korbą · użyj narzędzia',
    src: 'main.js handleActions() grabDown: tools.grabDown / doPlace / REQ.CRANK / REQ.GRAB' },
  { key: 'PPM', what: 'rzuć trzymaną kaczkę',
    src: 'input.js onMouseDown(): config.input.throwButton -> REQ.HURL' },
  { key: 'kółko myszy', what: 'jak daleko trzymasz kaczkę',
    src: 'input.js onWheel() -> actions.scroll -> REQ.HOLD_DIST' },
  { key: 'środkowy przycisk · R · T', what: 'obróć o krok (Shift = w drugą stronę)',
    src: 'input.js onMouseDown() e.button === 1; main.js handleKeys KeyR/KeyT -> rotation.step' },
  { key: '[  ]', what: 'kąt precyzyjny, w obie strony',
    src: 'main.js handleKeys BracketLeft/BracketRight -> rotation.nudge(FINE)' },
  { key: 'G', what: 'wyzeruj obrót',
    src: 'main.js handleKeys KeyG -> rotation.reset()' },
  { key: 'E', what: 'podnieś przedmiot · przy budce otwiera sklep',
    src: 'main.js handleKeys KeyE: shopUI.close / pickUp / shopUI.open' },
  { key: 'Q', what: 'wyrzuć to, co masz w ręce',
    src: 'main.js handleKeys KeyQ -> throwItem()' },
  { key: 'X', what: 'tryb rozbiórki — potem przytrzymaj LPM',
    src: 'main.js handleKeys KeyX -> demolishing = !demolishing' },
  { key: '1 – 9', what: 'slot ekwipunku — ten sam klawisz go chowa',
    src: 'input.js EDGE_KEYS Digit1..Digit5; main.js handleKeys -> selectSlot(n)' },
  { key: 'M', what: 'lobby: pokoje i gra wspólna',
    src: 'main.js handleKeys KeyM -> lobby.toggle()' },
  { key: 'Esc', what: 'cofnij — a gdy nic nie ma, otwiera menu',
    src: 'main.js handleKeys Escape: settings / shop / lobby / menu.toggle' },
  { key: 'F3', what: 'licznik draw calli i klatek',
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
  note.textContent = 'Klawiszy nie da się na razie przemapować.';
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
