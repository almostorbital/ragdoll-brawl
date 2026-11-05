// You: moving about, falling over and getting up, grabbing things, and the camera.
// There's an invisible "controller" (a spot on the ground, a speed, which way you face) that the keys move
// about like any game character. Each frame it says where your body *should* be (standing, a step of the walk,
// arms reaching out), and the ragdoll's springs pull the body there. Fall hard, get hit, run into a wall or
// hold R and the springs let go: the body flops and the controller just follows it until you get back up.
'use strict';
const P = {
  pos: V3(0, 0, 5), vel: V3(), yaw: 0, onGround: true, phase: 0, airT: 0,
  upT: 0, hint: '', regrab: false, punch: null, nextFist: 1, kick: null, nextLeg: 1,
  slide: 0,   // (0 to 1: how much you're sliding about on butter shoes, for the pose: see buildGoals)
  power: 0, powerIdle: 0, combo: 0, comboT: 0, lungeT: 0, lungeV: V3(),   // (your power %, and the combo you're on: see playerHits in fighters.js)
  hang: false, climb: 0, swing: V3(), ledge: null,
  dmg: 0,   // (your damage %: the higher it is, the further hits send you. See fighters.js)
};
const cam = { yaw: 0, pitch: 0.3, dist: 4.2, target: V3() };
const goal = [];
const WALK = 3.4, RUN = 6.5, JUMP = 7;

function respawn() {
  const [sx, sz, syaw] = spawnSpot();   // (online, the other player starts across the island: see net.js)
  P.pos.set(sx, terrainH(sx, sz), sz); P.vel.set(0, 0, 0); P.yaw = syaw; cam.yaw = syaw; P.onGround = true; P.dmg = 0;
  P.power = 0; P.combo = 0; P.comboT = 0; P.kick = null;
  releaseHands();
  initBody(P.pos, P.yaw);
  cam.target.copy(body.pos[7]);
}

// ---------------------------------------------------------------- moving
const _f = V3(), _r = V3(), _m = V3(), _t = V3();
function updatePlayer(dt) {
  const B = body;
  if (held('flop') && !B.limp) { releaseHands(); goLimp(); }
  if (B.limp) { updateLimp(dt); return; }
  P.upT += dt;
  // shoved well out of your pose (knocked by falling crates, dragged by something) for a moment: you fall over
  const off = hipMid(B.pos, _t).distanceTo(hipMid(B.targets, _m));
  P.offT = off > 0.5 * S && B.ramp > 0.9 && !P.hang && !(P.dashT > -0.5) ? (P.offT || 0) + dt : 0;   // (hanging or climbing pulls you about: that's fine)
  if (!P.hang && B.ramp > 0.5) keepWithBody(P.pos, P.vel, dt);
  if (P.offT > 0.5) { P.offT = 0; releaseHands(); goLimp(); return; }
  // holding on to something solid with your feet off the ground (or jumping while holding on): hanging
  const anchor = solidGrip();
  if (anchor && (P.hang || !P.onGround || held('jump') || held('forward')) && updateHang(dt, anchor)) return;
  if (P.hang) letGoOfHang();

  // which way the keys want to go, relative to the camera
  fwdOf(cam.yaw, _f); rightOf(cam.yaw, _r); _m.set(0, 0, 0);
  if (held('forward')) _m.add(_f);
  if (held('back')) _m.sub(_f);
  if (held('right')) _m.add(_r);
  if (held('left')) _m.sub(_r);
  const moving = _m.lengthSq() > 0;
  if (moving) _m.normalize();
  const heavy = heldMass() > 6 ? 0.55 : 1, ready = Math.min(1, B.ramp * 1.3);   // (wobbly just after getting up)
  // what's underfoot: mud is slow and you can't run in it (see nature.js)
  const surf = P.onGround ? surfaceAt(P.pos.x, P.pos.z) : null, SF = surf && SURF[surf];
  const running = held('run') && surf !== 'mud';
  const speed = (running ? RUN : WALK) * heavy * ready * (SF ? SF.speed : 1) * statOf('speed');
  muddy(playerRig, P, surf === 'mud', dt);
  // speed up and slow down (much less grip in the air)
  const grip = 1 - Math.exp(-(P.onGround ? (SF ? SF.grip : 10) * statOf('grip') * (moving ? 1 : statOf('coast')) : 1.5) * dt);   // (butter shoes: hardly any, and less still when you try to stop)
  P.vel.x += (_m.x * speed - P.vel.x) * grip;
  P.vel.z += (_m.z * speed - P.vel.z) * grip;
  // sliding on butter shoes: going along with no keys down, or going a different way from the one you want
  {
    const v = Math.hypot(P.vel.x, P.vel.z);
    let sl = 0;
    if (wearing(P, 'butter shoes') && P.onGround && v > 1.2) {
      sl = moving ? clamp((1 - (P.vel.x * _m.x + P.vel.z * _m.z) / v) * 1.6, 0, 1) : clamp((v - 1.2) / 1.5, 0, 1);
      // (little smears of butter left behind the feet)
      if (sl > 0.4 && Math.random() < dt * 14) {
        const foot = body.pos[11 + (Math.random() < 0.5 ? 1 : 0)];
        fxPart('smear', V3(foot.x, terrainH(foot.x, foot.z) + 0.03, foot.z), { life: 0.5, vel: V3(-P.vel.x * 0.1, 0.2, -P.vel.z * 0.1), drag: 3, s0: 0.5, s1: 0.05, spin: 0 });
      }
    }
    P.slide += (sl - P.slide) * (1 - Math.exp(-8 * dt));
  }
  // (stepping in with a punch or a kick: see lungeAt)
  if (P.lungeT > 0) {
    P.lungeT -= dt;
    if (P.onGround) { P.vel.x = _m.x * speed * 0.3 + P.lungeV.x; P.vel.z = _m.z * speed * 0.3 + P.lungeV.z; }
  }
  // (a DASH special: see specials.js)
  else if (P.dashT > 0) { P.vel.x = P.dashV.x; P.vel.z = P.dashV.z; }
  // turn to face where you're going (or, while reaching out, where you're looking)
  else if (moving || held('grab')) {
    const want = held('grab') ? cam.yaw : Math.atan2(-_m.x, -_m.z);
    let d = want - P.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    P.yaw += d * (1 - Math.exp(-12 * dt));
  }
  uncrossArms();
  if (hit('jump') && P.onGround && ready > 0.8) { P.vel.y = JUMP * (SF ? SF.jump : 1) * statOf('jump'); P.onGround = false; }

  // move, then don't go through walls
  if (!P.onGround) P.vel.y -= G * dt;
  P.pos.addScaledVector(P.vel, dt);
  // a gust pushes you along
  P.pos.addScaledVector(WIND.dir, windDrift(body) * (P.onGround ? (surf === 'mud' ? 0.3 : 1) : 1.6) * dt);
  if (hitWalls()) return;
  // holding on to a wall with your feet on the ground: you can't walk further away than your arms reach
  if (anchor) {
    _t.subVectors(P.pos, anchor); _t.y = 0;
    const maxD = (B.len[10] + B.len[11]) * 0.9 + 0.3 * S, d = _t.length();
    if (d > maxD) { P.pos.x -= _t.x / d * (d - maxD); P.pos.z -= _t.z / d * (d - maxD); P.vel.x *= 0.5; P.vel.z *= 0.5; }
  }

  // stand on the floor; walk off an edge and you fall
  const boxes = props.filter(p => p.type === 'box' && !p.held);
  const g = groundAt(P.pos.x, P.pos.y, P.pos.z, 0.45, boxes);
  if (P.onGround) {
    if (g > P.pos.y - 0.5) { P.pos.y = g; P.vel.y = 0; } else { P.onGround = false; P.airT = 0; }
  } else {
    P.airT += dt;
    if (P.vel.y <= 0 && P.pos.y <= g) {
      const impact = -P.vel.y;
      P.pos.y = g; P.vel.y = 0; P.onGround = true;
      if (P.spSlam) specialLands(P);                                                     // (a SKY SLAM: see specials.js)
      else if (P.pound) { P.pound = false; poundLands(); }                                      // (a ground pound: see combos.js)
      else if (impact > 13) { releaseHands(); goLimp(); return; }                          // too far to land on your feet
    }
  }
  if (P.pos.y < FALL_Y) { falls++; netFell(); respawn(); }
}

