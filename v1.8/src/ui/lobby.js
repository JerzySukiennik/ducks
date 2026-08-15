// The lobby: host a room or join one. DOM only, like every other panel here --
// it costs no draw calls and it never touches the frame loop.
//
// Two rules shape this file more than anything else.
//
// 1. Rooms are OPEN. There are no join codes. A host picks public (listed here
//    for anyone) or private (a link, and nothing else). Private is the default,
//    so the box you have to tick is the one that puts you on a public list.
// 2. The lobby must never stand between a player and the game. Firebase is
//    lazy and can fail in ~44 ms with code 'net-unavailable'; when it does,
//    this panel says so in one plain sentence and gets out of the way. Single
//    player is fully playable with the network dead, and the wording says that
//    rather than implying something is broken that the player must fix.

import config from '../config.js';
import CRT, { injectCRT } from './theme.js';
import { getFirebase, NET_UNAVAILABLE, netStatus } from '../net/firebase.js';
import { listPublicRooms, tryHostRoom, tryJoinRoom } from '../net/signaling.js';
import { limits } from '../net/paths.js';

// Colour carries meaning here and nothing else: ok when the room server answers,
// warn when it does not. Both come from src/ui/theme.js, where they are the only
// two hues allowed to appear on an amber tube.
const CSS = `
#lobby { position: fixed; inset: 0; z-index: 22; display: none;
  align-items: center; justify-content: center; pointer-events: none;
  font: 400 ${CRT.type.body.size}/${CRT.type.body.line} ${CRT.display};
  letter-spacing: ${CRT.type.body.track}; color: ${CRT.on}; }
#lobby.open { display: flex; }
#lobby input, #lobby button { font: inherit; color: inherit; letter-spacing: inherit; }
#lobby button:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
#lobby-scrim { position: absolute; inset: 0; background: ${CRT.scrim};
  transition: background ${CRT.normal} ${CRT.ease}; }
/* While a room is WAITING, the scrim goes opaque. The intro dresses its set the
   moment a room is opened -- 272 ducks and twenty objects, so the pile has time
   to fall asleep before the camera rolls -- and at 62% opacity the player
   watched that happen behind the panel. It reads as the game spawning junk on
   its own. Opaque here rather than delaying the staging, because the staging
   has to start early: that is the whole reason the overflow shot does not
   stutter. */
#lobby.waiting #lobby-scrim { background: ${CRT.bg}; }
#lobby-panel { position: relative; width: min(720px, 92vw); max-height: 86vh;
  display: flex; flex-direction: column; pointer-events: auto;
  background: ${CRT.bgRaised}; border: ${CRT.hairline} solid ${CRT.border};
  animation: ${CRT.powerOn}; }
#lobby-head { display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: ${CRT.hairline} solid ${CRT.border}; }
#lobby-title { font-size: ${CRT.type.heading.size}; line-height: ${CRT.type.heading.line};
  letter-spacing: ${CRT.type.heading.track}; text-transform: uppercase;
  color: ${CRT.bright}; text-shadow: ${CRT.glowSoft}; }
#lobby-role { font-size: ${CRT.type.label.size}; letter-spacing: ${CRT.type.label.track};
  text-transform: uppercase; color: ${CRT.dim}; }
#lobby-net { padding: 9px 16px; border-bottom: ${CRT.hairline} solid ${CRT.border};
  color: ${CRT.dim}; }
#lobby-net.bad { color: ${CRT.warn}; border-bottom-color: ${CRT.warn}; }
#lobby-net.ok { color: ${CRT.ok}; }
#lobby-body { overflow-y: auto; padding: 4px 0 0; }
.lobby-sec { padding: 12px 16px; border-bottom: ${CRT.hairline} solid ${CRT.border}; }
.lobby-sec h4 { margin: 0 0 8px; font-weight: 400;
  font-size: ${CRT.type.label.size}; line-height: ${CRT.type.label.line};
  letter-spacing: ${CRT.type.label.track}; text-transform: uppercase; color: ${CRT.dim}; }
.lobby-line { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
#lobby-nick { flex: 1 1 200px; min-width: 160px; padding: 7px 10px;
  background: ${CRT.bg}; border: ${CRT.hairline} solid ${CRT.border};
  color: ${CRT.bright}; transition: border-color ${CRT.fast} ${CRT.ease}; }
#lobby-nick:focus { outline: none; border-color: ${CRT.borderHot}; }
.lobby-btn { appearance: none; cursor: pointer; min-width: 104px; padding: 7px 12px;
  background: ${CRT.bgPanel}; border: ${CRT.hairline} solid ${CRT.borderHot};
  color: ${CRT.bright}; font-size: ${CRT.type.nav.size}; line-height: 1;
  letter-spacing: ${CRT.type.nav.track};
  transition: color ${CRT.fast} ${CRT.ease}, border-color ${CRT.fast} ${CRT.ease},
    text-shadow ${CRT.fast} ${CRT.ease}; }
.lobby-btn:hover, .lobby-btn:focus-visible { color: ${CRT.hot}; text-shadow: ${CRT.glowText}; }
.lobby-btn[disabled] { cursor: not-allowed; color: ${CRT.faint};
  border-color: ${CRT.border}; text-shadow: none; }
.lobby-btn.quiet { color: ${CRT.on}; border-color: ${CRT.border}; }
.lobby-btn.stop { color: ${CRT.bad}; border-color: ${CRT.bad}; }
.lobby-btn.stop:hover { color: ${CRT.bad}; text-shadow: none; }
.lobby-vis { display: flex; gap: 8px; }
.lobby-vis label { display: flex; align-items: center; gap: 6px; cursor: pointer;
  padding: 5px 10px; border: ${CRT.hairline} solid ${CRT.border}; color: ${CRT.dim};
  transition: color ${CRT.fast} ${CRT.ease}, border-color ${CRT.fast} ${CRT.ease}; }
.lobby-vis label.on { border-color: ${CRT.borderHot}; color: ${CRT.bright}; }
.lobby-vis input { accent-color: ${CRT.bright}; }
/* A locked choice is still READABLE -- a client has to be able to see which
   mode the room it joined is in -- it simply stops responding, and brightness
   is what says so, exactly as it does on .lobby-btn[disabled]. */
.lobby-vis.locked label { cursor: default; color: ${CRT.faint}; border-color: ${CRT.border}; }
.lobby-vis.locked label.on { color: ${CRT.dim}; }
.lobby-vis.locked input { accent-color: ${CRT.dim}; }
/* Creative is a departure from the game as it ships, and CRT.warn is this
   theme's one word for "careful, this is not the normal state". It is the same
   hue the shop uses for a row that is out of stock; nothing else is borrowed. */
.lobby-vis label.alt.on { border-color: ${CRT.warn}; color: ${CRT.warn}; }
.lobby-vis label.alt.on input { accent-color: ${CRT.warn}; }
.lobby-vis.locked label.alt.on { color: ${CRT.warn}; opacity: 0.72; }
#lobby-modehint.alt { color: ${CRT.warn}; }
.lobby-hint { margin-top: 7px; color: ${CRT.dim};
  font-family: ${CRT.data}; font-size: ${CRT.type.dataSm.size};
  line-height: ${CRT.type.dataSm.line}; letter-spacing: ${CRT.type.dataSm.track}; }
#lobby-rooms { display: flex; flex-direction: column; }
.lobby-room { display: grid; grid-template-columns: 1fr auto auto; gap: 12px;
  align-items: center; padding: 7px 0; border-bottom: ${CRT.hairline} solid ${CRT.border}; }
.lobby-room:last-child { border-bottom: 0; }
.lobby-room .nm { color: ${CRT.bright}; }
.lobby-room .id { font-family: ${CRT.data}; font-size: ${CRT.type.dataSm.size};
  letter-spacing: ${CRT.type.dataSm.track}; color: ${CRT.faint}; }
.lobby-room .ct { font-family: ${CRT.data}; font-size: ${CRT.type.dataRow.size};
  letter-spacing: ${CRT.type.dataRow.track}; color: ${CRT.on}; white-space: nowrap; }
.lobby-empty { color: ${CRT.faint}; padding: 6px 0; }
#lobby-link { flex: 1 1 240px; min-width: 180px; padding: 7px 10px; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; background: ${CRT.bg};
  border: ${CRT.hairline} solid ${CRT.border}; color: ${CRT.on};
  font-family: ${CRT.data}; font-size: ${CRT.type.dataRow.size}; }
#lobby-players { display: flex; flex-direction: column; gap: 2px; }
.lobby-player { display: grid; grid-template-columns: auto 56px 1fr auto auto;
  gap: 10px; align-items: center; padding: 6px 0;
  border-bottom: ${CRT.hairline} solid ${CRT.border}; }
.lobby-player:last-child { border-bottom: 0; }
/* The avatar colour, as a chip. It is the SAME hex the player picked in
   Settings and the same one their capsule is drawn in, carried in the roster --
   a swatch that guessed from the slot would be a second opinion. */
.lobby-player .sw { width: 0.86em; height: 0.86em;
  border: ${CRT.hairline} solid ${CRT.border}; }
.lobby-player .sl { color: ${CRT.dim}; font-size: ${CRT.type.label.size};
  letter-spacing: ${CRT.type.label.track}; text-transform: uppercase; }
.lobby-player .nk { color: ${CRT.bright}; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; }
.lobby-player .yo { color: ${CRT.ok}; font-size: ${CRT.type.label.size};
  letter-spacing: ${CRT.type.label.track}; text-transform: uppercase; }
/* Brightness alone says what state a player is in, which is the theme's own
   rule: ready is CRT.ok, waiting stays at CRT.faint and does not shout. */
.lobby-player .rd { font-size: ${CRT.type.label.size};
  letter-spacing: ${CRT.type.label.track}; text-transform: uppercase;
  color: ${CRT.faint}; white-space: nowrap; }
.lobby-player .rd.on { color: ${CRT.ok}; }
#lobby-start { display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  margin-top: 12px; }
#lobby-startnote { color: ${CRT.dim}; font-family: ${CRT.data};
  font-size: ${CRT.type.dataSm.size}; letter-spacing: ${CRT.type.dataSm.track}; }
.lobby-btn.big { min-width: 168px; padding: 9px 16px;
  color: ${CRT.bright}; border-color: ${CRT.borderHot}; }
#lobby-foot { display: flex; align-items: center; justify-content: space-between;
  gap: 12px; padding: 9px 16px; border-top: ${CRT.hairline} solid ${CRT.border};
  color: ${CRT.dim}; }
#lobby-msg { color: ${CRT.ok}; }
#lobby-msg.bad { color: ${CRT.bad}; }
@media (max-width: 720px) {
  .lobby-room { grid-template-columns: 1fr auto; }
}
@media (prefers-reduced-motion: reduce) {
  #lobby-panel { animation: none; }
  #lobby * { transition: none !important; }
}
`;

