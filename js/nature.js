// The weather and the ground: gusts of wind, and patches of mud.
//
// Gusts: every so often the wind gets up. You get a couple of seconds' warning (streaks start blowing past,
// and a warning on screen), then for a few seconds it shoves everyone and everything that way:
// standing ragdolls lean into it and get pushed along, and anyone knocked flat or flying gets blown a long
// way. Fight upwind of your enemies. (The fighters know this too.)
//
// Mud: thick and sticky. Everyone wades through it slowly, can't run, and can hardly jump; a body knocked into
// it stops dead. Walk through it and it creeps up your legs.
'use strict';

// ---------------------------------------------------------------- wind
const WIND = { state: 'calm', t: rand(30, 45), dir: V3(1, 0, 0), s: 0, speed: 6.5 };
let windStreaks = null;
const _wq = new THREE.Quaternion(), _wm = new THREE.Matrix4(), _wv = V3(), _ws = V3();

function updateWind(dt) {
  const W = WIND;
  W.t -= dt;
  if (W.t <= 0) {
    if (W.state === 'calm') {
      W.state = 'warn'; W.t = 2.5;
      const a = Math.random() * Math.PI * 2; W.dir.set(Math.cos(a), 0, Math.sin(a));
    } else if (W.state === 'warn') { W.state = 'gust'; W.t = rand(3, 4.5); wakeLightProps(); }
    else { W.state = 'calm'; W.t = rand(40, 70); }
  }
  // how hard it's blowing (0 to 1): a breath during the warning, full during the gust, dying away after
  const want = W.state === 'gust' ? 1 : W.state === 'warn' ? 0.15 : 0;
  W.s += (want - W.s) * (1 - Math.exp(-(want > W.s ? 3 : 1.5) * dt));
  // who's sheltered from it (behind something)?
  shelterBody(playerBody, dt);
  for (const F of fighters) shelterBody(F.B, dt);
  drawWind(dt);
}

// Behind something, out of the wind: a tree, a boulder, a big rock or a hill a few metres upwind of you
// (between you and where the wind's coming from) and the gust hardly touches you. B.shelter: 0 out in the
// open, 1 sheltered (eased, so stepping in and out of the lee isn't a jolt).
const _sp = V3();
function isSheltered(B) {
  const hip = hipMid(B.pos, _sp), x0 = hip.x, z0 = hip.z, y = hip.y + 0.25 * S;
  for (let d = 0.5; d <= 3.6; d += 0.45) {
    const x = x0 - WIND.dir.x * d, z = z0 - WIND.dir.z * d;
    if (terrainH(x, z) > y) return true;   // (over the brow of a hill)
    _sp.set(x, y, z);
    for (const s of solids) if (!s.noGrab && Math.abs(s.c.x - x) < s.rad + 0.5 && Math.abs(s.c.z - z) < s.rad + 0.5 && obbContact(s, _sp, 0.4) > 0) return true;
    for (const pr of props) if (pr.type === 'box' && pr.mass >= 5 && Math.abs(pr.c.x - x) < 1.5 && Math.abs(pr.c.z - z) < 1.5 && obbContact(pr, _sp, 0.4) > 0) return true;
  }
  return false;
}
function shelterBody(B, dt) {
  const want = WIND.s > 0.02 && B.pos.length && isSheltered(B) ? 1 : 0;
  B.shelter = (B.shelter || 0) + (want - (B.shelter || 0)) * (1 - Math.exp(-6 * dt));
}
// the push of the wind on a body's points (an acceleration): gentle on someone standing (they lean into it),
// strong on someone limp or flying
function windPush(B) { return WIND.s * (B.limp ? 7 : 2.5) * (1 - 0.9 * (B.shelter || 0)); }
// how far the wind drifts someone standing (or walking), per second
function windDrift(B) { return WIND.s * WIND.speed * 0.45 * (1 - 0.9 * (B.shelter || 0)); }
function wakeLightProps() { for (const pr of props) if (pr.mass < 3 && !pr.held) wake(pr); }
// (and it pushes loose rocks about: lighter ones more)
function windOnProp(pr) {
  if (WIND.s < 0.05 || pr.held) return;
  const a = WIND.s * 9 / (1 + pr.mass) * H * H;
  for (const p of pr.pts) { p.x += WIND.dir.x * a; p.z += WIND.dir.z * a; }
}

