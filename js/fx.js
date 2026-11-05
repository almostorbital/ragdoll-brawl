// Cartoon effects: comic words where a hit lands (POW! WHAM!), a starry impact burst, little stars flying off,
// dust puffs when someone lands hard, dizzy stars (and X eyes) when someone's knocked flying, a tiny freeze on
// big hits (hit-stop) and screen shake.
'use strict';
const FX = { stop: 0, shake: 0, words: [], parts: [], dizzy: new Map(), pool: {} };

// a flat cartoon star, puffed out a little so it has a thickness and an outline
function starGeometry(points, r1, r2, depth) {
  const s = new THREE.Shape();
  for (let i = 0; i <= points * 2; i++) {
    const a = i / (points * 2) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? r2 : r1;
    i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: depth * 0.6, bevelSize: depth * 0.6, bevelSegments: 2 });
  g.center(); g.computeVertexNormals();
  return g;
}
const FX_GEO = {
  star: starGeometry(5, 0.09, 0.04, 0.02),
  burst: starGeometry(9, 0.5, 0.22, 0.005),
  puff: new THREE.IcosahedronGeometry(0.16, 1),
  smear: new THREE.IcosahedronGeometry(0.16, 1),   // (butter, smeared behind butter shoes)
};
const FX_MAT = {
  star: new THREE.MeshBasicMaterial({ color: 0xffd23a }),
  puff: toonM({ color: col(0xf2ead8), transparent: true }),
  smear: toonM({ color: col(0xffe68a) }),
};

// (meshes are reused rather than made fresh each time)
function fxMesh(kind) {
  const list = FX.pool[kind] || (FX.pool[kind] = []);
  let m = list.find(m => !m.visible);
  if (!m) {
    m = new THREE.Mesh(FX_GEO[kind], kind === 'burst' ? new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }) : FX_MAT[kind]);
    if (kind !== 'burst') outline(m, kind === 'star' ? 0.012 : 0.02);
    m.renderOrder = kind === 'burst' ? 5 : 0;
    scene.add(m); list.push(m);
  }
  m.visible = true;
  return m;
}
function fxPart(kind, pos, o) {
  const m = fxMesh(kind);
  if (o.color) m.material.color.set(o.color);
  m.position.copy(pos);
  FX.parts.push(Object.assign({ m, kind, t: 0, life: 0.5, vel: V3(), spin: rand(-12, 12), s0: 1, s1: 1 }, o));
}

// ---------------------------------------------------------------- comic words
const WORDS = {
  small: ['POP!', 'BIP!', 'TAP!', 'BOP!'],
  mid: ['POW!', 'BAM!', 'WHACK!', 'SMACK!'],
  big: ['WHAM!', 'KA-POW!', 'THWACK!', 'BOOM!'],
  slam: ['BONK!', 'CRUNCH!', 'THUD!', 'KLONK!'],
};
const pick = a => a[Math.floor(Math.random() * a.length)];
function fxWord(text, pos, cls, size) {
  const el = document.createElement('div');
  el.className = 'comic ' + (cls || '');
  el.innerHTML = `<span>${text}</span>`;
  el.style.setProperty('--s', size.toFixed(2));
  el.style.setProperty('--r', rand(-14, 14).toFixed(1) + 'deg');
  $('comics').appendChild(el);
  // (it drifts up a little from where the hit landed)
  FX.words.push({ el, pos: pos.clone().add(V3(rand(-0.3, 0.3), 0.35, rand(-0.3, 0.3))), t: 0, s: size });
  if (FX.words.length > 6) { FX.words[0].el.remove(); FX.words.shift(); }
}

