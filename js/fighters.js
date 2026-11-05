// The other ragdolls: they come after you and try to knock you off the island.
// Each fighter is a ragdoll exactly like yours (the same body, springs and joints, and its own copy of the
// model), with a simple brain instead of the keyboard: walk up to you, put its fists up, circle a bit and
// throw punches. Punches really land: the fist hits body points and shoves them.
// Nobody gets knocked out. Instead, every hit you take adds to your damage (a %), and the more damage you've
// got, the further the next hit sends you: fresh, a punch just rocks you back; battered, it sends you flying.
// (You can see it: a ragdoll glows redder the more damage it's taken.) The only way to win is a ring-out:
// knock them off the edge, or pick one up while it's down and dump it over.
// WAVES: each wave drops in a bunch of fighters (2 in the first, one more each wave, up to 6). Ring them all
// out to clear the wave; after a short breather the next one drops in. Each colour has its own special move
// (see specials.js): the light blue one dashes at you, the white one teleports behind you... From wave 3 the odd one turns up
// already wearing gear (a few more each wave, but never many), and every 5th wave brings a CHAMPION: gold, big,
// with a hammer and spring shoes, and much harder to knock away.
'use strict';
const fighters = [];        // the ones on the island now
const FIGHTER_POOL = [];    // all of them (loaded once; the ones not in this wave wait off stage)
const FIGHTER_COLORS = [0xff4a4a, 0xff9a2a, 0xa45cff, 0x2fcf6a, 0xff5fb0, 0x22c3e6];
const MAX_FIGHTERS = 6;
let koCount = 0, wave = 0;
const waveSize = w => Math.min(MAX_FIGHTERS, 2 + w);
const champWave = w => (w + 1) % 5 === 0;
let waveToDrop = waveSize(0), dropT = 1, waveBreak = 0;
const fGoal = [];

let falls = 0;   // (how many times you've been knocked off)

function loadFighter(i) {
  new THREE.GLTFLoader().load('models/ragdoll.glb', gltf => {
    const F = {
      B: makeBody(), rig: null, pos: V3(), vel: V3(), yaw: 0, onGround: true, phase: Math.random() * 6, airT: 0,
      punch: null, nextFist: 0, cool: 1, dmg: 0, offT: 0, mode: 'stalk', modeT: 0, think: 0, flank: rand(-1.3, 1.3), punchCool: 0, combo: 0, comboMax: 2,
      rock: null, rockHand: 1, rockGrip: null, grab: null, reachFor: null, target: null, leapt: false, face: 0, facing: 0, dodgeDir: 1, strafe: Math.random() < 0.5 ? 1 : -1, strafeT: 0,
      color: FIGHTER_COLORS[i % FIGHTER_COLORS.length], hitT: 0, speed: 2.4, gear: { hands: null, feet: null },
    };
    F.baseColor = F.color;
    const old = RIG;
    F.rig = setupRig(gltf, F.color);
    RIG = old;
    scene.remove(F.rig.root);   // (off stage till its wave)
    FIGHTER_POOL.push(F);
  });
}

// ---------------------------------------------------------------- waves
// (each frame you're playing) drop in this wave's fighters one after another; when they've all been rung
// out, a breather, then the next wave
function updateWaves(dt) {
  if (NET.on) return;   // (online 1v1: no other fighters. See net.js)
  if (FIGHTER_POOL.length < MAX_FIGHTERS) return;   // (still loading)
  if (waveToDrop > 0) {
    dropT -= dt;
    if (dropT > 0) return;
    const F = FIGHTER_POOL.find(F => !fighters.includes(F));
    if (F) bringOn(F, champWave(wave) && waveToDrop === 1);   // (the champion comes last)
    waveToDrop--; dropT = 0.7;
    return;
  }
  if (fighters.length) return;
  if (waveBreak === 0) { waveBreak = 3.5; slashBanner('ROUND CLEAR!', 'You knocked them all off!', 'win', 2.4); return; }
  waveBreak -= dt;
  if (waveBreak <= 0) { waveBreak = 0; wave++; waveToDrop = waveSize(wave); dropT = 1.2; }
}
const ARMED = { hands: ['boxing gloves', 'cartoon hammer'], feet: ['butter shoes', 'spring shoes'] };
// a fighter joins the fight (champ: it's the champion)
function bringOn(F, champ) {
  fighters.push(F); scene.add(F.rig.root);
  F.champ = F.B.champ = !!champ;
  // (the champion's half as big again: its body, and its model to match)
  const size = champ ? 1.5 : 1;
  F.B.size = size; F.B.R = size === 1 ? RAG_R : RAG_R.map(r => r * size);
  const root = F.rig.root;
  F.rig.baseScale = F.rig.baseScale || root.scale.x;
  root.scale.setScalar(F.rig.baseScale * size); root.updateMatrixWorld(true);
  F.rig.armInv = F.rig.bones.lb.parent.matrixWorld.clone().invert();
  // (a colour of its own: any of the colours you can pick, so any of the special moves. Not yours, and not one
  // another fighter on the island has)
  const used = fighters.filter(G => G !== F).map(G => G.baseColor), free = LOOK_COLORS.filter(c => c !== LOOK.color && !used.includes(c) && c !== 0x5ee0c0);
  if (free.length) F.baseColor = free[Math.floor(Math.random() * free.length)];
  F.color = champ ? 0xffd23a : F.baseColor;
  F.rig.mesh.material.color.copy(col(F.color));
  if (F.rig.champHat) { F.rig.champHat.parent.remove(F.rig.champHat); F.rig.champHat = null; }
  // gear: the champion's got the lot; from wave 3, the odd one of the others has something
  const g = gearOf(F);
  g.hands = g.feet = null;
  if (champ) { g.hands = newItem('hands', 'cartoon hammer'); g.feet = newItem('feet', 'spring shoes'); }
  else if (wave >= 2) for (const slot in ARMED) if (Math.random() < Math.min(0.3, (wave - 1) * 0.05)) g[slot] = newItem(slot, ARMED[slot][Math.floor(Math.random() * ARMED[slot].length)]);
  wearGear(F);
  dropIn(F);
  if (champ) { F.speed += 0.2; setTimeout(() => banner('A CHAMPION APPEARS!', 'bad'), 600); }
}
// rung out: off stage till it's needed again
function takeOff(F) {
  for (const h of hands) if (h.fb === F) releaseHand(h);
  dropRock(F); F.grab = null; F.reachFor = null;
  const i = fighters.indexOf(F);
  if (i >= 0) fighters.splice(i, 1);
  scene.remove(F.rig.root);
}

