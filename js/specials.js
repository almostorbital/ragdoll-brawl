// SPECIAL MOVES: like in a fighting game, every colour has its own special move (Q). It takes a while to come
// back after you've used it (the bar under your power fills up again). The fighters have theirs too, the
// same as yours for their colour: the light blue one dashes at you, the white one teleports behind you...
// A special works on whoever's doing it (who: P for you, or a fighter): its foes are the fighters (and the
// other player online) if it's you, or just you if it's a fighter.
'use strict';
const SPECIALS = {
  haymaker:  { name: 'HAYMAKER',    cd: 6,  range: 2.4, desc: 'A massive wind-up punch that sends them flying.' },
  dash:      { name: 'DASH',        cd: 5,  range: 7,   desc: 'Zoom forward, barging into anyone in the way.' },
  skyslam:   { name: 'SKY SLAM',    cd: 7,  range: 5,   desc: 'Leap up high, then slam down: everyone round you goes flying.' },
  spinkick:  { name: 'SPIN KICK',   cd: 5,  range: 2.2, desc: 'A spinning kick that hits everyone round you.' },
  surge:     { name: 'POWER SURGE', cd: 9,  range: 4,   desc: 'Fill up your POWER in one go, with a blast that pushes them back.' },
  homerun:   { name: 'HOME RUN',    cd: 8,  range: 3,   desc: 'For 4 seconds, your hits send them more than twice as far.' },
  rage:      { name: 'RAGE',        cd: 10, range: 4,   desc: 'For 5 seconds: hit 50% harder and run faster.' },
  backflip:  { name: 'BACKFLIP',    cd: 4,  range: 2,   desc: 'Flip back out of trouble: nothing can hit you while you flip.' },
  flurry:    { name: 'MEGA FLURRY', cd: 6,  range: 2.4, desc: 'Six punches in a blur, the last one a whopper.' },
  iron:      { name: 'IRON BODY',   cd: 10, range: 3,   desc: 'For 4 seconds you hardly budge, however hard they hit you.' },
  teleport:  { name: 'SWAP',        cd: 7,  range: 12,  desc: 'Look at a fighter (a blue ring shows who) and swap places with them. Swap at the edge and THEY fall off!' },
  clone:     { name: 'DOUBLE',      cd: 14, range: 4,   desc: 'A copy of you (your size, your gear) pops up and fights on YOUR side for 15 seconds!' },
  quake:     { name: 'EARTHQUAKE',  cd: 8,  range: 4.5, desc: 'Stomp the ground: everyone near you gets thrown off their feet.' },
};
// (the buffs a special gives: stats, multiplied in with your style's: see styleStat in custom.js)
const BUFFS = { homerun: { heft: 2.3 }, rage: { punch: 1.5, kick: 1.5, speed: 1.25 }, iron: { tough: 6, speed: 0.75 } };
const specialOf = (who = P) => SPECIALS[styleOf(who).special] || null;
const SP = { later: [] };   // (bits of a move that happen a moment later: { t, who, fn })