// ---------------------------------------------------------------- the effects
// a hit landed on B at `pos`: how hard (its damage), whether it sent them flying, and whether it's you that got hit
function fxHit(B, pos, dmg, launched) {
  const you = B === playerBody;
  faceFlash(B, 'hurt', 0.45);
  const tier = launched || dmg >= 16 ? 'big' : dmg >= 8 ? 'mid' : 'small';
  const size = tier === 'big' ? 1.35 : tier === 'mid' ? 1 : 0.75;
  fxWord(pick(WORDS[tier]), pos, you ? 'ouch' : '', size);
  // the flash: a white star-shaped burst that pops out and fades
  fxPart('burst', pos, { life: 0.16, s0: 0.3 * size, s1: 1.3 * size, color: 0xffd23a, fade: true });
  // little stars flying off
  const n = tier === 'big' ? 7 : tier === 'mid' ? 4 : 2;
  for (let i = 0; i < n; i++) {
    fxPart('star', pos, { life: rand(0.4, 0.7), vel: V3(rand(-1, 1), rand(0.6, 1.6), rand(-1, 1)).normalize().multiplyScalar(rand(3, 6)), grav: 9, s0: rand(0.8, 1.3), s1: 0.2 });
  }
  // a freeze and a shake: bigger hits, bigger
  FX.stop = Math.max(FX.stop, tier === 'big' ? 0.09 : tier === 'mid' ? 0.045 : 0.02);
  FX.shake = Math.max(FX.shake, (tier === 'big' ? 0.22 : tier === 'mid' ? 0.1 : 0.04) * (you ? 1.3 : 1));
  if (launched) dizzy(B, 4);
  sfx('hit', tier, pos, launched);
}
// slammed into a tree or a boulder
function fxSlam(B, speed) {
  const pos = B.pos[7].clone().lerp(B.pos[0], 0.5);
  fxWord(pick(WORDS.slam), pos, B === playerBody ? 'ouch' : 'slam', 1.4);
  fxPart('burst', pos, { life: 0.18, s0: 0.4, s1: 1.6, color: 0xffd23a, fade: true });
  for (let i = 0; i < 6; i++) fxPart('star', pos, { life: rand(0.4, 0.7), vel: V3(rand(-1, 1), rand(0.5, 1.5), rand(-1, 1)).normalize().multiplyScalar(rand(3, 6)), grav: 9, s0: 1.2, s1: 0.2 });
  fxDust(pos, 1.2);
  FX.stop = Math.max(FX.stop, 0.1);
  FX.shake = Math.max(FX.shake, 0.25);
  dizzy(B, 5);
  sfx('slam', pos);
}
// a ring of dust puffs
function fxDust(pos, s = 1) {
  const n = Math.round(5 + 3 * s);
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + rand(-0.3, 0.3);
    fxPart('puff', pos, { life: rand(0.45, 0.7), vel: V3(Math.cos(a), rand(0.15, 0.5), Math.sin(a)).multiplyScalar(rand(1.2, 2.2) * s), drag: 4, s0: rand(0.5, 0.9) * s, s1: 0.05, spin: 0 });
  }
}

// ---------------------------------------------------------------- dizzy: stars round the head, and X eyes
const rigOf = B => B === playerBody ? playerRig : (fighters.find(F => F.B === B) || {}).rig;
function dizzy(B, t) {
  let D = FX.dizzy.get(B);
  if (!D) {
    D = { t: 0, a: 0, stars: [0, 1, 2].map(() => { const m = fxMesh('star'); m.visible = false; m.userData.dizzy = true; return m; }) };
    FX.dizzy.set(B, D);
  }
  D.t = Math.max(D.t, t);
}
function updateDizzy(dt) {
  for (const [B, D] of FX.dizzy) {
    // (it wears off when they get up, or after a while)
    if (!B.limp) D.t = Math.min(D.t, 0);
    D.t -= dt; D.a += dt * 5;
    const on = D.t > 0;
    D.stars.forEach((m, i) => {
      m.visible = on;
      if (!on) return;
      const a = D.a + i * Math.PI * 2 / 3, head = B.pos[0];
      m.position.set(head.x + Math.cos(a) * 0.28, head.y + 0.22 + Math.sin(a * 2) * 0.04, head.z + Math.sin(a) * 0.28);
      m.quaternion.copy(camera.quaternion);
      m.scale.setScalar(0.9);
    });
  }
}

