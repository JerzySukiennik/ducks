// Player-facing HUD: money, crosshair, onboarding, cap message. All DOM -- it
// costs no draw calls and stays sharp while the game itself renders into a
// 480-pixel backbuffer.

import config from '../config.js';
import CRT, { injectCRT } from './theme.js';

// Colour, type and timing come from the CRT system in src/ui/theme.js and
// nowhere else. Numbers stay in the theme's DATA face, not its bitmap display
// face -- that is the theme's own rule about columns of digits, and the money
// counter is the biggest column of digits in the game.
const CSS = `
#hud { position: fixed; inset: 0; z-index: 12; pointer-events: none;
  font: ${CRT.type.dataRow.size}/${CRT.type.dataRow.line} ${CRT.data};
  color: ${CRT.on}; text-shadow: 0 2px 0 rgba(0,0,0,0.55); }
#hud-money { position: absolute; top: 14px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: baseline; gap: 4px;
  font: 700 42px/1 ${CRT.data};
  color: ${CRT.bright}; letter-spacing: 0.02em;
  text-shadow: ${CRT.glowTitle}, 0 3px 0 rgba(0,0,0,0.6);
  transition: transform ${CRT.fast} ${CRT.ease}; transform-origin: 50% 0%; }
#hud-money.bump { transform: translateX(-50%) scale(1.16); }
#hud-money .cur { font-size: 26px; color: ${CRT.dim}; }
/* THE CONTRACT BANNER. Big, red, and across the top -- it is the only thing in
   this game that is on a clock the player did not start, so it is the only
   thing allowed to shout. It sits above the money and below nothing. */
/* THE WEATHER READOUT. Small, top-right, always there. The sky already changes
   -- the light drops, the fog closes in -- but a player who walks into a
   darker yard has no way to tell weather from dusk, and 'is it night or is it
   raining' is not a question the game should be asking them. */
#hud-weather { position: absolute; top: 10px; right: 12px; z-index: 12;
  font: 700 12px/1.35 "PublicPixel", "VT323", ui-monospace, SFMono-Regular, Menlo, monospace;
  color: rgba(232,238,255,0.75); text-align: right;
  text-shadow: 0 2px 0 rgba(0,0,0,0.65); pointer-events: none; }
#hud-weather .w { color: #ffe9a8; }
#hud-weather .t { opacity: 0.7; }
/* The screen itself gets wet. One element, one colour, one opacity -- a
   particle system for rain would cost more than the whole weather feature is
   worth, and a tint plus a vignette is what a player actually reads as 'it is
   raining' at this resolution. */
#hud-sky { position: absolute; inset: 0; z-index: 3; pointer-events: none;
  opacity: 0; transition: opacity 1.2s linear; }
#hud-contract { position: absolute; top: 0; left: 0; right: 0; z-index: 14;
  display: none; text-align: center; padding: 10px 12px 12px;
  background: linear-gradient(180deg, rgba(120,10,18,0.92) 0%, rgba(120,10,18,0.0) 100%);
  pointer-events: none; }
#hud-contract.show { display: block; }
#hud-contract .title { font: 800 26px/1.05 "PublicPixel", "VT323", ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #ff5a5a; letter-spacing: 0.06em; text-shadow: 0 2px 0 rgba(0,0,0,0.7); }
#hud-contract .body { margin-top: 3px;
  font: 700 14px/1.25 "PublicPixel", "VT323", ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #ffd7d7; text-shadow: 0 2px 0 rgba(0,0,0,0.7); }
#hud-contract .bar { margin: 6px auto 0; width: min(420px, 60vw); height: 7px;
  background: rgba(0,0,0,0.45); border: 1px solid rgba(255,90,90,0.5); }
#hud-contract .bar i { display: block; height: 100%; background: #ff5a5a; width: 0%; }
#hud-contract.urgent .title { animation: hud-flash 0.5s steps(2) infinite; }
#hud-contract.done .title { color: #7fe08a; }
#hud-contract.done { background: linear-gradient(180deg, rgba(16,90,40,0.92) 0%, rgba(16,90,40,0.0) 100%); }
@keyframes hud-flash { 0% { opacity: 1; } 100% { opacity: 0.35; } }
#hud-float { position: absolute; top: 62px; left: 50%; transform: translateX(-50%);
  font: 700 20px/1 ${CRT.data}; color: ${CRT.ok}; opacity: 0;
  text-shadow: 0 2px 0 rgba(0,0,0,0.6); }
#hud-float.show { animation: hud-rise var(--hud-float-ms, 900ms) ${CRT.ease} 1; }
@keyframes hud-rise {
  0% { opacity: 0; transform: translateX(-50%) translateY(10px); }
  18% { opacity: 1; }
  100% { opacity: 0; transform: translateX(-50%) translateY(-26px); }
}
#hud-cross { position: absolute; left: 50%; top: 50%; width: 14px; height: 14px;
  margin: -7px 0 0 -7px; opacity: 0.75; }
#hud-cross i { position: absolute; background: #ffffff; box-shadow: 0 0 2px rgba(0,0,0,0.9); }
#hud-cross i:nth-child(1) { left: 6px; top: 0; width: 2px; height: 4px; }
#hud-cross i:nth-child(2) { left: 6px; bottom: 0; width: 2px; height: 4px; }
#hud-cross i:nth-child(3) { top: 6px; left: 0; height: 2px; width: 4px; }
#hud-cross i:nth-child(4) { top: 6px; right: 0; height: 2px; width: 4px; }
#hud-cross.hold { opacity: 1; }
#hud-cross.hold i { background: ${CRT.bright}; }
#hud-cross.use i { background: ${CRT.ok}; }
#hud-cross.warn i { background: ${CRT.bad}; }
/* The crosshair prompt. Since the status strip went away this is also where a
   refused placement and a demolish hold say their piece, so it has a second,
   louder state -- same box, refusal colours, because a refusal is not a different
   kind of message, it is the same message going wrong. */
#hud-prompt { position: absolute; left: 50%; top: 50%; margin-top: 18px;
  transform: translateX(-50%); display: none; white-space: nowrap;
  padding: 4px 10px; background: ${CRT.bgPanel};
  border: ${CRT.hairline} solid ${CRT.ok}; color: ${CRT.on};
  font: 700 ${CRT.type.dataRow.size}/1.2 ${CRT.data}; }
#hud-prompt.show { display: block; }
#hud-prompt.bad { border-color: ${CRT.bad}; color: ${CRT.bad}; }
#hud-prompt b { color: ${CRT.bright}; font-weight: 800; }
/* The crank fill bar. CENTRED ON THE CROSSHAIR -- not above it -- because that
   is where the eye already is while you hold the wheel, and it carries NO
   number: the playtest verdict was that a percentage is something you read and
   a bar is something you feel, and only one of those belongs in the middle of a
   five-second hold. Green fill, and a white flash on the frame a duck pops so
   the reset reads as an event rather than as the bar mysteriously emptying.
   Sized in one place: change --hud-crank-w/h and everything follows. */
#hud-crank { position: absolute; left: 50%; top: 50%;
  --hud-crank-w: 340px; --hud-crank-h: 22px;
  width: var(--hud-crank-w); height: var(--hud-crank-h);
  margin: calc(var(--hud-crank-h) / -2) 0 0 calc(var(--hud-crank-w) / -2);
  display: none; z-index: 1;
  background: rgba(0,0,0,0.42); border: ${CRT.hairline} solid ${CRT.border}; }
#hud-crank.show { display: block; }
#hud-crank i { display: block; height: 100%; width: 0%; background: ${CRT.ok};
  box-shadow: 0 0 10px ${CRT.ok}; transition: width 60ms linear; }
#hud-crank.pop { border-color: ${CRT.bright}; }
#hud-crank.pop i { background: ${CRT.bright}; box-shadow: 0 0 18px ${CRT.bright};
  transition: none; }
/* The crosshair rides ON TOP of the bar it now sits inside, or the bar would
   swallow the one thing telling the player where they are pointing. */
#hud-cross { z-index: 2; }
#hud-step { position: absolute; bottom: 126px; left: 50%; transform: translateX(-50%);
  padding: 7px 14px; background: ${CRT.bgPanel};
  border: ${CRT.hairline} solid ${CRT.border}; color: ${CRT.bright};
  text-shadow: ${CRT.glowSoft};
  font: 600 14px/1.2 ${CRT.data}; white-space: nowrap; }
#hud-step.done { opacity: 0; transition: opacity ${CRT.normal} ${CRT.ease}; }
#hud-cap { position: absolute; top: 78px; left: 50%; transform: translateX(-50%);
  padding: 8px 14px; background: ${CRT.bgPanel};
  border: ${CRT.hairline} solid ${CRT.bad}; color: ${CRT.bad};
  font: 600 ${CRT.type.dataRow.size}/1.3 ${CRT.data}; display: none; white-space: nowrap; }
#hud-cap.show { display: block; }
`;

