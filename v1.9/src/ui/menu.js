// The main menu. It is the first thing on screen and the way back to
// everything: solo, multiplayer, controls, settings, ending the session.
//
// Two rules it exists to keep.
//
// 1. THE MENU IS NOT A GATE. The game boots, the world is built and the frame
//    loop runs behind this screen exactly as it runs behind the shop. Solo is
//    therefore always available and always instant -- it closes a screen, it
//    does not start a game -- and a dead network can never stand between the
//    player and playing. That is the same promise src/ui/lobby.js makes and it
//    would be worth nothing if the menu in front of the lobby broke it.
// 2. IT OWNS NO STATE. The nickname and the colour it shows are read from the
//    settings store; the room it reports is read from the lobby; the session
//    numbers come from the same collector the summary screen uses. A menu with
//    its own copy of any of those is a menu that can disagree with the game.
//
// The shape is Hollowtree's: a left column carrying the brand and a vertical
// nav, and a right area where panels cross-fade IN PLACE -- one grid cell, every
// panel in it, only the live one visible -- so nothing ever stacks or pushes
// anything else down. The look is entirely src/ui/theme.js: not one colour,
// size or duration is written here.
//
// ONE CLOSE PATH. Escape, the panel's own Back and clicking the live nav item
// all end in setPanel(null). In Hollowtree, not doing that is precisely what
// made the Back button look dead, and it is the kind of bug that survives
// review because each path works when you test it alone.

import config from '../config.js';
import CRT, { injectCRT } from './theme.js';
import { createControlsPanel } from './controls.js';