// ---------------------------------------------------------------- faces
// Everyone pulls faces:
// (eyes and eyebrows only: no mouth)
//   normal   · round eyes, brows level
//   angry    · brows slanted down: while throwing a punch or a kick, or charging at someone
//   happy    · ^ ^ and brows up: just landed a hit
//   hurt     · > < squeezed shut, worried brows: just got hit
//   shocked  · tiny pupils, brows right up: flying through the air, or falling off the island
//   dizzy    · X eyes (and stars round the head): knocked flying and still lying there
const FACES = {
  //         eyes       brow: angle (inner end down +), lift
  normal:  { eyes: 'open',   brow: [0, 0] },
  angry:   { eyes: 'open',   brow: [0.5, -0.012] },
  happy:   { eyes: 'happy',  brow: [-0.15, 0.02] },
  hurt:    { eyes: 'squint', brow: [-0.35, 0.01] },
  shocked: { eyes: 'tiny',   brow: [-0.2, 0.035] },
  dizzy:   { eyes: 'x',      brow: [0.25, 0.005] },
};
function setFace(rig, name) {
  if (!rig || !rig.eyes || rig.face === name) return;
  rig.face = name;
  const f = FACES[name];
  for (const e of rig.eyes) {
    e.eye.visible = f.eyes === 'open' || f.eyes === 'tiny' || f.eyes === 'x';
    e.pupil.visible = f.eyes !== 'x';
    e.pupil.scale.setScalar(f.eyes === 'tiny' ? 0.5 : 1);
    e.x.visible = f.eyes === 'x';
    // (> < : each points in toward the nose; ^ ^ : both point up)
    e.squint.visible = f.eyes === 'squint' || f.eyes === 'happy';
    e.squint.rotation.z = f.eyes === 'happy' ? Math.PI / 2 : e.s < 0 ? 0 : Math.PI;
    e.brow.visible = !!f.brow;
    if (f.brow) { e.brow.rotation.z = e.s * f.brow[0]; e.brow.position.y = f.brow[1] * S; }
  }
}
// a face for a moment (happy after landing a hit, hurt after taking one)
function faceFlash(B, name, t) { B.faceF = name; B.faceT = t; }
function updateFaces(dt) {
  const all = [[playerBody, playerRig, P.punch || P.kick], ...fighters.map(F => [F.B, F.rig, F.punch || F.mode === 'charge'])];
  for (const [B, rig, attacking] of all) {
    if (!rig) continue;
    B.faceT = (B.faceT || 0) - dt;
    const D = FX.dizzy.get(B), p = B.pos[7];
    const speed = p.distanceTo(B.prev[7]) / H, ground = terrainH(p.x, p.z);
    const flying = B.limp && (speed > 5 || p.y < ground - 0.8);   // (sent flying, or falling off the edge)
    const whoa = B === playerBody && P.slide > 0.6;   // (sliding about on butter shoes)
    setFace(rig, flying || whoa ? 'shocked' : D && D.t > 0 ? 'dizzy' : B.faceT > 0 && B.faceF ? B.faceF : attacking ? 'angry' : 'normal');
  }
}

// ---------------------------------------------------------------- hard landings kick up dust
function landings() {
  for (const B of [playerBody, ...fighters.map(F => F.B)]) {
    if (!B.pos[7]) continue;
    const vy = (B.pos[7].y - B.prev[7].y) / H;
    if ((B.fallVy || 0) < -7 && vy > B.fallVy * 0.5) {   // (falling fast, then suddenly stopped)
      const p = B.pos[7];
      if (p.y - terrainH(p.x, p.z) < 0.6) fxDust(V3(p.x, terrainH(p.x, p.z) + 0.05, p.z), Math.min(1.4, -B.fallVy / 9));
    }
    B.fallVy = vy;
  }
}