// the body's middle bumps into walls (the floor and things low enough to step onto don't count). Run into a
// wall flat out and you smack into it and fall over (returns true then).
function hitWalls() {
  const r = 0.28 * S;
  for (const h of [0.6, 1.25]) {
    _t.set(P.pos.x, P.pos.y + h * S, P.pos.z);
    for (const s of solids) {
      const depth = obbContact(s, _t, r);
      if (!depth || Math.abs(CN.y) > 0.6) continue;
      const nh = Math.hypot(CN.x, CN.z), nx = CN.x / nh, nz = CN.z / nh;
      const into = -(P.vel.x * nx + P.vel.z * nz);
      if (into > RUN * 0.85 && P.onGround) {
        P.vel.set(nx * 3, 2, nz * 3);
        releaseHands(); goLimp(_t.set(nx * 3, 2, nz * 3)); return true;
      }
      P.pos.x += nx * depth; P.pos.z += nz * depth;
      if (into > 0) { P.vel.x += nx * into; P.vel.z += nz * into; }
      _t.set(P.pos.x, P.pos.y + h * S, P.pos.z);
    }
  }
  return false;
}

// ---------------------------------------------------------------- hanging and climbing
// Hold on to a wall, a ledge, a bar or a platform and leave the ground, and you hang from your hands. The
// controller then follows your hands instead of the floor: A/D shimmy sideways along what you're holding,
// W/S swing you, and if you're holding the top edge of something, W or Space hauls you up onto it.
// Let go and you drop.
// returns false if you're actually standing (feet on the ground, just holding on), so you walk as normal
const _hw = V3(), _hb = V3();
function updateHang(dt, anchor) {
  // (how far below your hands your feet hang: shoulder height plus your arms, nearly straight)
  const B = body, hangDrop = STAND[1].y + (B.len[10] + B.len[11]) * 0.9;
  const h = hands.find(o => o.solid), n = h.n, wall = Math.abs(n.y) < 0.7;
  // face the wall you're holding (a bar, or the top of something: face the way the camera looks)
  // (turning smoothly, so you never spin straight round past the point where your arms would cross)
  let dy = (wall ? Math.atan2(n.x, n.z) : cam.yaw) - P.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  P.yaw += dy * (1 - Math.exp(-10 * dt));
  uncrossArms();
  fwdOf(P.yaw, _f); rightOf(P.yaw, _r);
  // is there a top to climb onto, not far above your hands?
  const W = gripWorld(h, _hw);
  const inX = wall ? -n.x : _f.x, inZ = wall ? -n.z : _f.z;
  const top = rayDown(h.solid, W.x + inX * 0.25 * S, W.y + 0.9 * S, W.z + inZ * 0.25 * S);
  P.ledge = top > W.y - 0.15 && top < W.y + 0.75 * S ? top : null;
  const wantUp = held('forward') || held('jump');
  // where your feet would be hanging, and the floor under you (you can't hang lower than the floor)
  const hangY = anchor.y - hangDrop;
  const floor = groundAt(anchor.x - inX * 0.3 * S, anchor.y, anchor.z - inZ * 0.3 * S, 0);
  const standing = hangY <= floor + 0.03;
  if (standing && P.climb === 0 && !(wantUp && P.ledge !== null)) {
    // feet on the ground: you're just standing there holding on
    if (P.hang) { P.hang = false; P.onGround = true; P.pos.y = floor; }
    return false;
  }
  if (!P.hang) { P.hang = true; P.climb = 0; P.swing.set(0, 0, 0); }
  P.onGround = false; P.vel.set(0, 0, 0);
  if (P.ledge !== null && wantUp) {
    if (P.climb === 0) P.climbY = Math.max(hangY, floor);
    P.climb = Math.min(1, P.climb + dt / 1.1);
  } else P.climb = Math.max(0, P.climb - dt * 2);
  // shimmy along what you're holding (A/D, left and right as the camera sees it), or swing (W/S)
  const side = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
  if (side) { rightOf(cam.yaw, _hb); for (const o of hands) if (o.solid) shimmy(o, _t.copy(_hb).multiplyScalar(side * 1.2 * dt)); }
  const swing = P.ledge === null ? (wantUp ? 1 : 0) - (held('back') ? 1 : 0) : 0;
  P.swing.lerp(_t.copy(_f).multiplyScalar(swing * 0.4 * S), 1 - Math.exp(-3 * dt));
  // where your feet go: hanging below your hands, or on the way up over the edge
  const c = P.climb;
  P.pos.copy(anchor).add(P.swing);
  P.pos.y = Math.max(hangY, floor);
  if (c > 0 && P.ledge !== null) {
    const up = clamp(c / 0.6, 0, 1), over = clamp((c - 0.6) / 0.4, 0, 1);
    P.pos.y = THREE.MathUtils.lerp(Math.min(P.climbY, P.ledge - 0.4 * S), P.ledge - 0.4 * S, up) + Math.sin(over * Math.PI) * 0.15 * S + over * 0.4 * S;
    P.pos.x = anchor.x - inX * 0.25 * S * (1 - over) + inX * 0.4 * S * over;
    P.pos.z = anchor.z - inZ * 0.25 * S * (1 - over) + inZ * 0.4 * S * over;
    if (c >= 1) {
      // made it: standing on top
      P.pos.y = P.ledge; P.hang = false; P.onGround = true; P.climb = 0;
      releaseHands(); P.regrab = true;
    }
  }
  return true;
}
// Both hands holding on to something solid: don't turn so far that the arms cross over (the left hand ending
// up on the right). Turn at most so far either side of square-on to the line between your hands.
const _ux = V3(), _uy = V3();
function uncrossArms() {
  if (!hands[0].solid || !hands[1].solid) return;
  gripWorld(hands[0], _ux); gripWorld(hands[1], _uy);
  const rx = _uy.x - _ux.x, rz = _uy.z - _ux.z;
  if (rx * rx + rz * rz < 0.08 * 0.08) return;   // (hands too close together to say which way's which)
  const square = Math.atan2(-rz, rx);
  let d = P.yaw - square; d = Math.atan2(Math.sin(d), Math.cos(d));
  P.yaw = square + clamp(d, -1.1, 1.1);
}
// you let go while hanging: fall from where you are, moving the way your body was
function letGoOfHang() {
  const B = body;
  P.hang = false; P.climb = 0;
  hipMid(B.pos, _t); hipMid(B.prev, _m);
  P.vel.subVectors(_t, _m).divideScalar(H);
  P.onGround = false;
}