// streaks of wind blowing past, all round you; and the trees sway
function buildWind() {
  const g = new THREE.BoxGeometry(0.035, 0.035, 1);
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
  windStreaks = new THREE.InstancedMesh(g, m, 160);
  windStreaks.frustumCulled = false;
  windStreaks.userData.pts = Array.from({ length: 160 }, () => ({ p: V3(rand(-25, 25), rand(0.3, 7), rand(-25, 25)), len: rand(1.2, 3), k: rand(0.8, 1.4) }));
  scene.add(windStreaks);
}
function drawWind(dt) {
  const W = WIND, S2 = windStreaks;
  S2.material.opacity = Math.min(0.75, W.s * 0.9);
  S2.visible = W.s > 0.02;
  if (S2.visible) {
    _wq.setFromUnitVectors(_ws.set(0, 0, 1), W.dir);
    const c = cam.target;
    S2.userData.pts.forEach((o, i) => {
      o.p.addScaledVector(W.dir, W.speed * 3 * o.k * dt);
      // (wrap round, staying in a big box round you)
      for (const ax of ['x', 'z']) { const d = o.p[ax] - c[ax]; if (d > 25) o.p[ax] -= 50; if (d < -25) o.p[ax] += 50; }
      _wv.set(1, 1, o.len * (0.4 + W.s));
      S2.setMatrixAt(i, _wm.compose(_ws.set(o.p.x, c.y + o.p.y - 1, o.p.z), _wq, _wv));
    });
    S2.instanceMatrix.needsUpdate = true;
  }
  // the trees' leaves lean with the wind, and shiver
  const t = performance.now() / 1000;
  for (const l of treeLeaves) {
    const b = l.userData.base, k = W.s * (0.25 + 0.06 * Math.sin(t * 9 + b.x));
    l.position.set(b.x + W.dir.x * k, b.y, b.z + W.dir.z * k);
  }
  // the warning on screen
  const el = $('wind');
  if (W.state === 'calm' && W.s < 0.05) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.querySelector('.label').textContent = (W.state === 'warn' ? 'GUST COMING!' : 'GUST!') + (playerBody.shelter > 0.5 ? '  (sheltered)' : W.state === 'warn' ? '  Get behind something!' : '');
}

// ---------------------------------------------------------------- mud
const patches = [];   // { x, z, r, ph1, ph2, type }
const patchR = (P, a) => P.r * (1 + 0.18 * Math.sin(3 * a + P.ph1) + 0.1 * Math.sin(5 * a + P.ph2));
// what's underfoot at (x, z): 'mud' or null
function surfaceAt(x, z) {
  for (const P of patches) {
    const dx = x - P.x, dz = z - P.z, d = dx * dx + dz * dz;
    if (d > P.r * P.r * 1.7) continue;
    if (Math.sqrt(d) < patchR(P, Math.atan2(dz, dx))) return P.type;
  }
  return null;
}
function buildPatches() {
  for (const type of ['mud']) {
    for (let k = 0, tries = 0; k < 7 && tries < 400; tries++) {
      const p = islandSpot(-3.5), r = rand(1.8, 3.2); if (!p) continue; const [x, z] = p;
      if (!onIsland(x, z, -r - 2) || Math.hypot(x, z - 5) < r + 4) continue;
      if (patches.some(P => Math.hypot(P.x - x, P.z - z) < P.r + r + 3)) continue;
      // (fairly flat ground: puddles don't sit on steep hillsides)
      const e = 1, slope = Math.hypot(terrainH(x + e, z) - terrainH(x - e, z), terrainH(x, z + e) - terrainH(x, z - e)) / (2 * e);
      if (slope > 0.25) continue;
      // (nor under a tree or boulder)
      if (solids.some(s => !s.noGrab && Math.hypot(s.c.x - x, s.c.z - z) < r + s.rad)) continue;
      const P = { x, z, r, ph1: Math.random() * 7, ph2: Math.random() * 7, type };
      patches.push(P); drawPatch(P); k++;
    }
  }
}
// a blob lying on the ground (following its bumps): a darker rim, then the patch itself
function patchMesh(P, grow, lift, color, opts = {}) {
  const A = 40, Rn = 6, pos = [], idx = [];
  pos.push(P.x, terrainH(P.x, P.z) + lift, P.z);
  for (let j = 1; j <= Rn; j++) for (let i = 0; i < A; i++) {
    const a = i / A * Math.PI * 2, r = patchR(P, a) * grow * j / Rn, x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r;
    pos.push(x, terrainH(x, z) + lift, z);
  }
  const at = (j, i) => j === 0 ? 0 : 1 + (j - 1) * A + (i % A);
  for (let i = 0; i < A; i++) idx.push(0, at(1, i + 1), at(1, i));
  for (let j = 1; j < Rn; j++) for (let i = 0; i < A; i++) idx.push(at(j, i), at(j, i + 1), at(j + 1, i), at(j, i + 1), at(j + 1, i + 1), at(j + 1, i));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, toonM(Object.assign({ color: col(color), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }, opts)));
  m.receiveShadow = true; scene.add(m);
  return m;
}
function drawPatch(P) {
  patchMesh(P, 1.08, 0.025, 0x5a3a22);
  patchMesh(P, 1, 0.045, 0x7a5233);
  // (a few darker wet splodges in it)
  for (let k = 0; k < 4; k++) {
    const a = Math.random() * 7, d = Math.random() * P.r * 0.5;
    patchMesh({ x: P.x + Math.cos(a) * d, z: P.z + Math.sin(a) * d, r: P.r * rand(0.15, 0.3), ph1: k, ph2: k * 2 }, 1, 0.055, 0x5e3d24);
  }
}