// (re)enter: drop out of the sky somewhere on the island, not too near you
function dropIn(F) {
  for (const h of hands) if (h.fb === F) releaseHand(h);
  let x, z, ok = false;
  for (let k = 0; k < 40 && !ok; k++) {
    const a = Math.random() * Math.PI * 2, d = rand(7, 16);
    x = P.pos.x + Math.cos(a) * d; z = P.pos.z + Math.sin(a) * d;
    ok = onIsland(x, z, -2.5) && groundAt(x, 20, z, 0) - terrainH(x, z) < 0.6;   // (on the ground, not on top of a boulder)
  }
  if (!ok) [x, z] = islandSpot(-3) || [0, 2];
  F.pos.set(x, terrainH(x, z) + 7, z); F.vel.set(0, 0, 0); F.onGround = false; F.airT = 0;
  F.yaw = Math.atan2(-(P.pos.x - x), -(P.pos.z - z));
  F.dmg = 0; F.power = 0; F.punch = null; F.cool = 1.5; F.offT = 0; dropRock(F); F.grab = null; F.mode = 'stalk'; F.modeT = 0; F.reachFor = null;
  F.flank = rand(-1.3, 1.3); F.dropping = true;   // (dropping in: lands on its feet, not in a heap)
  F.speed = Math.min(3.2, 2.2 + wave * 0.12);
  withBody(F, () => initBody(F.pos, F.yaw));
}

// do something with a fighter's body as the current `body`
function withBody(F, fn) {
  const old = body; body = F.B;
  try { return fn(); } finally { body = old; }
}

// ---------------------------------------------------------------- the brain (once a frame)
const _fd = V3(), _ff = V3(), _fr = V3(), _fa = V3(), _fh = V3(), _fe = V3();
function updateFighters(dt) {
  for (const F of fighters.slice()) withBody(F, () => thinkFighter(F, dt));   // (a copy: one rung out leaves the list)
}
function thinkFighter(F, dt) {
  if (F.remote) return;   // (the other player online: a puppet, moved by net.js)
  const B = F.B;
  F.hitT -= dt;
  if (B.limp) {
    B.k = B.damp = B.lift = B.ramp = 0;
    dropRock(F); F.grab = null; F.mode = 'stalk'; F.punch = null;
    B.limpT += dt;
    B.still = bodySpeed() < 0.6 ? B.still + dt : 0;
    hipMid(B.pos, F.pos);
    if (F.pos.y < RINGOUT_Y && F.ally) { endAlly(); return; }   // (your teammate's fallen off: that's it gone)
    if (F.pos.y < RINGOUT_Y) {
      // fell off the island: a ring-out! (and every few, they get a bit tougher)
      koCount++;
      countRingOut();   // (towards unlocking gear: see custom.js)
      returnGear(F);   // (whatever it had on lands back on the island: see loot.js)
      takeOff(F); return;   // (and that's one fewer in this wave)
    }
    if ((B.still > 0.5 && B.limpT > 1.5) || B.limpT > 6) fighterGetUp(F);
    return;
  }
  // knocked well out of its pose (by you, a rock, a crate) for a moment: down it goes
  const off = hipMid(B.pos, _fh).distanceTo(hipMid(B.targets, _fe));
  F.offT = off > 0.5 * S && B.ramp > 0.9 && !F.dropping && !(F.dashT > -0.5) ? F.offT + dt : 0;
  if (B.ramp > 0.5) keepWithBody(F.pos, F.vel, dt);
  if (F.offT > 0.5) { F.offT = 0; goLimp(); return; }

  // decide what to do (see fighterBrain): sets _fa to how fast and which way it wants to go, and F.face
  const d = F.ally ? allyBrain(F, dt) : fighterBrain(F, dt);   // (your teammate's got its own: see allies.js)
  if (!F.ally) fighterSpecial(F, d);   // (its special move: see specials.js)
  // a gap in the way, with somewhere to land just across it? jump it
  const spd = Math.hypot(_fa.x, _fa.z);
  if (F.leaping && F.onGround) F.leaping = false;
  if (spd > 1 && F.onGround && !F.leaping && F.mode !== 'drag' && !F.grab && islandD(F.pos.x + _fa.x / spd * 1.2, F.pos.z + _fa.z / spd * 1.2) > -0.7) {
    const land = gapAcross(F, _fa.x / spd, _fa.z / spd);
    if (land) {
      const up = 6.5 * statOf('jump', F) + Math.max(0, land.h - F.pos.y) * 1.5;
      const t = (up + Math.sqrt(Math.max(0, up * up - 2 * G * (land.h - F.pos.y)))) / G, v = Math.min(7.5, (land.d + 0.7) / t);
      F.vel.set(_fa.x / spd * v, up, _fa.z / spd * v); F.onGround = false; F.leaping = true;
    }
  }
  // (in the air, jumping a gap: keep going)
  if (F.leaping) _fa.set(F.vel.x, 0, F.vel.z);
  // don't walk off the edge: heading for it, turn along it instead (round the bays, along the skinny bits);
  // and if that's no good either, stop
  else if (spd > 1e-3) {
    const ax = F.pos.x + _fa.x / spd * 1.2, az = F.pos.z + _fa.z / spd * 1.2;
    if (F.mode !== 'drag' && islandD(ax, az) > -0.7) {
      islandOut(ax, az, _fe);
      const o = _fa.x * _fe.x + _fa.z * _fe.z;
      if (o > 0) { _fa.x -= _fe.x * o * 1.3; _fa.z -= _fe.z * o * 1.3; }
    }
    const s2 = Math.hypot(_fa.x, _fa.z);
    if (s2 > 1e-3) {
      const bx = F.pos.x + _fa.x / s2 * 1.2, bz = F.pos.z + _fa.z / s2 * 1.2;
      if (groundAt(bx, F.pos.y + 0.5, bz, 0.5) < F.pos.y - 1.5) _fa.set(0, 0, 0);
    }
  }
  // mud (see nature.js)
  const surf = F.onGround ? surfaceAt(F.pos.x, F.pos.z) : null, SF = surf && SURF[surf];
  if (SF) _fa.multiplyScalar(SF.speed);
  _fa.multiplyScalar(statOf('speed', F));   // (its gear: see custom.js. Butter shoes make it slide about too!)
  F.rig && muddy(F.rig, F, surf === 'mud', dt);
  const grip = 1 - Math.exp(-(F.onGround ? (SF ? SF.grip * 0.8 : 8) * statOf('grip', F) : 1.5) * dt), ready = Math.min(1, B.ramp * 1.3);
  F.vel.x += (_fa.x * ready - F.vel.x) * grip;
  F.vel.z += (_fa.z * ready - F.vel.z) * grip;
  if (F.dashT > 0) { F.vel.x = F.dashV.x; F.vel.z = F.dashV.z; }   // (a DASH special)
  let dy = F.face - F.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  F.yaw += dy * (1 - Math.exp(-8 * dt));
  F.facing = Math.abs(dy);

  // move; fall; land
  if (!F.onGround) F.vel.y -= G * dt;
  F.pos.addScaledVector(F.vel, dt);
  F.pos.addScaledVector(WIND.dir, windDrift(F.B) * (F.onGround ? (surf === 'mud' ? 0.3 : 1) : 1.6) * dt);
  fighterWalls(F);
  const g = groundAt(F.pos.x, F.pos.y, F.pos.z, 0.45, props.filter(p => p.type === 'box' && !p.held));
  if (F.onGround) {
    if (g > F.pos.y - 0.5) { F.pos.y = g; F.vel.y = 0; } else { F.onGround = false; F.airT = 0; }
  } else {
    F.airT += dt;
    if (F.vel.y <= 0 && F.pos.y <= g) {
      const impact = -F.vel.y;
      F.pos.y = g; F.vel.y = 0; F.onGround = true;
      if (F.spSlam) specialLands(F);
      else if (impact > 13 && !F.dropping) { goLimp(); return; }
      F.dropping = false;
    }
  }
  if (F.pos.y < RINGOUT_Y + 3) { goLimp(); return; }
  fighterGoals(F, dt, d);
}