// ---------------------------------------------------------------- whoever's doing it
const isP = who => who === P;
const bodyOfW = who => isP(who) ? playerBody : who.B;
const foesOf = who => isP(who) ? fighters.filter(F => F.B.pos.length) : (playerBody.pos.length ? [P] : []);
const foeBody = f => f === P ? playerBody : f.B;
const _spF = V3(), _spQ = V3(), _spD = V3();
// the foes within r (and, with cone, in front): nearest first, each with how far and which way
function foesNear(who, r, cone) {
  const out = [];
  fwdOf(who.yaw, _spQ);
  for (const f of foesOf(who)) {
    const c = foeBody(f).pos[7];
    const dx = c.x - who.pos.x, dz = c.z - who.pos.z, d = Math.hypot(dx, dz);
    if (d > r || Math.abs(c.y - who.pos.y - 0.8) > 2.2) continue;
    if (cone && d > 0.3 && (dx * _spQ.x + dz * _spQ.z) / d < cone) continue;
    out.push({ f, d, dir: V3(dx, 0, dz).divideScalar(d || 1) });
  }
  return out.sort((a, b) => a.d - b.d);
}
// a special's hit lands on f (k: which body point)
function spHit(who, f, dmg, dir, heft = 1, k = 7) {
  if (isP(who)) playerHits(f, dmg, dir, k, heft * styleStat('heft'), 'special');
  else if (f === P) { if (P.invT > 0 || playerBody.limp && P.hitT > 0) return; fighterHits(who, dmg, dir, k, heft * styleStat('heft', who)); }
}
// a ring of hits round who (a stomp, a blast)
function shockwave(who, r, dmg, heft, up = 0.6, color = 0xffffff) {
  fxDust(who.pos, r * 0.8);
  groundRing(who.pos, r, color, 0.45);
  FX.shake = Math.max(FX.shake, isP(who) ? 0.35 : 0.2);
  sfx('pound');
  for (const { f, d, dir } of foesNear(who, r)) spHit(who, f, dmg * (1 - d / (r * 2)), dir.clone().setY(up).normalize(), heft);
}
// the fighter you're looking at (the nearest to the middle of the screen), within TELE_RANGE of you: or null
const TELE_RANGE = 14, _ls = V3(), _ld = V3();
function lookedAtFoe() {
  camera.getWorldDirection(_ld);
  let best = null, bestDot = 0.95;
  for (const F of fighters) {
    const c = F.B.pos[7];
    if (!c || Math.hypot(c.x - P.pos.x, c.z - P.pos.z) > TELE_RANGE) continue;
    _ls.subVectors(c, camera.position).normalize();
    const d = _ls.dot(_ld);
    if (d > bestDot) { bestDot = d; best = F; }
  }
  return best;
}
// shift a whole ragdoll somewhere else (teleporting)
function moveWho(who, x, z) {
  const B = bodyOfW(who), y = terrainH(x, z);
  _spD.set(x - who.pos.x, y - who.pos.y, z - who.pos.z);
  who.pos.add(_spD);
  for (let i = 0; i < 13; i++) { B.pos[i].add(_spD); B.prev[i].add(_spD); B.targets[i].add(_spD); }
  who.vel.set(0, 0, 0); who.onGround = true;
}
const later = (who, t, fn) => SP.later.push({ t, who, fn });
// make a punch (or a kick) for the look of it: the special does the hitting
function swingFist(who, kick) {
  if (isP(who)) {
    if (kick) { P.kick = { leg: P.nextLeg, t: 0, hit: true, how: {} }; P.nextLeg = 1 - P.nextLeg; }
    else { P.punch = { hand: P.nextFist, t: 0, hit: true, hammer: false, wind: PUNCH_WIND, how: {} }; P.nextFist = 1 - P.nextFist; }
  } else {
    who.punch = { hand: who.nextFist, t: 0, hit: true, power: true, kick: !!kick }; who.nextFist = 1 - who.nextFist;
  }
}
// turn to face the nearest foe in front (or near)
function faceFoe(who, r) {
  const n = foesNear(who, r, -0.2)[0];
  if (n) { who.yaw = Math.atan2(-n.dir.x, -n.dir.z); if (!isP(who)) who.face = who.yaw; }
  return n;
}
function shout(who, text, kind) {
  fxWord(text, bodyOfW(who).pos[0], isP(who) ? 'you' : '', 1);
  if (isP(who) && NET.on) netSend({ t: 'sp', n: text, k: kind });   // (so they see it over you, on their screen)
}

