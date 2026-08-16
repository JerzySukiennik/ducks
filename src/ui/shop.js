// The vendor's shop panel. DOM only: it costs no draw calls, it never touches
// the frame loop, and closing it hands control straight back to the game.
//
// Every number on screen comes from shop.listTab(): the UI never computes a
// price, an affordability, a sort order or a level of its own. A row it does not
// understand still renders, because the catalog is data and this file must not
// need editing when a row is added.
//
// --- what this rebuild is for ------------------------------------------------
// Jurek played it and said the shop was unreadable. It was: every row was a
// left-aligned block of name-plus-sentence with a price and a button floated to
// the right, so scanning "what can I afford" meant reading thirty descriptions.
// The fix is columns, not decoration. There are now five, in the order the
// questions are actually asked:
//
//   PRICE   what it costs, right-aligned so the digits line up and the list
//           reads as a ladder -- which it now is, sorted cheapest first.
//   NAME    what it is, plus what it does underneath in one dim line.
//   OUTPUT  ducks a minute, and what those ducks are worth a minute at the duck
//           value in force right now. The rows describe their rate in PROSE
//           ("stamps out a duck every few seconds"), which cannot be compared
//           without buying both machines -- which is how five rows ended up
//           strictly dominated by cheaper ones with nobody noticing. Both
//           figures come out of shop.listTab(); this file computes neither.
//   STOCK   how many the vendor has left this period. The whole reason a row
//           can be unbuyable while you are rich.
//   ACTION  one button, one state.
//
// Every column of NUMBERS is in CRT.data, never the bitmap face. VT323 has one
// weight and no tabular figures, so a column of prices in it does not line up
// -- which is the one thing this panel exists to make possible.
//
// Colour is load-bearing and there are only three: affordable is CRT.ok, out of
// stock is CRT.warn, refused-for-any-other-reason is CRT.bad. On a monochrome
// tube a fourth colour would be decoration.

import { TAB_LABELS, VENDOR_SHORT } from '../data/index.js';
import { CRT, injectCRT } from './theme.js';