// ---------------------------------------------------------------- the brain
// Each fighter is in one of a few moods, and every so often (its reaction time) it looks about and decides:
//  · stalk: hover a few metres away, on the inland side of you (so its hits knock you toward the edge), the
//    fighters spreading out round you. It waits for an opening.
//  · attack: walk in and throw a few punches, then back off. Only two fighters attack at once.
//  · charge: a surprise attack. When you're looking away (or busy with someone else) it sprints at you,
//    sometimes leaping in with a flying punch.
//  · fetch: go and pick up a rock, then come back and smash it into you.
//  · drag: you're down! Grab you by an arm or a leg and haul you to the edge. (Get up to break free.)
//  · dodge: see your punch coming and step aside.
//  · loot: go and pick up some gear lying about, and put it on (see loot.js).
//  · steal: you're down, and you've got gear on! Pinch it.
// A fighter with lots of damage plays it safe: keeps away from the edge, and waits to hit you from behind.
const _bt = V3(), _bs = V3(), _bo = V3();
const attackers = F => fighters.filter(G => G !== F && !G.B.limp && (G.mode === 'attack' || G.mode === 'charge')).length;
function setMode(F, mode, t = 0) { F.mode = mode; F.modeT = t; F.think = rand(0.25, 0.5); }

function fighterBrain(F, dt) {
  const B = F.B, you = playerBody;
  F.modeT -= dt; F.think -= dt; F.cool -= dt;
  _fd.subVectors(P.pos, F.pos); _fd.y = 0;
  const d = _fd.length() || 1e-3; _fd.divideScalar(d);
  const youDown = you.limp, reach = 1.05 * S * B.size;
  // are you looking at it? (and are you busy: punching, or carrying something)
  fwdOf(P.yaw, _bo);
  const seen = -(_bo.x * _fd.x + _bo.z * _fd.z) > 0.35 && !youDown;
  const busy = !!P.punch || hands.some(h => h.pr || h.fb);
  const hurt = F.dmg > 90;
  let T = null, speed = F.speed;   // (where it's heading, and how fast)
  F.face = Math.atan2(-_fd.x, -_fd.z);   // (facing you, unless it says otherwise)

  // --- every so often, look about and decide what to do
  if (F.think <= 0 && F.modeT <= 0 && F.mode !== 'drag') {
    F.think = rand(0.25, 0.55) * Math.max(0.5, 1 - wave * 0.05);
    const free = attackers(F) < 2;
    if (youDown && hasGear(P) && !fighters.some(G => G.mode === 'steal') && !F.rock && d < 9 && Math.random() < 0.85) setMode(F, 'steal', 3);
    else if (youDown && !fighters.some(G => G.mode === 'drag') && !F.rock && d < 9 && !hurt) setMode(F, 'drag');
    else if (youDown) setMode(F, 'stalk');
    else if (!F.rock && F.mode !== 'attack' && F.mode !== 'charge' && Math.random() < 0.5 && wantLoot(F)) { F.target = wantLoot(F); setMode(F, 'loot', 4); }
    else if (!F.rock && !wearing(F, 'cartoon hammer') && F.mode !== 'attack' && F.mode !== 'charge' && Math.random() < (hurt ? 0.5 : 0.25) && nearRock(F)) { F.target = nearRock(F); setMode(F, 'fetch', 5); }
    else if (free && F.cool <= 0 && (!seen || busy) && d > 2.2 && d < 11 && Math.random() < Math.min(0.9, 0.6 * styleStat('aggro', F))) setMode(F, 'charge', 4);
    else if (free && !hurt && F.cool <= 0 && d < 6 && Math.random() < Math.min(0.9, 0.5 * styleStat('aggro', F))) setMode(F, 'attack', rand(1.5, 3));
    else if (F.mode !== 'fetch') setMode(F, 'stalk');
  }
  // --- see a punch coming? step aside
  if (((P.punch && P.punch.t < PUNCH_WIND + 0.05) || (P.kick && P.kick.t < KICK_WIND)) && seen && d < 1.8 && F.mode !== 'dodge' && F.mode !== 'drag' && Math.random() < 0.012 * (1 + wave) * styleStat('dodge', F)) {
    F.dodgeDir = Math.random() < 0.5 ? 1 : -1; setMode(F, 'dodge', 0.35);
  }

  switch (F.mode) {
    case 'dodge':
      _fa.set(-_fd.z * F.dodgeDir * 4.5 - _fd.x * 2, 0, _fd.x * F.dodgeDir * 4.5 - _fd.z * 2);
      if (F.modeT <= 0) setMode(F, 'stalk');
      return d;
    case 'fetch': {
      const pr = F.target;
      // (gone, or it can't get to it: give up)
      if (!pr || pr.held || !onIsland(pr.c.x, pr.c.z, -0.5) || F.modeT <= 0) { F.reachFor = null; setMode(F, 'stalk'); break; }
      _bt.set(pr.c.x, 0, pr.c.z);
      const dr = Math.hypot(_bt.x - F.pos.x, _bt.z - F.pos.z);
      F.face = Math.atan2(-(_bt.x - F.pos.x), -(_bt.z - F.pos.z));
      F.reachFor = pr.c;
      if (dr < 0.75 * S) { pickUpRock(F, pr); setMode(F, 'stalk', 0.6); F.reachFor = null; }
      else { T = _bt; speed = 3.6; }
      break;
    }
    case 'loot': {
      const L = F.target;
      if (!L || !loot.includes(L) || !onIsland(L.pos.x, L.pos.z, -0.5)) { F.reachFor = null; setMode(F, 'stalk'); break; }
      _bt.set(L.pos.x, 0, L.pos.z);
      const dr = Math.hypot(_bt.x - F.pos.x, _bt.z - F.pos.z);
      F.face = Math.atan2(-(_bt.x - F.pos.x), -(_bt.z - F.pos.z));
      F.reachFor = L.pos;
      if (dr < 0.75 * S && L.age > 0.6) { pickUpLoot(F, L); setMode(F, 'stalk', 0.6); F.reachFor = null; }
      else { T = _bt; speed = 3.6; }
      if (F.modeT <= 0) { F.reachFor = null; setMode(F, 'stalk'); }
      break;
    }
    case 'steal': {
      // you're down: run over, grab your hand (or your foot, for shoes) and pull it off
      const slot = gearOf(P).hands ? 'hands' : gearOf(P).feet ? 'feet' : null;
      if (!youDown || !slot) { F.reachFor = null; setMode(F, 'stalk', 0.5); break; }
      let bi = 5, bd = 1e9;
      for (const i of slot === 'hands' ? [5, 6] : [11, 12]) { const q = you.pos[i], dd = Math.hypot(q.x - F.pos.x, q.z - F.pos.z); if (dd < bd) { bd = dd; bi = i; } }
      const q = you.pos[bi];
      F.reachFor = q;
      F.face = Math.atan2(-(q.x - F.pos.x), -(q.z - F.pos.z));
      if (bd < 0.7 * S) { stealGear(F, slot); F.reachFor = null; setMode(F, 'stalk', 1); }
      else { T = _bt.set(q.x, 0, q.z); speed = 4; }
      if (F.modeT <= 0) { F.reachFor = null; setMode(F, 'stalk'); }
      break;
    }
    case 'drag': {
      if (!youDown) { F.grab = null; setMode(F, 'stalk', 0.5); break; }
      if (!F.grab) {
        // go and grab you by whichever hand or foot is nearest
        let bi = 5, bd = 1e9;
        for (const i of [5, 6, 11, 12]) { const q = you.pos[i], dd = Math.hypot(q.x - F.pos.x, q.z - F.pos.z); if (dd < bd) { bd = dd; bi = i; } }
        const q = you.pos[bi];
        F.reachFor = q;
        F.face = Math.atan2(-(q.x - F.pos.x), -(q.z - F.pos.z));
        if (bd < 0.7 * S) { F.grab = { i: bi, hand: 1 }; F.reachFor = null; }
        else { T = _bt.set(q.x, 0, q.z); speed = 3.8; }
        break;
      }
      // got you: walk backwards to the nearest edge, hauling you along, and let go over it
      const grabbed = you.pos[F.grab.i];
      nearestEdge(grabbed.x, grabbed.z, _bt);
      const toEdge = Math.hypot(_bt.x - grabbed.x, _bt.z - grabbed.z);
      F.face = Math.atan2(-(grabbed.x - F.pos.x), -(grabbed.z - F.pos.z));
      const meEdge = nearestEdge(F.pos.x, F.pos.z, _bs);
      if (toEdge < 1.8 && meEdge < 1.6) {
        // right at the edge: heave you over it
        _bs.set(_bt.x - grabbed.x, 0, _bt.z - grabbed.z).normalize();
        _lv.copy(_bs).multiplyScalar(6.5).y = 3.5;
        for (let i = 0; i < 13; i++) you.prev[i].copy(you.pos[i]).addScaledVector(_lv, -H);
        F.grab = null; setMode(F, 'stalk', 1.5); break;
      }
      T = _bt.set(_bt.x + (_bt.x - grabbed.x) / toEdge * 0.5, 0, _bt.z + (_bt.z - grabbed.z) / toEdge * 0.5);
      speed = 2.2;
      break;
    }
    case 'charge':
      // flat out at you, then a big punch (or a flying one)
      T = _bt.set(P.pos.x, 0, P.pos.z); speed = 5.8;
      if (d < 2.6 && d > 1.8 && F.onGround && !F.leapt && Math.random() < 0.35 * styleStat('leap', F)) { F.vel.y = 6.5 * statOf('jump', F); F.onGround = false; F.leapt = true; F.vel.x = _fd.x * 6; F.vel.z = _fd.z * 6; }
      if (d < reach * 1.35 && !F.punch) { throwPunch(F, true); F.cool = rand(1.2, 2.2); setMode(F, 'stalk', 0.8); }
      if (F.modeT <= 0) setMode(F, 'stalk');
      break;
    case 'attack':
      if (d > reach * 0.95) { T = _bt.set(P.pos.x, 0, P.pos.z); speed = F.speed * 1.2; }
      else if (d < reach * 0.6) _fa.set(-_fd.x * 2, 0, -_fd.z * 2);
      if (d < reach * 1.25 && F.facing < 0.5 && !F.punch && F.punchCool <= 0) {
        throwPunch(F, false, Math.random() < 0.3);
        F.punchCool = rand(0.25, 0.6) + (F.punch.kick ? 0.3 : 0);
        if (++F.combo >= F.comboMax) { F.combo = 0; F.comboMax = 1 + Math.floor(Math.random() * 3 * styleStat('chain', F)); F.cool = rand(0.8, 1.8) * Math.max(0.4, 1 - wave * 0.07) / styleStat('aggro', F); setMode(F, 'stalk', 0.6); }
      }
      if (F.modeT <= 0 && F.mode === 'attack') setMode(F, 'stalk');
      break;
  }
  F.punchCool -= dt;
  if (F.mode !== 'charge') F.leapt = false;

  if (F.mode === 'stalk') {
    // hover on the inland side of you, spread out from the others; hurt ones hang further back
    _bo.set(P.pos.x, 0, P.pos.z);
    if (_bo.lengthSq() < 1) _bo.set(-_fd.x, 0, -_fd.z); else _bo.normalize();   // (outward, past you)
    const ring = youDown ? 3 : hurt ? 4.5 : 2.8;
    let ang = Math.atan2(-_bo.z, -_bo.x) + F.flank;
    if (WIND.s > 0.1) ang = Math.atan2(-WIND.dir.z, -WIND.dir.x) + F.flank * 0.5;   // (a gust: get upwind of you, so its hits blow you away)
    T = _bt.set(P.pos.x + Math.cos(ang) * ring, 0, P.pos.z + Math.sin(ang) * ring);
    // (keep the spot on the island, well away from the edge)
    for (let k = 0; k < 6; k++) { const D = islandD(T.x, T.z); if (D < -2) break; islandOut(T.x, T.z, _bs); T.x -= _bs.x * (D + 2.2); T.z -= _bs.z * (D + 2.2); }
    speed = F.speed;
    // with a rock: go and use it
    if (F.rock && F.cool <= 0 && attackers(F) < 2) setMode(F, 'attack', 3);
  }
  if (T) {
    _fa.set(T.x - F.pos.x, 0, T.z - F.pos.z);
    const dt2 = _fa.length();
    if (dt2 < 0.3) _fa.set(0, 0, 0); else _fa.multiplyScalar(Math.min(speed, dt2 * 3) / dt2);
    if (F.mode === 'stalk' && dt2 < 1.5 && d < 4) {   // (bob about a bit while waiting)
      _fa.x += -_fd.z * F.strafe * 0.8; _fa.z += _fd.x * F.strafe * 0.8;
    }
  } else if (F.mode !== 'attack' && F.mode !== 'dodge') _fa.set(0, 0, 0);
  // don't bunch up with the other fighters
  for (const G of fighters) {
    if (G === F || G.B.limp) continue;
    _bs.subVectors(F.pos, G.pos); _bs.y = 0;
    const g = _bs.length();
    if (g < 1.4 && g > 1e-3) _fa.addScaledVector(_bs, (1.4 - g) / g * 2.5);
  }
  F.strafeT -= dt;
  if (F.strafeT < 0) { F.strafeT = rand(1, 3); F.strafe = Math.random() < 0.5 ? 1 : -1; }
  return d;
}