// THE WHOLE LOOP, one line at a time. It used to stop after three steps -- make,
// carry, drop -- and then hide itself forever, which left the player having done
// the manual half of the game and never told that the pit PAYS, that there is a
// shop, or that money buys machines that do the carrying for you. That is the
// other 60% of the loop this game is about, and it was never mentioned. The
// last two steps below are that 60%.
//
// Each step names a fact the next step depends on, and every one of them has a
// trigger that already existed in src/main.js (updateOnboarding, and the shop's
// purchase notification) -- nothing here needs a new event.
//
// Order matters, skipping does not: completeStep() marks a step done whenever
// its trigger fires, so a player who scores before being asked, or who buys
// something on their way past the booth, is never told to do what they have
// already done.
// There is deliberately no separate "the pit paid you" step. The pit pays in the
// same frame the duck lands, so a step waiting on the money would complete
// before it could ever be read -- MEASURED: it advanced in the same batch as
// `score`. The fact belongs on the step that causes it instead, which is why
// the `score` step says what the drop is FOR rather than only what to do.
//
// `input` NAMES THE BUTTON THE STEP IS ASKING FOR, and it is the whole fix for
// the defect where standing at the wheel put "Hold left click to carry a duck"
// (this list) and "Hold left click to crank" (the crosshair prompt) on screen at
// the same time -- two orders for one button, three centimetres apart. The
// crosshair prompt is CONTEXTUAL and always right about what the button will do
// right now; this list is a plan. So the plan yields: setPromptInput() tells the
// HUD which button the prompt has claimed, and a step asking for that same
// button hides itself while it is claimed. Never the other way round, and never
// by hiding both -- exactly one instruction for a given input is on screen.
//
// The first step used to be "Walk to the workbench and crank out a duck" and it
// completed on ARRIVING, so it ticked itself off having taught half of what it
// said. One step, one verb, one trigger: walking is `walk`, cranking is `crank`.
//
// The list ends at `place`, not at `buy`. The purchase is not the end of the
// loop the tutorial exists to teach -- a bought machine arrives through the
// chute, goes into the hotbar and does nothing at all until it is put on the
// ground, which was the one thing the player was never told.
const STEPS = [
  { id: 'walk', input: null, text: 'Walk to the workbench at the far end of the plate' },
  { id: 'crank', input: 'lmb', text: 'Hold left click on the wheel until a duck pops out' },
  { id: 'grab', input: 'lmb', text: 'Hold left click on a duck to carry it' },
  { id: 'score', input: 'lmb', text: 'Let go over the pit - every duck in it pays you' },
  { id: 'shop', input: 'e', text: 'Money buys machines. Press E at the booth under the chute' },
  { id: 'buy', input: null, text: 'Buy a machine: it makes ducks without you, and that is the whole game' },
  { id: 'place', input: 'lmb', text: 'It lands in the hotbar: press its number, R turns it, left click puts it down' },
];