// ---------------------------------------------------------------- floppy
function updateLimp(dt) {
  const B = body;
  B.limpT += dt;
  B.still = bodySpeed() < 0.6 ? B.still + dt : 0;
  // (press a key to get up a bit sooner)
  const eager = held('forward') || held('left') || held('back') || held('right') || held('jump');
  if (!held('flop') && eager && (B.still > 0.25 || fighters.some(F => F.grab)) && B.limpT > 0.8) { getUp(); return; }   // (and break free if someone's dragging you)
  // the controller follows the body round, so the camera does too
  const pel = hipMid(B.pos, _t);
  P.pos.set(pel.x, pel.y, pel.z);
  P.vel.set(0, 0, 0);
  if (pel.y < FALL_Y) { falls++; netFell(); respawn(); return; }
  // get back up once you've stopped (and let go of R)
  if (!held('flop') && ((B.still > 0.5 && B.limpT > 1.2) || B.limpT > 6)) getUp();
}

// heave yourself up: stand facing whichever way twists the body least from how it's lying
function getUp() {
  const B = body, pel = hipMid(B.pos, V3());
  const g = groundAt(pel.x, pel.y, pel.z, 0.6, props.filter(p => p.type === 'box'));
  if (g === -Infinity) return;   // (still falling)
  P.pos.set(pel.x, g, pel.z);
  let best = P.yaw, bestErr = 1e9;
  const tmp = [];
  for (let k = 0; k < 12; k++) {
    const yaw = k * Math.PI / 6;
    standPose(tmp, P.pos, yaw);
    let e = 0;
    for (let i = 0; i < 13; i++) { const dx = tmp[i].x - B.pos[i].x, dz = tmp[i].z - B.pos[i].z; e += dx * dx + dz * dz; }
    if (e < bestErr) { bestErr = e; best = yaw; }
  }
  P.yaw = best; P.vel.set(0, 0, 0); P.onGround = true; P.upT = 0;
  B.limp = false; B.ramp = 0;
  standPose(goal, liftedPos(), P.yaw);
  for (let i = 0; i < 13; i++) { B.targets[i].copy(goal[i]); B.tv[i].set(0, 0, 0); }
}