// looking along (dx, dz) from a fighter: a gap, then (within a jump) ground to land on, not too high up?
// Returns how far away that is, and how high ({ d, h }), or null
function gapAcross(F, dx, dz) {
  let gap = false;
  for (let d = 0.5; d < 5; d += 0.25) {
    const x = F.pos.x + dx * d, z = F.pos.z + dz * d, D = islandD(x, z);
    if (D > 0.2) gap = true;
    else if (gap && D < -0.8) { const h = terrainH(x, z); return h < F.pos.y + 1.1 ? { d, h } : null; }
  }
  return null;
}

function throwPunch(F, power, kick) {
  // (or a kick: slower to come, harder when it lands)
  if (kick && !F.rock) { F.punch = { hand: F.nextFist, t: 0, hit: false, power: false, kick: true }; F.nextFist = 1 - F.nextFist; return; }
  const hammer = !F.rock && wearing(F, 'cartoon hammer');   // (a hammer: always swung, with its right hand)
  const hand = F.rock ? F.rockHand : hammer ? 1 : F.nextFist;
  F.punch = { hand, t: 0, hit: false, power: power || !!F.rock, hammer };
  if (!F.rock) F.nextFist = 1 - F.nextFist;
}

// gear lying about that it'd like (not too far; not something another fighter's already going for; and
// mostly for a slot it's got nothing in)
function wantLoot(F) {
  const L = nearLoot(F.pos, 10);
  if (!L || !onIsland(L.pos.x, L.pos.z, -1) || fighters.some(G => G !== F && G.mode === 'loot' && G.target === L)) return null;
  return !gearOf(F)[L.item.slot] || Math.random() < 0.25 ? L : null;
}

