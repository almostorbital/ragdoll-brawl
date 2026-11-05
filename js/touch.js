// TOUCH CONTROLS: for phones and tablets (they turn on the first time the screen's touched, and the keyboard
// help goes away). A joystick on the left (put your thumb down anywhere on the left half: it appears there;
// push it right out to run), drag anywhere else to look about, and buttons on the right: PUNCH, KICK, JUMP,
// GRAB (hold it), the special move, FLOP (hold it), and PICK UP when there's gear by you. A pause button, top
// left. They work by pressing the same keys you've got the actions on (see BINDS in core.js), so the rest of
// the game doesn't know the difference.
'use strict';
const TOUCH = { on: false, stick: null, look: new Map(), held: new Map() };
const TOUCH_BTNS = [
  // [action, label, class]
  ['punch', 'PUNCH', 'big'],
  ['kick', 'KICK', ''],
  ['jump', 'JUMP', ''],
  ['grab', 'GRAB', ''],
  ['special', 'SPECIAL', 'special'],
  ['flop', 'FLOP', 'small'],
  ['pickup', 'PICK UP', 'small pickup'],
];
const codeFor = a => BINDS[a] && (BINDS[a][0] || BINDS[a][1]);

function buildTouch() {
  const el = document.createElement('div');
  el.id = 'touch';
  el.innerHTML = `<div id="tStick"><i></i></div>
    <button id="tPause" aria-label="pause"><b></b><b></b></button>
    ${TOUCH_BTNS.map(([a, label, cls]) => `<button class="tb ${cls}" data-a="${a}">${label}</button>`).join('')}`;
  document.body.appendChild(el);
  // the buttons: down while your finger's on them
  el.querySelectorAll('.tb').forEach(b => {
    const a = b.dataset.a;
    b.addEventListener('touchstart', e => {
      e.preventDefault(); e.stopPropagation();
      const c = codeFor(a); if (!c) return;
      keys[c] = true; pressed.add(c); b.classList.add('down');
      for (const t of e.changedTouches) TOUCH.held.set(t.identifier, { c, b });
    }, { passive: false });
  });
  $('tPause').addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); pauseGame(); }, { passive: false });
}

// fingers anywhere else: the joystick (left half) or looking about (the rest)
addEventListener('touchstart', e => {
  if (!TOUCH.on) turnOnTouch();
  if (!playing || e.target.closest('#overlay') || e.target.closest('.tb') || e.target.closest('#tPause')) return;
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.clientX < innerWidth * 0.45 && !TOUCH.stick) {
      TOUCH.stick = { id: t.identifier, x: t.clientX, y: t.clientY, dx: 0, dy: 0 };
      const s = $('tStick'); s.style.left = t.clientX + 'px'; s.style.top = t.clientY + 'px'; s.classList.add('on');
    } else TOUCH.look.set(t.identifier, { x: t.clientX, y: t.clientY });
  }
}, { passive: false });
addEventListener('touchmove', e => {
  if (!TOUCH.on) return;
  if (playing) e.preventDefault();
  for (const t of e.changedTouches) {
    const S = TOUCH.stick;
    if (S && t.identifier === S.id) {
      const R = 60;
      let dx = t.clientX - S.x, dy = t.clientY - S.y; const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      S.dx = dx / R; S.dy = dy / R;
      $('tStick').firstChild.style.transform = `translate(${dx}px, ${dy}px)`;
      continue;
    }
    const L = TOUCH.look.get(t.identifier);
    if (L) { mouse.dx += (t.clientX - L.x) * 1.8; mouse.dy += (t.clientY - L.y) * 1.8; L.x = t.clientX; L.y = t.clientY; TOUCH.lookedAt = performance.now(); }
  }
}, { passive: false });
function touchUp(e) {
  for (const t of e.changedTouches) {
    if (TOUCH.stick && t.identifier === TOUCH.stick.id) { TOUCH.stick = null; const s = $('tStick'); s.classList.remove('on'); s.firstChild.style.transform = ''; }
    TOUCH.look.delete(t.identifier);
    const h = TOUCH.held.get(t.identifier);
    if (h) { keys[h.c] = false; h.b.classList.remove('down'); TOUCH.held.delete(t.identifier); }
  }
}
addEventListener('touchend', touchUp);
addEventListener('touchcancel', touchUp);

// (a touch screen: on from the start, menus and online included, not only once it's been touched)
if (matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches) addEventListener('load', () => turnOnTouch());
function turnOnTouch() {
  if (TOUCH.on) return;
  TOUCH.on = true;
  if (!$('touch')) buildTouch();
  document.body.classList.add('touch');
  $('hud').appendChild($('foes'));   // (the fighters' cards: out from beside your power card, up along the top)
}

// (each frame) the joystick → the movement keys (and running, pushed right out); the buttons shown only while
// you're playing; PICK UP only when there's gear by you
function updateTouch() {
  if (!TOUCH.on) return;
  const S = TOUCH.stick, dz = 0.3;
  const set = (a, on) => { const c = codeFor(a); if (c && !TOUCH.held.has('k' + a)) keys[c] = on; };
  if (S || TOUCH.wasStick) {
    set('forward', !!S && S.dy < -dz); set('back', !!S && S.dy > dz);
    set('left', !!S && S.dx < -dz); set('right', !!S && S.dx > dz);
    set('run', !!S && Math.hypot(S.dx, S.dy) > 0.9);
    TOUCH.wasStick = !!S;
  }
  $('touch').classList.toggle('playing', playing);
  // the camera follows where you're facing: swinging round behind you (faster while you're moving). Not while
  // you're dragging to look about yourself, or for a moment after.
  const now = performance.now(), dt = Math.min(0.05, (now - (TOUCH.lastT || now)) / 1000); TOUCH.lastT = now;
  if (playing && !TOUCH.look.size && now - (TOUCH.lookedAt || 0) > 1500 && !playerBody.limp && !P.hang) {
    let d = P.yaw - cam.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    const moving = Math.hypot(P.vel.x, P.vel.z) > 0.6;
    cam.yaw += d * (1 - Math.exp(-(moving ? 2.5 : 1) * dt));
  }
  const pick = document.querySelector('#touch .pickup');
  if (pick) pick.style.display = $('lootHint').style.display === 'none' ? 'none' : '';
}