const CSS = `
#shop { position: fixed; inset: 0; z-index: 20; display: none;
  align-items: center; justify-content: center; pointer-events: none;
  font-family: ${CRT.display}; color: ${CRT.on}; }
#shop.open { display: flex; }
#shop-scrim { position: absolute; inset: 0; background: ${CRT.scrim}; }

#shop-panel { position: relative; width: min(880px, 94vw); max-height: 86vh;
  display: flex; flex-direction: column; pointer-events: auto; overflow: hidden;
  background: ${CRT.bgPanel};
  border: ${CRT.hairline} solid ${CRT.border}; border-radius: ${CRT.radius};
  box-shadow: 0 0 0 1px rgba(0,0,0,0.6), 0 24px 80px rgba(0,0,0,0.7), ${CRT.glowSoft};
  animation: ${CRT.powerOn}; }
/* The tube. Scanlines and vignette sit above the content and below the
   pointer, so the panel reads as an image on glass rather than a dark div. */
#shop-panel::after { content: ""; position: absolute; inset: 0; pointer-events: none;
  z-index: 40; background: ${CRT.scanlines}; mix-blend-mode: multiply; }
#shop-panel::before { content: ""; position: absolute; inset: 0; pointer-events: none;
  z-index: 39; background: ${CRT.vignette}; }

/* --- head ---------------------------------------------------------------- */
/* The right padding reserves the X's 40px square. Without it the balance --
   the widest thing in the header and the one that grows -- slides underneath
   the close button and the player reads "$9□0". */
#shop-head { display: flex; align-items: baseline; gap: ${CRT.gutter};
  padding: 14px 52px 12px 18px; border-bottom: ${CRT.hairline} solid ${CRT.border}; }
#shop-title { flex: 1; font-size: ${CRT.type.heading.size}; line-height: ${CRT.type.heading.line};
  letter-spacing: ${CRT.type.heading.track}; text-transform: uppercase;
  color: ${CRT.bright}; text-shadow: ${CRT.glowText}; }
#shop-money { font-family: ${CRT.data}; font-size: 19px; font-weight: 700;
  letter-spacing: 0.02em; color: ${CRT.bright}; text-shadow: ${CRT.glowText};
  font-variant-numeric: tabular-nums; }

/* The X. Top-right corner of the panel, outside the flow so it cannot be
   pushed around by a long title, and 40px square so it is a real target rather
   than a decorative glyph. Escape still closes the panel and E still opens it;
   this is an ADDITIONAL exit, never a replacement -- a panel with one way out
   that the player has to already know about is the defect being fixed. */
#shop-close { position: absolute; top: 0; right: 0; z-index: 41;
  width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;
  appearance: none; background: transparent; border: 0;
  border-left: ${CRT.hairline} solid ${CRT.border};
  border-bottom: ${CRT.hairline} solid ${CRT.border};
  cursor: pointer; color: ${CRT.dim}; font-family: ${CRT.display}; font-size: 26px;
  line-height: 1; padding: 0 0 3px 0;
  transition: color ${CRT.fast} ${CRT.ease}, background ${CRT.fast} ${CRT.ease}; }
#shop-close:hover { color: ${CRT.hot}; background: ${CRT.bgRaised};
  text-shadow: ${CRT.glowText}; }
#shop-close:focus-visible { outline: ${CRT.hairline} solid ${CRT.hot}; outline-offset: -3px; }

/* --- the shelf bar -------------------------------------------------------- */
/* Between the title and the tabs, because "what is on the shelf and for how
   long" applies to every tab and is the first thing that changed about this
   shop. */
#shop-shelf { display: flex; align-items: center; gap: 12px;
  padding: 8px 18px; border-bottom: ${CRT.hairline} solid ${CRT.border};
  background: ${CRT.bgRaised}; }
#shop-shelf .lb { font-size: ${CRT.type.label.size}; letter-spacing: ${CRT.type.label.track};
  text-transform: uppercase; color: ${CRT.dim}; }
#shop-clock { font-family: ${CRT.data}; font-size: 14px; font-weight: 700;
  font-variant-numeric: tabular-nums; color: ${CRT.on}; min-width: 4.5em; }
#shop-clock.soon { color: ${CRT.hot}; text-shadow: ${CRT.glowSoft}; }
#shop-bar { flex: 1; height: 4px; background: rgba(0,0,0,0.5);
  border: ${CRT.hairline} solid ${CRT.border}; overflow: hidden; }
#shop-bar i { display: block; height: 100%; background: ${CRT.on};
  box-shadow: ${CRT.glowSoft}; }
#shop-reroll { appearance: none; cursor: pointer; padding: 5px 12px;
  background: transparent; border: ${CRT.hairline} solid ${CRT.border};
  color: ${CRT.on}; font-family: ${CRT.display}; font-size: 17px;
  letter-spacing: 0.04em; white-space: nowrap;
  transition: color ${CRT.fast} ${CRT.ease}, border-color ${CRT.fast} ${CRT.ease},
              background ${CRT.fast} ${CRT.ease}; }
#shop-reroll:hover:not([disabled]) { color: ${CRT.hot}; border-color: ${CRT.borderHot};
  background: rgba(255,176,0,0.08); text-shadow: ${CRT.glowSoft}; }
/* A reroll that cannot be paid for is GREYED, not disabled. The difference is
   the whole point: a disabled button swallows the click, so the only way to
   learn why it is dead was to hover it for a second and read a native tooltip
   -- exactly the defect the message row at the foot of this panel exists to
   prevent. It still takes the click, and the click still goes through
   shop.rerollStock(), which refuses with the same data-sourced line every other
   refusal here uses. */
#shop-reroll.off { color: ${CRT.faint}; border-color: ${CRT.faint}; }
#shop-reroll.off:hover { color: ${CRT.bad}; border-color: ${CRT.bad}; background: transparent; }
#shop-reroll[disabled] { cursor: not-allowed; color: ${CRT.faint}; border-color: ${CRT.faint}; }

/* --- tabs ----------------------------------------------------------------- */
#shop-tabs { display: flex; border-bottom: ${CRT.hairline} solid ${CRT.border}; }
#shop-tabs button { flex: 1; appearance: none; background: transparent; border: 0;
  border-bottom: 2px solid transparent; padding: 9px 6px; cursor: pointer;
  color: ${CRT.dim}; font-family: ${CRT.display};
  font-size: ${CRT.type.nav.size}; line-height: ${CRT.type.nav.line};
  letter-spacing: ${CRT.type.nav.track}; text-transform: uppercase;
  transition: color ${CRT.fast} ${CRT.ease}, border-color ${CRT.fast} ${CRT.ease}; }
#shop-tabs button:hover { color: ${CRT.hot}; }
#shop-tabs button.on { color: ${CRT.bright}; border-bottom-color: ${CRT.bright};
  text-shadow: ${CRT.glowSoft}; }

/* --- the list ------------------------------------------------------------- */
/* ONE grid template shared by the header and every row, so the column headings
   sit over the columns they name. Written once here rather than twice: a header
   whose widths are guessed separately from the rows is a header that drifts.
   The widths are in PX, not em: the header sets 11px labels and the rows set
   20px names, so an em-based template resolves to two different grids and the
   headings land between the columns they are supposed to name. Measured, not
   eyeballed -- headerLefts and rowLefts have to match to the pixel. */
#shop-list { overflow-y: auto; scrollbar-width: thin; }
#shop-cols, .shop-row { display: grid;
  grid-template-columns: 92px 1fr 92px 58px 104px; gap: 12px; align-items: center;
  padding: 0 18px; }
#shop-cols { padding-top: 7px; padding-bottom: 7px;
  border-bottom: ${CRT.hairline} solid ${CRT.border};
  position: sticky; top: 0; z-index: 2; background: ${CRT.bgRaised};
  font-family: ${CRT.data}; font-size: ${CRT.type.dataSm.size};
  letter-spacing: ${CRT.type.dataSm.track}; text-transform: uppercase; color: ${CRT.dim}; }
#shop-cols .r { text-align: right; }
#shop-cols .c { text-align: center; }

.shop-row { padding-top: 9px; padding-bottom: 9px;
  border-bottom: ${CRT.hairline} solid rgba(107,74,18,0.45);
  transition: background ${CRT.fast} ${CRT.ease}; }
.shop-row:hover { background: rgba(255,176,0,0.055); }
/* A row you cannot buy is DIMMED as a whole, so the eye skips it before it has
   read anything. Reading the reason is then a choice, not a toll. */
.shop-row.off { opacity: 0.62; }

.shop-row .pr { font-family: ${CRT.data}; font-size: 15px; font-weight: 700;
  font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap;
  color: ${CRT.bright}; }
.shop-row.poor .pr { color: ${CRT.bad}; }

.shop-row .nm { font-family: ${CRT.display}; font-size: 20px; line-height: 1.05;
  letter-spacing: 0.01em; color: ${CRT.on}; }
.shop-row:hover .nm { color: ${CRT.hot}; }
.shop-row .ds { font-family: ${CRT.data}; font-size: ${CRT.type.dataSm.size};
  line-height: ${CRT.type.dataSm.line}; color: ${CRT.dim}; margin-top: 2px; }
/* Ownership rides at the end of the description line instead of on a third line
   of its own: it is a qualifier on the item, not a fact of equal weight, and a
   three-line row halves how many rows fit on screen. */
.shop-row .lv { color: ${CRT.faint}; margin-left: 0.9em; white-space: nowrap; }

/* OUTPUT. The column the shop did not have: what the row makes per minute, and
   what that is worth per minute at the duck value in force right now. Both are
   computed in src/sim/shop.js from the row's own produce block -- this file
   still calculates nothing -- and both are in the data face with tabular
   figures, because the whole reason they exist is to be compared down a column.
   A row that does not make ducks by itself says so once, quietly, rather than
   drawing a zero it would have to be argued with. */
.shop-row .rt { font-family: ${CRT.data}; font-size: 14px;
  font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap;
  color: ${CRT.on}; }
.shop-row .rt b { font-weight: 700; }
.shop-row .rt small { display: block; font-size: 10px; font-weight: 400;
  letter-spacing: 0.04em; color: ${CRT.ok}; }
.shop-row .rt.none { color: ${CRT.faint}; font-size: 11px; letter-spacing: 0.06em;
  text-transform: uppercase; }

.shop-row .st { font-family: ${CRT.data}; font-size: 14px;
  font-variant-numeric: tabular-nums; text-align: center; color: ${CRT.on}; }
.shop-row .st b { font-weight: 700; }
.shop-row .st small { display: block; font-size: 9px; font-weight: 400;
  letter-spacing: 0.1em; text-transform: uppercase; color: ${CRT.faint}; }
.shop-row.empty .st { color: ${CRT.warn}; }
.shop-row .st.none { color: ${CRT.faint}; }

.shop-row button { width: 100%; appearance: none; cursor: pointer; padding: 6px 8px;
  background: transparent; border: ${CRT.hairline} solid ${CRT.ok}; color: ${CRT.ok};
  font-family: ${CRT.display}; font-size: 18px; letter-spacing: 0.06em;
  text-transform: uppercase; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis;
  transition: background ${CRT.fast} ${CRT.ease}, color ${CRT.fast} ${CRT.ease}; }
.shop-row button:hover:not([disabled]) { background: rgba(159,232,112,0.16); }
.shop-row button:focus-visible { outline: ${CRT.hairline} solid ${CRT.hot}; outline-offset: 2px; }
/* The two refusals are different colours because they are different problems:
   warn means wait, bad means you cannot. */
.shop-row button[disabled] { cursor: not-allowed;
  border-color: ${CRT.faint}; color: ${CRT.dim}; background: transparent; }
.shop-row.empty button[disabled] { border-color: ${CRT.warn}; color: ${CRT.warn}; }
.shop-row.poor button[disabled] { border-color: ${CRT.bad}; color: ${CRT.bad}; }

#shop-empty { padding: 26px 18px; text-align: center; color: ${CRT.dim};
  font-size: ${CRT.type.body.size}; }

/* --- foot ----------------------------------------------------------------- */
#shop-foot { display: flex; align-items: center; justify-content: space-between;
  gap: 14px; padding: 9px 18px; border-top: ${CRT.hairline} solid ${CRT.border};
  color: ${CRT.faint}; font-family: ${CRT.data}; font-size: ${CRT.type.dataSm.size};
  letter-spacing: ${CRT.type.dataSm.track}; }
#shop-msg { font-family: ${CRT.data}; font-size: 12px; font-weight: 700;
  color: ${CRT.ok}; }
#shop-msg.bad { color: ${CRT.bad}; }

/* --- prestige ------------------------------------------------------------- */
#shop-prestige { border-top: ${CRT.hairline} solid ${CRT.border}; padding: 11px 18px;
  display: none; background: ${CRT.bgRaised}; }
#shop-prestige.on { display: block; }
#shop-prestige .hd { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
#shop-prestige .ti { font-family: ${CRT.display}; font-size: ${CRT.type.label.size};
  letter-spacing: ${CRT.type.label.track}; text-transform: uppercase; color: ${CRT.bright}; }
#shop-prestige .now { font-family: ${CRT.data}; font-size: ${CRT.type.dataSm.size};
  color: ${CRT.dim}; margin-top: 3px; }
#shop-prestige button { appearance: none; cursor: pointer; min-width: 150px; padding: 6px 10px;
  background: transparent; border: ${CRT.hairline} solid ${CRT.border}; color: ${CRT.on};
  font-family: ${CRT.display}; font-size: 17px; letter-spacing: 0.05em; }
#shop-prestige button:hover:not([disabled]) { color: ${CRT.hot}; border-color: ${CRT.borderHot};
  background: rgba(255,176,0,0.08); }
#shop-prestige button[disabled] { cursor: not-allowed; color: ${CRT.faint};
  border-color: ${CRT.faint}; }
/* Same rule as the reroll: an unarmed prestige is greyed and still clickable,
   and clicking it puts the reason in the message row instead of hiding it in a
   title= attribute. */
#shop-prestige button.off { color: ${CRT.faint}; border-color: ${CRT.faint}; }
#shop-prestige button.off:hover { color: ${CRT.bad}; border-color: ${CRT.bad};
  background: transparent; }
#shop-prestige button.confirm { border-color: ${CRT.bad}; color: ${CRT.bad}; }
#shop-prestige button.confirm:hover:not([disabled]) { background: rgba(255,95,82,0.12);
  color: ${CRT.bad}; border-color: ${CRT.bad}; }
#shop-confirm { display: none; margin-top: 10px; padding: 10px 12px;
  border: ${CRT.hairline} solid ${CRT.border}; background: rgba(0,0,0,0.35); }
#shop-confirm.on { display: block; }
#shop-confirm .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 8px 0 10px; }
#shop-confirm h4 { margin: 0 0 4px; font-family: ${CRT.display};
  font-size: ${CRT.type.label.size}; font-weight: 400;
  letter-spacing: ${CRT.type.label.track}; text-transform: uppercase; }
#shop-confirm .lose h4 { color: ${CRT.bad}; }
#shop-confirm .keep h4 { color: ${CRT.ok}; }
#shop-confirm ul { margin: 0; padding-left: 16px; color: ${CRT.dim};
  font-family: ${CRT.data}; font-size: ${CRT.type.dataSm.size}; line-height: 1.5; }
#shop-confirm .gain { color: ${CRT.bright}; font-family: ${CRT.data};
  font-size: 12px; line-height: 1.45; }
#shop-confirm .acts { display: flex; gap: 8px; }
/* After the .confirm rules on purpose: the commit button carries both classes,
   and greyed has to win over armed-red when the offer is not available. */
#shop-prestige button.confirm.off { color: ${CRT.faint}; border-color: ${CRT.faint};
  background: transparent; }
#shop-prestige button.confirm.off:hover { color: ${CRT.bad}; border-color: ${CRT.bad};
  background: transparent; }

@media (prefers-reduced-motion: reduce) {
  #shop-panel { animation: none; }
}
@media (prefers-reduced-transparency: reduce) {
  #shop-panel::after, #shop-panel::before { display: none; }
  #shop-panel { background: ${CRT.bg}; }
}
@media (prefers-contrast: more) {
  #shop-panel { background: ${CRT.bg}; border-color: ${CRT.hot}; }
}
`;