// ---------------------------------------------------------------- where the body should be this frame
const _kneeDir = V3(), _elbowDir = V3(), _aim = V3(), _hc = V3();
// which way you're reaching: where the camera looks (a little higher, since the camera looks down at you
// from above: its normal view means straight ahead)
const aimDir = v => { const p = cam.pitch - 0.3; return v.set(-Math.sin(cam.yaw) * Math.cos(p), -Math.sin(p), -Math.cos(cam.yaw) * Math.cos(p)); };
const SLIDE = [], _sv = V3();
// where you stand, lifted up if you're standing on springs
const _lp = V3(), liftedPos = () => _lp.set(P.pos.x, P.pos.y + springLift(), P.pos.z);
function buildGoals(dt) {
  const B = body;
  fwdOf(P.yaw, _f); rightOf(P.yaw, _r);
  standPose(goal, liftedPos(), P.yaw);
  if (B.size !== 1) { const base = liftedPos(); for (const p of goal) p.sub(base).multiplyScalar(B.size).add(base); }   // (small or big: see SIZES in custom.js)
  const sp = Math.hypot(P.vel.x, P.vel.z), t = performance.now() / 1000;

  if (P.onGround) {
    // walking: the feet take turns stepping forward, the arms swing opposite, and you lean into it
    // (small or big: steps sized to your legs, and judged by how fast you are for your size. A small one's
    // little legs go like the clappers, a blur, and it doesn't lean over so much; see SIZES in custom.js)
    const z = B.size || 1, spN = sp / Math.max(0.3, styleStat('speed'));
    P.phase += sp * dt / (0.36 * S * z) * Math.PI / 2 * (z < 1 ? 1.25 : 1);
    const stride = Math.min(spN * 0.075, 0.32) * S * z * (z < 1 ? 1.15 : 1), lift = Math.min(spN * 0.035, 0.13) * S * z * (z < 1 ? 1.3 : 1);
    const dip = Math.min(spN * 0.012, 0.05) * S * z;
    // (the blur: little puffs kicked up behind those tiny feet)
    if (z < 1 && spN > WALK && Math.random() < dt * 14) { const f = body.pos[11 + (Math.random() < 0.5 ? 1 : 0)]; fxPart('puff', V3(f.x, f.y, f.z), { life: 0.3, vel: V3(-P.vel.x * 0.15, 0.4, -P.vel.z * 0.15), drag: 4, s0: 0.35, s1: 0.05, spin: 0 }); }
    for (let i = 0; i < 9; i++) goal[i].y -= dip;
    for (let i = 0; i < 2; i++) {
      const ph = P.phase + i * Math.PI, fwd = Math.sin(ph) * stride;
      goal[11 + i].addScaledVector(_f, fwd).y += Math.max(0, Math.cos(ph)) * lift;
      goal[5 + i].addScaledVector(_f, -fwd * 0.8);
      goal[3 + i].addScaledVector(_f, -fwd * 0.4);
    }
    const lean = Math.min(spN, RUN) * 0.03 * S * z * (z < 1 ? 0.4 : 1);
    goal[0].addScaledVector(_f, lean * 1.5); goal[1].addScaledVector(_f, lean); goal[2].addScaledVector(_f, lean);
    // running flat out: lean right forward, arms flung straight out behind you, flapping in the wind
    const run = clamp((spN - WALK - 0.4) / (RUN - WALK - 1.2), 0, 1) * (z < 1 ? 0.35 : 1);   // (a small one: hardly leans at all)
    if (run > 0) {
      goal[0].addScaledVector(_f, 0.28 * S * run).y -= 0.06 * S * run;
      goal[1].addScaledVector(_f, 0.18 * S * run); goal[2].addScaledVector(_f, 0.18 * S * run);
      for (let i = 0; i < 2; i++) {
        const s = i ? 1 : -1, arm = (B.len[10 + i * 2] + B.len[11 + i * 2]) * 0.97;
        _aim.copy(_f).multiplyScalar(-0.8).addScaledVector(UP, -0.5 + Math.sin(t * 22 + i * 2) * 0.12).addScaledVector(_r, s * 0.22).normalize();
        _hc.copy(goal[1 + i]).addScaledVector(_aim, arm);
        goal[5 + i].lerp(_hc, run);
        _hc.copy(goal[1 + i]).addScaledVector(_aim, B.len[10 + i * 2]).y += 0.03 * S;
        goal[3 + i].lerp(_hc, run);
      }
    }
    // sliding on butter: feet together and gliding (no more stepping), one ahead of the other like on a
    // surfboard, knees bent, leaning back, arms flung out wide and wobbling to keep your balance
    if (P.slide > 0.02) {
      const k = P.slide, v = _sv.set(P.vel.x, 0, P.vel.z);
      if (v.lengthSq() > 1e-4) v.normalize(); else v.copy(_f);
      standPose(SLIDE, liftedPos(), P.yaw);
      for (let i = 0; i < 9; i++) SLIDE[i].y -= 0.14 * S;
      for (let i = 0; i < 2; i++) {
        const s = i ? 1 : -1;
        SLIDE[11 + i].addScaledVector(v, s * 0.17 * S);
        SLIDE[9 + i].addScaledVector(v, s * 0.12 * S).addScaledVector(_f, 0.1 * S).y -= 0.04 * S;
        const wob = Math.sin(t * 9 + i * 2.5) * 0.12 * S;
        SLIDE[5 + i].copy(SLIDE[1 + i]).addScaledVector(_r, s * 0.55 * S).y += 0.12 * S + wob;
        SLIDE[3 + i].copy(SLIDE[1 + i]).addScaledVector(_r, s * 0.28 * S).y += 0.08 * S + wob * 0.4;
      }
      SLIDE[0].addScaledVector(v, -0.14 * S); SLIDE[1].addScaledVector(v, -0.09 * S); SLIDE[2].addScaledVector(v, -0.09 * S);
      for (let i = 0; i < 13; i++) goal[i].lerp(SLIDE[i], k);
      P.phase -= sp * dt / (0.36 * S) * Math.PI / 2 * k;   // (the feet stop stepping)
    }
  } else {
    // in the air: knees up, arms out and flapping
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1, flap = Math.sin(t * 14 + i) * 0.12 * S;
      goal[11 + i].addScaledVector(_f, 0.12 * S).y += 0.12 * S;
      goal[5 + i].addScaledVector(_r, s * 0.25 * S).y += 0.45 * S + flap;
      goal[3 + i].addScaledVector(_r, s * 0.15 * S).y += 0.25 * S;
    }
  }

  // holding left click: both arms reach out where you're looking. Look down and you bend over to reach the
  // floor. Whatever the hands touch, they grab (see stepGrip); a hand that's holding something stays there.
  if (held('grab') && !P.hang) {
    aimDir(_aim);
    const bend = clamp((-_aim.y - 0.15) / 0.7, 0, 1);
    for (let i = 0; i < 9; i++) goal[i].y -= bend * 0.48 * S;
    goal[0].addScaledVector(_f, bend * 0.4 * S); goal[1].addScaledVector(_f, bend * 0.3 * S); goal[2].addScaledVector(_f, bend * 0.3 * S);
    // (both hands go for the same spot in front of your chest, a hand's width apart)
    const reach = (B.len[10] + B.len[11]) * 0.95;
    shoulderMid(goal, _hc).addScaledVector(_aim, reach);
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1;
      goal[5 + i].copy(_hc).addScaledVector(_r, s * 0.1 * S);
      if (holds(hands[i])) gripWorld(hands[i], goal[5 + i]);
      _elbowDir.copy(_r).multiplyScalar(s).addScaledVector(UP, -1);
      bendJoint(goal[1 + i], goal[5 + i], B.len[10 + i * 2], B.len[11 + i * 2], _elbowDir, goal[3 + i]);
    }
  }
  // hanging: arms up to where you're holding on, legs dangling
  // (a small one's legs go so fast its springs need to be stiffer to keep up: so you can see them going)
  for (let i = 9; i < 13; i++) B.boost[i] = B.size < 1 && P.onGround && !P.slide ? 3 : 1;
  if (P.hang) {
    for (let i = 0; i < 2; i++) {
      const h = hands[i], s = i ? 1 : -1;
      if (h.solid) gripWorld(h, goal[5 + i]);
      else goal[5 + i].copy(goal[1 + i]).addScaledVector(UP, B.len[10] + B.len[11]).addScaledVector(_r, s * 0.1 * S);
      _elbowDir.copy(_r).multiplyScalar(s).addScaledVector(_f, -0.5);
      bendJoint(goal[1 + i], goal[5 + i], B.len[10 + i * 2], B.len[11 + i * 2], _elbowDir, goal[3 + i]);
    }
    B.boost[9] = B.boost[10] = 0.45; B.boost[11] = B.boost[12] = 0.35;
  }
  // punching: wind up, then the fist shoots out where you're looking, the shoulder lunging after it
  for (let i = 3; i < 7; i++) B.boost[i] = 1;
  if (P.punch) {
    const pu = P.punch, i = pu.hand, s = i ? 1 : -1, reach = B.len[10 + i * 2] + B.len[11 + i * 2];
    pu.t += dt;
    aimDir(_aim);
    if (pu.t < pu.wind) {
      // fist back by the chin
      goal[5 + i].copy(goal[1 + i]).addScaledVector(_f, 0.12 * S).addScaledVector(_r, -s * 0.1 * S).y += 0.05 * S;
      goal[1 + i].addScaledVector(_f, -0.06 * S);
    } else if (pu.t < pu.wind + PUNCH_HIT) {
      goal[1 + i].addScaledVector(_f, 0.14 * S);
      goal[2 - i].addScaledVector(_f, -0.08 * S);
      goal[0].addScaledVector(_f, 0.06 * S);
      goal[5 + i].copy(goal[1 + i]).addScaledVector(_aim, reach * 1.02);
      B.boost[3 + i] = B.boost[5 + i] = 2.6;
    } else if (pu.t > pu.wind + PUNCH_HIT + PUNCH_BACK) P.punch = null;
    _elbowDir.copy(_r).multiplyScalar(s).addScaledVector(UP, -1);
    bendJoint(goal[1 + i], goal[5 + i], B.len[10 + i * 2], B.len[11 + i * 2], _elbowDir, goal[3 + i]);
  }
  // kicking: knee up, then the foot shoots out in front, leaning back to keep your balance
  if (P.kick) {
    const ki = P.kick, i = ki.leg, leg = B.len[14 + i * 2] + B.len[15 + i * 2];
    ki.t += dt;
    if (ki.t < KICK_WIND) {
      goal[11 + i].copy(goal[7 + i]).addScaledVector(_f, 0.2 * S).y -= leg * 0.55;
      goal[0].addScaledVector(_f, -0.05 * S);
    } else if (ki.t < KICK_WIND + KICK_HIT) {
      goal[11 + i].copy(goal[7 + i]).addScaledVector(_f, leg * 0.97).y -= leg * 0.2;
      goal[0].addScaledVector(_f, -0.16 * S); goal[1].addScaledVector(_f, -0.1 * S); goal[2].addScaledVector(_f, -0.1 * S);
      B.boost[9 + i] = B.boost[11 + i] = 2.8;
    } else if (ki.t > KICK_WIND + KICK_HIT + KICK_BACK) P.kick = null;
  }
  // knees: bend forward over the feet
  _kneeDir.copy(_f).addScaledVector(UP, 0.2);
  for (let i = 0; i < 2; i++) bendJoint(goal[7 + i], goal[11 + i], B.len[14 + i * 2], B.len[15 + i * 2], _kneeDir, goal[9 + i]);

  specialPose(P, goal);   // (a flip, a twist... for a special move: see specials.js)
  setTargets(goal, dt);
  // springs: off while limp, fading back in as you get up; a bit floppier in the air
  B.ramp = Math.min(1, B.ramp + dt / 0.9);
  const r = B.ramp * B.ramp, air = P.onGround || P.hang ? 1 : 0.75;
  B.k = ACTIVE_K * r * air; B.damp = ACTIVE_DAMP * r; B.lift = r;
}

