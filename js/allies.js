// YOUR DOUBLE: mint's special move. A copy of you (your colour, your size, your hat, your gear) drops in beside
// you and fights on your side: it's a ragdoll just like the fighters (the same body, the same moves: see
// fighters.js), but with a brain of its own here, that goes after the fighters instead of you. It's got your
// powers too: your gear's stats, your size's. It lasts ALLY_TIME seconds, or till it's knocked off the island.
// The fighters don't go after it, but their punches land on it if it's in the way.
'use strict';
const allies = [];     // (on the island now: your double, or nobody)
const ALLY_TIME = 15;
let ALLY = null;       // (its ragdoll, loaded once)

new THREE.GLTFLoader().load('models/ragdoll.glb', gltf => {
  const F = {
    B: makeBody(), rig: null, pos: V3(), vel: V3(), yaw: 0, onGround: true, phase: 0, airT: 0,
    punch: null, nextFist: 0, cool: 0, dmg: 0, offT: 0, mode: 'stalk', modeT: 0, think: 0, flank: 0, punchCool: 0, combo: 0, comboMax: 2,
    rock: null, rockHand: 1, rockGrip: null, grab: null, reachFor: null, target: null, leapt: false, face: 0, facing: 0, dodgeDir: 1, strafe: 1, strafeT: 0,
    color: LOOK.color, baseColor: LOOK.color, hitT: 0, speed: 3, gear: { hands: null, feet: null }, ally: true, t: 0, foe: null,
  };
  const old = RIG; F.rig = setupRig(gltf, LOOK.color); RIG = old;
  scene.remove(F.rig.root);
  ALLY = F;
});

// ---------------------------------------------------------------- in, out
function startAlly() {
  const F = ALLY;
  if (!F) return false;
  if (allies.includes(F)) endAlly(true);
  // (dressed as you)
  F.color = F.baseColor = LOOK.color;
  F.rig.mesh.material.color.copy(col(LOOK.color));
  const rig = F.rig;
  if (!rig.face) setFace(rig, 'normal');
  for (const e of rig.eyes) e.brow.scale.y = BROWS[LOOK.brows] || 1;
  if (rig.hat) { rig.hatHold.remove(rig.hat); rig.hat = null; }
  if (LOOK.hat !== 'none') { rig.hat = makeHat(LOOK.hat, rig.headR); rig.hatHold.add(rig.hat); }
  const g = gearOf(F), mine = gearOf(P);
  for (const slot in GEAR) g[slot] = mine[slot] ? newItem(slot, mine[slot].kind) : null;
  setBodySize(F.B, rig, (SIZES[LOOK.size] || SIZES.normal).scale);
  scene.add(rig.root);
  wearGear(F);
  // (beside you: your right, or your left if that's off the island)
  rightOf(P.yaw, _al).multiplyScalar(1.4);
  if (!onIsland(P.pos.x + _al.x, P.pos.z + _al.z, -0.6)) _al.negate();
  let x = P.pos.x + _al.x, z = P.pos.z + _al.z;
  if (!onIsland(x, z, -0.6)) { x = P.pos.x; z = P.pos.z; }
  F.pos.set(x, terrainH(x, z), z); F.vel.set(0, 0, 0); F.yaw = P.yaw; F.face = P.yaw; F.onGround = true;
  Object.assign(F, { dmg: 0, power: 0, punch: null, cool: 0, punchCool: 0, offT: 0, hitT: 0, foe: null, grab: null, rock: null, dropping: false, t: ALLY_TIME, combo: 0, comboMax: 2 });
  withBody(F, () => initBody(F.pos, F.yaw));
  allies.push(F);
  UI.chips = [];
  smoke(F.B.pos[7], 16, 1.1);
  return true;
}
function endAlly(quiet) {
  const F = ALLY, i = allies.indexOf(F);
  if (!F || i < 0) return;
  allies.splice(i, 1);
  if (!quiet && F.B.pos[7]) smoke(F.B.pos[7], 16, 1.1);
  dropRock(F); F.grab = null;
  for (const h of hands) if (h.fb === F) releaseHand(h);
  scene.remove(F.rig.root);
}