// how mud changes moving about in it (for you and the fighters)
const SURF = {
  mud: { speed: 0.5, grip: 5, jump: 0.55, fric: 0.45 },     // slow and sticky
};
// muddy legs: wade through mud and it creeps up your legs; step out and it soon comes off again
function muddy(rig, F, onMud, dt) {
  F.mud = clamp((F.mud || 0) + (onMud ? 0.6 : -0.35) * dt, 0, 1);
  rig.mudU.value = F.mud;   // (painted on the legs: see setupRig)
}

// muddy wherever you touched it: fall in the mud, and the parts of you lying in it get mud on them (and it
// slowly comes off again). Each body point touching mud dirties the bones round it.
const MUD_BONES = [['head'], ['ub', 'shL'], ['ub', 'shR'], ['shL', 'elL'], ['shR', 'elR'], ['elL'], ['elR'],
  ['lb', 'hipL'], ['lb', 'hipR'], ['hipL', 'kneeL'], ['hipR', 'kneeR'], ['kneeL'], ['kneeR']];
// (sent: the other player online, whose mud their computer works out and sends: see net.js)
function mudBody(rig, B, dt, sent) {
  if (!rig || !rig.boneMud || !B.pos.length) return;
  const pm = rig.ptMud, bm = rig.boneMud.value;
  bm.fill(0);
  for (let i = 0; i < 13; i++) {
    if (sent) { for (const k of MUD_BONES[i]) { const b = rig.boneIdx[k]; if (b >= 0 && pm[i] > bm[b]) bm[b] = pm[i]; } continue; }
    const p = B.pos[i];
    // (feet in the mud only count when you've fallen over: walking through it is muddy() up the legs)
    const touching = (i < 11 || B.limp) && p.y - terrainH(p.x, p.z) < B.R[i] + 0.07 && surfaceAt(p.x, p.z) === 'mud';
    pm[i] = clamp(pm[i] + (touching ? 2.5 : -0.2) * dt, 0, 1);
    for (const k of MUD_BONES[i]) { const b = rig.boneIdx[k]; if (b >= 0 && pm[i] > bm[b]) bm[b] = pm[i]; }
  }
  // your hat: it gets mud on it when your head, shoulders or chest go in the mud (lying in it, or falling in it
  // face first), and it comes off again in a few seconds
  if (rig.hatMud) rig.hatMud.value = Math.max(rig.hatMud.value - 0.1 * dt, pm[0], pm[1], pm[2], 0.85 * Math.max(pm[7], pm[8]));
}
function updateMud(dt) {
  mudBody(playerRig, playerBody, dt);
  for (const F of fighters) mudBody(F.rig, F.B, dt, F.remote);
}

function buildNature() { buildWind(); }