// ---------------------------------------------------------------- punching
// Right click: a punch, left and right fists taking turns (a fist that's holding something stays holding it
// if the other one's free). The fist's springs go extra stiff for the strike, so it really snaps out; the
// first thing it connects with gets knocked away, lighter things further.
const PUNCH_WIND = 0.08, PUNCH_HIT = 0.13, PUNCH_BACK = 0.12;
function startPunch() {
  if (P.punch && P.punch.t < P.punch.wind + PUNCH_HIT) return;   // (the next punch can start as this one comes back)
  let i = P.nextFist;
  if (P.hang) return;   // (you need your hands)
  // holding a rock (or a box, a ball...): swing it, with the hand that's got it
  const withProp = hands.findIndex(h => h.pr || h.fb);
  if (withProp >= 0) {
    i = withProp;
    const o = hands[1 - i];
    if ((o.pr && o.pr === hands[i].pr) || (o.fb && o.fb === hands[i].fb)) releaseHand(o);   // (one-handed, for the swing)
  } else {
    if (holds(hands[i]) && !holds(hands[1 - i])) i = 1 - i;
    if (wearing(P, 'cartoon hammer')) i = 1;   // (always the hammer hand)
    releaseHand(hands[i]);
  }
  P.nextFist = 1 - i;
  // (stepping in a long way: the fist waits to strike till you're there)
  const step = lungeAt(0.75);
  const hammer = wearing(P, 'cartoon hammer') && i === 1 && withProp < 0;
  P.punch = { hand: i, t: 0, hit: false, hammer, wind: PUNCH_WIND + Math.min(0.12, step * 0.14) + (hammer ? 0.07 : 0), how: moveHow() };
}
// F (or the middle mouse button): a kick, legs taking turns. Slower than a punch, but it hits harder, and
// it's the end of a combo: punch, punch, KICK!
const KICK_WIND = 0.13, KICK_HIT = 0.16, KICK_BACK = 0.16;
// A punch or a kick steps you in at the nearest fighter in front of you (where you're looking), turning to
// face them, to just the right distance: so a combo flows, following them as each hit knocks them back.
function lungeAt(dist) {
  aimDir(_aim); _aim.y = 0; _aim.normalize();
  let best = null, bd = 2.6;
  for (const F of fighters) {
    _t.set(F.B.pos[7].x - P.pos.x, 0, F.B.pos[7].z - P.pos.z);
    const d = _t.length();
    if (d < bd && d > 1e-3 && _t.dot(_aim) / d > 0.45) { best = F; bd = d; }
  }
  if (!best) return 0;
  _t.set(best.B.pos[7].x - P.pos.x, 0, best.B.pos[7].z - P.pos.z).normalize();
  P.yaw = Math.atan2(-_t.x, -_t.z);
  const step = Math.max(0, bd - dist);
  P.lungeT = 0.2; P.lungeV.copy(_t).multiplyScalar(Math.min(6, step / 0.2));
  return step;   // (how far it's stepping)
}
function startKick() {
  if (P.hang || (P.kick && P.kick.t < KICK_WIND + KICK_HIT)) return;
  const how = moveHow();
  if (how.air) return groundPound();   // (a kick in the air: down you come! See combos.js)
  lungeAt(0.8);
  P.kick = { leg: P.nextLeg, t: 0, hit: false, how };
  P.nextLeg = 1 - P.nextLeg;
}
function stepKick() {
  const ki = P.kick;
  if (!ki || ki.hit || ki.t < KICK_WIND || ki.t > KICK_WIND + KICK_HIT || body.limp) return;
  const foot = body.pos[11 + ki.leg], r = body.R[11 + ki.leg] + 0.07;
  fwdOf(P.yaw, _t);
  for (const F of fighters) {
    const k = fistHits(foot, r, F.B);
    if (k < 0) continue;
    _t.y = 0.25; _t.normalize();
    playerHits(F, k === 0 ? 17 : 13, _t, k, 1.15 * styleStat('heft'), 'kick', ki.how);
    ki.hit = true;
    return;
  }
  for (const pr of props) {
    if (pr.held) continue;
    const touching = pr.type === 'box' ? obbContact(pr, foot, r) > 0 : foot.distanceTo(pr.pts[0]) < pr.r + r;
    if (!touching) continue;
    const speed = 12 / Math.sqrt(Math.max(1, pr.mass / 1.5));
    _t.multiplyScalar(speed); _t.y = speed * 0.35;
    wake(pr);
    for (let k = 0; k < pr.pts.length; k++) pr.prev[k].addScaledVector(_t, -H);
    pr.lastBy = playerBody; pr.grace = 0.6;
    ki.hit = true;
    hitThing('kick', ki.how, foot, 'rock');
    return;
  }
  const w = strikeWorld(foot, r + 0.04);
  if (w) { ki.hit = true; hitThing('kick', ki.how, foot, w === 'ground' ? 'ground' : 'tree'); }
}
// (one small step) does the fist connect?
const _hh = V3();
function stepPunch() {
  const pu = P.punch;
  if (!pu || pu.hit || pu.t < pu.wind || pu.t > pu.wind + PUNCH_HIT || body.limp) return;
  const fist = body.pos[5 + pu.hand], r = body.R[5 + pu.hand] + 0.04;
  // (swinging the hammer: its big head hits them, as well as your fist)
  const head = pu.hammer && playerRig.hammerHead ? playerRig.hammerHead.getWorldPosition(_hh) : null;
  // a fighter? (the head hurts more)
  for (const F of fighters) {
    let k = fistHits(fist, r, F.B);
    if (k < 0 && head) k = fistHits(head, 0.26, F.B);
    if (k < 0) continue;
    aimDir(_aim);
    // (an uppercut comes up from underneath)
    if (pu.how.air) _aim.y = Math.max(_aim.y, 0.6);
    playerHits(F, k === 0 ? 13 : 9, _aim, k, styleStat('heft') * (pu.hammer ? gearStat('heft') : 1), 'punch', pu.how);
    pu.hit = true;
    return;
  }
  for (const pr of props) {
    if (pr.held) continue;
    const touching = pr.type === 'box' ? obbContact(pr, fist, r) > 0 : fist.distanceTo(pr.pts[0]) < pr.r + r;
    if (!touching) continue;
    aimDir(_aim);
    const speed = 9 / Math.sqrt(Math.max(1, pr.mass / 1.5));
    _t.copy(_aim).multiplyScalar(speed); _t.y += speed * 0.2;
    wake(pr);
    for (let k = 0; k < pr.pts.length; k++) pr.prev[k].addScaledVector(_t, -H);
    pu.hit = true;
    hitThing('punch', pu.how, fist, 'rock');
    return;
  }
  const w = strikeWorld(head || fist, head ? 0.26 : r + 0.04);
  if (w) { pu.hit = true; hitThing('punch', pu.how, head || fist, w === 'ground' ? 'ground' : 'tree'); }
}