// the nearest rock it could carry (not too heavy, not too far, not being held, nearer than you are)
function nearRock(F) {
  let best = null, bd = 9;
  for (const pr of props) {
    if (pr.held || pr.type !== 'box' || pr.mass > 4 || !onIsland(pr.c.x, pr.c.z, -1)) continue;   // (not a ball: there's nowhere to hold one)
    const dd = Math.hypot(pr.c.x - F.pos.x, pr.c.z - F.pos.z);
    if (dd < bd && dd < Math.hypot(P.pos.x - F.pos.x, P.pos.z - F.pos.z) + 2) { bd = dd; best = pr; }
  }
  return best;
}
function pickUpRock(F, pr) {
  F.rock = pr; F.rockHand = 1; F.rockGrip = { l: V3() };
  pr.held = true; pr.heldBy = F.B; wake(pr);
  boxFrame(pr);
  // (held by the side nearest its hand)
  holdSpot(F.rockGrip, pr, _bs.copy(pr.c).addScaledVector(UP, pr.h.y));
}
function dropRock(F) {
  if (!F.rock) return;
  const pr = F.rock;
  if (pr.heldBy === F.B) { pr.held = false; pr.heldBy = null; pr.noBody = 0.25; pr.lastBy = F.B; pr.grace = 1; }
  F.rock = null;
}

// the controller bumps into walls (so it doesn't walk its body into them)
function fighterWalls(F) {
  const r = 0.28 * S;
  for (const h of [0.6, 1.25]) {
    _fh.set(F.pos.x, F.pos.y + h * S, F.pos.z);
    for (const s of solids) {
      const depth = obbContact(s, _fh, r);
      if (!depth || Math.abs(CN.y) > 0.6) continue;
      const nh = Math.hypot(CN.x, CN.z);
      F.pos.x += CN.x / nh * depth; F.pos.z += CN.z / nh * depth;
      _fh.set(F.pos.x, F.pos.y + h * S, F.pos.z);
    }
  }
}

function fighterGetUp(F) {
  const B = F.B, pel = hipMid(B.pos, V3());
  const g = groundAt(pel.x, pel.y, pel.z, 0.6, props.filter(p => p.type === 'box'));
  if (g === -Infinity) return;
  F.pos.set(pel.x, g, pel.z); F.vel.set(0, 0, 0); F.onGround = true; F.punch = null; F.cool = 1.2; F.dropping = false;
  F.yaw = Math.atan2(-(P.pos.x - pel.x), -(P.pos.z - pel.z));
  B.limp = false; B.ramp = 0;
  standPose(fGoal, F.pos, F.yaw);
  for (let i = 0; i < 13; i++) { B.targets[i].copy(fGoal[i]); B.tv[i].set(0, 0, 0); }
}

