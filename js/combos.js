// Combos: special moves, spotted as your hits land (see playerHits in fighters.js). Each hits harder (mult),
// shoves harder (heft), charges more POWER, and shouts its name. How many times you've pulled each one off
// is remembered, and shown on the COMBOS page (from the title or pause screen).
//   keys: how to do it, shown as keys on the page (P: punch, K: kick, plus Jump / Run).
'use strict';
const COMBOS = [
  { name: 'ONE-TWO', keys: ['P', 'P'], desc: 'Two quick punches. The second one hits a bit harder.', mult: 1.15, power: 3 },
  { name: 'FINISHER', keys: ['P', 'P', 'K'], desc: 'Punch, punch, KICK! The kick at the end of a combo really sends them.', mult: 1.3, heft: 1.25, power: 12 },
  { name: 'FLURRY', keys: ['P', 'P', 'P', 'P'], desc: 'Four punches in a row: the fourth is a whopper.', mult: 1.6, heft: 1.3, power: 12 },
  { name: 'DOUBLE KICK', keys: ['K', 'K'], desc: 'Two kicks in a row. The second one hits much harder.', mult: 1.35, heft: 1.15, power: 6 },
  { name: 'UPPERCUT', keys: ['Jump', '+', 'P'], desc: 'Punch while you\'re in the air: it sends them flying straight up.', mult: 1.3, heft: 1.1, up: 7, power: 8 },
  { name: 'ROCKET PUNCH', keys: ['Run', '+', 'P'], desc: 'Punch while you\'re running flat out. A huge hit that sends them a long way.', mult: 1.5, heft: 1.5, power: 10 },
  { name: 'GROUND POUND', keys: ['Jump', '+', 'K'], desc: 'Kick in the air to slam down: everyone round you gets knocked flying.', mult: 1.2, heft: 1.3, power: 10 },
];
const COMBO = Object.fromEntries(COMBOS.map(C => [C.name, C]));
const COMBO_DONE = JSON.parse(localStorage.getItem('ragdollCombos') || '{}');   // name → how many times

// what you're doing as you punch or kick (for spotting combos)
const moveHow = () => ({
  air: !P.onGround && !P.hang,
  run: held('run') && Math.hypot(P.vel.x, P.vel.z) > RUN * 0.7,
});

// a hit's landed: is it a combo? (kind: punch or kick; P.moves: the hits in this combo so far, this one last)
function spotCombo(kind, how) {
  const m = P.moves, n = m.length;
  const run = k => { let c = 0; for (let i = n - 1; i >= 0 && m[i] === k; i--) c++; return c; };   // (how many of these in a row, ending with this one)
  if (how.pound) return COMBO['GROUND POUND'];
  if (kind === 'punch' && how.air) return COMBO.UPPERCUT;
  if (kind === 'punch' && how.run) return COMBO['ROCKET PUNCH'];
  if (kind === 'kick' && n >= 3 && m[n - 2] === 'punch') return COMBO.FINISHER;
  if (kind === 'kick' && run('kick') >= 2) return COMBO['DOUBLE KICK'];
  if (kind === 'punch' && run('punch') % 4 === 0) return COMBO.FLURRY;
  if (kind === 'punch' && n === 2 && run('punch') === 2) return COMBO['ONE-TWO'];
  return null;
}
// you did one! (shout it, and count it)
function didCombo(C) {
  P.comboName = C.name;
  sfx('combo');
  COMBO_DONE[C.name] = (COMBO_DONE[C.name] || 0) + 1;
  localStorage.setItem('ragdollCombos', JSON.stringify(COMBO_DONE));
}

// ---------------------------------------------------------------- hitting things that aren't fighters
// A punch or a kick that hits a tree, a boulder, a rock or the ground: it makes a sound (a thwack on wood or
// stone, a thud on the ground), and it still counts in your combo, so a combo on a tree sounds like one too.
// (It doesn't count as doing the combo on the COMBOS page, though: that needs a fighter.)
function hitThing(kind, how, pos, what) {
  const C = chainMove(kind, how);
  sfx('thing', what, pos, kind === 'kick');
  if (C) sfx('combo');
}
// does a fist or a foot touch a tree or a boulder (returns it), or the ground ('ground')?
function strikeWorld(p, r) {
  for (const s of solids) {
    if (Math.abs(s.c.x - p.x) > s.rad + r || Math.abs(s.c.z - p.z) > s.rad + r) continue;
    if (obbContact(s, p, r) > 0) return s;
  }
  return p.y - terrainH(p.x, p.z) < r ? 'ground' : null;
}

// ---------------------------------------------------------------- the ground pound
// kick in the air: you slam straight down (feet first)...
function groundPound() {
  if (P.pound) return;
  P.pound = true;
  P.vel.y = Math.min(P.vel.y, -13); P.vel.x *= 0.3; P.vel.z *= 0.3;
  P.kick = { leg: P.nextLeg, t: 0, hit: true, how: { air: true } };   // (a stamp, for looks: it doesn't hit on its own)
}
// ...and when you land, everyone near you gets knocked away
function poundLands() {
  sfx('pound');
  if (!fighters.some(F => Math.hypot(F.B.pos[7].x - P.pos.x, F.B.pos[7].z - P.pos.z) <= 3)) sfx('combo');
  fxDust(P.pos, 3);
  FX.shake = Math.max(FX.shake, 0.3);
  for (const F of fighters) {
    _t.set(F.B.pos[7].x - P.pos.x, 0, F.B.pos[7].z - P.pos.z);
    const d = _t.length();
    if (d > 3 || Math.abs(F.B.pos[7].y - P.pos.y) > 1.5) continue;
    _t.divideScalar(d || 1); _t.y = 0.7; _t.normalize();
    playerHits(F, 14 * (1 - d / 6), _t, 7, 1.3, 'kick', { pound: true });
  }
}

// ---------------------------------------------------------------- the COMBOS page
function buildCombos() {
  const el = $('combosPanel');
  // (each move as its name, and the key it's on: yours, see controls.js)
  const keyHTML = k => k === '+' ? '<i>+</i>' : `<kbd class="big">${{ P: 'PUNCH', K: 'KICK', Run: 'RUN', Jump: 'JUMP' }[k]} <small>${keyName(BINDS[{ P: 'punch', K: 'kick', Run: 'run', Jump: 'jump' }[k]][0])}</small></kbd>`;
  el.innerHTML = `<h2>COMBOS</h2>
    <p class="note">Chain hits together for special moves! ${keysFor('punch')} punch, ${keysFor('kick')} kick, ${keysFor('jump')} jump, ${keysFor('run')} run.</p>
    <div class="list">${COMBOS.map(C => `<div class="combo" data-c="${C.name}">
      <div class="top"><b>${C.name}</b><span class="done"></span></div>
      <div class="keys">${C.keys.map(keyHTML).join(C.keys.includes('+') ? '' : '<i>›</i>')}</div>
      <p>${C.desc}</p></div>`).join('')}</div>
    <button id="combosDone">DONE</button>`;
  $('combosDone').onclick = closeCombos;
  $('combosBtn').onclick = openCombos;
}
function showCombosDone() {
  document.querySelectorAll('#combosPanel .combo').forEach(d => {
    const n = COMBO_DONE[d.dataset.c] || 0;
    d.classList.toggle('got', n > 0);
    d.querySelector('.done').textContent = n ? `done ${n}×` : 'not done yet';
  });
}
function openCombos() { buildCombos(); showCombosDone(); $('overlay').classList.add('combos'); }
function closeCombos() { $('overlay').classList.remove('combos'); fitTitle(); }
