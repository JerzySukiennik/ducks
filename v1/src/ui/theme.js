// The CRT design system. ONE source for every colour, type ramp, timing and
// surface in the interface -- menu, lobby, settings, summary, shop, HUD.
//
// Jurek picked this direction from five (work/menu-designs.html, 03 CRT). The
// argument for it: the game renders to a 480 px buffer and upscales, so it
// genuinely IS a low-resolution image on a modern screen. The interface admits
// that instead of pretending otherwise.
//
// Amber phosphor, not green. Green reads as "hacker terminal"; amber was the
// workstation monitor, which is what a factory control panel actually had. It
// also sits beside the game's own hazard yellow (#f2c218, tierColors[0])
// without fighting it.
//
// No DOM, no three.js -- this is data. Every panel imports these instead of
// inventing its own values, because three builders inventing "CRT" separately
// produce three different CRTs.

export const CRT = {
  // --- colour ---------------------------------------------------------------
  // A phosphor ramp, dimmest to brightest. Anything interactive lives at `on`
  // or above; anything structural stays at `dim` or below, so brightness alone
  // tells you what responds.
  bg:        '#0b0906',   // the tube with nothing on it
  bgPanel:   'rgba(30, 19, 4, 0.60)',
  bgRaised:  'rgba(44, 28, 6, 0.72)',
  faint:     '#5b3f0d',   // rules, disabled text
  dim:       '#8a6015',   // labels, secondary data
  on:        '#c98f22',   // body text, idle interactive
  bright:    '#ffb000',   // headings, focused interactive
  hot:       '#ffcc55',   // hover/active, the only thing brighter than a heading
  border:    '#6b4a12',
  borderHot: '#a9761c',

  // Reserved meanings. Kept few on purpose: on a monochrome tube, colour is
  // expensive and should only ever mean something.
  ok:        '#9fe870',   // affordable, connected, succeeded
  warn:      '#ff9f45',   // out of stock, degraded, careful
  bad:       '#ff5f52',   // refused, error, destructive

  // --- glow -----------------------------------------------------------------
  // Phosphor bleeds. Text glow is what separates a CRT from a dark theme, but
  // it costs legibility, so it scales with importance and never touches body
  // copy.
  glowSoft:  '0 0 10px rgba(255, 176, 0, 0.35)',
  glowText:  '0 0 12px rgba(255, 176, 0, 0.55)',
  glowTitle: '0 0 16px rgba(255, 176, 0, 0.50), 0 0 44px rgba(255, 120, 0, 0.22)',

  // --- the tube ------------------------------------------------------------
  // Scanlines multiply so they darken without washing the image grey. The
  // vignette is what makes a flat rectangle read as curved glass.
  scanlines: 'repeating-linear-gradient(180deg, rgba(0,0,0,0.34) 0 1px, transparent 1px 3px)',
  vignette:  'radial-gradient(72% 62% at 50% 46%, transparent 30%, rgba(0,0,0,0.72) 100%)',
  // The screen behind a modal dims rather than blurs: a CRT has no depth of
  // field, and blur here reads as a different product.
  scrim:     'rgba(4, 3, 2, 0.62)',

  // --- type -----------------------------------------------------------------
  // VT323 is a bitmap face: it has ONE weight and gets its hierarchy from size
  // alone, which is exactly how a terminal works. Data stays in the system
  // mono, because aligned columns of numbers are the one thing a bitmap face
  // does badly.
  display:  '"VT323", ui-monospace, SFMono-Regular, Menlo, monospace',
  data:     'ui-monospace, SFMono-Regular, Menlo, monospace',

  // Size ramp. Tracking is size-specific: large bitmap text needs air between
  // characters, small text needs less, and a single letter-spacing for all
  // sizes is wrong somewhere.
  type: {
    title:   { size: 'clamp(40px, 6vw, 84px)', line: 0.86, track: '0.02em' },
    heading: { size: '26px', line: 1.0,  track: '0.06em' },
    nav:     { size: '22px', line: 1.0,  track: '0.05em' },
    body:    { size: '17px', line: 1.35, track: '0.01em' },
    label:   { size: '14px', line: 1.2,  track: '0.18em' },
    // The only sizes in the data face. Numbers do not need the bitmap face and
    // are more readable without it.
    dataRow: { size: '12px', line: 1.4,  track: '0.01em' },
    dataSm:  { size: '11px', line: 1.3,  track: '0.06em' },
  },

  // --- motion ---------------------------------------------------------------
  // Critically damped by default: response without overshoot. Bounce is
  // reserved for things the player physically threw, which in a menu is
  // nothing.
  ease:      'cubic-bezier(0.22, 0.61, 0.36, 1)',
  fast:      '0.13s',   // hover, press -- must feel instant
  normal:    '0.26s',   // panel arrive/leave
  slow:      '0.34s',   // screen changes
  stagger:   0.045,     // seconds between nav items assembling

  // A CRT does not fade. It collapses to a line and snaps back, and that is the
  // one signature move of this design -- used for panels arriving, never for
  // anything that happens often enough to become annoying.
  powerOn:   'crtPowerOn 0.26s cubic-bezier(0.22, 0.61, 0.36, 1)',

  // --- layers ---------------------------------------------------------------
  // ONE scale for every overlay in the game. These used to be typed into each
  // panel's own CSS, which is how the settings panel ended up at 24 UNDER the
  // menu at 26 -- a full-screen menu with live pointer events swallowed every
  // click meant for a slider, so settings looked open and was completely dead.
  //
  // The order is "what is in front of what", and it is not arbitrary: a panel
  // opened FROM another panel must sit above its parent, because that is the
  // one thing the player can see about which is in charge. Settings is opened
  // from the menu, so settings is in front of it.
  layer: {
    hud:      12,
    focus:    11,
    hotbar:   14,
    shop:     20,
    lobby:    22,
    menu:     26,
    settings: 28,   // opened FROM the menu, therefore in front of it
    summary:  30,   // ends the session; nothing may cover it
  },

  // --- geometry -------------------------------------------------------------
  radius:    '0px',     // a terminal has no rounded corners
  hairline:  '1px',
  gutter:    '22px',
  colWidth:  'min(460px, 44vw)',
  paneWidth: 'min(430px, 42vw)',
};

