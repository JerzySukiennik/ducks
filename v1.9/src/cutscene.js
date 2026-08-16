// The 30-second intro. IN-ENGINE: it stages real objects in the real world and
// flies the real camera, which is the only reason it can look like the game.
//
// Four rules shape this file more than anything else.
//
// 1. THE MUSIC IS THE EDIT. assets/audio/cutscene.beats.json is a MEASURED beat
//    grid (30.000 s, 122.5 BPM, 62 beats, 16 bars, beat 0 at t=0). Every camera
//    cut and every staged event is addressed by BAR INDEX and resolved through
//    that file. Nothing here re-derives a tempo and nothing here is scheduled at
//    an arbitrary second, because a cut that lands 90 ms off the bar reads as a
//    mistake even to somebody who could not name why.
//
// 2. THE CLOCK IS NOT THE AUDIO. Browsers refuse to start an AudioContext before
//    a user gesture, so the timeline runs off its own accumulator and the music
//    is scheduled to CATCH UP to it. A cutscene that waits for audio is a broken
//    boot; a silent cutscene is an acceptable one.
//
// 3. THE SET IS TORN DOWN COMPLETELY. Everything created here is recorded in
//    `built` and removed on the way out, and the money the pit paid while the
//    camera was rolling is put back. The player must begin a normal fresh
//    session -- teardown() returns a report and main.js asserts it against the
//    boot baseline.
//
// 4. IT IS SKIPPABLE PER PLAYER. Esc or Space ends it for THIS tab only. In a
//    room the host broadcasts a start time on its own clock and every client
//    aligns to it (src/net/game.js, EV.CUTSCENE); no client free-runs its own
//    timeline, and no client's skip touches anybody else's.
//
// No three.js in here. The camera is a {x,y,z,yaw,pitch} pose that main.js hands
// to view.updateCamera(), which is the same call the player's own eye goes
// through, and every object is created through a hook main.js passes in.

import config from './config.js';
import CRT, { injectCRT } from './ui/theme.js';
import { loadJSON, fetchWithTimeout } from './core/assets.js';

// Wall clock, deliberately: this is the ONE thing in the cutscene that must not
// be measured on the simulation clock. The settle pass advances simTime by
// several seconds inside a single wall-clock second, so a sim-clock reading of
// "how long did staging take" would be off by a factor of three.
function wallNow() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

// --- geometry helpers ---------------------------------------------------------