// where its body should be: walking, fists up like a boxer, punching
const _flp = V3();
function fighterGoals(F, dt, dist) {
  const B = F.B, goal = fGoal;
  fwdOf(F.yaw, _ff); rightOf(F.yaw, _fr);
  standPose(goal, _flp.set(F.pos.x, F.pos.y + springLift(F), F.pos.z), F.yaw);   // (up on its springs, if it's got spring shoes)
  if (B.size !== 1) for (const p of goal) p.sub(_flp).multiplyScalar(B.size).add(_flp);   // (a big one stands big)
  const sp = Math.hypot(F.vel.x, F.vel.z), t = performance.now() / 1000;
  for (let i = 0; i < 13; i++) B.boost[i] = 1;
  if (F.onGround) {
    F.phase += sp * dt / (0.36 * S) * Math.PI / 2;
    const stride = Math.min(sp * 0.075, 0.32) * S, lift = Math.min(sp * 0.035, 0.13) * S;
    for (let i = 0; i < 2; i++) {
      const ph = F.phase + i * Math.PI, fwd = Math.sin(ph) * stride;
      goal[11 + i].addScaledVector(_ff, fwd).y += Math.max(0, Math.cos(ph)) * lift;
      goal[5 + i].addScaledVector(_ff, -fwd * 0.8);
      goal[3 + i].addScaledVector(_ff, -fwd * 0.4);
    }
  } else {
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1;
      goal[11 + i].addScaledVector(_ff, 0.12 * S).y += 0.12 * S;
      goal[5 + i].addScaledVector(_fr, s * 0.25 * S).y += 0.45 * S + Math.sin(t * 14 + i) * 0.12 * S;
      goal[3 + i].addScaledVector(_fr, s * 0.15 * S).y += 0.25 * S;
    }
  }
  // sprinting (charging at you): leaning right forward, arms flung out behind
  if (F.onGround && sp > 4.2) {
    goal[0].addScaledVector(_ff, 0.3 * S).y -= 0.06 * S;
    goal[1].addScaledVector(_ff, 0.2 * S); goal[2].addScaledVector(_ff, 0.2 * S);
    for (let i = 0; i < 2; i++) {
      if (F.rock && i === F.rockHand) continue;
      const s = i ? 1 : -1;
      _fe.copy(_ff).multiplyScalar(-0.8).addScaledVector(UP, -0.5 + Math.sin(t * 22 + i * 2) * 0.12).addScaledVector(_fr, s * 0.22).normalize();
      goal[5 + i].copy(goal[1 + i]).addScaledVector(_fe, (B.len[10 + i * 2] + B.len[11 + i * 2]) * 0.97);
      goal[3 + i].copy(goal[1 + i]).addScaledVector(_fe, B.len[10 + i * 2]);
    }
  }
  // near you: crouch a little and put its fists up (bobbing about)
  else if (F.onGround && dist < 4 && !F.reachFor && !F.grab) {
    const bob = Math.sin(t * 6 + F.phase) * 0.02 * S;
    for (let i = 0; i < 9; i++) goal[i].y -= 0.06 * S - bob;
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1;
      goal[5 + i].copy(goal[1 + i]).addScaledVector(_ff, 0.28 * S).addScaledVector(_fr, -s * 0.06 * S).y += 0.12 * S;
      _fe.copy(_fr).multiplyScalar(s).addScaledVector(UP, -1);
      bendJoint(goal[1 + i], goal[5 + i], B.len[10 + i * 2], B.len[11 + i * 2], _fe, goal[3 + i]);
    }
  }
  // bending down to reach something on the ground (a rock to pick up, you to grab)
  const reachTo = F.reachFor || (F.grab ? playerBody.pos[F.grab.i] : null);
  if (reachTo && F.onGround) {
    const flat = Math.hypot(reachTo.x - F.pos.x, reachTo.z - F.pos.z);
    const bend = F.grab ? 0.25 : clamp(1.6 - flat, 0, 1);   // (bending lower as it gets close)
    for (let i = 0; i < 9; i++) goal[i].y -= bend * 0.45 * S;
    goal[0].addScaledVector(_ff, bend * 0.4 * S); goal[1].addScaledVector(_ff, bend * 0.3 * S); goal[2].addScaledVector(_ff, bend * 0.3 * S);
    if (F.grab) { goal[0].addScaledVector(_ff, -0.15 * S); }   // (leaning back, hauling)
    const i = 1, arm = (B.len[10] + B.len[11]) * 0.98;
    _fe.subVectors(reachTo, goal[2]);
    if (_fe.length() > arm) _fe.setLength(arm);
    goal[6].copy(goal[2]).add(_fe);
    _fh.copy(_fr).addScaledVector(UP, -1);
    bendJoint(goal[2], goal[6], B.len[12], B.len[13], _fh, goal[4]);
  }
  // carrying a rock: held up over its head, ready to bring it down on you
  if (F.rock && !F.punch) {
    const i = F.rockHand, s = i ? 1 : -1;
    goal[5 + i].copy(goal[1 + i]).addScaledVector(UP, (B.len[10 + i * 2] + B.len[11 + i * 2]) * 0.85).addScaledVector(_ff, 0.1 * S).addScaledVector(_fr, -s * 0.08 * S);
    _fe.copy(_fr).multiplyScalar(s).addScaledVector(_ff, -0.3);
    bendJoint(goal[1 + i], goal[5 + i], B.len[10 + i * 2], B.len[11 + i * 2], _fe, goal[3 + i]);
    B.boost[5 + i] = B.boost[3 + i] = 1.6;   // (strong enough to hold it up)
  }
  // punching: wind up, then the fist shoots out at your head (a swung rock comes down from overhead)
  if (F.punch && F.punch.kick) {
    // kicking: knee up, then the foot shoots out at you
    const pu = F.punch, i = pu.hand, leg = B.len[14 + i * 2] + B.len[15 + i * 2];
    pu.t += dt;
    if (pu.t < KICK_WIND * 1.5) {
      goal[11 + i].copy(goal[7 + i]).addScaledVector(_ff, 0.2 * S).y -= leg * 0.55;
    } else if (pu.t < KICK_WIND * 1.5 + KICK_HIT) {
      goal[11 + i].copy(goal[7 + i]).addScaledVector(_ff, leg * 0.97).y -= leg * 0.2;
      goal[0].addScaledVector(_ff, -0.16 * S); goal[1].addScaledVector(_ff, -0.1 * S); goal[2].addScaledVector(_ff, -0.1 * S);
      B.boost[9 + i] = B.boost[11 + i] = 2.8;
    } else if (pu.t > KICK_WIND * 1.5 + KICK_HIT + KICK_BACK) F.punch = null;
  } else if (F.punch) {
    const pu = F.punch, i = pu.hand, s = i ? 1 : -1, reach = B.len[10 + i * 2] + B.len[11 + i * 2];
    pu.t += dt;
    _fa.subVectors(F.ally && F.foe ? F.foe.B.pos[0] : playerBody.pos[0], goal[1 + i]).normalize();   // (at you; or, for your teammate, at who it's fighting)
    if (pu.t < PUNCH_WIND * 1.6) {
      if (F.rock) goal[5 + i].copy(goal[1 + i]).addScaledVector(UP, reach * 0.8).addScaledVector(_ff, -0.2 * S);
      else goal[5 + i].copy(goal[1 + i]).addScaledVector(_ff, 0.1 * S).addScaledVector(_fr, -s * 0.1 * S).y += 0.05 * S;
      goal[1 + i].addScaledVector(_ff, -0.06 * S);
    } else if (pu.t < PUNCH_WIND * 1.6 + PUNCH_HIT) {
      goal[1 + i].addScaledVector(_ff, 0.14 * S);
      goal[2 - i].addScaledVector(_ff, -0.08 * S);
      goal[0].addScaledVector(_ff, 0.06 * S);
      goal[5 + i].copy(goal[1 + i]).addScaledVector(_fa, reach * 1.02);
      B.boost[3 + i] = B.boost[5 + i] = pu.power ? 3.4 : 2.6;
    } else if (pu.t > PUNCH_WIND * 1.6 + PUNCH_HIT + PUNCH_BACK) F.punch = null;
    _fe.copy(_fr).multiplyScalar(s).addScaledVector(UP, -1);
    bendJoint(goal[1 + i], goal[5 + i], B.len[10 + i * 2], B.len[11 + i * 2], _fe, goal[3 + i]);
  }
  _fe.copy(_ff).addScaledVector(UP, 0.2);
  for (let i = 0; i < 2; i++) bendJoint(goal[7 + i], goal[11 + i], B.len[14 + i * 2], B.len[15 + i * 2], _fe, goal[9 + i]);
  specialPose(F, goal);
  setTargets(goal, dt);
  B.ramp = Math.min(1, B.ramp + dt / 0.9);
  const r = B.ramp * B.ramp, air = F.onGround ? 1 : 0.75;
  B.k = ACTIVE_K * r * air; B.damp = ACTIVE_DAMP * r; B.lift = r;
}