// ---------------------------------------------------------------- every frame
const _fxv = V3();
function updateFX(dt) {
  landings();
  updateDizzy(dt);
  updateFaces(dt);
  for (let i = FX.parts.length - 1; i >= 0; i--) {
    const p = FX.parts[i];
    p.t += dt;
    const k = p.t / p.life;
    if (k >= 1) { p.m.visible = false; FX.parts.splice(i, 1); continue; }
    if (p.grav) p.vel.y -= p.grav * dt;
    if (p.drag) p.vel.multiplyScalar(Math.exp(-p.drag * dt));
    p.m.position.addScaledVector(p.vel, dt);
    p.m.quaternion.copy(camera.quaternion);
    if (p.spin) p.m.rotateZ(p.spin * p.t);
    const e = p.kind === 'puff' || p.kind === 'smear' ? Math.sin(Math.min(1, k * 3) * Math.PI / 2) * (1 - k) + 0.01 : 1 - (1 - k) * (1 - k);
    p.m.scale.setScalar(p.kind === 'puff' || p.kind === 'smear' ? p.s0 * 1.6 * e : p.s0 + (p.s1 - p.s0) * e);
    if (p.fade) p.m.material.opacity = 1 - k;
  }
  // the comic words follow the spot they popped up at (and don't pile up on each other: a newer one that would
  // cover an older one sits just above it instead)
  const w = innerWidth / 2, h = innerHeight / 2;
  for (let i = FX.words.length - 1; i >= 0; i--) {
    const W = FX.words[i];
    W.t += dt;
    if (W.t > 0.9) { W.el.remove(); FX.words.splice(i, 1); continue; }
    _fxv.copy(W.pos); _fxv.y += W.t * 0.4;
    _fxv.project(camera);
    W.hide = _fxv.z > 1;
    W.x = _fxv.x * w + w; W.y = -_fxv.y * h + h;
  }
  // (what's in the way: the words already placed, and any big banner messages)
  const boxes = [...$('banners').children].map(b => { const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width * 0.8, h: r.height * 0.8 }; });
  const hits = (x, y, W) => boxes.some(B => Math.abs(x - B.x) < (W.bw + B.w) * 0.5 && Math.abs(y - B.y) < (W.bh + B.h) * 0.5);
  for (const W of FX.words) {
    if (!W.bw) { W.bw = W.el.firstChild.offsetWidth * W.s * 0.9; W.bh = W.el.firstChild.offsetHeight * W.s * 0.8; }   // (its size, once)
    if (W.hide) { W.el.style.display = 'none'; continue; }
    // try where it is; if that's covered, a bit to the right, the left, above, below (and further out)...
    // and stick with the way that worked, so it doesn't jump about
    const tries = [[0, 0], [1, 0], [-1, 0], [0, -1], [0, 1], [1, -1], [-1, -1], [2, 0], [-2, 0], [1, 1], [-1, 1], [0, 2], [2, -1], [-2, -1], [2, 1], [-2, 1], [0, -2], [3, 0], [-3, 0], [0, 3]];
    const order = W.side ? [W.side, ...tries] : tries;
    for (const t of order) {
      const x = W.x + t[0] * W.bw * 1.05, y = W.y + t[1] * W.bh * 1.1;
      if (!hits(x, y, W) && x > W.bw / 2 && x < innerWidth - W.bw / 2 && y > W.bh / 2) { W.x = x; W.y = y; W.side = t; break; }
    }
    boxes.push({ x: W.x, y: W.y, w: W.bw, h: W.bh });
    W.el.style.display = '';
    W.el.style.left = W.x.toFixed(1) + 'px';
    W.el.style.top = W.y.toFixed(1) + 'px';
  }
}
// shake the camera (after it's been placed for this frame)
function shakeCamera(dt) {
  if (FX.shake < 0.002) return;
  const s = FX.shake;
  camera.position.x += rand(-s, s); camera.position.y += rand(-s, s) * 0.7; camera.position.z += rand(-s, s);
  FX.shake *= Math.exp(-12 * dt);
}