// ---------------------------------------------------------------- grabbing things
// Each hand can hold on to one thing, at the spot where it touched it:
//  · a prop: a two-way pull between the hand and that spot (shared by weight), so a light box goes where
//    your hand goes and a heavy crate drags your arms down. Let go and it keeps its speed: swing and let go
//    to fling it.
//  · something solid (a wall, a ledge, a bar, a moving platform): the hand stays put on it, and you can hang.
const HAND_MASS = 5;
// (or another ragdoll: fb is whose body, fi which of its points: grab one by the head, an arm, a foot...)
const hands = [0, 1].map(() => ({ pr: null, solid: null, fb: null, fi: 0, l: V3(), n: V3(), dist: 0 }));
const holds = h => !!(h.pr || h.solid || h.fb);
const BODY_GRAB_MASS = 2.5;   // (how heavy a ragdoll's limb feels in your hand: light enough to drag one about)
const heldMass = () => { for (const h of hands) if (h.pr) return h.pr.mass; return 0; };
const holding = () => hands.find(holds);

function releaseHand(h) {
  const pr = h.pr;
  h.pr = h.solid = h.fb = null;
  if (pr) { pr.held = hands.some(o => o.pr === pr); if (!pr.held) { pr.noBody = 0.25; pr.heldBy = null; pr.lastBy = playerBody; pr.grace = 1; } }   // (don't bump it straight away)
}
function releaseHands() { hands.forEach(releaseHand); }