// The keyframes and resets every panel needs. Injected once; calling it twice
// is a no-op, so each module can ask for it without coordinating.
let injected = false;
export function injectCRT(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || injected) return;
  injected = true;
  const s = d.createElement('style');
  s.id = 'crt-theme';
  s.textContent = `
/* VT323 is SHIPPED, not linked. Gate F-A says the game boots and renders with
   the network unplugged, and a Google Fonts <link> fails that: the face never
   arrives and every heading silently falls back. Two subsets, 14 KB together --
   latin for the interface, latin-ext for the Polish diacritics in the menu copy.
   font-display: swap so a slow disk costs a repaint, never a blank screen. */
@font-face {
  font-family: "VT323";
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url("./assets/fonts/vt323-latin.woff2") format("woff2");
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA,
    U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193,
    U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face {
  font-family: "VT323";
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url("./assets/fonts/vt323-latin-ext.woff2") format("woff2");
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF,
    U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020,
    U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
}

@keyframes crtPowerOn {
  0%   { transform: scaleY(0.004) scaleX(1.06); opacity: 0; filter: brightness(2.4); }
  46%  { transform: scaleY(0.004) scaleX(1);    opacity: 1; filter: brightness(2.4); }
  100% { transform: none;                       opacity: 1; filter: none; }
}
@keyframes crtBlink { 50% { opacity: 0; } }

.crt-scan::after {
  content: ""; position: absolute; inset: 0; pointer-events: none; z-index: 40;
  background: ${CRT.scanlines}; mix-blend-mode: multiply;
}
.crt-vig::before {
  content: ""; position: absolute; inset: 0; pointer-events: none; z-index: 39;
  background: ${CRT.vignette};
}
.crt-cursor {
  display: inline-block; width: 0.5em; height: 1em; background: currentColor;
  vertical-align: -0.12em; margin-left: 0.24em;
  animation: crtBlink 1.05s steps(2, start) infinite;
}

/* Reduced motion keeps the feedback and drops the theatre: no collapse, no
   stagger, no blinking cursor -- but hover and focus still respond instantly,
   because that is information, not decoration. */
@media (prefers-reduced-motion: reduce) {
  .crt-cursor { animation: none; }
  [data-crt-pane] { animation: none !important; }
}
/* A tube is a translucency effect the user may have switched off. Without the
   scanlines the interface still has to be readable, so the panel background
   goes solid rather than losing its edge. */
@media (prefers-reduced-transparency: reduce) {
  .crt-scan::after, .crt-vig::before { display: none; }
  [data-crt-pane] { background: #171004 !important; }
}
@media (prefers-contrast: more) {
  [data-crt-pane] { background: #0b0906 !important; border-color: ${CRT.hot} !important; }
}
`;
  d.head.appendChild(s);
}

export default CRT;
