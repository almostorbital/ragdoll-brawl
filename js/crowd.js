// THE BIG BRAWL: behind the title screen (START / NEW GAME), the real island (the one you fight on: its
// trees, its rocks, its mud), with a huge crowd of ragdolls all over it, all fighting at once: punching,
// kicking, windmilling their arms, reeling back, seeing stars, running in, and a few knocked flying high over
// everyone's heads. The camera circles slowly round them. Each is a real floppy ragdoll (the same body as in
// the game, see body.js): its muscles pull it toward the pose it wants (made with the picture helpers, see
// pictures.js), and one knocked flying goes limp and tumbles for real. Their brains are simple: it's for show.
'use strict';
const CROWD = { rigs: [], who: [], on: false, t: 0, c: V3(0, 0, 2), ang: 0.6 };
const CROWD_N = 50;

// the ragdolls: the model's fetched once, and made into CROWD_N of them
fetch('models/ragdoll.glb').then(r => r.arrayBuffer()).then(buf => {
  let n = 0;
  const one = () => new THREE.GLTFLoader().parse(buf.slice(0), '', gltf => {
    const old = RIG; const r = setupRig(gltf); RIG = old;
    r.root.parent && r.root.parent.remove(r.root);
    CROWD.rigs.push(r);
    if (++n < CROWD_N) setTimeout(one, 0);   // (one at a time, so the page doesn't stall)
    else if ($('overlay').classList.contains('splash')) showCrowd();
  });
  one();
});

// ---------------------------------------------------------------- on, off
function showCrowd() {
  if (CROWD.on || CROWD.rigs.length < CROWD_N || typeof ready === 'undefined' || !ready || started) return false;
  // the clearest bit of the island (the fewest trees round it), for the brawl to be in, where you can see it
  let bestC = null, bestN = 1e9;
  for (let k = 0; k < 300; k++) {
    const x = rand(-25, 25), z = rand(-25, 25);
    if (!onIsland(x, z, -8)) continue;
    let n = 0; for (const T of TREES) { const d = Math.hypot(T.x - x, T.z - z); if (d < 14) n += d < 9 ? 3 : 1; }
    n += Math.hypot(x, z - 2) * 0.05;
    if (n < bestN) { bestN = n; bestC = [x, z]; }
  }
  if (bestC) CROWD.c.set(bestC[0], 0, bestC[1]);
  // where they all stand: spread over the island round the middle, not too close together, not in a rock or a tree
  const spots = [];
  for (let k = 0; k < 4000 && spots.length < CROWD_N; k++) {
    const a = Math.random() * Math.PI * 2, d = 1 + Math.sqrt(Math.random()) * 11.5;
    const x = CROWD.c.x + Math.cos(a) * d, z = CROWD.c.z + Math.sin(a) * d;
    if (!onIsland(x, z, -1.5) || groundAt(x, 30, z, 0) - terrainH(x, z) > 0.3) continue;
    if (spots.some(s => Math.hypot(s[0] - x, s[1] - z) < 1.15)) continue;
    spots.push([x, z]);
  }
  const others = LOOK_COLORS.filter(c => c !== LOOK.color), hats = [null, null, null, 'cap', 'top hat', 'party hat', 'beanie', 'viking'];
  CROWD.who = spots.map(([x, z], i) => {
    const rig = CROWD.rigs[i], what = 'punch';
    scene.add(rig.root); rig.mesh.frustumCulled = false; rig.root.visible = true;
    picDress(rig, scene, i === 0 ? picYou({ face: 'angry' }) : { color: others[Math.floor(Math.random() * others.length)], face: 'angry', hat: hats[Math.floor(Math.random() * hats.length)] });
    const c = { rig, x, z, y: 0, yaw: Math.random() * 6.3, ph: Math.random() * 10, state: 'pick', st: rand(0, 1.5), foe: null, act: 'punch', B: makeBody() };
    withBody(c, () => initBody(V3(x, terrainH(x, z), z), c.yaw));
    return c;
  });
  if (playerRig) playerRig.root.visible = false;   // (you're in the crowd instead)
  CROWD.on = true; CROWD.t = 0; CROWD.acc = 0;
  $('overlay').classList.remove('wait');   // (the sky that covered everything till now fades away)
  return true;
}
function hideCrowd() {
  if (!CROWD.on) return;
  CROWD.on = false;
  for (const c of CROWD.who) scene.remove(c.rig.root);
  if (playerRig) playerRig.root.visible = true;
  $('picWord').style.display = 'none';
  newPicture();
}