// where your hands are holding on to something solid (the middle, if both are), or null
const _sg = V3();
function solidGrip() {
  let n = 0; _sg.set(0, 0, 0);
  for (const h of hands) if (h.solid) { _sg.add(gripWorld(h, _gw)); n++; }
  return n ? _sg.divideScalar(n) : null;
}

// where a hand's grip is now, into out
const _gw = V3(), _gd = V3();
function gripWorld(h, out) {
  if (h.fb) {
    // a ragdoll: the hand stays on that body part's surface
    const p = h.fb.B.pos[h.fi], hand = body.pos[5 + hands.indexOf(h)];
    _gd.subVectors(hand, p);
    return out.copy(p).addScaledVector(_gd, h.dist / (_gd.length() || 1));
  }
  const o = h.solid || h.pr;
  if (o.type === 'ball') {
    // a ball has no "spot" to hold: the hand just stays on its surface
    const hand = body.pos[5 + hands.indexOf(h)];
    _gd.subVectors(hand, o.pts[0]);
    return out.copy(o.pts[0]).addScaledVector(_gd, h.dist / (_gd.length() || 1));
  }
  return out.copy(o.c).addScaledVector(o.ax, h.l.x).addScaledVector(o.ay, h.l.y).addScaledVector(o.az, h.l.z);
}
// remember a spot on a box (a prop or something solid) as its own coordinates, so it moves with it
function holdSpot(h, box, p) { _gd.subVectors(p, box.c); h.l.set(_gd.dot(box.ax), _gd.dot(box.ay), _gd.dot(box.az)); }

// slide a hand's grip along what it's holding (staying on it)
function shimmy(h, move) {
  const s = h.solid, m = RAG_R[5] + 0.06;
  h.l.x = clamp(h.l.x + move.dot(s.ax), -s.h.x - m, s.h.x + m);
  h.l.y = clamp(h.l.y + move.dot(s.ay), -s.h.y - m, s.h.y + m);
  h.l.z = clamp(h.l.z + move.dot(s.az), -s.h.z - m, s.h.z + m);
}