const CSS = `
#menu { position: fixed; inset: 0; z-index: 26; display: none; overflow: hidden;
  background: ${CRT.bg}; color: ${CRT.on};
  font: 400 ${CRT.type.body.size}/${CRT.type.body.line} ${CRT.display};
  letter-spacing: ${CRT.type.body.track}; }
#menu.open { display: block; }
#menu button { font: inherit; color: inherit; letter-spacing: inherit; }
#menu button:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }

#menu-stage { position: absolute; inset: 0; display: flex; align-items: center;
  padding-left: clamp(28px, 7vw, 120px); padding-right: clamp(20px, 4vw, 64px);
  gap: clamp(24px, 5vw, 90px); }
#menu-col { width: ${CRT.colWidth}; flex: 0 0 auto;
  display: flex; flex-direction: column; gap: clamp(20px, 3.4vh, 38px); }

#menu-eyebrow { font-size: ${CRT.type.label.size}; line-height: ${CRT.type.label.line};
  letter-spacing: ${CRT.type.label.track}; text-transform: uppercase; color: ${CRT.dim}; }
#menu-title { margin: 6px 0 0; font-weight: 400;
  font-size: ${CRT.type.title.size}; line-height: ${CRT.type.title.line};
  letter-spacing: ${CRT.type.title.track}; color: ${CRT.bright};
  text-shadow: ${CRT.glowTitle}; text-transform: uppercase; }
/* The theme sizes the cursor in em, so inside a 84px title it would be a block
   the size of a letter. It is a caret, not a character: it gets its own size off
   the ramp rather than inheriting the title's. */
#menu-title .crt-cursor { font-size: ${CRT.type.heading.size}; }
#menu-rule { height: ${CRT.hairline}; width: 0; margin: 14px 0 12px;
  background: ${CRT.borderHot};
  transition: width 1.1s ${CRT.ease} 0.16s; }
#menu.open #menu-rule { width: 100%; }
#menu-tag { color: ${CRT.dim}; max-width: 40ch; }

#menu-nav { display: flex; flex-direction: column; align-items: flex-start; }
.menu-item { position: relative; display: flex; align-items: baseline; gap: 12px;
  width: 100%; padding: 6px 0; background: none; border: 0; cursor: pointer;
  text-align: left; color: ${CRT.on};
  font-size: ${CRT.type.nav.size}; line-height: ${CRT.type.nav.line};
  letter-spacing: ${CRT.type.nav.track};
  opacity: 0; transform: translateY(9px);
  transition: opacity ${CRT.slow} ${CRT.ease}, transform ${CRT.slow} ${CRT.ease},
    color ${CRT.fast} ${CRT.ease}, text-shadow ${CRT.fast} ${CRT.ease}; }
#menu.open .menu-item { opacity: 1; transform: none; }
.menu-item::before { content: "\\203A"; position: absolute; left: -0.72em;
  opacity: 0; transition: opacity ${CRT.fast} ${CRT.ease}; }
.menu-item:hover, .menu-item:focus-visible, .menu-item[aria-current="true"] {
  color: ${CRT.hot}; text-shadow: ${CRT.glowText}; outline: none; }
.menu-item:hover::before, .menu-item:focus-visible::before,
.menu-item[aria-current="true"]::before { opacity: 1; }
.menu-item .n { flex: none; font-size: ${CRT.type.label.size}; color: ${CRT.dim}; }
.menu-item .lb { flex: 0 0 auto; }
.menu-item .nt { flex: 1 1 auto; font-size: ${CRT.type.label.size}; color: ${CRT.faint};
  opacity: 0; transition: opacity ${CRT.fast} ${CRT.ease}; }
.menu-item:hover .nt, .menu-item:focus-visible .nt,
.menu-item[aria-current="true"] .nt { opacity: 1; }

/* Every panel lives in the SAME grid cell. That is what makes them cross-fade
   in place instead of taking turns pushing the layout around. */
#menu-panes { position: relative; flex: 1 1 auto;
  display: grid; align-items: center; justify-items: start; }
.menu-pane { grid-area: 1/1; width: ${CRT.paneWidth}; max-height: 74vh; overflow-y: auto;
  padding: 18px 20px; background: ${CRT.bgPanel};
  border: ${CRT.hairline} solid ${CRT.border};
  opacity: 0; pointer-events: none; transform-origin: 50% 50%;
  /* A tube does not fade: it collapses to a line. Arrival plays the theme's
     crtPowerOn; leaving runs the same geometry backwards through a transition,
     so enter and exit travel one path and either can be interrupted mid-flight. */
  transform: scaleY(0.004) scaleX(1.06); filter: brightness(2.4);
  transition: opacity ${CRT.normal} ${CRT.ease}, transform ${CRT.normal} ${CRT.ease},
    filter ${CRT.normal} ${CRT.ease}; }
.menu-pane.on { opacity: 1; pointer-events: auto; transform: none; filter: none;
  animation: ${CRT.powerOn}; }

.menu-phead { display: flex; align-items: baseline; justify-content: space-between;
  gap: 12px; margin-bottom: 12px; }
.menu-pt { font-size: ${CRT.type.heading.size}; line-height: ${CRT.type.heading.line};
  letter-spacing: ${CRT.type.heading.track}; text-transform: uppercase;
  color: ${CRT.bright}; text-shadow: ${CRT.glowSoft}; }
.menu-back { flex: none; padding: 2px 6px; background: none; border: 0; cursor: pointer;
  color: ${CRT.dim}; font-size: ${CRT.type.label.size};
  letter-spacing: ${CRT.type.label.track}; text-transform: uppercase;
  transition: color ${CRT.fast} ${CRT.ease}; }
.menu-back:hover, .menu-back:focus-visible { color: ${CRT.hot}; }

.menu-kv { display: flex; justify-content: space-between; gap: 14px; padding: 5px 0;
  color: ${CRT.dim}; }
.menu-kv b { font-weight: 400; color: ${CRT.bright}; text-align: right; }
.menu-kv b.ok { color: ${CRT.ok}; }
.menu-kv b.warn { color: ${CRT.warn}; }
.menu-swatch { display: inline-block; width: 0.72em; height: 0.72em;
  margin-left: 0.4em; vertical-align: -0.04em;
  border: ${CRT.hairline} solid ${CRT.border}; }
.menu-note { margin-top: 10px; color: ${CRT.dim};
  font-family: ${CRT.data}; font-size: ${CRT.type.dataSm.size};
  line-height: ${CRT.type.dataSm.line}; letter-spacing: ${CRT.type.dataSm.track}; }

.menu-acts { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
.menu-act { appearance: none; cursor: pointer; padding: 7px 14px;
  background: ${CRT.bgRaised}; border: ${CRT.hairline} solid ${CRT.border};
  color: ${CRT.on}; font-size: ${CRT.type.nav.size}; line-height: 1;
  letter-spacing: ${CRT.type.nav.track};
  transition: color ${CRT.fast} ${CRT.ease}, border-color ${CRT.fast} ${CRT.ease},
    text-shadow ${CRT.fast} ${CRT.ease}, background ${CRT.fast} ${CRT.ease}; }
.menu-act:hover, .menu-act:focus-visible { color: ${CRT.hot};
  border-color: ${CRT.borderHot}; text-shadow: ${CRT.glowText}; }
.menu-act:active { background: ${CRT.bgPanel}; }
.menu-act.go { color: ${CRT.bright}; border-color: ${CRT.borderHot}; }
.menu-act.stop { color: ${CRT.bad}; border-color: ${CRT.bad}; }
.menu-act.stop:hover, .menu-act.stop:focus-visible { color: ${CRT.bad};
  text-shadow: none; background: ${CRT.bgPanel}; }

/* Above the scanline and vignette layers (theme z-index 40 / 39), like the
   reference screen: the footer is the one thing the tube does not eat. */
#menu-foot { position: absolute; z-index: 41;
  left: clamp(28px, 7vw, 120px); bottom: 26px;
  display: flex; gap: 20px; align-items: center; color: ${CRT.dim};
  font-size: ${CRT.type.label.size}; letter-spacing: ${CRT.type.label.track}; }

@media (max-width: 900px) {
  #menu-stage { flex-direction: column; align-items: flex-start;
    justify-content: center; gap: 20px; padding-top: 24px; padding-bottom: 74px;
    overflow-y: auto; }
  #menu-col { width: min(420px, 88vw); }
  /* Stacked, the panel belongs directly under the nav it came from. Centring it
     in the leftover height opens a gap that reads as a missing element. */
  #menu-panes { width: 100%; align-items: start; }
  .menu-pane { width: min(420px, 88vw); max-height: 46vh; }
  #menu-foot { bottom: 14px; }
}

/* The feedback survives; the theatre does not. Hover and focus still respond
   instantly, because those are information rather than decoration. */
@media (prefers-reduced-motion: reduce) {
  #menu-rule { transition: none; width: 100%; }
  .menu-item { transition: color ${CRT.fast} ${CRT.ease}; opacity: 1; transform: none; }
  .menu-pane { transition: opacity ${CRT.fast} linear; transform: none;
    filter: none; }
  .menu-pane.on { animation: none; }
}
`;