// ---------------------------------------------------------------- each frame (see drawPicture): they move!
// Each one, over and over: picks someone to fight (someone near, on their feet), runs at them, and fights them
// toe to toe, punching and kicking. Every so often a blow lands properly: the one hit goes flying (up, away,
// tumbling), crashes down, lies there a moment, maybe sees stars, then gets up and charges back in. Now and
// then one goes wandering about, windmilling its arms. (Nobody goes off the edge: it's just for show.)
const _crowdW = V3(), _crowdR = V3();
const CROWD_FACE = { pick: 'angry', run: 'angry', fight: 'angry', finish: 'angry', reel: 'shocked', fly: 'shocked', down: 'dizzy', dizzy: 'dizzy', flail: 'shocked' };
function crowdSet(c, state, t) {
  c.state = state; c.st = t;
  if (c.face !== CROWD_FACE[state]) { c.face = CROWD_FACE[state]; c.rig.face = ''; setFace(c.rig, c.face); }
}
// (knocked flying, away from whoever hit it)
function crowdLaunch(c, from) {
  let dx = c.x - from.x, dz = c.z - from.z;
  // (near the edge: knocked back in toward the middle instead, so nobody goes off)
  if (islandD(c.x, c.z) > -7) { dx = CROWD.c.x - c.x; dz = CROWD.c.z - c.z; }
  const d = Math.hypot(dx, dz) || 1, sp = rand(5.5, 8);
  withBody(c, () => goLimp(V3(dx / d * sp, rand(6, 9), dz / d * sp)));
  // (thrown about: the head snapped back one way, the feet the other, and every arm and leg flung its own way,
  // so it flops and tumbles all over the place)
  const B = c.B, spin = V3(dx / d, 0, dz / d).multiplyScalar(rand(4, 7));
  B.prev[0].addScaledVector(spin, -H); B.prev[1].addScaledVector(spin, -H * 0.6); B.prev[2].addScaledVector(spin, -H * 0.6);
  B.prev[11].addScaledVector(spin, H); B.prev[12].addScaledVector(spin, H);
  for (const i of [3, 4, 5, 6, 9, 10, 11, 12]) B.prev[i].add(_crowdR.set(rand(-5, 5), rand(-2, 5), rand(-5, 5)).multiplyScalar(H));
  crowdSet(c, 'fly', 0);
}
// getting up: its muscles come back, pulling it up to standing where it lies (as the fighters do: see fighterGetUp)
const _cgu = [];
function crowdGetUp(c) {
  const B = c.B;
  hipMid(B.pos, _crowdW); c.x = _crowdW.x; c.z = _crowdW.z;
  c.yaw = Math.atan2(-(CROWD.c.x - c.x), -(CROWD.c.z - c.z));
  B.limp = false; B.ramp = 0; c.upT = 0;
  standPose(_cgu, V3(c.x, terrainH(c.x, c.z), c.z), c.yaw);
  for (let i = 0; i < 13; i++) { B.targets[i].copy(_cgu[i]); B.tv[i].set(0, 0, 0); }
  crowdSet(c, Math.random() < 0.4 ? 'dizzy' : 'pick', rand(1.2, 2));
}
// rung out: back in, dropping out of the sky somewhere near the brawl (limp, it lands in a heap and gets up)
function crowdDropIn(c) {
  let x = CROWD.c.x, z = CROWD.c.z;
  for (let k = 0; k < 30; k++) { const a = Math.random() * 6.3, d = rand(1, 8); const tx = CROWD.c.x + Math.cos(a) * d, tz = CROWD.c.z + Math.sin(a) * d; if (onIsland(tx, tz, -2.5)) { x = tx; z = tz; break; } }
  c.x = x; c.z = z;
  withBody(c, () => { initBody(V3(x, terrainH(x, z) + rand(9, 13), z), Math.random() * 6.3); goLimp(V3(0, -2, 0)); });
  crowdSet(c, 'fly', 0);
}
// (still in a heap after getting up, or stuck somehow: stand it straight back up where it is)
function crowdRestand(c) {
  hipMid(c.B.pos, _crowdW);
  const x = onIsland(_crowdW.x, _crowdW.z, -1.5) ? _crowdW.x : c.x, z = onIsland(_crowdW.x, _crowdW.z, -1.5) ? _crowdW.z : c.z;
  c.x = x; c.z = z;
  withBody(c, () => initBody(V3(x, terrainH(x, z), z), c.yaw));
  c.upT = 0;
}
function crowdThink(c, dt) {
  c.st -= dt;
  const free = o => o !== c && (o.state === 'pick' || o.state === 'run' || o.state === 'flail');   // (not in the middle of a fight)
  if (c.state === 'pick' && c.st <= 0) {
    if (Math.random() < 0.12) { crowdSet(c, 'flail', rand(2, 4)); return; }
    // (someone near, preferably someone nobody else is on)
    let best = null, bd = 1e9;
    for (const o of CROWD.who) { if (!free(o)) continue; const d = Math.hypot(o.x - c.x, o.z - c.z) + (CROWD.who.some(q => q.foe === o) ? 3 : 0) + rand(0, 2); if (d < bd) { bd = d; best = o; } }
    if (best) { c.foe = best; crowdSet(c, 'run', 6); } else c.st = 0.5;
  } else if (c.state === 'run') {
    const o = c.foe;
    if (!o || !free(o) || c.st <= 0) { crowdSet(c, 'pick', rand(0.2, 0.8)); return; }
    const dx = o.x - c.x, dz = o.z - c.z, d = Math.hypot(dx, dz) || 1;
    c.yaw = Math.atan2(-dx, -dz);
    if (d < 1.0) {
      // (squared up: they fight each other. Whoever's timer runs out first lands the big one)
      crowdSet(c, 'fight', rand(1.5, 4)); c.act = Math.random() < 0.3 ? 'kick' : 'punch';
      o.foe = c; if (o.state !== 'fight') { crowdSet(o, 'fight', rand(1.5, 4)); o.act = 'punch'; }
      return;
    }
    const sp = 4.2; c.x += dx / d * sp * dt; c.z += dz / d * sp * dt;
  } else if (c.state === 'fight') {
    const o = c.foe;
    if (!o || o.state === 'fly' || o.state === 'down' || o.state === 'dizzy' || o.foe !== c) { crowdSet(c, 'pick', rand(0.5, 1.5)); return; }
    const dx = o.x - c.x, dz = o.z - c.z, d = Math.hypot(dx, dz) || 1;
    c.yaw = Math.atan2(-dx, -dz);
    if (d > 1.1) { c.x += dx / d * 2 * dt; c.z += dz / d * 2 * dt; } else if (d < 0.8) { c.x -= dx / d * 1.5 * dt; c.z -= dz / d * 1.5 * dt; }
    if (Math.random() < dt * 0.7) c.act = Math.random() < 0.3 ? 'kick' : 'punch';
    // (a jab or a kick that lands rocks them back, and they go floppy for a moment)
    c.jabT = (c.jabT || 0) - dt;
    if (c.jabT <= 0) {
      const B = c.B, T = o.B, limb = c.act === 'kick' ? [B.pos[11], B.pos[12]] : [B.pos[5], B.pos[6]];
      for (const p of limb) for (const i of [0, 1, 2, 7, 8]) {
        if (c.jabT > 0 || p.distanceTo(T.pos[i]) > T.R[i] + 0.12) continue;
        _crowdR.subVectors(T.pos[i], B.pos[7]).setY(0.15).normalize();
        knock(T, i, _crowdR, rand(3, 5.5));
        T.ramp = Math.min(T.ramp, 0.45);   // (floppy, then its muscles come back: see crowdFrame)
        c.jabT = 0.3;
      }
    }
    // (time for the big one: see 'finish')
    if (c.st <= 0) { c.act = Math.random() < 0.35 ? 'kick' : 'punch'; crowdSet(c, 'finish', 0); c.ft = 0; }
  } else if (c.state === 'finish') {
    // the big hit: wound right back, then it lands, and THEN they go flying (the moment it connects)
    const o = c.foe;
    c.ft += dt;
    if (o && o.state !== 'fly' && o.state !== 'down') {
      const dx = o.x - c.x, dz = o.z - c.z; c.yaw = Math.atan2(-dx, -dz);
      if (o.state === 'fight' && o.foe === c) crowdSet(o, 'reel', 0);   // (it sees it coming: no more hitting back)
    }
    // (stepping in with it, to just the right distance)
    if (o) { const dx = o.x - c.x, dz = o.z - c.z, d = Math.hypot(dx, dz) || 1; if (d > 0.72) { const st = Math.min(d - 0.72, 3 * dt); c.x += dx / d * st; c.z += dz / d * st; } }
    // it lands when the fist (or foot) really reaches them: and that's when they go flying
    if (c.ft >= 0.36 && !c.landed && o && o.state !== 'fly' && o.state !== 'down') {
      const B = c.B, T = o.B, limb = c.act === 'kick' ? [B.pos[11], B.pos[12]] : [B.pos[5], B.pos[6]];
      let near = 9; for (const p of limb) for (const i of [0, 1, 2, 3, 4, 7, 8]) near = Math.min(near, p.distanceTo(T.pos[i]) - T.R[i]);
      if (near < 0.18) { c.landed = true; crowdLaunch(o, c); }
    }
    if (c.ft >= 0.85) { c.landed = false; if (o && o.state === 'reel') crowdSet(o, 'pick', 0.3); crowdSet(c, 'pick', rand(0.6, 1.4)); }
  } else if (c.state === 'reel') {
    // about to be hit (see 'finish'): if that doesn't happen after all, back to it
    if (!c.foe || c.foe.state !== 'finish') crowdSet(c, 'pick', 0.3);
  } else if (c.state === 'flail') {
    // wandering about windmilling its arms
    c.yaw += Math.sin(CROWD.t * 1.3 + c.ph) * 2 * dt;
    fwdOf(c.yaw, _crowdR); c.x += _crowdR.x * 1.6 * dt; c.z += _crowdR.z * 1.6 * dt;
    if (c.st <= 0) crowdSet(c, 'pick', 0.3);
  } else if (c.state === 'fly') {
    // flying, limp: till it's landed and stopped rolling about. (If it ever did go off the edge, it'd drop back
    // in, out of the sky: but they're knocked away from the edge, see crowdLaunch)
    hipMid(c.B.pos, _crowdW); c.x = _crowdW.x; c.z = _crowdW.z;
    if (_crowdW.y < RINGOUT_Y) { crowdDropIn(c); return; }
    const sp = withBody(c, bodySpeed);
    if ((c.st < -1.2 && sp < 1) || c.st < -5) crowdSet(c, 'down', rand(1.2, 2.2));
  } else if (c.state === 'down') {
    hipMid(c.B.pos, _crowdW); c.x = _crowdW.x; c.z = _crowdW.z;
    if (_crowdW.y < RINGOUT_Y + 3) { crowdSet(c, 'fly', -0.5); return; }   // (it rolled off the edge after all)
    // (and up it gets: its muscles come back)
    if (c.st <= 0) crowdGetUp(c);
  } else if (c.state === 'dizzy') {
    c.yaw += dt * 2.5;
    if (c.st <= 0) crowdSet(c, 'pick', 0.2);
  }
  // (stay on the island, well in from the edge: and out of the rocks and trees)
  for (let k = 0; k < 4 && c.state !== 'fly' && c.state !== 'down' && islandD(c.x, c.z) > -2.2; k++) { islandOut(c.x, c.z, _crowdR); c.x -= _crowdR.x * 0.3; c.z -= _crowdR.z * 0.3; c.vx *= -0.3; c.vz *= -0.3; if (c.state === 'flail') c.yaw += Math.PI; }
  if (c.state !== 'fly' && c.state !== 'down' && groundAt(c.x, 30, c.z, 0) - terrainH(c.x, c.z) > 0.3) { const a = Math.atan2(c.z - CROWD.c.z, c.x - CROWD.c.x); c.x -= Math.cos(a) * 2 * dt; c.z -= Math.sin(a) * 2 * dt; }
}
function crowdFrame(dt) {
  CROWD.t += dt;
  const W = CROWD.who;
  for (const c of W) crowdThink(c, dt);
  // (nobody stands inside anybody)
  for (let i = 0; i < W.length; i++) for (let j = i + 1; j < W.length; j++) {
    const a = W[i], b = W[j]; if (a.B.limp || b.B.limp) continue;
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
    if (d < 0.7 && d > 1e-4) { const p = (0.7 - d) / d * 0.5; a.x -= dx * p; a.z -= dz * p; b.x += dx * p; b.z += dz * p; }
  }
  for (const c of W) {
    const t = CROWD.t + c.ph, A = picLocal(), y = A[1].y;
    const at = V3(c.x, terrainH(c.x, c.z) + c.y, c.z);
    let yaw = c.yaw;
    const sw = (a, b) => Math.sin(t * a + b);
    if (c.state === 'fight' && c.act === 'punch') {
      // fists up, jabbing away, one then the other
      const p0 = Math.max(0, sw(9, 0)), p1 = Math.max(0, sw(9, Math.PI));
      picArm(A, 0, V3(-0.15, y - 0.03, 0.28 + 0.45 * p0), V3(-1, -0.5, 0)); picArm(A, 1, V3(0.15, y - 0.03, 0.28 + 0.45 * p1), V3(1, -0.5, 0));
      picTurn(A, UP, 0.25 * (p0 - p1)); picTurn(A, V3(1, 0, 0), 0.12);
      picLeg(A, 0, V3(-0.17, 0.08, 0.15), V3(0, 0, 1)); picLeg(A, 1, V3(0.17, 0.08, -0.15), V3(0, 0, 1));
    } else if (c.state === 'finish' && c.act === 'punch') {
      // a haymaker: twisted right back, fist cocked... then WHAM, all the way through
      const w = Math.min(1, c.ft / 0.36), hit = c.ft >= 0.36 && c.ft < 0.75 ? Math.min(1, (c.ft - 0.36) / 0.08) : 0;
      picArm(A, 0, V3(-0.15, y - 0.03, 0.3), V3(-1, -0.5, 0));
      if (!hit) picArm(A, 1, V3(0.35, y, -0.3 * w), V3(1, -0.4, -0.5));
      else picArm(A, 1, V3(0.08, y + 0.05, 0.8), V3(1, -0.3, 0));
      picTurn(A, UP, -0.8 * w * (1 - hit) + 0.5 * hit);
      picTurn(A, V3(1, 0, 0), -0.15 * w * (1 - hit) + 0.35 * hit);
      picLeg(A, 0, V3(-0.17, 0.08, 0.25), V3(0, 0, 1)); picLeg(A, 1, V3(0.17, 0.08, -0.2), V3(0, 0, 1));
    } else if (c.state === 'finish') {
      // a big kick: knee up, then the foot shoots out into them
      const w = Math.min(1, c.ft / 0.36), hit = c.ft >= 0.36 && c.ft < 0.75 ? Math.min(1, (c.ft - 0.36) / 0.06) : 0;
      picArm(A, 0, V3(-0.45, y, 0.1), V3(-1, 0, 0)); picArm(A, 1, V3(0.45, y, 0), V3(1, 0, 0));
      if (!hit) picLeg(A, 1, V3(0.15, 0.55 * w, 0.2 * w), V3(0, 1, 1));
      else picLeg(A, 1, V3(0.1, 0.75, 0.85), V3(0, 1, 1));
      picTurn(A, V3(1, 0, 0), -0.35 * hit - 0.1 * w);
    } else if (c.state === 'reel') {
      // it sees it coming: flinching back, arms up
      picArm(A, 0, V3(-0.15, y + 0.25, 0.22), V3(-1, 0, 0)); picArm(A, 1, V3(0.15, y + 0.25, 0.22), V3(1, 0, 0));
      picTurn(A, V3(1, 0, 0), -0.25);
    } else if (c.state === 'fight') {
      const k = Math.max(0, sw(5, 0));
      picArm(A, 0, V3(-0.4, y - 0.1, 0.15), V3(-1, 0, 0)); picArm(A, 1, V3(0.4, y - 0.1, -0.1), V3(1, 0, 0));
      picLeg(A, 1, V3(0.15, 0.1 + 0.6 * k, 0.1 + 0.55 * k), V3(0, 1, 1));
      picTurn(A, V3(1, 0, 0), -0.2 * k);
    } else if (c.state === 'run' || c.state === 'pick') {
      // running, arms pumping (or bouncing on its toes, picking who's next)
      const run = c.state === 'run', ph = t * (run ? 13 : 6);
      for (let i = 0; i < 2; i++) {
        const s = i ? 1 : -1, f = Math.sin(ph + i * Math.PI) * (run ? 1 : 0.2);
        picLeg(A, i, V3(s * 0.15, 0.08 + Math.max(0, Math.cos(ph + i * Math.PI)) * (run ? 0.22 : 0.05), f * 0.32), V3(0, 0, 1));
        if (run) picArm(A, i, V3(s * 0.25, y - 0.35, -f * 0.3), V3(s, -0.3, 0));
        else picArm(A, i, V3(s * 0.16, y - 0.05, 0.28), V3(s, -0.5, 0));
      }
      if (run) picTurn(A, V3(1, 0, 0), 0.3);
    } else if (c.state === 'flail') {
      // arms going round like windmills, legs kicking, hopping along
      for (let i = 0; i < 2; i++) { const s = i ? 1 : -1, a = t * 11 + i * 2; picArm(A, i, V3(s * (0.35 + 0.15 * Math.cos(a)), y + 0.2 + 0.35 * Math.sin(a), 0.15 * Math.cos(a * 0.7)), V3(s, 0, 0)); }
      picLeg(A, (t * 6) % 2 < 1 ? 0 : 1, V3((t * 6) % 2 < 1 ? -0.2 : 0.2, 0.25, 0.2), V3(0, 0, 1));
      at.y += Math.abs(sw(6, 0)) * 0.18;
      picTurn(A, V3(0, 0, 1), 0.2 * sw(5, 1));
    } else if (c.state === 'dizzy') {
      // wobbling round in circles, arms dangling
      picArm(A, 0, V3(-0.35, y - 0.55, 0.15), V3(-1, 0, 0)); picArm(A, 1, V3(0.35, y - 0.55, 0.15), V3(1, 0, 0));
      picTurn(A, V3(0, 0, 1), 0.25 * sw(3, 0)); picTurn(A, V3(1, 0, 0), 0.2 * sw(3, 1.5));
    }
    // (its muscles pull it toward that pose: limp, they don't)
    const B = c.B;
    if (B.limp) { B.k = B.damp = B.lift = 0; continue; }
    withBody(c, () => setTargets(picPlace(A, at, yaw), Math.max(dt, 1e-3)));
    B.ramp = Math.min(1, B.ramp + dt / 0.9);
    const r = B.ramp * B.ramp; B.k = ACTIVE_K * r; B.damp = ACTIVE_DAMP * r; B.lift = r;
  }
  // the physics: everyone's body, a step at a time
  CROWD.acc = Math.min(CROWD.acc + dt, 0.05);
  const oldRig = RIG;
  while (CROWD.acc >= H) {
    CROWD.acc -= H;
    for (const c of W) { RIG = c.rig; withBody(c, () => stepBody(0, 0)); }
    for (let i = 0; i < W.length; i++) for (let j = i + 1; j < W.length; j++) bodiesBump(W[i].B, W[j].B);
  }
  // (keeping everyone sensible)
  for (const c of W) {
    const B = c.B; hipMid(B.pos, _crowdW);
    const g = terrainH(_crowdW.x, _crowdW.z);
    // sunk into the ground: up it comes
    let low = 0; for (let i = 0; i < 13; i++) if (onIsland(B.pos[i].x, B.pos[i].z, -0.3)) low = Math.min(low, B.pos[i].y - terrainH(B.pos[i].x, B.pos[i].z) + 0.05);   // (over the island: not falling past its edge)
    if (low < -0.15) for (let i = 0; i < 13; i++) { B.pos[i].y -= low; B.prev[i].y -= low; }
    if (B.limp) continue;
    // its spot's run off without it (it's caught on a rock): the spot waits for it
    const d = Math.hypot(_crowdW.x - c.x, _crowdW.z - c.z);
    if (d > 0.6) { c.x = _crowdW.x + (c.x - _crowdW.x) * 0.6 / d; c.z = _crowdW.z + (c.z - _crowdW.z) * 0.6 / d; }
    // a while after getting up and still in a heap, or upside down: straight back up
    c.upT = (c.upT || 0) + dt;
    if (c.upT > 0.9 && B.ramp > 0.95 && (_crowdW.y - g < 0.45 || B.pos[0].y < _crowdW.y)) crowdRestand(c);
  }
  for (const c of W) { RIG = c.rig; poseRig(c.B.pos); }
  RIG = oldRig;
  // the camera: circling slowly round them, up high, looking down on the brawl. (The brawl's framed off to
  // the left, as the title screen's on the right)
  CROWD.ang += dt * 0.06;
  const R = 11, h = terrainH(CROWD.c.x, CROWD.c.z);
  camera.position.set(CROWD.c.x + Math.cos(CROWD.ang) * R, h + 10, CROWD.c.z + Math.sin(CROWD.ang) * R);
  _crowdW.set(CROWD.c.x, h + 0.5, CROWD.c.z);
  camera.lookAt(_crowdW);
  const D = camera.position.distanceTo(_crowdW), halfW = D * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
  _crowdR.set(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(0.27 * 2 * halfW);
  camera.position.add(_crowdR);
  updateSun(_crowdW);
  fadeTrees(dt, () => false);   // (trees stay solid)
  $('picWord').style.display = 'none';   // (no word over this one)
}
