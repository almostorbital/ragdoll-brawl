// The screens and the HUD: the title screen (and pause screen), your damage, the fighters' damage, the score,
// big pop-up messages ("RING-OUT!"), the gust warning, and the controls card.
'use strict';

// a little cartoon face in a colour (for you and each fighter on the HUD)
const faceHTML = color => `<span class="face" style="--c:${'#' + color.toString(16).padStart(6, '0')}"><i></i><i></i></span>`;

// damage colours: white when fresh, through yellow and orange, to red when you're about to fly
const dmgColor = d => d < 40 ? '#ffffff' : d < 80 ? '#ffe14a' : d < 120 ? '#ff9a2a' : '#ff4a3a';

// power colours: white, blue as it charges, gold when it's full
const powColor = p => p >= 100 ? '#ffd23a' : p >= 50 ? '#5ad1ff' : '#ffffff';

const UI = { lastDmg: 0, lastKO: 0, lastFalls: 0, lastWave: 0, helpT: 14, chips: [] };

function buildUI() {
  $('youFace').innerHTML = faceHTML(0x2f7bff);
  // (H: show or hide the controls)
  addEventListener('keydown', e => { if (BINDS.help.includes(e.code) && playing) { UI.helpT = $('help').classList.contains('hide') ? 1e9 : 0; } });
}

// pop a big message up in the middle of the screen for a moment
// (several at once stack up, one under the other, instead of on top of each other; the same one twice at
// once just shows once)
// (one at a time, so they never cover each other: any more wait their turn, a few at most. The same words
// twice in a row only show once)
const BANNER_Q = [];
function banner(text, cls) {
  if (BANNER_Q.some(b => b[0] === text) || (banner.now === text)) return;
  BANNER_Q.push([text, cls]);
  if (BANNER_Q.length > 3) BANNER_Q.splice(0, BANNER_Q.length - 3);   // (too many waiting: the oldest go)
  if (!banner.busy) nextBanner();
}
function nextBanner() {
  const b = BANNER_Q.shift();
  if (!b) { banner.busy = false; banner.now = null; return; }
  banner.busy = true; banner.now = b[0];
  const el = document.createElement('div');
  el.className = 'banner ' + (b[1] || '');
  el.textContent = b[0];
  el.style.top = '0px';
  $('banners').appendChild(el);
  // (a shorter turn if there are more waiting)
  const t = BANNER_Q.length ? 1100 : 1700;
  el.style.animationDuration = t + 'ms';
  setTimeout(() => { el.remove(); nextBanner(); }, t);
}