function el(tag, cls, parent, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}

function money(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

// A per-minute figure, at the precision the number deserves: a 0.4 and a 1300
// in the same column need different decimals or one of them is a lie and the
// other is unreadable. Never more than four significant characters, so the
// column stays a column.
// ONE DECIMAL, never two. A row's description states the cadence in the unit
// the machine actually has ("a duck every nine seconds"); this column states the
// same fact per minute so that rows with different cadences can be compared in
// one glance. Both are wanted -- the column cannot express a geyser and the
// description cannot be ranked -- but the column was printing 6.67 against
// "every nine seconds", and two decimal places on a count of ducks reads as a
// third, more precise number rather than as a rounding of the same one. 6.7.
function rate(n) {
  const v = Number(n) || 0;
  if (v >= 100) return Math.round(v).toLocaleString('en-US');
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(1);
}

// m:ss. The countdown is the only clock in this interface and it has to be
// scannable at a glance, so it is never "173 seconds".
function clockText(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

// onUi(kind) is the panel's own click/hover/tab feed. It is a callback like
// onBuy and onOpen rather than an import, so this file still knows nothing
// about audio -- it reports that a button was pressed and somebody else decides
// whether that makes a noise.
// prestigeQuote() returns everything src/sim/prestige.js knows about the offer;
// onPrestige() commits it. Both are optional: with neither, the panel below is
// simply never built and the shop is the shop it always was.
// stock is src/sim/stock.js, read for the countdown only -- the per-row unit
// counts arrive inside shop.listTab() like every other number. It is optional
// too: without it the shelf bar is not built and nothing else changes.
export function createShopUI({
  container, shop, economy, onBuy, onOpen, onClose, onUi,
  prestigeQuote, onPrestige, prestigeAllowed,
  stock, onReroll,
}) {
  const ui = typeof onUi === 'function' ? onUi : () => {};
  injectCRT(document);
  const style = document.createElement('style');
  style.id = 'shop-style';
  style.textContent = CSS;
  document.head.appendChild(style);

  const shelf = stock || null;

  const root = el('div', null, container || document.body);
  root.id = 'shop';
  const scrim = el('div', null, root);
  scrim.id = 'shop-scrim';
  const panel = el('div', null, root);
  panel.id = 'shop-panel';
  panel.setAttribute('data-crt-pane', '');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Vendor');

  const head = el('div', null, panel);
  head.id = 'shop-head';
  const title = el('div', null, head, 'Vendor');
  title.id = 'shop-title';
  const moneyEl = el('div', null, head, '$0');
  moneyEl.id = 'shop-money';

  // The X, and it is a real button: keyboard reachable, labelled for a screen
  // reader, and it does exactly what Escape does. Multiplication sign, not the
  // letter x -- an x in a bitmap face beside a heading reads as a typo.
  const closeBtn = el('button', null, panel, '×');
  closeBtn.id = 'shop-close';
  closeBtn.type = 'button';
  closeBtn.title = 'Close (Esc)';
  closeBtn.setAttribute('aria-label', 'Close the shop');
  closeBtn.addEventListener('click', () => { ui('click'); doClose(); });

  // --- the shelf bar ---------------------------------------------------------
  let shelfEl = null;
  let clockEl = null;
  let barFill = null;
  let rerollBtn = null;
  if (shelf) {
    shelfEl = el('div', null, panel);
    shelfEl.id = 'shop-shelf';
    el('div', 'lb', shelfEl, 'Restock in');
    clockEl = el('div', null, shelfEl, '0:00');
    clockEl.id = 'shop-clock';
    const bar = el('div', null, shelfEl);
    bar.id = 'shop-bar';
    barFill = el('i', null, bar);
    rerollBtn = el('button', null, shelfEl, 'Restock now ' + money(shelf.rerollCost));
    rerollBtn.id = 'shop-reroll';
    rerollBtn.type = 'button';
    rerollBtn.addEventListener('click', () => { ui('click'); reroll(); });
  }

  const tabsEl = el('div', null, panel);
  tabsEl.id = 'shop-tabs';

  const listEl = el('div', null, panel);
  listEl.id = 'shop-list';

  // The column header, INSIDE the scroller and sticky to its top. Inside is
  // load-bearing rather than tidy: a header outside the scrolling element does
  // not lose the scrollbar's width, so its columns sit a few pixels right of
  // the columns they name -- which is exactly the misalignment this rebuild
  // exists to remove. Sharing the scroller means sharing the width.
  const cols = el('div', null, listEl);
  cols.id = 'shop-cols';
  el('div', 'r', cols, 'Price');
  el('div', null, cols, 'Item');
  el('div', 'r', cols, 'Output / min');
  el('div', 'c', cols, 'Stock');
  el('div', null, cols, '');

  // Rows live in their own box so render() can empty it without taking the
  // header with it.
  const rowsEl = el('div', null, listEl);
  rowsEl.id = 'shop-rows';
  const foot = el('div', null, panel);
  foot.id = 'shop-foot';
  const msg = el('div', null, foot, '');
  msg.id = 'shop-msg';
  // "ESC or X close ... X demolish" used ONE LETTER FOR TWO THINGS in one line:
  // the first X was the panel's ✕ button, the second was the demolish key. A
  // player reading left to right learns X closes the shop and then, four items
  // later, that X demolishes -- and only one of those is a key at all. The ✕ is
  // a button you click and needs no keyboard name in a keyboard list, so it does
  // not get one; X now means the demolish key here and nowhere else.
  // MMB is listed with R because they turn the same way -- see KEY_ROWS in
  // src/ui/controls.js, which is the table this line is a short quotation of.
  el('div', null, foot, 'Esc closes  ·  1-9 hotbar  ·  R or MMB rotate  ·  G reset the angle  ·  X demolish');

  // --- the prestige panel ----------------------------------------------------
  // Losing your factory must never be a surprise, so this is two clicks with the
  // whole bill in between: the first opens an itemised list of what goes and
  // what stays, the second commits. Every number in it comes from
  // prestige.quote() -- this file computes nothing, exactly like the rows above.
  const quoteOf = typeof prestigeQuote === 'function' ? prestigeQuote : null;
  const allowedBy = typeof prestigeAllowed === 'function' ? prestigeAllowed : () => ({ ok: true, reason: null });
  const pres = el('div', null, panel);
  pres.id = 'shop-prestige';
  // Above the footer: the footer is the key legend and belongs at the bottom.
  panel.insertBefore(pres, foot);
  const presHead = el('div', 'hd', pres);
  const presLeft = el('div', null, presHead);
  el('div', 'ti', presLeft, 'Prestige');
  const presNow = el('div', 'now', presLeft, '');
  const presBtn = el('button', null, presHead, 'Review prestige');
  const confirm = el('div', null, pres);
  confirm.id = 'shop-confirm';
  const confGain = el('div', 'gain', confirm, '');
  const confCols = el('div', 'cols', confirm);
  const loseCol = el('div', 'lose', confCols);
  el('h4', null, loseCol, 'You lose');
  const loseList = el('ul', null, loseCol);
  const keepCol = el('div', 'keep', confCols);
  el('h4', null, keepCol, 'You keep');
  const keepList = el('ul', null, keepCol);
  const acts = el('div', 'acts', confirm);
  const doIt = el('button', 'confirm', acts, 'Yes - reset the factory');
  const cancel = el('button', null, acts, 'Cancel');
  let confirming = false;

  // Why the button is off goes in the MESSAGE ROW, not in a tooltip. `armed` is
  // recomputed by renderPrestige() every time it runs and stashed here with the
  // reason, so the two click handlers below say exactly what the panel drew.
  let presArmed = true;
  let presReason = '';

  presBtn.addEventListener('click', () => {
    ui('click');
    if (!presArmed && !confirming) { say(presReason || 'Prestige is not available yet', true); return; }
    confirming = !confirming;
    renderPrestige();
  });
  cancel.addEventListener('click', () => { ui('click'); confirming = false; renderPrestige(); });
  doIt.addEventListener('click', () => {
    ui('click');
    if (!presArmed) { say(presReason || 'Prestige is not available yet', true); return; }
    const res = (onPrestige ? onPrestige() : null) || { ok: false, reason: 'not wired up' };
    confirming = false;
    // A client gets `pending` back and the world arrives in the host's next
    // broadcast, like every other request; there is nothing to report yet.
    if (!res.pending) say(res.ok ? 'Prestige taken' : (res.reason || 'Refused'), !res.ok);
    render();
  });

  const tabs = shop.tabs.slice();
  let active = tabs[0];
  let open = false;
  let lastMessage = '';

  const tabButtons = tabs.map((t) => {
    const b = el('button', null, tabsEl, TAB_LABELS[t] || t);
    b.type = 'button';
    b.addEventListener('click', () => { ui('tab'); setTab(t); });
    return b;
  });

  function setTab(t) {
    if (tabs.indexOf(t) < 0) return;
    active = t;
    tabButtons.forEach((b, i) => b.classList.toggle('on', tabs[i] === active));
    render();
  }

  function say(text, bad) {
    lastMessage = text || '';
    msg.textContent = lastMessage;
    msg.classList.toggle('bad', !!bad);
  }

  function buy(id) {
    const res = (onBuy ? onBuy(id) : shop.buy(id)) || { ok: false, reason: 'No such item' };
    // A client's request is in flight and has decided nothing yet; saying
    // "Purchased" here would be this panel inventing a result.
    if (!res.pending) say(res.ok ? res.message || 'Purchased' : res.reason, !res.ok);
    render();
    return res;
  }

  // Paying to turn the shelf over. Routed through onReroll for the same reason
  // buying is routed through onBuy: on a client it is a REQUEST, and the new
  // shelf arrives in the host's broadcast with everybody else's.
  function reroll() {
    const res = (onReroll ? onReroll() : (shop.rerollStock ? shop.rerollStock() : null))
      || { ok: false, reason: 'Not wired up' };
    if (!res.pending) say(res.ok ? res.message || 'Fresh stock delivered' : res.reason, !res.ok);
    render();
    return res;
  }

  function bullets(node, rows, empty) {
    node.textContent = '';
    if (!rows.length) { el('li', null, node, empty); return; }
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      el('li', null, node, r.name + (r.level > 1 ? ' x' + r.level : ''));
    }
  }

  // Everything the player is owed before they commit, in one place: the
  // multiplier now, the multiplier after, and the itemised bill on both sides.
  function renderPrestige() {
    if (!quoteOf) { pres.classList.remove('on'); return; }
    const q = quoteOf();
    if (!q) { pres.classList.remove('on'); return; }
    pres.classList.add('on');
    const allow = allowedBy() || { ok: true, reason: null };
    presNow.textContent =
      'Ducks pay x' + q.multiplier.toFixed(2)
      + '  ·  taken ' + q.count + (q.count === 1 ? ' time' : ' times')
      + '  ·  money earned $' + Math.round(q.totalEarned).toLocaleString('en-US');
    const armed = q.available && allow.ok;
    presArmed = armed;
    presReason = allow.reason || q.reason || 'Prestige is not available yet';
    presBtn.textContent = confirming ? 'Hide' : 'Review prestige';
    // Greyed rather than disabled, for the same reason the reroll is: the click
    // is how the player asks why, and the answer belongs in the message row.
    presBtn.disabled = false;
    presBtn.classList.toggle('off', !armed && !confirming);
    presBtn.title = armed ? '' : presReason;
    if (!armed && !confirming) presBtn.textContent = allow.ok ? (q.reason || 'Not yet') : allow.reason;
    confirm.classList.toggle('on', confirming);
    if (!confirming) return;
    confGain.textContent =
      'Ducks would pay x' + q.next.toFixed(2) + ' instead of x' + q.multiplier.toFixed(2)
      + '  (' + q.gain.toFixed(2) + 'x better), forever, for the rest of the session.';
    bullets(loseList, q.lose.concat(
      q.placedLost ? [{ name: q.placedLost + ' object(s) standing on the plate', level: 1 }] : [],
      q.money > 0 ? [{ name: '$' + Math.round(q.money).toLocaleString('en-US') + ' - all the money you have', level: 1 }] : []
    ), 'nothing yet');
    bullets(keepList, q.keep.concat(
      q.placedKept ? [{ name: q.placedKept + ' object(s) standing on the plate', level: 1 }] : []
    ), 'nothing yet');
    doIt.disabled = false;
    doIt.classList.toggle('off', !armed);
    doIt.title = armed ? '' : presReason;
  }

  // The countdown and the reroll button. Split out of render() because it runs
  // every frame while the panel is open and must not rebuild thirty rows to
  // move a clock by one second.
  function renderShelf() {
    if (!shelf) return;
    const left = shelf.secondsLeft();
    clockEl.textContent = clockText(left);
    clockEl.classList.toggle('soon', left <= 15);
    const frac = shelf.period > 0 ? Math.max(0, Math.min(1, left / shelf.period)) : 0;
    barFill.style.width = (frac * 100).toFixed(1) + '%';
    const can = !economy || economy.canAfford(shelf.rerollCost);
    // Never `disabled`: see the CSS note. Greyed, still clickable, and the
    // refusal is spoken by reroll() through the message row.
    rerollBtn.disabled = false;
    rerollBtn.classList.toggle('off', !can);
    rerollBtn.title = can ? 'Roll a new shelf immediately' : 'Not enough money';
  }

  // One row per catalog entry, in the order shop.listTab() returned them --
  // which is cheapest first. An unknown kind still renders: price, name,
  // description, stock, affordability.
  function render() {
    moneyEl.textContent = money(economy ? economy.money() : 0);
    renderShelf();
    rowsEl.textContent = '';
    const rows = shop.listTab(active);
    if (!rows.length) {
      const e = el('div', null, rowsEl, 'Nothing in this tab.');
      e.id = 'shop-empty';
      renderPrestige();
      return;
    }
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const row = el('div', 'shop-row', rowsEl);
      row.dataset.id = r.id;

      // 1. PRICE, right-aligned, in the data face. First column because the
      //    list is a price ladder now and the ladder is the point.
      const price = el('div', 'pr', row, money(r.price));
      price.title = r.affordable ? 'Affordable' : (r.reason || '');

      // 2. WHAT IT IS. Name in the bitmap face, one dim line of prose under it,
      //    ownership appended to that line rather than given a line of its own.
      const mid = el('div', null, row);
      el('div', 'nm', mid, r.name);
      const ds = el('div', 'ds', mid, r.desc);
      if (!r.unlimited && r.maxLevel !== null) {
        el('span', 'lv', ds, 'Level ' + r.level + '/' + r.maxLevel);
      } else if (r.level > 0) {
        el('span', 'lv', ds, 'Owned ' + r.level);
      }

      // 3. OUTPUT PER MINUTE, both halves of it: how many ducks the row makes on
      //    its own, and what those ducks are worth at the current duck value.
      //    Nothing here is computed locally -- listTab() did it from the row.
      const rt = el('div', 'rt', row);
      if (r.ducksPerMinute === null || r.ducksPerMinute === undefined) {
        rt.classList.add('none');
        // 'hands' is the sim saying "somebody has to work this"; no note at all
        // means the row does not make ducks, and a dash is the honest answer.
        rt.textContent = r.rateNote === 'hands' ? 'by hand' : '-';
      } else {
        el('b', null, rt, rate(r.ducksPerMinute) + ' ducks');
        el('small', null, rt, '$' + rate(r.moneyPerMinute));
      }

      // 4. STOCK. `null` means the shop was built without a shelf at all, which
      //    is not the same statement as 0 and must not be drawn as one.
      const st = el('div', 'st', row);
      if (r.stock === null) {
        st.classList.add('none');
        el('b', null, st, '-');
      } else {
        el('b', null, st, String(r.stock));
        el('small', null, st, r.stock === 0 ? 'sold out' : 'left');
      }

      // 5. ONE button, one state. When it is off it says WHY, because a dead
      //    button with no reason is the thing that makes a shop feel broken.
      // The SHORT form on the button, the full line in the tooltip and in the
      // message row. Both come from src/data/vendor-lines.js keyed by the same
      // code, so this is still data choosing the words -- just at the width the
      // column actually has. A code with no short form falls back to the long
      // one, which is how an unknown refusal still says something.
      const short = (r.code && VENDOR_SHORT[r.code]) || r.reason || 'Unavailable';
      const btn = el('button', null, row, r.affordable ? 'Buy' : short);
      btn.type = 'button';
      if (!r.affordable) {
        btn.disabled = true;
        btn.title = r.reason || '';
        row.classList.add('off');
        // Out of stock is a WAIT, not a refusal, and it is the one refusal with
        // its own colour. `code` is the stable machine name from
        // src/data/vendor-lines.js -- never the displayed string.
        if (r.code === 'out_of_stock') row.classList.add('empty');
        else if (r.code === 'insufficient') row.classList.add('poor');
      }
      btn.addEventListener('click', () => { ui('click'); buy(r.id); });
      row.addEventListener('mouseenter', () => ui('hover'));
    }
    renderPrestige();
  }

  // Called once a frame while the panel is open. The clock moves every frame;
  // the rows are rebuilt only when the shelf or the balance actually changed,
  // which is what keeps a thirty-row rebuild off the frame budget.
  let lastSig = '';
  function tick() {
    if (!open) return;
    renderShelf();
    const sig = (shelf ? shelf.signature() : '') + '|' + (economy ? economy.money() : 0);
    if (sig === lastSig) return;
    lastSig = sig;
    render();
  }

  function doOpen() {
    if (open) return false;
    open = true;
    root.classList.add('open');
    say('');
    setTab(active);
    lastSig = (shelf ? shelf.signature() : '') + '|' + (economy ? economy.money() : 0);
    if (document.exitPointerLock) document.exitPointerLock();
    if (onOpen) onOpen();
    return true;
  }

  function doClose() {
    if (!open) return false;
    open = false;
    root.classList.remove('open');
    if (onClose) onClose();
    return true;
  }

  return {
    root,
    open: doOpen,
    close: doClose,
    toggle() { return open ? (doClose(), false) : (doOpen(), true); },
    isOpen: () => open,
    refresh: render,
    tick,
    setTab,
    buy,
    reroll,
    // The X, drivable head-down like every other control here: an exit nobody
    // can test is an exit nobody can trust.
    closeButton: closeBtn,
    clickClose() { closeBtn.click(); return open; },
    activeTab: () => active,
    message: () => lastMessage,
    rowCount: () => listEl.querySelectorAll('.shop-row').length,
    // Drivable head-down like the rest of the front end: a confirmation nobody
    // can reach without a mouse is a confirmation nobody can test.
    prestigeReview() { confirming = true; renderPrestige(); return this.prestigeState(); },
    prestigeCancel() { confirming = false; renderPrestige(); return this.prestigeState(); },
    prestigeConfirm() { doIt.click(); return this.prestigeState(); },
    prestigeState: () => ({
      visible: pres.classList.contains('on'),
      confirming,
      button: presBtn.textContent,
      armed: presArmed,
      reason: presArmed ? '' : presReason,
      summary: presNow.textContent,
      gain: confGain.textContent,
      lose: Array.from(loseList.children).map((c) => c.textContent),
      keep: Array.from(keepList.children).map((c) => c.textContent),
    }),
    // Read back off the DOM, never off the model: this is what the player can
    // actually see, which is the only thing worth asserting on.
    shelfState: () => (shelf ? {
      clock: clockEl.textContent,
      secondsLeft: shelf.secondsLeft(),
      period: shelf.periodNo(),
      rerollCost: shelf.rerollCost,
      rerollEnabled: !rerollBtn.classList.contains('off'),
      barWidth: barFill.style.width,
    } : null),
    state: () => ({
      open,
      tab: active,
      rows: Array.from(listEl.querySelectorAll('.shop-row')).map((c) => ({
        id: c.dataset.id,
        name: c.querySelector('.nm').textContent,
        desc: c.querySelector('.ds').textContent,
        price: c.querySelector('.pr').textContent,
        rate: c.querySelector('.rt').textContent,
        stock: c.querySelector('.st b').textContent,
        affordable: !c.classList.contains('off'),
        outOfStock: c.classList.contains('empty'),
        button: c.querySelector('button').textContent,
      })),
      message: lastMessage,
      money: moneyEl.textContent,
    }),
    dispose() {
      if (root.parentNode) root.parentNode.removeChild(root);
      if (style.parentNode) style.parentNode.removeChild(style);
    },
  };
}

export default createShopUI;
