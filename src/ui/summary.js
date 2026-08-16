// The end-of-session screen.
//
// A session has no save. It ends when the host presses "End session", or when
// the host's tab closes and the room evaporates. Everyone then sees THE SAME
// screen with THE SAME numbers -- the host's, broadcast -- because a co-op
// session where two people read different totals is a session nobody trusts.
//
// The register is flat on purpose: these are counts of things that happened.
// Nothing here congratulates anybody or pretends the game is about anything
// except throwing ducks into a hole.

import config from '../config.js';
import CRT, { injectCRT } from './theme.js';

const CSS = `
/* THE GAME'S CHROME COMES OFF WHEN THE SESSION IS OVER.
   The panel used to open over a live HUD: the money counter, the hotbar and --
   worst of it -- the onboarding line, so a player reading "Session over" also
   had a tutorial underneath telling them to walk to the workbench. The session
   has ended; there is nothing left to instruct. This is the same device
   src/cutscene.js uses for the intro (a class on the root element rather than
   panel-by-panel hiding), for the same reason: a screen that has to be told
   about every new panel will be wrong the first time somebody adds one.
   Named elements only, not a blanket, because the summary itself and the menu
   Escape can still reach have to survive. */
html.session-over #hud,
html.session-over #bar { display: none !important; }
#summary { position: fixed; inset: 0; z-index: 30; display: none;
  align-items: center; justify-content: center; pointer-events: none;
  font: 400 ${CRT.type.body.size}/${CRT.type.body.line} ${CRT.display};
  letter-spacing: ${CRT.type.body.track}; color: ${CRT.on}; }
#summary.open { display: flex; }
#summary button { font: inherit; color: inherit; letter-spacing: inherit; }
#summary button:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
#summary-scrim { position: absolute; inset: 0; background: ${CRT.scrim}; }
#summary-panel { position: relative; width: min(640px, 92vw); max-height: 88vh;
  display: flex; flex-direction: column; pointer-events: auto;
  background: ${CRT.bgRaised}; border: ${CRT.hairline} solid ${CRT.border};
  animation: ${CRT.powerOn}; }
#summary-head { padding: 14px 18px; border-bottom: ${CRT.hairline} solid ${CRT.border}; }
#summary-title { font-size: ${CRT.type.heading.size}; line-height: ${CRT.type.heading.line};
  letter-spacing: ${CRT.type.heading.track}; text-transform: uppercase;
  color: ${CRT.bright}; text-shadow: ${CRT.glowSoft}; }
#summary-reason { margin-top: 6px; color: ${CRT.dim}; }
#summary-body { overflow-y: auto; }
.sum-sec { padding: 12px 18px; border-bottom: ${CRT.hairline} solid ${CRT.border}; }
.sum-sec h4 { margin: 0 0 8px; font-weight: 400;
  font-size: ${CRT.type.label.size}; line-height: ${CRT.type.label.line};
  letter-spacing: ${CRT.type.label.track}; text-transform: uppercase; color: ${CRT.dim}; }
.sum-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px; }
/* The totals are the one place a display size is doing real work, so they stay
   in the bitmap face at the title end of the ramp. */
.sum-stat .v { font-size: 34px; line-height: 1; letter-spacing: ${CRT.type.title.track};
  color: ${CRT.bright}; text-shadow: ${CRT.glowSoft}; }
.sum-stat .v.plain { color: ${CRT.on}; text-shadow: none; }
/* A rarity reads "Tier 5 (x100)", which does not fit at 34px in a 140px cell.
   It is the same statistic, so it keeps the same slot and drops a size rather
   than wrapping onto two lines and pushing the row below it out of line. */
.sum-stat .v.small { font-size: ${CRT.type.nav.size}; line-height: 1.15;
  letter-spacing: ${CRT.type.nav.track}; }
.sum-stat .k { margin-top: 3px; font-size: ${CRT.type.label.size};
  letter-spacing: ${CRT.type.label.track}; text-transform: uppercase; color: ${CRT.dim}; }
.sum-row { display: flex; justify-content: space-between; gap: 12px;
  padding: 4px 0; border-bottom: ${CRT.hairline} solid ${CRT.border}; }
.sum-row:last-child { border-bottom: 0; }
.sum-row .n { color: ${CRT.on}; }
.sum-row .c { color: ${CRT.bright}; font-family: ${CRT.data};
  font-size: ${CRT.type.dataRow.size}; letter-spacing: ${CRT.type.dataRow.track}; }
.sum-none { color: ${CRT.faint}; }
#summary-players { display: flex; flex-wrap: wrap; gap: 8px; }
.sum-player { padding: 3px 9px; border: ${CRT.hairline} solid ${CRT.border};
  color: ${CRT.bright}; }
.sum-player .sl { color: ${CRT.dim}; }
#summary-foot { display: flex; align-items: center; justify-content: space-between;
  gap: 12px; padding: 11px 18px; border-top: ${CRT.hairline} solid ${CRT.border}; }
#summary-note { color: ${CRT.dim}; font-family: ${CRT.data};
  font-size: ${CRT.type.dataSm.size}; letter-spacing: ${CRT.type.dataSm.track}; }
#summary-close { appearance: none; cursor: pointer; min-width: 120px; padding: 8px 14px;
  background: ${CRT.bgPanel}; border: ${CRT.hairline} solid ${CRT.borderHot};
  color: ${CRT.bright}; font-size: ${CRT.type.nav.size}; line-height: 1;
  letter-spacing: ${CRT.type.nav.track};
  transition: color ${CRT.fast} ${CRT.ease}, text-shadow ${CRT.fast} ${CRT.ease}; }
#summary-close:hover, #summary-close:focus-visible { color: ${CRT.hot};
  text-shadow: ${CRT.glowText}; }
@media (prefers-reduced-motion: reduce) {
  #summary-panel { animation: none; }
  #summary * { transition: none !important; }
}
`;