// ---------------------------------------------------------------- slanted banners
// A big stripe across the screen at an angle, for the big moments: ROUND 2, ROUND CLEAR!, YOU WIN!, YOU LOSE!
// (kind: round, win or lose; for how long, in seconds)
function slashBanner(main, sub, kind, t = 2) {
  const el = $('slash');
  clearTimeout(slashBanner.t1); clearTimeout(slashBanner.t2);
  el.className = kind || '';
  el.innerHTML = `<div class="band"><div class="main">${main}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  el.style.display = 'block';
  $('banners').style.visibility = 'hidden';   // (the small messages keep out of its way)
  slashBanner.t1 = setTimeout(() => el.classList.add('out'), t * 1000);
  slashBanner.t2 = setTimeout(() => { el.style.display = 'none'; $('banners').style.visibility = ''; }, t * 1000 + 400);
}

// ---------------------------------------------------------------- GAME OVER (single player: out of lives)
// How far you got over everything for a few seconds, and whether that's your best; then a new run starts.
function showGameOver(reached, isBest) {
  const el = $('matchEnd');
  el.className = isBest ? 'win' : 'lose';
  el.innerHTML = `${isBest ? '<div class="stars">' + Array.from({ length: 40 }, () => `<i style="left:${Math.random() * 100}%;animation-duration:${1.5 + Math.random() * 2}s;animation-delay:${Math.random() * 1.2}s;background:${['#ffd23a', '#ff9a2a', '#7fe05a', '#5ab8ff', '#ff5fb0'][Math.floor(Math.random() * 5)]}"></i>`).join('') + '</div>' : ''}
    <div class="score">WAVE ${reached}</div>
    <div class="sub">${isBest ? 'NEW BEST!' : 'Your best: wave ' + LIFE.best}  ·  ${koCount} ring-out${koCount === 1 ? '' : 's'}. A new run in a moment…</div>`;
  el.style.display = 'flex';
  slashBanner('GAME OVER', isBest ? 'A NEW BEST: WAVE ' + reached + '!' : 'Out of lives on wave ' + reached, isBest ? 'win' : 'lose', 3.4);
  showBest();
  setTimeout(() => { el.style.display = 'none'; }, 5600);
}
// your best wave, on the title screen and the menu
function showBest() {
  const t = LIFE.best ? 'Your best: wave ' + LIFE.best : '';
  $('splashBest').textContent = t;
  $('bestLine').textContent = NET.on ? '' : t;
}
showBest();

// ---------------------------------------------------------------- 3, 2, 1, FIGHT!
// At the start of a game (and of each new online match). wait: online, waiting for your friend to press PLAY.
const COUNT = { t: 0, wait: false, shown: null };
function startCountdown() {
  COUNT.t = 3.8; COUNT.wait = false;
  // (and which round it is, on a slanted banner: online, which match)
  if (NET.on) slashBanner('MATCH ' + (NET.matchN = (NET.matchN || 0) + 1), 'First to ' + NET.WIN + ' ring-outs!', 'round', 2.6);
  else if (PRACTICE.on) slashBanner('PRACTICE!', "The dummies don't hit back", 'round', 2.6);
  else slashBanner('ROUND ' + (wave + 1), 'Get ready…', 'round', 2.6);
}
// (each frame: true while everyone's held still)
function holdForCountdown(dt) {
  let text = '';
  if (COUNT.wait) text = 'WAITING FOR YOUR FRIEND TO PRESS PLAY…';
  else if (COUNT.t > 0) { COUNT.t -= dt; text = COUNT.t > 2.8 ? '3' : COUNT.t > 1.8 ? '2' : COUNT.t > 0.8 ? '1' : 'FIGHT!'; }
  if (text !== COUNT.shown) {
    const el = $('countdown');
    el.textContent = text; el.className = text.length > 6 ? 'wait' : text === 'FIGHT!' ? 'fight' : 'num';
    if (text) bump(el, el.className);
    COUNT.shown = text;
  }
  return COUNT.wait || COUNT.t > 0.8;
}

// make a HUD bit jump (restarting its animation)
function bump(el, cls = 'bump') { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

function updateUI(dt) {
  // your power (white, then blue as it charges, gold at full), and your damage under it
  const pw = Math.round(P.power), pEl = $('pow');
  if (pw !== UI.lastPow) {
    pEl.textContent = pw;
    pEl.style.color = powColor(pw);
    $('you').style.setProperty('--p', Math.min(100, pw));   // (the ring round your face fills up with it)
    $('you').style.setProperty('--rc', pw >= 100 ? '#ffd23a' : pw >= 50 ? '#5ad1ff' : '#b8c4ff');
    $('you').classList.toggle('max', pw >= 100);
    if (pw > (UI.lastPow || 0) + 4) bump(pEl);
    UI.lastPow = pw;
  }
  // your special move: its name, and a bar that fills as it comes back (see specials.js)
  { const S = specialOf(), t = S ? 1 - (P.spCool || 0) / S.cd : 0, el = $('spBar');
    if (el.dataset.n !== (S ? S.name : '')) { el.dataset.n = S ? S.name : ''; $('spName').textContent = S ? S.name : ''; $('spKey').innerHTML = keysFor('special'); }
    $('spFill').style.width = (t * 100).toFixed(1) + '%'; el.classList.toggle('ready', t >= 1); }
  const d = Math.round(P.dmg);
  $('dmg').textContent = d + '%';
  $('dmgfill').style.width = Math.min(100, d / 1.5) + '%';
  $('dmgfill').style.background = dmgColor(d) === '#ffffff' ? '#7fe05a' : dmgColor(d);
  if (d > UI.lastDmg) bump($('you'), 'shake');
  UI.lastDmg = d;

  // the combo: 2 HITS, 3 HITS... (and a FINISHER!)
  const cEl = $('combo');
  if (P.combo !== UI.lastCombo) {
    if (P.combo >= 2) { cEl.innerHTML = `<b>${P.combo}</b> HITS`; bump(cEl, 'slamc'); }
    UI.lastCombo = P.combo;
  }
  cEl.classList.toggle('show', P.combo >= 2);
  if (P.comboName) { banner(P.comboName + '!', 'good'); P.comboName = null; }   // (a combo: see combos.js)

  // the fighters: a chip each, with their power (and their damage, a little bar under it)
  if (UI.chips.length !== fighters.length) {
    $('foes').innerHTML = fighters.map((F, i) => `<div class="chip" id="chip${i}" style="--fc:#${F.color.toString(16).padStart(6, '0')}">${faceHTML(F.color)}<div><div><b>0</b><small>%</small></div><div class="bar"><i></i></div><em>${(SPECIALS[styleOf(F).special] || { name: '' }).name}</em></div></div>`).join('');
    UI.chips = fighters.map((F, i) => ({ el: $('chip' + i), last: 0, lastD: -1 }));
  }
  fighters.forEach((F, i) => {
    const c = UI.chips[i], fp = Math.round(F.power || 0), fd = Math.round(F.dmg), b = c.el.querySelector('b');
    if (fp !== c.last) { b.textContent = fp; b.style.color = powColor(fp); c.last = fp; }
    if (fd !== c.lastD) { const bar = c.el.querySelector('.bar i'); bar.style.width = Math.min(100, fd / 1.5) + '%'; bar.style.background = dmgColor(fd) === '#ffffff' ? '#7fe05a' : dmgColor(fd); if (fd > c.lastD && c.lastD >= 0) bump(c.el); c.lastD = fd; }
    c.el.classList.toggle('down', F.B.limp);
  });

  // the score, and big messages when it changes
  if (koCount !== UI.lastKO) { banner('RING-OUT!', 'good'); bump($('score')); UI.lastKO = koCount; }
  if (falls !== UI.lastFalls) { banner('YOU FELL!', 'bad'); UI.lastFalls = falls; }
  if (wave !== UI.lastWave) { slashBanner('ROUND ' + (wave + 1), champWave(wave) ? 'A CHAMPION is coming!' : 'FIGHT!', 'round', 2); UI.lastWave = wave; }
  $('kos').textContent = koCount;
  $('falls').textContent = falls;
  // (single player: your lives, a heart each. Online, and on the practice ground, it's falls instead)
  const noLives = NET.on || PRACTICE.on;
  $('livesWrap').style.display = noLives ? 'none' : '';
  $('fallsWrap').style.display = noLives ? '' : 'none';
  if (!noLives && LIFE.lives !== UI.lastLives) {
    $('lives').textContent = '♥'.repeat(LIFE.lives) || '0';
    if (LIFE.lives < UI.lastLives) bump($('livesWrap'), 'shake'); else if (UI.lastLives != null) bump($('livesWrap'));
    UI.lastLives = LIFE.lives;
  }
  $('wave').textContent = NET.on ? NET.WIN : wave + 1;

  // what to do right now (and a warning when they're dragging you off)
  const dragged = body.limp && fighters.some(F => F.grab);
  const msg = dragged ? 'They\'re dragging you to the edge! Press a key to get up!' : body.limp ? (held('flop') ? 'Floppy! Let go of ' + keyName(BINDS.flop[0]) + ' to get up' : '') : P.hint;
  const pr = $('prompt');
  if (pr.textContent !== (msg || '')) pr.textContent = msg || '';
  pr.classList.toggle('show', !!msg);
  pr.classList.toggle('danger', dragged);

  // the controls card tucks itself away after a while (H brings it back)
  UI.helpT -= dt;
  $('help').classList.toggle('hide', UI.helpT <= 0);
}

// the title screen, or the pause screen
// the title box: as big as it'll go, filling the screen's height (and up to about half its width)
const MENU_W = 600, MENU_H = 700;
function fitTitle() {
  // (every menu is the same size, MENU_W by MENU_H, all zoomed the same to fit the window: see style.css)
  $('overlay').style.setProperty('--mz', Math.min((innerHeight - 40) / (MENU_H + 14), innerWidth * 0.56 / MENU_W, 2.2).toFixed(3));
}
addEventListener('resize', fitTitle);
// (and again whenever what's in it changes size: the buttons appearing once it's loaded, the font arriving)
document.fonts && document.fonts.ready.then(fitTitle);
new ResizeObserver(() => { clearTimeout(fitTitle.t); fitTitle.t = setTimeout(fitTitle, 50); }).observe(document.querySelector('#overlay .box'));
// RESET: wipes everything the game remembers (your ring-outs, so the gear's locked again; the combos you've
// done; your look) and starts again. Click twice, so you can't do it by accident.
// ---------------------------------------------------------------- the title screen: START or NEW GAME
// START: on to the menu, everything as you left it. NEW GAME: wipes everything the game remembers (your
// ring-outs, so the gear's locked again; the combos you've done; your look) and starts again: click it twice,
// so you can't do it by accident. (After a new game, it goes straight to the menu.)
function closeSplash() { $('overlay').classList.remove('splash', 'wait'); fitTitle(); if (typeof hideCrowd === 'function') hideCrowd(); }
if (sessionStorage.getItem('ragdollSkipSplash')) { sessionStorage.removeItem('ragdollSkipSplash'); closeSplash(); }
$('startBtn').onclick = closeSplash;
setTimeout(() => $('overlay').classList.remove('wait'), 12000);   // (if the brawl never turns up: don't keep the sky over everything)
$('newBtn').onclick = () => {
  const b = $('newBtn');
  if (!b.classList.contains('sure')) {
    b.classList.add('sure'); b.textContent = 'SURE? CLICK AGAIN';
    $('splashNote').textContent = 'This wipes your unlocked gear, your combos, your look and your best wave!';
    clearTimeout(b.t); b.t = setTimeout(() => { b.classList.remove('sure'); b.textContent = 'NEW GAME'; $('splashNote').textContent = 'START carries on where you left off. NEW GAME starts again from nothing.'; }, 3500);
    return;
  }
  for (const k of ['ragdollLook', 'ragdollRingouts', 'ragdollCombos', 'ragdollBestWave', 'ragdollBestRingouts']) localStorage.removeItem(k);
  sessionStorage.setItem('ragdollSkipSplash', '1');
  location.reload();
};
function showMenu(paused) {
  $('countdown').textContent = ''; COUNT.shown = '';   // (the countdown's hidden behind the menu)
  $('overlay').style.display = 'flex';
  if (paused && typeof newPicture === 'function') newPicture();   // (a different funny picture each time: see pictures.js)
  $('overlay').classList.toggle('paused', paused);
  $('play').textContent = paused ? 'RESUME' : 'PLAY';
  $('hud').classList.add('hidden');
  if (paused) $('pauseScore').textContent = PRACTICE.on ? `Practice ground  ·  Dummies knocked off: ${koCount}` : NET.on ? `Ring-outs: ${koCount}  ·  Falls: ${falls}` : `Wave ${wave + 1}  ·  Lives: ${LIFE.lives}  ·  Ring-outs: ${koCount}`;
  fitTitle();
}
function hideMenu() {
  $('overlay').style.display = 'none';
  $('hud').classList.remove('hidden');
}