// ---------------------------------------------------------------- physics (each small step)
const _fhh = V3();
function stepFighters() {
  for (const F of [...fighters, ...allies]) withBody(F, () => {
    if (F.remote) { remoteRocks(F); return; }   // (the other player online: only your rocks hitting them. See net.js)
    stepBody(WIND.dir.x * windPush(F.B), WIND.dir.z * windPush(F.B));
    const slam = slammed(F.B);
    if (slam) { fxSlam(F.B, slam); F.dmg += slam * 1.6; F.power = Math.max(0, F.power - slam * 5); F.slammed = true; }
    const hitBy = bodyHitsProps();
    if (hitBy && !F.B.limp && F.hitT <= 0) {
      const [dm, heft] = propHit(hitBy), dir = propDir(hitBy, F.B, _fa);
      // (a rock you swung or flung: that's your hit, for your power and your combo)
      if (hitBy.heldBy === playerBody || hitBy.lastBy === playerBody) { if (!F.ally) playerHits(F, dm, dir, 1, heft, 'swing'); }   // (not your teammate, though)
      else hurtFighter(F, dm, dir, 1, heft);
    }
    // carrying a rock: its hand and the rock pull together (like yours do)
    if (F.rock) {
      const pr = F.rock, hand = F.B.pos[5 + F.rockHand];
      if (pr.heldBy !== F.B) F.rock = null;   // (you took it off it!)
      else {
        boxFrame(pr);
        const l = F.rockGrip.l;
        _bs.copy(pr.c).addScaledVector(pr.ax, l.x).addScaledVector(pr.ay, l.y).addScaledVector(pr.az, l.z);
        _bo.subVectors(_bs, hand);
        const gap = _bo.length();
        if (gap > 0.6 * S) dropRock(F);
        else if (gap > 1e-5) {
          const wh = pr.mass / (pr.mass + HAND_MASS);
          hand.addScaledVector(_bo, wh * 0.5);
          _bo.divideScalar(gap);
          shoveProp(pr, _bs, _bo, -gap * (1 - wh) * 0.5);
          stickBox(pr, 2);
        }
      }
    }
    // hauling you along by a hand or foot
    if (F.grab) {
      const q = playerBody.pos[F.grab.i], hand = F.B.pos[5 + F.grab.hand], m = F.B.R[5] + RAG_R[F.grab.i];
      _bo.subVectors(q, hand);
      const gap = _bo.length();
      if (gap > 0.6 * S) F.grab = null;
      else if (gap > m) { _bo.multiplyScalar(Math.min((gap - m) * 0.45, 0.012) / gap); hand.add(_bo); q.sub(_bo); }   // (capped, so it can't whip you about)
    }
    // its punch connects with you?
    const pu = F.punch;
    // (who it can hit: you and your teammate if it's a fighter; the fighters if it's your teammate)
    if (pu && pu.kick && !pu.hit && pu.t > KICK_WIND * 1.5 && pu.t < KICK_WIND * 1.5 + KICK_HIT && !F.B.limp) {
      const foot = F.B.pos[11 + pu.hand];
      for (const T of strikeTargets(F)) {
        const k = fistHits(foot, F.B.R[11 + pu.hand] + 0.07, T === P ? playerBody : T.B);
        if (k >= 0) { pu.hit = true; fwdOf(F.yaw, _fa); _fa.y = 0.25; landStrike(F, T, (k === 0 ? 12 : 9) * statOf('kick', F), _fa.normalize(), k, styleStat('heft', F)); break; }
      }
    } else if (pu && !pu.kick && !pu.hit && pu.t > PUNCH_WIND * 1.6 && pu.t < PUNCH_WIND * 1.6 + PUNCH_HIT && !F.B.limp) {
      const fist = F.B.pos[5 + pu.hand], r = F.B.R[5 + pu.hand] + 0.04;
      // (swinging a hammer: its big head hits, as well as its fist)
      const head = pu.hammer && F.rig.hammerHead ? F.rig.hammerHead.getWorldPosition(_fhh) : null;
      for (const T of strikeTargets(F)) {
        const TB = T === P ? playerBody : T.B;
        let k = fistHits(fist, r, TB);
        if (k < 0 && head) k = fistHits(head, 0.26, TB);
        if (k >= 0) { pu.hit = true; _fa.subVectors(fist, F.B.pos[1 + pu.hand]).normalize(); landStrike(F, T, (k === 0 ? 10 : 7) * (pu.power ? 1.6 : 1) * statOf('punch', F), _fa, k, styleStat('heft', F) * (pu.hammer ? gearStat('heft', F) : 1)); break; }
      }
    }
  });
  // nobody walks through anybody
  const all = [playerBody, ...fighters.map(F => F.B), ...allies.map(F => F.B)];
  for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++) bodiesBump(all[a], all[b]);
}

// who a fighter's fists can land on: you (and your teammate, if you've got one); or, for your teammate, the fighters
const strikeTargets = F => F.ally ? fighters.filter(G => !G.B.limp || G.remote) : [P, ...allies];
// ...and its blow landing on one of them
function landStrike(F, T, dmg, dir, k, heft) {
  if (T === P) return fighterHits(F, dmg, dir, k, heft);
  if (T.remote) return netHit(T, dmg, dir, k, heft);   // (your teammate hits the other player online: their computer does the hit)
  hurtFighter(T, dmg, dir, k, heft);
  F.power = Math.min(100, (F.power || 0) + 8);
  faceFlash(F.B, 'happy', 0.5);
}

// which way a prop that hit a body was going (into out)
// how fast a prop as a whole is going (its middle, not a spinning corner), into out
function propVel(pr, out) {
  out.set(0, 0, 0);
  for (let k = 0; k < pr.pts.length; k++) out.add(pr.pts[k]).sub(pr.prev[k]);
  return out.divideScalar(pr.pts.length * H);
}
function propDir(pr, B, out) {
  propVel(pr, out); out.y = 0;
  if (out.lengthSq() < 1e-10) out.subVectors(B.pos[7], pr.c).setY(0);
  return out.normalize();
}

// which of a body's points does a fist (at p, radius r) hit? (-1: none)
function fistHits(p, r, B) {
  if (Math.abs(p.x - B.pos[7].x) > 2 || Math.abs(p.z - B.pos[7].z) > 2) return -1;
  for (const i of [0, 1, 2, 7, 8, 3, 4, 9, 10, 5, 6]) if (p.distanceTo(B.pos[i]) < r + B.R[i]) return i;
  return -1;
}

// two bodies push each other apart, point by point. (Gently: a little each step, and mostly without turning
// the push into speed. Shoving deeply overlapping bodies apart all at once used to fling people across the
// island, e.g. when a fighter landed right on you.)
const _bb = V3();
function bodiesBump(A, B) {
  if (Math.abs(A.pos[7].x - B.pos[7].x) > 2.5 || Math.abs(A.pos[7].z - B.pos[7].z) > 2.5) return;
  for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) {
    const m = A.R[i] + B.R[j];
    _bb.subVectors(A.pos[i], B.pos[j]);
    const d = _bb.length();
    if (d >= m || d < 1e-5) continue;
    _bb.multiplyScalar(Math.min((m - d) * 0.5, 0.01) / d);
    A.pos[i].add(_bb); B.pos[j].sub(_bb);
    A.prev[i].addScaledVector(_bb, 0.7); B.prev[j].addScaledVector(_bb, -0.7);
  }
}

// a blow lands on a body: point k (and, less, the rest of it) gets shoved along dir
function knock(B, k, dir, speed) {
  for (let i = 0; i < 13; i++) {
    const w = i === k ? 1 : 0.25 / (1 + B.pos[i].distanceTo(B.pos[k]) * 3);
    B.prev[i].addScaledVector(dir, -speed * w * H);
  }
}

// A hit: dmg is added to the body's damage, then it's knocked along dir, harder the more damage it's got.
// A light knock just rocks the part that was hit (point k); a hard one sends the whole body flying.
// Returns the body's new damage.
const LAUNCH = 7;
const _lv = V3();
// (heft: how much weight is behind it. A big rock shoves harder than its damage alone would.)
// (how hard a hit knocks someone: hit and b, how hard a blow is to start with (and how much more a harder
// blow); per, how much damage it takes to double that; max, the fastest anyone flies. You're a good deal
// tougher than the fighters: a plain punch only sends you flying past about 90%, a power punch past about
// 55%. A rock swung at you hits you less hard too (see main.js), and at worst only lifts you off your feet
// when you're fresh.)
// (duel: you and your friend, online. Between a fighter and you: a few good hits and you're flying. See net.js)
const TOUGH = { fighter: { hit: 1, b: 0.25, per: 35, max: 20 }, you: { hit: 0.8, b: 0.12, per: 45, max: 13 }, champ: { hit: 0.7, b: 0.18, per: 55, max: 15 }, duel: { hit: 1, b: 0.2, per: 38, max: 18 } };
function hitBody(B, damage, dmg, dir, k, heft = 1) {
  damage += dmg;
  const T = B === playerBody ? (NET.on ? TOUGH.duel : TOUGH.you) : B.champ ? TOUGH.champ : TOUGH.fighter;
  const who = B === playerBody ? P : fighters.find(F => F.B === B) || allies.find(F => F.B === B);
  const speed = Math.min(T.max, T.hit * (1.5 + dmg * T.b) * (1 + damage / T.per) * heft) / (who ? styleStat('tough', who) : 1);   // (a Tank: harder to knock away)
  fxHit(B, B.pos[k], dmg, speed >= LAUNCH);   // (POW! and stars: see fx.js)
  if (speed < LAUNCH) { knock(B, k, dir, speed + 2); return damage; }
  // sent flying: the whole body, up and away
  withBody({ B }, () => goLimp());
  knockGearOff(B, dir);   // (and maybe their gear goes flying too: see loot.js)
  _lv.copy(dir).setY(0).normalize().multiplyScalar(speed).y = speed * 0.45 + 2;
  for (let i = 0; i < 13; i++) B.prev[i].copy(B.pos[i]).addScaledVector(_lv, -H);
  knock(B, k, dir, 3);
  return damage;
}