function smoothstep(t) {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

function lerp(a, b, t) { return a + (b - a) * t; }

function vlerp(a, b, t) {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

// The SAME conversion main.js's lookAt() uses, so a cutscene camera and a player
// camera cannot disagree about what "looking at that" means.
function lookAngles(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const l = Math.hypot(dx, dy, dz) || 1;
  return {
    yaw: Math.atan2(-dx / l, -dz / l),
    pitch: Math.asin(Math.max(-1, Math.min(1, dy / l))),
  };
}

// --- the one switch ----------------------------------------------------------
// DURING THE CUTSCENE THERE IS NO INTERFACE. Jurek's instruction, and the way it
// is enforced matters more than the fact of it: this is ONE class on <html> and
// an ALLOWLIST, not ten panels each learning about a cutscene flag. Hiding
// element by element works until somebody adds an eleventh panel and forgets --
// and the person who adds it has no reason to think about an intro they have
// never seen. An allowlist fails the other way: a new panel is hidden by
// default, and the only things that survive are named here.
//
// What survives, and why:
//   #view      the world. That IS the cutscene.
//   #vignette  and
//   #grain     the renderer's own image effects -- they are how the game looks,
//              not things you click. Hiding them would change the picture.
//   #cut       this file's own letterbox and fade.
// Everything else in the document goes: the debug overlay, the crosshair and
// prompt, the money counter, the hotbar, the focus label over objects, the
// avatar name tags, the shop, the summary, the lobby, the settings panel, the
// menu, and the boot hint outside #app.
//
// The class goes on the ROOT element rather than on #app so the second rule can
// reach things that were never mounted inside the game container.
const CSS = `
html.cinematic #app > *:not(#view):not(#vignette):not(#grain):not(#cut) {
  display: none !important;
}
html.cinematic body > *:not(#app) { display: none !important; }

#cut { position: fixed; inset: 0; z-index: ${CRT.layer.summary}; display: none;
  pointer-events: none; color: ${CRT.on};
  font: 400 ${CRT.type.body.size}/${CRT.type.body.line} ${CRT.display};
  letter-spacing: ${CRT.type.body.track}; }
#cut.on { display: block; }
/* Letterbox. A camera device rather than an interface element: it says "this is
   a shot", it has nothing to read and nothing to click. Its height is one config
   number (cutscene.letterboxVh) so setting it to 0 removes it entirely. */
.cut-bar { position: absolute; left: 0; right: 0; background: #000; }
#cut-top { top: 0; }
#cut-bot { bottom: 0; }
#cut-fade { position: absolute; inset: 0; background: ${CRT.bg}; opacity: 0; }
/* The ONE affordance, and it does not sit there for thirty seconds. It fades in
   over the first bar, holds, and fades out -- long enough to be read, short
   enough that the other twenty-six seconds are just the world. */
#cut-skip { position: absolute; right: clamp(20px, 4vw, 64px); bottom: 4vh;
  font-size: ${CRT.type.label.size}; letter-spacing: ${CRT.type.label.track};
  text-transform: uppercase; color: ${CRT.faint}; opacity: 0; }
/* The title cards. They live INSIDE #cut, which is the one element the cinematic
   allowlist keeps alive, so they arrive and leave with the film and no panel
   anywhere else has to learn that an intro exists. They are titles on a shot,
   not interface: nothing to click, no pointer events, gone before the cut. Sat
   just above the bottom letterbox, left-aligned on the same margin the skip hint
   uses on the other side, so the two never collide. */
#cut-card { position: absolute; left: clamp(24px, 6vw, 96px);
  bottom: calc(var(--cut-bar-h, 9vh) + 4vh);
  max-width: min(46ch, 76vw); opacity: 0; }
#cut-eyebrow { font-size: ${CRT.type.label.size}; line-height: ${CRT.type.label.line};
  letter-spacing: ${CRT.type.label.track}; text-transform: uppercase;
  color: ${CRT.dim}; }
#cut-title { margin-top: 4px;
  font-size: ${CRT.type.heading.size}; line-height: ${CRT.type.heading.line};
  letter-spacing: ${CRT.type.heading.track}; text-transform: uppercase;
  color: ${CRT.bright}; text-shadow: ${CRT.glowTitle}; }
/* Head-down only: never shown to a player, only to debugCutsceneBeatHud(true),
   which is how the beat alignment is read off a running frame. */
#cut-beat { position: absolute; left: clamp(24px, 6vw, 96px); top: 4vh;
  font-family: ${CRT.data}; font-size: ${CRT.type.dataSm.size};
  letter-spacing: ${CRT.type.dataSm.track}; color: ${CRT.faint}; display: none; }
#cut.debug #cut-beat { display: block; }
`;

// --- the shot list ------------------------------------------------------------
// Jurek's four shots, in his order, addressed by BAR. `bar` is an index into the
// beat grid's bar boundaries; nothing here is a second.
//
//   bar 0   BUYING          one item out of the chute
//   bar 2   BUYING          ...and then many at once (a cut, not a zoom)
//   bar 4   DUCK OVERFLOW   the pile, every duck already asleep
//   bar 8   THE FACTORY     belts, fans, the good machines, all running
//   bar 12  MULTIPLAYER     four players, one waving, camera pulling out
//
// Each entry is a dolly: `from` -> `to` for the eye, `look` -> `lookTo` for what
// it is pointed at, eased with a smoothstep so a cut is a cut and a move is a
// move. The numbers are world metres; the world's own landmarks (booth at
// -5.5/6, chute at 7.5/-4, bench at 0/35, pit at the origin) are what they are
// relative to.
function shotList(C) {
  const ox = C.overflowX;
  const oz = C.overflowZ;
  const fx = C.factoryX;
  const fz = C.factoryZ;
  const cx = C.crewX;
  const cz = C.crewZ;
  return [
    {
      key: 'buy1', bar: 0,
      // THE SHOP, with the delivery chute hanging over it in the background --
      // the two halves of a purchase in one frame. The camera sits on the far
      // side of the booth from the chute so both are on the same sight line.
      from:   { x: -12.5, y: 3.40, z: 13.5 },
      to:     { x: -10.2, y: 3.00, z: 11.0 },
      look:   { x: -1.5,  y: 3.00, z: 5.6 },
      lookTo: { x: -1.0,  y: 2.60, z: 4.6 },
    },
    {
      key: 'buy2', bar: 2,
      // ...AND THEN MANY AT ONCE. A cut, not a zoom: round the other side, with
      // the chute mouth top-left, the painted drop zone bottom-centre and the
      // whole fall between them, so a sixteen-item burst reads as a stream.
      from:   { x: 15.5, y: 2.60, z: 1.0 },
      to:     { x: 13.0, y: 2.20, z: -1.0 },
      look:   { x: 7.5,  y: 3.40, z: -4.0 },
      lookTo: { x: 7.5,  y: 1.40, z: -4.0 },
    },
    {
      key: 'overflow', bar: 4, label: 'Shot 2 / 4', title: 'Duck overflow',
      eyebrow: 'Nobody carried these thirty-five metres.',
      from:   { x: ox + 6.0, y: 1.30, z: oz + 6.0 },
      to:     { x: ox + 3.0, y: 3.40, z: oz + 3.0 },
      look:   { x: ox,       y: 0.75, z: oz },
      lookTo: { x: ox,       y: 0.50, z: oz },
    },
    {
      key: 'factory', bar: 8, label: 'Shot 3 / 4', title: 'The factory',
      eyebrow: 'Belts, fans, presses. The walk automates itself.',
      from:   { x: fx - 11.0, y: 6.0, z: fz - 11.0 },
      to:     { x: fx - 4.5,  y: 2.1, z: fz - 4.5 },
      look:   { x: fx,        y: 0.8, z: fz },
      lookTo: { x: fx + 1.0,  y: 1.2, z: fz + 1.0 },
    },
    {
      key: 'crew', bar: 12, label: 'Shot 4 / 4', title: 'Four of you',
      eyebrow: 'Two to four hours. No save. Bring people.',
      // Eye level with them, then up and back until the whole plaza is in the
      // frame: the pit they are standing at, the booth, the chute.
      from:   { x: cx + 0.5,  y: 1.75, z: cz - 9.0 },
      to:     { x: cx - 8.0,  y: 10.5, z: cz - 21.0 },
      look:   { x: cx,        y: 1.35, z: cz - 1.8 },
      lookTo: { x: cx,        y: 0.70, z: cz - 3.0 },
    },
  ];
}

export function createCutscene(opts) {
  const o = opts || {};
  const C = config.cutscene;
  const container = o.container || document.body;
  const stage = o.stage || {};
  const bus = o.bus || null;

  injectCRT(document);
  const style = document.createElement('style');
  style.id = 'cutscene-style';
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'cut';
  const fade = document.createElement('div');
  fade.id = 'cut-fade';
  root.appendChild(fade);
  const top = document.createElement('div');
  top.className = 'cut-bar';
  top.id = 'cut-top';
  top.style.height = C.letterboxVh + 'vh';
  root.appendChild(top);
  const bot = document.createElement('div');
  bot.className = 'cut-bar';
  bot.id = 'cut-bot';
  bot.style.height = C.letterboxVh + 'vh';
  root.appendChild(bot);
  // The letterbox height, published as a variable so the title card can sit on
  // top of the bar rather than guessing where it ends.
  root.style.setProperty('--cut-bar-h', C.letterboxVh + 'vh');
  const card = document.createElement('div');
  card.id = 'cut-card';
  const cardEyebrow = document.createElement('div');
  cardEyebrow.id = 'cut-eyebrow';
  const cardTitle = document.createElement('div');
  cardTitle.id = 'cut-title';
  card.appendChild(cardEyebrow);
  card.appendChild(cardTitle);
  root.appendChild(card);
  const skipLine = document.createElement('div');
  skipLine.id = 'cut-skip';
  skipLine.textContent = 'Esc / Space - skip';
  root.appendChild(skipLine);
  const beatLine = document.createElement('div');
  beatLine.id = 'cut-beat';
  root.appendChild(beatLine);
  container.appendChild(root);

  // --- the beat grid ----------------------------------------------------------
  // Read from disk, ONCE, and never re-derived. Until it arrives the cutscene
  // refuses to start: running it on a guessed tempo is worse than not running
  // it, and the file is 1.3 KB beside a 470 KB mp3.
  let grid = null;
  let gridError = null;
  let musicBytes = null;

  async function preload() {
    const raw = await loadJSON(C.beatsPath, null, C.fetchTimeoutMs);
    if (!raw || !Array.isArray(raw.beats) || !raw.beats.length) {
      gridError = 'cutscene.beats.json missing or empty';
      return null;
    }
    const beatsPerBar = Math.max(1, Math.round(raw.beatsPerBar || 4));
    const bars = [];
    for (let i = 0; i < raw.beats.length; i += beatsPerBar) bars.push(raw.beats[i]);
    grid = {
      seconds: Number(raw.seconds) || C.seconds,
      bpm: Number(raw.bpm) || 0,
      beatSeconds: Number(raw.beatSeconds) || 0,
      barSeconds: Number(raw.barSeconds) || 0,
      beatsPerBar,
      beats: raw.beats.slice(),
      bars,
    };
    // The music. Fetched as bytes at boot so the decode at start() is the only
    // thing between the gesture and the first note; decoding needs a live
    // AudioContext, which may not exist yet, so it deliberately does not happen
    // here.
    try {
      const res = await fetchWithTimeout(C.musicPath, C.fetchTimeoutMs);
      if (res.ok) musicBytes = await res.arrayBuffer();
    } catch (e) {
      musicBytes = null;                  // silent is a supported outcome
    }
    return grid;
  }
  const ready = preload();

  function barTime(i) {
    if (!grid) return 0;
    const n = grid.bars.length;
    if (i <= 0) return 0;
    if (i >= n) return grid.seconds;
    return grid.bars[i];
  }

  // --- state ------------------------------------------------------------------
  let active = false;
  let t = 0;                     // seconds into the timeline
  let shots = [];
  let shotIndex = -1;
  let pose = null;
  let skipped = false;
  let music = null;              // { source, gain }
  let musicState = 'idle';
  let decodePending = false;
  const cuts = [];               // { key, bar, at, barAt, errorMs }
  const fired = Object.create(null);
  let worstFrameMs = 0;
  let worstFrameShot = null;
  let overflowCheck = null;
  let frames = 0;
  let lastEnd = null;
  let onDone = typeof o.onDone === 'function' ? o.onDone : () => {};
  let debugHud = false;

  // Everything this file made, so everything this file made can be unmade.
  const built = { placed: [], props: [], ducks: [], avatars: false };
  // The economy exactly as it was before the camera rolled. BOTH numbers: a
  // duck that scores during the intro moves the balance AND the lifetime earned
  // counter, and prestige is a function of the second one -- restoring only the
  // first would leave the player one intro closer to a prestige they never
  // played for.
  let econBefore = null;

  // --- staging ----------------------------------------------------------------
  // Each shot's set is built at t < 0 and lives on the plate 90 m from the next
  // one, so shot 3's fans cannot blow shot 2's pile around. The plate is 180 m;
  // there is room.

  function place(id, x, z, yaw) {
    const rec = stage.place ? stage.place(id, x, z, yaw || 0) : null;
    if (rec && rec.key !== undefined && rec.key !== null) built.placed.push(rec.key);
    return rec;
  }

  function drop(id, pos, vel) {
    const rec = stage.dropProp ? stage.dropProp(id, pos, vel) : null;
    if (rec && rec.key !== undefined && rec.key !== null) built.props.push(rec.key);
    return rec;
  }

  function duck(pos, tier) {
    const id = stage.spawnDuck ? stage.spawnDuck(pos, tier) : null;
    if (id !== null && id !== undefined) built.ducks.push(id);
    return id;
  }

  // Shot 2's contract, and it is Jurek's explicit instruction: EVERY duck in the
  // pile is asleep before the camera rolls or the frame rate collapses. The
  // world sleeps a duck after config.ducks.sleepAfter seconds of stillness, so
  // this steps the simulation until the world's own counters agree and REPORTS
  // what it measured. It is asserted by main.js, never assumed.
  // SETTLING IS CHUNKED, and that is not an optimisation -- it is a correctness
  // fix. The first version ran the whole pass in one synchronous loop inside
  // prepare(). It blocks the main thread for as long as it takes (1.4 s on an
  // idle machine, and MEASURED at 27 s on a tab competing with a second game
  // tab), and a blocked main thread cannot answer WebRTC signalling: a client
  // that ran it on joining never completed its handshake and the host's room
  // showed zero clients. So it runs a bounded number of substeps per frame,
  // driven from the frame loop like everything else here, and start() finishes
  // whatever is left -- also bounded.
  let settle = null;

  function beginSettle() {
    settle = { steps: 0, done: false, live: 0, sleeping: 0, settled: false };
    return settle;
  }

  function pumpSettle(maxSteps) {
    if (!settle || settle.done) return settle;
    const dt = config.loop.fixedDt;
    const cap = Math.round(C.settleMaxSeconds / dt);
    let n = 0;
    let c = stage.duckCounts ? stage.duckCounts() : { live: 0, sleeping: 0 };
    // Setup is not session time. Every substep spent here would otherwise show
    // up in state.clock(), which is the number the host stamps EV.CUTSCENE with
    // and every client subtracts to find its place in the timeline.
    const clockBefore = stage.clockSnapshot ? stage.clockSnapshot() : null;
    // stepWorld, never step: this runs from INSIDE the frame loop, and stepping
    // the loop from within itself re-enters frame() and kills the tab. See
    // stage.stepWorld in src/main.js.
    const stepFn = stage.stepWorld || stage.step;
    while (n < maxSteps && settle.steps < cap && c.live > 0 && c.sleeping < c.live) {
      stepFn(dt);
      settle.steps++;
      n++;
      c = stage.duckCounts();
    }
    if (clockBefore !== null && stage.clockRestore) stage.clockRestore(clockBefore);
    settle.live = c.live;
    settle.sleeping = c.sleeping;
    settle.simSeconds = settle.steps * dt;
    settle.settled = c.live > 0 && c.sleeping >= c.live;
    // NOTHING TO SETTLE IS ALSO DONE. With c.live === 0 the loop above never
    // runs, so `steps` stays at 0 and can never reach `cap`, and `settled` is
    // false by construction -- `done` could never become true and finishSettle()
    // spun the main thread forever with no yield. Every joining CLIENT hit
    // exactly that: the host owns spawns, so a client's duck pool is empty, and
    // the moment the host pressed Start the client's tab locked hard enough that
    // `1+1` in its console timed out. Found by an independent audit of the live
    // build; it made the shipped game single player without anyone noticing.
    if (settle.settled || settle.steps >= cap || c.live === 0) settle.done = true;
    return settle;
  }

  // Everything left, at once. Called by start() so the guarantee holds even if
  // nobody ever pumped: the pile is ASLEEP before the camera rolls, full stop.
  function finishSettle() {
    // Belt and braces on top of the fix above: a WALL CLOCK bound, so no future
    // staging that fails to converge can ever wedge a tab again. A cutscene that
    // starts a little unsettled is a worse picture; a cutscene that never
    // returns is a dead browser.
    const started = (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
    const nowMs = () => ((typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now());
    while (settle && !settle.done) {
      pumpSettle(Math.round(C.settleStepsPerFrame) * 8);
      if (nowMs() - started > C.settleWallClockMs) {
        settle.done = true;
        settle.gaveUp = true;
        break;
      }
    }
    return settle;
  }

  function stageOverflow() {
    const ox = C.overflowX;
    const oz = C.overflowZ;
    // A workbench for the pile to be spilling out of. Yaw so its wheel faces the
    // camera's side of the shot.
    place('crank', ox, oz, Math.PI * 0.25);
    const n = Math.max(1, Math.round(C.overflowDucks));
    // A HEAP, not a carpet. The first version of this laid the ducks out in
    // concentric rings on the floor and the shot read as a crowd standing
    // politely in a circle -- which is not what "duck overflow" means. They are
    // now spawned as a tall column inside a small radius and DROPPED: gravity
    // makes the pile, the same way it would in a real session where a press has
    // been running unattended for ten minutes.
    //
    // The golden angle spreads the column so the ducks do not all fall down one
    // line, and the radius grows slowly so the base is wider than the top.
    let made = 0;
    for (let i = 0; i < n; i++) {
      const a = i * 2.399963;
      const r = C.overflowInnerRadius * Math.sqrt((i % 24) / 24) + (i / n) * C.overflowRingStep;
      made += duck({
        x: ox + Math.cos(a) * r,
        y: C.overflowDropY + i * C.overflowStackStep,
        z: oz + Math.sin(a) * r,
      }, i % 17 === 0 ? 1 : 0) === null ? 0 : 1;
    }
    return { requested: n, made, settle: beginSettle() };
  }

  function stageFactory() {
    const fx = C.factoryX;
    const fz = C.factoryZ;
    // A line the camera reads left to right: presses feeding a belt, fans over
    // it, and the belt running away towards the back of the shot. Every id here
    // is a real catalog row and every one of them is placed through the same
    // placer the player's own build uses.
    // Offsets are METRES, not grid cells, and they are spaced by the rows' own
    // half-extents: a conveyor is 1 x 2 m, a press 2 x 1.5, a machine 3 x 2.5,
    // a fan 2.5 x 1.5, a wall 4 x 0.5. Laid out on the 0.25 m grid these tile
    // without overlapping, which matters because the placer REFUSES an overlap
    // -- the first version of this list asked for 19 objects and got 6, and the
    // shot was a factory with holes in it.
    const line = [
      // the belt: six two-metre segments running away from camera
      ['conveyor', 0, -4], ['conveyor', 0, -2], ['conveyor', 0, 0],
      ['conveyor', 0, 2], ['conveyor', 0, 4], ['conveyor', 0, 6],
      // presses feeding it from the left
      ['press', -2, -4], ['press', -2, -1.5], ['press', -2, 1], ['press', -2, 3.5],
      // fans over the line
      ['fan', 2.5, -2], ['fan', 2.5, 2],
      // the good machines behind them
      ['machine', 5.5, -3], ['machine', 5.5, 1],
      ['vacuum_station', 2.5, 6],
      // light and a back wall, so the shot has a horizon of its own
      ['lamp_post', -5, -4], ['lamp_post', -5, 5],
      ['wall', -2, -7], ['wall', 2, -7],
    ];
    let n = 0;
    for (let i = 0; i < line.length; i++) {
      const [id, dx, dz] = line[i];
      if (place(id, fx + dx, fz + dz, 0)) n++;
    }
    // NOTHING is put on the belt here. Ducks dropped at staging time would have
    // ridden fifteen seconds of conveyor before this shot is reached and be off
    // the far end by the time the camera cuts to it -- the first version of this
    // showed a spotless factory carrying nothing. They are spawned ON THE BAR
    // the shot starts instead (see fireEvents, bars 8 and 10), so the belt is
    // loaded exactly when it is being looked at.
    return { placed: n, attempted: line.length, ducks: 0 };
  }

  // The belt's load, dropped at the head of the line so it rides towards camera.
  // Awake on purpose: this shot is about motion, and it is a few dozen bodies,
  // not the hundred and fifty of shot 2.
  function spawnBeltDucks(n) {
    const fx = C.factoryX;
    const fz = C.factoryZ;
    let made = 0;
    for (let i = 0; i < n; i++) {
      made += duck({
        x: fx + ((i % 3) - 1) * 0.28,
        y: 1.1 + (i % 5) * 0.26,
        z: fz - 4.6 + (i % 12) * 0.5,
      }, i % 11 === 0 ? 1 : 0) === null ? 0 : 1;
    }
    return made;
  }

  function stageCrew() {
    // Four players. The local player is a camera and never a body, so the crew
    // is drawn through the SAME avatar view a real room uses -- one InstancedMesh,
    // one draw call -- and given poses through the same push the network uses.
    if (!stage.setAvatars) return { avatars: 0 };
    const palette = config.menu.palette;
    const list = [];
    for (let i = 0; i < 4; i++) {
      list.push({
        id: 'cut' + i,
        nick: C.crewNames[i] || ('player ' + (i + 1)),
        slot: i,
        color: palette[i % palette.length],
      });
    }
    stage.setAvatars(list);
    built.avatars = true;
    // Ducks around their feet. Asleep by the time the shot is reached -- they
    // are dropped here, with shot 2's pile, and settled by the same loop.
    let ducks = 0;
    for (let i = 0; i < C.crewDucks; i++) {
      const a = i * 2.399963;
      const r = 2.6 + (i % 6) * 0.55;
      ducks += duck({
        x: C.crewX + Math.cos(a) * r,
        y: 0.35 + (i % 4) * 0.2,
        z: C.crewZ - 2.4 + Math.sin(a) * r,
      }, i % 9 === 0 ? 1 : 0) === null ? 0 : 1;
    }
    return { avatars: list.length, ducks };
  }

  // The crew's poses, pushed every frame of shot 4. One of them WAVES: the
  // avatar model is a single capsule with no limbs (src/render/avatars.js), so a
  // wave is the only thing that body can do -- it rocks its yaw and bobs, on the
  // beat, which reads as "hey, over here" rather than as a walk cycle.
  function crewPoses(now) {
    if (!built.avatars || !stage.pushAvatarPose) return;
    const cx = C.crewX;
    const cz = C.crewZ;
    const beat = grid ? grid.beatSeconds : 0.489796;
    for (let i = 0; i < 4; i++) {
      const a = -Math.PI * 0.5 + (i - 1.5) * 0.42;
      const r = C.crewRadius;
      const waving = i === C.crewWaver;
      const ph = (now / beat) * Math.PI;
      // Player yaw 0 looks down -Z (src/render/view.js), and the camera for this
      // shot sits on the -Z side of them, so 0 is facing it.
      const yaw = (i - 1.5) * 0.12 + (waving ? Math.sin(ph) * 0.55 : 0);
      stage.pushAvatarPose('cut' + i, {
        x: cx + Math.cos(a) * r,
        y: (waving ? Math.abs(Math.sin(ph * 0.5)) * 0.16 : 0),
        z: cz + Math.sin(a) * r,
        yaw,
        pitch: 0,
      }, now);
    }
  }

  // --- audio ------------------------------------------------------------------
  // The bus, never a bare `new Audio()`: this goes through the same graph
  // src/audio/pitsynth.js uses (bus.synthNodes()), so the master and effects
  // sliders, the mute and config.audio.masterGain all apply to it unchanged.
  // If the context is not running -- no gesture yet -- this returns without
  // starting anything and the timeline carries on silently.
  function startMusic(offsetSeconds) {
    if (!bus || !musicBytes || decodePending || music) return false;
    // The MUSIC bus, not the effects bus. The intro used to run through
    // synthNodes(), which is the sfx path -- so it sat 4-12 dB louder than the
    // game and was governed by the SFX slider rather than the one a player
    // reaches for when they want the music quieter.
    const nodes = bus.musicNodes ? bus.musicNodes()
      : (bus.synthNodes ? bus.synthNodes() : null);
    if (!nodes) { musicState = 'no-context'; return false; }
    decodePending = true;
    const ctx = nodes.ctx;
    const decode = new Promise((resolve, reject) => {
      let settled = false;
      const ok = (b) => { if (!settled) { settled = true; resolve(b); } };
      const bad = (e) => { if (!settled) { settled = true; reject(e); } };
      let r;
      // The bytes are consumed by decodeAudioData on some engines, so a copy
      // goes in and the original stays replayable on a second run.
      try { r = ctx.decodeAudioData(musicBytes.slice(0), ok, bad); } catch (e) { bad(e); return; }
      if (r && typeof r.then === 'function') r.then(ok, bad);
    });
    decode.then((buf) => {
      decodePending = false;
      // AUDIO CATCHES UP TO THE CLOCK, never the other way round: whatever the
      // decode cost, the track starts at the point in the music the timeline is
      // already at.
      if (!active) { musicState = 'too-late'; return; }
      const start = Math.max(0, Math.min(buf.duration - 0.01, t + C.musicLeadSeconds));
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = C.musicGain;
      src.connect(g);
      g.connect(nodes.destination);
      try { src.start(ctx.currentTime, start); } catch (e) { musicState = 'refused'; return; }
      music = { source: src, gain: g, ctx };
      musicState = 'playing';
      if (bus.recordSynth) bus.recordSynth('cutscene', C.musicGain);
    }).catch(() => { decodePending = false; musicState = 'decode-failed'; });
    musicState = 'decoding';
    return true;
  }

  function stopMusic() {
    if (!music) return false;
    try {
      const c = music.ctx;
      const now = c.currentTime;
      music.gain.gain.cancelScheduledValues(now);
      music.gain.gain.setValueAtTime(music.gain.gain.value, now);
      music.gain.gain.linearRampToValueAtTime(0, now + C.musicFadeSeconds);
      music.source.stop(now + C.musicFadeSeconds + 0.02);
    } catch (e) { /* a refused stop is not worth a frame */ }
    music = null;
    musicState = 'stopped';
    return true;
  }

  // --- the timeline -----------------------------------------------------------

  function shotAt(time) {
    let idx = 0;
    for (let i = 0; i < shots.length; i++) if (time >= shots[i].at - 1e-6) idx = i;
    return idx;
  }

  function applyShot(i) {
    if (i === shotIndex) return;
    shotIndex = i;
    const s = shots[i];
    // SHOT 2'S CONTRACT, checked at the instant the camera cuts to it and not a
    // frame before: every duck in the pile is ASLEEP. Jurek's explicit
    // instruction, and the reason for it is measurable -- 150 awake ducks in
    // one heap is a solver cost the frame budget cannot pay. Counted inside the
    // shot's own radius, because a press ninety metres away making ducks of its
    // own has nothing to do with this frame.
    if (s.key === 'overflow' && stage.duckCountsNear) {
      overflowCheck = {
        ...stage.duckCountsNear(C.overflowX, C.overflowZ, C.overflowCheckRadius),
        at: t,
      };
      overflowCheck.allAsleep = overflowCheck.live > 0
        && overflowCheck.sleeping === overflowCheck.live;
    }
    // The shot's own words. Written on the cut and faded by update(); a shot
    // with no copy simply carries none and the card stays at zero.
    cardEyebrow.textContent = s.eyebrow || '';
    cardTitle.textContent = s.title || '';
    // What the cut actually landed on, measured against the beat file rather
    // than against the number that was asked for.
    cuts.push({
      key: s.key, bar: s.bar, at: t, barAt: s.at,
      errorMs: Math.round((t - s.at) * 1e5) / 100,
    });
  }

  function poseAt(time) {
    const i = shotAt(time);
    const s = shots[i];
    const end = (i + 1 < shots.length) ? shots[i + 1].at : (grid ? grid.seconds : C.seconds);
    const span = Math.max(1e-3, end - s.at);
    const k = smoothstep((time - s.at) / span);
    const eye = vlerp(s.from, s.to, k);
    const look = vlerp(s.look, s.lookTo, k);
    const ang = lookAngles(eye, look);
    return { x: eye.x, y: eye.y, z: eye.z, yaw: ang.yaw, pitch: ang.pitch, shot: s.key };
  }

  // Staged events that are not camera moves. Each is addressed by BAR and fires
  // once, when the timeline passes that bar's measured time.
  function fireEvents() {
    const mouth = stage.tubeMouth ? stage.tubeMouth() : { x: 7.5, y: 6.3, z: -4 };
    // bar 0: ONE item falls.
    if (!fired.one && t >= barTime(0)) {
      fired.one = true;
      drop(C.chuteFirst, { x: mouth.x, y: mouth.y - 0.5, z: mouth.z }, { x: 0, y: -config.drop.speed, z: 0 });
    }
    // bar 1: a second, so the pipe is alive before the flood.
    if (!fired.two && t >= barTime(1)) {
      fired.two = true;
      drop(C.chuteSecond, { x: mouth.x + 0.18, y: mouth.y - 0.5, z: mouth.z - 0.12 },
        { x: 0, y: -config.drop.speed, z: 0 });
    }
    // bar 2: MANY at once. The chute's real per-frame cap is what makes this
    // read as a stream rather than a single clump, so they are queued and let
    // out a few per frame exactly as a real 60-wall purchase is.
    if (!fired.many && t >= barTime(2)) {
      fired.many = true;
      chuteQueue = C.chuteBurst.slice();
      chuteNextAt = t;
    }
    // bars 8 and 10: the factory shot's belt load, dropped as the camera cuts to
    // it and again halfway through, so the line is never empty on screen.
    if (!fired.belt1 && t >= barTime(8)) {
      fired.belt1 = true;
      spawnBeltDucks(Math.round(C.factoryDucks / 2));
    }
    if (!fired.belt2 && t >= barTime(10)) {
      fired.belt2 = true;
      spawnBeltDucks(Math.round(C.factoryDucks / 2));
    }
    // bar 13: the wave starts. Handled in crewPoses via C.crewWaver; nothing to
    // fire, but the beat is recorded so the log shows it was addressed by bar.
    if (!fired.wave && t >= barTime(13)) {
      fired.wave = true;
      cuts.push({ key: 'wave', bar: 13, at: t, barAt: barTime(13),
        errorMs: Math.round((t - barTime(13)) * 1e5) / 100 });
    }
  }

  let chuteQueue = [];
  let chuteNextAt = 0;
  // A STREAM, not a clump. Released on an interval rather than N per frame: at
  // two a frame the whole sixteen-item burst left the pipe in 130 ms and every
  // one of them was already on the floor by the time the shot was half over,
  // which reads as "a pile appeared" instead of "they keep coming".
  function pumpChute() {
    if (!chuteQueue.length) return 0;
    const mouth = stage.tubeMouth ? stage.tubeMouth() : { x: 7.5, y: 6.3, z: -4 };
    let n = 0;
    while (chuteQueue.length && t >= chuteNextAt) {
      const id = chuteQueue.shift();
      chuteNextAt += C.chuteIntervalSeconds;
      drop(id, {
        x: mouth.x + (Math.random() - 0.5) * config.drop.spread,
        y: mouth.y - 0.5,
        z: mouth.z + (Math.random() - 0.5) * config.drop.spread,
      }, { x: 0, y: -config.drop.speed, z: 0 });
      n++;
    }
    return n;
  }

  // --- lifecycle --------------------------------------------------------------

  // --- DRESSING THE SET AHEAD OF TIME ------------------------------------------
  //
  // Staging is expensive and it is expensive in WALL TIME: 172 ducks, twenty
  // machines, and a settle pass that steps the solver until every duck in the
  // pile is asleep. Measured at 1.4 s on the host tab and 8 s on a second tab
  // competing with it for the CPU.
  //
  // That cost cannot simply be ignored, because the timeline is anchored to the
  // instant START was pressed: a tab that took eight seconds to get ready would
  // correctly -- and uselessly -- enter the intro eight seconds in and miss the
  // first two shots. MEASURED: a client entered at t=12.2 and opened on shot 3.
  //
  // So it is paid EARLIER, while everybody is sitting in the waiting room with
  // nothing to look at. prepare() is called the moment a room is opened or
  // joined; by the time the host presses Start the set is already standing and
  // start() has nothing left to do but roll. A solo run that never went near a
  // lobby still works -- start() prepares on the spot if nobody did.
  let prepared = null;

  async function prepare() {
    await ready;
    if (!grid) return { ok: false, reason: gridError || 'no beat grid' };
    if (prepared) return prepared;
    const t0 = wallNow();
    // The session clock is snapshotted around the whole staging block and put
    // back afterwards. See stage.clockSnapshot in src/main.js for what breaks
    // without it -- in short, the settle pass is not session time, and the host
    // authoritative timestamp every client aligns to is read off this clock.
    const clockBefore = stage.clockSnapshot ? stage.clockSnapshot() : null;
    const crew = stageCrew();
    const staged = { crew, overflow: stageOverflow(), factory: stageFactory() };
    if (clockBefore !== null && stage.clockRestore) {
      staged.clockDrift = Math.round((stage.clockSnapshot() - clockBefore) * 1000) / 1000;
      stage.clockRestore(clockBefore);
    }
    staged.stageSeconds = Math.round((wallNow() - t0)) / 1000;
    prepared = { ok: true, staged };
    return prepared;
  }

  // Struck without ever having been used -- somebody left the room before the
  // host started. The same teardown the ending runs, so there is one of it.
  function discard() {
    if (!prepared || active) return false;
    prepared = null;
    teardown();
    return true;
  }

  // `elapsed` is how far into the timeline this tab already is. A host passes 0;
  // a client passes (hostClockNow - hostClockAtStart), which is what makes four
  // tabs run ONE timeline instead of four.
  async function start(options) {
    const op = options || {};
    if (active) return { ok: false, reason: 'already running' };
    await ready;
    if (!grid) return { ok: false, reason: gridError || 'no beat grid' };

    const elapsed = Math.max(0, Number(op.elapsed) || 0);
    if (elapsed >= grid.seconds - C.minRemainingSeconds) {
      // Joining with two seconds left is not an intro, it is a flicker.
      return { ok: false, reason: 'too late', elapsed };
    }

    shots = shotList(C).map((s) => ({ ...s, at: barTime(s.bar) }));
    cuts.length = 0;
    for (const k in fired) delete fired[k];
    chuteQueue = [];
    chuteNextAt = 0;
    worstFrameMs = 0;
    worstFrameShot = null;
    overflowCheck = null;
    frames = 0;
    skipped = false;
    shotIndex = -1;
    econBefore = stage.economySnapshot ? stage.economySnapshot() : null;

    // Whatever staging still has to happen happens HERE and is charged to the
    // timeline, because it is real time that has passed since Start. If the
    // waiting room already paid it, this costs nothing and the intro opens on
    // frame one of the music.
    const stageStarted = wallNow();
    const p = await prepare();
    if (!p.ok) return p;
    // Shot 2's contract is absolute: the pile is asleep before the camera
    // rolls. Whatever the waiting room did not get through is finished here.
    const settled = finishSettle();
    const stageSeconds = (wallNow() - stageStarted) / 1000;

    t = elapsed + stageSeconds;
    active = true;
    root.classList.add('on');
    // THE switch. One line in, one line out (finish()), so the ended path and
    // the skipped path cannot diverge -- there is only one of them.
    document.documentElement.classList.add('cinematic');
    applyShot(shotAt(t));
    pose = poseAt(t);
    startMusic(t);
    lastEnd = null;
    return {
      ok: true, elapsed, seconds: grid.seconds,
      staged: p.staged,
      settle: settled,
      lateStageSeconds: Math.round(stageSeconds * 1000) / 1000,
      startedAt: t,
      shots: shots.map((s) => ({ key: s.key, bar: s.bar, at: s.at })),
    };
  }

  // Called from the frame loop, before the camera is written. Returns the pose
  // main.js should hand view.updateCamera(), or null when nothing is running.
  function update(dt, frameMs) {
    if (!active) return null;
    t += dt;
    frames++;
    if (typeof frameMs === 'number' && frameMs > worstFrameMs) {
      worstFrameMs = frameMs;
      worstFrameShot = shots[shotIndex] ? shots[shotIndex].key : null;
    }
    fireEvents();
    pumpChute();
    const idx = shotAt(t);
    if (idx !== shotIndex) applyShot(idx);
    pose = poseAt(t);
    // Every frame, not only during shot 4: the avatar view needs a few samples
    // in its buffer before it will draw anybody, so four players that only
    // start existing at the cut arrive as four empty slots.
    crewPoses(t);
    // The two fades that bracket it, driven off the timeline like everything
    // else so a slow frame cannot leave the screen black.
    const total = grid.seconds;
    const fadeIn = 1 - smoothstep(t / C.fadeSeconds);
    const fadeOut = smoothstep((t - (total - C.fadeSeconds)) / C.fadeSeconds);
    fade.style.opacity = String(Math.max(fadeIn, fadeOut));
    // The skip hint: up over bar 0, held to bar `skipHoldBars`, gone by the bar
    // after that. Addressed by BAR like every other event here, and off screen
    // for the rest of the run -- a hint that sits there for thirty seconds is
    // interface, which is the thing this cutscene is not allowed to have.
    const skipUp = smoothstep(t / Math.max(1e-3, barTime(1)));
    const skipDown = 1 - smoothstep(
      (t - barTime(C.skipHoldBars)) / Math.max(1e-3, barTime(C.skipHoldBars + 1) - barTime(C.skipHoldBars))
    );
    skipLine.style.opacity = String(Math.max(0, Math.min(skipUp, skipDown)));
    // The title card, on the same bar grid as everything else: up over
    // cardFadeBars, held for cardHoldBars, and gone before the next cut. A shot
    // with no copy holds it at zero rather than showing an empty box.
    const shotNow = shots[shotIndex];
    if (shotNow && (shotNow.title || shotNow.eyebrow)) {
      const bar = grid.barSeconds || (grid.seconds / Math.max(1, grid.bars.length));
      const fade = Math.max(1e-3, C.cardFadeBars * bar);
      const since = t - shotNow.at;
      const cardUp = smoothstep(since / fade);
      const cardDown = 1 - smoothstep((since - C.cardHoldBars * bar) / fade);
      card.style.opacity = String(Math.max(0, Math.min(cardUp, cardDown)));
    } else {
      card.style.opacity = '0';
    }
    if (debugHud) {
      const beat = Math.floor(t / grid.beatSeconds);
      beatLine.textContent = 't=' + t.toFixed(3) + '  beat ' + beat
        + '  bar ' + Math.floor(beat / grid.beatsPerBar) + '  shot ' + (pose.shot || '');
    }
    if (t >= total) finish('ended');
    return pose;
  }

  // Teardown. Everything this file made, unmade, and the money the pit paid
  // while the camera rolled put back where it was -- the player starts a fresh
  // session, not a used one.
  function teardown() {
    const report = { placed: 0, props: 0, ducks: 0, avatars: 0, moneyRestored: 0 };
    for (let i = built.placed.length - 1; i >= 0; i--) {
      if (stage.removePlaced && stage.removePlaced(built.placed[i])) report.placed++;
    }
    for (let i = built.props.length - 1; i >= 0; i--) {
      if (stage.removeProp && stage.removeProp(built.props[i])) report.props++;
    }
    // Every live duck, not only the ones this file spawned: a press placed for
    // shot 3 makes its own, and a duck the cutscene caused is a duck the
    // cutscene has to take away.
    if (stage.releaseAllDucks) report.ducks = stage.releaseAllDucks();
    if (built.avatars && stage.clearAvatars) { stage.clearAvatars(); report.avatars = 1; }
    if (econBefore && stage.economyRestore) {
      const now = stage.economySnapshot();
      report.moneyRestored = now.money - econBefore.money;
      report.earnedRestored = now.earned - econBefore.earned;
      stage.economyRestore(econBefore);
    }
    built.placed.length = 0;
    built.props.length = 0;
    built.ducks.length = 0;
    built.avatars = false;
    chuteQueue = [];
    prepared = null;
    settle = null;
    return report;
  }

  function finish(reason) {
    if (!active) return null;
    active = false;
    stopMusic();
    root.classList.remove('on');
    document.documentElement.classList.remove('cinematic');
    fade.style.opacity = '0';
    skipLine.style.opacity = '0';
    card.style.opacity = '0';
    const torn = teardown();
    lastEnd = {
      reason, at: t, frames, worstFrameMs: Math.round(worstFrameMs * 100) / 100,
      worstFrameShot, overflowCheck, cuts: cuts.slice(), teardown: torn,
      music: musicState,
      // What the economy was before the camera rolled, handed out so the caller
      // can re-assert it on the audit frame. The pit can pay out in the frame
      // BETWEEN finish() and the audit -- measured at $2 on the host of a live
      // two-tab room -- and a teardown that is only correct for one frame is
      // not a teardown.
      econBefore: econBefore ? { ...econBefore } : null,
    };
    pose = null;
    onDone(lastEnd);
    return lastEnd;
  }

  // Per player, and per player only. This tab stops watching; nobody else's
  // timeline is touched, because nothing about a skip is ever sent.
  function skip() {
    if (!active) return false;
    skipped = true;
    finish('skipped');
    return true;
  }

  function onKey(e) {
    if (!active) return;
    if (e.key === 'Escape' || e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      skip();
    }
  }
  // Capture phase: the cutscene is in front of everything, so it sees Escape
  // before the menu's handler can open a menu behind it.
  window.addEventListener('keydown', onKey, true);

  return {
    root,
    ready,
    prepare,
    // Called once a frame by src/main.js while a room is waiting. A no-op once
    // the pile is asleep, and a no-op when nothing has been prepared.
    pumpPrepare() {
      if (active || !settle || settle.done) return null;
      return pumpSettle(Math.round(C.settleStepsPerFrame));
    },
    settleState: () => settle,
    discard,
    isPrepared: () => !!prepared,
    start,
    update,
    skip,
    finish,
    // Put the economy back exactly where it was, again. Idempotent, and it
    // exists because the pit can score in the single frame BETWEEN the teardown
    // and the audit -- measured at $2 on the host of a live two-tab room. A
    // teardown that is only correct for one frame is not a teardown.
    restoreEconomy() {
      if (!econBefore || !stage.economyRestore) return null;
      const now = stage.economySnapshot();
      const delta = { money: now.money - econBefore.money, earned: now.earned - econBefore.earned };
      if (delta.money || delta.earned) stage.economyRestore(econBefore);
      return delta;
    },
    isActive: () => active,
    pose: () => pose,
    grid: () => (grid ? { ...grid, beats: grid.beats.slice(), bars: grid.bars.slice() } : null),
    barTime,
    setDebugHud(v) { debugHud = !!v; root.classList.toggle('debug', debugHud); return debugHud; },
    lastEnd: () => lastEnd,
    state: () => ({
      active,
      t: Math.round(t * 1000) / 1000,
      seconds: grid ? grid.seconds : null,
      shot: shots[shotIndex] ? shots[shotIndex].key : null,
      shotIndex,
      // What the film is actually saying right now, read off the DOM rather
      // than off the shot list: a card that is written but never faded in is
      // exactly the defect this was added to fix.
      card: {
        eyebrow: cardEyebrow.textContent,
        title: cardTitle.textContent,
        opacity: Number(card.style.opacity || 0),
      },
      skipped,
      frames,
      worstFrameMs: Math.round(worstFrameMs * 100) / 100,
      worstFrameShot,
      overflowCheck,
      music: musicState,
      musicBytes: musicBytes ? musicBytes.byteLength : 0,
      gridLoaded: !!grid,
      gridError,
      prepared: !!prepared,
      settle: settle && { steps: settle.steps, done: settle.done, settled: settle.settled,
        live: settle.live, sleeping: settle.sleeping },
      stageSeconds: prepared && prepared.staged ? prepared.staged.stageSeconds : null,
      cuts: cuts.slice(),
      built: {
        placed: built.placed.length, props: built.props.length,
        ducks: built.ducks.length, avatars: built.avatars,
      },
    }),
    dispose() {
      window.removeEventListener('keydown', onKey, true);
      if (active) finish('disposed');
      if (root.parentNode) root.parentNode.removeChild(root);
      if (style.parentNode) style.parentNode.removeChild(style);
    },
  };
}

export default createCutscene;