function el(tag, id, parent, html) {
  const n = document.createElement(tag);
  if (id) n.id = id;
  if (html !== undefined) n.innerHTML = html;
  if (parent) parent.appendChild(n);
  return n;
}

export function createHUD(container) {
  injectCRT(document);
  const style = document.createElement('style');
  style.id = 'hud-style';
  style.textContent = CSS;
  document.head.appendChild(style);

  // index.html ships a static controls line; the HUD owns that space now.
  const legacyHint = document.getElementById('hint');
  if (legacyHint) legacyHint.style.display = 'none';

  const root = el('div', 'hud', container || document.body);
  const money = el('div', 'hud-money', root);
  const moneyCur = el('span', null, money, '$');
  moneyCur.className = 'cur';
  const moneyVal = el('span', null, money, '0');
  const float = el('div', 'hud-float', root, '');
  const skyTint = el('div', 'hud-sky', root, '');
  const weather = el('div', 'hud-weather', root, '');
  const contract = el('div', 'hud-contract', root, '');
  contract.innerHTML = '<div class="title"></div><div class="body"></div><div class="bar"><i></i></div>';
  const contractTitle = contract.querySelector('.title');
  const contractBody = contract.querySelector('.body');
  const contractBar = contract.querySelector('.bar i');
  let contractJob = null;
  const cross = el('div', 'hud-cross', root, '<i></i><i></i><i></i><i></i>');
  const prompt = el('div', 'hud-prompt', root, '');
  const crank = el('div', 'hud-crank', root, '<i></i>');
  const crankFill = crank.firstChild;
  const step = el('div', 'hud-step', root, STEPS[0].text);
  // The key prompts that used to sit along the bottom are NOT here any more:
  // they live in the menu's Controls panel. A reference table is something you
  // consult once, not something that belongs in front of the game forever. That
  // table (KEY_ROWS in src/ui/controls.js) is now the only one in the game --
  // src/ui/keybar.js held a second copy, drawn nowhere and already out of date,
  // and has been deleted.
  const cap = el('div', 'hud-cap', root, '');

  float.style.setProperty('--hud-float-ms', config.hud.floatMs + 'ms');

  let shown = 0;              // index of the visible onboarding step
  // Derived from STEPS, never a second hand-written list: a step added above
  // with no entry here would silently never complete.
  const doneSteps = {};
  STEPS.forEach((s) => { doneSteps[s.id] = false; });
  let bumpTimer = 0;
  let capTimer = 0;
  let lastMoney = null;

  // Which input the crosshair prompt has claimed this frame, or null. Written
  // by setPrompt() from the caller's own description of the prompt, never
  // guessed by matching on the prompt's words.
  let promptInput = null;

  function renderStep() {
    if (shown >= STEPS.length) {
      step.style.display = 'none';
      return;
    }
    const s = STEPS[shown];
    // The yield rule. A step asking for the same button the contextual prompt
    // is currently talking about goes away until the prompt does: the prompt is
    // right about NOW, the step is only right in general, and two instructions
    // for one button is the contradiction this exists to make impossible.
    if (s.input && promptInput && s.input === promptInput) {
      step.style.display = 'none';
      return;
    }
    step.style.display = 'block';
    step.textContent = s.text;
  }

  // Called every frame from setPrompt(). Cheap: it only re-renders when the
  // claim actually changed.
  function setPromptInput(input) {
    const next = input || null;
    if (next === promptInput) return promptInput;
    promptInput = next;
    renderStep();
    return promptInput;
  }

  // Exactly one hint is on screen at a time, and it only advances when the
  // player has actually done the thing it asked for.
  function completeStep(id) {
    if (!(id in doneSteps) || doneSteps[id]) return false;
    doneSteps[id] = true;
    // A player who does step 3 first has not been failed by the tutorial; the
    // hint skips ahead rather than asking for something already done.
    const before = shown;
    while (shown < STEPS.length && doneSteps[STEPS[shown].id]) shown++;
    if (shown !== before) renderStep();
    return shown !== before;
  }

  function setMoney(value) {
    if (value === lastMoney) return;
    const first = lastMoney === null;
    const delta = first ? 0 : value - lastMoney;
    lastMoney = value;
    moneyVal.textContent = Math.round(value).toLocaleString('en-US');
    if (first || delta === 0) return;
    money.classList.add('bump');
    clearTimeout(bumpTimer);
    bumpTimer = setTimeout(() => money.classList.remove('bump'), config.hud.moneyPulseMs);
    float.textContent = (delta > 0 ? '+' : '') + Math.round(delta).toLocaleString('en-US');
    float.classList.remove('show');
    void float.offsetWidth; // restart the animation
    float.classList.add('show');
  }

  function showCap(message) {
    cap.textContent = message;
    cap.classList.add('show');
    clearTimeout(capTimer);
    capTimer = setTimeout(() => cap.classList.remove('show'), config.hud.capMessageMs);
  }

  function setHolding(v) {
    cross.classList.toggle('hold', !!v);
  }

  // Shown only while the crosshair is on something usable. `percent` is the
  // crank's progress through the current turn, so the player can see how close
  // the next duck is without looking away from the wheel.
  // `bad` is the refusal state: the same box, said in red, with the crosshair
  // matching it instead of going green. Without it a refused placement lit the
  // crosshair as if the click were about to work.
  // `input` is the button this prompt is about ('lmb', 'e', ...), and it is what
  // lets the onboarding line stand down rather than argue with it. A prompt with
  // no input named claims nothing and the step keeps talking.
  function setPrompt(label, percent, bad, input) {
    if (!label) {
      setPromptInput(null);
      prompt.classList.remove('show');
      prompt.classList.remove('bad');
      cross.classList.remove('use');
      cross.classList.remove('warn');
      return;
    }
    setPromptInput(input);
    prompt.innerHTML = percent === undefined || percent === null
      ? label
      : label + ' <b>' + Math.round(percent) + '%</b>';
    prompt.classList.add('show');
    prompt.classList.toggle('bad', !!bad);
    cross.classList.toggle('use', !bad);
    cross.classList.toggle('warn', !!bad);
  }

  // The crank's fill, 0..100, or null to hide it. Called every frame while the
  // crosshair is on a wheel or this player is holding one, so it must stay
  // cheap: two writes and only when the rounded value actually changed.
  let lastCrank = null;
  let popTimer = 0;
  function setCrank(percent) {
    if (percent === null || percent === undefined) {
      if (lastCrank === null) return;
      lastCrank = null;
      crank.classList.remove('show');
      crank.classList.remove('pop');
      return;
    }
    const p = Math.max(0, Math.min(100, Math.round(percent)));
    crank.classList.add('show');
    if (p === lastCrank) return;
    // A big drop is a duck leaving the pipe, not a drain: flash for it.
    if (lastCrank !== null && p < lastCrank - 30) {
      crank.classList.add('pop');
      clearTimeout(popTimer);
      popTimer = setTimeout(() => crank.classList.remove('pop'), config.hud.moneyPulseMs);
    }
    lastCrank = p;
    crankFill.style.width = p + '%';
  }

  // THE CONTRACT BANNER. `job` null with a result string ends it; null with no
  // result simply hides it. Everything shown is read off the job rather than
  // accumulated here, so the banner cannot disagree with the lorry.
  function setContract(job, result) {
    contractJob = job || null;
    if (!job) {
      if (result) {
        contract.classList.toggle('done', result === 'done');
        contract.classList.remove('urgent');
        contractTitle.textContent = result === 'done' ? 'ORDER COMPLETE' : 'ORDER LOST';
        contractBody.textContent = result === 'done'
          ? 'The lorry is leaving loaded.' : 'The lorry left without it.';
        contractBar.style.width = result === 'done' ? '100%' : '0%';
        contract.classList.add('show');
        setTimeout(() => contract.classList.remove('show'), config.hud.contractEndMs);
        return;
      }
      contract.classList.remove('show');
      return;
    }
    contract.classList.remove('done');
    contractTitle.textContent = 'ORDER: ' + job.count + ' DUCKS';
    renderContract();
    contract.classList.add('show');
  }

  // Called every frame with the LIVE job. It used to take nothing and re-render
  // `contractJob`, which was the snapshot handed over when the order started --
  // so the clock on the banner sat at its opening value until a duck went in,
  // and a player watching it had no idea the lorry was about to leave.
  function renderContract(live) {
    if (live) contractJob = live;
    const job = contractJob;
    if (!job) return;
    const t = Math.max(0, job.remaining);
    const mm = Math.floor(t / 60);
    const ss = Math.floor(t % 60);
    contractBody.textContent = job.delivered + ' / ' + job.count
      + '  worth ' + job.minValue.toLocaleString('en-US') + ' or more'
      + '  -  lorry leaves in ' + mm + ':' + String(ss).padStart(2, '0');
    contractBar.style.width = ((job.delivered / job.count) * 100).toFixed(1) + '%';
    contract.classList.toggle('urgent', t <= config.hud.contractUrgentSeconds);
  }

  // A WORLD EVENT borrows the contract banner. There is one place on this
  // screen that means 'something is happening that you did not start', and two
  // would teach the player to read neither. It shows a name, a line and a bar
  // that empties, and a contract starting while one runs simply takes it over.
  let eventUntil = 0;
  let eventTotal = 0;
  function setEvent(name, line, seconds) {
    if (!name) {
      eventUntil = 0;
      if (!contractJob) contract.classList.remove('show');
      return;
    }
    eventTotal = Math.max(0.001, seconds || 0);
    eventUntil = (performance.now() / 1000) + eventTotal;
    contract.classList.remove('done');
    contractTitle.textContent = name.toUpperCase();
    contractBody.textContent = line || '';
    contractBar.style.width = '100%';
    contract.classList.add('show');
  }

  function tickEvent() {
    if (!eventUntil || contractJob) return;
    const left = eventUntil - (performance.now() / 1000);
    if (left <= 0) { setEvent(null); return; }
    contractBar.style.width = ((left / eventTotal) * 100).toFixed(1) + '%';
    contract.classList.toggle('urgent', left <= config.hud.contractUrgentSeconds);
  }

  // WHAT THE SKY IS DOING, in the corner and over the whole screen. `sky` is
  // the world clock's own report; nothing is computed here beyond turning it
  // into words and a tint.
  let lastWeather = null;
  function setSky(sky) {
    if (!sky) return;
    const hh = String(sky.hour).padStart(2, '0');
    const mm = String(sky.minute).padStart(2, '0');
    weather.innerHTML = '<span class="w">' + sky.weatherName + '</span> <span class="t">' + hh + ':' + mm + '</span>';
    if (sky.weather === lastWeather) return;
    lastWeather = sky.weather;
    // Rain is a cold wash, fog is a pale one, a storm is both and heavier.
    const look = {
      clear: ['transparent', 0],
      breeze: ['transparent', 0],
      rain: ['radial-gradient(circle at 50% 40%, rgba(80,120,180,0.10), rgba(30,50,90,0.34))', 1],
      storm: ['radial-gradient(circle at 50% 40%, rgba(50,70,120,0.16), rgba(12,20,44,0.52))', 1],
      fog: ['radial-gradient(circle at 50% 45%, rgba(200,206,220,0.16), rgba(150,158,176,0.42))', 1],
    }[sky.weather] || ['transparent', 0];
    skyTint.style.background = look[0];
    skyTint.style.opacity = String(look[1]);
  }

  return {
    setSky,
    setEvent,
    tickEvent,
    setContract,
    tickContract: renderContract,
    root,
    setMoney,
    showCap,
    setHolding,
    setPrompt,
    setCrank,
    crankPercent: () => lastCrank,
    crankVisible: () => crank.classList.contains('show'),
    completeStep,
    promptText: () => (prompt.classList.contains('show') ? prompt.textContent : ''),
    promptVisible: () => prompt.classList.contains('show'),
    promptInput: () => promptInput,
    stepIndex: () => shown,
    // What is ACTUALLY on screen, which is not the same question as which step
    // is current: a step that has yielded the button to the prompt is still the
    // current step and is showing nothing. The verification surface asks this
    // one when it wants to count the instructions a player can read.
    stepVisible: () => step.style.display !== 'none' && shown < STEPS.length,
    stepText: () => (shown < STEPS.length ? STEPS[shown].text : ''),
    stepsDone: () => ({ ...doneSteps }),
    stepInputs: () => STEPS.map((s) => ({ id: s.id, input: s.input || null })),
    capVisible: () => cap.classList.contains('show'),
    moneyText: () => moneyVal.textContent,
    dispose() {
      clearTimeout(bumpTimer);
      clearTimeout(capTimer);
      clearTimeout(popTimer);
      if (root.parentNode) root.parentNode.removeChild(root);
      if (style.parentNode) style.parentNode.removeChild(style);
    },
  };
}

export default createHUD;