function el(tag, cls, parent, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}

// Apple's fluid-interface rule: a control responds on the way DOWN, not on
// release. Keyboard activation arrives as a click with no pointer before it, so
// the click path stays live and is only suppressed for the moment right after a
// pointer already did the work.
function press(node, fn) {
  let lastPointerAt = -1e9;
  node.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    lastPointerAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    fn(e);
  });
  node.addEventListener('click', (e) => {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - lastPointerAt < 700) return;
    fn(e);
  });
  return node;
}

function kv(parent, label) {
  const row = el('div', 'menu-kv', parent);
  el('span', null, row, label);
  const b = el('b', null, row, '');
  return b;
}

export function createMenuUI(opts) {
  const o = opts || {};
  const container = o.container || document.body;
  const settings = o.settings;
  const ui = typeof o.onUi === 'function' ? o.onUi : () => {};

  injectCRT(document);
  const style = document.createElement('style');
  style.id = 'menu-style';
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = el('div', 'crt-scan crt-vig', container);
  root.id = 'menu';
  const stage = el('div', null, root);
  stage.id = 'menu-stage';
  const col = el('div', null, stage);
  col.id = 'menu-col';

  const brand = el('div', null, col);
  el('div', null, brand, 'works terminal').id = 'menu-eyebrow';
  const title = el('h1', null, brand, 'Ducks');
  title.id = 'menu-title';
  el('span', 'crt-cursor', title);
  el('div', null, brand).id = 'menu-rule';
  const tag = el('div', null, brand, 'System ready. Pick a mode.');
  tag.id = 'menu-tag';

  const nav = el('nav', null, col);
  nav.id = 'menu-nav';
  const panes = el('div', null, stage);
  panes.id = 'menu-panes';

  const foot = el('div', null, root);
  foot.id = 'menu-foot';
  const footVersion = el('div', null, foot, '');
  const footHint = el('div', null, foot, 'Esc - menu');

  // --- the panel machinery --------------------------------------------------
  const items = [];
  let livePanel = null;
  let openedFrom = null;

  function paint() {
    items.forEach((it) => {
      const on = !!livePanel && it.pane === livePanel;
      if (on) it.button.setAttribute('aria-current', 'true');
      else it.button.removeAttribute('aria-current');
      if (it.pane) it.pane.classList.toggle('on', on);
    });
  }

  // The ONE close path. Escape, Back and re-clicking the live item all arrive
  // here; nothing else may remove a panel.
  function setPanel(next) {
    const target = next && next !== livePanel ? next : null;
    if (target === livePanel) return livePanel;
    livePanel = target;
    paint();
    if (!livePanel) {
      if (openedFrom && root.contains(openedFrom)) openedFrom.focus({ preventScroll: true });
      openedFrom = null;
      return null;
    }
    sync();
    return livePanel;
  }

  function pane(titleText) {
    const node = el('div', 'menu-pane', panes);
    node.setAttribute('data-crt-pane', '');
    const head = el('div', 'menu-phead', node);
    el('div', 'menu-pt', head, titleText);
    const back = el('button', 'menu-back', head, 'Back');
    back.type = 'button';
    press(back, () => { ui('click'); setPanel(null); });
    const body = el('div', null, node);
    return { node, body };
  }

  function navItem(n, label, note, paneNode) {
    const button = el('button', 'menu-item', nav);
    button.type = 'button';
    el('span', 'n', button, n);
    el('span', 'lb', button, label);
    el('span', 'nt', button, note || '');
    button.style.transitionDelay = (0.05 + items.length * CRT.stagger).toFixed(3) + 's';
    press(button, () => {
      ui('click');
      // Clicking the live item closes it. Same call, same path, so Back and
      // Escape cannot behave differently from the item itself.
      if (livePanel !== paneNode) openedFrom = button;
      setPanel(paneNode);
    });
    items.push({ button, pane: paneNode, label, note: note || '' });
    return button;
  }

  function acts(parent) {
    return el('div', 'menu-acts', parent);
  }

  function act(parent, cls, label, fn) {
    const b = el('button', 'menu-act' + (cls ? ' ' + cls : ''), parent, label);
    b.type = 'button';
    press(b, fn);
    return b;
  }

  // --- 01 Solo --------------------------------------------------------------
  const startPane = pane('Start');
  const startWorld = kv(startPane.body, 'World');
  const startDucks = kv(startPane.body, 'Ducks');
  const startPlayer = kv(startPane.body, 'Player');
  const startSave = kv(startPane.body, 'Save');
  const startNote = el('div', 'menu-note', startPane.body, '');
  const startBtn = act(acts(startPane.body), 'go', 'Play', () => doClose('play'));

  // --- 02 Together ----------------------------------------------------------
  const roomPane = pane('Room');
  const roomStatus = kv(roomPane.body, 'Status');
  const roomId = kv(roomPane.body, 'Room');
  const roomVis = kv(roomPane.body, 'Visibility');
  el('div', 'menu-note', roomPane.body,
    'The network never stands between you and playing: if the room server does not '
    + 'answer, the lobby says so in one line and single player carries on.');
  act(acts(roomPane.body), null, 'Open lobby', () => {
    if (o.onMultiplayer) o.onMultiplayer();
  });

  // --- 03 Controls ----------------------------------------------------------
  const controlsPane = pane('Keys');
  const controls = createControlsPanel({ mount: controlsPane.body });

  // --- 04 Settings ----------------------------------------------------------
  const setPane = pane('Settings');
  const setVol = kv(setPane.body, 'Volume');
  const setSens = kv(setPane.body, 'Mouse sensitivity');
  const setFov = kv(setPane.body, 'Field of view');
  const setBuf = kv(setPane.body, 'Pixel size');
  const setNick = kv(setPane.body, 'Nickname');
  const setColor = kv(setPane.body, 'Colour');
  act(acts(setPane.body), null, 'Change settings', () => {
    if (o.onSettings) o.onSettings();
  });

  // --- 05 End session -------------------------------------------------------
  const endPane = pane('End');
  const endThrown = kv(endPane.body, 'In the pit');
  const endEarned = kv(endPane.body, 'Earned');
  const endBuilt = kv(endPane.body, 'Built');
  const endWho = kv(endPane.body, 'Session');
  el('div', 'menu-note', endPane.body,
    'Nothing is saved. Ending shows the summary and closes the room.');
  const endBtn = act(acts(endPane.body), 'stop', 'End session', () => {
    if (o.onEndSession) o.onEndSession();
  });

  navItem('01', 'Solo', 'one player, no network', startPane.node);
  navItem('02', 'Together', 'host a room or join one', roomPane.node);
  navItem('03', 'Controls', 'the full key list', controlsPane.node);
  navItem('04', 'Settings', 'sound, mouse, picture', setPane.node);
  navItem('05', 'End session', 'summary and score', endPane.node);

  // The screen is never blank on the right: Start is live from the first frame,
  // exactly as the chosen design shows it. It also means Escape has something to
  // back out of before it closes the menu, which is the layering the rest of the
  // game already uses.
  // Set directly rather than through setPanel(): this runs while main.js is
  // still building the game, and setPanel() syncs -- which would read session
  // numbers out of objects that do not exist yet. doOpen() syncs anyway.
  livePanel = startPane.node;
  paint();

  let open = false;
  // "Has the player started at least once" is the only state this screen keeps,
  // and it exists for one reason: the first action says Play before the first
  // game and Back to game afterwards, because "resume" when nothing has started
  // reads as a broken button.
  let started = false;

  function nickname() {
    const s = settings ? String(settings.get('nickname') || '') : '';
    return s.trim() || 'player';
  }

  function pct(v) { return Math.round((Number(v) || 0) * 100) + '%'; }
  function num(v) { return Math.round(Number(v) || 0).toLocaleString('en-US'); }

  function sync() {
    const room = o.session ? o.session() : null;
    const inRoom = !!room;

    // 01 Start
    startWorld.textContent = 'plate ' + config.world.plateSize + ' m';
    startDucks.textContent = 'pool of ' + config.ducks.max;
    startPlayer.textContent = nickname();
    startPlayer.appendChild(swatch());
    startSave.textContent = 'none - the session ends with a summary';
    startNote.textContent = inRoom
      ? 'You are in a room. Leaving this screen goes back to the game and keeps the room open.'
      : started
        ? 'The world has been running behind this screen the whole time.'
        : 'The world is already running behind this screen - this is not a loading screen.';
    startBtn.textContent = started || inRoom ? 'Back to game' : 'Play';

    // 02 Room
    roomStatus.textContent = inRoom
      ? (room.isHost ? 'you host this room' : "in somebody else's room")
      : 'single player';
    roomStatus.classList.toggle('ok', inRoom);
    roomId.textContent = inRoom ? String(room.roomId || '-') : '-';
    roomVis.textContent = inRoom
      ? (room.isPublic ? 'public - on the list' : 'private - link only')
      : '-';

    // 04 Settings -- read live from the store, never a second copy.
    if (settings) {
      setVol.textContent = pct(settings.get('masterVolume'))
        + ' · ' + pct(settings.get('sfxVolume'))
        + ' · ' + pct(settings.get('ambientVolume'));
      setSens.textContent = Number(settings.get('mouseSensitivity')).toFixed(4);
      setFov.textContent = Math.round(Number(settings.get('fov'))) + '°';
      setBuf.textContent = 'buffer ' + Math.round(Number(settings.get('bufferWidth'))) + ' px';
      setNick.textContent = nickname();
      setColor.textContent = '';
      setColor.appendChild(swatch());
    }

    // 05 End -- the same collector the summary screen reads, so the two
    // cannot disagree about what the session did.
    // Guarded: the preview is a nicety, and nothing about reading it is worth
    // the menu failing to open. A dash is an honest answer to "we could not ask".
    let st = null;
    if (typeof o.summary === 'function') {
      try { st = o.summary(); } catch (err) { st = null; }
    }
    endThrown.textContent = st ? num(st.ducksScored) + ' ducks' : '-';
    endEarned.textContent = st ? '$' + num(st.moneyEarned) : '-';
    endBuilt.textContent = st
      ? num((st.built || []).reduce((n, r) => n + r.count, 0)) + ' objects'
      : '-';
    endWho.textContent = inRoom
      ? (room.isHost ? 'you end it for everybody in the room' : 'you leave the room')
      : 'just you';
    endBtn.textContent = inRoom && room.isHost ? 'End it for everybody' : 'End session';

    footVersion.textContent = 'rev ' + (o.version || config.version)
      + ' - ' + (o.degraded ? 'kinematic physics fallback' : 'physics ready');
    return true;
  }

  function swatch() {
    const s = document.createElement('i');
    s.className = 'menu-swatch';
    s.style.background = settings ? settings.get('avatarColor') : config.menu.defaultColor;
    return s;
  }

  function doOpen() {
    if (open) return false;
    open = true;
    sync();
    root.classList.add('open');
    if (document.exitPointerLock) document.exitPointerLock();
    if (o.onOpen) o.onOpen();
    return true;
  }

  // Closing the menu IS starting the game: there is nothing to spin up, because
  // the world has been running behind it since boot.
  function doClose(reason) {
    if (!open) return false;
    open = false;
    started = true;
    root.classList.remove('open');
    if (o.onClose) o.onClose(reason || 'close');
    return true;
  }

  // Clicking the empty stage closes the menu once a game has started -- the old
  // scrim behaviour, and deliberately dead before the first game so a stray
  // click cannot drop a player into a world they have not chosen yet.
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target !== root && e.target !== stage) return;
    if (started) doClose('scrim');
  });

  return {
    root,
    open: doOpen,
    close: doClose,
    // Escape lands here (src/main.js handleKeys). Innermost first: an open panel
    // is what Escape backs out of, and only a menu with nothing open closes.
    // Same setPanel(null) every other close uses.
    toggle() {
      if (!open) { doOpen(); return true; }
      if (livePanel) { setPanel(null); return true; }
      doClose('toggle');
      return false;
    },
    isOpen: () => open,
    hasStarted: () => started,
    sync,
    openPanel: (id) => {
      const map = {
        start: startPane.node, room: roomPane.node, controls: controlsPane.node,
        settings: setPane.node, end: endPane.node,
      };
      return !!setPanel(map[id] || null);
    },
    closePanel: () => !setPanel(null),
    panelId: () => {
      const found = items.find((it) => it.pane === livePanel);
      return found ? found.label : null;
    },
    controls,
    state: () => ({
      open,
      started,
      title: 'Ducks',
      subtitle: tag.textContent,
      footer: footVersion.textContent,
      status: roomStatus.textContent,
      nickname: startPlayer.textContent,
      color: settings ? settings.get('avatarColor') : config.menu.defaultColor,
      panel: livePanel ? livePanel.querySelector('.menu-pt').textContent : null,
      panelCount: items.filter((it) => it.pane).length,
      // Kept as `buttons` with the same shape the old panel reported, because
      // the head-down checks read it by that name.
      buttons: items.map((it) => ({ label: it.label, hint: it.note })),
      rows: Array.from(panes.querySelectorAll('.menu-pane.on .menu-kv'))
        .map((r) => r.textContent),
    }),
    dispose() {
      if (root.parentNode) root.parentNode.removeChild(root);
      if (style.parentNode) style.parentNode.removeChild(style);
    },
  };
}

export default createMenuUI;