function el(tag, cls, parent, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}

// A room's link IS its id, and that is as true for someone who joined as for
// the person who opened it -- a client with no way to copy the link cannot
// invite the fourth player. The host session carries link(); everyone else
// rebuilds the same string from the room id.
function linkFor(roomId) {
  if (!roomId) return '';
  if (typeof location === 'undefined') return '?room=' + roomId;
  return location.origin + location.pathname + '?room=' + roomId;
}

// The lobby has one honest sentence for each way the network can be down, and
// every one of them ends by saying the game still works.
function netMessage(err) {
  if (!err) return 'Multiplayer unavailable. Single player works normally.';
  if (err.code === NET_UNAVAILABLE) {
    return 'Multiplayer is offline: the room server could not be reached. '
      + 'Everything else works -- close this and keep playing on your own.';
  }
  return 'Multiplayer unavailable (' + (err.message || String(err)) + '). '
    + 'Single player works normally.';
}

export function createLobbyUI(opts) {
  const o = opts || {};
  const container = o.container || document.body;
  injectCRT(document);
  const style = document.createElement('style');
  style.id = 'lobby-style';
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = el('div', null, container);
  root.id = 'lobby';
  const scrim = el('div', null, root);
  scrim.id = 'lobby-scrim';
  const panel = el('div', 'crt-scan', root);
  panel.id = 'lobby-panel';
  panel.setAttribute('data-crt-pane', '');

  const head = el('div', null, panel);
  head.id = 'lobby-head';
  const title = el('div', null, head, 'Multiplayer');
  title.id = 'lobby-title';
  const role = el('div', null, head, 'Single player');
  role.id = 'lobby-role';

  const net = el('div', null, panel, 'Checking the room server...');
  net.id = 'lobby-net';

  const body = el('div', null, panel);
  body.id = 'lobby-body';

  // -- name --------------------------------------------------------------
  const nameSec = el('div', 'lobby-sec', body);
  el('h4', null, nameSec, 'Name');
  const nameLine = el('div', 'lobby-line', nameSec);
  const nick = document.createElement('input');
  nick.id = 'lobby-nick';
  nick.type = 'text';
  nick.maxLength = Math.min(Math.round(config.lobby.maxNickChars), limits.maxNickChars);
  nick.placeholder = 'player';
  nick.value = o.nickname || '';
  // There is ONE nickname in this game. Typing it here is the same act as
  // typing it in Settings, so the owner of the preference is told rather than
  // left with a second copy that disagrees the moment either box is edited.
  nick.addEventListener('change', () => { if (o.onNickname) o.onNickname(nickname()); });
  nameLine.appendChild(nick);

  // -- session mode -------------------------------------------------------
  // CREATIVE MODE is a property of the SESSION, so it is chosen here, once,
  // before there is a session to disagree about. It sits ABOVE "Host a room" on
  // purpose: it is part of the decision to open a room, not a setting you go
  // looking for afterwards. A client sees the same two controls, locked, showing
  // the mode the host chose -- being told is the point, since the mode changes
  // what every price and every duck in the room is worth.
  const modeSec = el('div', 'lobby-sec', body);
  el('h4', null, modeSec, 'Session mode');
  const modeLine = el('div', 'lobby-line', modeSec);
  const modeWrap = el('div', 'lobby-vis', modeLine);
  const modeLabels = [];
  const modeInputs = [];
  [['normal', 'Normal'], ['creative', 'Creative']].forEach(([value, text], i) => {
    const label = el('label', i === 1 ? 'alt' : null, modeWrap);
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'lobby-mode';
    input.value = value;
    input.checked = i === (config.creative.enabled ? 1 : 0);
    label.appendChild(input);
    el('span', null, label, text);
    input.addEventListener('change', () => chooseCreative(i === 1));
    modeLabels.push(label);
    modeInputs.push(input);
  });
  // The hint says what the mode DOES, in the mode's own terms, before it is
  // committed to -- the three facts it actually changes, and the one
  // consequence (the stats) that is not visible from inside the session.
  const modeHint = el('div', 'lobby-hint', modeSec, '');
  modeHint.id = 'lobby-modehint';

  // -- host --------------------------------------------------------------
  const hostSec = el('div', 'lobby-sec', body);
  el('h4', null, hostSec, 'Host a room');
  const hostLine = el('div', 'lobby-line', hostSec);
  const vis = el('div', 'lobby-vis', hostLine);
  const visLabels = [];
  const visInputs = [];
  [['private', 'Private'], ['public', 'Public']].forEach(([value, text], i) => {
    const label = el('label', null, vis);
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'lobby-visibility';
    input.value = value;
    input.checked = i === 0;      // private is the default
    label.appendChild(input);
    el('span', null, label, text);
    input.addEventListener('change', syncVisibility);
    visLabels.push(label);
    visInputs.push(input);
  });
  const hostBtn = el('button', 'lobby-btn', hostLine, 'Host room');
  el('div', 'lobby-hint', hostSec,
    'Private rooms are link-only. Public rooms are listed below for anyone. '
    + 'Up to ' + limits.maxPlayers + ' players; people can join a game already in progress.');

  // -- join --------------------------------------------------------------
  const joinSec = el('div', 'lobby-sec', body);
  el('h4', null, joinSec, 'Public rooms');
  const rooms = el('div', null, joinSec);
  rooms.id = 'lobby-rooms';
  const joinFoot = el('div', 'lobby-line', joinSec);
  const refreshBtn = el('button', 'lobby-btn quiet', joinFoot, 'Refresh');
  el('div', 'lobby-hint', joinSec,
    'A private room is joined by opening its link. Nothing else is needed.');

  // -- session (shown once in a room) -----------------------------------
  const sessionSec = el('div', 'lobby-sec', body);
  sessionSec.style.display = 'none';
  el('h4', null, sessionSec, 'This room');
  const linkLine = el('div', 'lobby-line', sessionSec);
  const linkBox = el('div', null, linkLine, '');
  linkBox.id = 'lobby-link';
  const copyBtn = el('button', 'lobby-btn', linkLine, 'Copy link');
  const playersBox = el('div', null, sessionSec);
  playersBox.id = 'lobby-players';
  // -- the waiting room --------------------------------------------------
  // A room now OPENS here rather than in the world: everybody sits in this
  // list until the host presses Start, and Start is what plays the intro for
  // the whole room at once. A client gets the ready toggle instead; the host
  // is ready by definition, since it is the one holding the button.
  const startLine = el('div', null, sessionSec);
  startLine.id = 'lobby-start';
  const startBtn = el('button', 'lobby-btn big', startLine, 'Start session');
  const readyBtn = el('button', 'lobby-btn', startLine, 'Ready');
  const startNote = el('div', null, startLine, '');
  startNote.id = 'lobby-startnote';
  const leaveLine = el('div', 'lobby-line', sessionSec);
  const leaveBtn = el('button', 'lobby-btn stop', leaveLine, 'End session');

  const foot = el('div', null, panel);
  foot.id = 'lobby-foot';
  const msg = el('div', null, foot, '');
  msg.id = 'lobby-msg';
  const closeBtn = el('button', 'lobby-btn quiet', foot, 'Close');

  let open = false;
  let busy = false;
  let netOk = null;             // null = not probed yet
  let netError = null;
  let session = null;
  let roomList = [];
  let lastMessage = '';
  let refreshTimer = 0;
  let copyTimer = 0;
  let players = [];
  // 'lobby' while the room is waiting, 'playing' once the host has started.
  // The NETWORK layer owns this -- src/net/game.js writes it from REQ.START on a
  // host and from the WELCOME on a client -- and this panel only draws it.
  let phase = 'lobby';
  let localReady = false;
  let localSlot = 0;
  // The session's mode. config.creative.enabled is only the default for a fresh
  // panel; from here on THIS is the chooser, and whoever owns the session reads
  // it once, at Start, and hands it to the sim modules.
  let creative = !!config.creative.enabled;

  function say(text, bad) {
    lastMessage = text || '';
    msg.textContent = lastMessage;
    msg.classList.toggle('bad', !!bad);
  }

  function syncVisibility() {
    visLabels.forEach((l, i) => l.classList.toggle('on', visInputs[i].checked));
  }
  syncVisibility();

  function isPublicChoice() {
    return visInputs[1].checked;
  }

  // --- session mode ---------------------------------------------------------
  // One rule decides who may touch this: the HOST decides, and only while the
  // room is still waiting. A client is being TOLD (it can read the mode and not
  // change it), and so is the host once the session is running -- a mode that
  // could change mid-session would mean the prices in the summary were paid
  // under rules nobody could reconstruct.
  function modeLocked() {
    if (session && !session.isHost) return true;
    return phase === 'playing';
  }

  function syncMode() {
    modeLabels.forEach((l, i) => l.classList.toggle('on', modeInputs[i].checked));
    const locked = modeLocked();
    modeInputs.forEach((r) => { r.disabled = locked; });
    modeWrap.classList.toggle('locked', locked);
    const on = modeInputs[1].checked;
    modeHint.classList.toggle('alt', on);
    const top = config.rarity.multipliers[config.rarity.multipliers.length - 1];
    const what = on
      ? 'Creative: every purchase costs 0, the vendor holds '
        + Math.round(config.creative.stockUnits) + ' of every row, and every duck comes out at the '
        + 'top rarity tier (x' + top + '). Recorded as a creative session -- its numbers are not '
        + 'comparable with a normal run.'
      : 'Normal: catalog prices, a shelf that runs out and restocks every '
        + Math.round(config.shop.stockSeconds) + ' s, and the usual rarity roll.';
    const who = session && !session.isHost
      ? ' The host chose this for the room.'
      : phase === 'playing'
        ? ' Fixed for the rest of this session.'
        : ' Applies to everyone in the room.';
    modeHint.textContent = what + who;
  }

  // A click on one of the two radios. Refused when locked rather than ignored,
  // so the panel is never showing a choice that is not the session's.
  function chooseCreative(on) {
    if (modeLocked()) { syncMode(); return creative; }
    creative = !!on;
    modeInputs[0].checked = !creative;
    modeInputs[1].checked = creative;
    syncMode();
    renderStart();
    if (o.onCreative) o.onCreative(creative);
    return creative;
  }
  syncMode();

  function nickname() {
    const s = nick.value.trim();
    return s || 'player';
  }

  function setNetState(ok, err) {
    netOk = ok;
    netError = ok ? null : (err || null);
    net.classList.toggle('bad', ok === false);
    net.classList.toggle('ok', ok === true);
    net.textContent = ok === null
      ? 'Checking the room server...'
      : ok
        ? 'Room server reachable.'
        : netMessage(err);
    syncButtons();
  }

  function syncButtons() {
    const live = netOk === true && !busy && !session;
    hostBtn.disabled = !live;
    refreshBtn.disabled = netOk !== true || busy;
    // Hidden with the network down (there is nothing to host or join) and while
    // already in a room (the session panel replaces both).
    const hidden = netOk === false || !!session;
    joinSec.style.display = hidden ? 'none' : '';
    hostSec.style.display = hidden ? 'none' : '';
    // With no network there is nobody to be named to, so the panel is one
    // sentence and a way out rather than a form over a dead server.
    nameSec.style.display = netOk === false ? 'none' : '';
    Array.from(rooms.querySelectorAll('button')).forEach((b) => {
      b.disabled = !live;
    });
    // While the room is waiting there is nothing behind this panel, so the
    // button says so instead of looking like a way out that does nothing.
    closeBtn.style.display = (session && phase !== 'playing') ? 'none' : '';
    closeBtn.textContent = session ? 'Close' : (netOk === false ? 'Keep playing' : 'Close');
  }

  // Probing is a plain getFirebase(): it is the same call the rest of the net
  // layer makes, so the lobby cannot report a state the game does not have.
  async function probe() {
    if (netOk === true) return true;
    setNetState(null);
    try {
      await getFirebase();
      setNetState(true);
      return true;
    } catch (err) {
      setNetState(false, err);
      return false;
    }
  }

  function renderRooms() {
    rooms.textContent = '';
    if (!roomList.length) {
      el('div', 'lobby-empty', rooms,
        netOk === true ? 'No public rooms right now.' : 'Room list unavailable.');
      return;
    }
    const max = Math.round(config.lobby.maxRooms);
    for (let i = 0; i < roomList.length && i < max; i++) {
      const r = roomList[i];
      const row = el('div', 'lobby-room', rooms);
      row.dataset.id = r.id;
      const left = el('div', null, row);
      el('div', 'nm', left, r.hostNick || 'player');
      el('div', 'id', left, r.id);
      const full = (r.players || 1) >= limits.maxPlayers;
      el('div', 'ct', row, (r.players || 1) + ' / ' + limits.maxPlayers);
      const btn = el('button', 'lobby-btn', row, full ? 'Full' : 'Join');
      btn.disabled = full || busy || !!session;
      if (!full) btn.addEventListener('click', () => join(r.id));
    }
    syncButtons();
  }

  async function refresh() {
    if (netOk !== true || session) return roomList;
    try {
      roomList = await listPublicRooms();
    } catch (err) {
      roomList = [];
      say('Room list unavailable: ' + (err.message || err), true);
    }
    renderRooms();
    return roomList;
  }

  function scheduleRefresh() {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      if (open && !session && netOk === true) refresh();
    }, Math.round(config.lobby.refreshMs));
  }

  function sessionLink() {
    if (!session) return '';
    return session.link ? session.link() : linkFor(session.roomId);
  }

  function renderSession() {
    const inRoom = !!session;
    // Who may choose the mode depends on whether there is a session and whose
    // it is, so it is re-read here rather than kept as a second copy.
    syncMode();
    sessionSec.style.display = inRoom ? '' : 'none';
    hostSec.style.display = inRoom || netOk === false ? 'none' : '';
    joinSec.style.display = inRoom || netOk === false ? 'none' : '';
    nick.disabled = inRoom;
    if (!inRoom) {
      role.textContent = 'Single player';
      renderPlayers();
      return;
    }
    role.textContent = session.isHost
      ? (session.isPublic ? 'Hosting - public' : 'Hosting - private')
      : 'Joined';
    linkBox.textContent = sessionLink();
    leaveBtn.textContent = session.isHost ? 'End session' : 'Leave';
    renderPlayers();
  }

  // What colour to draw a player in. The roster's own value wins and nothing
  // else gets a say -- it is the hex that player picked in Settings, carried on
  // their HELLO. The slot palette is only the answer for a player who has not
  // told anybody yet, and it is the SAME fallback src/main.js's avatarColorFor
  // uses, so the chip in this list and the capsule in the world agree.
  function colorOf(p) {
    if (p && p.color) return p.color;
    const palette = config.menu.palette;
    const slot = p && typeof p.slot === 'number' ? p.slot : 0;
    return palette[((slot % palette.length) + palette.length) % palette.length];
  }

  function renderPlayers() {
    // `waiting` = in a room that has not started. Set here because this is the
    // function both setPlayers() and setPhase() already call, so the class
    // cannot drift from the state it describes.
    root.classList.toggle('waiting', !!session && phase !== 'playing');
    playersBox.textContent = '';
    if (!session) { renderStart(); return; }
    const list = players.length ? players : [{ slot: session.slot, nick: session.nick, self: true }];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const self = p.self || p.slot === localSlot;
      const row = el('div', 'lobby-player', playersBox);
      const sw = el('i', 'sw', row);
      sw.style.background = colorOf(p);
      el('span', 'sl', row, p.slot === 0 ? 'host' : 'slot ' + p.slot);
      el('span', 'nk', row, p.nick || 'player');
      el('span', 'yo', row, self ? 'you' : '');
      // The host is ready by definition: it is the one holding Start, so a
      // "waiting" marker beside it would be a lie about who anybody is waiting
      // for. Once the session is running the column stops meaning anything and
      // says so.
      const ready = p.slot === 0 ? true : !!p.ready;
      const rd = el('span', 'rd', row,
        phase === 'playing' ? 'in game' : ready ? 'ready' : 'waiting');
      rd.classList.toggle('on', phase === 'playing' || ready);
    }
    renderStart();
  }

  // The Start / Ready line. Which control a tab gets is decided by ONE fact --
  // is this the host -- and the note under it always says what the button is
  // about to do, including when it is about to start without somebody.
  function renderStart() {
    const inRoom = !!session;
    const running = phase === 'playing';
    startLine.style.display = inRoom && !running ? '' : 'none';
    if (!inRoom || running) return;
    const isHost = !!session.isHost;
    startBtn.style.display = isHost ? '' : 'none';
    readyBtn.style.display = isHost ? 'none' : '';
    const list = players.length ? players : [];
    const waiting = list.filter((p) => p.slot !== 0 && !p.ready);
    if (isHost) {
      startBtn.disabled = busy;
      startNote.textContent = list.length <= 1
        ? 'Nobody else has joined yet. Starting now plays the intro for you alone.'
        : waiting.length
          ? 'Starting now goes without ' + waiting.length
            + (waiting.length === 1 ? ' player who is not ready.' : ' players who are not ready.')
          : 'Everyone is ready. Start plays the intro for the whole room at once.';
      // The last thing read before the button is pressed says which game is
      // about to be started. It is not a decoration: the mode cannot be
      // changed afterwards.
      if (creative) startNote.textContent += ' CREATIVE MODE IS ON for everyone.';
    } else {
      readyBtn.textContent = localReady ? 'Not ready' : 'Ready';
      readyBtn.classList.toggle('quiet', localReady);
      startNote.textContent = 'Waiting for the host to start. '
        + 'You can join a session that is already running at any time.'
        + (creative ? ' This room is in CREATIVE MODE.' : '');
    }
  }

  async function host() {
    if (busy || session) return null;
    busy = true;
    syncButtons();
    say('Creating room...');
    const res = await tryHostRoom({ nick: nickname(), isPublic: isPublicChoice() });
    busy = false;
    if (!res.ok) {
      say(res.error || 'Could not create the room.', true);
      syncButtons();
      return null;
    }
    session = res.session;
    localSlot = 0;
    localReady = true;               // the host holds the button; see renderStart
    phase = 'lobby';                 // a room OPENS in the waiting room
    players = [{ slot: 0, nick: session.nick, self: true, ready: true }];
    say(session.isPublic ? 'Room is public and listed.' : 'Room is private. Share the link.');
    renderSession();
    syncButtons();
    if (o.onHost) o.onHost(session);
    return session;
  }

  async function join(roomId) {
    if (busy || session || !roomId) return null;
    busy = true;
    syncButtons();
    say('Joining...');
    const res = await tryJoinRoom(roomId, { nick: nickname() });
    busy = false;
    if (!res.ok) {
      say(res.error || 'Could not join.', true);
      syncButtons();
      refresh();
      return null;
    }
    session = res.session;
    localSlot = session.slot;
    localReady = false;
    // Provisional until the host's WELCOME says which it is. setPhase() below is
    // what actually decides, and it is the host that decides it.
    phase = 'lobby';
    players = [
      { slot: 0, nick: session.hostNick || 'host', ready: true },
      { slot: session.slot, nick: session.nick, self: true, ready: false },
    ];
    say('Joined.');
    renderSession();
    syncButtons();
    if (o.onJoin) o.onJoin(session);
    return session;
  }

  // Called by whoever owns the session when it ends -- by the button here, by
  // the host closing the tab, or by the network layer giving up.
  function clearSession(reason) {
    if (!session) return false;
    session = null;
    players = [];
    renderSession();
    syncButtons();
    if (reason) say(reason);
    refresh();
    return true;
  }

  async function leave() {
    if (!session) return false;
    const s = session;
    const wasHost = s.isHost;
    clearSession(wasHost ? 'Session ended.' : 'Left the room.');
    if (o.onLeave) o.onLeave(s, wasHost);
    try {
      await s.close();
    } catch (e) { /* the room is going away either way */ }
    return true;
  }

  // Both of these go through the owner of the session, never through this
  // panel's own bookkeeping: the host performs REQ.START, a client SENDS
  // REQ.READY and its flag comes back in the roster like every other fact about
  // a player. renderPlayers() then redraws from what arrived.
  function doStart() {
    if (!session || !session.isHost || phase === 'playing') return null;
    const res = o.onStart ? o.onStart(session) : null;
    renderStart();
    return res;
  }

  function setReady(on) {
    if (!session || session.isHost) return false;
    localReady = !!on;
    if (o.onReady) o.onReady(localReady);
    renderStart();
    return localReady;
  }

  async function copyLink() {
    if (!session) return false;
    const text = sessionLink();
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch (e) { ok = false; }
    // Clipboard access is refused without a user gesture and in some contexts
    // outright, so the link stays selectable on screen either way.
    copyBtn.textContent = ok ? 'Copied' : 'Select it';
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { copyBtn.textContent = 'Copy link'; }, Math.round(config.lobby.copyFeedbackMs));
    if (!ok) {
      const range = document.createRange();
      range.selectNodeContents(linkBox);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    return ok;
  }

  startBtn.addEventListener('click', () => doStart());
  readyBtn.addEventListener('click', () => setReady(!localReady));
  hostBtn.addEventListener('click', () => host());
  refreshBtn.addEventListener('click', () => refresh());
  copyBtn.addEventListener('click', () => copyLink());
  leaveBtn.addEventListener('click', () => leave());
  closeBtn.addEventListener('click', () => doClose(false));
  scrim.addEventListener('click', () => doClose(false));

  async function doOpen(options) {
    const op = options || {};
    if (!open) {
      open = true;
      root.classList.add('open');
      say('');
      if (document.exitPointerLock) document.exitPointerLock();
      if (o.onOpen) o.onOpen();
    }
    renderSession();
    syncButtons();
    const ok = await probe();
    if (ok && !session) {
      await refresh();
      scheduleRefresh();
      if (op.joinRoomId) await join(op.joinRoomId);
    }
    return ok;
  }

  // THE WAITING ROOM IS MODAL. A room opens into the lobby, not into the world,
  // so while it is waiting there is nothing behind this panel to close into --
  // the two ways out are Start (the host's) and Leave, both of which are on
  // screen. `force` is how the network layer closes it when the session actually
  // begins; a click never passes it.
  function doClose(force) {
    if (!open) return false;
    if (!force && session && phase !== 'playing') { say('The room is waiting. Start it, or leave.'); return false; }
    open = false;
    root.classList.remove('open');
    clearInterval(refreshTimer);
    if (o.onClose) o.onClose();
    return true;
  }

  return {
    root,
    open: doOpen,
    close: (force) => doClose(force === undefined ? true : force),
    toggle(options) { return open ? (doClose(false), Promise.resolve(false)) : doOpen(options); },
    isOpen: () => open,
    refresh,
    host,
    join,
    leave,
    copyLink,
    clearSession,
    session: () => session,
    // The network layer owns the truth about who is connected; the lobby only
    // draws it. Nothing here infers a player list from its own bookkeeping.
    setPlayers(list) {
      players = Array.isArray(list) ? list.slice() : [];
      // The roster is the authority on this tab's own ready flag too: a click
      // that never reached the host must not leave the button lying about it.
      const mine = players.find((p) => p && p.slot === localSlot);
      if (mine && typeof mine.ready === 'boolean') localReady = mine.ready;
      renderPlayers();
    },
    // The network layer owns the phase; this panel only draws it. Told rather
    // than polled so the waiting room clears in the same frame the host starts.
    setPhase(p) {
      phase = p === 'playing' ? 'playing' : 'lobby';
      renderPlayers();
      syncMode();
      syncButtons();
      return phase;
    },
    // --- session mode --------------------------------------------------------
    // What the panel will hand to the session when it starts. Whoever owns the
    // session reads this ONCE, at Start, and passes it to the sim modules; the
    // panel never reaches into the game itself.
    creative: () => creative,
    // Told, not asked. This is how the room's mode reaches a CLIENT: the network
    // layer writes it from the host's WELCOME, exactly as it writes the phase and
    // the roster. It bypasses the lock deliberately -- the lock exists to refuse
    // a click, not a fact from the host.
    setCreative(on) {
      creative = !!on;
      modeInputs[0].checked = !creative;
      modeInputs[1].checked = creative;
      syncMode();
      renderStart();
      return creative;
    },
    // The host's own control path, for a test or a key binding. Refused when
    // the panel is not the one deciding.
    chooseCreative,
    creativeLocked: modeLocked,
    phase: () => phase,
    isWaiting: () => !!session && phase !== 'playing',
    start: doStart,
    setReady,
    ready: () => localReady,
    setNickname(v) { nick.value = String(v || ''); },
    nickname,
    netAvailable: () => netOk,
    netStatus,
    message: () => lastMessage,
    state: () => ({
      open,
      busy,
      netAvailable: netOk,
      netText: net.textContent,
      role: role.textContent,
      visibility: isPublicChoice() ? 'public' : 'private',
      creative,
      creativeChecked: modeInputs[1].checked,
      creativeLocked: modeLocked(),
      modeHint: modeHint.textContent,
      modeVisible: modeSec.style.display !== 'none',
      nickname: nickname(),
      message: lastMessage,
      inSession: !!session,
      roomId: session ? session.roomId : null,
      link: session ? sessionLink() : null,
      rooms: Array.from(rooms.querySelectorAll('.lobby-room')).map((r) => ({
        id: r.dataset.id,
        host: r.querySelector('.nm').textContent,
        count: r.querySelector('.ct').textContent,
        button: r.querySelector('button').textContent,
        joinable: !r.querySelector('button').disabled,
      })),
      players: Array.from(playersBox.children).map((c) => c.textContent),
      phase,
      waiting: !!session && phase !== 'playing',
      localReady,
      localSlot,
      startVisible: startLine.style.display !== 'none',
      startEnabled: startBtn.style.display !== 'none' && !startBtn.disabled,
      readyVisible: readyBtn.style.display !== 'none',
      startNote: startNote.textContent,
      playerRows: Array.from(playersBox.children).map((row) => ({
        slot: row.querySelector('.sl').textContent,
        nick: row.querySelector('.nk').textContent,
        color: row.querySelector('.sw').style.background,
        ready: row.querySelector('.rd').textContent,
        self: row.querySelector('.yo').textContent === 'you',
      })),
      hostEnabled: !hostBtn.disabled,
      hostVisible: hostSec.style.display !== 'none',
      joinVisible: joinSec.style.display !== 'none',
    }),
    dispose() {
      clearInterval(refreshTimer);
      clearTimeout(copyTimer);
      if (root.parentNode) root.parentNode.removeChild(root);
      if (style.parentNode) style.parentNode.removeChild(style);
    },
  };
}

export default createLobbyUI;
