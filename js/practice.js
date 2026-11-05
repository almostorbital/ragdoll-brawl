// THE PRACTICE GROUND: PRACTICE on the menu. The island, with three training dummies on it (sandbag-coloured
// ragdolls) that never hit back: they just stand there, turn to face you, and walk back to their spot after
// you've knocked them about. Knock one off and another drops in. Your special move comes back really fast, so
// you can try it again and again. Ring-outs here don't count towards unlocking gear. LEAVE PRACTICE goes back.
'use strict';
const PRACTICE = { on: sessionStorage.getItem('ragdollPractice') === '1', n: 3, t: 0.8 };
sessionStorage.removeItem('ragdollPractice');   // (a refresh goes back to the normal game)
const DUMMY_COLOR = 0xd8b07a;

addEventListener('load', () => {
  if (NET.on) PRACTICE.on = false;
  const b = document.createElement('button');
  b.id = 'practiceBtn'; b.className = 'small';
  $('onlineBtn').before(b);
  if (NET.on) b.style.display = 'none';
  b.onclick = () => {
    if (PRACTICE.on && !started) { PRACTICE.on = false; practiceLabels(); return; }
    // (from a game that's going: start again, on the practice ground or off it)
    if (started) {
      if (!PRACTICE.on) sessionStorage.setItem('ragdollPractice', '1');
      sessionStorage.setItem('ragdollSkipSplash', '1');
      location.reload(); return;
    }
    PRACTICE.on = true; practiceLabels(); startGame();
  };
  practiceLabels();
});
function practiceLabels() {
  $('practiceBtn').textContent = PRACTICE.on ? 'LEAVE PRACTICE' : 'PRACTICE';
  $('modeTag').textContent = PRACTICE.on ? "Practice ground: try your moves on the dummies. They don't hit back!" : 'Knock them all off the sky island!';
  $('waveLabel').textContent = PRACTICE.on ? 'Practice' : 'Wave';
  $('wave').style.display = PRACTICE.on ? 'none' : '';
}

// (each frame, instead of the waves) keep the dummies on the island; and your special comes back fast
function updatePractice(dt) {
  if (P.spCool > 1) P.spCool = 1;
  if (fighters.length >= PRACTICE.n) return;
  if ((PRACTICE.t -= dt) > 0) return;
  PRACTICE.t = 1.2;
  const F = FIGHTER_POOL.find(F => !fighters.includes(F));
  if (F) bringOnDummy(F);
}
function bringOnDummy(F) {
  fighters.push(F); scene.add(F.rig.root);
  F.dummy = true; F.champ = F.B.champ = false;
  F.B.size = 1; F.B.R = RAG_R;
  F.rig.baseScale = F.rig.baseScale || F.rig.root.scale.x;
  F.rig.root.scale.setScalar(F.rig.baseScale); F.rig.root.updateMatrixWorld(true);
  F.rig.armInv = F.rig.bones.lb.parent.matrixWorld.clone().invert();
  F.color = F.baseColor = DUMMY_COLOR;
  F.rig.mesh.material.color.copy(col(F.color));
  if (F.rig.champHat) { F.rig.champHat.parent.remove(F.rig.champHat); F.rig.champHat = null; }
  const g = gearOf(F); g.hands = g.feet = null; wearGear(F);
  dropIn(F);
  F.home = F.pos.clone();
}
// a dummy's brain: face you; knocked away from its spot, walk back to it
function dummyBrain(F) {
  const d = Math.hypot(P.pos.x - F.pos.x, P.pos.z - F.pos.z) || 1e-3;
  F.face = Math.atan2(-(P.pos.x - F.pos.x), -(P.pos.z - F.pos.z));
  _fa.set(0, 0, 0);
  if (F.home) {
    const hx = F.home.x - F.pos.x, hz = F.home.z - F.pos.z, h = Math.hypot(hx, hz);
    if (h > 1.2) { _fa.set(hx / h * 2, 0, hz / h * 2); if (d > 2.5) F.face = Math.atan2(-hx, -hz); }
  }
  return d;
}