// ---------------------------------------------------------------- its brain
// Go for the nearest fighter that's on its feet (online: the other player); get in close, fists up, and throw
// punches and kicks, a few at a time, with a run-up power punch now and then. Nobody to fight? Stay by you.
const _al = V3(), _ad = V3();
function allyBrain(F, dt) {
  F.think -= dt; F.cool -= dt; F.punchCool -= dt;
  const reach = 1.05 * S * F.B.size;
  // (pick who to fight, every so often)
  if (F.think <= 0 || !F.foe || (F.foe.B.limp && !F.foe.remote) || !fighters.includes(F.foe)) {
    F.think = rand(0.4, 0.8);
    let best = null, bd = 30;
    for (const G of fighters) {
      if (G.B.limp && !G.remote) continue;
      const d = Math.hypot(G.pos.x - F.pos.x, G.pos.z - F.pos.z) + (G === F.foe ? -2 : 0);   // (sticks with who it's fighting)
      if (d < bd) { bd = d; best = G; }
    }
    F.foe = best;
  }
  let speed = F.speed, T = null, d = 9;
  if (F.foe) {
    const c = F.foe.B.pos[7];
    _ad.set(c.x - F.pos.x, 0, c.z - F.pos.z); d = _ad.length() || 1e-3; _ad.divideScalar(d);
    F.face = Math.atan2(-_ad.x, -_ad.z);
    if (d > reach * 0.95) {
      T = _al.set(c.x, 0, c.z);
      // (a fair way off: run at it, and sometimes a flying power punch at the end)
      if (d > 3) speed = 5.2;
      else if (F.cool <= 0 && !F.punch && Math.random() < 0.02) { throwPunch(F, true); F.cool = rand(1.5, 2.5); }
    } else if (d < reach * 0.6) _fa.set(-_ad.x * 2, 0, -_ad.z * 2);
    if (d < reach * 1.25 && F.facing < 0.5 && !F.punch && F.punchCool <= 0) {
      throwPunch(F, false, Math.random() < 0.3);
      F.punchCool = rand(0.25, 0.55) + (F.punch.kick ? 0.3 : 0);
      if (++F.combo >= F.comboMax) { F.combo = 0; F.comboMax = 2 + Math.floor(Math.random() * 3); F.punchCool += rand(0.4, 0.9); }
    }
  } else {
    // nobody to fight: stay by you
    const dy = Math.hypot(P.pos.x - F.pos.x, P.pos.z - F.pos.z);
    if (dy > 2.5) T = _al.set(P.pos.x, 0, P.pos.z);
    F.face = Math.atan2(-(P.pos.x - F.pos.x), -(P.pos.z - F.pos.z));
  }
  if (T) {
    _fa.set(T.x - F.pos.x, 0, T.z - F.pos.z);
    const l = _fa.length();
    if (l < 0.3) _fa.set(0, 0, 0); else _fa.multiplyScalar(Math.min(speed, l * 3) / l);
  } else if (!F.foe || d >= reach * 0.6) _fa.set(0, 0, 0);
  return d;
}

// ---------------------------------------------------------------- each frame
function updateAllies(dt) {
  for (const F of allies.slice()) {
    if ((F.t -= dt) <= 0) { endAlly(); continue; }
    withBody(F, () => thinkFighter(F, dt));
  }
}
function drawAllies() {
  const old = RIG;
  for (const F of allies) {
    RIG = F.rig; poseRig(F.B.pos);
    glow(F.rig, F.dmg);
    // (the last couple of seconds: it flickers, about to go)
    F.rig.root.visible = F.t > 2 || Math.sin(F.t * 30) > -0.3;
  }
  RIG = old;
}