// How hard a rock (or any prop) hits: heavier and faster hits harder. A pebble flicked about barely stings;
// a big rock swung into someone sends them flying even when they're fresh. Returns [damage, heft].
const _pvh = V3();
function propHit(pr) {
  const v = propVel(pr, _pvh).length();
  return [clamp(Math.pow(pr.mass, 0.6) * v * 1.6, 4, 45), 1 + Math.min(pr.mass, 16) / 24];
}

// You hit a fighter (a punch, a kick, or a rock you swung). Two things make it hurt more:
//  · your POWER %: land hits to charge it up (combos charge it faster); get hit and it drains away, and it
//    slowly runs down if you stop fighting. At 100% your hits are twice as strong.
//  · your combo: hits landed one after another (each within COMBO_GAP of the last) get stronger and stronger,
//    and some moves are special COMBOS (see combos.js): punch, punch, KICK! is a FINISHER; jump and punch for
//    an UPPERCUT; and more. They hit harder, and charge your power more.
// (how: what move it was, for spotting combos: { air: in the air, run: running, pound: a ground pound })
const COMBO_GAP = 1.1;
// (one more move in your combo: returns the special COMBO it makes, if it does)
function chainMove(kind, how) {
  P.combo = P.comboT > 0 ? P.combo + 1 : 1;
  P.comboT = COMBO_GAP;
  P.moves = P.combo > 1 ? (P.moves || []) : [];
  P.moves.push(kind);
  return kind === 'swing' ? null : spotCombo(kind, how);
}
function playerHits(F, dmg, dir, k, heft = 1, kind = 'punch', how = {}) {
  const C = chainMove(kind, how);
  let mult = (1 + P.power / 100) * Math.min(1.8, 1 + 0.15 * styleStat('combo') * (P.combo - 1)) * statOf(kind);   // (and your style and gear: see custom.js)
  if (C) { mult *= C.mult; heft *= C.heft || 1; didCombo(C); }
  if (F.remote) netHit(F, dmg * mult, dir, k, heft, C && C.up);   // (the other player online: their computer does the hit. See net.js)
  else {
    hurtFighter(F, dmg * mult, dir, k, heft);
    // (an uppercut: up they go)
    if (C && C.up) for (let i = 0; i < 13; i++) F.B.prev[i].y -= C.up * H;
  }
  faceFlash(playerBody, 'happy', 0.5);
  P.power = Math.min(100, P.power + ((kind === 'swing' ? 5 : 6) + 3 * Math.min(P.combo - 1, 4) + (C ? C.power : 0)) * statOf('charge'));   // (the Charger: twice as fast)
  P.powerIdle = 0;
}
// (the combo runs out if you stop landing hits; power runs down if you stop fighting)
function updatePower(dt) {
  P.comboT -= dt;
  if (P.comboT <= 0) P.combo = 0;
  P.powerIdle += dt;
  if (P.powerIdle > 5) P.power = Math.max(0, P.power - 4 * dt);
}

// A fighter hit you. Fighters have power too: theirs goes up as they land hits on you (and makes their hits a
// bit harder), and down when you hit them, or when they're slammed into a tree.
function fighterHits(F, dmg, dir, k, heft = 1) {
  hurtPlayer(dmg * (1 + (F.power || 0) / 200), dir, k, heft);
  F.power = Math.min(100, (F.power || 0) + 8);
  faceFlash(F.B, 'happy', 0.5);
}

// Slammed into a tree or a boulder: someone knocked flying who hits one hard gets hurt (more damage, and
// their power drains away). Returns how hard they hit it (0: they didn't), once per slam.
function slammed(B) {
  const v = B.pos[7].distanceTo(B.prev[7]) / H;
  B.slamT = (B.slamT || 0) - H;
  let hit = 0;
  if (B.limp && B.slamT <= 0 && (B.lastV || 0) > 4.5) {
    for (const i of [0, 1, 2, 7, 8]) {
      const p = B.pos[i];
      for (const s of solids) {
        if (s.noGrab || Math.abs(s.c.x - p.x) > s.rad + 0.5 || Math.abs(s.c.z - p.z) > s.rad + 0.5) continue;
        if (obbContact(s, p, B.R[i] + 0.06) > 0) { hit = B.lastV; break; }
      }
      if (hit) break;
    }
  }
  B.lastV = v;
  if (hit) B.slamT = 0.6;
  return hit;
}

// a fighter gets hit
function hurtFighter(F, dmg, dir, k = 1, heft = 1) {
  if (F.invT > 0) return;   // (mid-BACKFLIP: can't be touched)
  F.power = Math.max(0, (F.power || 0) - dmg * 1.5);
  F.hitT = 0.3;   // (one blow counts once, not again every step it's still touching)
  F.dmg = hitBody(F.B, F.dmg, dmg, dir, k, heft);
  if (F.B.limp) F.punch = null;
}
// a fighter hit you
function hurtPlayer(dmg, dir, k, heft = 1) {
  if (P.invT > 0) return;   // (mid-BACKFLIP: can't be touched)
  P.hitT = 0.3;
  P.power = Math.max(0, P.power - dmg * 1.5);   // (getting hit drains your power)
  P.combo = 0; P.comboT = 0;
  P.dmg = hitBody(playerBody, P.dmg, dmg, dir, k, heft);
  if (playerBody.limp) { P.punch = null; releaseHands(); }
  // (online: a hit that doesn't send you flying still shoves you back a step, harder the more damage you've got)
  else if (NET.on) {
    _lv.copy(dir).setY(0).normalize().multiplyScalar((2.5 + dmg * 0.15) * (1 + P.dmg / 80));
    P.vel.x += _lv.x; P.vel.z += _lv.z;
  }
}

// glow redder the more damage you've taken
const HOT = col(0xff3000);
function glow(rig, dmg) { rig.mesh.material.emissive.copy(HOT).multiplyScalar(Math.min(1, dmg / 150) * 0.75); }

// ---------------------------------------------------------------- drawing
function drawFighters() {
  const old = RIG;
  for (const F of fighters) {
    RIG = F.rig; poseRig(F.B.pos);
    glow(F.rig, F.dmg);
  }
  RIG = old;
}