// ---------------------------------------------------------------- doing one
function doSpecial(who) {
  const S = specialOf(who), kind = styleOf(who).special;
  const B = bodyOfW(who);
  if (!S || B.limp || (who.spCool || 0) > 0) return false;
  who.spCool = S.cd * (isP(who) ? 1 : rand(1.4, 2));
  shout(who, S.name + '!', kind);
  sfx('combo');
  fwdOf(who.yaw, _spF);
  specialShow(who, kind);
  switch (kind) {
    case 'haymaker': {
      // wind up (twisting back, the fist glowing), then the punch
      faceFoe(who, 2.6);
      setPose(who, 'windup', 0.32);
      later(who, 0.3, () => { faceFoe(who, 2.8); swingFist(who); setPose(who, 'lunge', 0.25); if (isP(who)) lungeAt(0.7); });
      later(who, 0.42, () => {
        const n = foesNear(who, 2.5, 0.3)[0];
        if (!n) return;
        spHit(who, n.f, 26, n.dir.clone().setY(0.35).normalize(), 1.7, 0);
        const at = foeBody(n.f).pos[0];
        fxPart('burst', at, { life: 0.35, s0: 0.4, s1: 3.2, fade: true, color: 0xff8a00, spin: 0 });
        groundRing(foeBody(n.f).pos[7], 2.5, 0xff8a00, 0.4);
        FX.shake = Math.max(FX.shake, 0.4);
      });
      break;
    }
    case 'dash': {
      faceFoe(who, 7);
      fwdOf(who.yaw, _spF);
      who.dashT = 0.32; (who.dashV || (who.dashV = V3())).copy(_spF).multiplyScalar(15);
      who.barged = [];
      setPose(who, 'lean', 0.4);
      break;
    }
    case 'skyslam':
      who.vel.y = 12.5; who.onGround = false; who.spSlam = 'sky';
      who.vel.x *= 0.3; who.vel.z *= 0.3;
      setPose(who, 'frontflip', 0.55);
      smoke(who.pos, 10, 0.8);
      // (at the top: straight down, head first... no, feet first!)
      later(who, 0.62, () => { if (who.spSlam && !who.onGround) who.vel.y = Math.min(who.vel.y, -16); });
      break;
    case 'spinkick':
      swingFist(who, true);
      who.spinT = 0.45;
      setPose(who, 'tilt', 0.45);
      later(who, 0.15, () => { for (const { f, dir } of foesNear(who, 2.3)) spHit(who, f, 18, dir.clone().setY(0.4).normalize(), 1.35, 7); });
      break;
    case 'surge':
      who.power = 100;
      setPose(who, 'flex', 0.7);
      later(who, 0.25, () => shockwave(who, 3.5, 5, 1.2, 0.3, 0xffc400));
      break;
    case 'homerun': case 'rage': case 'iron':
      who.buff = BUFFS[kind]; who.buffT = kind === 'rage' ? 5 : 4;   // (no show: it just works)
      break;
    case 'backflip': {
      who.vel.x = -_spF.x * 6.5; who.vel.z = -_spF.z * 6.5; who.vel.y = 9.5; who.onGround = false;
      who.invT = 0.9;
      setPose(who, 'backflip', 0.7);
      break;
    }
    case 'flurry': {
      faceFoe(who, 2.6);
      for (let i = 0; i < 6; i++) later(who, i * 0.09, () => {
        swingFist(who);
        // (puffs of smoke off the fists, a blur of them)
        fwdOf(who.yaw, _spQ);
        smoke(_spF.copy(bodyOfW(who).pos[7]).addScaledVector(_spQ, 0.7).setY(bodyOfW(who).pos[1].y), 4, 0.6);
        const n = foesNear(who, 2.4, 0.2)[0];
        if (!n) return;
        spHit(who, n.f, i < 5 ? 4 : 14, n.dir.clone().setY(0.25).normalize(), i < 5 ? 0.6 : 1.5, i % 2 ? 7 : 0);
        fxPart('burst', foeBody(n.f).pos[i % 2 ? 7 : 0], { life: 0.18, s0: 0.2, s1: i < 5 ? 1.1 : 2.6, fade: true, color: 0xb070ff, spin: 0 });
      });
      break;
    }
    case 'teleport': {
      // SWAP: you and the fighter you're looking at (see lookedAtFoe) swap places, in a puff of smoke. Stand
      // at the edge, swap, and they're the one about to fall off! (A fighter swaps with you.) They're dizzy
      // for a moment after.
      const f = isP(who) ? lookedAtFoe() : (Math.hypot(P.pos.x - who.pos.x, P.pos.z - who.pos.z) < 12 && !playerBody.limp ? P : null);
      if (!f) { who.spCool = 0.5; return false; }
      const fb = foeBody(f), mine = who.pos.clone(), theirs = V3(fb.pos[7].x, 0, fb.pos[7].z);
      smoke(bodyOfW(who).pos[7]); smoke(fb.pos[7]);
      who.hideT = 0.22; f.hideT = 0.22;
      later(who, 0.12, () => {
        moveWho(who, theirs.x, theirs.z);
        if (f.remote) netSend({ t: 'swap', x: r3(mine.x), z: r3(mine.z) });   // (online: their computer moves them)
        else { moveWho(f, mine.x, mine.z); dizzy(fb, 1.5); }
        smoke(bodyOfW(who).pos[7]); smoke(V3(mine.x, mine.y + 1, mine.z));
        faceFoe(who, 14);
      });
      break;
    }
    case 'clone':
      // DOUBLE: a copy of you that fights on your side (see allies.js)
      if (!isP(who) || !startAlly()) { who.spCool = 0.5; return false; }
      break;
    case 'quake':
      // a hop, and STOMP
      who.vel.y = 6; who.onGround = false; who.spSlam = 'quake';
      setPose(who, 'tuck', 0.6);
      smoke(who.pos, 6, 0.6);
      break;
  }
  return true;
}
// a slam lands
function specialLands(who) {
  const big = who.spSlam === 'quake';
  who.spSlam = false;
  shockwave(who, big ? 4.5 : 4, big ? 15 : 17, 1.4, 0.6, big ? 0x8a5a3c : 0x2fcf6a);
  groundSmoke(who.pos, big ? 5 : 4);   // (a big cloud of smoke)
  if (big) { groundRing(who.pos, 6.5, 0x5a3a20, 0.7); FX.shake = Math.max(FX.shake, isP(who) ? 0.7 : 0.4); }
}

