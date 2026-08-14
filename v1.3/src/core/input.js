// Keyboard + pointer-lock mouse look. Debug overrides let the player be
// driven with no mouse and no pointer lock, which debugStep depends on.

import config from '../config.js';

export function createInput(canvas) {
  const keys = new Set();
  const state = { fwd: 0, right: 0, jump: false, sprint: false, yaw: 0, pitch: 0 };
  const override = { move: null, look: null };
  let locked = false;
  let lockAvailable = true;
  let dragging = false;

  // Edge-triggered keys. Held-down keys drive movement; these drive one-shot
  // actions (open the shop, pick a hotbar slot, reset rotation), so they are
  // queued on the DOWN edge and drained once per frame -- never sampled, which
  // would fire an action once per frame for as long as the key is held.
  const EDGE_KEYS = new Set([
    // KeyM opens the multiplayer lobby. main.js has handled it since G4; it was
    // missing from this set, so the edge was never queued and the key was dead.
    'KeyE', 'KeyG', 'KeyQ', 'KeyX', 'KeyR', 'KeyT', 'KeyM', 'Escape',
    'BracketLeft', 'BracketRight',
  ]);
  // The hotbar digits are DERIVED from how many slots the hotbar has, not typed
  // out. They were typed out, they stopped at Digit5 while the bar had four
  // slots, and going to nine left 6-9 as dead keys that main.js was happily
  // handling and never hearing about. A list that has to be edited in step with
  // a number somewhere else will eventually not be.
  for (let i = 1; i <= Math.min(9, Math.round(config.shop.hotbarSlots)); i++) {
    EDGE_KEYS.add('Digit' + i);
  }
  let keyEdges = [];

  function onKey(e, down) {
    if (down && e.code === config.debug.toggleKey) e.preventDefault();
    if (e.code === 'Space') e.preventDefault();
    if (down && !e.repeat && EDGE_KEYS.has(e.code)) keyEdges.push(e.code);
    if (down) keys.add(e.code); else keys.delete(e.code);
  }

  const kd = (e) => onKey(e, true);
  const ku = (e) => onKey(e, false);
  const blur = () => { keys.clear(); releaseGrab(); swallowedGrab = false; };

  function onMouse(e) {
    if (!locked && !dragging) return;
    state.yaw -= e.movementX * config.player.mouseSensitivity;
    state.pitch -= e.movementY * config.player.mouseSensitivity;
    const l = config.player.pitchLimit;
    state.pitch = Math.max(-l, Math.min(l, state.pitch));
  }

  // Chrome refuses a new pointer-lock request for roughly a second after the
  // user pressed Escape to leave one, and it refuses it by REJECTING the
  // promise -- which is indistinguishable, at the call site, from "this browser
  // will never give you pointer lock". Treating that rejection as permanent is
  // what made Escape a one-way door: press it to glance at something, click to
  // go back, and the game silently dropped to drag-to-look for the rest of the
  // session with no way back.
  let lastUnlockAt = 0;
  let lockFailures = 0;
  let retryTimer = 0;

  const cooldownMs = config.input.lockCooldownMs;
  const failuresBeforeFallback = config.input.lockFailuresBeforeFallback;

  function onLockChange() {
    const wasLocked = locked;
    locked = document.pointerLockElement === canvas;
    if (locked) {
      dragging = false;
      lockFailures = 0;
    } else if (wasLocked) {
      lastUnlockAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      // The cursor is back on the desktop, so the next click is the one that
      // buys the lock again -- and that click must not also act in the world.
      relockArmed = true;
    }
  }

  // Pointer lock is refused in cross-origin frames and by some browsers. That is
  // an environment limit, not a boot failure: fall back to drag-to-look.
  function dropToDragLook(reason) {
    if (!lockAvailable) return;
    lockAvailable = false;
    if (typeof window.__ducksNotice === 'function') {
      window.__ducksNotice(
        'Pointer lock unavailable' + (reason ? ' (' + reason + ')' : '') + ' - drag with the mouse to look around.',
        'pointer-lock'
      );
    }
  }

  const requestLock = () => {
    if (captured) return;
    if (!lockAvailable || locked || !canvas.requestPointerLock) return;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const since = now - lastUnlockAt;
    // Inside the browser's post-Escape cooldown, do not ask at all -- wait it
    // out and ask once when it expires. Asking early both fails and, worse,
    // teaches the fallback logic that pointer lock is broken.
    if (lastUnlockAt && since < cooldownMs) {
      if (!retryTimer) {
        retryTimer = setTimeout(() => { retryTimer = 0; requestLock(); }, cooldownMs - since + 30);
      }
      return;
    }
    let p;
    try {
      p = canvas.requestPointerLock();
    } catch (err) {
      onLockRejected(err);
      return;
    }
    if (p && typeof p.catch === 'function') p.catch(onLockRejected);
  };

  // Only a REPEATED refusal means this browser cannot do pointer lock. A single
  // one is almost always the cooldown or a lost user gesture, and both are
  // recoverable by clicking again.
  function onLockRejected(err) {
    lockFailures++;
    if (lockFailures >= failuresBeforeFallback) {
      dropToDragLook(err && err.message ? err.message : String(err));
    }
  }

  // The DOM `pointerlockerror` event is the OTHER way a refusal arrives, and it
  // used to call dropToDragLook directly -- so the retry counter never got a
  // say and a single refusal was still fatal. Both paths now go through the
  // same counter.
  function onLockError() {
    onLockRejected(new Error('request rejected'));
  }

  // Carrying is hold-to-carry: the DOWN edge grabs, the UP edge drops. Both
  // edges are queued and drained once per frame, so a click can never be lost
  // between frames or applied twice. Both work with or without pointer lock: in
  // an iframe there is no lock and the same button also drives drag-to-look,
  // which is intentional -- you can carry a duck and look around in one gesture.
  // The up edge is listened for on window, so letting go outside the canvas (or
  // outside the iframe) still drops what you were carrying.
  const actions = { grabDown: 0, grabUp: 0, throw: 0, scroll: 0, rotate: 0 };
  let grabHeld = false;
  // How many clicks have been spent on regaining pointer lock. Read by the debug
  // surface: "the click did nothing in the world" is only provable if the input
  // layer says it saw the click at all.
  let relockClicks = 0;
  // While a modal UI owns the pointer, the game sees no movement, no clicks and
  // no pointer-lock request. The frame loop keeps running: the shop must not
  // freeze the simulation, only stop driving the player.
  let captured = false;

  function pressGrab() {
    actions.grabDown += 1;
    grabHeld = true;
  }

  function releaseGrab() {
    if (!grabHeld) return;
    grabHeld = false;
    actions.grabUp += 1;
  }

  // The click that BUYS BACK pointer lock is not a click in the world.
  //
  // Leaving the shop (or pressing Escape) hands the cursor back to the desktop,
  // and the only way to get it again is to click the canvas. That click lands
  // wherever the mouse was left sitting, so with a wall in hand it also placed
  // the wall -- somewhere the player never aimed. The two bugs Jurek reported
  // are this one bug: a purchase that arrives in the hand makes the stray click
  // destructive, and the stray click exists because re-locking needs a click.
  //
  // So the grab edge is swallowed exactly once, on the click that asks for the
  // lock, and its matching release with it (an unmatched grabUp would read as
  // "you let go", which drops whatever you were carrying). The NEXT click is a
  // deliberate one and acts normally.
  //
  // Never applied when pointer lock is unavailable: in drag-to-look there is no
  // lock to regain and this same button is the only way to act at all.
  //
  // And swallowed at most ONCE per release of the cursor. `relockArmed` is set
  // when the lock is lost (or taken away by a modal) and cleared by the click
  // that pays for it. Without that, an environment where the lock is never
  // actually granted -- some embeds, and every automation harness -- would eat
  // every click the player ever makes and the game would look dead. One click
  // is the whole cost of the bug being fixed; the second click always acts.
  const swallowRelock = !!config.input.swallowRelockClick;
  let swallowedGrab = false;
  let relockArmed = true;
  function isRelockClick() {
    return swallowRelock && relockArmed && lockAvailable && !locked && !!canvas.requestPointerLock;
  }

  function onMouseDown(e) {
    if (captured) return;
    // Middle button is the rotation detent; with shift it turns the other way.
    if (e.button === 1) {
      e.preventDefault();
      actions.rotate += e.shiftKey ? -1 : 1;
      return;
    }
    if (e.button === config.input.grabButton) {
      if (isRelockClick()) { swallowedGrab = true; relockArmed = false; relockClicks++; }
      else pressGrab();
    }
    else if (e.button === config.input.throwButton) actions.throw += 1;
    if (locked || e.button !== 0) return;
    dragging = true;
    e.preventDefault();
  }

  function onDragEnd(e) {
    dragging = false;
    if (!e || e.button === undefined || e.button === config.input.grabButton) {
      // The release that belongs to a swallowed press is swallowed too.
      if (swallowedGrab) { swallowedGrab = false; return; }
      releaseGrab();
    }
  }

  function onContextMenu(e) {
    e.preventDefault();
  }

  function onWheel(e) {
    if (captured || !e.deltaY) return;
    e.preventDefault();
    actions.scroll += Math.sign(e.deltaY) * config.input.scrollSign;
  }

  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);
  window.addEventListener('blur', blur);
  document.addEventListener('mousemove', onMouse);
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('pointerlockerror', onLockError);
  canvas.addEventListener('click', requestLock);
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('mouseup', onDragEnd);

  function read() {
    let fwd = 0;
    let right = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) fwd += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) fwd -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) right += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) right -= 1;
    if (captured) { fwd = 0; right = 0; }
    if (override.move) { fwd = override.move.fwd; right = override.move.right; }
    if (override.look) { state.yaw = override.look.yaw; state.pitch = override.look.pitch; }
    state.fwd = fwd;
    state.right = right;
    state.jump = captured ? false : keys.has('Space');
    state.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
    return state;
  }

  return {
    read,
    isKeyDown: (code) => keys.has(code),
    get locked() { return locked; },
    get pointerLockAvailable() { return lockAvailable; },
    get pointerLocked() { return locked; },
    // True while the browser is still refusing to re-lock after an Escape.
    get lockCoolingDown() {
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      return !!lastUnlockAt && (now - lastUnlockAt) < cooldownMs;
    },
    requestLock,
    get dragLook() { return dragging; },
    setLook(yaw, pitch) {
      const l = config.player.pitchLimit;
      override.look = { yaw, pitch: Math.max(-l, Math.min(l, pitch)) };
      state.yaw = override.look.yaw;
      state.pitch = override.look.pitch;
    },
    setMove(fwd, right) {
      override.move = { fwd, right };
    },
    clearOverrides() { override.move = null; override.look = null; },
    setJump(v) { if (v) keys.add('Space'); else keys.delete('Space'); },
    consumeActions() {
      const out = {
        grabDown: actions.grabDown,
        grabUp: actions.grabUp,
        throw: actions.throw,
        scroll: actions.scroll,
        rotate: actions.rotate,
      };
      actions.grabDown = 0;
      actions.grabUp = 0;
      actions.throw = 0;
      actions.scroll = 0;
      actions.rotate = 0;
      return out;
    },
    consumeKeys() {
      const out = keyEdges;
      keyEdges = [];
      return out;
    },
    pressKey(code) { keyEdges.push(code); },
    rotateBy(n) { actions.rotate += Math.round(Number(n) || 0); },
    setCaptured(v) {
      captured = !!v;
      if (captured) {
        keys.clear();
        releaseGrab();
        swallowedGrab = false;
        // A modal took the cursor. Whatever click brings it back is that
        // click's whole job -- this is the shop case Jurek reported.
        relockArmed = true;
        if (document.exitPointerLock && document.pointerLockElement === canvas) {
          document.exitPointerLock();
        }
      }
      return captured;
    },
    get captured() { return captured; },
    get grabHeld() { return grabHeld; },
    // Clicks spent buying pointer lock back, and whether one is in flight right
    // now. The player never sees these; a head-down test needs them to tell
    // "the click was swallowed" apart from "the click never happened".
    get relockClicks() { return relockClicks; },
    get swallowingGrab() { return swallowedGrab; },
    get relockArmed() { return relockArmed; },
    // True when the next canvas click would be spent on pointer lock rather
    // than on the world.
    get needsRelockClick() { return isRelockClick(); },
    pressGrab,
    releaseGrab,
    pressThrow() { actions.throw += 1; },
    scrollBy(n) { actions.scroll += Number(n) || 0; },
    pendingActions: () => ({ ...actions }),
    dispose() {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', blur);
      document.removeEventListener('mousemove', onMouse);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('pointerlockerror', onLockError);
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = 0; }
      canvas.removeEventListener('click', requestLock);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('mouseup', onDragEnd);
    },
  };
}