function el(tag, cls, parent, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}

function num(n) {
  return Math.round(Number(n) || 0).toLocaleString('en-US');
}

function duration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + 'm ' + (r < 10 ? '0' : '') + r + 's';
}

// A rarity tier has no name in this game and inventing one would be narration.
// It is a number and a multiplier, which is exactly what it does.
export function tierLabel(tier) {
  const mults = config.rarity.multipliers;
  const t = Math.max(0, Math.min(mults.length - 1, Math.round(Number(tier) || 0)));
  return 'Tier ' + (t + 1) + ' (x' + mults[t] + ')';
}

// Collects the numbers the screen shows from the live game objects. Kept next
// to the screen that reads them so the two cannot drift, and deliberately not a
// running total kept somewhere else: everything here is asked for at the end.
export function createSessionStats(deps) {
  const d = deps || {};
  let rarestTier = -1;
  let rarestCount = 0;
  let ducksScored = 0;
  let startedAt = 0;
  let prestige = 0;

  function reset(nowSeconds) {
    rarestTier = -1;
    rarestCount = 0;
    ducksScored = 0;
    startedAt = Number(nowSeconds) || 0;
  }

  // Fed the array world.pit.consumeEvents() already returns, so it costs one
  // pass over events that are being produced anyway.
  function notePitEvents(events) {
    if (!events || !events.length) return 0;
    let n = 0;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (!e || e.type !== 'duck') continue;
      ducksScored++;
      n++;
      const t = typeof e.tier === 'number' ? e.tier : 0;
      if (t > rarestTier) { rarestTier = t; rarestCount = 1; }
      else if (t === rarestTier) rarestCount++;
    }
    return n;
  }

  // Prestige has no producer in the game yet. It is reported, never invented:
  // if something sets it, the screen shows it; otherwise it shows 0 and says
  // so plainly rather than hiding a row the summary is contracted to have.
  function setPrestige(n) {
    prestige = Math.max(0, Math.round(Number(n) || 0));
    return prestige;
  }

  function built() {
    const list = (d.placed && d.placed.objects) || [];
    const counts = new Map();
    for (let i = 0; i < list.length; i++) {
      const rec = list[i];
      // A placed record carries the row's display name already, so the summary
      // does not have to look the catalog up and cannot disagree with the shop.
      const name = (rec && rec.name) || (rec && rec.id) || 'object';
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  function collect(extra) {
    const e = extra || {};
    const world = d.world;
    const economy = world ? world.economy : null;
    const hold = world ? world.hold : null;
    const nowSeconds = typeof e.now === 'number' ? e.now : (d.now ? d.now() : 0);
    return {
      reason: e.reason || 'Session ended.',
      durationSeconds: Math.max(0, nowSeconds - startedAt),
      ducksThrown: hold && hold.throwCount ? hold.throwCount() : 0,
      ducksScored: world && world.pit ? world.pit.totalScored() : ducksScored,
      moneyEarned: economy ? economy.totalEarned() : 0,
      moneyLeft: economy ? economy.money() : 0,
      rarest: rarestTier < 0 ? null : { tier: rarestTier, count: rarestCount },
      built: built(),
      prestige,
      players: Array.isArray(e.players) ? e.players.slice() : [],
    };
  }

  return { reset, notePitEvents, setPrestige, collect, built, prestige: () => prestige };
}

export function createSummaryUI(opts) {
  const o = opts || {};
  injectCRT(document);
  const style = document.createElement('style');
  style.id = 'summary-style';
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = el('div', null, o.container || document.body);
  root.id = 'summary';
  el('div', null, root).id = 'summary-scrim';
  const panel = el('div', 'crt-scan', root);
  panel.id = 'summary-panel';
  panel.setAttribute('data-crt-pane', '');

  const head = el('div', null, panel);
  head.id = 'summary-head';
  const title = el('div', null, head, 'Session over');
  title.id = 'summary-title';
  const reason = el('div', null, head, '');
  reason.id = 'summary-reason';

  const body = el('div', null, panel);
  body.id = 'summary-body';

  const statsSec = el('div', 'sum-sec', body);
  el('h4', null, statsSec, 'Totals');
  const grid = el('div', 'sum-grid', statsSec);

  const builtSec = el('div', 'sum-sec', body);
  el('h4', null, builtSec, 'What got built');
  const builtBox = el('div', null, builtSec);

  const playersSec = el('div', 'sum-sec', body);
  el('h4', null, playersSec, 'Players');
  const playersBox = el('div', null, playersSec);
  playersBox.id = 'summary-players';

  const foot = el('div', null, panel);
  foot.id = 'summary-foot';
  const note = el('div', null, foot, 'Nothing is saved. Reload to start again.');
  note.id = 'summary-note';
  // The key is named ON the button because the button is the thing a short
  // viewport pushes off the bottom of the panel -- and Escape is the exit that
  // cannot be scrolled away (src/main.js handleKeys). Before, this screen was
  // the only one in the game Escape did not answer, and the documented recovery
  // for a clipped button was reloading the page.
  const closeBtn = el('button', null, foot, 'Close (Esc)');
  closeBtn.id = 'summary-close';

  let open = false;
  let last = null;

  function stat(parent, value, key, plain, small) {
    const s = el('div', 'sum-stat', parent);
    const v = el('div', 'v', s, value);
    if (plain) v.classList.add('plain');
    if (small) v.classList.add('small');
    el('div', 'k', s, key);
    return s;
  }

  function render(data) {
    last = data;
    // "Session ended.  -  0m 03s" -- a full stop, then two spaces, a hyphen and
    // two more. The sentence had already ended and then a dash carried on from
    // it, and the doubled gaps read as a layout accident rather than a
    // separator. The stop is dropped when a dash follows it, and one space each
    // side is a separator: "Session ended - 0m 03s".
    const why = String(data.reason || 'Session ended.').trim().replace(/\.$/, '');
    reason.textContent = why + ' - ' + duration(data.durationSeconds);

    grid.textContent = '';
    stat(grid, num(data.ducksThrown), 'Ducks thrown', true);
    stat(grid, num(data.ducksScored), 'Ducks in the pit', true);
    stat(grid, '$' + num(data.moneyEarned), 'Money earned');
    // "x1" next to a rarity multiplier would read as another multiplier, so the
    // count of how many of that tier went in is spelled out.
    stat(grid, data.rarest ? tierLabel(data.rarest.tier) : 'None',
      data.rarest
        ? 'Rarest duck - ' + num(data.rarest.count) + ' of them'
        : 'Rarest duck', true, true);
    stat(grid, num(data.prestige), 'Prestiges', true);

    builtBox.textContent = '';
    const rows = Array.isArray(data.built) ? data.built : [];
    if (!rows.length) {
      el('div', 'sum-none', builtBox, 'Nothing was placed.');
    } else {
      const max = Math.round(config.summary.maxBuiltRows);
      let shown = 0;
      let rest = 0;
      for (let i = 0; i < rows.length; i++) {
        if (i < max) {
          const r = el('div', 'sum-row', builtBox);
          el('span', 'n', r, rows[i].name);
          el('span', 'c', r, 'x' + num(rows[i].count));
          shown++;
        } else {
          rest += rows[i].count;
        }
      }
      if (rest) {
        const r = el('div', 'sum-row', builtBox);
        el('span', 'n', r, 'other');
        el('span', 'c', r, 'x' + num(rest));
      }
      if (!shown) el('div', 'sum-none', builtBox, 'Nothing was placed.');
    }

    playersBox.textContent = '';
    const players = Array.isArray(data.players) ? data.players : [];
    if (!players.length) {
      el('div', 'sum-none', playersBox, 'Single player.');
    } else {
      players.forEach((p) => {
        const n = el('div', 'sum-player', playersBox);
        el('span', 'sl', n, (p.slot === 0 ? 'host' : 'slot ' + p.slot) + '  ');
        el('span', null, n, p.nick || 'player');
      });
    }
  }

  function show(data) {
    render(data || {});
    if (!open) {
      open = true;
      root.classList.add('open');
      document.documentElement.classList.add('session-over');
      if (document.exitPointerLock) document.exitPointerLock();
      if (o.onShow) o.onShow(last);
    }
    return last;
  }

  function hide() {
    if (!open) return false;
    open = false;
    root.classList.remove('open');
    document.documentElement.classList.remove('session-over');
    if (o.onClose) o.onClose();
    return true;
  }

  closeBtn.addEventListener('click', hide);

  return {
    root,
    show,
    hide,
    isOpen: () => open,
    data: () => last,
    state: () => ({
      open,
      // Whether the game's own chrome is hidden behind this screen. Asked by the
      // check that this panel does not open over a live tutorial line.
      chromeHidden: document.documentElement.classList.contains('session-over'),
      reason: reason.textContent,
      stats: Array.from(grid.children).map((c) => ({
        key: c.querySelector('.k').textContent,
        value: c.querySelector('.v').textContent,
      })),
      built: Array.from(builtBox.querySelectorAll('.sum-row')).map((r) => ({
        name: r.querySelector('.n').textContent,
        count: r.querySelector('.c').textContent,
      })),
      builtEmpty: !!builtBox.querySelector('.sum-none'),
      players: Array.from(playersBox.children).map((c) => c.textContent.trim()),
    }),
    dispose() {
      if (root.parentNode) root.parentNode.removeChild(root);
      if (style.parentNode) style.parentNode.removeChild(style);
    },
  };
}

export default createSummaryUI;