// ---------------------------------------------------------------- the show
// (how it looks: these happen on the other player's screen too, online)
// A pose: the body's whole goal pose turned about (a flip, a twist, a lean), for a moment. See specialPose.
function setPose(who, kind, dur) { who.pose = { kind, t: 0, dur }; }
const _pq = new THREE.Quaternion(), _pq2 = new THREE.Quaternion(), _pc = V3(), _pa = V3(), _pr = V3();
const ease = k => k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k);
// (called with the goal pose, just before it's set: see buildGoals in player.js, fighterGoals in fighters.js)
function specialPose(who, goal) {
  const po = who.pose;
  if (!po) return;
  const k = Math.min(1, po.t / po.dur);
  rightOf(who.yaw, _pr);
  _pq.identity();
  if (po.kind === 'backflip') _pq.setFromAxisAngle(_pr, Math.PI * 2 * ease(k));
  else if (po.kind === 'frontflip') _pq.setFromAxisAngle(_pr, -Math.PI * 2 * ease(k));
  else if (po.kind === 'lean') _pq.setFromAxisAngle(_pr, -0.6 * Math.sin(Math.min(1, k * 3) * Math.PI / 2) * (1 - k * k));
  else if (po.kind === 'windup') { _pq.setFromAxisAngle(UP, 0.9 * Math.sin(k * Math.PI / 2)); _pq2.setFromAxisAngle(_pr, 0.3 * k); _pq.premultiply(_pq2); }
  else if (po.kind === 'lunge') _pq.setFromAxisAngle(_pr, -0.35 * Math.sin(k * Math.PI));
  else if (po.kind === 'tilt') _pq.setFromAxisAngle(fwdOf(who.yaw, _pa), 0.45 * Math.sin(k * Math.PI));
  else if (po.kind === 'tuck') _pq.setFromAxisAngle(_pr, -0.4 * Math.sin(k * Math.PI));
  else if (po.kind === 'flex') {
    // arms up, fists clenched: a "come on!"
    const up = Math.sin(Math.min(1, k * 2.5) * Math.PI / 2) * (1 - Math.max(0, k - 0.75) * 4);
    for (let i = 0; i < 2; i++) { goal[5 + i].lerp(_pa.copy(goal[1 + i]).addScaledVector(UP, 0.55 * S), up); goal[3 + i].lerp(_pa.copy(goal[1 + i]).addScaledVector(_pr, (i ? 1 : -1) * 0.3 * S).addScaledVector(UP, 0.15 * S), up); }
    return;
  }
  // (turned about its middle)
  _pc.set(0, 0, 0); for (let i = 0; i < 13; i++) _pc.add(goal[i]); _pc.divideScalar(13);
  for (let i = 0; i < 13; i++) goal[i].sub(_pc).applyQuaternion(_pq).add(_pc);
}
// the colour it glows, for a special (and how long)
const SP_GLOW = { clone: [0x5ee0c0, 0.8], haymaker: [0xff6a00, 0.45], surge: [0xffc400, 1.2], backflip: [0xffffff, 0.7], teleport: [0x22e0ff, 0.6], dash: [0x22c3e6, 0.5], flurry: [0xb070ff, 0.6], spinkick: [0x9ad63a, 0.5], skyslam: [0x2fcf6a, 1], quake: [0x8a5a3c, 0.8] };
function specialShow(who, kind) {
  const g = SP_GLOW[kind];
  if (g) { who.glowC = col(g[0]); who.glowK = kind; who.glowT = g[1] || (kind === 'rage' ? 5 : 4); who.glowDur = who.glowT; }
  const B = bodyOfW(who);
  if (!B.pos.length) return;
  if (kind === 'surge') {
    groundRing(who.pos, 2.2, g[0], 0.5);
    for (let i = 0; i < 10; i++) fxPart('star', V3(B.pos[7].x + rand(-0.4, 0.4), B.pos[7].y + rand(-0.4, 0.6), B.pos[7].z + rand(-0.4, 0.4)), { life: rand(0.5, 0.9), vel: V3(rand(-1, 1), rand(2, 4), rand(-1, 1)), drag: 2, s0: 1.4, s1: 0.2 });
  }
  if (kind === 'teleport' && who.remote) who.hideT = 0.25;
  if (kind === 'skyslam' || kind === 'backflip' || kind === 'dash') fxDust(who.pos, 0.8);
}
function smoke(at, n = 12, s = 1) {
  for (let i = 0; i < n; i++) fxPart('puff', at, { life: rand(0.35, 0.6) * (0.7 + s * 0.3), vel: V3(rand(-2.5, 2.5), rand(-1, 2.5), rand(-2.5, 2.5)).multiplyScalar(s), drag: 5, s0: rand(0.6, 1.1) * s, s1: 0.05, spin: 0 });
}
// a big cloud of smoke rolling out along the ground (a slam, a stomp)
function groundSmoke(at, r) {
  const n = Math.round(14 + r * 5);
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + rand(-0.2, 0.2), sp = rand(3, 5.5) * r / 4;
    fxPart('puff', V3(at.x, terrainH(at.x, at.z) + 0.25, at.z), { life: rand(0.7, 1.1), vel: V3(Math.cos(a) * sp, rand(0.3, 1.4), Math.sin(a) * sp), drag: 2.6, s0: rand(1.1, 1.8), s1: 0.1, spin: 0 });
  }
  for (let i = 0; i < 6; i++) fxPart('puff', V3(at.x + rand(-0.4, 0.4), terrainH(at.x, at.z) + 0.4, at.z + rand(-0.4, 0.4)), { life: rand(0.9, 1.3), vel: V3(rand(-0.6, 0.6), rand(2, 3.5), rand(-0.6, 0.6)), drag: 1.5, s0: rand(1.4, 2), s1: 0.2, spin: 0 });
}
// a ring that spreads out across the ground and fades (a shockwave)
SP.rings = [];
function groundRing(at, r, color, life = 0.5) {
  let R = SP.rings.find(R => !R.m.visible);
  if (!R) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 48), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.renderOrder = 4; scene.add(m);
    R = { m }; SP.rings.push(R);
  }
  R.m.visible = true; R.m.material.color.set(color);
  R.m.position.set(at.x, terrainH(at.x, at.z) + 0.06, at.z);
  Object.assign(R, { t: 0, life, r });
}
// (each frame) the glows, the vanishing, the rings
function specialLooks(dt) {
  drawAllies();   // (your double: see allies.js)
  for (const who of [P, ...fighters]) {
    const rig = isP(who) ? playerRig : who.rig;
    if (!rig) continue;
    if (who.hideT > 0) who.hideT -= dt;
    rig.root.visible = !(who.hideT > 0);
    if (who.pose && (who.pose.t += dt) > who.pose.dur) who.pose = null;
    const em = rig.mesh.material.emissive;
    if (isP(who)) em.setRGB(0, 0, 0);
    if (who.glowT > 0) {
      who.glowT -= dt;
      const left = who.glowT / who.glowDur, buff = who.glowK === 'rage' || who.glowK === 'iron' || who.glowK === 'homerun';
      // (a buff pulses for as long as it lasts; the rest flash, and fade)
      const s = buff ? (who.glowK === 'iron' ? 0.55 : 0.35 + 0.25 * Math.sin(performance.now() / 90)) * Math.min(1, who.glowT * 3) : 0.7 * left;
      em.lerp(who.glowC, s);
      // (rage: steam off its head; and a teleport, a home run, a power surge: sparkles)
      if (who.glowK === 'rage' && Math.random() < dt * 12) fxPart('puff', bodyOfW(who).pos[0], { life: 0.5, vel: V3(rand(-0.6, 0.6), 2.2, rand(-0.6, 0.6)), drag: 2, s0: 0.45, s1: 0.05, spin: 0 });
      if (who.glowK === 'homerun' && Math.random() < dt * 10) { const h = bodyOfW(who).pos[5 + (Math.random() < 0.5 ? 0 : 1)]; fxPart('star', h, { life: 0.4, vel: V3(rand(-1, 1), 1.5, rand(-1, 1)), drag: 2, s0: 1, s1: 0.1 }); }
      if (who.glowK === 'dash' && who.dashT > 0) fxPart('puff', bodyOfW(who).pos[7], { life: 0.35, vel: V3(0, 0.3, 0), drag: 2, s0: 0.9, s1: 0.05, spin: 0 });
    }
  }
  for (const R of SP.rings) {
    if (!R.m.visible) continue;
    R.t += dt;
    const k = R.t / R.life;
    if (k >= 1) { R.m.visible = false; continue; }
    R.m.scale.setScalar(0.3 + R.r * (1 - (1 - k) * (1 - k)));
    R.m.material.opacity = 0.85 * (1 - k);
  }
}

