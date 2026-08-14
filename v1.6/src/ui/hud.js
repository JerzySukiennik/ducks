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

const STEPS = [
  { id: 'walk', text: 'Walk to the workbench and crank out a duck' },
  { id: 'grab', text: 'Hold left click to carry a duck' },
  { id: 'score', text: 'Let go over the pit' },
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
  const cross = el('div', 'hud-cross', root, '<i></i><i></i><i></i><i></i>');
  const prompt = el('div', 'hud-prompt', root, '');
  const step = el('div', 'hud-step', root, STEPS[0].text);
  // The fifteen key prompts that used to sit along the bottom are NOT here any
  // more: they live in the menu's Controls panel. Fifteen glyph groups are a
  // reference table, and a reference table is something you consult once, not
  // something that belongs in front of the game forever. The table itself
  // (KEY_PROMPTS in src/ui/keybar.js) is unchanged and still the audited one.
  const cap = el('div', 'hud-cap', root, '');

  float.style.setProperty('--hud-float-ms', config.hud.floatMs + 'ms');

  let shown = 0;              // index of the visible onboarding step
  const doneSteps = { walk: false, grab: false, score: false };
  let bumpTimer = 0;
  let capTimer = 0;
  let lastMoney = null;

  function renderStep() {
    if (shown >= STEPS.length) {
      step.style.display = 'none';
      return;
    }
    step.style.display = 'block';
    step.textContent = STEPS[shown].text;
  }

  // Exactly one hint is on screen at a time, and it only advances when the
  // player has actually done the thing it asked for.
  function completeStep(id) {
    if (doneSteps[id]) return false;
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
  function setPrompt(label, percent, bad) {
    if (!label) {
      prompt.classList.remove('show');
      prompt.classList.remove('bad');
      cross.classList.remove('use');
      cross.classList.remove('warn');
      return;
    }
    prompt.innerHTML = percent === undefined || percent === null
      ? label
      : label + ' <b>' + Math.round(percent) + '%</b>';
    prompt.classList.add('show');
    prompt.classList.toggle('bad', !!bad);
    cross.classList.toggle('use', !bad);
    cross.classList.toggle('warn', !!bad);
  }

  return {
    root,
    setMoney,
    showCap,
    setHolding,
    setPrompt,
    completeStep,
    promptText: () => (prompt.classList.contains('show') ? prompt.textContent : ''),
    promptVisible: () => prompt.classList.contains('show'),
    stepIndex: () => shown,
    stepText: () => (shown < STEPS.length ? STEPS[shown].text : ''),
    stepsDone: () => ({ ...doneSteps }),
    capVisible: () => cap.classList.contains('show'),
    moneyText: () => moneyVal.textContent,
    keyBar: null,
    dispose() {
      clearTimeout(bumpTimer);
      clearTimeout(capTimer);
      if (root.parentNode) root.parentNode.removeChild(root);
      if (style.parentNode) style.parentNode.removeChild(style);
    },
  };
}

export default createHUD;