// one small step: grab whatever a reaching hand touches, and hold on to what's held
function stepGrip() {
  const B = body;
  if (!held('grab')) P.regrab = false;
  if (!held('grab') || B.limp || P.regrab) { releaseHands(); return; }
  for (let i = 0; i < 2; i++) {
    const h = hands[i], hand = B.pos[5 + i], r = RAG_R[5 + i] + 0.05;
    if (P.punch && P.punch.hand === i && !h.pr && !h.fb) continue;   // (a punching fist doesn't grab: one swinging a rock keeps hold)
    // (a hand only grabs once it's nearly where you're reaching, not whatever it brushes on the way)
    // (or once it's stopped against something it can't get past: the floor, someone lying on it)
    if (!holds(h)) {
      const settled = hand.distanceTo(B.prev[5 + i]) / H < 0.6;
      if (!P.punch && (settled || hand.distanceTo(B.targets[5 + i]) < 0.15 * S)) tryGrab(h, hand, r);
      continue;
    }
    const W = gripWorld(h, _gw);
    _gd.subVectors(W, hand);
    const gap = _gd.length();
    if (h.solid) {
      // holding on to something solid: the hand stays exactly there
      hand.copy(W); B.prev[5 + i].lerp(hand, 0.6);
      continue;
    }
    if (h.fb && h.fb.remote) {
      // holding the other player online: your hand's pulled toward the bit of them you're holding (their
      // computer pulls them toward your hand: see net.js). A looser grip: they're always a moment behind.
      if (gap > 0.8 * S) { releaseHand(h); continue; }
      if (gap > 0.05) hand.addScaledVector(_gd, 0.25 * 0.05 / gap);
      continue;
    }
    if (h.fb) {
      // holding a ragdoll: pull your hand and its body part together (it's light: you can drag it about)
      if (gap > 0.35 * S) { releaseHand(h); continue; }
      if (gap < 1e-5) continue;
      const wh = BODY_GRAB_MASS / (BODY_GRAB_MASS + HAND_MASS), firm = 0.5;
      if (gap > 0.05) _gd.multiplyScalar(0.05 / gap);   // (a firm pull, but not so sudden it flings them)
      hand.addScaledVector(_gd, wh * firm);
      h.fb.B.pos[h.fi].addScaledVector(_gd, -(1 - wh) * firm);
      continue;
    }
    // holding a prop: pull the hand and the grip spot together
    const pr = h.pr;
    if (pr.type === 'box') boxFrame(pr);
    if (gap > 0.35 * S) { releaseHand(h); continue; }   // (slipped out of your hand)
    if (gap < 1e-5) continue;
    // (only part of the way each step: a firm grip, but a little give, so a stuck crate can't yank you over)
    const wh = pr.mass / (pr.mass + HAND_MASS), firm = 0.5;
    hand.addScaledVector(_gd, wh * firm);
    _gd.divideScalar(gap);
    shoveProp(pr, W, _gd, -gap * (1 - wh) * firm);
  }
  for (const pr of props) if (pr.held && pr.type === 'box') stickBox(pr, 2);
}

// a reaching hand touches something: hold on (props first, then anything solid)
function tryGrab(h, hand, r) {
  for (const pr of props) {
    const touching = pr.type === 'box' ? obbContact(pr, hand, r) > 0 : hand.distanceTo(pr.pts[0]) < pr.r + r;
    if (!touching) continue;
    h.pr = pr; pr.held = true; pr.heldBy = playerBody; wake(pr);   // (even out of someone else's hands)
    if (pr.type === 'box') { boxFrame(pr); holdSpot(h, pr, hand); }
    else h.dist = hand.distanceTo(pr.pts[0]);
    return;
  }
  // another ragdoll (knocked out, or still fighting)
  for (const F of fighters) {
    for (let i = 0; i < 13; i++) {
      if (hand.distanceTo(F.B.pos[i]) >= r + F.B.R[i]) continue;
      h.fb = F; h.fi = i; h.dist = RAG_R[5] + F.B.R[i];
      return;
    }
  }
  for (const s of solids) {
    if (s.noGrab || !obbContact(s, hand, r)) continue;
    h.solid = s; h.n.copy(CN); holdSpot(h, s, hand);
    return;
  }
}

function updateHands() {
  P.hint = '';
  if (body.limp) { P.punch = P.kick = null; return; }
  if (hit('punch')) startPunch();
  if (hit('kick')) startKick();
  if (P.hang) {
    P.hint = P.ledge !== null ? 'W / Space: climb up · A / D: shimmy · let go: drop' : 'A / D: shimmy · W / S: swing · let go: drop';
    return;
  }
  if (holding()) {
    const h = holding();
    P.hint = h.solid ? 'Space: hang on · let go: drop' : h.fb ? (h.fb.B.limp ? 'Drag them to the edge and drop them off!' : 'Got them! Drag them to the edge · right click: swing them') : 'Right click: swing it at someone · let go: drop';
    return;
  }
  const chest = shoulderMid(body.pos, V3());
  for (const F of fighters) if (F.B.limp && F.B.pos[7].distanceTo(chest) < 1.6) { P.hint = held('grab') ? 'Reach for them…' : 'They\'re down! Hold ' + keyName(BINDS.grab[0]) + ' to grab them'; return; }
  const pr = nearestProp();
  if (pr) P.hint = P.regrab ? '' : held('grab') ? 'Reach for it…' : 'Hold ' + keyName(BINDS.grab[0]) + ' to grab the ' + pr.name;
}

function nearestProp() {
  const B = body, chest = shoulderMid(B.pos, V3());
  fwdOf(P.yaw, _f);
  let best = null, bestD = 1e9;
  for (const pr of props) {
    _t.subVectors(pr.c, chest);
    const up = _t.y; _t.y = 0;
    const flat = _t.length(), reach = (pr.type === 'box' ? Math.max(pr.h.x, pr.h.z) : pr.r) + 0.7 * S;
    if (flat > reach || up < -1.6 * S || up > 0.7 * S) continue;
    const ahead = flat > 0.01 ? _t.dot(_f) / flat : 1;
    if (ahead < -0.2) continue;
    const d = flat - ahead * 0.3;
    if (d < bestD) { bestD = d; best = pr; }
  }
  return best;
}

// ---------------------------------------------------------------- camera
const raycaster = new THREE.Raycaster();
const _cd = V3();
function updateCamera(dt) {
  cam.yaw -= mouse.dx * 0.0025;
  cam.pitch = clamp(cam.pitch + mouse.dy * 0.0025, -0.5, 1.35);
  cam.dist = clamp(cam.dist + mouse.wheel * 0.5, 1.5, 12);
  const pel = hipMid(body.pos, _t);
  cam.target.lerp(_t.set(pel.x, pel.y + 0.55 * S, pel.z), 1 - Math.exp(-(body.limp ? 6 : 12) * dt));
  _cd.set(Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch));
  // don't go behind a wall: come in closer instead
  raycaster.set(cam.target, _cd); raycaster.far = cam.dist;
  const hit = raycaster.intersectObjects(solidMeshes)[0];
  const d = hit ? Math.max(0.4, hit.distance - 0.25) : cam.dist;
  camera.position.copy(cam.target).addScaledVector(_cd, d);
  camera.lookAt(cam.target);
}