// ---------------------------------------------------------------- each frame
// (swap's ready: a ring on the ground under the fighter you're looking at, the one you'd swap with)
let teleMark = null;
const _tmk = V3();
function showTeleMark() {
  const on = styleOf(P).special === 'teleport' && !(P.spCool > 0) && !playerBody.limp && playing;
  if (!teleMark) {
    teleMark = new THREE.Group();
    for (const [r0, r1, o] of [[0.55, 0.7, 0.9], [0.18, 0.26, 0.9]]) {
      const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 40), new THREE.MeshBasicMaterial({ color: 0x22e0ff, transparent: true, opacity: o, depthWrite: false, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.renderOrder = 4; teleMark.add(m);
    }
    scene.add(teleMark);
  }
  const F = on && lookedAtFoe();
  teleMark.visible = !!F;
  if (!F) return;
  const c = F.B.pos[7];
  teleMark.position.set(c.x, terrainH(c.x, c.z) + 0.07, c.z);
  const s = 1 + Math.sin(performance.now() / 160) * 0.08;
  teleMark.scale.set(s, 1, s);
}
function updateSpecials(dt) {
  showTeleMark();
  if (hit('special')) doSpecial(P);
  for (const who of [P, ...fighters]) {
    if (who.remote) continue;
    who.spCool = Math.max(0, (who.spCool || 0) - dt);
    if (who.buffT > 0 && (who.buffT -= dt) <= 0) who.buff = null;
    if (who.invT > 0) who.invT -= dt;
    if (bodyOfW(who).limp) { who.dashT = 0; who.spinT = 0; who.pose = null; who.spSlam = false; continue; }
    // spinning round (a spin kick)
    if (who.spinT > 0) { who.spinT -= dt; who.yaw += Math.PI * 2 / 0.4 * dt; if (!isP(who)) who.face = who.yaw; }
    // dashing: anyone in the way gets barged
    if (who.dashT > -1) who.dashT -= dt;   // (it goes on below 0 for a bit: just after a dash, you don't fall over from being out of your pose)
    if (who.dashT > 0) {
      for (const { f, dir } of foesNear(who, 1.3)) if (!who.barged.includes(f)) { who.barged.push(f); spHit(who, f, 15, dir.clone().setY(0.4).normalize(), 1.4); }
    }
  }
  for (let i = SP.later.length - 1; i >= 0; i--) {
    const L = SP.later[i];
    if ((L.t -= dt) > 0) continue;
    SP.later.splice(i, 1);
    if (!bodyOfW(L.who).limp && (isP(L.who) || fighters.includes(L.who))) L.fn();
  }
}
// a fighter: use its special? (when it's ready, you're in range, and it feels like it)
function fighterSpecial(F, d) {
  const S = specialOf(F);
  if (!S || F.spCool > 0 || F.B.limp || playerBody.limp) return;
  if (F.spCool === undefined) { F.spCool = rand(2, 5); return; }
  if (d < S.range && Math.random() < 0.02) doSpecial(F);
}
// you've died/respawned or a new game: everything resets
function resetSpecials() {
  SP.later.length = 0;
  endAlly(true);
  for (const who of [P, ...FIGHTER_POOL]) { who.spCool = 0; who.buff = null; who.buffT = who.invT = who.dashT = who.spinT = who.glowT = who.hideT = 0; who.pose = null; who.spSlam = false; }
  for (const F of FIGHTER_POOL) F.spCool = undefined;
}
